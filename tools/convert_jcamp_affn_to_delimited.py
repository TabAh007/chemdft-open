#!/usr/bin/env python3
"""Deterministically convert an UNCOMPRESSED JCAMP-DX (X++(Y..Y)) spectrum to a tab-delimited text file with an explicit-unit header.

Purpose: prepare ONE real third-party infrared spectrum (NIST WebBook, gas-phase acetone) so it can exercise the PRODUCTION delimited-text
import path of the experimental spectra pipeline. This is NOT a JCAMP importer: ChemDFT V1 does not read JCAMP-DX. The input and the output
are third-party data under the source's own terms and must stay out of git; the script writes both SHA-256 hashes next to the output.

    python tools/convert_jcamp_affn_to_delimited.py <input.jdx> <output.tsv> [--lock <lock.json>]

Only fields the file itself reports are copied (title, state, units); nothing is inferred. Compressed forms (SQZ/DIF/DUP) are refused.
"""
# ruff: noqa: E501  (long human-readable lines)
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

UNIT_X = {"1/CM": "cm-1", "CM-1": "cm-1", "MICROMETERS": "um", "NANOMETERS": "nm"}
UNIT_Y = {"ABSORBANCE": "Absorbance", "TRANSMITTANCE": "Transmittance", "%TRANSMITTANCE": "%T"}
NUMBER = re.compile(r"^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$")


def parse(text: str) -> tuple[dict[str, str], list[tuple[float, float]]]:
    headers: dict[str, str] = {}
    rows: list[tuple[float, float]] = []
    in_data = False
    last = None
    for line in re.split(r"\r\n|\n|\r", text):
        if line.startswith("##"):
            key, _, value = line[2:].partition("=")
            key = re.sub(r"[\s_\-/]", "", key).upper()
            in_data = key == "XYDATA"
            last = key
            headers[key] = value.strip()
            continue
        if in_data:
            tokens = line.replace(",", " ").split()
            if not tokens:
                continue
            if any(not NUMBER.match(t) for t in tokens):
                raise SystemExit("compressed or non-numeric XYDATA is not supported by this converter")
            x0 = float(tokens[0])
            deltax = float(headers["DELTAX"])
            xfactor, yfactor = float(headers.get("XFACTOR", "1")), float(headers.get("YFACTOR", "1"))
            for k, token in enumerate(tokens[1:]):
                rows.append(((x0 + k * deltax) * xfactor, float(token) * yfactor))
        elif last and line.strip() and not line.startswith("$$"):
            headers[last] = headers.get(last, "") + " " + line.strip()
    if headers.get("XYDATA", "").replace(" ", "") != "(X++(Y..Y))":
        raise SystemExit(f"unsupported XYDATA form {headers.get('XYDATA')!r}")
    return headers, rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("input", type=Path)
    ap.add_argument("output", type=Path)
    ap.add_argument("--lock", type=Path)
    args = ap.parse_args()
    raw = args.input.read_bytes()
    headers, rows = parse(raw.decode("utf-8"))
    x_unit = UNIT_X.get(headers.get("XUNITS", "").upper())
    y_unit = UNIT_Y.get(headers.get("YUNITS", "").upper())
    if x_unit is None or y_unit is None:
        raise SystemExit(f"units XUNITS={headers.get('XUNITS')!r} YUNITS={headers.get('YUNITS')!r} are not recognised; nothing was converted")
    npoints = int(headers["NPOINTS"]) if "NPOINTS" in headers else None
    if npoints is not None and npoints != len(rows):
        raise SystemExit(f"NPOINTS={npoints} but {len(rows)} points were decoded")
    lines = []
    if headers.get("TITLE"):
        lines.append(f"Title: {headers['TITLE']}")
    if headers.get("STATE"):
        lines.append(f"State: {headers['STATE']}")
    lines.append(f"Converted from JCAMP-DX {headers.get('JCAMPDX', '')} by tools/convert_jcamp_affn_to_delimited.py (values copied, none inferred)".strip())
    lines.append(f"Wavenumber ({x_unit})\t{y_unit}")
    lines += [f"{x:.4f}\t{y:.9g}" for x, y in rows]
    out = ("\n".join(lines) + "\n").encode("utf-8")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(out)
    record = {
        "converter": "tools/convert_jcamp_affn_to_delimited.py",
        "source_file": args.input.name,
        "source_sha256": hashlib.sha256(raw).hexdigest(),
        "source_bytes": len(raw),
        "output_file": args.output.name,
        "output_sha256": hashlib.sha256(out).hexdigest(),
        "output_bytes": len(out),
        "points": len(rows),
        "x_unit_in_output": x_unit,
        "y_unit_in_output": y_unit,
        "x_range": [rows[0][0], rows[-1][0]],
        "third_party_notice": "The input and output are third-party data (see the source's terms). Do not commit them.",
    }
    print(json.dumps(record, indent=2))
    if args.lock:
        args.lock.write_text(json.dumps(record, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
