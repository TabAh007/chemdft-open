from __future__ import annotations

from uuid import UUID, uuid5

from sqlalchemy.orm import Session

from .actions import authorize_project_access
from .context import Identity
from .contracts.scientific_claims import (
    ProjectScientificClaimsOutput,
    ProjectScientificComparisonOutput,
    ScientificClaim,
    ScientificClaimRelation,
    ScientificComparisonRow,
    ScientificComparisonSummary,
)
from .scientific_claim_actions import get_project_scientific_claims

_ROW_NAMESPACE = UUID("b3bc0402-b330-550d-9c31-03b149fe1b59")
_SOURCE_AUTHORITIES = {"EXTRACTED", "USER_ENTERED"}
_SECTION_ORDER = {
    "Synthesis": 0,
    "Crystallography": 1,
    "Structure": 2,
    "XRD": 3,
    "Thermal analysis": 4,
    "Particle characterization": 5,
    "Calculated results": 6,
}


def _section(claim: ScientificClaim) -> str:
    key = (claim.quantity_key or "").casefold()
    text = f"{claim.subject} {claim.predicate}".casefold()
    if key.startswith("cvd.") or "synthesis" in text or "feed gas" in text:
        return "Synthesis"
    if key.startswith("crystal.cell."):
        return "Crystallography"
    if key.startswith("xrd.") or key.startswith("diffraction"):
        return "XRD"
    if key.startswith("dls.") or "particle" in text or "dls" in text:
        return "Particle characterization"
    if key.startswith("thermal.") or "thermal" in text or "decomposition" in text:
        return "Thermal analysis"
    if claim.claim_type == "STRUCTURE_ASSERTION" or "structure" in text:
        return "Structure"
    if claim.source_authority == "CALCULATED" or claim.source_record_type == "calculation_result":
        return "Calculated results"
    if claim.claim_type in {"COMPOSITION", "EXPERIMENTAL_CONDITION"}:
        return "Synthesis"
    return "Structure"


def _topic(claim: ScientificClaim) -> str:
    if claim.quantity_key == "xrd.two_theta.peak_position":
        return claim.predicate
    if claim.quantity_key == "crystal.cell.a":
        return "Cell parameter a"
    if claim.quantity_key == "crystal.cell.b":
        return "Cell parameter b"
    if claim.quantity_key == "crystal.cell.c":
        return "Cell parameter c"
    if claim.quantity_key and claim.quantity_key.startswith("crystal.cell."):
        return f"Cell parameter {claim.quantity_key.rsplit('.', 1)[-1]}"
    return claim.predicate[:1].upper() + claim.predicate[1:]


def _pairable_relation(
    relation: ScientificClaimRelation,
    claims_by_id: dict[UUID, ScientificClaim],
) -> tuple[ScientificClaim, ScientificClaim] | None:
    left = claims_by_id.get(relation.left_claim_id)
    right = claims_by_id.get(relation.right_claim_id)
    if (
        left is None
        or right is None
        or any(c.semantic_status == "INACTIVE_SOURCE" for c in (left, right))
    ):
        return None
    if (
        left.source_authority in _SOURCE_AUTHORITIES
        and right.source_authority not in _SOURCE_AUTHORITIES
    ):
        source, project = left, right
    elif (
        right.source_authority in _SOURCE_AUTHORITIES
        and left.source_authority not in _SOURCE_AUTHORITIES
    ):
        source, project = right, left
    else:
        return None
    # A paper claim can only pair with project data explicitly linked to that
    # same paper. This keeps relations safe when a project has multiple sources.
    if source.source_document_id is None or source.source_document_id != project.source_document_id:
        return None
    return source, project


def _row(
    source_claims: tuple[ScientificClaim, ...],
    project_claims: tuple[ScientificClaim, ...],
    *,
    relation: str,
    delta: float | None = None,
    delta_unit: str | None = None,
    comparison_rule: str | None = None,
    unresolved_reason: str | None = None,
) -> ScientificComparisonRow:
    claims = source_claims + project_claims
    quantity_key = next((claim.quantity_key for claim in claims if claim.quantity_key), None)
    document_id = next(
        (claim.source_document_id for claim in source_claims if claim.source_document_id), None
    )
    topic_claim = source_claims[0] if source_claims else project_claims[0]
    stable_identity = ":".join(
        [relation, str(document_id or "project-only"), *(str(claim.id) for claim in claims)]
    )
    return ScientificComparisonRow(
        id=str(uuid5(_ROW_NAMESPACE, stable_identity)),
        section=_section(topic_claim),
        topic=_topic(topic_claim),
        quantity_key=quantity_key,
        source_document_id=document_id,
        source_claims=source_claims,
        project_claims=project_claims,
        relation=relation,
        delta=delta,
        delta_unit=delta_unit,
        comparison_rule=comparison_rule,
        authority_summary=tuple(sorted({claim.source_authority for claim in claims})),
        review_summary=tuple(sorted({claim.review_state for claim in claims})),
        unresolved_reason=unresolved_reason,
    )


def build_scientific_comparison(
    claims_output: ProjectScientificClaimsOutput,
) -> ProjectScientificComparisonOutput:
    claims_by_id = {claim.id: claim for claim in claims_output.claims}
    source_claims = [
        claim for claim in claims_output.claims if claim.source_authority in _SOURCE_AUTHORITIES
    ]
    project_claims = [
        claim for claim in claims_output.claims if claim.source_authority not in _SOURCE_AUTHORITIES
    ]
    rows: list[ScientificComparisonRow] = []
    consumed: set[UUID] = set()

    for relation in claims_output.relations:
        pair = _pairable_relation(relation, claims_by_id)
        if pair is None:
            continue
        source, project = pair
        source_valid = source.semantic_status != "SOURCE_UNAVAILABLE" and bool(source.source_href)
        relation_name = relation.relation if source_valid else "UNRESOLVED"
        reason = (
            None
            if source_valid
            else "The linked source passage is unavailable or cannot be opened."
        )
        rows.append(
            _row(
                (source,),
                (project,),
                relation=relation_name,
                delta=relation.numeric_delta if relation_name == "SAME_QUANTITY" else None,
                delta_unit=relation.delta_unit if relation_name == "SAME_QUANTITY" else None,
                comparison_rule=(
                    f"{relation.rationale} Delta convention: source minus ChemDFT."
                    if relation.numeric_delta is not None and relation_name == "SAME_QUANTITY"
                    else relation.rationale
                ),
                unresolved_reason=reason,
            )
        )
        consumed.update((source.id, project.id))

    # The structure figure and promoted version are connected by an existing
    # source-evidence link; this relation is projected from that record binding.
    for source in source_claims:
        if source.id in consumed or source.claim_type != "STRUCTURE_ASSERTION":
            continue
        linked = next(
            (
                project
                for project in project_claims
                if project.id not in consumed
                and project.source_authority == "RECONSTRUCTED"
                and project.evidence_id == source.source_record_id
                and project.source_document_id == source.source_document_id
            ),
            None,
        )
        if linked is not None:
            source_valid = source.semantic_status != "SOURCE_UNAVAILABLE" and bool(
                source.source_href
            )
            rows.append(
                _row(
                    (source,),
                    (linked,),
                    relation="DERIVED_FROM" if source_valid else "UNRESOLVED",
                    comparison_rule=(
                        "Structure version records the source evidence used for reconstruction."
                    ),
                    unresolved_reason=None
                    if source_valid
                    else "The linked source passage is unavailable or cannot be opened.",
                )
            )
            consumed.update((source.id, linked.id))

    for claim in claims_output.claims:
        if claim.id in consumed:
            continue
        is_source = claim.source_authority in _SOURCE_AUTHORITIES
        available = claim.semantic_status != "SOURCE_UNAVAILABLE"
        relation = "SOURCE_ONLY" if is_source else "PROJECT_ONLY"
        reason = None
        if claim.semantic_status == "INACTIVE_SOURCE":
            relation, reason = (
                "UNRESOLVED",
                "Historical evidence: current result/source lineage is inactive.",
            )
        if is_source and not available:
            relation, reason = "UNRESOLVED", "The source claim has no valid linked passage."
        rule = None
        literature_keys = {"literature.relative_energy", "literature.user_entered"}
        if is_source and claim.quantity_key in literature_keys:
            # F-024: never pair a paper energy with an unoptimized or different-level energy.
            relation = "UNRESOLVED"
            reason = reason or (
                "Not compared: the paper reports this at its own level of theory on optimized "
                "geometries. ChemDFT results in this project are not the same quantity at the same "
                "level on optimized geometries, so no difference is computed."
            )
            rule = (
                "Paper value shown as reported; a comparison needs the same quantity, level and "
                "optimized geometry."
            )
        rows.append(
            _row(
                (claim,) if is_source else (),
                () if is_source else (claim,),
                relation=relation,
                comparison_rule=rule,
                unresolved_reason=reason,
            )
        )

    def row_order(row: ScientificComparisonRow) -> tuple[int, str, float, str]:
        source_value = row.source_claims[0].value if row.source_claims else None
        numeric_value = (
            float(source_value)
            if row.quantity_key == "xrd.two_theta.peak_position"
            and isinstance(source_value, (int, float))
            else float("inf")
        )
        return (
            _SECTION_ORDER.get(row.section, 99),
            row.topic.casefold(),
            numeric_value,
            row.id,
        )

    rows.sort(key=row_order)
    direct_count = sum(row.relation == "SAME_QUANTITY" for row in rows)
    summary = ScientificComparisonSummary(
        source_claims=len(source_claims),
        project_claims=len(project_claims),
        directly_comparable_pairs=direct_count,
        not_directly_comparable=sum(row.relation == "NOT_DIRECTLY_COMPARABLE" for row in rows),
        source_only_claims=sum(row.relation == "SOURCE_ONLY" for row in rows),
        project_only_claims=sum(row.relation == "PROJECT_ONLY" for row in rows),
        reconstructed_structures=sum(
            claim.source_authority == "RECONSTRUCTED" for claim in project_claims
        ),
        digitized_datasets=sum(
            claim.source_authority == "DIGITIZED"
            and claim.source_record_type == "experimental_dataset"
            and (claim.predicate in {"2θ digitized peak 1", "digitized size extent"})
            for claim in project_claims
        ),
        calculated_results=sum(claim.source_authority == "CALCULATED" for claim in project_claims),
    )
    return ProjectScientificComparisonOutput(
        project_id=claims_output.project_id,
        rows=tuple(rows),
        summary=summary,
    )


def get_project_scientific_comparison(
    session: Session, identity: Identity, project_id: str, locale: str = "en"
) -> ProjectScientificComparisonOutput:
    project, _member = authorize_project_access(session, identity, project_id)
    claims = get_project_scientific_claims(session, identity, project.id, locale)
    return build_scientific_comparison(claims)
