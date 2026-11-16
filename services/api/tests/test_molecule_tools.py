from uuid import UUID, uuid4
import pytest
from sqlalchemy.orm import Session

from chemdft_api.context import Identity
from chemdft_api.contracts.molecule_tools import (
    MoleculeDraftCreateInput,
    MoleculeDraftCreateOutput,
    MoleculeResolveInput,
    MoleculeResolveOutput,
)
from chemdft_api.contracts.provenance import ProvenanceClass
from chemdft_api.models import new_id, User, ProjectMember
from chemdft_api.scientific_models import ProvenanceRecordRow, ScientificArtifactRecord
from chemdft_api.storage import LocalObjectStore
from chemdft_api.tool_registry.catalog import build_application_tool_registry
from chemdft_api.tool_registry.registry import ToolInvocationContext, ToolInvocationError
from test_ai_scientist import _create_project


def test_molecule_resolve_tool(api):
    client, sessions, settings = api
    project_data = _create_project(client, name="Resolve Test Project")
    project_id = project_data["id"]

    with sessions() as session:
        store = LocalObjectStore(settings.object_root)
        registry = build_application_tool_registry(session, store, settings)
        identity = Identity(settings.dev_user_id, settings.dev_organization_id)

        ctx = ToolInvocationContext(
            request_id=uuid4(),
            identity=identity,
            project_id=UUID(project_id),
            capabilities=frozenset({"project.read"}),
            approval_references=frozenset(),
            transport="test",
            provider="test",
            model="test",
        )

        # Test methane
        out = registry.invoke("molecule.resolve", {"name": "methane"}, ctx)
        assert isinstance(out, MoleculeResolveOutput)
        assert out.resolved is True
        assert out.canonical_isomeric_smiles == "C"
        assert out.formula == "CH4"
        assert out.clarification_required is False

        # Test ambiguous xylene
        out_ambig = registry.invoke("molecule.resolve", {"name": "xylene"}, ctx)
        assert out_ambig.resolved is False
        assert out_ambig.clarification_required is True
        assert len(out_ambig.alternatives) == 3


def test_molecule_draft_create_tool_and_idempotency(api):
    client, sessions, settings = api
    project_data = _create_project(client, name="Draft Test Project")
    project_id = project_data["id"]

    with sessions() as session:
        store = LocalObjectStore(settings.object_root)
        registry = build_application_tool_registry(session, store, settings)
        identity = Identity(settings.dev_user_id, settings.dev_organization_id)

        ctx = ToolInvocationContext(
            request_id=uuid4(),
            identity=identity,
            project_id=UUID(project_id),
            capabilities=frozenset({"project.write"}),
            approval_references=frozenset(),
            transport="test",
            provider="test",
            model="test",
        )

        action_key = f"create-benzene-{new_id()}"
        draft_input = {
            "name": "benzene",
            "canonical_isomeric_smiles": "c1ccccc1",
            "action_key": action_key,
        }

        out1 = registry.invoke("molecule.draft.create", draft_input, ctx)
        assert isinstance(out1, MoleculeDraftCreateOutput)
        assert out1.name == "benzene"
        assert out1.canonical_smiles == "c1ccccc1"
        assert out1.formula == "C6H6"
        assert out1.state == "PENDING_ACCEPTANCE"
        assert out1.geometry_class == "GENERATED_CONFORMER_NOT_OPTIMIZED"

        # Check provenance: must be AI_HYPOTHESIS, NOT USER_SUPPLIED
        prov = session.get(ProvenanceRecordRow, str(out1.provenance_id))
        assert prov is not None
        assert prov.source_class == ProvenanceClass.AI_HYPOTHESIS
        assert prov.operation == "ai.molecule.draft.create"

        # Count coordinates artifacts before second call
        coords_count_1 = session.query(ScientificArtifactRecord).filter_by(
            project_id=project_id, kind="COORDINATES"
        ).count()

        # Second call with same action_key -> MUST be idempotent!
        out2 = registry.invoke("molecule.draft.create", draft_input, ctx)
        assert out2.candidate_id == out1.candidate_id
        assert out2.candidate_artifact_id == out1.candidate_artifact_id

        coords_count_2 = session.query(ScientificArtifactRecord).filter_by(
            project_id=project_id, kind="COORDINATES"
        ).count()
        assert coords_count_1 == coords_count_2, "Idempotent call must not duplicate artifacts!"


def test_molecule_draft_create_requires_write_capability(api):
    client, sessions, settings = api
    project_data = _create_project(client, name="Viewer Access Project")
    project_id = project_data["id"]

    with sessions() as session:
        store = LocalObjectStore(settings.object_root)
        registry = build_application_tool_registry(session, store, settings)

        # Create a read-only viewer user in DB
        viewer_id = new_id()
        viewer_user = User(id=viewer_id, email="viewer@chemdft.test", display_name="Viewer")
        session.add(viewer_user)
        session.commit()

        session.add(ProjectMember(project_id=project_id, user_id=viewer_id, role="viewer"))
        session.commit()
        viewer_identity = Identity(user_id=viewer_id, organization_id=settings.dev_organization_id)

        ctx = ToolInvocationContext(
            request_id=uuid4(),
            identity=viewer_identity,
            project_id=UUID(project_id),
            capabilities=frozenset({"project.read"}),
            approval_references=frozenset(),
            transport="test",
            provider="test",
            model="test",
        )

        with pytest.raises(ToolInvocationError) as exc_info:
            registry.invoke(
                "molecule.draft.create",
                {
                    "name": "methane",
                    "canonical_isomeric_smiles": "C",
                    "action_key": f"key-{new_id()}",
                },
                ctx,
            )
        assert (
            "lacks a required server-issued capability" in str(exc_info.value)
            or "editor/owner role is required" in str(exc_info.value)
            or "WRITE" in str(exc_info.value)
        )
