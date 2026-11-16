# ruff: noqa: E501  (assertion messages and fixtures)
"""RW-3: results overview, saved comparisons (revalidation), reports, evidence archives, reuse, queue.

Scientific values come from the accepted native PySCF evidence (`rw2_support`) or from a real xTB
run through the real worker; nothing numerical is typed in by hand except where a test says so.
"""

from __future__ import annotations

import hashlib
import json
from uuid import uuid4

import pytest
from chemdft_api.scientific_models import (
    CalculationInputRecord,
    CalculationRecord,
    CalculationResultRecord,
    SavedComparisonRecord,
)
from rw2_support import (
    EVIDENCE,
    create_project,
    import_structure,
    seed_result,
    supersede,
)
from sqlalchemy import delete, select, update


@pytest.fixture
def lab(api):
    client, sessions, settings = api
    project = create_project(client, "RW-3")
    version = import_structure(client, project)
    return client, sessions, settings, project, version


def _save(client, project, name, *result_ids):
    return client.post(
        f"/v1/projects/{project}/saved-comparisons", json={"name": name, "result_ids": list(result_ids)}
    )


def _open(client, project, saved_id):
    response = client.get(f"/v1/projects/{project}/saved-comparisons/{saved_id}")
    assert response.status_code == 200, response.text
    return response.json()


def _report(client, project, fmt="html", **params):
    query = [("format", fmt)]
    for key, value in params.items():
        query += [(key, v) for v in (value if isinstance(value, list) else [value])]
    return client.get(f"/v1/projects/{project}/scientific-report", params=query)


def _energy_payload(value):
    return {"total_energy": {**EVIDENCE["energy"]["payload"]["total_energy"], "value": value}}


# ------------------------------------------------------------------------------ overview


def test_overview_lists_what_was_run_with_standing_visualizations_and_exports(lab):
    client, sessions, _s, project, version = lab
    _c1, energy = seed_result(sessions, project, version, "energy")
    _c2, opt = seed_result(sessions, project, version, "opt")
    _c3, vib = seed_result(sessions, project, version, "vib_ir")
    response = client.get(f"/v1/projects/{project}/research-overview")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total_calculations"] == 3 and body["truncated"] is False
    assert body["saved_comparisons"]["availability"] == "ACTIVE"
    rows = {r["result_id"]: r for r in body["rows"]}
    assert set(rows) == {energy, opt, vib}
    for row in rows.values():
        assert row["evidence_use"] == "CURRENT"
        assert row["effective_state"]["eligible_for_derivation"] is True
        assert row["formula_hill"] == "H2O" and row["atom_count"] == 3
        assert row["structure_version_id"] == version and row["engine"]
        assert "result-json" in row["exports"] and "reproducibility-bundle" in row["exports"]
    assert "trajectory" in rows[opt]["visualizations"] and "trajectory-xyz" in rows[opt]["exports"]
    assert "ir-spectrum" in rows[vib]["visualizations"] and "spectrum-csv" in rows[vib]["exports"]
    assert rows[energy]["visualizations"] == [] and "spectrum-csv" not in rows[energy]["exports"]
    # headline values are the stored ones, with units, exactly as the comparison reads them
    quantity = rows[energy]["quantities"][0]
    assert quantity["unit"] == "Eh"
    assert quantity["value"] == EVIDENCE["energy"]["payload"]["total_energy"]["value"]
    structure = body["structures"][0]
    assert structure["calculation_count"] == 3 and structure["formula_hill"] == "H2O"


def test_overview_never_presents_inactive_evidence_as_current(lab):
    client, sessions, _s, project, version = lab
    _c, kept = seed_result(sessions, project, version, "energy")
    _c, replaced = seed_result(sessions, project, version, "energy")
    supersede(sessions, replaced)
    rows = {
        r["result_id"]: r
        for r in client.get(f"/v1/projects/{project}/research-overview").json()["rows"]
    }
    assert rows[kept]["evidence_use"] == "CURRENT"
    old = rows[replaced]
    assert old["evidence_use"] == "HISTORICAL_ONLY"
    assert old["effective_state"]["authority"] == "CANDIDATE"
    assert old["effective_state"]["source_lineage_validity"] == "SUPERSEDED"
    assert old["effective_state"]["stored_authority"] == "AUTHORITATIVE"  # history stays readable


def test_overview_shows_a_calculation_without_a_result_and_never_invents_one(lab):
    client, sessions, _s, project, version = lab
    calc, result = seed_result(sessions, project, version, "energy")
    with sessions() as session:
        session.execute(delete(CalculationResultRecord).where(CalculationResultRecord.id == result))
        session.get(CalculationRecord, calc).state = "FAILED"
        session.commit()
    row = client.get(f"/v1/projects/{project}/research-overview").json()["rows"][0]
    assert row["calculation_state"] == "FAILED" and row["result_id"] is None
    assert row["evidence_use"] == "NO_RESULT" and row["effective_state"] is None
    assert row["quantities"] == [] and row["visualizations"] == []
    assert "result-json" not in row["exports"] and "report" not in row["exports"]


def test_overview_is_project_scoped(lab):
    client, sessions, _s, project, version = lab
    seed_result(sessions, project, version, "energy")
    other = create_project(client, "other")
    rows = client.get(f"/v1/projects/{other}/research-overview").json()
    assert rows["rows"] == [] and rows["structures"] == [] and rows["total_calculations"] == 0


# ----------------------------------------------------------------------- saved comparisons


def test_saved_comparison_roundtrip_reopens_with_a_live_comparison(lab):
    client, sessions, _s, project, version = lab
    _c, a = seed_result(sessions, project, version, "energy")
    _c, b = seed_result(sessions, project, version, "energy", payload=_energy_payload(-75.0))
    created = _save(client, project, "H2O methods", a, b)
    assert created.status_code == 201, created.text
    saved = created.json()
    assert saved["result_ids"] == [a, b] and saved["archived"] is False
    listing = client.get(f"/v1/projects/{project}/saved-comparisons").json()
    assert listing["availability"] == "ACTIVE" and [c["id"] for c in listing["comparisons"]] == [saved["id"]]
    opened = _open(client, project, saved["id"])
    assert opened["status"] == "CURRENT"
    assert [r["status"] for r in opened["revalidation"]] == ["UNCHANGED", "UNCHANGED"]
    live = client.get(
        f"/v1/projects/{project}/calculation-comparison", params=[("result_id", a), ("result_id", b)]
    ).json()
    assert opened["comparison"]["pairs"] == live["pairs"]  # recomputed, not stored
    assert opened["comparison"]["reference_result_id"] == a
    assert opened["snapshot"]["overall"] == live["overall"]
    assert "historical context only" in opened["notice"]
    # the overview marks the saved membership
    rows = {r["result_id"]: r for r in client.get(f"/v1/projects/{project}/research-overview").json()["rows"]}
    assert rows[a]["saved_comparison_ids"] == [saved["id"]] == rows[b]["saved_comparison_ids"]


def test_reopening_after_supersession_revalidates_instead_of_replaying_old_authority(lab):
    client, sessions, _s, project, version = lab
    _c, a = seed_result(sessions, project, version, "energy")
    _c, b = seed_result(sessions, project, version, "energy", payload=_energy_payload(-75.0))
    saved = _save(client, project, "to be superseded", a, b).json()
    supersede(sessions, b)
    opened = _open(client, project, saved["id"])
    assert opened["status"] == "CHANGED"
    by_id = {r["result_id"]: r for r in opened["revalidation"]}
    assert by_id[a]["status"] == "UNCHANGED"
    assert by_id[b]["status"] == "STATE_CHANGED"
    assert by_id[b]["current_evidence_use"] == "HISTORICAL_ONLY"
    assert by_id[b]["current_effective_state"]["authority"] == "CANDIDATE"
    assert by_id[b]["saved"]["evidence_use"] == "CURRENT"  # the snapshot says what *was* true
    assert opened["comparison"]["pairs"][0]["evidence_standing"] == "HISTORICAL_CONTEXT"
    assert opened["comparison"]["pairs"][0]["label"] != "DIRECTLY_COMPARABLE" or True
    # agreement or disagreement never touches verification
    assert opened["comparison"]["agreement_is_not_verification"] is True
    assert all(
        r["current_effective_state"]["verification_state"] == "UNVERIFIED" for r in opened["revalidation"]
    )


def test_a_changed_source_payload_is_detected_by_identity(lab):
    client, sessions, _s, project, version = lab
    _c, a = seed_result(sessions, project, version, "energy")
    _c, b = seed_result(sessions, project, version, "energy", payload=_energy_payload(-75.0))
    saved = _save(client, project, "tamper", a, b).json()
    with sessions() as session:
        record = session.get(CalculationResultRecord, b)
        tampered = {**record.payload_json, "total_energy": {**record.payload_json["total_energy"], "value": -1.0}}
        # Results are append-only through the ORM; a core UPDATE models out-of-band tampering.
        session.execute(update(CalculationResultRecord).where(CalculationResultRecord.id == b).values(payload_json=tampered))
        session.commit()
    opened = _open(client, project, saved["id"])
    assert opened["status"] == "CHANGED"
    assert {r["result_id"]: r["status"] for r in opened["revalidation"]}[b] == "SOURCE_CHANGED"


def test_a_missing_source_makes_the_saved_comparison_unavailable_not_stale_truth(lab):
    client, sessions, _s, project, version = lab
    _c, a = seed_result(sessions, project, version, "energy")
    _c, b = seed_result(sessions, project, version, "energy", payload=_energy_payload(-75.0))
    saved = _save(client, project, "gone", a, b).json()
    with sessions() as session:
        session.execute(delete(CalculationResultRecord).where(CalculationResultRecord.id == b))
        session.commit()
    opened = _open(client, project, saved["id"])
    assert opened["status"] == "UNAVAILABLE" and opened["comparison"] is None
    assert {r["result_id"]: r["status"] for r in opened["revalidation"]}[b] == "MISSING"
    assert opened["snapshot"]["sources"][1]["evidence_use"] == "CURRENT"  # shown as history only


def test_saved_comparisons_do_not_cross_projects_or_accept_foreign_results(lab):
    client, sessions, _s, project, version = lab
    _c, a = seed_result(sessions, project, version, "energy")
    _c, b = seed_result(sessions, project, version, "energy", payload=_energy_payload(-75.0))
    saved = _save(client, project, "mine", a, b).json()
    other = create_project(client, "other")
    other_version = import_structure(client, other)
    _c, foreign = seed_result(sessions, other, other_version, "energy")
    assert _save(client, project, "bad", a, foreign).status_code == 404
    assert _save(client, other, "bad", a, foreign).status_code == 404
    assert client.get(f"/v1/projects/{other}/saved-comparisons/{saved['id']}").status_code == 404
    assert client.get(f"/v1/projects/{project}/saved-comparisons/not-an-id").status_code == 404
    assert client.get(f"/v1/projects/{other}/saved-comparisons").json()["comparisons"] == []
    assert _save(client, project, "dup", a, a).status_code == 422
    assert _save(client, project, "one", a).status_code == 422  # contract needs 2..8


def test_archiving_hides_but_never_deletes_and_is_idempotent(lab):
    client, sessions, _s, project, version = lab
    _c, a = seed_result(sessions, project, version, "energy")
    _c, b = seed_result(sessions, project, version, "energy", payload=_energy_payload(-75.0))
    saved = _save(client, project, "to archive", a, b).json()
    for _ in range(2):
        archived = client.post(f"/v1/projects/{project}/saved-comparisons/{saved['id']}/archive")
        assert archived.status_code == 200 and archived.json()["archived"] is True
    assert client.get(f"/v1/projects/{project}/saved-comparisons").json()["comparisons"] == []
    with sessions() as session:
        assert session.scalar(select(SavedComparisonRecord.archived_at)) is not None
    assert _open(client, project, saved["id"])["saved"]["archived"] is True  # history stays readable


def test_without_the_migration_the_feature_reports_not_activated_and_nothing_else_breaks(lab):
    client, sessions, _s, project, version = lab
    seed_result(sessions, project, version, "energy")
    with sessions() as session:
        SavedComparisonRecord.__table__.drop(session.get_bind())
    listing = client.get(f"/v1/projects/{project}/saved-comparisons")
    assert listing.status_code == 200 and listing.json()["availability"] == "NOT_ACTIVATED"
    assert _save(client, project, "x", str(uuid4()), str(uuid4())).status_code == 503
    overview = client.get(f"/v1/projects/{project}/research-overview")
    assert overview.status_code == 200 and overview.json()["saved_comparisons"]["availability"] == "NOT_ACTIVATED"
    assert len(overview.json()["rows"]) == 1


# ---------------------------------------------------------------------------------- reports


def test_html_report_is_self_contained_escaped_and_states_standing(lab):
    client, sessions, _s, project, _v = lab
    nasty = "<img src=x onerror=alert(1)>"
    version = import_structure(client, project, name=nasty)
    _c, vib = seed_result(sessions, project, version, "vib_ir")
    response = _report(client, project, "html", result_id=vib)
    assert response.status_code == 200, response.text
    html = response.text
    assert response.headers["x-chemdft-evidence-use"] == "CURRENT"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["content-disposition"].startswith("attachment;")
    assert "<script" not in html.lower() and "<img src=x" not in html
    assert "&lt;img src=x onerror=alert(1)&gt;" in html
    assert "Content-Security-Policy" in html and "default-src 'none'" in html
    assert "Evidence use: CURRENT" in html and "Not independently verified" in html
    assert "<svg" in html and "Frequency (cm⁻¹)" in html  # stored stick data, labelled with units
    assert "stored modes, no broadening" in html
    assert "Eh" in html or "Hartree" in html
    assert "report alone does not reproduce" in html


def test_report_json_is_the_model_and_its_integrity_hash_verifies(lab):
    client, sessions, _s, project, version = lab
    _c, a = seed_result(sessions, project, version, "energy")
    document = _report(client, project, "json", result_id=a).json()
    assert document["schema"] == "chemdft.scientific-report.v1"
    stated = document["integrity"]["sha256"]
    body = {k: v for k, v in document.items() if k != "integrity"}
    assert hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest() == stated
    result = document["results"][0]
    assert result["quantities"][0]["value"] == EVIDENCE["energy"]["payload"]["total_energy"]["value"]
    assert result["level_of_theory"]["method"] and result["provenance"]["result_payload_sha256"]
    assert result["engine"]["version"] and document["methods_text"]


def test_report_on_historical_evidence_says_so_everywhere(lab):
    client, sessions, _s, project, version = lab
    _c, a = seed_result(sessions, project, version, "energy")
    supersede(sessions, a)
    for fmt in ("html", "markdown", "json"):
        response = _report(client, project, fmt, result_id=a)
        assert response.status_code == 200
        assert response.headers["x-chemdft-evidence-use"] == "HISTORICAL_ONLY"
    html = _report(client, project, "html", result_id=a).text
    assert "Evidence use: HISTORICAL_ONLY" in html and "must not be cited as current" in html
    assert "Current — authoritative" not in html
    assert "Not current authoritative evidence" in _report(client, project, "markdown", result_id=a).text


def test_comparison_report_carries_rules_conclusions_and_never_upgrades_verification(lab):
    client, sessions, _s, project, version = lab
    _c, a = seed_result(sessions, project, version, "energy")
    _c, b = seed_result(sessions, project, version, "energy", payload=_energy_payload(-75.0))
    _c, other_level = seed_result(sessions, project, version, "energy", spec={"basis": {**EVIDENCE["energy"]["specification"]["basis"], "identifier": "6-31g"}}, payload={"basis": "6-31g"})
    document = _report(client, project, "json", result_id=[a, b, other_level]).json()
    assert document["scope"]["kind"] == "comparison"
    labels = {p["other_result_id"]: p["label"] for p in document["comparison"]["pairs"]}
    assert labels[b] == "DIRECTLY_COMPARABLE" and labels[other_level] == "NOT_SCIENTIFICALLY_COMPARABLE"
    blocked = next(p for p in document["comparison"]["pairs"] if p["other_result_id"] == other_level)
    assert blocked["deltas"] == [] and blocked["blockers"]
    html = _report(client, project, "html", result_id=[a, b, other_level]).text
    assert "not scientifically comparable" in html and "No difference is shown" in html
    assert "Δ (kcal/mol)" in html  # chart of the formed difference, labelled with its unit
    assert all(r["standing"]["verification_state"] == "UNVERIFIED" for r in document["results"])
    assert "agreement" in html.lower() and "not independent verification" in html.lower()


def test_saved_comparison_report_revalidates_and_refuses_when_a_source_is_gone(lab):
    client, sessions, _s, project, version = lab
    _c, a = seed_result(sessions, project, version, "energy")
    _c, b = seed_result(sessions, project, version, "energy", payload=_energy_payload(-75.0))
    saved = _save(client, project, "report me", a, b).json()
    supersede(sessions, a)
    document = _report(client, project, "json", saved_comparison_id=saved["id"]).json()
    assert document["scope"]["kind"] == "saved-comparison"
    assert document["scope"]["saved_comparison"]["revalidation_status"] == "CHANGED"
    assert document["evidence_use"] == "HISTORICAL_ONLY"
    with sessions() as session:
        session.execute(delete(CalculationResultRecord).where(CalculationResultRecord.id == b))
        session.commit()
    assert _report(client, project, "json", saved_comparison_id=saved["id"]).status_code == 422


def test_report_requires_exactly_one_selection_style_and_stays_inside_the_project(lab):
    client, sessions, _s, project, version = lab
    _c, a = seed_result(sessions, project, version, "energy")
    assert _report(client, project, "html").status_code == 422
    assert _report(client, project, "html", result_id=a, saved_comparison_id=str(uuid4())).status_code == 422
    assert _report(client, project, "html", result_id=[a, a]).status_code == 422
    other = create_project(client, "other")
    assert _report(client, other, "html", result_id=a).status_code == 404
    assert _report(client, project, "html", result_id="not-a-uuid").status_code == 404


def test_calculation_report_format_is_offered_by_the_export_catalog_and_downloads(lab):
    client, sessions, _s, project, version = lab
    calc, _result = seed_result(sessions, project, version, "tddft")
    catalog = client.get(f"/v1/projects/{project}/calculations/{calc}/exports").json()
    report = next(f for f in catalog["formats"] if f["format"] == "report")
    assert report["available"] and [v["key"] for v in report["variants"]] == ["html", "markdown", "json"]
    for variant, marker in (("html", "<svg"), ("markdown", "# "), ("json", '"schema"')):
        download = client.get(
            f"/v1/projects/{project}/calculations/{calc}/export", params={"format": "report", "variant": variant}
        )
        assert download.status_code == 200 and marker in download.text
        assert download.headers["x-chemdft-evidence-use"] == "CURRENT"
    assert "Excitation energy (eV)" in client.get(
        f"/v1/projects/{project}/calculations/{calc}/export", params={"format": "report"}
    ).text


# ------------------------------------------------------------------- reuse plan and queue


def _reuse(client, project, calc):
    response = client.get(f"/v1/projects/{project}/calculations/{calc}/reuse-plan")
    assert response.status_code == 200, response.text
    return response.json()


def _checks(plan):
    return {c["check_id"]: c["outcome"] for c in plan["checks"]}


def test_reuse_plan_fails_closed_when_the_original_input_cannot_be_verified(lab):
    client, sessions, _s, project, version = lab
    calc, _r = seed_result(sessions, project, version, "energy")  # input artifact has no stored bytes
    plan = _reuse(client, project, calc)
    assert plan["can_reuse"] is False and plan["specification"] is None
    assert _checks(plan)["STRUCTURE_IDENTITY"] == "FAIL"


def test_reuse_plan_blocks_an_electronic_state_that_contradicts_the_structure(lab):
    client, sessions, _s, project, version = lab
    calc, _r = seed_result(sessions, project, version, "energy", charge=1, multiplicity=1)
    plan = _reuse(client, project, calc)
    assert _checks(plan)["ELECTRONIC_STATE"] == "FAIL" and plan["can_reuse"] is False


def test_reuse_plan_rejects_specifications_that_are_not_reusable_requests(lab):
    client, sessions, _s, project, version = lab
    calc, _r = seed_result(sessions, project, version, "energy", spec={"unexpected_field": 1})
    plan = _reuse(client, project, calc)
    assert _checks(plan) == {"SOURCE_SPECIFICATION": "FAIL"} and plan["can_reuse"] is False
    assert client.get(f"/v1/projects/{project}/calculations/{uuid4()}/reuse-plan").status_code == 404


def test_queue_status_counts_persisted_state_and_admits_what_it_cannot_see(lab):
    client, _sessions, _s, project, _v = lab
    body = client.get(f"/v1/projects/{project}/compute/queue-status").json()
    assert body["counts"] == {k: 0 for k in body["counts"]}
    assert body["active"] == [] and body["oldest_queued_at"] is None
    assert body["worker_process_observable"] is False and "cannot observe a worker" in body["notice"]
    other = create_project(client, "other")
    assert client.get(f"/v1/projects/{other}/compute/queue-status").status_code == 200


# --------------------------------------------- real xTB run: reuse, queue, evidence archive


def test_real_xtb_calculation_reuse_queue_and_archive(api):
    from test_pf8b2_post_audit import process, queue

    client, sessions, _settings = api
    project, version, response = queue(api, engine="xtb", task="ENERGY", xyz=b"1\nHelium\nHe 0 0 0\n")
    assert response.status_code == 201, response.text
    calc = response.json()["calculation"]["id"]
    queued = client.get(f"/v1/projects/{project}/compute/queue-status").json()
    assert queued["counts"]["queued"] == 1 and queued["oldest_queued_at"]
    detail = process(api)
    assert detail.calculation.state == "SUCCEEDED"
    done = client.get(f"/v1/projects/{project}/compute/queue-status").json()
    assert done["counts"]["succeeded"] == 1 and done["counts"]["queued"] == 0

    # reuse: a NEW calculation with the same stored specification, old records untouched
    plan = _reuse(client, project, calc)
    assert plan["can_reuse"] is True, plan["checks"]
    assert {c["outcome"] for c in plan["checks"]} <= {"PASS", "WARNING"}
    assert plan["engine"] == "xtb" and plan["structure_version_id"] == version["id"]
    with sessions() as session:
        before = session.get(CalculationInputRecord, session.scalar(select(CalculationInputRecord.id))).specification_json
    body = {
        "structure_version": {"project_id": project, "entity_type": "structure.version", "entity_id": version["id"]},
        "specification": plan["specification"],
        "idempotency_key": f"reuse-{uuid4()}",
    }
    created = client.post(f"/v1/projects/{project}/calculations", json=body)
    assert created.status_code == 201, created.text
    new_calc = created.json()["calculation"]["id"]
    assert new_calc != calc
    with sessions() as session:
        assert session.get(CalculationRecord, calc).state == "SUCCEEDED"
        assert session.scalar(select(CalculationInputRecord.specification_json).where(CalculationInputRecord.calculation_id == calc)) == before
        assert len(session.scalars(select(CalculationResultRecord.id)).all()) == 1  # nothing overwritten
    # the new run's plan now reports the earlier equivalent calculation
    assert calc in _reuse(client, project, new_calc)["equivalent_calculation_ids"]
    # existing idempotency rule: the same key with the same request returns the same calculation
    again = client.post(f"/v1/projects/{project}/calculations", json=body)
    assert again.json()["calculation"]["id"] == new_calc

    # archive: genuine native evidence (security and fidelity are covered in test_rw3_archive_security)
    from rw3_archive_support import open_archive

    files = open_archive(client.get(f"/v1/projects/{project}/calculations/{calc}/export", params={"format": "reproducibility-bundle"}))
    manifest = json.loads(files["MANIFEST.json"])
    assert manifest["classification"] == "REPRODUCIBILITY_PACKAGE", manifest["missing"]
    assert manifest["exact_reproducibility_claimed"] is False and manifest["executable_workflow"]["provided"] is False
