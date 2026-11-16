#!/usr/bin/env python3
"""Drive the Experimental Spectra V1 acceptance scenario through the HTTP API of an ISOLATED stack and write a JSON report.

Never point this at the persistent dev API or at a frozen acceptance project. It imports real third-party spectra from
`.chemdft/experimental-fixtures` (not committed), creates versions, peaks and comparisons, and prints dataset ids, hashes and
comparison results for the acceptance record.

    python tools/experimental_spectra_acceptance.py --api http://127.0.0.1:8100 --project <id> \
        --calculations .chemdft/experimental-spectra-acceptance/acetone-calculations.json --out report.json
"""

# ruff: noqa: E501  (long human-readable lines)
from __future__ import annotations

import argparse
import glob
import hashlib
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / ".chemdft/experimental-fixtures"


class Api:
    def __init__(self, base: str) -> None:
        if base.rstrip("/").endswith(":8000"):
            raise SystemExit(
                "Refusing to write acceptance records into the persistent dev API (port 8000)."
            )
        self.base = base.rstrip("/")

    def call(
        self,
        method: str,
        path: str,
        body: object | None = None,
        form: dict | None = None,
        files: dict | None = None,
    ) -> dict:
        headers, data = {}, None
        if body is not None:
            data, headers = json.dumps(body).encode(), {"content-type": "application/json"}
        elif form is not None:
            boundary = hashlib.sha256(json.dumps(sorted(form.items())).encode()).hexdigest()[:32]
            parts = [
                f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
                for k, v in form.items()
            ]
            for k, (name, content) in (files or {}).items():
                parts.append(
                    f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"; filename="{name}"\r\nContent-Type: text/plain\r\n\r\n'.encode()
                    + content
                    + b"\r\n"
                )
            parts.append(f"--{boundary}--\r\n".encode())
            data, headers = (
                b"".join(parts),
                {"content-type": f"multipart/form-data; boundary={boundary}"},
            )
        request = urllib.request.Request(
            self.base + path, data=data, method=method, headers=headers
        )
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            raise SystemExit(
                f"{method} {path} -> {error.code}: {error.read()[:500].decode()}"
            ) from error


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def import_file(
    api: Api, project: str, technique: str, name: str, data: bytes, choices: dict | None
) -> dict:
    spectra = f"/v1/projects/{project}/experimental/spectra"
    upload = api.call(
        "POST",
        f"{spectra}/uploads",
        form={
            "technique": technique,
            "idempotency_key": f"acc-upload-{sha(data)[:24]}-{technique}",
        },
        files={"upload": (name, data)},
    )
    needs_before = upload["previews"][0]["needs"]
    if (
        upload["state"] == "IMPORTED"
    ):  # a rerun: the upload was confirmed earlier with the same deterministic keys
        dataset = api.call("GET", f"{spectra}/datasets/{upload['dataset_id']}")
        return {
            "dataset": dataset,
            "needs_before_confirmation": needs_before,
            "preview_sha256": dataset["source"]["preview_sha256"],
            "source_sha256": sha(data),
        }
    if choices:
        upload = api.call(
            "POST", f"{spectra}/uploads/{upload['id']}/resolve", body={"choices": choices}
        )
    preview = upload["latest_preview"]
    if preview["status"] != "READY":
        raise SystemExit(
            f"{name}: preview is {preview['status']}: {preview['body']['diagnostics']}"
        )
    dataset = api.call(
        "POST",
        f"{spectra}/uploads/{upload['id']}/confirm",
        body={
            "preview_sha256": preview["preview_sha256"],
            "idempotency_key": f"acc-confirm-{preview['preview_sha256'][:24]}",
        },
    )
    return {
        "dataset": dataset,
        "needs_before_confirmation": needs_before,
        "preview_sha256": preview["preview_sha256"],
        "source_sha256": sha(data),
    }


def summarize(dataset: dict) -> dict:
    return {
        "id": dataset["id"],
        "name": dataset["name"],
        "technique": dataset["technique"],
        "kind": dataset["kind"],
        "state": dataset["state"],
        "authority": dataset["authority"],
        "points": dataset["point_count"],
        "x_range": [dataset["x_min"], dataset["x_max"]],
        "x_unit": dataset["x"]["definition"]["unit"]["code"],
        "x_evidence": dataset["x"]["unit_evidence"],
        "y_quantity": dataset["y"]["quantity"],
        "y_unit": dataset["y"]["definition"]["unit"]["code"],
        "y_evidence": dataset["y"]["unit_evidence"],
        "arrays_sha256": dataset["arrays_sha256"],
        "provenance_record_id": dataset["provenance_record_id"],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", required=True)
    ap.add_argument("--project", required=True)
    ap.add_argument("--calculations", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    api, project = Api(args.api), args.project
    spectra = f"/v1/projects/{project}/experimental/spectra"
    calc = json.loads(args.calculations.read_text())
    report: dict = {"project": project, "calculations": calc, "spectra": {}, "comparisons": {}}

    def process(
        label: str,
        technique: str,
        file: Path,
        choices: dict | None,
        baseline: dict,
        sigma: float,
        association: dict | None = None,
    ) -> tuple[dict, dict, dict]:
        data = file.read_bytes()
        imported = import_file(api, project, technique, file.name, data, choices)
        raw = imported["dataset"]
        if association:
            api.call("PUT", f"{spectra}/datasets/{raw['id']}/association", body=association)
        corrected = api.call(
            "POST",
            f"{spectra}/datasets/{raw['id']}/transforms",
            body={
                "op": baseline["op"],
                "parameters": baseline["parameters"],
                "idempotency_key": f"acc-{label}-baseline",
            },
        )
        found = api.call(
            "POST",
            f"{spectra}/datasets/{corrected['id']}/peaks",
            body={
                "parameters": {"prominence_sigma": sigma},
                "idempotency_key": f"acc-{label}-peaks",
            },
        )
        before = api.call("GET", f"{spectra}/datasets/{raw['id']}")
        report["spectra"][label] = {
            "source_file": file.name,
            "source_sha256": imported["source_sha256"],
            "needs_before_confirmation": imported["needs_before_confirmation"],
            "preview_sha256": imported["preview_sha256"],
            "raw": summarize(before),
            "raw_unchanged_after_processing": before["arrays_sha256"] == raw["arrays_sha256"],
            "baseline": {
                **summarize(corrected),
                "op": corrected["transform"]["op"],
                "library": f"{corrected['transform']['library']} {corrected['transform']['library_version']}",
                "record_sha256": corrected["transform"]["record_sha256"],
                "input_sha256": corrected["transform"]["input"]["artifact_sha256"],
                "output_sha256": corrected["transform"]["output"]["artifact_sha256"],
                "warnings": [w["code"] for w in corrected["transform"]["warnings"]],
            },
            "peaks": {
                **summarize(found),
                "count": found["peak_set"]["peak_count"],
                "record_sha256": found["peak_set"]["record_sha256"],
                "library": f"{found['peak_set']['library']} {found['peak_set']['library_version']}",
                "strongest": [
                    round(p["x"], 2)
                    for p in sorted(found["peak_set"]["peaks"], key=lambda q: -q["prominence"])[:8]
                ],
            },
        }
        return raw, corrected, found

    nist = FIXTURES / "derived/nist-ir-acetone-gas.tsv"
    _, ir_corrected, ir_peaks = process(
        "ir_nist_gas",
        "IR",
        nist,
        None,
        {"op": "baseline.snip", "parameters": {"half_window_x": 150}},
        10.0,
        {"state": "ASSOCIATED_WITH_STRUCTURE", "structure_id": calc["structure"]},
    )
    raman_file = Path(glob.glob(str(FIXTURES / "opara-raman-acetone/ace_h2o_ace_pure_1.txt"))[0])
    process(
        "raman_liquid",
        "RAMAN",
        raman_file,
        {"x_unit": "cm^-1", "y_quantity": "INTENSITY", "y_unit": "arbitrary"},
        {"op": "baseline.snip", "parameters": {"half_window_x": 200}},
        20.0,
        {"state": "ASSOCIATED_WITH_SAMPLE", "sample_label": "acetone, pure liquid, 25 C"},
    )
    uv_file = Path(glob.glob(str(FIXTURES / "mainz-uv-acetone/*.txt"))[0])
    _, uv_corrected, uv_peaks = process(
        "uv_gas",
        "UVVIS",
        uv_file,
        {"x_unit": "nm", "y_quantity": "CROSS_SECTION", "y_unit": "cm^2/molecule"},
        {"op": "baseline.offset", "parameters": {"percentile": 0}},
        10.0,
    )

    def compare(
        label: str, experimental: dict, peak_set: dict, source_id: str, **extra: object
    ) -> dict:
        body = {
            "experimental_dataset_id": experimental["id"],
            "peak_set_dataset_id": peak_set["id"],
            "calculated": {"kind": "CALCULATION_RESULT", "id": source_id},
            "idempotency_key": f"acc-compare-{label}",
            **extra,
        }
        view = api.call("POST", f"{spectra}/comparisons", body=body)
        report["comparisons"][label] = {
            "id": view["id"],
            "record_sha256": view["record_sha256"],
            "technique": view["technique"],
            "tolerance": view["tolerance"],
            "axis": view["axis"],
            "scaling": view["scaling"],
            "calculated": {
                k: view["calculated"][k] for k in ("kind", "id", "label", "phase", "item_count")
            },
            "experimental_phase": view["experimental_phase"],
            "metrics": {
                k: view["metrics"][k]
                for k in (
                    "matched",
                    "experimental_peaks",
                    "calculated_considered",
                    "calculated_total",
                    "unmatched_calculated",
                    "unmatched_experimental",
                    "ambiguous_pairs",
                    "signed_bias",
                    "mae",
                    "rmse",
                    "max_abs_delta",
                )
            },
            "pairs": [
                {
                    "calculated_index": p["calculated_index"],
                    "calculated": round(p["calculated_position"], 2),
                    "experimental": round(p["experimental_position"], 2),
                    "delta": round(p["delta"], 2),
                    "status": p["status"],
                }
                for p in view["pairs"]
            ],
            "bands": [
                {
                    "band_nm": [b["lo_nm"], b["hi_nm"]],
                    "f_calculated": b["f_calculated_sum"],
                    "f_experimental": (b["experimental"] or {}).get("f"),
                }
                for b in view["bands"]
            ],
            "diagnostics": [d["code"] for d in view["diagnostics"]],
            "provenance_record_id": view["provenance_record_id"],
        }
        return view

    compare(
        "ir_unscaled",
        ir_corrected,
        ir_peaks,
        calc["frequency_result"],
        tolerance=40.0,
        axis="cm^-1",
    )
    compare(
        "ir_user_scale_0.97",
        ir_corrected,
        ir_peaks,
        calc["frequency_result"],
        tolerance=40.0,
        axis="cm^-1",
        scaling={"mode": "USER_FACTOR", "factor": 0.97},
    )
    compare(
        "uv_tddft",
        uv_corrected,
        uv_peaks,
        calc["tddft_result"],
        tolerance=0.3,
        axis="eV",
        bands=[{"label": "n-pi*", "lo_nm": 230.0, "hi_nm": 340.0}],
    )
    args.out.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: v for k, v in report["comparisons"].items()}, indent=2)[:6000])
    return 0


if __name__ == "__main__":
    sys.exit(main())
