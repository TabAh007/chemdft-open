"""RW-2 calculation comparison: comparability rules, arithmetic, history, authorization."""

from __future__ import annotations

import csv
import io
import math
from uuid import uuid4

import numpy as np
import pytest
from rw2_support import (
    EVIDENCE,
    METHANE_XYZ,
    WATER_SHIFTED_XYZ,
    create_project,
    import_structure,
    retract,
    seed_result,
    supersede,
)

KCAL = 2625.4996394799 / 4.184
KJ = 2625.4996394799


def energy_payload(value: float) -> dict:
    stored = EVIDENCE["energy"]["payload"]
    return {"total_energy": {**stored["total_energy"], "value": value}}


def compare(client, project, *result_ids):
    return client.get(
        f"/v1/projects/{project}/calculation-comparison",
        params=[("result_id", r) for r in result_ids],
    )


def rules(pair) -> dict[str, str]:
    return {r["rule_id"]: r["outcome"] for r in pair["rules"]}


@pytest.fixture
def lab(api):
    client, sessions, _settings = api
    project = create_project(client)
    version = import_structure(client, project)
    return client, sessions, project, version


def test_identical_level_and_geometry_is_directly_comparable_with_exact_arithmetic(lab):
    client, sessions, project, version = lab
    base = EVIDENCE["energy"]["payload"]["total_energy"]["value"]
    _, a = seed_result(sessions, project, version, "energy")
    _, b = seed_result(
        sessions, project, version, "energy", payload=energy_payload(base - 0.0123456789)
    )
    response = compare(client, project, a, b)
    assert response.status_code == 200, response.text
    body = response.json()
    pair = body["pairs"][0]
    assert pair["label"] == body["overall"] == "DIRECTLY_COMPARABLE"
    assert (
        set(rules(pair).values()) == {"PASS"}
        and pair["blockers"] == []
        and pair["limitations"] == []
    )
    assert (
        pair["evidence_standing"] == "CURRENT"
        and pair["geometry"]["relation"] == "IDENTICAL_STRUCTURE_VERSION"
    )
    delta = pair["deltas"][0]
    assert delta["unit"] == "Eh" and delta["reference_value"] == base
    assert delta["delta"] == pytest.approx(-0.0123456789, abs=1e-12)  # other minus reference
    assert delta["delta_kcal_per_mol"] == pytest.approx(delta["delta"] * KCAL, rel=1e-12)
    assert delta["delta_kj_per_mol"] == pytest.approx(delta["delta"] * KJ, rel=1e-12)
    assert (
        body["delta_convention"] == "other minus reference"
        and body["agreement_is_not_verification"] is True
    )
    assert body["conversion_factors"]["kJ/mol per Eh"] == KJ


def test_reference_is_the_first_selection(lab):
    client, sessions, project, version = lab
    _, a = seed_result(sessions, project, version, "energy")
    _, b = seed_result(sessions, project, version, "energy", payload=energy_payload(-70.0))
    forward = compare(client, project, a, b).json()["pairs"][0]["deltas"][0]["delta"]
    backward = compare(client, project, b, a).json()["pairs"][0]["deltas"][0]["delta"]
    assert forward == pytest.approx(-backward, abs=1e-12)


def test_agreement_never_changes_verification_state(lab):
    client, sessions, project, version = lab
    _, a = seed_result(sessions, project, version, "energy")
    _, b = seed_result(sessions, project, version, "energy")  # bit-identical energies
    body = compare(client, project, a, b).json()
    assert body["pairs"][0]["deltas"][0]["delta"] == 0.0
    assert [s["effective_state"]["verification_state"] for s in body["results"]] == [
        "UNVERIFIED",
        "UNVERIFIED",
    ]
    assert "not independent verification" in body["notice"].lower()


def test_different_geometry_is_limited_and_reports_rmsd(lab):
    client, sessions, project, version = lab
    other_version = import_structure(client, project, WATER_SHIFTED_XYZ, "water-stretched")
    _, a = seed_result(sessions, project, version, "energy")
    _, b = seed_result(sessions, project, other_version, "energy", payload=energy_payload(-75.0))
    pair = compare(client, project, a, b).json()["pairs"][0]
    assert (
        pair["label"] == "COMPARABLE_WITH_LIMITATIONS"
        and rules(pair)["R7_GEOMETRY"] == "LIMITATION"
    )
    assert pair["geometry"]["relation"] == "SAME_ATOM_ORDER_DIFFERENT_COORDINATES"
    # one O-H bond stretched by 0.1 angstrom: RMSD is a small, positive, plausible number
    assert 0.01 < pair["geometry"]["rmsd_angstrom"] < 0.1
    assert any("not an energy change at a fixed geometry" in text for text in pair["limitations"])
    assert pair["deltas"] and all(
        "Limitation:" in " ".join(d["assumptions"]) for d in pair["deltas"]
    )


def test_rigidly_rotated_identical_geometry_is_recognised_as_the_same_geometry(lab):
    client, sessions, project, version = lab
    theta = math.radians(40)
    rot = np.array(
        [[math.cos(theta), -math.sin(theta), 0], [math.sin(theta), math.cos(theta), 0], [0, 0, 1]]
    )
    atoms = [("O", (0.0, 0.0, 0.0)), ("H", (0.0, 0.0, 0.9572)), ("H", (0.926627, 0.0, -0.239987))]
    lines = [
        "3",
        "water rotated",
        *(f"{e} {' '.join(f'{c:.9f}' for c in rot @ np.array(xyz) + 3.0)}" for e, xyz in atoms),
    ]
    rotated = import_structure(client, project, ("\n".join(lines) + "\n").encode(), "water-rotated")
    _, a = seed_result(sessions, project, version, "energy")
    _, b = seed_result(sessions, project, rotated, "energy")
    pair = compare(client, project, a, b).json()["pairs"][0]
    assert pair["geometry"]["rmsd_angstrom"] < 1e-6 and rules(pair)["R7_GEOMETRY"] == "PASS"
    assert pair["label"] == "DIRECTLY_COMPARABLE"


def test_cross_engine_at_the_same_stated_level_is_limited_not_direct(lab):
    client, sessions, project, version = lab
    _, a = seed_result(sessions, project, version, "energy")
    _, b = seed_result(
        sessions, project, version, "energy", producer={"name": "psi4", "version": "1.11"}
    )
    pair = compare(client, project, a, b).json()["pairs"][0]
    assert (
        pair["label"] == "COMPARABLE_WITH_LIMITATIONS" and rules(pair)["R6_ENGINE"] == "LIMITATION"
    )
    assert any("would not be independent verification" in text for text in pair["limitations"])


def test_xtb_and_psi4_total_energies_are_not_comparable(lab):
    client, sessions, project, version = lab
    xtb_spec = {
        "method": {**EVIDENCE["energy"]["specification"]["method"], "identifier": "gfn2-xtb"},
        "basis": None,
    }
    _, psi4 = seed_result(
        sessions, project, version, "energy", producer={"name": "psi4", "version": "1.11"}
    )
    _, xtb = seed_result(
        sessions,
        project,
        version,
        "energy",
        spec=xtb_spec,
        payload={**energy_payload(-5.07), "method": "gfn2-xtb", "basis": None},
        producer={"name": "xtb", "version": "6.7.1"},
    )
    body = compare(client, project, psi4, xtb).json()
    pair = body["pairs"][0]
    assert pair["label"] == body["overall"] == "NOT_SCIENTIFICALLY_COMPARABLE"
    assert (
        rules(pair)["R5_LEVEL"] == "FAIL" and pair["deltas"] == []
    )  # no arithmetic difference is formed
    assert any("no common energy zero" in text for text in pair["blockers"])


@pytest.mark.parametrize(
    ("override", "rule"),
    [({"charge": 1}, "R3_CHARGE"), ({"multiplicity": 3}, "R4_MULTIPLICITY")],
)
def test_electronic_state_mismatch_blocks_comparison(lab, override, rule):
    client, sessions, project, version = lab
    _, a = seed_result(sessions, project, version, "energy")
    _, b = seed_result(sessions, project, version, "energy", **override)
    pair = compare(client, project, a, b).json()["pairs"][0]
    assert (
        pair["label"] == "NOT_SCIENTIFICALLY_COMPARABLE"
        and rules(pair)[rule] == "FAIL"
        and pair["deltas"] == []
    )


def test_different_molecules_are_not_comparable(lab):
    client, sessions, project, version = lab
    methane = import_structure(client, project, METHANE_XYZ, "methane")
    _, a = seed_result(sessions, project, version, "energy")
    _, b = seed_result(sessions, project, methane, "energy")
    body = compare(client, project, a, b).json()
    pair = body["pairs"][0]
    assert pair["label"] == "NOT_SCIENTIFICALLY_COMPARABLE" and rules(pair)["R2_MOLECULE"] == "FAIL"
    assert {s["structure"]["formula_hill"] for s in body["results"]} == {"H2O", "CH4"}


def test_different_basis_blocks_total_energy_arithmetic(lab):
    client, sessions, project, version = lab
    spec = {"basis": {**EVIDENCE["energy"]["specification"]["basis"], "identifier": "6-31g"}}
    _, a = seed_result(sessions, project, version, "energy")
    _, b = seed_result(sessions, project, version, "energy", spec=spec, payload={"basis": "6-31g"})
    pair = compare(client, project, a, b).json()["pairs"][0]
    assert pair["label"] == "NOT_SCIENTIFICALLY_COMPARABLE" and rules(pair)["R5_LEVEL"] == "FAIL"


@pytest.mark.parametrize("change", [supersede, retract])
def test_inactive_evidence_keeps_history_but_is_never_current(lab, change):
    client, sessions, project, version = lab
    _, a = seed_result(sessions, project, version, "energy")
    _, b = seed_result(sessions, project, version, "energy", payload=energy_payload(-70.5))
    change(sessions, b)
    body = compare(client, project, a, b).json()
    pair = body["pairs"][0]
    assert (
        pair["evidence_standing"] == "HISTORICAL_CONTEXT"
        and rules(pair)["R1_STATE"] == "LIMITATION"
    )
    assert pair["label"] == "COMPARABLE_WITH_LIMITATIONS"
    assert pair["deltas"][0]["other_value"] == -70.5  # recorded value retained for context
    inactive = next(s for s in body["results"] if s["result_id"] == b)
    assert (
        inactive["evidence_use"] == "HISTORICAL_ONLY"
        and inactive["effective_state"]["authority"] == "CANDIDATE"
    )
    assert inactive["effective_state"]["stored_authority"] == "AUTHORITATIVE"
    assert "Historical result" in " ".join(pair["limitations"])


def test_properties_beyond_energy_are_compared_with_their_own_units(lab):
    client, sessions, project, version = lab
    _, a = seed_result(sessions, project, version, "mo")
    _, b = seed_result(sessions, project, version, "mo")
    pair = compare(client, project, a, b).json()["pairs"][0]
    kinds = {d["quantity_kind"]: d for d in pair["deltas"]}
    assert {
        "total_electronic_energy",
        "homo_energy:restricted",
        "lumo_energy:restricted",
        "homo_lumo_gap:restricted",
    } <= set(kinds)
    frontier = EVIDENCE["mo"]["payload"]["frontier_by_spin"][0]
    assert kinds["homo_energy:restricted"]["reference_value"] == frontier["homo_energy_hartree"]
    assert kinds["homo_lumo_gap:restricted"]["unit"] == "Eh"


def test_thermochemistry_conditions_must_match_for_thermal_quantities(lab):
    client, sessions, project, version = lab
    hot = {k: dict(v) for k, v in EVIDENCE["thermo"]["payload"].items() if k == "conditions"}
    hot["conditions"]["temperature_k"] = 500.0
    _, a = seed_result(sessions, project, version, "thermo")
    _, b = seed_result(sessions, project, version, "thermo", payload=hot)
    pair = compare(client, project, a, b).json()["pairs"][0]
    assert rules(pair)["R8_THERMO"] == "LIMITATION"
    kinds = {d["quantity_kind"] for d in pair["deltas"]}
    assert kinds == {
        "total_electronic_energy"
    }  # ZPE/H/G omitted rather than compared across conditions
    _, plain = seed_result(sessions, project, version, "mo")
    mixed = compare(client, project, a, plain).json()["pairs"][0]
    # a non-thermochemistry partner has no thermal quantity to omit
    assert "R8_THERMO" not in rules(mixed)
    _, c = seed_result(sessions, project, version, "thermo")
    same = compare(client, project, a, c).json()["pairs"][0]
    assert {"gibbs_free_energy", "enthalpy", "zero_point_energy"} <= {
        d["quantity_kind"] for d in same["deltas"]
    }


def test_three_way_comparison_uses_one_reference_and_reports_the_weakest_label(lab):
    client, sessions, project, version = lab
    methane = import_structure(client, project, METHANE_XYZ, "methane")
    _, a = seed_result(sessions, project, version, "energy")
    _, b = seed_result(sessions, project, version, "energy", payload=energy_payload(-70.0))
    _, c = seed_result(sessions, project, methane, "energy")
    body = compare(client, project, a, b, c).json()
    assert [p["label"] for p in body["pairs"]] == [
        "DIRECTLY_COMPARABLE",
        "NOT_SCIENTIFICALLY_COMPARABLE",
    ]
    assert body["overall"] == "NOT_SCIENTIFICALLY_COMPARABLE" and body["reference_result_id"] == a


# ------------------------------------------------------------------- validation / authorization


def test_selection_limits_and_malformed_ids(lab):
    client, sessions, project, version = lab
    ids = [seed_result(sessions, project, version, "energy")[1] for _ in range(9)]
    assert compare(client, project, ids[0]).status_code == 422
    assert compare(client, project, ids[0], ids[0]).status_code == 422
    assert compare(client, project, *ids).status_code == 422  # nine exceeds the maximum of eight
    assert compare(client, project, ids[0], "not-a-uuid").status_code == 422
    assert compare(client, project, *ids[:8]).status_code == 200


def test_results_of_another_project_are_indistinguishable_from_missing(lab):
    client, sessions, project, version = lab
    other = create_project(client, "other")
    other_version = import_structure(client, other)
    _, mine = seed_result(sessions, project, version, "energy")
    _, theirs = seed_result(sessions, other, other_version, "energy")
    foreign = compare(client, project, mine, theirs)
    missing = compare(client, project, mine, str(uuid4()))
    assert foreign.status_code == missing.status_code == 404 and foreign.json() == missing.json()
    assert compare(client, str(uuid4()), mine, theirs).status_code == 404
    assert (
        client.get(f"/v1/projects/{other}/calculation-comparison/candidates").json()["candidates"][
            0
        ]["summary"]["result_id"]
        == theirs
    )
    ids = {
        c["summary"]["result_id"]
        for c in client.get(f"/v1/projects/{project}/calculation-comparison/candidates").json()[
            "candidates"
        ]
    }
    assert ids == {mine}


def test_candidates_list_only_results_with_comparable_quantities(lab):
    client, sessions, project, version = lab
    seed_result(sessions, project, version, "energy")
    seed_result(sessions, project, version, "vib_ir")
    candidates = client.get(f"/v1/projects/{project}/calculation-comparison/candidates").json()[
        "candidates"
    ]
    assert {c["summary"]["result_type"] for c in candidates} == {
        "chemdft.energy",
        "chemdft.vibrational-analysis",
    }
    assert all(c["summary"]["quantities"] and c["summary"]["effective_state"] for c in candidates)


def test_comparison_export_csv_and_json_carry_limits_and_units(lab):
    client, sessions, project, version = lab
    _, a = seed_result(sessions, project, version, "energy")
    _, b = seed_result(
        sessions,
        project,
        version,
        "energy",
        payload=energy_payload(-70.0),
        producer={"name": "psi4", "version": "1.11"},
    )
    params = [("result_id", a), ("result_id", b)]
    csv_response = client.get(
        f"/v1/projects/{project}/calculation-comparison/export", params=[*params, ("format", "csv")]
    )
    assert csv_response.status_code == 200 and csv_response.headers["content-type"].startswith(
        "text/csv"
    )
    assert 'filename="calculation-comparison.csv"' in csv_response.headers["content-disposition"]
    comments = [line for line in csv_response.text.splitlines() if line.startswith("#")]
    assert any("LIMITATION" in line and "Different engines" in line for line in comments)
    assert any("verification=UNVERIFIED" in line for line in comments)
    rows = list(
        csv.reader(
            io.StringIO(
                "\n".join(
                    line for line in csv_response.text.splitlines() if not line.startswith("#")
                )
            )
        )
    )
    header, first = rows[0], dict(zip(rows[0], rows[1], strict=True))
    assert "delta_other_minus_reference" in header and first["unit"] == "Eh"
    assert float(first["delta_kcal_per_mol"]) == pytest.approx(
        float(first["delta_other_minus_reference"]) * KCAL
    )
    assert first["comparability"] == "COMPARABLE_WITH_LIMITATIONS"
    json_response = client.get(
        f"/v1/projects/{project}/calculation-comparison/export",
        params=[*params, ("format", "json")],
    )
    assert json_response.json()["pairs"][0]["label"] == "COMPARABLE_WITH_LIMITATIONS"
    assert (
        client.get(
            f"/v1/projects/{project}/calculation-comparison/export",
            params=[*params, ("format", "pdf")],
        ).status_code
        == 422
    )
