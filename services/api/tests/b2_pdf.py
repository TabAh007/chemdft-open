"""Structurally valid synthetic PDFs for the Batch B2 tests.

`assemble_pdf` computes every object offset and writes a real cross-reference table and
`startxref`, so the output parses with `pypdf.PdfReader(strict=True)` (no xref reconstruction).
Earlier hand-written fixtures used constant `startxref 500` values and only parsed because pypdf
rebuilds broken tables in permissive mode.
"""

from __future__ import annotations

import io

from PIL import Image

MEDIA_BOX = (612, 792)


def stream_object(entries: str, data: bytes) -> bytes:
    """Body of a stream object: dictionary entries (without /Length) plus raw stream data."""
    return f"<< {entries} /Length {len(data)} >>\nstream\n".encode() + data + b"\nendstream"


def assemble_pdf(objects: dict[int, bytes]) -> bytes:
    """Serialise objects 1..N (1 must be the Catalog) with exact offsets and an xref table."""
    count = len(objects)
    if sorted(objects) != list(range(1, count + 1)):
        raise ValueError("object numbers must be contiguous from 1")
    out = bytearray(b"%PDF-1.4\n")
    offsets: dict[int, int] = {}
    for number in range(1, count + 1):
        offsets[number] = len(out)
        out += f"{number} 0 obj\n".encode() + objects[number] + b"\nendobj\n"
    xref_offset = len(out)
    out += f"xref\n0 {count + 1}\n".encode() + b"0000000000 65535 f \n"
    for number in range(1, count + 1):
        out += f"{offsets[number]:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {count + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode()
    )
    return bytes(out)


def jpeg_image_object(image: Image.Image) -> bytes:
    buf = io.BytesIO()
    image.convert("RGB").save(buf, format="JPEG")
    return jpeg_stream_object(buf.getvalue(), image.width, image.height)


def jpeg_stream_object(jpeg: bytes, width: int, height: int) -> bytes:
    return stream_object(
        f"/Type /XObject /Subtype /Image /Width {width} /Height {height} "
        "/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode",
        jpeg,
    )


def build_pdf(
    pages: list[tuple[str, dict[str, bytes]]],
    *,
    page_extra: str = "",
    font_resource: bool = False,
) -> bytes:
    """PDF with one page per `(content operators, {xobject name: image object body})`."""
    n_pages = len(pages)
    objects: dict[int, bytes] = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: (
            "<< /Type /Pages /Kids ["
            + " ".join(f"{3 + i} 0 R" for i in range(n_pages))
            + f"] /Count {n_pages} >>"
        ).encode(),
    }
    next_id = 3 + n_pages
    font_id = None
    if font_resource:
        font_id = next_id
        objects[font_id] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
        next_id += 1
    for index, (ops, images) in enumerate(pages):
        xobjects = []
        for name, image_body in images.items():
            objects[next_id] = image_body
            xobjects.append(f"/{name} {next_id} 0 R")
            next_id += 1
        content_id = next_id
        objects[content_id] = stream_object("", ops.encode())
        next_id += 1
        resources = f"/XObject << {' '.join(xobjects)} >>"
        if font_id is not None:
            resources += f" /Font << /F1 {font_id} 0 R >>"
        objects[3 + index] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {MEDIA_BOX[0]} {MEDIA_BOX[1]}] "
            f"{page_extra} /Contents {content_id} 0 R /Resources << {resources} >> >>"
        ).encode()
    return assemble_pdf(objects)


def solid_page(
    ops: str, images: dict[str, tuple[int, int, tuple[int, int, int]]]
) -> tuple[str, dict[str, bytes]]:
    """Page spec whose images are solid-colour JPEGs of the given (width, height, rgb)."""
    return ops, {
        name: jpeg_image_object(Image.new("RGB", (w, h), rgb))
        for name, (w, h, rgb) in images.items()
    }


def raster_pdf(images: list[tuple[Image.Image, tuple[float, float, float, float]]]) -> bytes:
    """One page with each image drawn at `(x, y, w, h)` in PDF points (origin bottom-left)."""
    ops = "".join(
        f"q {w} 0 0 {h} {x} {y} cm /Im{i} Do Q\n" for i, (_, (x, y, w, h)) in enumerate(images, 1)
    )
    return build_pdf(
        [(ops, {f"Im{i}": jpeg_image_object(img) for i, (img, _) in enumerate(images, 1)})]
    )
