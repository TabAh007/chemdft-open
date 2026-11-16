"""Helpers for the experimental spectra API tests.

All spectra here are ChemDFT-authored, deterministic text (pure Python: the API environment never imports numpy). No third-party
data is committed. The real isolated worker (services/spectra-worker) runs by default; tests skip when its environment is absent.
"""
# ruff: noqa: E501  (long evidence strings and human-readable diagnostics)
from __future__ import annotations

import hashlib
import random
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
WORKER_PYTHON = REPO / "services/spectra-worker/.venv/bin/python"
requires_spectra_worker = pytest.mark.skipif(not WORKER_PYTHON.is_file(), reason="spectra-worker environment is not installed (uv sync --project services/spectra-worker)")

IR_PEAKS = ((1715.0, 18.0, 0.9), (1220.0, 24.0, 0.5), (2960.0, 40.0, 0.3))


def lorentz(x: float, centre: float, fwhm: float, height: float) -> float:
    half = fwhm / 2
    return height * half * half / ((x - centre) ** 2 + half * half)


def frange(start: float, stop: float, step: float) -> list[float]:
    count = round((stop - start) / step) + 1
    return [start + step * i for i in range(count)]


def ir_values(peaks=IR_PEAKS, step: float = 4.0, noise: float = 0.002, baseline: bool = True, seed: int = 11) -> tuple[list[float], list[float]]:
    rng = random.Random(seed)
    xs = frange(400.0, 4000.0, step)
    ys = [sum(lorentz(x, c, w, h) for c, w, h in peaks) + ((0.05 + 4e-5 * (x - 400)) if baseline else 0.0) + rng.gauss(0, noise) for x in xs]
    return xs, ys


def ir_text(header: str | None = "Wavenumber (cm-1),Absorbance", delimiter: str = ",", descending: bool = False, **kwargs) -> bytes:
    xs, ys = ir_values(**kwargs)
    rows = list(zip(xs, ys, strict=True))
    if descending:
        rows.reverse()
    body = "\n".join(f"{x:.4f}{delimiter}{y:.6f}" for x, y in rows) + "\n"
    return ((header + "\n") if header else "").encode() + body.encode()


def raman_text(laser_line: str | None = "Laser wavelength: Not supplied") -> bytes:
    rng = random.Random(5)
    xs = frange(100.0, 3200.0, 2.0)
    peaks = ((787.0, 9.0, 2500.0), (1710.0, 12.0, 900.0), (2925.0, 20.0, 1400.0))
    ys = [800 + 0.05 * x + sum(lorentz(x, c, w, h) for c, w, h in peaks) + rng.gauss(0, 15) for x in xs]
    head = "Sample: example liquid\nInstrument: bench Raman\n" + (laser_line + "\n" if laser_line else "") + "Raman shift (cm^-1)\tIntensity (counts)\n"
    return (head + "\n".join(f"{x:.3f}\t{y:.2f}" for x, y in zip(xs, ys, strict=True)) + "\n").encode()


def uv_text(f: float = 0.042, header: str = "Wavelength (nm),Cross section (cm^2/molecule)") -> bytes:
    """Gaussian absorption band (area-normalised in cm^-1) so that its oscillator strength is `f`."""
    import math

    rng = random.Random(3)
    xs = frange(200.0, 400.0, 0.1)
    width = 2000.0
    centre = 1e7 / 280.0
    f_per = 1.1296e12
    rows = []
    for nm in xs:
        nu = 1e7 / nm
        shape = math.exp(-0.5 * ((nu - centre) / width) ** 2) / (width * math.sqrt(2 * math.pi))
        rows.append(f"{nm:.2f},{(f / f_per) * shape + rng.gauss(0, 1e-24):.6e}")
    return (header + "\n" + "\n".join(rows) + "\n").encode()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def upload(client, project_id: str, data: bytes, technique: str = "IR", name: str = "acetone.csv", key: str = "spectrum-key-0001"):
    return client.post(
        f"/v1/projects/{project_id}/experimental/spectra/uploads",
        files={"upload": (name, data, "text/plain")},
        data={"technique": technique, "idempotency_key": key},
    )


def resolve(client, project_id: str, upload_id: str, choices: dict):
    return client.post(f"/v1/projects/{project_id}/experimental/spectra/uploads/{upload_id}/resolve", json={"choices": choices})


def confirm(client, project_id: str, upload_id: str, preview_sha256: str, key: str = "confirm-key-0001", association: dict | None = None):
    body = {"preview_sha256": preview_sha256, "idempotency_key": key}
    if association:
        body["association"] = association
    return client.post(f"/v1/projects/{project_id}/experimental/spectra/uploads/{upload_id}/confirm", json=body)


def import_spectrum(client, project_id: str, data: bytes, technique: str = "IR", name: str = "acetone.csv", key: str = "spectrum-key-0001", choices: dict | None = None, association: dict | None = None) -> dict:
    """Upload -> (resolve with choices) -> confirm. Returns the RAW dataset view."""
    response = upload(client, project_id, data, technique, name, key)
    assert response.status_code == 201, response.text
    view = response.json()
    if choices is not None:
        response = resolve(client, project_id, view["id"], choices)
        assert response.status_code == 200, response.text
        view = response.json()
    preview = view["latest_preview"]
    assert preview["status"] == "READY", preview["body"]["diagnostics"]
    response = confirm(client, project_id, view["id"], preview["preview_sha256"], f"confirm-{key}", association)
    assert response.status_code == 201, response.text
    return response.json()


def transform(client, project_id: str, dataset_id: str, op: str, parameters: dict | None = None, key: str | None = None, display_name: str | None = None):
    body = {"op": op, "parameters": parameters or {}, "idempotency_key": key or f"tr-{dataset_id[:8]}-{op}-{hash(str(parameters)) & 0xFFFF}"}
    if display_name:
        body["display_name"] = display_name
    return client.post(f"/v1/projects/{project_id}/experimental/spectra/datasets/{dataset_id}/transforms", json=body)


def peaks(client, project_id: str, dataset_id: str, parameters: dict, key: str | None = None):
    return client.post(
        f"/v1/projects/{project_id}/experimental/spectra/datasets/{dataset_id}/peaks",
        json={"parameters": parameters, "idempotency_key": key or f"pk-{dataset_id[:8]}-{hash(str(parameters)) & 0xFFFF}"},
    )


def report_with_excitations(data: bytes, raman: bool = False) -> dict:
    """The External Import synthetic report plus a contract-valid imported excitations entry (numbers are made up; plumbing only)."""
    from chemdft_import_worker import NORMALIZATION_VERSION
    from chemdft_import_worker.report import finalize
    from external_import_support import synthetic_report

    report = synthetic_report(data, raman=raman)
    body = report["body"]

    def state(index: int, raw_cm1: float, f: float) -> dict:
        return {
            "index": index, "source_state_number": index + 1, "spin_label": "singlet", "spin_multiplicity": 1, "symmetry": None, "source_label": None,
            "energy_cm1_raw": raw_cm1, "energy_hartree": raw_cm1 / 219474.6313708, "energy_ev": raw_cm1 / 8065.54429, "wavelength_nm": 1e7 / raw_cm1,
            "oscillator_strength": f, "transitions": [], "transitions_truncated": False,
        }

    body["results"].append(
        {
            "result_type": "chemdft.imported.excitations", "source_attributes": ["etenergies", "etoscs"], "source_locators": {},
            "payload": {
                "payload_schema": "chemdft.imported.excitations", "payload_schema_version": "1.0.0", "source_class": "IMPORTED",
                "source": {"program": "Gaussian", "program_label": "Gaussian 16 Rev C.01"}, "normalization_version": NORMALIZATION_VERSION, "source_attributes": ["etenergies", "etoscs"],
                "state_count": 3, "method": "TD-DFT", "ordering": "as reported by the program",
                "states": [state(0, 1e7 / 281.0, 0.0004), state(1, 1e7 / 215.0, 0.0023), state(2, 1e7 / 190.0, 0.31)],
                "spin_semantics": "labels as reported", "oscillator_strength_gauge": "as reported", "transition_amplitudes_note": "not used", "energy_precision_note": "as reported",
                "energy_conversion": {"hartree": "cclib.cm-1->Eh/1", "ev": "cclib.cm-1->eV/1", "wavelength": "cm-1->nm/1"}, "transition_dipoles": "not reported",
            },
        }
    )
    return finalize(body)
