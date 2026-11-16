"""RW-2: DFT-D4 combined totals keep their identity and are not promoted in comparisons."""

from __future__ import annotations

import copy

from chemdft_api.calculation_summary import summarize_result
from chemdft_api.models import new_id
from chemdft_api.scientific_models import CalculationResultRecord
from rw2_support import EVIDENCE, create_project, import_structure, seed_result

ENERGY = {"value": -75.0, "unit": {"standard": "QCSCHEMA", "code": "Eh", "dimension": "ENERGY"}}


def _d4_payload(version_id: str) -> dict:
    uncorrected, correction = -75.0, -0.0123
    return {
        "payload_schema": "chemdft.dispersion-corrected-energy",
        "payload_schema_version": "1.1.0",
        "functional": "b3lyp",
        "source": {
            "result_id": new_id(),
            "project_id": new_id(),
            "calculation_id": new_id(),
            "structure_version_id": version_id,
            "basis": "def2-svp",
            "functional": "b3lyp",
            "source_energy_hartree": uncorrected,
        },
        "uncorrected_dft_energy": {**ENERGY, "value": uncorrected},
        "d4_correction_energy": {**ENERGY, "value": correction},
        "corrected_total_energy": {**ENERGY, "value": uncorrected + correction},
    }


def _seed_d4(api):
    client, sessions, _settings = api
    project = create_project(client)
    version = import_structure(client, project)
    _calc, result = seed_result(
        sessions,
        project,
        version,
        "energy",
        result_type="chemdft.dispersion-corrected-energy",
        payload=_d4_payload(version),
        replace_payload=True,
        producer={"name": "dftd4", "version": "4.2.0"},
    )
    return client, sessions, project, version, result


def test_d4_summary_reports_the_combined_total_with_its_own_definition(api):
    _client, sessions, _project, version, result = _seed_d4(api)
    with sessions() as session:
        summary = summarize_result(session, session.get(CalculationResultRecord, result))
    kinds = {q.kind: q.value for q in summary.quantities}
    assert kinds == {"dispersion_corrected_total_energy": -75.0123, "d4_correction_energy": -0.0123}
    assert summary.method == "b3lyp" and summary.basis == "def2-svp"
    assert summary.dispersion and "D4" in summary.dispersion
    assert str(summary.structure.structure_version_id) == version
    # The source binding cannot be verified here, so the combined total is not current evidence.
    assert summary.evidence_use == "HISTORICAL_ONLY"
    assert summary.effective_state.verification_state == "UNVERIFIED"  # never promoted by agreement


def test_d4_total_is_not_comparable_with_an_uncorrected_dft_energy(api):
    client, sessions, project, version, d4 = _seed_d4(api)
    spec = {"method": {**EVIDENCE["energy"]["specification"]["method"], "identifier": "b3lyp"}}
    _, plain = seed_result(
        sessions,
        project,
        version,
        "energy",
        spec=spec,
        payload={"method": "b3lyp", "basis": "def2-svp"},
    )
    params = [("result_id", plain), ("result_id", d4)]
    pair = client.get(f"/v1/projects/{project}/calculation-comparison", params=params).json()[
        "pairs"
    ][0]
    assert pair["label"] == "NOT_SCIENTIFICALLY_COMPARABLE"
    assert {r["rule_id"]: r["outcome"] for r in pair["rules"]}["R5_LEVEL"] == "FAIL"
    assert any("dispersion" in text for text in pair["blockers"])
    assert pair["deltas"] == []
    assert copy.deepcopy(pair["evidence_standing"]) == "HISTORICAL_CONTEXT"
