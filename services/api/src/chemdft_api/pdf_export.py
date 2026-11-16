# ruff: noqa: E501
"""ChemDFT PDF Export Engine (3D PDF and Static Report PDF).

Generates ISO 32000-1 compliant 3D PDFs (PRC stream, 3D views, poster appearance,
embedded attachments) and static report PDFs from verified ChemDFT records.
"""

from __future__ import annotations

import io
import math
import os
import platform
import shutil
import subprocess
import tempfile
import time
from typing import Any
from xml.sax.saxutils import escape as _xml_escape

import pikepdf
import PIL
import reportlab
from PIL import Image, ImageDraw
from rdkit import Chem
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    HRFlowable,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus import (
    Image as PlatypusImage,
)

from .branding import LOGO_PNG_ASPECT, logo_png_bytes
from .release_info import EXPORTER_NAME, RELEASE_VERSION

# ChemDFT element visualization palette (from packages/scientific-scene/src/element-data.ts)
CHEMDFT_PALETTE_RGB: dict[str, tuple[float, float, float]] = {
    "H": (1.0, 1.0, 1.0),
    "B": (1.0, 0.71, 0.71),
    "C": (0.565, 0.565, 0.565),
    "N": (0.188, 0.314, 0.973),
    "O": (1.0, 0.051, 0.051),
    "F": (0.565, 0.878, 0.314),
    "P": (1.0, 0.502, 0.0),
    "S": (1.0, 1.0, 0.188),
    "Cl": (0.122, 0.941, 0.122),
    "Na": (0.671, 0.361, 0.949),
    "Mg": (0.541, 1.0, 0.0),
    "Al": (0.749, 0.651, 0.651),
    "Si": (0.941, 0.784, 0.627),
    "K": (0.561, 0.251, 0.831),
    "Ca": (0.239, 1.0, 0.0),
    "Fe": (0.878, 0.400, 0.200),
    "Cu": (0.784, 0.502, 0.200),
    "Zn": (0.490, 0.502, 0.690),
    "Br": (0.651, 0.161, 0.161),
    "I": (0.580, 0.0, 0.580),
}
DEFAULT_PALETTE_RGB: tuple[float, float, float] = (0.604, 0.643, 0.678)

# Covalent radii in Angstrom (for ball-and-stick scaling)
CHEMDFT_RADII: dict[str, float] = {
    "H": 0.28,
    "B": 0.42,
    "C": 0.40,
    "N": 0.38,
    "O": 0.36,
    "F": 0.34,
    "P": 0.46,
    "S": 0.45,
    "Cl": 0.44,
    "Na": 0.52,
    "Mg": 0.48,
    "Al": 0.46,
    "Si": 0.46,
    "K": 0.56,
    "Ca": 0.52,
    "Fe": 0.48,
    "Cu": 0.46,
    "Zn": 0.46,
    "Br": 0.48,
    "I": 0.52,
}
DEFAULT_RADIUS = 0.40


def get_element_rgb(element: str) -> tuple[float, float, float]:
    return CHEMDFT_PALETTE_RGB.get(element.strip().capitalize(), DEFAULT_PALETTE_RGB)


def get_element_radius(element: str) -> float:
    return CHEMDFT_RADII.get(element.strip().capitalize(), DEFAULT_RADIUS)


def infer_bonds_rdkit(
    atoms: list[tuple[str, list[float]]],
    charge: int = 0,
    smiles: str | None = None,
) -> list[tuple[int, int]]:
    """Infer bonds using RDKit distance perception or SMILES template."""
    if smiles:
        try:
            m = Chem.MolFromSmiles(smiles)
            if m:
                m = Chem.AddHs(m)
                if m.GetNumAtoms() == len(atoms):
                    return [(b.GetBeginAtomIdx(), b.GetEndAtomIdx()) for b in m.GetBonds()]
        except Exception:
            pass

    # Distance-based fallback bond perception
    cov_radii = {"H": 0.31, "C": 0.76, "N": 0.71, "O": 0.66, "S": 1.05, "Cl": 1.02}
    bonds = []
    n = len(atoms)
    for i in range(n):
        el_i, p_i = atoms[i]
        r_i = cov_radii.get(el_i, 0.75)
        for j in range(i + 1, n):
            el_j, p_j = atoms[j]
            r_j = cov_radii.get(el_j, 0.75)
            dx = p_i[0] - p_j[0]
            dy = p_i[1] - p_j[1]
            dz = p_i[2] - p_j[2]
            dist = (dx * dx + dy * dy + dz * dz) ** 0.5
            max_dist = (r_i + r_j) * 1.30
            min_dist = 0.4
            if min_dist < dist <= max_dist:
                bonds.append((i, j))
    return bonds


def generate_asy_script(
    atoms: list[tuple[str, list[float]]],
    bonds: list[tuple[int, int]],
    style: str = "ball_and_stick",
    fragments: list[dict[str, Any]] | None = None,
) -> str:
    """Generates Asymptote 3D script for compiling into PRC."""
    if not atoms:
        raise ValueError("Cannot generate 3D script for an empty atom list.")

    xs = [p[0] for _, p in atoms]
    ys = [p[1] for _, p in atoms]
    zs = [p[2] for _, p in atoms]
    cx = (min(xs) + max(xs)) / 2.0
    cy = (min(ys) + max(ys)) / 2.0
    cz = (min(zs) + max(zs)) / 2.0

    bond_radius = 0.12 if style == "ball_and_stick" else 0.16
    atom_scale = 1.0 if style == "ball_and_stick" else 0.55

    code = [
        "import three;",
        "settings.prc = true;",
        "settings.render = 0;",
        "size(400);",
        "currentprojection = perspective(camera=(15, 12, 10), target=(0, 0, 0));",
        "",
        "void drawCylinder(triple A, triple B, real r, material m) {",
        "  triple d = B - A;",
        "  real L = length(d);",
        "  if (L < 1e-5) return;",
        "  triple u = d / L;",
        "  transform3 rot = identity4;",
        "  triple axis = cross(Z, u);",
        "  real axis_len = length(axis);",
        "  if (axis_len > 1e-5) {",
        "    real angle = acos(u.z) * 180 / pi;",
        "    rot = rotate(angle, axis);",
        "  } else if (u.z < 0) {",
        "    rot = rotate(180, X);",
        "  }",
        "  surface cyl = shift(A) * rot * scale(r, r, L) * unitcylinder;",
        "  draw(cyl, m);",
        "}",
        "",
    ]

    # Define unique materials
    elements = sorted(list(set(el for el, _ in atoms)))
    for el in elements:
        r, g, b = get_element_rgb(el)
        code.append(
            f"material mat_{el} = material(rgb({r:.3f}, {g:.3f}, {b:.3f}), specularpen=gray(0.7));"
        )

    code.append("")
    # Draw atoms
    for el, (x, y, z) in atoms:
        rad = get_element_radius(el) * atom_scale
        px = x - cx
        py = y - cy
        pz = z - cz
        code.append(
            f"draw(shift(({px:.4f}, {py:.4f}, {pz:.4f})) * scale3({rad:.3f}) * unitsphere, mat_{el});"
        )

    code.append("")
    # Draw bonds (split in two halves for two-tone color)
    for i, j in bonds:
        if i >= len(atoms) or j >= len(atoms):
            continue
        el_i = atoms[i][0]
        el_j = atoms[j][0]
        pi = (atoms[i][1][0] - cx, atoms[i][1][1] - cy, atoms[i][1][2] - cz)
        pj = (atoms[j][1][0] - cx, atoms[j][1][1] - cy, atoms[j][1][2] - cz)
        pmid = (
            (pi[0] + pj[0]) / 2.0,
            (pi[1] + pj[1]) / 2.0,
            (pi[2] + pj[2]) / 2.0,
        )
        code.append(
            f"drawCylinder(({pi[0]:.4f}, {pi[1]:.4f}, {pi[2]:.4f}), ({pmid[0]:.4f}, {pmid[1]:.4f}, {pmid[2]:.4f}), {bond_radius:.3f}, mat_{el_i});"
        )
        code.append(
            f"drawCylinder(({pmid[0]:.4f}, {pmid[1]:.4f}, {pmid[2]:.4f}), ({pj[0]:.4f}, {pj[1]:.4f}, {pj[2]:.4f}), {bond_radius:.3f}, mat_{el_j});"
        )

    return "\n".join(code)


def get_asymptote_executable() -> tuple[str | None, dict[str, str] | None, str | None]:
    """Resolves the Asymptote binary and required environment for PRC compilation.

    Order of resolution:
    1. Explicit environment variable: CHEMDFT_ASYMPTOTE_BIN
    2. System PATH: shutil.which("asy")
    3. Explicit local developer fallback: only if CHEMDFT_ENABLE_LOCAL_ASYMPTOTE_DEV == "1"
       and the local toolchain is found at .chemdft/bin/asymptote-toolchain.

    Returns (bin_path, extra_env, error_reason).
    """
    # 1. Explicit environment variable
    custom_bin = os.environ.get("CHEMDFT_ASYMPTOTE_BIN")
    if custom_bin:
        if os.path.isfile(custom_bin) and os.access(custom_bin, os.X_OK):
            return custom_bin, None, None
        return (
            None,
            None,
            f"Configured CHEMDFT_ASYMPTOTE_BIN '{custom_bin}' does not exist or is not executable.",
        )

    # 2. System PATH (standard production Linux environment)
    which_asy = shutil.which("asy")
    if which_asy:
        return which_asy, None, None

    # 3. Explicit local developer fallback (macOS developer machine only, behind explicit flag)
    if os.environ.get("CHEMDFT_ENABLE_LOCAL_ASYMPTOTE_DEV") == "1":
        candidates = [
            os.path.abspath(".chemdft/bin/asymptote-toolchain"),
            os.path.expanduser("~/Desktop/chemdft/.chemdft/bin/asymptote-toolchain"),
        ]
        for cand in candidates:
            cand_bin = os.path.join(cand, "asymptote/3.15/bin/asy")
            if os.path.isfile(cand_bin) and os.access(cand_bin, os.X_OK):
                asy_share = os.path.join(cand, "asymptote/3.15/share/asymptote")
                dev_env = dict(os.environ)
                dyld = [
                    os.path.join(cand, "bdw-gc/8.2.12/lib"),
                    os.path.join(cand, "gsl/2.8/lib"),
                    os.path.join(cand, "glfw/3.5.1/lib"),
                    os.path.join(cand, "fftw/3.3.11/lib"),
                ]
                for rl_cand in [
                    "/opt/homebrew/opt/readline/lib",
                    "/usr/local/opt/readline/lib",
                ]:
                    if os.path.isdir(rl_cand):
                        dyld.append(rl_cand)
                dev_env["DYLD_LIBRARY_PATH"] = ":".join(dyld)
                dev_env["ASYMPTOTE_DIR"] = asy_share
                return cand_bin, dev_env, None

    return (
        None,
        None,
        "Asymptote executable ('asy') not found on system PATH or configured via CHEMDFT_ASYMPTOTE_BIN. "
        "3D PDF export is currently IN TESTING and requires an installed Asymptote compiler.",
    )


def check_3d_pdf_capability() -> tuple[bool, str]:
    """Checks whether the 3D PDF generation toolchain (Asymptote PRC engine) is operational."""
    bin_path, dev_env, err = get_asymptote_executable()
    if not bin_path:
        return False, err or "Asymptote toolchain is not installed."

    try:
        proc = subprocess.run(
            [bin_path, "--version"],
            env=dev_env or os.environ,
            capture_output=True,
            text=True,
            timeout=5,
        )
        if proc.returncode == 0:
            version_str = (
                (proc.stdout or proc.stderr).strip().splitlines()[0]
                if (proc.stdout or proc.stderr)
                else "unknown version"
            )
            return True, f"Asymptote operational ({version_str})"
        return (
            False,
            f"Asymptote executable returned exit code {proc.returncode} on verification check.",
        )
    except Exception as e:
        return False, f"Failed to execute Asymptote: {e}"


def compile_asy_to_prc(asy_source: str, timeout_sec: int = 45) -> bytes:
    """Compiles Asymptote source to a binary PRC stream using the resolved Asymptote engine."""
    bin_path, extra_env, err = get_asymptote_executable()
    if not bin_path:
        raise RuntimeError(
            f"3D PDF generation is not available on this server: {err}"
        )

    run_env = extra_env if extra_env is not None else dict(os.environ)

    with tempfile.TemporaryDirectory() as tmpdir:
        asy_path = os.path.join(tmpdir, "molecule.asy")
        prc_path = os.path.join(tmpdir, "molecule.prc")
        with open(asy_path, "w", encoding="utf-8") as f:
            f.write(asy_source)

        cmd = [bin_path, "-render=0", "-f", "prc", "molecule.asy"]
        proc = subprocess.run(
            cmd,
            cwd=tmpdir,
            env=run_env,
            capture_output=True,
            text=True,
            timeout=timeout_sec,
        )
        if proc.returncode != 0:
            raise RuntimeError(
                f"Asymptote compilation failed (exit {proc.returncode}):\n{proc.stderr}\n{proc.stdout}"
            )

        if not os.path.exists(prc_path) or os.path.getsize(prc_path) == 0:
            raise RuntimeError(
                f"Asymptote did not produce a valid PRC file. Stderr:\n{proc.stderr}"
            )

        with open(prc_path, "rb") as f:
            return f.read()


def generate_molecule_poster(
    atoms: list[tuple[str, list[float]]],
    bonds: list[tuple[int, int]],
    width: int = 1008,
    height: int = 840,
    title: str = "ChemDFT 3D Molecular Model",
    subtitle: str = "Adobe Acrobat: click to activate interactive 3D rotation",
    overlays: bool = True,
) -> bytes:
    """Generates a crisp 2D poster image of the 3D molecule with depth sorting and ChemDFT palette."""
    img = Image.new("RGB", (width, height), color=(247, 249, 251))
    draw = ImageDraw.Draw(img)

    # Instrument frame border
    draw.rectangle([0, 0, width - 1, height - 1], outline=(214, 221, 228), width=3)
    draw.rectangle(
        [12, 12, width - 13, height - 13], outline=(230, 235, 240), width=1
    )

    if not atoms:
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=92)
        return buf.getvalue()

    # Center coordinates
    xs = [p[0] for _, p in atoms]
    ys = [p[1] for _, p in atoms]
    zs = [p[2] for _, p in atoms]
    cx = (min(xs) + max(xs)) / 2.0
    cy = (min(ys) + max(ys)) / 2.0
    cz = (min(zs) + max(zs)) / 2.0

    # Isometric rotation matrix
    # Camera at isometric angle: rotY(-30 deg), rotX(20 deg)
    ay = math.radians(-35.0)
    ax = math.radians(25.0)
    cos_y, sin_y = math.cos(ay), math.sin(ay)
    cos_x, sin_x = math.cos(ax), math.sin(ax)

    proj_atoms = []
    for el, (x, y, z) in atoms:
        dx, dy, dz = x - cx, y - cy, z - cz
        # Rotate around Y
        x1 = dx * cos_y + dz * sin_y
        y1 = dy
        z1 = -dx * sin_y + dz * cos_y
        # Rotate around X
        x2 = x1
        y2 = y1 * cos_x - z1 * sin_x
        z2 = y1 * sin_x + z1 * cos_x
        proj_atoms.append((el, (x2, y2, z2)))

    # Compute bounding radius in projection
    r_max = max(math.hypot(p[0], p[1]) for _, p in proj_atoms) + 1.0
    scale = (min(width, height) * 0.40) / max(r_max, 1.5)

    center_x = width / 2.0
    center_y = height / 2.0 - 20

    # Project to screen coordinates
    screen_atoms = []
    for el, (x, y, z) in proj_atoms:
        sx = center_x + x * scale
        sy = center_y - y * scale  # Invert Y for screen
        screen_atoms.append((el, (sx, sy, z)))

    # Depth sorting: sort bonds and atoms by z (back to front)
    # Collect draw primitives
    primitives: list[dict[str, Any]] = []

    # Bonds
    for i, j in bonds:
        if i >= len(screen_atoms) or j >= len(screen_atoms):
            continue
        el_i, (xi, yi, zi) = screen_atoms[i]
        el_j, (xj, yj, zj) = screen_atoms[j]
        avg_z = (zi + zj) / 2.0
        primitives.append(
            {
                "type": "bond",
                "z": avg_z,
                "i": i,
                "j": j,
                "p1": (xi, yi),
                "p2": (xj, yj),
                "el1": el_i,
                "el2": el_j,
            }
        )

    # Atoms
    for idx, (el, (sx, sy, sz)) in enumerate(screen_atoms):
        rad_pt = get_element_radius(el) * scale * 0.75
        primitives.append(
            {
                "type": "atom",
                "z": sz,
                "idx": idx,
                "el": el,
                "pos": (sx, sy),
                "rad": max(rad_pt, 7.0),
            }
        )

    # Sort back to front (ascending z)
    primitives.sort(key=lambda item: item["z"])

    # Render primitives
    for prim in primitives:
        if prim["type"] == "bond":
            x1, y1 = prim["p1"]
            x2, y2 = prim["p2"]
            xm, ym = (x1 + x2) / 2.0, (y1 + y2) / 2.0
            r1, g1, b1 = [int(c * 255) for c in get_element_rgb(prim["el1"])]
            r2, g2, b2 = [int(c * 255) for c in get_element_rgb(prim["el2"])]
            # Draw half 1
            draw.line([(x1, y1), (xm, ym)], fill=(r1, g1, b1), width=9)
            # Draw half 2
            draw.line([(xm, ym), (x2, y2)], fill=(r2, g2, b2), width=9)
        elif prim["type"] == "atom":
            sx, sy = prim["pos"]
            r = prim["rad"]
            el = prim["el"]
            base_r, base_g, base_b = [
                int(c * 255) for c in get_element_rgb(el)
            ]
            # Outer sphere
            draw.ellipse(
                [sx - r, sy - r, sx + r, sy + r],
                fill=(base_r, base_g, base_b),
                outline=(50, 60, 70),
                width=2,
            )
            # Subtle spherical highlight
            hr = r * 0.35
            hx = sx - r * 0.3
            hy = sy - r * 0.3
            hl_r = min(255, base_r + 70)
            hl_g = min(255, base_g + 70)
            hl_b = min(255, base_b + 70)
            draw.ellipse(
                [hx - hr, hy - hr, hx + hr, hy + hr],
                fill=(hl_r, hl_g, hl_b),
                outline=None,
            )

    if not overlays:
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=92)
        return buf.getvalue()

    # Header and footer notices
    draw.text((36, 32), title, fill=(24, 33, 43))
    draw.text((36, 56), subtitle, fill=(82, 96, 109))

    # Badge in bottom-right: 3D INTERACTIVE (ADOBE ACROBAT)
    bw, bh = 340, 34
    bx = width - bw - 36
    by = height - bh - 32
    draw.rectangle(
        [bx, by, bx + bw, by + bh],
        fill=(228, 240, 248),
        outline=(21, 101, 167),
        width=1,
    )
    draw.text(
        (bx + 16, by + 8),
        "3D OBJECT · ADOBE ACROBAT ROTATABLE",
        fill=(21, 101, 167),
    )

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    return buf.getvalue()


class _ViewportBox(Flowable):
    """Frame that reserves the 3D viewport; records its page and absolute rectangle for the 3D annotation."""

    def __init__(self, width: float, height: float, text_para: Paragraph, layout_out: dict[str, Any] | None):
        super().__init__()
        self.width = width
        self.height = height
        self._para = text_para
        self._layout_out = layout_out

    def wrap(self, availWidth: float, availHeight: float) -> tuple[float, float]:
        return self.width, self.height

    def draw(self) -> None:
        canv = self.canv
        canv.setFillColor(colors.HexColor("#f7f9fb"))
        canv.setStrokeColor(colors.HexColor("#1565a7"))
        canv.setLineWidth(1.5)
        canv.rect(0, 0, self.width, self.height, fill=1, stroke=1)
        _w, h = self._para.wrap(self.width - 60, self.height)
        self._para.drawOn(canv, 30, (self.height - h) / 2)
        if self._layout_out is not None:
            x, y = canv.absolutePosition(0, 0)
            self._layout_out["page_index"] = canv.getPageNumber() - 1
            self._layout_out["rect"] = [x, y, x + self.width, y + self.height]


class _StatusChip(Flowable):
    """Small rounded status chip (text is drawn once)."""

    def __init__(self, text: str, fg: str, bg: str, border: str):
        super().__init__()
        self._text = text
        self._fg, self._bg, self._border = fg, bg, border
        self._font, self._size = "Helvetica-Bold", 8
        self.width = pdfmetrics.stringWidth(text, self._font, self._size) + 18
        self.height = 17

    def wrap(self, availWidth: float, availHeight: float) -> tuple[float, float]:
        return self.width, self.height

    def draw(self) -> None:
        c = self.canv
        c.setFillColor(colors.HexColor(self._bg))
        c.setStrokeColor(colors.HexColor(self._border))
        c.setLineWidth(0.8)
        c.roundRect(0, 0, self.width, self.height, 3, fill=1, stroke=1)
        c.setFillColor(colors.HexColor(self._fg))
        c.setFont(self._font, self._size)
        c.drawString(9, 5.2, self._text)


def _x(value: Any) -> str:
    """Escape text for ReportLab Paragraph markup."""
    return _xml_escape(str(value))


def generate_report_pages_pdf(
    project_name: str,
    title: str,
    formula: str,
    atom_count: int,
    bond_count: int,
    charge: int,
    multiplicity: int,
    coordinate_authority: str,
    results_data: list[dict[str, Any]],
    user_notes: str | None = None,
    ai_explanation: str | None = None,
    paper_claims: list[dict[str, Any]] | None = None,
    reviewer_message: str | None = None,
    include_3d_viewport: bool = True,
    poster_jpeg_bytes: bytes | None = None,
    layout_out: dict[str, Any] | None = None,
    doc_title: str | None = None,
    citation: dict[str, Any] | None = None,
    crystal_data: dict[str, Any] | None = None,
    source_reference: str | None = None,
) -> bytes:
    """Generates the multi-page ReportLab PDF layout (presentation only).

    ``layout_out`` (optional) receives ``page_index`` and ``rect`` of the 3D viewport frame so the
    3D annotation is placed exactly on it.
    """
    buf = io.BytesIO()
    page_w, page_h = letter
    margin = 54
    content_w = page_w - 2 * margin  # 504
    export_date = time.strftime("%Y-%m-%d UTC", time.gmtime())
    footer_left = f"ChemDFT {RELEASE_VERSION} · Exported {export_date}"
    header_title = title

    c_ink = colors.HexColor("#18212b")
    c_muted = colors.HexColor("#52606d")
    c_accent = colors.HexColor("#1565a7")
    c_line = colors.HexColor("#d6dde4")
    c_panel = colors.HexColor("#f1f4f7")
    c_head_bg = colors.HexColor("#e8edf2")

    is_calculated = coordinate_authority.upper().startswith("CALCULATED")
    chip_fg, chip_bg, chip_border = (
        ("#14603a", "#e3f3ea", "#238551") if is_calculated else ("#7a4b00", "#fdf3dc", "#a96700")
    )

    logo_png = logo_png_bytes()

    class _Canvas(rl_canvas.Canvas):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            super().__init__(*args, **kwargs)
            self._saved_pages: list[dict[str, Any]] = []

        def showPage(self) -> None:
            self._saved_pages.append(dict(self.__dict__))
            self._startPage()

        def save(self) -> None:
            total = len(self._saved_pages)
            for state in self._saved_pages:
                self.__dict__.update(state)
                self._draw_chrome(total)
                super().showPage()
            super().save()

        def _draw_chrome(self, total: int) -> None:
            page_no = self._pageNumber
            self.saveState()
            if page_no > 1:
                logo_h = 22.0
                logo_w = logo_h / LOGO_PNG_ASPECT
                if logo_png is not None:
                    self.drawImage(
                        ImageReader(io.BytesIO(logo_png)), margin, page_h - 20 - logo_h,
                        width=logo_w, height=logo_h, mask="auto",
                    )
                else:  # artwork not shipped (public export): text wordmark
                    self.setFont("Helvetica-Bold", 11)
                    self.setFillColor(c_ink)
                    self.drawString(margin, page_h - 20 - 14, "ChemDFT")
                self.setFont("Helvetica", 8)
                self.setFillColor(c_muted)
                room = content_w - logo_w - 16
                label = header_title
                while label and pdfmetrics.stringWidth(label, "Helvetica", 8) > room:
                    label = label[:-2]
                if label != header_title:
                    label = label.rstrip() + "…"
                self.drawRightString(page_w - margin, page_h - 36, label)
                self.setStrokeColor(c_line)
                self.setLineWidth(0.8)
                self.line(margin, page_h - 48, page_w - margin, page_h - 48)
            self.setStrokeColor(c_line)
            self.setLineWidth(0.8)
            self.line(margin, 44, page_w - margin, 44)
            self.setFont("Helvetica", 7.5)
            self.setFillColor(c_muted)
            self.drawString(margin, 31, footer_left)
            self.drawRightString(page_w - margin, 31, f"Page {page_no} of {total}")
            self.restoreState()

    doc = BaseDocTemplate(
        buf,
        pagesize=letter,
        title=doc_title or title,
        author=EXPORTER_NAME,
        creator=EXPORTER_NAME,
        subject="ChemDFT structure report",
    )
    doc.addPageTemplates([
        PageTemplate(
            id="chemdft",
            frames=[Frame(margin, 58, content_w, page_h - 54 - 58, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)],
        )
    ])

    base = getSampleStyleSheet()

    def style(name: str, **kw: Any) -> ParagraphStyle:
        return ParagraphStyle(name, parent=base["Normal"], **kw)

    title_style = style("CDF_Title", fontName="Helvetica-Bold", fontSize=22, leading=26, textColor=c_ink)
    page_title_style = style("CDF_PageTitle", fontName="Helvetica-Bold", fontSize=17, leading=21, textColor=c_ink)
    sub_style = style("CDF_Sub", fontName="Helvetica", fontSize=10.5, leading=14, textColor=c_muted)
    section_style = style(
        "CDF_Section", fontName="Helvetica-Bold", fontSize=8.5, leading=11, textColor=c_accent, spaceBefore=16, spaceAfter=3,
    )
    body_style = style("CDF_Body", fontName="Helvetica", fontSize=9, leading=13, textColor=c_ink)
    label_style = style("CDF_Label", fontName="Helvetica", fontSize=7.5, leading=10, textColor=c_muted)
    muted_style = style("CDF_Muted", fontName="Helvetica", fontSize=8, leading=11, textColor=c_muted)
    mono_style = style("CDF_Mono", fontName="Courier", fontSize=9, leading=12, textColor=c_ink)
    value_style = style("CDF_Value", fontName="Helvetica-Bold", fontSize=10, leading=13, textColor=c_ink)
    head_cell_style = style("CDF_Head", fontName="Helvetica-Bold", fontSize=7.5, leading=10, textColor=c_muted)
    status_cell_style = style(
        "CDF_Status", fontName="Helvetica-Bold", fontSize=8, leading=10.5, textColor=colors.HexColor(chip_fg),
    )
    badge_user_style = style(
        "CDF_BadgeUser", fontName="Helvetica-Bold", fontSize=8, leading=10.5, textColor=colors.HexColor("#7a4b00"),
    )
    badge_ai_style = style("CDF_BadgeAI", fontName="Helvetica-Bold", fontSize=8, leading=10.5, textColor=c_accent)
    center_style = style("CDF_Center", fontName="Helvetica", fontSize=9, leading=14, textColor=c_muted, alignment=1)

    def section(text: str) -> list[Any]:
        return [Paragraph(text.upper(), section_style), HRFlowable(width="100%", thickness=0.8, color=c_line, spaceAfter=6)]

    def grid(extra: list[Any] | None = None, pad: int = 6) -> TableStyle:
        cmds: list[Any] = [
            ("BOX", (0, 0), (-1, -1), 0.8, c_line),
            ("INNERGRID", (0, 0), (-1, -1), 0.5, c_line),
            ("TOPPADDING", (0, 0), (-1, -1), pad),
            ("BOTTOMPADDING", (0, 0), (-1, -1), pad),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]
        return TableStyle(cmds + (extra or []))

    story: list[Any] = []

    # ════════ PAGE 1: LOCKUP, IDENTITY, STRUCTURE IMAGE, RESULTS ════════
    lockup_w = 158.0
    if logo_png is not None:
        lockup: Any = PlatypusImage(io.BytesIO(logo_png), width=lockup_w, height=lockup_w * LOGO_PNG_ASPECT)
    else:  # artwork not shipped (public export): text wordmark
        lockup = Paragraph("<b>ChemDFT</b>", style("CDF_Wordmark", fontName="Helvetica-Bold", fontSize=16, leading=20, textColor=c_ink))
    lockup.hAlign = "LEFT"
    kind = "3D structure report" if include_3d_viewport else "Structure report"
    top = Table(
        [[
            lockup,
            [
                Paragraph(f"<b>{kind}</b>", style("CDF_TopR1", fontName="Helvetica", fontSize=9, leading=12, textColor=c_ink, alignment=2)),
                Paragraph(
                    f"Release {RELEASE_VERSION} · {export_date}",
                    style("CDF_TopR2", fontName="Helvetica", fontSize=8, leading=11, textColor=c_muted, alignment=2),
                ),
            ],
        ]],
        colWidths=[content_w - 170, 170],
    )
    top.setStyle(TableStyle([
        ("VALIGN", (0, 0), (0, 0), "MIDDLE"), ("VALIGN", (1, 0), (1, 0), "BOTTOM"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10), ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, c_line),
    ]))
    story += [top, Spacer(1, 16)]

    story.append(Paragraph(_x(title), title_style))
    story.append(Spacer(1, 3))
    story.append(Paragraph(f"Project: <b>{_x(project_name)}</b>", sub_style))
    story.append(Spacer(1, 9))
    chip = _StatusChip(coordinate_authority, chip_fg, chip_bg, chip_border)
    chip.hAlign = "LEFT"
    story.append(chip)

    if reviewer_message:
        msg_table = Table(
            [
                [Paragraph("<b>Message from Researcher (user-provided text, not engine output):</b>", badge_user_style)],
                [Paragraph(_x(reviewer_message), body_style)],
            ],
            colWidths=[content_w],
        )
        msg_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#fffbeb")),
            ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#fde68a")),
            ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ]))
        story += [Spacer(1, 10), msg_table]

    story += section("Structure identity & state")
    if crystal_data:
        identity = Table(
            [
                [Paragraph("Formula", label_style), Paragraph(_x(formula), value_style),
                 Paragraph("Atom count", label_style), Paragraph(str(atom_count), value_style)],
                [Paragraph("Inferred bond count", label_style), Paragraph(str(bond_count), value_style),
                 Paragraph("Coordinate authority", label_style), Paragraph(_x(coordinate_authority), status_cell_style)],
                [Paragraph("Cell lengths", label_style),
                 Paragraph(f"a={crystal_data['a']} Å, b={crystal_data['b']} Å, c={crystal_data['c']} Å", mono_style),
                 Paragraph("Cell angles", label_style),
                 Paragraph(
                     f"α={crystal_data['alpha']}°, β={crystal_data['beta']}°, γ={crystal_data['gamma']}°",  # noqa: RUF001
                     mono_style,
                 )],
                [Paragraph("Cell volume", label_style),
                 Paragraph(f"{crystal_data['volume']} Å³", mono_style),
                 Paragraph("Space group", label_style),
                 Paragraph(_x(crystal_data.get("space_group") or "—"), mono_style)],
            ],
            colWidths=[114, 138, 114, 138],
        )
        identity.setStyle(grid([
            ("BACKGROUND", (0, 0), (0, -1), c_panel), ("BACKGROUND", (2, 0), (2, -1), c_panel),
        ]))
    else:
        identity = Table(
            [
                [Paragraph("Formula", label_style), Paragraph(_x(formula), value_style),
                 Paragraph("Atom count", label_style), Paragraph(str(atom_count), value_style)],
                [Paragraph("Bond count", label_style), Paragraph(str(bond_count), value_style),
                 Paragraph("Charge", label_style), Paragraph(str(charge), value_style)],
                [Paragraph("Multiplicity", label_style), Paragraph(str(multiplicity), value_style),
                 Paragraph("", label_style), Paragraph("", label_style)],
                [Paragraph("Coordinate authority", label_style), Paragraph(_x(coordinate_authority), status_cell_style), "", ""],
            ],
            colWidths=[104, 148, 104, 148],
        )
        identity.setStyle(grid([
            ("BACKGROUND", (0, 0), (0, -1), c_panel), ("BACKGROUND", (2, 0), (2, 1), c_panel),
            ("SPAN", (1, 3), (3, 3)), ("SPAN", (1, 2), (3, 2)),
        ]))
    story.append(identity)

    if source_reference:
        story += section("Source reference")
        story.append(Paragraph(f"<b>Source reference found in file:</b> {_x(source_reference)}", body_style))
    elif crystal_data:
        story += section("Source reference")
        story.append(Paragraph("<i>No source reference in the file — add one</i>", muted_style))

    poster_w = 252.0
    poster_h = poster_w * 840.0 / 1008.0
    if poster_jpeg_bytes:
        story += section("Structure image")
        img = PlatypusImage(io.BytesIO(poster_jpeg_bytes), width=poster_w, height=poster_h)
        caption_text = (
            "Structure visualization of the stored atomic coordinates and unit cell, drawn for this report. "
            "Inferred connectivity is an illustration of the periodic geometry, not an authoritative chemical bond calculation."
            if crystal_data
            else (
                "Structure visualization of the stored Cartesian coordinates, drawn for this report. "
                "It is an illustration of the geometry, not a calculated result."
            )
        )
        img_table = Table(
            [[img, Paragraph(caption_text, muted_style)]],
            colWidths=[poster_w + 12, content_w - poster_w - 12],
        )
        img_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (0, 0), 12), ("TOPPADDING", (0, 0), (-1, -1), 2),
        ]))
        story.append(img_table)

    story += section("Scientific results (status shown per value)")
    if results_data:
        res_rows: list[list[Any]] = [[
            Paragraph("PROPERTY", head_cell_style), Paragraph("VALUE", head_cell_style),
            Paragraph("ENGINE / METHOD", head_cell_style), Paragraph("STATUS", head_cell_style),
        ]]
        for item in results_data:
            method = " / ".join(str(p) for p in (item.get("method"), item.get("basis")) if p)
            engine_txt = f"{_x(item.get('engine', ''))} {_x(item.get('version', ''))}".strip()
            if method:
                engine_txt += f"<br/><font color='#52606d'>{_x(method)}</font>"
            status = str(item.get("standing") or item.get("authority") or "")
            status_txt = f"<b>{_x(status)}</b>"
            if item.get("validation"):
                status_txt += f"<br/>{_x(item['validation'])}"
            res_rows.append([
                Paragraph(_x(item.get("property", "")), body_style),
                Paragraph(f"<b>{_x(item.get('value', '—'))}</b> {_x(item.get('unit', ''))}", mono_style),
                Paragraph(engine_txt, muted_style),
                Paragraph(status_txt, status_cell_style if status.upper().startswith("CALCULATED") else badge_user_style),
            ])
        res_table = Table(res_rows, colWidths=[122, 130, 142, 110], repeatRows=1)
        res_table.setStyle(grid([("BACKGROUND", (0, 0), (-1, 0), c_head_bg)], pad=5))
        story.append(res_table)
    else:
        none_text = "No calculation results recorded for this structure."
        if not is_calculated:
            none_text += " The coordinates have not been optimized."
        story.append(Paragraph(none_text, body_style))

    # ════════ 3D VIEWPORT PAGE (3D PDF only) ════════
    if include_3d_viewport:
        story.append(PageBreak())
        story.append(Paragraph("3D Molecular Structure", page_title_style))
        story.append(Spacer(1, 4))
        story.append(Paragraph(
            "<b>Interactive 3D:</b> Desktop Adobe Acrobat / Reader is required for live 3D rotation, zoom and pan. "
            "Other viewers (Preview, Chrome) display the 2D appearance stream.",
            muted_style,
        ))
        story.append(Spacer(1, 10))
        story.append(_ViewportBox(
            content_w, 420,
            Paragraph(
                "<font color='#1565a7'><b>Interactive 3D model viewport</b></font><br/><br/>"
                "When opened in desktop Adobe Acrobat, click anywhere in this frame to activate 3D interaction. "
                "Use the toolbar to select preset views (Front, Side, Top), isolate parts or measure bonds.",
                center_style,
            ),
            layout_out,
        ))
        story.append(Spacer(1, 10))
        views_info = Table(
            [
                [Paragraph("<b>Camera presets</b>", muted_style), Paragraph(
                    "<b>Default:</b> Isometric perspective &nbsp;|&nbsp; <b>Front:</b> XY plane (along +Z) &nbsp;|&nbsp; "
                    "<b>Side:</b> YZ plane (along +X) &nbsp;|&nbsp; <b>Top:</b> XZ plane (along +Y)", body_style)],
                [Paragraph("<b>Attachments</b>", muted_style), Paragraph(
                    "Raw Cartesian coordinates (<b>.xyz</b>) and full provenance metadata (<b>.json</b>) "
                    "are attached directly to this PDF document.", body_style)],
            ],
            colWidths=[100, 404],
        )
        views_info.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3), ("LEFTPADDING", (0, 0), (0, -1), 0),
        ]))
        story.append(views_info)

    # ════════ NOTES, CLAIMS, PROVENANCE ════════
    story.append(PageBreak())
    story.append(Paragraph("Notes & Provenance", page_title_style))

    if user_notes:
        story += section("Researcher notes")
        story.append(Paragraph(_x(user_notes).replace("\n", "<br/>"), ParagraphStyle("CDF_Notes", parent=body_style, leading=14)))

    if paper_claims:
        story += section("Extracted literature claims (USER_ENTERED)")
        p_rows: list[list[Any]] = [[
            Paragraph("CLAIM PROPERTY", head_cell_style), Paragraph("PAPER REPORTED VALUE", head_cell_style),
            Paragraph("SOURCE QUOTE & PAGE", head_cell_style),
        ]]
        for claim in paper_claims:
            p_rows.append([
                Paragraph(_x(claim.get("claim_type", "Property")), body_style),
                Paragraph(f"<b>{_x(claim.get('value', ''))}</b> {_x(claim.get('unit', ''))}", mono_style),
                Paragraph(f'"{_x(claim.get("quote", ""))}" (p. {_x(claim.get("page", 1))})', muted_style),
            ])
        p_table = Table(p_rows, colWidths=[140, 114, 250], repeatRows=1)
        p_table.setStyle(grid([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#fef3c7"))], pad=5))
        story.append(p_table)

    if ai_explanation:
        story += section("AI Scientist interpretation & reasoning")
        ai_box = Table(
            [
                [Paragraph("<b>AI HYPOTHESIS & SUMMARY · NOT ENGINE EVIDENCE</b>", badge_ai_style)],
                [Paragraph(_x(ai_explanation), ParagraphStyle("CDF_AIText", parent=body_style, leading=14))],
            ],
            colWidths=[content_w],
        )
        ai_box.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f0f7fd")),
            ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#bae6fd")),
            ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ]))
        story.append(ai_box)

    story += section("Provenance & result firewall")
    story.append(Paragraph(
        "ChemDFT policy: published scientific values come from deterministic engines or from user-entered "
        "literature references, and AI language models do not author authoritative numbers. The status of each "
        "value (authority, validation, independent verification) is shown with that value, not summarised here.",
        muted_style,
    ))
    story.append(Spacer(1, 8))
    prov_rows: list[list[Any]] = [
        [Paragraph("System version", label_style), Paragraph(f"{_x(EXPORTER_NAME)} (Export &amp; Share)", mono_style)],
        [Paragraph("Report generated on", label_style),
         Paragraph(_x(f"{platform.system()} {platform.machine()}"), body_style)],
    ]
    if include_3d_viewport:
        prov_rows.append([
            Paragraph("3D graphics engine", label_style),
            Paragraph(f"Asymptote (PRC ISO 14739-1 stream) + pikepdf {pikepdf.__version__}", body_style),
        ])
    prov_rows += [
        [Paragraph("Report builder", label_style),
         Paragraph(f"ReportLab {reportlab.Version} + Pillow {PIL.__version__}", body_style)],
        [Paragraph("Scientific result firewall", label_style),
         Paragraph("Statuses are shown per value above and in the attached provenance file. "
                   "This report does not add a separate pass or fail verdict.", body_style)],
        [Paragraph("Known limits", label_style), Paragraph(
            "Interactive 3D rotation needs Adobe Acrobat or Reader and has not been checked in every viewer. "
            "Orbital volume surfaces are not included. Share links are not hosted.", muted_style)],
    ]
    prov_table = Table(prov_rows, colWidths=[120, 384])
    prov_table.setStyle(grid([("BACKGROUND", (0, 0), (0, -1), c_panel)]))
    story.append(prov_table)

    if citation is not None:
        # The same text the web Cite panel shows (chemdft_api.citation_block). Notes stay outside the citation text.
        cite_style = style("CDF_CiteMono", fontName="Courier", fontSize=7.5, leading=10, textColor=c_ink)

        def cite_box(text: str) -> Table:
            body = _x(text).replace("\n  ", "<br/>&nbsp;&nbsp;").replace("\n", "<br/>")
            box = Table([[Paragraph(body, cite_style)]], colWidths=[content_w])
            box.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), c_panel), ("BOX", (0, 0), (-1, -1), 0.5, c_line),
                ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
            ]))
            return box

        story += section("How to cite")
        for item in citation["calculations"]:
            story += [Paragraph(f"Calculation {_x(item['calculation_id'])} (APA)", label_style), cite_box(item["apa"]), Spacer(1, 4),
                      Paragraph(f"Calculation {_x(item['calculation_id'])} (BibTeX)", label_style), cite_box(item["bibtex"]), Spacer(1, 8)]
        story += [Paragraph("ChemDFT software (APA)", label_style), cite_box(citation["software"]["apa"]), Spacer(1, 4),
                  Paragraph("ChemDFT software (BibTeX)", label_style), cite_box(citation["software"]["bibtex"]), Spacer(1, 6)]

        also_cite = citation.get("also_cite")
        if also_cite and also_cite.get("tools"):
            story += [Paragraph("<b>Also cite:</b>", style("CDF_AlsoCiteH", fontName="Helvetica-Bold", fontSize=8.5, leading=11, textColor=c_ink)), Spacer(1, 4)]
            for t in also_cite["tools"]:
                t_label = f"{t['name']} ({t.get('version', '')})" if t.get('version') else t['name']
                story += [
                    Paragraph(f"{_x(t_label)} (APA)", label_style), cite_box(t["apa"]), Spacer(1, 4),
                    Paragraph(f"{_x(t_label)} (BibTeX)", label_style), cite_box(t["bibtex"]), Spacer(1, 6),
                ]
            if also_cite.get("reminder"):
                story += [Paragraph(f"<i>{_x(also_cite['reminder'])}</i>", body_style), Spacer(1, 6)]

        story += [Paragraph(_x(note), muted_style) for note in citation["notes"]]

    doc.build(story, canvasmaker=_Canvas)
    return buf.getvalue()


def assemble_3d_pdf(
    report_pdf_bytes: bytes,
    prc_bytes: bytes,
    poster_jpeg_bytes: bytes,
    xyz_filename: str,
    xyz_bytes: bytes,
    json_filename: str,
    json_bytes: bytes,
    title: str = "ChemDFT 3D Molecular Model",
    camera_distance: float = 14.0,
    viewport_page_index: int = 1,
    viewport_rect: list[float] | None = None,
) -> bytes:
    """Assembles the complete 3D PDF with pikepdf: binds PRC, views, poster AP, and attachments."""
    pdf = pikepdf.open(io.BytesIO(report_pdf_bytes))
    if len(pdf.pages) < 2:
        raise ValueError("Report PDF must have at least 2 pages for 3D page.")

    # Target page 2 (index 1) for the 3D annotation
    page_3d = pdf.pages[viewport_page_index]

    # 1. PRC 3D Stream
    prc_stream = pdf.make_stream(prc_bytes)
    prc_stream.Type = pikepdf.Name("/3D")
    prc_stream.Subtype = pikepdf.Name("/PRC")

    # 2. View Dictionaries
    d = float(camera_distance)

    # Default Isometric View
    # Camera at (d*0.7, d*0.6, d*0.8) pointing to origin
    view_default = pdf.make_indirect(
        pikepdf.Dictionary(
            Type=pikepdf.Name("/3DView"),
            XN=pikepdf.String("Default (Isometric)"),
            IN=pikepdf.String("Default"),
            MS=pikepdf.Name("/M"),
            CO=d,
            C2W=pikepdf.Array([
                0.7071,
                0.0,
                -0.7071,
                -0.4082,
                0.8165,
                -0.4082,
                0.5774,
                0.5774,
                0.5774,
                d * 0.5774,
                d * 0.5774,
                d * 0.5774,
            ]),
            BG=pikepdf.Dictionary(
                Type=pikepdf.Name("/3DBG"), C=pikepdf.Array([1.0, 1.0, 1.0])
            ),
            LS=pikepdf.Dictionary(
                Type=pikepdf.Name("/3DLightingScheme"),
                Subtype=pikepdf.Name("/CAD"),
            ),
        )
    )

    # Front View (along +Z)
    view_front = pdf.make_indirect(
        pikepdf.Dictionary(
            Type=pikepdf.Name("/3DView"),
            XN=pikepdf.String("Front View (XY)"),
            IN=pikepdf.String("Front"),
            MS=pikepdf.Name("/M"),
            CO=d,
            C2W=pikepdf.Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, d]),
            BG=pikepdf.Dictionary(
                Type=pikepdf.Name("/3DBG"), C=pikepdf.Array([1.0, 1.0, 1.0])
            ),
            LS=pikepdf.Dictionary(
                Type=pikepdf.Name("/3DLightingScheme"),
                Subtype=pikepdf.Name("/White"),
            ),
        )
    )

    # Side View (along +X)
    view_side = pdf.make_indirect(
        pikepdf.Dictionary(
            Type=pikepdf.Name("/3DView"),
            XN=pikepdf.String("Side View (YZ)"),
            IN=pikepdf.String("Side"),
            MS=pikepdf.Name("/M"),
            CO=d,
            C2W=pikepdf.Array([0, 0, -1, 0, 1, 0, 1, 0, 0, d, 0, 0]),
            BG=pikepdf.Dictionary(
                Type=pikepdf.Name("/3DBG"), C=pikepdf.Array([1.0, 1.0, 1.0])
            ),
            LS=pikepdf.Dictionary(
                Type=pikepdf.Name("/3DLightingScheme"),
                Subtype=pikepdf.Name("/White"),
            ),
        )
    )

    # Top View (along +Y)
    view_top = pdf.make_indirect(
        pikepdf.Dictionary(
            Type=pikepdf.Name("/3DView"),
            XN=pikepdf.String("Top View (XZ)"),
            IN=pikepdf.String("Top"),
            MS=pikepdf.Name("/M"),
            CO=d,
            C2W=pikepdf.Array([1, 0, 0, 0, 0, -1, 0, 1, 0, 0, d, 0]),
            BG=pikepdf.Dictionary(
                Type=pikepdf.Name("/3DBG"), C=pikepdf.Array([1.0, 1.0, 1.0])
            ),
            LS=pikepdf.Dictionary(
                Type=pikepdf.Name("/3DLightingScheme"),
                Subtype=pikepdf.Name("/White"),
            ),
        )
    )

    # 3. Poster Appearance Stream (/AP /N)
    w_pt, h_pt = 504, 420
    img_xobj = pdf.make_stream(poster_jpeg_bytes)
    img_xobj.Type = pikepdf.Name("/XObject")
    img_xobj.Subtype = pikepdf.Name("/Image")
    img_xobj.Width = 1008
    img_xobj.Height = 840
    img_xobj.ColorSpace = pikepdf.Name("/DeviceRGB")
    img_xobj.BitsPerComponent = 8
    img_xobj.Filter = pikepdf.Name("/DCTDecode")

    form_stream = f"q {w_pt} 0 0 {h_pt} 0 0 cm /PosterImg Do Q".encode("ascii")
    form_xobj = pdf.make_stream(form_stream)
    form_xobj.Type = pikepdf.Name("/XObject")
    form_xobj.Subtype = pikepdf.Name("/Form")
    form_xobj.BBox = pikepdf.Array([0, 0, w_pt, h_pt])
    form_xobj.Resources = pikepdf.Dictionary(
        XObject=pikepdf.Dictionary(PosterImg=img_xobj)
    )

    # 4. 3D Annotation Dictionary
    annot_dict = pdf.make_indirect(
        pikepdf.Dictionary(
            Type=pikepdf.Name("/Annot"),
            Subtype=pikepdf.Name("/3D"),
            Rect=pikepdf.Array(viewport_rect or [54, 250, 558, 670]),
            Contents=pikepdf.String(title),
            F=4,  # Print flag
            AP=pikepdf.Dictionary(N=form_xobj),
        )
    )
    annot_dict[pikepdf.Name("/3DA")] = pikepdf.Dictionary(
        A=pikepdf.Name("/PO"),  # Page Open activation
        DIS=pikepdf.Name("/I"),  # Invisible deactivation
    )
    annot_dict[pikepdf.Name("/3DD")] = prc_stream
    annot_dict[pikepdf.Name("/3DV")] = view_default
    annot_dict[pikepdf.Name("/3DViews")] = pikepdf.Array(
        [view_default, view_front, view_side, view_top]
    )

    # Attach to Page 2
    if "/Annots" in page_3d:
        page_3d.Annots.append(annot_dict)
    else:
        page_3d.Annots = pdf.make_indirect(pikepdf.Array([annot_dict]))

    # 5. File Attachments
    pdf.attachments[xyz_filename] = pikepdf.AttachedFileSpec(
        pdf,
        xyz_bytes,
        filename=xyz_filename,
        description=f"ChemDFT Cartesian Coordinates ({xyz_filename})",
    )
    pdf.attachments[json_filename] = pikepdf.AttachedFileSpec(
        pdf,
        json_bytes,
        filename=json_filename,
        description=f"ChemDFT Scientific Provenance Manifest ({json_filename})",
    )

    # 6. Metadata
    pdf.docinfo[pikepdf.Name("/Title")] = title
    pdf.docinfo[pikepdf.Name("/Creator")] = EXPORTER_NAME
    pdf.docinfo[pikepdf.Name("/Author")] = EXPORTER_NAME
    with pdf.open_metadata() as meta:
        meta["dc:title"] = title
        meta["dc:creator"] = [EXPORTER_NAME]
        meta["xmp:CreatorTool"] = EXPORTER_NAME
        meta["dc:description"] = "3D Molecular Structure and Provenance Report"

    out_buf = io.BytesIO()
    pdf.save(out_buf)
    return out_buf.getvalue()


def assemble_static_report_pdf(
    report_pdf_bytes: bytes,
    xyz_filename: str,
    xyz_bytes: bytes,
    json_filename: str,
    json_bytes: bytes,
    title: str = "ChemDFT Molecular Structure Report",
) -> bytes:
    """Assembles a static report PDF with attached XYZ and JSON provenance files."""
    pdf = pikepdf.open(io.BytesIO(report_pdf_bytes))

    # File Attachments
    pdf.attachments[xyz_filename] = pikepdf.AttachedFileSpec(
        pdf,
        xyz_bytes,
        filename=xyz_filename,
        description=f"ChemDFT Cartesian Coordinates ({xyz_filename})",
    )
    pdf.attachments[json_filename] = pikepdf.AttachedFileSpec(
        pdf,
        json_bytes,
        filename=json_filename,
        description=f"ChemDFT Scientific Provenance Manifest ({json_filename})",
    )

    pdf.docinfo[pikepdf.Name("/Title")] = title
    pdf.docinfo[pikepdf.Name("/Creator")] = EXPORTER_NAME
    pdf.docinfo[pikepdf.Name("/Author")] = EXPORTER_NAME
    with pdf.open_metadata() as meta:
        meta["dc:title"] = title
        meta["dc:creator"] = [EXPORTER_NAME]
        meta["xmp:CreatorTool"] = EXPORTER_NAME
        meta["dc:description"] = "ChemDFT Scientific Molecular Structure Report"

    out_buf = io.BytesIO()
    pdf.save(out_buf)
    return out_buf.getvalue()
