from __future__ import annotations

import math
from uuid import uuid4

import pytest

from chemdft_api.contracts.scientific_claims import (
    ProjectScientificClaimsOutput,
    ScientificClaim,
    ScientificClaimRelation,
)
from chemdft_api.scientific_claim_actions import _recorded_difference, _relations
from chemdft_api.scientific_comparison_actions import build_scientific_comparison


def claim(
    *,
    authority: str,
    quantity: str,
    value: float,
    document_id: str | None,
    unit: str = "degree",
    source_href: str | None = "/source",
    record_type: str = "evidence_candidate",
    claim_type: str = "PEAK_POSITION",
    evidence_id: str | None = None,
    semantic_status: str = "EXPLICIT",
) -> ScientificClaim:
    return ScientificClaim(
        id=uuid4(),
        project_id=uuid4(),
        claim_type=claim_type,
        subject="fixture",
        predicate=quantity,
        quantity_key=quantity,
        value=value,
        unit=unit,
        source_authority=authority,
        source_record_type=record_type,
        source_record_id=uuid4(),
        source_document_id=document_id,
        evidence_id=evidence_id,
        review_state="DETECTED" if authority == "EXTRACTED" else "COMMITTED",
        semantic_status=semantic_status,
        source_label="fixture",
        source_href=source_href,
    )


def claims_output(
    source: list[ScientificClaim],
    project: list[ScientificClaim],
    relations: list[ScientificClaimRelation],
) -> ProjectScientificClaimsOutput:
    return ProjectScientificClaimsOutput(
        project_id=source[0].project_id if source else project[0].project_id,
        claims=tuple(source + project),
        relations=tuple(relations),
    )


def test_comparison_projects_delta_from_existing_relation_without_mutation() -> None:
    document_id = str(uuid4())
    source = claim(
        authority="EXTRACTED",
        quantity="xrd.two_theta.peak_position",
        value=24.482,
        document_id=document_id,
    )
    project = claim(
        authority="DIGITIZED",
        quantity="xrd.two_theta.peak_position",
        value=24.4565,
        document_id=document_id,
        record_type="experimental_dataset",
    )
    relation = ScientificClaimRelation(
        left_claim_id=source.id,
        right_claim_id=project.id,
        relation="SAME_QUANTITY",
        rationale="Shared semantic quantity and unit.",
        numeric_delta=0.0255,
        delta_unit="degree",
    )
    output = claims_output([source], [project], [relation])

    result = build_scientific_comparison(output)

    assert len(result.rows) == 1
    row = result.rows[0]
    assert row.relation == "SAME_QUANTITY"
    assert row.delta == 0.0255
    assert row.source_claims == (source,)
    assert row.project_claims == (project,)
    assert row.authority_summary == ("DIGITIZED", "EXTRACTED")
    assert result.summary.directly_comparable_pairs == 1
    assert output.claims == (source, project)
    assert output.relations == (relation,)


def test_comparison_never_pairs_claims_across_source_documents() -> None:
    paper_a = str(uuid4())
    paper_b = str(uuid4())
    source = claim(
        authority="EXTRACTED",
        quantity="xrd.two_theta.peak_position",
        value=24.482,
        document_id=paper_a,
    )
    project = claim(
        authority="DIGITIZED",
        quantity="xrd.two_theta.peak_position",
        value=24.4565,
        document_id=paper_b,
        record_type="experimental_dataset",
    )
    output = claims_output(
        [source],
        [project],
        [
            ScientificClaimRelation(
                left_claim_id=source.id,
                right_claim_id=project.id,
                relation="SAME_QUANTITY",
                rationale="Fixture relation should be rejected because the source differs.",
                numeric_delta=0.0255,
                delta_unit="degree",
            )
        ],
    )

    result = build_scientific_comparison(output)

    assert {row.relation for row in result.rows} == {"SOURCE_ONLY", "PROJECT_ONLY"}
    assert all(not row.delta for row in result.rows)


def test_incompatible_dls_semantics_have_no_delta_and_keep_authority() -> None:
    document_id = str(uuid4())
    source = claim(
        authority="EXTRACTED",
        quantity="dls.hydrodynamic_radius",
        value=1482.3,
        document_id=document_id,
        unit="nm",
        claim_type="PARTICLE_SIZE",
    )
    project = claim(
        authority="DIGITIZED",
        quantity="dls.hydrodynamic_diameter.distribution_peak",
        value=1524.4,
        document_id=document_id,
        unit="nm",
        record_type="experimental_dataset",
        claim_type="DISTRIBUTION_SUMMARY",
    )
    relation = ScientificClaimRelation(
        left_claim_id=source.id,
        right_claim_id=project.id,
        relation="NOT_DIRECTLY_COMPARABLE",
        rationale="DLS radius and diameter have different semantics.",
    )

    row = build_scientific_comparison(claims_output([source], [project], [relation])).rows[0]

    assert row.relation == "NOT_DIRECTLY_COMPARABLE"
    assert row.delta is None
    assert row.delta_unit is None
    assert row.authority_summary == ("DIGITIZED", "EXTRACTED")


def test_stale_source_link_degrades_to_unresolved() -> None:
    source = claim(
        authority="EXTRACTED",
        quantity="crystal.cell.a",
        value=4.958,
        document_id=str(uuid4()),
        unit="Å",
        source_href=None,
        semantic_status="SOURCE_UNAVAILABLE",
    )

    row = build_scientific_comparison(claims_output([source], [], [])).rows[0]

    assert row.relation == "UNRESOLVED"
    assert row.unresolved_reason


def test_structure_relation_requires_existing_source_evidence_link() -> None:
    document_id = str(uuid4())
    source = claim(
        authority="EXTRACTED",
        quantity="structure.figure",
        value=1,
        document_id=document_id,
        claim_type="STRUCTURE_ASSERTION",
    )
    project = claim(
        authority="RECONSTRUCTED",
        quantity="structure.representation",
        value=1,
        document_id=document_id,
        record_type="structure_version",
        claim_type="STRUCTURE_ASSERTION",
        evidence_id=str(uuid4()),
    )

    row = build_scientific_comparison(claims_output([source], [project], [])).rows[0]

    assert row.relation in {"SOURCE_ONLY", "PROJECT_ONLY"}
    assert row.delta is None


def test_unit_mismatch_relation_never_gets_a_numeric_delta() -> None:
    document_id = str(uuid4())
    source = claim(
        authority="EXTRACTED",
        quantity="sample.temperature",
        value=25.0,
        document_id=document_id,
        unit="°C",
    )
    project = claim(
        authority="CALCULATED",
        quantity="sample.temperature",
        value=298.15,
        document_id=document_id,
        unit="K",
        record_type="calculation_result",
    )
    relation = ScientificClaimRelation(
        left_claim_id=source.id,
        right_claim_id=project.id,
        relation="SEMANTICS_DIFFER",
        rationale="Same semantic quantity but units differ; no conversion rule is available.",
    )

    row = build_scientific_comparison(claims_output([source], [project], [relation])).rows[0]

    assert row.relation == "SEMANTICS_DIFFER"
    assert row.delta is None
    assert row.delta_unit is None


def test_project_only_record_without_navigation_degrades_safely() -> None:
    result = claim(
        authority="CALCULATED",
        quantity="calculation.energy",
        value=-1.2,
        document_id=None,
        unit="hartree",
        source_href=None,
        record_type="calculation_result",
    )

    row = build_scientific_comparison(claims_output([], [result], [])).rows[0]

    assert row.relation == "PROJECT_ONLY"
    assert row.project_claims[0].source_href is None
    assert row.delta is None


def test_project_comparison_endpoint_is_read_only_and_handles_empty_projects(api) -> None:
    client, _sessions, _settings = api
    project = client.post(
        "/v1/projects", json={"name": "Empty comparison", "slug": "empty-comparison"}
    ).json()

    response = client.get(f"/v1/projects/{project['id']}/scientific-comparison?locale=en")

    assert response.status_code == 200, response.text
    assert response.json()["rows"] == []
    assert all(value == 0 for value in response.json()["summary"].values())
    assert client.post(f"/v1/projects/{project['id']}/scientific-comparison").status_code == 405


def _delta_of(
    quantity: str, source_value: float, project_value: float, unit: str = "degree"
) -> float | None:
    document_id = str(uuid4())
    source = claim(
        authority="EXTRACTED",
        quantity=quantity,
        value=source_value,
        document_id=document_id,
        unit=unit,
    )
    project = claim(
        authority="DIGITIZED",
        quantity=quantity,
        value=project_value,
        document_id=document_id,
        unit=unit,
        record_type="experimental_dataset",
    )
    relations = [r for r in _relations([source, project]) if r.relation == "SAME_QUANTITY"]
    assert len(relations) == 1
    return relations[0].numeric_delta


def test_xrd_delta_is_the_decimal_difference_of_the_recorded_values() -> None:
    # Binary subtraction gives 0.025500000000000966 here; the recorded decimals differ by exactly 0.0255.
    assert 24.482 - 24.4565 != 0.0255
    assert _delta_of("xrd.two_theta.peak_position", 24.482, 24.4565) == 0.0255


def test_numeric_delta_is_the_decimal_difference_and_keeps_its_unit() -> None:
    assert 1524.4 - 1482.3 != 42.1
    assert _delta_of("dls.hydrodynamic_diameter.mean", 1524.4, 1482.3, unit="nm") == 42.1
    assert _delta_of("dls.hydrodynamic_diameter.mean", 1e-10, 3e-10, unit="nm") == -2e-10


def test_delta_sign_is_source_minus_chemdft() -> None:
    assert _delta_of("xrd.two_theta.peak_position", 24.4565, 24.482) == -0.0255
    assert _delta_of("xrd.two_theta.peak_position", 24.482, 24.482) == 0.0


@pytest.mark.parametrize(
    ("left", "right", "expected"),
    [
        (24.482, 24.4565, 0.0255),
        (1524.4, 1482.3, 42.1),
        (1e-10, 3e-10, -2e-10),
        (5, 2, 3.0),
        (-1.5, 1.5, -3.0),
    ],
)
def test_recorded_difference_values(left: float, right: float, expected: float) -> None:
    assert _recorded_difference(left, right) == expected


def test_recorded_difference_non_finite_values_behave_as_before() -> None:
    assert math.isnan(_recorded_difference(float("nan"), 1.0))
    assert math.isnan(
        _recorded_difference(float("inf"), float("inf"))
    )  # float inf - inf, as before
    assert _recorded_difference(float("inf"), 1.0) == float("inf")
    assert _recorded_difference(1.0, float("inf")) == float("-inf")


def test_recorded_difference_invalid_values_raise_as_before() -> None:
    with pytest.raises(ValueError):
        _recorded_difference("not a number", 1.0)
    with pytest.raises(TypeError):
        _recorded_difference(None, 1.0)
