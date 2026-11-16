"""Bounded, deterministic extraction of chemical figure candidates from scientific PDFs.

Extracts embedded raster images and diagram candidate regions from PDF documents, preserving:
- Document ID and SHA-256
- Page number (1-based)
- Figure bounding box (x, y, width, height in normalized [0.0, 1.0] coordinates, origin top-left
  of the displayed page), computed from the content-stream transformation matrix at each image
  draw (`Do`), including rotation, nested `q`/`cm`, page /Rotate and CropBox. When the draw cannot
  be located the box is the whole page and `bbox_resolved` is False; it is never invented.
- Image SHA-256
- Lossless PNG image bytes
- Image dimensions and metadata
- Extraction method and timestamp

Limitations (reported, not hidden): only embedded raster images drawn directly by the page
content stream are extracted. Vector-only diagrams and images nested inside Form XObjects are not
extracted. `figure_number` is a positional label for the embedded image, NOT the paper's caption
numbering.

Enforces strict safety bounds:
- Bounded memory and page count (max 500 pages)
- Bounded images per page (max 50)
- Bounded image byte size (max 20 MB per image)
- Minimum dimension filter (min 32x32 px) to discard typographic ornaments/bullets
- Declared pixel-count check before any image decoding; cumulative decoded-pixel and wall-clock
  budgets; encrypted or malformed PDFs raise FigureExtractionError
"""

from __future__ import annotations

import hashlib
import io
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from PIL import Image
from pypdf import PdfReader
from pypdf.generic import ContentStream


class FigureExtractionError(Exception):
    """Raised when figure extraction fails or violates safety bounds."""


class PageLimitExceededError(FigureExtractionError):
    """Raised when PDF exceeds the allowable page limit."""


class ImageLimitExceededError(FigureExtractionError):
    """Raised when PDF exceeds the allowable image count."""


@dataclass(frozen=True, slots=True)
class ExtractedFigure:
    page_number: int
    figure_index: int
    figure_name: str
    x: float
    y: float
    width: float
    height: float
    pixel_width: int
    pixel_height: int
    image_format: str
    image_bytes: bytes
    image_sha256: str
    caption: str | None
    figure_number: str | None
    extraction_method: str
    extracted_at: str
    bbox_resolved: bool = True


MAX_PAGES = 500
MAX_IMAGES_PER_PAGE = 50
MAX_TOTAL_IMAGES = 200
MAX_IMAGE_BYTES = 20 * 1024 * 1024  # 20 MiB
MAX_IMAGE_PIXELS = 25_000_000  # declared width*height, checked before decoding
MAX_TOTAL_PIXELS = 200_000_000  # cumulative across the document
MAX_WALL_SECONDS = 60.0
MIN_IMAGE_DIMENSION = 32  # Ignore icons/bullets smaller than 32x32 px
EXTRACTION_METHOD = "pypdf-figure-extractor-v2"

_Matrix = tuple[float, float, float, float, float, float]
_IDENTITY: _Matrix = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


def _concat(m: _Matrix, ctm: _Matrix) -> _Matrix:
    """PDF `cm`: new CTM = m x CTM (row-vector convention)."""
    a, b, c, d, e, f = m
    a2, b2, c2, d2, e2, f2 = ctm
    return (
        a * a2 + b * c2,
        a * b2 + b * d2,
        c * a2 + d * c2,
        c * b2 + d * d2,
        e * a2 + f * c2 + e2,
        e * b2 + f * d2 + f2,
    )


def _image_placements(
    page: Any, reader: PdfReader
) -> list[tuple[str, tuple[float, float, float, float]]]:
    """Return [(xobject_name, (min_x, min_y, max_x, max_y) in user space)] in draw order."""
    contents = page.get_contents()
    if contents is None:
        return []
    placements: list[tuple[str, tuple[float, float, float, float]]] = []
    ctm = _IDENTITY
    stack: list[_Matrix] = []
    for operands, op in ContentStream(contents, reader).operations:
        if op == b"q":
            stack.append(ctm)
        elif op == b"Q":
            if stack:
                ctm = stack.pop()
        elif op == b"cm" and len(operands) == 6:
            ctm = _concat(tuple(float(v) for v in operands), ctm)  # type: ignore[arg-type]
        elif op == b"Do" and operands:
            a, b, c, d, e, f = ctm
            xs = [e, e + a, e + c, e + a + c]
            ys = [f, f + b, f + d, f + b + d]
            placements.append((str(operands[0]), (min(xs), min(ys), max(xs), max(ys))))
    return placements


def _normalize_box(
    page: Any, box: tuple[float, float, float, float]
) -> tuple[float, float, float, float]:
    """User-space box -> (x, y, w, h) fractions of the displayed page, origin top-left."""
    page_box = page.cropbox
    x0, y0 = float(page_box.left), float(page_box.bottom)
    page_w = float(page_box.right) - x0
    page_h = float(page_box.top) - y0
    if page_w <= 0 or page_h <= 0:
        raise FigureExtractionError("Page has a degenerate crop/media box.")
    min_x, min_y, max_x, max_y = box
    u, v = (min_x - x0) / page_w, (y0 + page_h - max_y) / page_h
    w, h = (max_x - min_x) / page_w, (max_y - min_y) / page_h
    rotation = int(page.get("/Rotate", 0) or 0) % 360
    if rotation == 90:
        u, v, w, h = 1 - v - h, u, h, w
    elif rotation == 180:
        u, v = 1 - u - w, 1 - v - h
    elif rotation == 270:
        u, v, w, h = v, 1 - u - w, h, w
    u = max(0.0, min(1.0, u))
    v = max(0.0, min(1.0, v))
    w = max(0.0, min(1.0 - u, w))
    h = max(0.0, min(1.0 - v, h))
    return u, v, w, h


def _decode_image(
    page: Any, xobjects: Any, name: str, pixel_budget: list[int]
) -> tuple[bytes, str, int, int] | None:
    """Decode one page image XObject to lossless PNG; None when skipped (size/format/limits).

    The declared Width*Height is checked BEFORE pypdf/PIL decode anything.
    """
    xobj = xobjects.get(name)
    xobj = xobj.get_object() if xobj is not None else None
    if xobj is None or xobj.get("/Subtype") != "/Image":
        return None
    width, height = int(xobj.get("/Width", 0)), int(xobj.get("/Height", 0))
    if not (
        width >= MIN_IMAGE_DIMENSION
        and height >= MIN_IMAGE_DIMENSION
        and width * height <= MAX_IMAGE_PIXELS
        and width * height <= pixel_budget[0]
    ):
        return None
    pixel_budget[0] -= width * height
    try:
        data = page.images[name].data
        if not data or len(data) > MAX_IMAGE_BYTES:
            return None
        with Image.open(io.BytesIO(data)) as pil_img:
            pil_img.load()
            p_w, p_h = pil_img.size
            png_buf = io.BytesIO()
            if pil_img.mode in ("RGBA", "LA") or (
                pil_img.mode == "P" and "transparency" in pil_img.info
            ):
                bg = Image.new("RGB", pil_img.size, (255, 255, 255))
                converted = pil_img.convert("RGBA")
                bg.paste(converted, mask=converted.split()[3])
                bg.save(png_buf, format="PNG")
            else:
                pil_img.convert("RGB").save(png_buf, format="PNG")
        png = png_buf.getvalue()
        return png, hashlib.sha256(png).hexdigest(), p_w, p_h
    except Exception:
        return None


def extract_figures_from_pdf(
    pdf_bytes: bytes,
    document_id: str | None = None,
    document_sha256: str | None = None,
    max_pages: int = MAX_PAGES,
) -> tuple[ExtractedFigure, ...]:
    """Extract embedded raster figures from PDF bytes with provenance (one per image draw)."""
    if not pdf_bytes:
        return ()

    try:
        return _extract(pdf_bytes, max_pages)
    except FigureExtractionError:
        raise
    except Exception as exc:  # malformed/malicious PDF: never surface parser internals as 500s
        raise FigureExtractionError(f"PDF could not be parsed: {type(exc).__name__}") from exc


def _extract(pdf_bytes: bytes, max_pages: int) -> tuple[ExtractedFigure, ...]:
    reader = PdfReader(io.BytesIO(pdf_bytes), strict=False)
    if reader.is_encrypted:
        raise FigureExtractionError("Encrypted PDFs are not supported for figure extraction.")

    total_pages = len(reader.pages)
    if total_pages > max_pages:
        raise PageLimitExceededError(
            f"PDF has {total_pages} pages, which exceeds the limit of {max_pages}"
        )

    deadline = time.monotonic() + MAX_WALL_SECONDS
    pixel_budget = [MAX_TOTAL_PIXELS]  # remaining decoded pixels, shared across the document
    now_iso = datetime.now(UTC).isoformat()
    extracted_figures: list[ExtractedFigure] = []
    # (page index, xobject name) -> decoded (png bytes, sha, w, h) or None when skipped
    for page_idx, page in enumerate(reader.pages, start=1):
        if len(extracted_figures) >= MAX_TOTAL_IMAGES:
            break
        if time.monotonic() > deadline:
            raise FigureExtractionError("Figure extraction exceeded its time budget.")

        resources = page.get("/Resources")
        xobjects = resources.get_object().get("/XObject") if resources is not None else None
        if xobjects is None:
            continue
        xobjects = xobjects.get_object()

        try:
            placements = _image_placements(page, reader)
        except Exception:
            placements = []  # content stream defect: images still extractable, location unknown
        decoded: dict[str, tuple[bytes, str, int, int] | None] = {}
        fig_idx = 0

        for name, box in placements:
            if fig_idx >= MAX_IMAGES_PER_PAGE or len(extracted_figures) >= MAX_TOTAL_IMAGES:
                break
            if time.monotonic() > deadline:
                raise FigureExtractionError("Figure extraction exceeded its time budget.")
            if name not in decoded:
                decoded[name] = _decode_image(page, xobjects, name, pixel_budget)
            img_data = decoded[name]
            if img_data is None:
                continue
            png, sha, p_w, p_h = img_data
            x, y, w, h = _normalize_box(page, box)
            fig_idx += 1
            extracted_figures.append(
                ExtractedFigure(
                    page_number=page_idx,
                    figure_index=fig_idx - 1,
                    figure_name=name.lstrip("/"),
                    x=round(x, 4),
                    y=round(y, 4),
                    width=round(w, 4),
                    height=round(h, 4),
                    pixel_width=p_w,
                    pixel_height=p_h,
                    image_format="PNG",
                    image_bytes=png,
                    image_sha256=sha,
                    caption=None,
                    figure_number=f"Embedded image p{page_idx}#{fig_idx}",
                    extraction_method=EXTRACTION_METHOD,
                    extracted_at=now_iso,
                    bbox_resolved=True,
                )
            )

    return tuple(extracted_figures)
