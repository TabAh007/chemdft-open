"""Bounded metadata queries. No object store, full result bodies, PDFs or scientific execution.

Nine queries at most (including project authorization in service.py); row windows are 501.
Overflow is reported and blocks new compute/comparison instead of pretending history is complete.
JSON array metrics run inside the database (SQLite tests and PostgreSQL production).
"""

from collections import Counter

from sqlalchemy import Float, String, and_, cast, exists, func, literal, or_, select
from sqlalchemy.orm import Session, aliased

from ..errors import ScientificReferenceNotFound
from ..scientific_models import (
    CalculationInputRecord as I,
)
from ..scientific_models import (
    CalculationRecord as C,
)
from ..scientific_models import (
    CalculationResultRecord as R,
)
from ..scientific_models import (
    ExperimentalDatasetRecord as D,
)
from ..scientific_models import (
    ImportedResultRecord,
    ScientificDocumentRecord,
    SpectrumComparisonRecord,
    SpectrumConfirmationRecord,
    StructureCandidateRecord,
)
from ..scientific_models import (
    OptimizationTrajectoryRecord as O,
)
from ..scientific_models import (
    ProvenanceRecordRow as P,
)
from ..scientific_models import (
    ScientificArtifactRecord as A,
)
from ..scientific_models import (
    SpectrumAssociationRecord as S,
)
from ..scientific_models import (
    StructureRecord as ST,
)
from ..scientific_models import (
    StructureVersionRecord as V,
)
from .facts import (
    JobFacts,
    OptimizationFacts,
    ProjectFacts,
    ResultFacts,
    SpectrumFacts,
    StructureFacts,
)

WINDOW = 501


def extract(session: Session, project_id: str, version_id: str | None = None) -> ProjectFacts:
    postgres = session.bind.dialect.name == "postgresql"

    def array(value):
        return (
            func.json_array_elements(value).table_valued("value")
            if postgres
            else func.json_each(value).table_valued("value")
        )

    def field(value, key):
        return value.op("->>")(literal(key)) if postgres else func.json_extract(value, f"$.{key}")

    atoms = array(V.representation_json["coordinates"]["atoms"])
    symbols = (
        select(
            func.string_agg(field(atoms.c.value, "element"), literal(","))
            if postgres
            else func.group_concat(field(atoms.c.value, "element"), ",")
        )
        .select_from(atoms)
        .correlate(V)
        .scalar_subquery()
    )
    query = (
        select(
            V.id,
            V.structure_id,
            ST.name,
            ST.kind,
            V.atom_count,
            V.overall_charge,
            V.multiplicity,
            V.origin,
            V.periodic_cell_json["lattice_vectors"].label("lattice_vectors"),
            V.periodic_cell_json["a"].label("cell_a"),
            V.representation_json["coordinates"]["dimensionality"]
            .as_integer()
            .label("dimensionality"),
            A.sha256,
            P.id.label("provenance_id"),
            symbols.label("elements"),
        )
        .join(ST, and_(ST.id == V.structure_id, ST.project_id == project_id))
        .join(A, and_(A.id == V.canonical_artifact_id, A.project_id == project_id))
        .outerjoin(P, and_(P.id == V.provenance_record_id, P.project_id == project_id))
        .where(V.project_id == project_id)
    )
    if version_id:
        query = query.where(V.id == version_id)
    row = (
        session.execute(query.order_by(V.created_at.desc(), V.id.desc()).limit(1))
        .mappings()
        .first()
    )
    if version_id and row is None:
        raise ScientificReferenceNotFound("Structure version does not exist in this project.")
    structure = None
    if row:
        counts = Counter((row["elements"] or "").split(","))
        composition = " ".join(
            f"{symbol}{count if count != 1 else ''}"
            for symbol, count in sorted(counts.items())
            if symbol
        )
        structure = StructureFacts(
            id=row["id"],
            structure_id=row["structure_id"],
            name=row["name"],
            kind=row["kind"],
            dimensionality=row["dimensionality"],
            atom_count=row["atom_count"],
            charge=row["overall_charge"],
            multiplicity=row["multiplicity"],
            lattice=bool(row["lattice_vectors"] or row["cell_a"]),
            origin=row["origin"],
            canonical_hash=row["sha256"],
            provenance=bool(row["provenance_id"]),
            composition=composition,
        )
    p = R.payload_json
    modes = array(p["modes"])
    invalid_modes = exists(
        select(literal(1))
        .select_from(modes)
        .where(
            or_(
                cast(field(modes.c.value, "frequency_cm1"), String) == "",
                cast(field(modes.c.value, "frequency_cm1"), String).is_(None),
                cast(field(modes.c.value, "frequency_cm1"), Float) <= 0,
                cast(field(modes.c.value, "imaginary"), String).in_(["1", "true"]),
            )
        )
    ).correlate(R)
    mode_count = func.coalesce(func.json_array_length(p["modes"]), 0)
    # Project scalar metadata only; scientific arrays stay in the database.
    projections = [
        R.id,
        R.calculation_id,
        I.structure_version_id,
        R.result_type,
        R.authority,
        R.validation_state,
        R.source_class,
        R.trusted_producer_id,
        C.state,
        I.specification_json.label("spec"),
        p["converged"].as_boolean().label("converged"),
        p["total_energy"].label("energy"),
        p["total_energy_hartree"].label("orbital_energy"),
        p["final_energy"].label("final_energy"),
        p["method"].as_string().label("method"),
        p["basis"].as_string().label("basis"),
        p["engine"].as_string().label("engine"),
        p["input_structure_hash"].as_string().label("input_hash"),
        p["charge"].as_integer().label("charge"),
        p["multiplicity"].as_integer().label("multiplicity"),
        mode_count.label("mode_count"),
        invalid_modes.label("invalid_modes"),
        p["expected_vibrational_mode_count"].as_integer().label("expected_modes"),
        p["intensity_unit"].as_string().label("intensity_unit"),
        p["raman_activity_unit"].as_string().label("raman_unit"),
        p["hessian_artifact"]["artifact_id"].as_string().label("hessian_id"),
        p["coefficient_artifact"]["artifact_id"].as_string().label("coefficient_id"),
        func.coalesce(func.json_array_length(p["orbitals"]), 0).label("orbital_count"),
        func.coalesce(func.json_array_length(p["frontier_by_spin"]), 0).label("frontier_count"),
        p["conditions"]["temperature_k"].as_float().label("temperature"),
        p["conditions"]["pressure_pa"].as_float().label("pressure"),
        p["final_structure_version_id"].as_string().label("final_version_id"),
        p["final_structure_hash"].as_string().label("final_hash"),
        P.id.label("provenance_id"),
    ]
    rows = (
        session.execute(
            select(*projections)
            .join(
                I,
                and_(
                    I.id == R.calculation_input_id,
                    I.project_id == project_id,
                    I.calculation_id == R.calculation_id,
                ),
            )
            .join(C, and_(C.id == R.calculation_id, C.project_id == project_id))
            .outerjoin(P, and_(P.id == R.provenance_record_id, P.project_id == project_id))
            .where(R.project_id == project_id)
            .order_by(R.created_at.desc(), R.id.desc())
            .limit(WINDOW)
        )
        .mappings()
        .all()
    )
    results = []
    for r in rows:
        if (
            (r["authority"], r["validation_state"], r["source_class"], r["state"])
            != ("AUTHORITATIVE", "VALIDATED", "CALCULATED", "SUCCEEDED")
            or not r["trusted_producer_id"]
            or not r["provenance_id"]
        ):
            continue
        from sqlalchemy.orm import defer

        from ..effective_result_state import effective_result_state
        record = session.get(R, r["id"], options=[defer(R.payload_json)])
        if not effective_result_state(session, record).eligible_for_derivation:
            continue
        spec = r["spec"]
        schema = r["result_type"]
        converged = r["converged"] is True or schema in {
            "chemdft.vibrational-analysis",
            "chemdft.thermochemistry",
        }
        results.append(
            ResultFacts(
                id=r["id"],
                calculation_id=r["calculation_id"],
                version_id=r["structure_version_id"],
                schema=schema,
                task=spec.get("task_type", ""),
                method=r["method"] or spec.get("method", {}).get("identifier", ""),
                basis=r["basis"] or (spec.get("basis") or {}).get("identifier", ""),
                engine=r["engine"] or spec.get("engine_preference", {}).get("engine", ""),
                converged=converged,
                energy=any(r[k] is not None for k in ("energy", "orbital_energy", "final_energy")),
                orbitals=bool(r["orbital_count"] and schema == "chemdft.molecular-orbitals"),
                frontier=bool(r["frontier_count"]),
                ir=bool(r["intensity_unit"] == "km/mol" and r["mode_count"]),
                raman=bool(r["raman_unit"] and r["mode_count"]),
                modes_valid=bool(
                    r["mode_count"]
                    and r["mode_count"] == r["expected_modes"]
                    and not r["invalid_modes"]
                ),
                imaginary=bool(r["invalid_modes"]),
                hessian=bool(r["hessian_id"]),
                input_hash=r["input_hash"],
                charge=r["charge"],
                multiplicity=r["multiplicity"],
                temperature=r["temperature"],
                pressure=r["pressure"],
                final_version_id=r["final_version_id"],
                final_hash=r["final_hash"],
                coefficients=bool(r["coefficient_id"]),
                provenance=True,
            )
        )
    jobs_rows = (
        session.execute(
            select(
                C.id,
                C.state,
                I.structure_version_id,
                I.specification_json["task_type"].as_string().label("task"),
            )
            .join(I, and_(I.calculation_id == C.id, I.project_id == project_id))
            .where(C.project_id == project_id)
            .order_by(C.created_at.desc(), C.id.desc())
            .limit(WINDOW)
        )
        .mappings()
        .all()
    )
    jobs = tuple(
        JobFacts(r["id"], r["structure_version_id"], r["task"], r["state"]) for r in jobs_rows
    )
    last_gradient = (
        func.json_extract(O.steps_json, "$[#-1].gradient_rms_hartree_per_bohr")
        if not postgres
        else O.steps_json[-1]["gradient_rms_hartree_per_bohr"].as_float()
    )
    optimization_rows = (
        session.execute(
            select(
                O.calculation_id,
                O.final_structure_version_id,
                O.state,
                last_gradient.label("gradient"),
            )
            .where(
                O.project_id == project_id,
                O.final_structure_version_id == (structure.id if structure else ""),
            )
            .order_by(O.created_at.desc(), O.id.desc())
            .limit(WINDOW)
        )
        .mappings()
        .all()
    )
    optimizations = tuple(
        OptimizationFacts(
            r["calculation_id"],
            r["final_structure_version_id"],
            r["state"] == "CONVERGED",
            r["gradient"],
        )
        for r in optimization_rows
    )
    current_association = (
        select(S.id)
        .where(S.project_id == project_id, S.dataset_id == D.id)
        .order_by(S.created_at.desc(), S.id.desc())
        .limit(1)
        .correlate(D)
        .scalar_subquery()
    )
    root = D.spectrum_json["root_dataset_id"].as_string()
    confirmed_root = exists(
        select(literal(1)).where(
            SpectrumConfirmationRecord.project_id == project_id,
            SpectrumConfirmationRecord.dataset_id == root,
        )
    )
    child = aliased(D)
    peak_set = exists(
        select(child.id).where(
            child.project_id == project_id,
            child.spectrum_json["kind"].as_string() == "PEAKS",
            child.spectrum_json["parent_dataset_id"].as_string() == D.id,
        )
    ).correlate(D)
    spectrum_rows = (
        session.execute(
            select(
                D.id,
                D.spectrum_json["technique"].as_string().label("technique"),
                D.spectrum_json["kind"].as_string().label("kind"),
                S.state,
                S.structure_id,
                peak_set.label("peak_set"),
            )
            .outerjoin(S, and_(S.id == current_association, S.project_id == project_id))
            .where(D.project_id == project_id, D.spectrum_json.is_not(None), confirmed_root)
            .order_by(D.created_at.desc(), D.id.desc())
            .limit(WINDOW)
        )
        .mappings()
        .all()
    )
    spectra = tuple(
        SpectrumFacts(
            r["id"],
            r["technique"],
            r["structure_id"] if r["state"] == "ASSOCIATED_WITH_STRUCTURE" else None,
            r["kind"] != "RAW",
            r["peak_set"],
        )
        for r in spectrum_rows
        if r["technique"] in {"IR", "RAMAN", "UVVIS"} and r["kind"] != "PEAKS"
    )
    comparisons = session.execute(
        select(
            SpectrumComparisonRecord.experimental_dataset_id,
            SpectrumComparisonRecord.source_id,
            SpectrumComparisonRecord.technique,
        )
        .where(
            SpectrumComparisonRecord.project_id == project_id,
            SpectrumComparisonRecord.source_kind == "CALCULATION_RESULT",
        )
        .order_by(SpectrumComparisonRecord.created_at.desc())
        .limit(WINDOW)
    ).all()
    counts = (
        session.execute(
            select(
                select(func.count())
                .select_from(ScientificDocumentRecord)
                .where(ScientificDocumentRecord.project_id == project_id)
                .scalar_subquery()
                .label("documents"),
                select(func.count())
                .select_from(ImportedResultRecord)
                .where(
                    ImportedResultRecord.project_id == project_id,
                    ImportedResultRecord.authority == "IMPORTED",
                    ImportedResultRecord.validation_state == "VALIDATED",
                )
                .scalar_subquery()
                .label("imports"),
                select(func.count())
                .select_from(StructureCandidateRecord)
                .where(
                    StructureCandidateRecord.project_id == project_id,
                    StructureCandidateRecord.candidate_state.in_(["DETECTED"]),
                )
                .scalar_subquery()
                .label("candidates"),
            )
        )
        .mappings()
        .one()
    )
    # A committed field artifact proves a grid exists; its bytes and manifests are never opened.
    stored_fields = session.scalars(
        select(A.extensions_json[0]["values"]["field_kind"].as_string())
        .where(
            A.project_id == project_id,
            A.format_identifier == "chemdft.volumetric-field.npz",
            A.source_relation_type == "calculation.result",
            A.source_relation_id.in_(
                [r.id for r in results if structure and r.version_id == structure.id]
            ),
        )
        .distinct()
    ).all()
    field_names = {
        "MO_AMPLITUDE": "orbital",
        "ELECTRON_DENSITY": "density",
        "ELECTROSTATIC_POTENTIAL": "esp",
    }
    grid_types = tuple(sorted({field_names[kind] for kind in stored_fields if kind in field_names}))

    return ProjectFacts(
        project_id=project_id,
        structure=structure,
        results=tuple(results),
        jobs=jobs,
        optimizations=optimizations,
        spectra=spectra,
        comparisons=tuple(tuple(r) for r in comparisons),
        grid_types=grid_types,
        documents=counts["documents"],
        imported_results=counts["imports"],
        candidates=counts["candidates"],
        history_complete=all(
            len(records) < WINDOW
            for records in (rows, jobs_rows, optimization_rows, spectrum_rows, comparisons)
        ),
    )
