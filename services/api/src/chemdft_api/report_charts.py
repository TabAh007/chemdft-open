"""Dependency-free inline SVG charts for the HTML report.

Charts plot only values that are stored in a result; nothing is smoothed, broadened, fitted or
peak-picked. Each chart is an `<svg role="img">` with a title and a text description so it is
readable without sight, and uses no script or external resource.
"""

from __future__ import annotations

from html import escape

_INK = "#1a1a1a"
_AXIS = "#6b7280"
_SERIES = "#1f4e79"
_W, _H = 560, 230
_L, _R, _T, _B = 62, 14, 14, 44


def _fmt(value: float) -> str:
    return f"{value:.6g}"


def _frame(title: str, description: str, x_label: str, y_label: str, body: str, ticks: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {_W} {_H}" width="{_W}" '
        f'height="{_H}" role="img" aria-labelledby="t d" font-family="sans-serif" font-size="11">'
        f'<title id="t">{escape(title)}</title><desc id="d">{escape(description)}</desc>'
        f'<rect width="{_W}" height="{_H}" fill="#fff"/>'
        f'<path d="M{_L} {_T}V{_H - _B}H{_W - _R}" fill="none" stroke="{_AXIS}"/>'
        f"{ticks}{body}"
        f'<text x="{(_L + _W - _R) / 2}" y="{_H - 6}" text-anchor="middle" fill="{_INK}">'
        f"{escape(x_label)}</text>"
        f'<text transform="translate(13 {(_T + _H - _B) / 2}) rotate(-90)" text-anchor="middle" '
        f'fill="{_INK}">{escape(y_label)}</text></svg>'
    )


def _scale(lo: float, hi: float, size: float, flip: bool = False):
    span = (hi - lo) or 1.0

    def at(value: float) -> float:
        fraction = (value - lo) / span
        return size * (1 - fraction if flip else fraction)

    return at


def _axis_ticks(x_lo, x_hi, y_lo, y_hi, x_at, y_at) -> str:
    out = []
    for value in (x_lo, (x_lo + x_hi) / 2, x_hi):
        x = _L + x_at(value)
        out.append(
            f'<text x="{x:.1f}" y="{_H - _B + 14}" text-anchor="middle" fill="{_AXIS}">'
            f"{_fmt(value)}</text>"
        )
    for value in (y_lo, (y_lo + y_hi) / 2, y_hi):
        y = _T + y_at(value)
        out.append(
            f'<text x="{_L - 5}" y="{y + 4:.1f}" text-anchor="end" fill="{_AXIS}">'
            f"{_fmt(value)}</text>"
        )
    return "".join(out)


def sticks(points: list[tuple[float, float]], *, title: str, x_label: str, y_label: str) -> str:
    """Vertical lines from zero: a stick spectrum (no broadening)."""
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    x_lo, x_hi = min(xs), max(xs)
    pad = (x_hi - x_lo) * 0.04 or 1.0
    x_lo, x_hi = x_lo - pad, x_hi + pad
    y_hi = max(max(ys), 0.0) or 1.0
    x_at = _scale(x_lo, x_hi, _W - _L - _R)
    y_at = _scale(0.0, y_hi, _H - _T - _B, flip=True)
    body = "".join(
        f'<line x1="{_L + x_at(x):.1f}" x2="{_L + x_at(x):.1f}" y1="{_T + y_at(0):.1f}" '
        f'y2="{_T + y_at(y):.1f}" stroke="{_SERIES}" stroke-width="1.5"/>'
        for x, y in points
    )
    description = (
        f"{len(points)} stored lines; {x_label} from {_fmt(min(xs))} to {_fmt(max(xs))}; "
        f"largest {y_label} {_fmt(max(ys))}."
    )
    return _frame(
        title, description, x_label, y_label, body,
        _axis_ticks(x_lo, x_hi, 0.0, y_hi, x_at, y_at),
    )


def line(points: list[tuple[float, float]], *, title: str, x_label: str, y_label: str) -> str:
    """Polyline through stored points with a marker on each (an optimization energy profile)."""
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    x_lo, x_hi = min(xs), max(xs)
    y_lo, y_hi = min(ys), max(ys)
    x_at = _scale(x_lo, x_hi, _W - _L - _R)
    y_at = _scale(y_lo, y_hi, _H - _T - _B, flip=True)
    coords = [(_L + x_at(x), _T + y_at(y)) for x, y in points]
    path = " ".join(f"{x:.1f},{y:.1f}" for x, y in coords)
    body = (
        f'<polyline points="{path}" fill="none" stroke="{_SERIES}" stroke-width="1.5"/>'
        + "".join(
            f'<circle cx="{x:.1f}" cy="{y:.1f}" r="2.5" fill="{_SERIES}"/>' for x, y in coords
        )
    )
    description = (
        f"{len(points)} stored points; {y_label} from {_fmt(ys[0])} (first) to {_fmt(ys[-1])} "
        f"(last); minimum {_fmt(y_lo)}, maximum {_fmt(y_hi)}."
    )
    return _frame(title, description, x_label, y_label, body,
                  _axis_ticks(x_lo, x_hi, y_lo, y_hi, x_at, y_at))


def bars(items: list[tuple[str, float]], *, title: str, y_label: str) -> str:
    """Signed bars around zero, one per labelled value."""
    values = [v for _l, v in items]
    y_lo, y_hi = min(min(values), 0.0), max(max(values), 0.0)
    if y_lo == y_hi:
        y_hi = y_lo + 1.0
    y_at = _scale(y_lo, y_hi, _H - _T - _B, flip=True)
    slot = (_W - _L - _R) / len(items)
    zero = _T + y_at(0.0)
    body = [f'<line x1="{_L}" x2="{_W - _R}" y1="{zero:.1f}" y2="{zero:.1f}" stroke="{_AXIS}"/>']
    for index, (label, value) in enumerate(items):
        x = _L + slot * index + slot * 0.2
        top = _T + y_at(max(value, 0.0))
        height = abs(_T + y_at(value) - zero) or 0.5
        body.append(
            f'<rect x="{x:.1f}" y="{top:.1f}" width="{slot * 0.6:.1f}" height="{height:.1f}" '
            f'fill="{_SERIES}"/><text x="{x + slot * 0.3:.1f}" y="{_H - _B + 14}" '
            f'text-anchor="middle" fill="{_AXIS}">{escape(label[:14])}</text>'
        )
    ticks = "".join(
        f'<text x="{_L - 5}" y="{_T + y_at(v) + 4:.1f}" text-anchor="end" fill="{_AXIS}">'
        f"{_fmt(v)}</text>"
        for v in (y_lo, (y_lo + y_hi) / 2, y_hi)
    )
    description = "; ".join(f"{label}: {_fmt(value)}" for label, value in items)
    return _frame(title, description, "", y_label, "".join(body), ticks)
