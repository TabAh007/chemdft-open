# ruff: noqa: E501  (assertion messages and fixtures)
"""Published-results pagination: result-centric, exact counts, stable keyset paging, authorization.

Scientific values come from the accepted native PySCF evidence (`rw2_support`); nothing numerical is
typed in by hand. The endpoint is read-only: every test that writes does so through the seeding helpers.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from chemdft_api.models import Project as ProjectRecord
from chemdft_api.models import new_id
from chemdft_api.scientific_models import (
    CalculationRecord,
    CalculationResultRecord,
    ProvenanceRecordRow,
)
from rw2_support import EVIDENCE, create_project, import_structure, seed_result, supersede
from sqlalchemy import func, select, update


@pytest.fixture
def lab(api):
    client, sessions, settings = api
    project = create_project(client, "published-results")
    version = import_structure(client, project)
    return client, sessions, settings, project, version


def _get(client, project, **params):
    response = client.get(f"/v1/projects/{project}/published-results", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def _all_pages(client, project, **params):
    ids, cursor, pages = [], None, 0
    while True:
        query = dict(params)
        if cursor:
            query["cursor"] = cursor
        body = _get(client, project, **query)
        ids += [r["result_id"] for r in body["rows"]]
        pages += 1
        cursor = body["next_cursor"]
        if not cursor:
            return ids, pages, body
        assert pages < 100


def _touch(sessions, calculation_id, when):
    with sessions() as session:
        session.execute(update(CalculationRecord).where(CalculationRecord.id == calculation_id).values(updated_at=when))
        session.commit()


def _bare_calculations(sessions, project, count, state, base):
    """Calculation records that never produced a result (failed, canceled, queued ...)."""
    with sessions() as session:
        user = session.get(ProjectRecord, project).created_by
        for i in range(count):
            session.add(CalculationRecord(project_id=project, state=state, created_by=user, updated_at=base + timedelta(seconds=i)))
        session.commit()


def _second_result(sessions, calculation_id):
    """A second published result record for the same calculation (a calculation can have several)."""
    with sessions() as session:
        first = session.scalar(select(CalculationResultRecord).where(CalculationResultRecord.calculation_id == calculation_id))
        provenance = ProvenanceRecordRow(
            project_id=first.project_id, subject_type="calculation.result", subject_id=new_id(), source_class="CALCULATED",
            detail="DETERMINISTIC_TRANSFORM", verification_state="UNVERIFIED", producer_kind="SOFTWARE", producer_identifier="test",
            producer_software_version="1", source_artifact_id=None, operation="test", operation_version="1", parameters_json=[],
            approximate=False, supersedes_id=None, correlation_id=calculation_id,
        )
        session.add(provenance)
        session.flush()
        record = CalculationResultRecord(
            id=new_id(), project_id=first.project_id, calculation_id=calculation_id, calculation_input_id=first.calculation_input_id,
            result_type="chemdft.molecular-orbitals", authority="AUTHORITATIVE", source_class="CALCULATED", verification_state="UNVERIFIED",
            validation_state="VALIDATED", trusted_producer_id=first.trusted_producer_id, trusted_producer_type=first.trusted_producer_type,
            producer_attestation_id="test", producer_software_json=first.producer_software_json, payload_json=EVIDENCE["orbital"]["payload"] if "orbital" in EVIDENCE else {},
            provenance_record_id=provenance.id, raw_artifacts_json=[], idempotency_key=f"second-{new_id()}", request_id=new_id(), correlation_id=new_id(),
        )
        session.add(record)
        session.commit()
        return record.id


# ------------------------------------------------------------------------------ the 300-row window


def test_older_published_results_are_not_hidden_by_many_newer_unpublished_calculations(lab):
    client, sessions, _s, project, version = lab
    calc, old = seed_result(sessions, project, version, "energy")
    base = datetime(2026, 1, 1, tzinfo=UTC).replace(tzinfo=None)
    _touch(sessions, calc, base - timedelta(days=30))
    _bare_calculations(sessions, project, 305, "FAILED", base)
    overview = client.get(f"/v1/projects/{project}/research-overview").json()
    assert overview["truncated"] is True and overview["total_calculations"] == 306
    assert old not in {r["result_id"] for r in overview["rows"]}, "documents the overview window this endpoint removes"
    page = _get(client, project)
    assert [r["result_id"] for r in page["rows"]] == [old]
    assert page["total_published"] == 1 and page["total_matching"] == 1
    assert page["total_calculations"] == 306 and page["without_result"] == {"pending": 0, "failed": 305, "canceled": 0, "no_result": 0}
    assert page["next_cursor"] is None


# ------------------------------------------------------------------------------ rows and counts


def test_rows_are_exactly_the_overview_rows_of_published_results(lab):
    client, sessions, _s, project, version = lab
    ids = [seed_result(sessions, project, version, key)[1] for key in ("energy", "opt", "vib_ir")]
    overview = {r["result_id"]: r for r in client.get(f"/v1/projects/{project}/research-overview").json()["rows"]}
    page = _get(client, project)
    assert {r["result_id"] for r in page["rows"]} == set(ids)
    for row in page["rows"]:
        assert row == overview[row["result_id"]]  # one builder: same standing, quantities, exports, visualizations


def test_counts_distinguish_published_results_calculation_records_and_what_has_no_result(lab):
    client, sessions, _s, project, version = lab
    seed_result(sessions, project, version, "energy")
    seed_result(sessions, project, version, "opt")
    base = datetime(2026, 2, 1, tzinfo=UTC).replace(tzinfo=None)
    _bare_calculations(sessions, project, 2, "FAILED", base)
    _bare_calculations(sessions, project, 1, "CANCELED", base)
    _bare_calculations(sessions, project, 3, "QUEUED", base)
    _bare_calculations(sessions, project, 1, "RUNNING", base)
    _bare_calculations(sessions, project, 4, "SUCCEEDED", base)  # succeeded, never published
    page = _get(client, project)
    assert page["total_published"] == 2 and page["total_calculations"] == 13
    assert page["without_result"] == {"pending": 4, "failed": 2, "canceled": 1, "no_result": 4}
    assert {r["result_id"] is not None for r in page["rows"]} == {True}, "no calculation without a result becomes a row"


def test_a_calculation_with_two_published_results_yields_two_rows(lab):
    client, sessions, _s, project, version = lab
    calc, first = seed_result(sessions, project, version, "energy")
    second = _second_result(sessions, calc)
    page = _get(client, project)
    assert {r["result_id"] for r in page["rows"]} == {first, second}
    assert page["total_published"] == 2 and page["total_calculations"] == 1


def test_historical_and_superseded_results_stay_listed_with_their_recorded_standing(lab):
    client, sessions, _s, project, version = lab
    _c, kept = seed_result(sessions, project, version, "energy")
    _c, replaced = seed_result(sessions, project, version, "energy")
    supersede(sessions, replaced)
    page = _get(client, project)
    rows = {r["result_id"]: r for r in page["rows"]}
    assert rows[kept]["evidence_use"] == "CURRENT"
    assert rows[replaced]["evidence_use"] == "HISTORICAL_ONLY"
    assert rows[replaced]["effective_state"]["source_lineage_validity"] == "SUPERSEDED"
    assert rows[replaced]["effective_state"]["stored_authority"] == "AUTHORITATIVE"
    assert page["total_published"] == 2
    assert [r["result_id"] for r in _get(client, project, standing="historical")["rows"]] == [replaced]
    assert [r["result_id"] for r in _get(client, project, standing="current")["rows"]] == [kept]
    assert _get(client, project, standing="historical")["total_matching"] == 1


# ------------------------------------------------------------------------------ pagination


def test_pagination_is_complete_without_duplicates_for_every_ordering(lab):
    client, sessions, _s, project, version = lab
    ids = {seed_result(sessions, project, version, key)[1] for key in ("energy", "energy", "opt", "vib_ir", "energy", "opt", "vib_ir")}
    assert len(ids) == 7
    for sort in ("updated", "task", "engine", "formula", "energy"):
        for direction in ("asc", "desc"):
            seen, pages, last = _all_pages(client, project, limit=3, sort=sort, direction=direction)
            assert len(seen) == len(set(seen)) == 7 and set(seen) == ids, (sort, direction)
            assert pages == 3 and last["total_matching"] == 7 and last["total_published"] == 7


def test_ordering_is_stable_and_direction_reverses_it(lab):
    client, sessions, _s, project, version = lab
    for key in ("energy", "opt", "energy", "opt", "energy"):
        seed_result(sessions, project, version, key)
    asc, _p, _b = _all_pages(client, project, limit=2, sort="task", direction="asc")
    again, _p, _b = _all_pages(client, project, limit=5, sort="task", direction="asc")
    assert asc == again, "page size never changes the order"
    rows = {r["result_id"]: r for r in _get(client, project, limit=10, sort="task", direction="asc")["rows"]}
    tasks = [rows[i]["task"] for i in asc]
    assert tasks == sorted(tasks)
    desc, _p, _b = _all_pages(client, project, limit=2, sort="task", direction="desc")
    assert [rows[i]["task"] for i in desc] == sorted(tasks, reverse=True)


def test_energy_sort_orders_only_the_column_and_puts_results_without_a_total_energy_last(lab):
    client, sessions, _s, project, version = lab
    values = [-76.0, -75.5, -75.9]
    for value in values:
        seed_result(sessions, project, version, "energy", payload={"total_energy": {**EVIDENCE["energy"]["payload"]["total_energy"], "value": value}})
    _c, no_scalar = seed_result(sessions, project, version, "vib_ir")
    asc = _get(client, project, sort="energy", direction="asc", limit=10)["rows"]
    assert [r["quantities"][0]["value"] for r in asc[:3]] == sorted(values)
    assert asc[3]["result_id"] == no_scalar, "a frequency or gap is never ordered among energies"
    desc = _get(client, project, sort="energy", direction="desc", limit=10)["rows"]
    assert [r["quantities"][0]["value"] for r in desc[:3]] == sorted(values, reverse=True)
    assert desc[3]["result_id"] == no_scalar, "missing values are last in either direction"


def test_keyset_cursor_neither_duplicates_nor_skips_when_results_are_published_between_pages(lab):
    client, sessions, _s, project, version = lab
    first = [seed_result(sessions, project, version, "energy")[1] for _ in range(5)]
    page1 = _get(client, project, limit=2, sort="updated", direction="desc")
    got = [r["result_id"] for r in page1["rows"]]
    newer = seed_result(sessions, project, version, "energy")  # published while the researcher is paging
    page2 = _get(client, project, limit=10, sort="updated", direction="desc", cursor=page1["next_cursor"])
    rest = [r["result_id"] for r in page2["rows"]]
    assert newer[1] not in rest and set(got).isdisjoint(rest)
    assert set(got) | set(rest) == set(first), "nothing already published is skipped"
    assert page2["total_published"] == 6, "counts are always current"


def test_filters_narrow_exactly_and_facets_describe_everything_published(lab):
    client, sessions, _s, project, version = lab
    _c, energy = seed_result(sessions, project, version, "energy")
    _c, opt = seed_result(sessions, project, version, "opt")
    _c, vib = seed_result(sessions, project, version, "vib_ir")
    everything = _get(client, project)
    assert {"ENERGY", "GEOMETRY_OPTIMIZATION", "FREQUENCY"} <= set(everything["facets"]["tasks"]) and everything["facets"]["engines"]
    by_task = _get(client, project, task="GEOMETRY_OPTIMIZATION")
    assert [r["result_id"] for r in by_task["rows"]] == [opt] and by_task["total_matching"] == 1 and by_task["total_published"] == 3
    engine = everything["rows"][0]["engine"]
    assert _get(client, project, engine=engine)["total_matching"] == 3 and _get(client, project, engine="no-such-engine")["total_matching"] == 0
    assert [r["result_id"] for r in _get(client, project, q="water")["rows"]] != []  # structure name
    assert _get(client, project, q="definitely-not-present")["rows"] == []
    assert _get(client, project, q=energy[:8])["total_matching"] == 1, "a result id fragment finds its result"
    assert _get(client, project, task="ENERGY", engine=engine, q="water")["total_matching"] == 1
    assert vib  # silence unused


def test_text_search_matches_the_level_of_theory_a_researcher_reads(lab):
    client, sessions, _s, project, version = lab
    seed_result(sessions, project, version, "energy")
    row = _get(client, project)["rows"][0]
    for needle in (row["method"], row["basis"], f"{row['method']} / {row['basis']}", row["structure_name"], row["formula_hill"]):
        assert needle and _get(client, project, q=needle.lower())["total_matching"] == 1, needle
    assert _get(client, project, q="  ")["total_matching"] == 1, "blank text is no filter"


# ------------------------------------------------------------------------------ validation and safety


def test_invalid_parameters_and_cursors_are_refused(lab):
    client, sessions, _s, project, version = lab
    for _ in range(3):
        seed_result(sessions, project, version, "energy")
    base = f"/v1/projects/{project}/published-results"
    assert client.get(base, params={"limit": 0}).status_code == 422
    assert client.get(base, params={"limit": 201}).status_code == 422
    assert client.get(base, params={"sort": "nonsense"}).status_code == 422
    assert client.get(base, params={"direction": "up"}).status_code == 422
    assert client.get(base, params={"standing": "maybe"}).status_code == 422
    assert client.get(base, params={"cursor": "not-a-cursor"}).status_code == 422
    cursor = _get(client, project, limit=1)["next_cursor"]
    assert cursor
    assert client.get(base, params={"cursor": cursor, "sort": "task"}).status_code == 422, "a cursor belongs to one ordering"
    assert client.get(base, params={"cursor": cursor, "direction": "asc"}).status_code == 422


def test_results_are_project_scoped(lab):
    client, sessions, _s, project, version = lab
    seed_result(sessions, project, version, "energy")
    other = create_project(client, "other")
    page = _get(client, other)
    assert page["rows"] == [] and page["total_published"] == 0 and page["total_calculations"] == 0 and page["facets"] == {"tasks": [], "engines": []}
    missing = client.get(f"/v1/projects/{new_id()}/published-results")
    assert missing.status_code in {403, 404}


def test_named_result_ids_return_only_those_results_of_this_project(lab):
    client, sessions, _s, project, version = lab
    ids = [seed_result(sessions, project, version, "energy")[1] for _ in range(3)]
    other = create_project(client, "other-named")
    other_version = import_structure(client, other)
    foreign = seed_result(sessions, other, other_version, "energy")[1]

    def named(*wanted, **extra):
        response = client.get(f"/v1/projects/{project}/published-results", params={"result_id": list(wanted), **extra})
        return response

    page = named(ids[0], ids[2]).json()
    assert sorted(r["result_id"] for r in page["rows"]) == sorted([ids[0], ids[2]])
    assert page["total_matching"] == 2 and page["total_published"] == 3 and page["next_cursor"] is None
    # An id of another project and an id that does not exist are indistinguishable: both are simply absent.
    absent = named(ids[1], foreign, new_id()).json()
    assert [r["result_id"] for r in absent["rows"]] == [ids[1]]
    # Named ids compose with the other filters and keep the page's own ordering.
    assert named(ids[0], ids[1], ids[2], task="THERMOCHEMISTRY").json()["rows"] == []
    assert named("not-a-uuid").status_code == 422
    assert named(*[new_id() for _ in range(17)]).status_code == 422


def test_more_than_300_published_results_page_completely_and_any_of_them_can_be_named_and_compared(lab):
    """The Compare workstation selects from a project whose results outnumber the overview's 300-calculation window."""
    client, sessions, _s, project, version = lab
    ids = [seed_result(sessions, project, version, "energy")[1] for _ in range(330)]
    seen, pages, last = _all_pages(client, project, limit=200)
    assert len(seen) == len(set(seen)) == 330 and set(seen) == set(ids)
    assert pages == 2 and last["total_published"] == 330 and last["total_matching"] == 330
    # The first and the last result of the stable ordering are both reachable by id, however deep they sit.
    ends = [seen[0], seen[-1]]
    named = _get(client, project, result_id=ends)
    assert sorted(r["result_id"] for r in named["rows"]) == sorted(ends) and named["total_matching"] == 2
    # ... and they can be compared with each other (the comparison reads by id, not by page).
    response = client.get(f"/v1/projects/{project}/calculation-comparison", params={"result_id": ends})
    assert response.status_code == 200, response.text
    comparison = response.json()
    assert [r["result_id"] for r in comparison["results"]] == ends and comparison["reference_result_id"] == ends[0]


def test_thermochemistry_rows_carry_their_stored_conditions_and_nothing_else_does(lab):
    client, sessions, _s, project, version = lab
    hot = seed_result(sessions, project, version, "thermo", payload={"conditions": {**EVIDENCE["thermo"]["payload"]["conditions"], "temperature_k": 750.0}})[1]
    bare = seed_result(sessions, project, version, "thermo", payload={"conditions": {"temperature_k": 298.15}})[1]  # pressure not recorded
    plain = seed_result(sessions, project, version, "energy")[1]
    rows = {r["result_id"]: r for r in _get(client, project)["rows"]}
    assert rows[hot]["conditions"] == {"temperature_k": 750.0, "pressure_pa": EVIDENCE["thermo"]["payload"]["conditions"]["pressure_pa"]}
    assert rows[bare]["conditions"] is None, "a condition that is not fully recorded is never completed or defaulted"
    assert rows[plain]["conditions"] is None
    # the comparison summaries carry the same stored values
    comparison = client.get(f"/v1/projects/{project}/calculation-comparison", params={"result_id": [hot, plain]}).json()
    assert comparison["results"][0]["conditions"]["temperature_k"] == 750.0 and comparison["results"][1]["conditions"] is None


def test_the_endpoint_reads_only(lab):
    client, sessions, _s, project, version = lab
    seed_result(sessions, project, version, "energy")
    supersede(sessions, seed_result(sessions, project, version, "energy")[1])

    def snapshot():
        with sessions() as session:
            return tuple(session.scalar(select(func.count()).select_from(model)) for model in (CalculationRecord, CalculationResultRecord, ProvenanceRecordRow))

    before = snapshot()
    stored = _get(client, project)["rows"]
    _all_pages(client, project, limit=1, sort="energy", direction="asc", standing="historical")
    assert snapshot() == before
    with sessions() as session:
        record = session.scalar(select(CalculationResultRecord).where(CalculationResultRecord.id == stored[0]["result_id"]))
        assert record.authority == "AUTHORITATIVE" and record.validation_state == "VALIDATED" and record.verification_state == "UNVERIFIED"


def test_the_stored_energy_and_unit_are_shown_exactly_as_published(lab):
    client, sessions, _s, project, version = lab
    seed_result(sessions, project, version, "energy")
    quantity = _get(client, project)["rows"][0]["quantities"][0]
    stored = EVIDENCE["energy"]["payload"]["total_energy"]
    assert quantity["value"] == stored["value"] and quantity["unit"] == "Eh"
