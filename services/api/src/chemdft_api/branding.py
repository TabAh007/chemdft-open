# ruff: noqa: E501
"""ChemDFT brand assets for exports (owner's proprietary artwork; see REUSE.toml).

The SVG files are copies of ``apps/web/public/brand/svg``; ``logo-horizontal-light@2x.png`` is the
horizontal light logo rasterised at 1422 px width for ReportLab (no SVG renderer dependency is installed).
"""

from __future__ import annotations

import base64
import re
from functools import cache
from pathlib import Path

BRAND_DIR = Path(__file__).resolve().parent / "assets" / "brand"
LOGO_PNG_PATH = BRAND_DIR / "logo-horizontal-light@2x.png"
LOGO_PNG_ASPECT = 262.0 / 711.0  # height / width of the horizontal logo


@cache
def _read(name: str) -> str | None:
    """Brand file text, or None when the artwork is not shipped (the public export omits it: see REUSE.toml)."""
    try:
        return (BRAND_DIR / name).read_text(encoding="utf-8")
    except FileNotFoundError:
        return None


def inline_svg(name: str, css_class: str, label: str = "ChemDFT") -> str:
    """Return the brand SVG with fixed pixel size replaced by a CSS class, ready to inline in HTML."""
    svg = _read(name)
    if svg is None:  # no artwork shipped: plain-text wordmark, same CSS class
        return f'<span class="{css_class}" role="img" aria-label="{label}">{label}</span>'
    svg = re.sub(r'\swidth="[\d.]+"\sheight="[\d.]+"', f' class="{css_class}" focusable="false"', svg, count=1)
    return re.sub(r'aria-label="[^"]*"', f'aria-label="{label}"', svg, count=1)


def favicon_data_uri() -> str:
    svg = _read("favicon.svg")
    if svg is None:
        return "data:,"
    data = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return f"data:image/svg+xml;base64,{data}"


def logo_png_bytes() -> bytes | None:
    """The raster logo, or None when the artwork is not shipped."""
    try:
        return LOGO_PNG_PATH.read_bytes()
    except FileNotFoundError:
        return None


def logo_svg_bytes() -> bytes | None:
    try:
        return (BRAND_DIR / "logo-horizontal-light.svg").read_bytes()
    except FileNotFoundError:
        return None
