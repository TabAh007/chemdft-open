"""Typed scientific tools for AI molecule identification and draft creation.

Strictly adheres to AS-0 contracts:
- `molecule.resolve`: deterministic catalogue resolution + ambiguity detection.
- `molecule.draft.create`: RDKit 2D depiction + ETKDGv3 3D conformer candidate.
- Origin-aware provenance: ProvenanceClass.AI_HYPOTHESIS, NOT falsely labeled USER_SUPPLIED.
- Server-side project authorization and idempotency fencing.
- No unapproved formal geometry acceptance: artifacts are created in PENDING_ACCEPTANCE state.
"""

from __future__ import annotations

import hashlib
from uuid import UUID

from rdkit import Chem
from rdkit.Chem import AllChem
from sqlalchemy.orm import Session

from ..actions import authorize_project_access
from ..contracts.geometry import (
    GeometryAtomMapping,
    GeometryCandidateManifest,
)
from ..contracts.molecule_tools import (
    MoleculeAlternative,
    MoleculeDraftCreateInput,
    MoleculeDraftCreateOutput,
    MoleculeResolveInput,
    MoleculeResolveOutput,
)
from ..contracts.provenance import (
    ProducerKind,
    ProvenanceClass,
    ProvenanceDetail,
    VerificationState,
)
from ..contracts.tools import ToolErrorCode
from ..geometry_actions import (
    _artifact_reference,
    _store,
)
from ..geometry_eligibility import (
    CANDIDATE_FORMAT,
)
from ..models import new_id
from ..project_access import ProjectCapability, can
from ..scientific.molecular_geometry import (
    GENERATION_METHOD,
    generate_conformer,
    generation_parameters,
    parse_drawing,
)
from ..scientific.molecule_identity import (
    resolve_molecule_identity,
    validate_molecular_graph,
)
from ..scientific.structures import (
    canonical_bytes,
)
from ..scientific_models import (
    ProvenanceRecordRow,
)
from ..storage import ObjectStore
from ..tool_registry.registry import ToolInvocationContext, ToolInvocationError
from .action_receipts import (
    ActionAbandonedError,
    ActionBusyError,
    ActionConflictError,
    begin_action,
    canonical_digest,
    complete_action,
    fail_action,
)
from .events import AIRunEventManager
from .execution import StaleWorkerFencedError

MOLECULE_DRAFT_OPERATION = "ai.molecule.draft.create"
MOLECULE_DRAFT_TOOL = "molecule.draft.create"


def handle_molecule_resolve(
    session: Session,
    context: ToolInvocationContext,
    payload: MoleculeResolveInput,
) -> MoleculeResolveOutput:
    """Deterministically resolves chemical identity or identifies ambiguity."""
    if not context.project_id:
        raise ToolInvocationError(
            ToolErrorCode.FORBIDDEN, "molecule.resolve requires a current project context."
        )
    # Validate project read access
    authorize_project_access(session, context.identity, str(context.project_id))

    # External lookups need an explicit disclosure policy (AS-0); a model-supplied flag can never
    # enable one, so the request flag is ignored and the limitation is reported.
    res = resolve_molecule_identity(
        payload.name,
        allow_smiles=payload.allow_smiles,
        allow_pubchem=False,
    )

    if res.resolved and res.identity is not None:
        ident = res.identity
        return MoleculeResolveOutput(
            resolved=True,
            name=ident.name,
            canonical_isomeric_smiles=ident.canonical_isomeric_smiles,
            formula=ident.formula,
            charge=ident.charge,
            multiplicity=ident.multiplicity,
            stereo_status=ident.stereo_status,
            identity_source=ident.identity_source,
            source_hash=ident.source_hash,
            heavy_atom_count=ident.heavy_atom_count,
            clarification_required=False,
            clarification_prompt=None,
            alternatives=(),
            diagnostics=(),
        )

    alternatives = tuple(
        MoleculeAlternative(
            name=alt.name,
            canonical_isomeric_smiles=alt.canonical_isomeric_smiles,
            formula=alt.formula,
            description=alt.description,
        )
        for alt in res.alternatives
    )

    return MoleculeResolveOutput(
        resolved=False,
        name=payload.name,
        canonical_isomeric_smiles=None,
        formula=None,
        charge=None,
        multiplicity=None,
        stereo_status=None,
        identity_source=None,
        source_hash=None,
        heavy_atom_count=None,
        clarification_required=res.clarification_required,
        clarification_prompt=res.clarification_prompt,
        alternatives=alternatives,
        diagnostics=res.diagnostics,
    )




def draft_arguments_digest(payload: MoleculeDraftCreateInput) -> str:
    """Hash of the *scientific* arguments; the model-visible action_key is not part of it."""
    smiles = payload.canonical_isomeric_smiles.strip()
    parsed = Chem.MolFromSmiles(smiles)
    if parsed is not None:
        smiles = Chem.MolToSmiles(parsed, isomericSmiles=True)
    return canonical_digest(
        {
            "name": payload.name.strip(),
            "smiles": smiles,
            "charge": payload.expected_charge,
            "multiplicity": payload.multiplicity,
        }
    )


def _output_from_result(result: dict) -> MoleculeDraftCreateOutput:
    return MoleculeDraftCreateOutput.model_validate(result)


def handle_molecule_draft_create(
    session: Session,
    object_store: ObjectStore,
    context: ToolInvocationContext,
    payload: MoleculeDraftCreateInput,
) -> MoleculeDraftCreateOutput:
    """Generates 2D depiction and 3D RDKit conformer candidate for a resolved molecule.

    Idempotency, fencing and the activity event are atomic with the effect (see action_receipts):
    the artifacts, provenance, receipt and ``object.created`` event commit in one transaction, or
    none of them does.
    """
    if not context.project_id:
        raise ToolInvocationError(
            ToolErrorCode.FORBIDDEN, "molecule.draft.create requires a current project context."
        )
    project_id = str(context.project_id)
    # Live membership is re-read on every call, so a revoked or downgraded role fails here.
    project, member = authorize_project_access(session, context.identity, project_id)
    if not can(member, ProjectCapability.WRITE):
        raise ToolInvocationError(
            ToolErrorCode.FORBIDDEN, "Creating molecular drafts requires WRITE project capability."
        )

    binding = context.execution
    # The server-bound identity wins; a model- or caller-supplied key is only a fallback for
    # non-supervised transports and can never alias another action (same key + other args = 409).
    action_key = binding.action_key if binding is not None else payload.action_key
    digest = draft_arguments_digest(payload)
    events = AIRunEventManager(session)
    try:
        receipt = begin_action(
            session,
            project_id=project.id,
            run_id=binding.run_id if binding else None,
            epoch=binding.epoch if binding else None,
            tool_name=MOLECULE_DRAFT_TOOL,
            action_key=action_key,
            arguments_sha256=digest,
        )
    except ActionConflictError as error:
        raise ToolInvocationError(ToolErrorCode.CONFLICT, str(error)) from error
    except ActionAbandonedError as error:
        raise ToolInvocationError(
            ToolErrorCode.CONFLICT, "The run that owned this action was stopped."
        ) from error
    except ActionBusyError as error:
        raise ToolInvocationError(
            ToolErrorCode.CONFLICT, "Another active run is executing this action."
        ) from error

    if receipt.status == "COMPLETED" and receipt.result is not None:
        output = _output_from_result(receipt.result)
        if binding is not None and receipt.run_id != binding.run_id:
            # A different run re-requested an identical draft: say so, do not claim creation.
            events.record_event(
                project.id,
                binding.run_id,
                "object.reused",
                f"Reused existing molecular draft for {output.name}.",
                {
                    "candidate_id": str(output.candidate_id),
                    "name": output.name,
                    "formula": output.formula,
                    "view_action": "open_molecule_viewer",
                },
                epoch=binding.epoch,
                dedupe_on=("candidate_id", str(output.candidate_id)),
            )
            session.commit()
        return output

    try:
        return _create_draft(
            session, object_store, context, payload, project.id, action_key, digest, events
        )
    except StaleWorkerFencedError:
        raise  # already rolled back by complete_action; the receipt is Pause/Stop's to decide
    except Exception:
        # Nothing flushed for an aborted effect may ever be committed by a later commit on this
        # shared session: discard it, then record the (retryable) failure.
        session.rollback()
        fail_action(session, project.id, action_key, "REJECTED")
        raise


def _create_draft(
    session: Session,
    object_store: ObjectStore,
    context: ToolInvocationContext,
    payload: MoleculeDraftCreateInput,
    project_id: str,
    action_key: str,
    digest: str,
    events: AIRunEventManager,
) -> MoleculeDraftCreateOutput:
    binding = context.execution

    # Identity binding: the model may not attach an arbitrary graph to a chemical name. The name
    # must resolve (reviewed catalogue / explicit SMILES) to exactly this graph.
    mol = Chem.MolFromSmiles(payload.canonical_isomeric_smiles.strip())
    if mol is None:
        raise ToolInvocationError(
            ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED,
            f"Invalid SMILES string: '{payload.canonical_isomeric_smiles}'.",
        )
    valid, reason, info = validate_molecular_graph(mol)
    if not valid:
        raise ToolInvocationError(
            ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED,
            f"Molecular graph validation failed: {reason}",
        )
    resolution = resolve_molecule_identity(payload.name, allow_smiles=True, allow_pubchem=False)
    if not resolution.resolved or resolution.identity is None:
        raise ToolInvocationError(
            ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED,
            f"'{payload.name}' is not a resolved chemical identity; call molecule.resolve "
            "and use its returned name and SMILES, or ask the researcher to clarify.",
        )
    if resolution.identity.canonical_isomeric_smiles != info["canonical_isomeric_smiles"]:
        raise ToolInvocationError(
            ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED,
            f"The structure does not match the resolved identity of '{payload.name}'. "
            "No draft was created.",
        )
    if info["stereo_status"] == "AMBIGUOUS":
        raise ToolInvocationError(
            ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED,
            "The structure has unspecified stereocenters; clarification is required.",
        )

    # 2D depiction (deterministic) and 3D ETKDGv3 conformer.
    AllChem.Compute2DCoords(mol)
    mol_block = Chem.MolToMolBlock(mol)
    parsed = parse_drawing(mol_block)
    generated = generate_conformer(parsed, payload.name, multiplicity=payload.multiplicity)
    if generated.coordinates.overall_charge != payload.expected_charge:
        raise ToolInvocationError(
            ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED,
            f"Expected charge ({payload.expected_charge}) disagrees with generated structure "
            f"({generated.coordinates.overall_charge}).",
        )

    source_artifact = _store(
        session,
        context.identity,
        object_store,
        project_id,
        mol_block.encode("utf-8"),
        kind="STRUCTURE_FILE",
        format_identifier="MOL",
    )
    manifest = GeometryCandidateManifest(
        source_drawing=_artifact_reference(source_artifact),
        source_graph_sha256=hashlib.sha256(generated.canonical_smiles.encode()).hexdigest(),
        canonical_smiles=generated.canonical_smiles,
        formula=generated.formula,
        source_atom_count=generated.source_atom_count,
        explicit_hydrogen_count=generated.explicit_hydrogen_count,
        atom_mapping=tuple(
            GeometryAtomMapping(
                generated_atom_index=i,
                source_atom_index=source_index,
                hydrogen_parent_source_index=generated.hydrogen_parent_indices[i],
            )
            for i, source_index in enumerate(generated.source_atom_indices)
        ),
        generation_method=GENERATION_METHOD,
        generation_parameters=generation_parameters(),
        geometry_class="GENERATED_CONFORMER_NOT_OPTIMIZED",
        coordinate_representation=generated.coordinates,
        parent_structure_version=None,
    )
    candidate_artifact = _store(
        session,
        context.identity,
        object_store,
        project_id,
        canonical_bytes(manifest.model_dump(mode="json")),
        kind="COORDINATES",
        format_identifier=CANDIDATE_FORMAT,
        source_id=source_artifact.id,
    )
    # AI_HYPOTHESIS origin: model proposals are never recorded as user-supplied geometry.
    provenance = ProvenanceRecordRow(
        project_id=project_id,
        subject_type="geometry.candidate",
        subject_id=candidate_artifact.id,
        source_class=ProvenanceClass.AI_HYPOTHESIS,
        detail=ProvenanceDetail.DETERMINISTIC_TRANSFORM,
        verification_state=VerificationState.UNVERIFIED,
        producer_kind=ProducerKind.SOFTWARE,
        producer_identifier="chemdft.ai.molecule_creator",
        producer_software_version=str(generation_parameters()["rdkit_version"]),
        source_artifact_id=source_artifact.id,
        operation=MOLECULE_DRAFT_OPERATION,
        operation_version="1.0.0",
        parameters_json=[
            {"key": "candidate_sha256", "value": candidate_artifact.sha256},
            {"key": "source_graph_sha256", "value": manifest.source_graph_sha256},
            {"key": "action_key", "value": action_key},
            {"key": "arguments_sha256", "value": digest},
            {"key": "model_proposed", "value": "true"},
        ],
        approximate=True,
        correlation_id=new_id(),
    )
    session.add(provenance)
    session.flush()

    output = MoleculeDraftCreateOutput(
        candidate_id=UUID(candidate_artifact.id),
        project_id=UUID(project_id),
        name=payload.name,
        canonical_smiles=generated.canonical_smiles,
        formula=generated.formula,
        source_atom_count=generated.source_atom_count,
        explicit_hydrogen_count=generated.explicit_hydrogen_count,
        state="PENDING_ACCEPTANCE",
        geometry_class="GENERATED_CONFORMER_NOT_OPTIMIZED",
        candidate_artifact_id=UUID(candidate_artifact.id),
        drawing_artifact_id=UUID(source_artifact.id),
        provenance_id=UUID(provenance.id),
    )
    event = (
        (
            "object.created",
            f"Created molecular draft for {payload.name}.",
            {
                "candidate_id": str(output.candidate_id),
                "name": payload.name,
                "formula": output.formula,
                "view_action": "open_molecule_viewer",
            },
            ("candidate_id", str(output.candidate_id)),
        )
        if binding is not None
        else None
    )
    try:
        committed, receipt = complete_action(
            session,
            events,
            project_id=project_id,
            action_key=action_key,
            run_id=binding.run_id if binding else None,
            epoch=binding.epoch if binding else None,
            result=output.model_dump(mode="json"),
            effect_entity_id=candidate_artifact.id,
            event=event,
        )
    except ActionAbandonedError as error:
        raise ToolInvocationError(
            ToolErrorCode.CONFLICT, "The run that owned this action was stopped."
        ) from error
    if not committed and receipt.result is not None:
        # Another worker committed the identical action first; ours was rolled back.
        return _output_from_result(receipt.result)
    return output
