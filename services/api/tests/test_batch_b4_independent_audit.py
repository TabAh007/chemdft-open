"""AS-B4.1A independent backend audit: adversarial regression tests.

Only the DECIMER *model* boundary is replaced (see ``b4_support.stub_decimer``). Candidate locking,
representation persistence, reuse rules, the tool registry, the AI guard, run lifecycle, the
researcher gate, approvals and the compute queue are the production code paths.
"""

from __future__ import annotations

import contextlib
import threading
from uuid import uuid4

import pytest
from b4_support import stub_decimer
from chemdft_api.ai.service import AIScientistService, _make_approval_verifier
from chemdft_api.ai.tool_policy import AI_TOOLS, guard_ai_tool, validate_compute_guidance
from chemdft_api.ai_models import (
    AIApprovalRecord,
    AIRunEventRecord,
    AIRunRecord,
    AIRunStepRecord,
)
from chemdft_api.context import Identity
from chemdft_api.errors import ApplicationError, StructureElectronicStateMismatch
from chemdft_api.models import ProjectMember
from chemdft_api.scientific.engines.normalization import validate_electronic_state_composition
from chemdft_api.scientific.molecular_recognition.contracts import (
    RecognitionStatus,
)
from chemdft_api.scientific.molecular_recognition.engine import (
    DecimerSubprocessEngine,
)
from chemdft_api.scientific_models import (
    CalculationRecord,
    CandidateRepresentationRecord,
    ProvenanceRecordRow,
    StructureCandidateRecord,
)
from chemdft_api.storage import LocalObjectStore
from chemdft_api.tool_registry.catalog import build_application_tool_registry
from chemdft_api.tool_registry.registry import (
    ToolErrorCode,
    ToolInvocationContext,
    ToolInvocationError,
)
from sqlalchemy import func, select, update
from test_ai_scientist import _create_project, _import_h2
from test_batch_b3_verified_reconstruction import (
    _complete_b3_checklist,
    _pdf,
    _upload_pdf,
)

# --------------------------------------------------------------------------- helpers


def _ctx(settings, project_id, caps, transport="internal") -> ToolInvocationContext:
    return ToolInvocationContext(
        request_id=uuid4(),
        identity=Identity(settings.dev_user_id, settings.dev_organization_id),
        project_id=__import__("uuid").UUID(project_id),
        capabilities=frozenset(caps),
        approval_references=frozenset(),
        transport=transport,
        provider="fake",
        model="fake-standard",
    )


def _registry(session, settings):
    """The production AI registry: guard plus server-side approval verifier."""
    registry = build_application_tool_registry(
        session, LocalObjectStore(settings.object_root), settings
    )
    registry._approval_verifier = _make_approval_verifier(session)
    return registry


WRITE_CAPS = {"document.write", "structure_candidate.write", "structure_candidate.read"}


def _candidate(client, project_id) -> tuple[str, str]:
    doc_id = _upload_pdf(client, project_id)
    cand = client.post(f"/v1/projects/{project_id}/documents/{doc_id}/figures/extract").json()[
        "candidates"
    ][0]
    return doc_id, cand["id"]


def _distinct_candidate(client, project_id, width: int) -> tuple[str, str]:
    """A different figure (different bytes => different document and candidate)."""
    pdf = _pdf([("q 150 0 0 150 50 450 cm /Im1 Do Q", {"Im1": (width, 100, (255, 255, 255))})])
    resp = client.post(
        f"/v1/projects/{project_id}/documents/imports",
        files={"upload": (f"paper-{width}.pdf", pdf, "application/pdf")},
    )
    assert resp.status_code == 201, resp.text
    doc_id = resp.json()["document"]["id"]
    cand = client.post(f"/v1/projects/{project_id}/documents/{doc_id}/figures/extract").json()[
        "candidates"
    ][0]
    return doc_id, cand["id"]


def _gated_run(client, project_id, doc_id, cand_id) -> str:
    conv = client.post(f"/v1/projects/{project_id}/ai/conversations", json={}).json()
    conv_id = conv["conversation"]["id"]
    res = client.post(
        f"/v1/projects/{project_id}/ai/conversations/{conv_id}/messages",
        json={"content": f"Extract candidate {cand_id} from document {doc_id}."},
    )
    assert res.status_code == 201, res.text
    run = res.json()["latest_run"]
    assert run["status"] == "PAUSED", run
    return run["id"]


def _reps(client, project_id, cand_id) -> list[dict]:
    return client.get(
        f"/v1/projects/{project_id}/structure-candidates/{cand_id}/representations"
    ).json()["representations"]


def _human_promote(client, project_id, cand_id, parent_rep_id) -> dict:
    """The researcher's actions, exactly as the browser performs them."""
    base = f"/v1/projects/{project_id}/structure-candidates/{cand_id}"
    conf = client.post(
        f"{base}/representations/{parent_rep_id}/generate-conformer",
        json={"name": "3D", "multiplicity": 1},
    )
    assert conf.status_code == 201, conf.text
    conf_id = conf.json()["representation"]["id"]
    review = client.post(
        f"{base}/representations/{conf_id}/review",
        json={"notes": "checked", "checklist": _complete_b3_checklist()},
    )
    assert review.status_code in (200, 201), review.text
    assert client.post(f"{base}/review", json={"notes": "ok"}).status_code in (200, 201)
    promo = client.post(f"{base}/promote", json={"representation_id": conf_id})
    assert promo.status_code == 201, promo.text
    return promo.json()


def _recognition_smiles_rep(client, project_id, cand_id) -> dict:
    return next(
        r
        for r in _reps(client, project_id, cand_id)
        if r["representation_type"] == "SMILES"
        and r["representation_origin"] == "IMAGE_RECONSTRUCTION"
    )


def _events(sessions, run_id, event_type=None):
    with sessions() as s:
        q = select(AIRunEventRecord).where(AIRunEventRecord.run_id == run_id)
        if event_type:
            q = q.where(AIRunEventRecord.event_type == event_type)
        return s.scalars(q.order_by(AIRunEventRecord.sequence)).all()


def _calc_args(project_id, version_id, *, mult=1, charge=0, method="hf", basis="sto-3g"):
    return {
        "structure_version": {
            "project_id": project_id,
            "entity_type": "structure.version",
            "entity_id": version_id,
        },
        "specification": {
            "task_type": "ENERGY",
            "method": {"identifier": method, "display_name": method, "registry": "chemdft.method"},
            "basis": {"identifier": basis, "display_name": basis, "registry": "chemdft.basis"},
            "charge": charge,
            "multiplicity": mult,
            "engine_preference": {"engine": "pyscf"},
        },
        "provider_preference": "LOCAL",
        "idempotency_key": f"k-{uuid4()}",
    }


# ------------------------------------------------- Phase 2: electronic-state validation


def _atoms(*z):
    return [{"atomic_number": n} for n in z]


@pytest.mark.parametrize(
    ("label", "atoms", "charge", "mult", "valid"),
    [
        ("H2 neutral singlet", _atoms(1, 1), 0, 1, True),
        ("He neutral singlet", _atoms(2), 0, 1, True),
        ("H+ has no electrons: unsupported", _atoms(1), 1, 1, False),
        ("H radical doublet", _atoms(1), 0, 2, True),
        ("H singlet: odd electron count", _atoms(1), 0, 1, False),
        ("H2 doublet", _atoms(1, 1), 0, 2, False),
        ("H2 triplet (even electrons, 2 unpaired)", _atoms(1, 1), 0, 3, True),
        ("H triplet: more unpaired than electrons", _atoms(1), 0, 3, False),
        ("NH4+ closed shell cation", _atoms(7, 1, 1, 1, 1), 1, 1, True),
        ("OH- closed shell anion", _atoms(8, 1), -1, 1, True),
        ("O2 singlet passes parity (not a physical verdict)", _atoms(8, 8), 0, 1, True),
        ("O2 triplet passes parity", _atoms(8, 8), 0, 3, True),
        ("O2 doublet", _atoms(8, 8), 0, 2, False),
        ("multiplicity zero", _atoms(1, 1), 0, 0, False),
        ("multiplicity bool", _atoms(1, 1), 0, True, False),
    ],
)
def test_electronic_parity_uses_unpaired_electrons_not_multiplicity(
    label, atoms, charge, mult, valid
) -> None:
    """Parity is (N_e - (M - 1)) % 2 == 0, M = multiplicity; it is necessary, never sufficient."""
    if valid:
        validate_electronic_state_composition(atoms, charge, mult)
    else:
        with pytest.raises(StructureElectronicStateMismatch):
            validate_electronic_state_composition(atoms, charge, mult)


def test_o2_singlet_and_triplet_both_pass_parity_so_stored_state_must_decide(api) -> None:
    """Parity cannot pick the ground state; for unannotated XYZ imports the
    researcher's explicit declaration (validated by parity) decides, not the
    stored placeholder."""
    client, sessions, settings = api
    project_id = _create_project(client)["id"]
    version = _import_h2(client, project_id)["version"]  # unannotated XYZ: stored (0, 1) placeholder
    ident = Identity(settings.dev_user_id, settings.dev_organization_id)
    with sessions() as session:
        # Both singlet (mult=1) and triplet (mult=3) are parity-valid for 2 electrons.
        validate_electronic_state_composition(_atoms(1, 1), 0, 3)
        validate_electronic_state_composition(_atoms(1, 1), 0, 1)
        # For an unannotated XYZ import the stored (0, 1) is NOT authoritative;
        # an explicit triplet declaration is accepted because it passes parity.
        validate_compute_guidance(
            session, settings, ident, project_id, _calc_args(project_id, version["id"], mult=3)
        )
        # Parity is still enforced: multiplicity 4 is impossible for 2 electrons
        # (spin=3 > electrons=2) and must be rejected.
        with pytest.raises(ToolInvocationError) as caught:
            validate_compute_guidance(
                session, settings, ident, project_id, _calc_args(project_id, version["id"], mult=4)
            )
        assert caught.value.code == ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED
        assert "parity" in caught.value.detail.lower()


def test_guidance_rejects_unsupported_method_and_unknown_structure(api) -> None:
    client, sessions, settings = api
    project_id = _create_project(client)["id"]
    version = _import_h2(client, project_id)["version"]
    ident = Identity(settings.dev_user_id, settings.dev_organization_id)
    with sessions() as session:
        with pytest.raises(ApplicationError):
            validate_compute_guidance(
                session,
                settings,
                ident,
                project_id,
                _calc_args(project_id, version["id"], method="not-a-method"),
            )
        with pytest.raises(ToolInvocationError) as caught:
            validate_compute_guidance(
                session, settings, ident, project_id, _calc_args(project_id, str(uuid4()))
            )
        assert caught.value.code == ToolErrorCode.NOT_FOUND


# ------------------------------------------------------ Phase 1: tool registry and policy


def test_ai_cannot_review_or_promote_and_has_no_such_tool(api) -> None:
    client, sessions, settings = api
    forbidden_fragments = ("promote", "review_checklist", "candidate.review", "candidate.reject")
    assert not [t for t in AI_TOOLS if any(f in t for f in forbidden_fragments)]
    assert "structure_candidate.request_review" in AI_TOOLS  # a request, not a decision
    with sessions() as session:
        registry = _registry(session, settings)
        registered = {d.name for d in registry.discover()}
        assert not [t for t in registered & AI_TOOLS if "promote" in t or "reject" in t]
        project_id = _create_project(client)["id"]
        for name in ("structure_candidate.promote", "structure_candidate.review"):
            if name not in registered:
                continue
            definition = registry.resolve(name).definition
            with pytest.raises(ToolInvocationError) as caught:
                guard_ai_tool(
                    session,
                    settings,
                    _ctx(settings, project_id, set(), "ai_scientist"),
                    definition,
                    {},
                )
            assert caught.value.code == ToolErrorCode.FORBIDDEN


def test_read_only_member_cannot_run_mutating_ai_tools(api, monkeypatch) -> None:
    client, sessions, settings = api
    project_id = _create_project(client)["id"]
    doc_id, cand_id = _candidate(client, project_id)
    with sessions() as session:
        session.scalar(
            select(ProjectMember).where(ProjectMember.project_id == project_id)
        ).role = "viewer"
        session.commit()
    calls = stub_decimer(monkeypatch)
    with sessions() as session:
        registry = _registry(session, settings)
        ctx = _ctx(settings, project_id, WRITE_CAPS, "ai_scientist")
        for name, args in (
            ("document.figures.extract", {"document_id": doc_id}),
            ("structure_candidate.recognize", {"candidate_id": cand_id}),
            ("structure_candidate.request_review", {"candidate_id": cand_id, "review_reason": "x"}),
        ):
            with pytest.raises(ToolInvocationError) as caught:
                registry.invoke(name, args, ctx)
            assert caught.value.code == ToolErrorCode.FORBIDDEN, name
    assert calls == []


@pytest.mark.parametrize(
    "engine", ["dev", "development", "test", "chemdft-development-engine", "x"]
)
def test_development_engine_is_rejected_for_autonomous_recognition(
    api, monkeypatch, engine
) -> None:
    client, sessions, settings = api
    settings.recognition_development_engine_enabled = True  # even when locally enabled for humans
    project_id = _create_project(client)["id"]
    _doc, cand_id = _candidate(client, project_id)
    calls = stub_decimer(monkeypatch)
    with sessions() as session:
        registry = _registry(session, settings)
        for transport in ("ai_scientist", "internal"):
            with pytest.raises(ToolInvocationError) as caught:
                registry.invoke(
                    "structure_candidate.recognize",
                    {"candidate_id": cand_id, "engine_preference": engine},
                    _ctx(settings, project_id, WRITE_CAPS, transport),
                )
            assert caught.value.code == ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED
        n = session.scalar(
            select(func.count())
            .select_from(CandidateRepresentationRecord)
            .where(
                CandidateRepresentationRecord.candidate_id == cand_id,
                CandidateRepresentationRecord.representation_type == "SMILES",
            )
        )
        assert n == 0
    assert calls == []


def test_tools_reject_foreign_project_references(api, monkeypatch) -> None:
    client, sessions, settings = api
    project_a = _create_project(client)["id"]
    project_b = _create_project(client)["id"]
    doc_a, cand_a = _candidate(client, project_a)
    calls = stub_decimer(monkeypatch)
    with sessions() as session:
        registry = _registry(session, settings)
        ctx_b = _ctx(settings, project_b, WRITE_CAPS, "ai_scientist")
        for name, args in (
            ("document.figures.extract", {"document_id": doc_a}),
            ("structure_candidate.recognize", {"candidate_id": cand_a}),
            ("structure_candidate.validate_graph", {"candidate_id": cand_a, "content": "CCO"}),
            (
                "structure_candidate.request_review",
                {"candidate_id": cand_a, "review_reason": "x"},
            ),
        ):
            with pytest.raises(ToolInvocationError) as caught:
                registry.invoke(name, args, ctx_b)
            assert caught.value.code in (
                ToolErrorCode.NOT_FOUND,
                ToolErrorCode.FORBIDDEN,
                ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED,
            ), name
    assert calls == []


def test_request_review_requires_a_reconstruction_and_a_reviewable_candidate(
    api, monkeypatch
) -> None:
    client, sessions, settings = api
    project_id = _create_project(client)["id"]
    _doc, cand_id = _candidate(client, project_id)
    stub_decimer(monkeypatch)
    with sessions() as session:
        registry = _registry(session, settings)
        ctx = _ctx(settings, project_id, WRITE_CAPS, "ai_scientist")
        args = {"candidate_id": cand_id, "review_reason": "please review"}
        # Only the source image exists: there is nothing scientific to review yet.
        with pytest.raises(ToolInvocationError) as caught:
            registry.invoke("structure_candidate.request_review", args, ctx)
        assert caught.value.code == ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED
        image_rep = session.scalar(
            select(CandidateRepresentationRecord).where(
                CandidateRepresentationRecord.candidate_id == cand_id,
                CandidateRepresentationRecord.representation_type == "IMAGE_REFERENCE",
            )
        )
        with pytest.raises(ToolInvocationError):
            registry.invoke(
                "structure_candidate.request_review",
                {**args, "expected_representation_id": image_rep.id},
                ctx,
            )
        registry.invoke("structure_candidate.recognize", {"candidate_id": cand_id}, ctx)
        out = registry.invoke("structure_candidate.request_review", args, ctx)
        assert out.gate_status == "WAITING_FOR_RESEARCHER_REVIEW"
        assert out.expected_representation_id is not None
    # A researcher rejection makes the candidate non-reviewable.
    assert client.post(
        f"/v1/projects/{project_id}/structure-candidates/{cand_id}/reject", json={"reason": "no"}
    ).status_code in (200, 201)
    with sessions() as session:
        registry = _registry(session, settings)
        with pytest.raises(ToolInvocationError) as caught:
            registry.invoke(
                "structure_candidate.request_review",
                args,
                _ctx(settings, project_id, WRITE_CAPS, "ai_scientist"),
            )
        assert caught.value.code == ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED


# ------------------------------------------------------ Phase 4: recognition integrity


def _recognize(sessions, settings, project_id, cand_id, **extra):
    with sessions() as session:
        registry = _registry(session, settings)
        return registry.invoke(
            "structure_candidate.recognize",
            {"candidate_id": cand_id, **extra},
            _ctx(settings, project_id, WRITE_CAPS, "ai_scientist"),
        )


def _smiles_reps(sessions, cand_id):
    with sessions() as session:
        return session.scalars(
            select(CandidateRepresentationRecord)
            .where(
                CandidateRepresentationRecord.candidate_id == cand_id,
                CandidateRepresentationRecord.representation_type == "SMILES",
            )
            .order_by(CandidateRepresentationRecord.revision)
        ).all()


def test_researcher_authored_smiles_is_never_returned_as_recognition(api, monkeypatch) -> None:
    client, sessions, settings = api
    project_id = _create_project(client)["id"]
    _doc, cand_id = _candidate(client, project_id)
    created = client.post(
        f"/v1/projects/{project_id}/structure-candidates/{cand_id}/representations",
        json={"representation_type": "SMILES", "smiles": "CCN"},
    )
    assert created.status_code == 201, created.text
    researcher_rep = created.json()["representation"]["id"]
    calls = stub_decimer(monkeypatch, "CCO")
    out = _recognize(sessions, settings, project_id, cand_id)
    assert len(calls) == 1, "a researcher SMILES is not a recognition of the figure"
    assert out.reused is False
    assert str(out.representation_id) != researcher_rep
    assert out.canonical_isomeric_smiles == "CCO"
    assert out.proposal["recognition_engine"] == "DECIMER-Image_Transformer"
    with sessions() as session:
        researcher = session.get(CandidateRepresentationRecord, researcher_rep)
        assert researcher.representation_origin != "IMAGE_RECONSTRUCTION"  # untouched, still human


def test_development_engine_output_is_not_reused_as_decimer_recognition(api, monkeypatch) -> None:
    client, sessions, settings = api
    settings.recognition_development_engine_enabled = True
    project_id = _create_project(client)["id"]
    _doc, cand_id = _candidate(client, project_id)
    dev = client.post(
        f"/v1/projects/{project_id}/structure-candidates/{cand_id}/recognize",
        json={"engine": "dev", "category_hint": "benzene"},
    )
    assert dev.status_code == 200, dev.text
    assert dev.json()["proposal"]["recognition_engine"] == "chemdft-development-engine"
    calls = stub_decimer(monkeypatch, "CCO")
    out = _recognize(sessions, settings, project_id, cand_id)
    assert len(calls) == 1
    assert out.proposal["recognition_engine"] == "DECIMER-Image_Transformer"
    assert out.canonical_isomeric_smiles == "CCO"


@pytest.mark.parametrize(
    ("index", "field", "value"),
    [
        (0, "figure_sha256", "0" * 64),  # proposal made for different figure bytes
        (1, "engine_version", "1.0.0-other"),  # different engine revision
        (2, "recognition_engine", "other-engine"),  # different engine
    ],
)
def test_reuse_requires_same_figure_engine_and_revision(
    api, monkeypatch, index, field, value
) -> None:
    client, sessions, settings = api
    project_id = _create_project(client)["id"]
    _doc, cand_id = _distinct_candidate(client, project_id, 130 + index)
    calls = stub_decimer(monkeypatch, "CCO")
    first = _recognize(sessions, settings, project_id, cand_id)
    assert _recognize(sessions, settings, project_id, cand_id).reused is True
    assert len(calls) == 1
    with sessions() as session:
        original = dict(
            session.get(CandidateRepresentationRecord, str(first.representation_id)).payload_json
        )
        session.execute(
            update(CandidateRepresentationRecord)
            .where(CandidateRepresentationRecord.id == str(first.representation_id))
            .values(payload_json={**original, field: value})
        )
        session.commit()
    out = _recognize(sessions, settings, project_id, cand_id)
    assert len(calls) == 2, f"{field} change must trigger a fresh inference"
    assert out.reused is False and out.representation_id != first.representation_id
    # The earlier proposal is kept as history (never edited into the new one, never deleted).
    ids = {r.id for r in _smiles_reps(sessions, cand_id)}
    assert str(first.representation_id) in ids and str(out.representation_id) in ids
    assert out.proposal["is_scientifically_verified"] is False


def test_invalid_recognition_is_recorded_once_and_idempotent(api, monkeypatch) -> None:
    """The blank test figure makes the real engine abstain before any model inference."""
    client, sessions, settings = api
    project_id = _create_project(client)["id"]
    _doc, cand_id = _candidate(client, project_id)
    first = _recognize(sessions, settings, project_id, cand_id)
    assert first.status == "UNRECOGNIZABLE" and first.canonical_isomeric_smiles is None
    again = _recognize(sessions, settings, project_id, cand_id)
    assert again.reused is True and again.representation_id == first.representation_id
    assert len(_smiles_reps(sessions, cand_id)) == 1


def test_engine_failure_persists_nothing_and_is_reported_as_unavailable(api, monkeypatch) -> None:
    client, sessions, settings = api
    project_id = _create_project(client)["id"]
    _doc, cand_id = _candidate(client, project_id)

    def failing(self, image_bytes, metadata=None):
        return self._proposal(
            "0" * 64,
            metadata or {},
            0.0,
            status=RecognitionStatus.ENGINE_ERROR,
            warnings=("Recognition worker timed out; no structure was proposed.",),
            diagnostics=["Worker timed out after 180 seconds."],
        )

    monkeypatch.setattr(DecimerSubprocessEngine, "recognize_diagram", failing)
    with pytest.raises(ToolInvocationError) as caught:
        _recognize(sessions, settings, project_id, cand_id)
    assert caught.value.code == ToolErrorCode.CAPABILITY_UNAVAILABLE
    assert _smiles_reps(sessions, cand_id) == []
    # A later healthy attempt is a normal first inference, not a replay of the failure.
    calls = stub_decimer(monkeypatch, "CCO")
    assert _recognize(sessions, settings, project_id, cand_id).reused is False
    assert len(calls) == 1


def test_concurrent_recognition_cannot_create_two_proposals(api, monkeypatch) -> None:
    """A competing worker persists the proposal while this one is still running inference."""
    client, sessions, settings = api
    project_id = _create_project(client)["id"]
    _doc, cand_id = _candidate(client, project_id)
    inner_done = {"value": False}
    calls = stub_decimer(monkeypatch, "CCO")
    original = DecimerSubprocessEngine.recognize_diagram

    def racing(self, image_bytes, metadata=None):
        if not inner_done["value"]:
            inner_done["value"] = True
            _recognize(sessions, settings, project_id, cand_id)  # the competing worker commits
        return original(self, image_bytes, metadata)

    monkeypatch.setattr(DecimerSubprocessEngine, "recognize_diagram", racing)
    out = _recognize(sessions, settings, project_id, cand_id)
    assert out.reused is True, "the persisted winner must be returned, not a second proposal"
    proposals = [
        r
        for r in _smiles_reps(sessions, cand_id)
        if r.representation_origin == "IMAGE_RECONSTRUCTION"
    ]
    assert len(proposals) == 1 and str(out.representation_id) == proposals[0].id
    assert len(calls) == 2  # the loser had already spent its inference; nothing was duplicated


def test_figure_extraction_is_idempotent(api) -> None:
    client, sessions, settings = api
    project_id = _create_project(client)["id"]
    doc_id = _upload_pdf(client, project_id)
    ids = []
    for _ in range(2):
        with sessions() as session:
            registry = _registry(session, settings)
            out = registry.invoke(
                "document.figures.extract",
                {"document_id": doc_id},
                _ctx(settings, project_id, WRITE_CAPS, "ai_scientist"),
            )
            ids.append(sorted(str(c.id) for c in out.candidates))
    assert ids[0] == ids[1] and ids[0]
    with sessions() as session:
        assert session.scalar(
            select(func.count())
            .select_from(StructureCandidateRecord)
            .where(StructureCandidateRecord.project_id == project_id)
        ) == len(ids[0])


# --------------------------------------------------- Phase 3: researcher gate and resume


def test_gate_is_exposed_to_the_ui_with_exact_identities(api, monkeypatch) -> None:
    client, sessions, _settings = api
    project_id = _create_project(client)["id"]
    doc_id, cand_id = _candidate(client, project_id)
    stub_decimer(monkeypatch)
    run_id = _gated_run(client, project_id, doc_id, cand_id)
    view = client.get(f"/v1/projects/{project_id}/ai/runs/{run_id}").json()
    gate = view["pending_researcher_gate"]
    assert gate["candidate_id"] == cand_id
    assert gate["source_document_id"] == doc_id
    assert gate["status"] == "WAITING" and gate["review_reason"]
    # The expected representation is a reconstructed one of THIS candidate, never the bare image.
    rep = next(
        r
        for r in _reps(client, project_id, cand_id)
        if r["id"] == gate["expected_representation_id"]
    )
    assert rep["representation_type"] != "IMAGE_REFERENCE"
    assert [s["step_type"] for s in view["steps"]].count("RESEARCHER_GATE") == 1
    requested = _events(sessions, run_id, "researcher_gate.requested")
    assert len(requested) == 1
    payload = requested[0].payload_json
    for key in (
        "gate_status",
        "run_id",
        "gate_step_id",
        "candidate_id",
        "expected_representation_id",
        "source_document_id",
        "review_reason",
        "project_id",
    ):
        assert payload.get(key), key
    assert payload["run_id"] == run_id and payload["gate_step_id"] == gate["step_id"]


def test_resume_before_promotion_changes_nothing(api, monkeypatch) -> None:
    client, sessions, _settings = api
    project_id = _create_project(client)["id"]
    doc_id, cand_id = _candidate(client, project_id)
    stub_decimer(monkeypatch)
    run_id = _gated_run(client, project_id, doc_id, cand_id)
    before = len(_events(sessions, run_id))
    for _ in range(3):  # repeated Resume attempts
        r = client.post(f"/v1/projects/{project_id}/ai/runs/{run_id}/resume")
        assert r.status_code == 409 and r.json()["detail"]["code"] == "RESEARCHER_GATE_PENDING"
    assert len(_events(sessions, run_id)) == before
    with sessions() as session:
        assert session.get(AIRunRecord, run_id).status == "PAUSED"
        gate = session.scalar(
            select(AIRunStepRecord).where(
                AIRunStepRecord.run_id == run_id, AIRunStepRecord.step_type == "RESEARCHER_GATE"
            )
        )
        assert gate.status == "WAITING"


def test_promoting_an_unrelated_candidate_does_not_clear_the_gate(api, monkeypatch) -> None:
    client, sessions, _settings = api
    project_id = _create_project(client)["id"]
    doc_a, cand_a = _candidate(client, project_id)
    doc_b, cand_b = _distinct_candidate(client, project_id, 121)
    assert cand_a != cand_b
    stub_decimer(monkeypatch)
    run_id = _gated_run(client, project_id, doc_a, cand_a)
    # Candidate B is recognized and genuinely promoted by the researcher.
    client.post(f"/v1/projects/{project_id}/structure-candidates/{cand_b}/recognize")
    _human_promote(
        client, project_id, cand_b, _recognition_smiles_rep(client, project_id, cand_b)["id"]
    )
    r = client.post(f"/v1/projects/{project_id}/ai/runs/{run_id}/resume")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "RESEARCHER_GATE_PENDING"
    assert _events(sessions, run_id, "researcher_gate.cleared") == []


def test_promoting_an_unrelated_representation_of_the_same_candidate_does_not_clear(
    api, monkeypatch
) -> None:
    client, sessions, _settings = api
    project_id = _create_project(client)["id"]
    doc_id, cand_id = _candidate(client, project_id)
    stub_decimer(monkeypatch)
    run_id = _gated_run(client, project_id, doc_id, cand_id)
    # The researcher draws a different molecule whose parent is the source image, not the proposal.
    image_rep = next(
        r
        for r in _reps(client, project_id, cand_id)
        if r["representation_type"] == "IMAGE_REFERENCE"
    )
    other = client.post(
        f"/v1/projects/{project_id}/structure-candidates/{cand_id}/representations",
        json={
            "representation_type": "SMILES",
            "smiles": "CCN",
            "parent_representation_id": image_rep["id"],
        },
    )
    assert other.status_code == 201, other.text
    _human_promote(client, project_id, cand_id, other.json()["representation"]["id"])
    r = client.post(f"/v1/projects/{project_id}/ai/runs/{run_id}/resume")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "RESEARCHER_GATE_REPRESENTATION_MISMATCH"
    assert _events(sessions, run_id, "researcher_gate.cleared") == []
    with sessions() as session:
        assert session.get(AIRunRecord, run_id).status == "PAUSED"


def test_promotion_whose_provenance_names_another_candidate_does_not_clear(
    api, monkeypatch
) -> None:
    client, sessions, _settings = api
    project_id = _create_project(client)["id"]
    doc_id, cand_id = _candidate(client, project_id)
    stub_decimer(monkeypatch)
    run_id = _gated_run(client, project_id, doc_id, cand_id)
    promo = _human_promote(
        client, project_id, cand_id, _recognition_smiles_rep(client, project_id, cand_id)["id"]
    )
    with sessions() as session:
        record = session.scalar(
            select(ProvenanceRecordRow).where(
                ProvenanceRecordRow.subject_id == promo["version"]["id"]
            )
        )
        tampered = [
            {**p, "value": str(uuid4())} if p.get("key") == "candidate_id" else p
            for p in record.parameters_json
        ]
        session.execute(
            update(ProvenanceRecordRow)
            .where(ProvenanceRecordRow.id == record.id)
            .values(parameters_json=tampered)
        )
        session.commit()
    r = client.post(f"/v1/projects/{project_id}/ai/runs/{run_id}/resume")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "RESEARCHER_GATE_PROMOTION_MISMATCH"


def test_missing_authoritative_version_and_rejected_candidate_do_not_clear(
    api, monkeypatch
) -> None:
    client, sessions, _settings = api
    project_id = _create_project(client)["id"]
    doc_id, cand_id = _candidate(client, project_id)
    stub_decimer(monkeypatch)
    run_id = _gated_run(client, project_id, doc_id, cand_id)
    # Stale gate: the researcher rejected the candidate after the review was requested.
    assert client.post(
        f"/v1/projects/{project_id}/structure-candidates/{cand_id}/reject", json={"reason": "bad"}
    ).status_code in (200, 201)
    r = client.post(f"/v1/projects/{project_id}/ai/runs/{run_id}/resume")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "RESEARCHER_GATE_CANDIDATE_REJECTED"


def test_resume_after_cancellation_never_revives_the_run(api, monkeypatch) -> None:
    client, sessions, _settings = api
    project_id = _create_project(client)["id"]
    doc_id, cand_id = _candidate(client, project_id)
    stub_decimer(monkeypatch)
    run_id = _gated_run(client, project_id, doc_id, cand_id)
    assert client.post(f"/v1/projects/{project_id}/ai/runs/{run_id}/cancel").status_code == 200
    # The researcher still promotes afterwards (their action is independent of the AI run).
    _human_promote(
        client, project_id, cand_id, _recognition_smiles_rep(client, project_id, cand_id)["id"]
    )
    r = client.post(f"/v1/projects/{project_id}/ai/runs/{run_id}/resume")
    assert r.status_code == 200 and r.json()["status"] == "CANCELED"
    assert _events(sessions, run_id, "researcher_gate.cleared") == []
    with sessions() as session:
        assert session.get(AIRunRecord, run_id).status == "CANCELED"
        assert (
            session.scalar(
                select(func.count())
                .select_from(AIApprovalRecord)
                .where(AIApprovalRecord.run_id == run_id)
            )
            == 0
        )


def test_viewer_cannot_clear_or_resume_the_gate(api, monkeypatch) -> None:
    client, sessions, _settings = api
    project_id = _create_project(client)["id"]
    doc_id, cand_id = _candidate(client, project_id)
    stub_decimer(monkeypatch)
    run_id = _gated_run(client, project_id, doc_id, cand_id)
    _human_promote(
        client, project_id, cand_id, _recognition_smiles_rep(client, project_id, cand_id)["id"]
    )
    with sessions() as session:
        session.scalar(
            select(ProjectMember).where(ProjectMember.project_id == project_id)
        ).role = "viewer"
        session.commit()
    r = client.post(f"/v1/projects/{project_id}/ai/runs/{run_id}/resume")
    assert r.status_code == 403
    assert _events(sessions, run_id, "researcher_gate.cleared") == []
    with sessions() as session:
        gate = session.scalar(
            select(AIRunStepRecord).where(
                AIRunStepRecord.run_id == run_id, AIRunStepRecord.step_type == "RESEARCHER_GATE"
            )
        )
        assert gate.status == "WAITING"  # authorization failed before any state changed
        assert session.get(AIRunRecord, run_id).status == "PAUSED"


def test_valid_promotion_clears_gate_once_and_repeated_resume_is_inert(api, monkeypatch) -> None:
    client, sessions, _settings = api
    project_id = _create_project(client)["id"]
    doc_id, cand_id = _candidate(client, project_id)
    stub_decimer(monkeypatch)
    run_id = _gated_run(client, project_id, doc_id, cand_id)
    recog = _recognition_smiles_rep(client, project_id, cand_id)
    promo = _human_promote(client, project_id, cand_id, recog["id"])
    first = client.post(f"/v1/projects/{project_id}/ai/runs/{run_id}/resume")
    assert first.status_code == 200, first.text
    second = client.post(f"/v1/projects/{project_id}/ai/runs/{run_id}/resume")
    assert second.status_code == 200  # run is now waiting for approval; Resume is inert
    cleared = _events(sessions, run_id, "researcher_gate.cleared")
    assert len(cleared) == 1
    payload = cleared[0].payload_json
    assert payload["candidate_id"] == cand_id
    assert payload["promoted_structure_version_id"] == promo["version"]["id"]
    assert payload["promoted_by"] == _settings.dev_user_id  # the researcher's identity is preserved
    assert payload["resumed_by"] == _settings.dev_user_id
    assert payload["expected_representation_id"] and payload["promoted_representation_id"]
    view = first.json()
    assert view["pending_researcher_gate"] is None
    with sessions() as session:
        approvals = session.scalars(
            select(AIApprovalRecord).where(AIApprovalRecord.run_id == run_id)
        ).all()
        assert len(approvals) == 1  # one proposal, not two


def test_concurrent_resume_requests_clear_the_gate_exactly_once(api, monkeypatch) -> None:
    client, sessions, _settings = api
    project_id = _create_project(client)["id"]
    doc_id, cand_id = _candidate(client, project_id)
    stub_decimer(monkeypatch)
    run_id = _gated_run(client, project_id, doc_id, cand_id)
    _human_promote(
        client, project_id, cand_id, _recognition_smiles_rep(client, project_id, cand_id)["id"]
    )
    barrier = threading.Barrier(2, timeout=15)
    original = AIScientistService._verify_researcher_gate

    def synchronized(self, project, step):
        result = original(self, project, step)
        with contextlib.suppress(threading.BrokenBarrierError):
            barrier.wait()  # both requests have verified before either performs the transition
        return result

    monkeypatch.setattr(AIScientistService, "_verify_researcher_gate", synchronized)
    codes: list[int] = []

    def resume():
        codes.append(client.post(f"/v1/projects/{project_id}/ai/runs/{run_id}/resume").status_code)

    threads = [threading.Thread(target=resume) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)
    assert sorted(codes)[0] == 200, codes
    assert len(_events(sessions, run_id, "researcher_gate.cleared")) == 1
    with sessions() as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(AIApprovalRecord)
                .where(AIApprovalRecord.run_id == run_id)
            )
            == 1
        )


# ---------------------------------------------- Phase 6/7: approval and result grounding


def _approved_ready_run(client, sessions, monkeypatch):
    project_id = _create_project(client)["id"]
    doc_id, cand_id = _candidate(client, project_id)
    stub_decimer(monkeypatch)
    run_id = _gated_run(client, project_id, doc_id, cand_id)
    promo = _human_promote(
        client, project_id, cand_id, _recognition_smiles_rep(client, project_id, cand_id)["id"]
    )
    resumed = client.post(f"/v1/projects/{project_id}/ai/runs/{run_id}/resume")
    assert resumed.status_code == 200, resumed.text
    view = resumed.json()
    return project_id, run_id, promo, view


def test_ai_only_proposes_calculation_and_nothing_runs_without_a_human_decision(
    api, monkeypatch
) -> None:
    client, sessions, _settings = api
    project_id, run_id, promo, view = _approved_ready_run(client, sessions, monkeypatch)
    assert view["status"] == "WAITING_FOR_APPROVAL"
    pending = view["pending_approval"]
    assert pending["status"] == "PENDING" and pending["tool_name"] == "calculation.submit"
    args = pending["normalized_arguments"]
    assert args["structure_version"]["entity_id"] == promo["version"]["id"]
    assert args["structure_version"]["project_id"] == project_id
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(CalculationRecord)) == 0
        approval = session.get(AIApprovalRecord, pending["id"])
        assert approval.decided_by is None and approval.consumed_at is None


def test_rejected_and_tampered_approvals_never_submit(api, monkeypatch) -> None:
    client, sessions, _settings = api
    project_id, run_id, promo, view = _approved_ready_run(client, sessions, monkeypatch)
    approval_id = view["pending_approval"]["id"]
    # Tamper with the stored arguments (different basis) after the proposal was fingerprinted.
    with sessions() as session:
        record = session.get(AIApprovalRecord, approval_id)
        arguments = dict(record.normalized_arguments_json)
        spec = dict(arguments["specification"])
        spec["basis"] = {**spec["basis"], "identifier": "6-31g"}
        session.execute(
            update(AIApprovalRecord)
            .where(AIApprovalRecord.id == approval_id)
            .values(normalized_arguments_json={**arguments, "specification": spec})
        )
        session.commit()
    r = client.post(
        f"/v1/projects/{project_id}/ai/approvals/{approval_id}/decision",
        json={"decision": "APPROVE"},
    )
    assert r.status_code == 409 and r.json()["detail"]["code"] == "APPROVAL_TAMPERED"
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(CalculationRecord)) == 0


def test_rejection_and_expiry_block_submission(api, monkeypatch) -> None:
    client, sessions, _settings = api
    project_id, run_id, promo, view = _approved_ready_run(client, sessions, monkeypatch)
    approval_id = view["pending_approval"]["id"]
    from datetime import timedelta

    from chemdft_api.models import utc_now

    with sessions() as session:
        session.execute(
            update(AIApprovalRecord)
            .where(AIApprovalRecord.id == approval_id)
            .values(expires_at=utc_now() - timedelta(minutes=1))
        )
        session.commit()
    r = client.post(
        f"/v1/projects/{project_id}/ai/approvals/{approval_id}/decision",
        json={"decision": "APPROVE"},
    )
    assert r.status_code == 409 and r.json()["detail"]["code"] == "APPROVAL_EXPIRED"
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(CalculationRecord)) == 0


def test_approval_cannot_authorize_different_arguments_or_be_reused(api, monkeypatch) -> None:
    client, sessions, settings = api
    project_id, run_id, promo, view = _approved_ready_run(client, sessions, monkeypatch)
    approval_id = view["pending_approval"]["id"]
    original_arguments = view["pending_approval"]["normalized_arguments"]
    ok = client.post(
        f"/v1/projects/{project_id}/ai/approvals/{approval_id}/decision",
        json={"decision": "APPROVE"},
    )
    assert ok.status_code == 200, ok.text
    with sessions() as session:
        calcs = session.scalars(select(CalculationRecord)).all()
        assert len(calcs) == 1  # queued exactly once; the solver is never run in the API process
        run = session.get(AIRunRecord, run_id)
        assert run.status == "WAITING_FOR_CALCULATION" and run.waiting_calculation_id == calcs[0].id
        registry = _registry(session, settings)
        definition = registry.resolve("calculation.submit").definition
        verifier = _make_approval_verifier(session)
        context = ToolInvocationContext(
            request_id=uuid4(),
            identity=Identity(settings.dev_user_id, settings.dev_organization_id),
            project_id=__import__("uuid").UUID(project_id),
            capabilities=frozenset({"calculation.submit"}),
            approval_references=frozenset({__import__("uuid").UUID(approval_id)}),
            transport="ai_scientist",
            provider="fake",
            model="fake-standard",
        )
        altered = {
            **original_arguments,
            "specification": {
                **original_arguments["specification"],
                "basis": {
                    **original_arguments["specification"]["basis"],
                    "identifier": "6-31g",
                },
            },
        }
        # The consumed approval authorizes neither a replay nor any altered argument set.
        for arguments in (altered, original_arguments):
            with pytest.raises(ToolInvocationError) as caught:
                verifier(context, definition, arguments)
            assert caught.value.code == ToolErrorCode.APPROVAL_REQUIRED
        # Even the Navigator refuses a second submission while the first job is in progress.
        with pytest.raises(ToolInvocationError) as caught:
            registry.invoke("calculation.submit", original_arguments, context)
        assert caught.value.code in (
            ToolErrorCode.APPROVAL_REQUIRED,
            ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED,
        )
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(CalculationRecord)) == 1


def test_no_numerical_claim_exists_before_a_persisted_result(api, monkeypatch) -> None:
    """B4.1A boundary: final result reporting is not implemented beyond the pre-existing,
    deterministic summary of an already persisted result (B4.2)."""
    client, sessions, _settings = api
    project_id, run_id, promo, view = _approved_ready_run(client, sessions, monkeypatch)
    client.post(
        f"/v1/projects/{project_id}/ai/approvals/{view['pending_approval']['id']}/decision",
        json={"decision": "APPROVE"},
    )
    waiting = client.post(f"/v1/projects/{project_id}/ai/runs/{run_id}/resume")
    assert waiting.status_code == 200
    body = waiting.json()
    assert body["status"] == "WAITING_FOR_CALCULATION"
    conv = client.get(
        f"/v1/projects/{project_id}/ai/conversations/{body['conversation_id']}"
    ).json()
    text = " ".join(m["content"].lower() for m in conv.get("messages", []))
    assert "hartree" not in text and "authoritative energy" not in text


# ------------------------------------------------------------- Phase 9: event contract


def _scripted_model(monkeypatch):
    """A model that plans extract, recognize, validate, request review via real tool calls."""
    import json

    from chemdft_api.ai.gateway import FakeModelGateway, ModelResponse, ModelToolCall, ModelUsage

    def generate(_gateway, request):
        outputs = []
        for message in request.messages:
            if message.role == "tool" and message.content.startswith("{"):
                outputs.append(json.loads(message.content))
        doc = next(
            (
                m.content.split("document ")[1].split(".")[0]
                for m in request.messages
                if m.role == "user"
            ),
            "",
        )

        def call(name, arguments):
            return ModelResponse(
                content=f"calling {name}",
                tool_calls=(
                    ModelToolCall(
                        id=f"c{len(outputs)}", name=name, arguments_json=json.dumps(arguments)
                    ),
                ),
                usage=ModelUsage(10, 5, 1),
                model_identifier="fake-standard",
                provider="fake",
            )

        extracted = next((o for o in outputs if "candidates" in o), None)
        recognized = next((o for o in outputs if "representation_id" in o), None)
        validated = next((o for o in outputs if "is_valid" in o), None)
        reviewed = next((o for o in outputs if "gate_status" in o), None)
        if extracted is None:
            return call("document.figures.extract", {"document_id": doc})
        candidate_id = extracted["candidates"][0]["id"]
        if recognized is None:
            return call("structure_candidate.recognize", {"candidate_id": candidate_id})
        if validated is None:
            return call(
                "structure_candidate.validate_graph",
                {"candidate_id": candidate_id, "content": recognized["canonical_isomeric_smiles"]},
            )
        if reviewed is None:
            return call(
                "structure_candidate.request_review",
                {
                    "candidate_id": candidate_id,
                    "review_reason": "Graph validated; researcher review needed.",
                },
            )
        return ModelResponse(
            content="Waiting for the researcher.",
            usage=ModelUsage(10, 5, 1),
            model_identifier="fake-standard",
            provider="fake",
        )

    monkeypatch.setattr(FakeModelGateway, "generate", generate)


def test_full_autonomous_flow_emits_the_documented_events(api, monkeypatch) -> None:
    client, sessions, _settings = api
    project_id = _create_project(client)["id"]
    doc_id = _upload_pdf(client, project_id)
    stub_decimer(monkeypatch)
    _scripted_model(monkeypatch)
    conv_id = client.post(f"/v1/projects/{project_id}/ai/conversations", json={}).json()[
        "conversation"
    ]["id"]
    res = client.post(
        f"/v1/projects/{project_id}/ai/conversations/{conv_id}/messages",
        json={"content": f"Reconstruct figures from document {doc_id}."},
    )
    run = res.json()["latest_run"]
    assert run["status"] == "PAUSED", run
    events = client.get(f"/v1/projects/{project_id}/ai/runs/{run['id']}/events").json()["events"]
    types = [e["event_type"] for e in events]
    order = [
        "document.figures_extracted",
        "candidate.diagram_recognized",
        "candidate.graph_validated",
        "researcher_gate.requested",
    ]
    assert all(t in types for t in order), types
    assert [types.index(t) for t in order] == sorted(types.index(t) for t in order)
    by_type = {e["event_type"]: e["payload"] for e in events}
    extracted = by_type["document.figures_extracted"]
    assert extracted["document_id"] == doc_id and extracted["candidate_count"] == 1
    recognized = by_type["candidate.diagram_recognized"]
    assert recognized["representation_id"] and recognized["status"]
    assert recognized["proposal"]["is_scientifically_verified"] is False
    assert recognized["reused"] is False
    assert recognized["candidate"]["id"]
    assert "is_valid" in by_type["candidate.graph_validated"]
    sequences = [e["sequence"] for e in events]
    assert sequences == sorted(set(sequences))
    gate = by_type["researcher_gate.requested"]
    assert gate["candidate_id"] == recognized["candidate"]["id"]
    view = client.get(f"/v1/projects/{project_id}/ai/runs/{run['id']}").json()
    assert view["pending_researcher_gate"]["candidate_id"] == gate["candidate_id"]
    assert (
        view["pending_researcher_gate"]["expected_representation_id"]
        == gate["expected_representation_id"]
    )


# ------------------------------------------------ Phase 5: cancellation / pause / replay


def _control_during_recognition(monkeypatch, client, sessions, project_id, action):
    """Issue Stop/Pause from another request while the recognition call is in flight."""
    calls = stub_decimer(monkeypatch, "CCO")
    inner = DecimerSubprocessEngine.recognize_diagram

    def interfering(self, image_bytes, metadata=None):
        with sessions() as session:
            run_id = session.scalar(
                select(AIRunRecord.id).where(AIRunRecord.project_id == project_id)
            )
        assert (
            client.post(f"/v1/projects/{project_id}/ai/runs/{run_id}/{action}").status_code == 200
        )
        return inner(self, image_bytes, metadata)

    monkeypatch.setattr(DecimerSubprocessEngine, "recognize_diagram", interfering)
    return calls


def _post_extract_request(client, project_id, doc_id, cand_id):
    conv_id = client.post(f"/v1/projects/{project_id}/ai/conversations", json={}).json()[
        "conversation"
    ]["id"]
    return client.post(
        f"/v1/projects/{project_id}/ai/conversations/{conv_id}/messages",
        json={"content": f"Extract candidate {cand_id} from document {doc_id}."},
    ).json()["latest_run"]


def test_cancellation_during_recognition_publishes_no_state_after_stop(api, monkeypatch) -> None:
    client, sessions, settings = api
    project_id = _create_project(client)["id"]
    doc_id, cand_id = _candidate(client, project_id)
    calls = _control_during_recognition(monkeypatch, client, sessions, project_id, "cancel")
    run = _post_extract_request(client, project_id, doc_id, cand_id)
    assert run["status"] == "CANCELED"
    with sessions() as session:
        assert session.get(AIRunRecord, run["id"]).status == "CANCELED"
        assert (
            session.scalar(
                select(func.count())
                .select_from(AIRunStepRecord)
                .where(
                    AIRunStepRecord.run_id == run["id"],
                    AIRunStepRecord.step_type == "RESEARCHER_GATE",
                )
            )
            == 0
        )
    published = {e.event_type for e in _events(sessions, run["id"])}
    assert not published & {
        "candidate.diagram_recognized",
        "candidate.graph_validated",
        "researcher_gate.requested",
        "researcher_gate.cleared",
    }
    # The unverified proposal was persisted once (idempotent history); a later request reuses it.
    assert len(calls) == 1
    assert _recognize(sessions, settings, project_id, cand_id).reused is True
    assert len(calls) == 1


def test_pause_during_recognition_then_resume_does_not_repeat_inference(api, monkeypatch) -> None:
    client, sessions, settings = api
    project_id = _create_project(client)["id"]
    doc_id, cand_id = _candidate(client, project_id)
    calls = _control_during_recognition(monkeypatch, client, sessions, project_id, "pause")
    run = _post_extract_request(client, project_id, doc_id, cand_id)
    assert run["status"] == "PAUSED"
    assert run["pending_researcher_gate"] is None  # a user Pause is not a researcher gate
    assert not {e.event_type for e in _events(sessions, run["id"])} & {"researcher_gate.requested"}
    # Resume: the new worker finds the already-persisted proposal (durable state before replay).
    stub_decimer(monkeypatch, "CCO", calls)  # same call log; no more Pause interference
    resumed = client.post(f"/v1/projects/{project_id}/ai/runs/{run['id']}/resume")
    assert resumed.status_code == 200, resumed.text
    assert resumed.json()["status"] == "PAUSED"  # now suspended at the real researcher gate
    assert resumed.json()["pending_researcher_gate"]["candidate_id"] == cand_id
    assert len(calls) == 1
    with sessions() as session:
        reps = session.scalars(
            select(CandidateRepresentationRecord).where(
                CandidateRepresentationRecord.candidate_id == cand_id,
                CandidateRepresentationRecord.representation_origin == "IMAGE_RECONSTRUCTION",
                CandidateRepresentationRecord.representation_type == "SMILES",
            )
        ).all()
        assert len(reps) == 1


def test_stale_worker_cannot_transition_a_stopped_run(api, monkeypatch) -> None:
    client, sessions, _settings = api
    project_id = _create_project(client)["id"]
    doc_id, cand_id = _candidate(client, project_id)
    stub_decimer(monkeypatch)
    run_id = _gated_run(client, project_id, doc_id, cand_id)
    from chemdft_api.ai.events import AIRunEventManager
    from chemdft_api.ai.execution import AIRunExecutionManager, StaleWorkerFencedError

    with sessions() as session:
        manager = AIRunExecutionManager(session, AIRunEventManager(session))
        stale_epoch = manager.read_fence(project_id, run_id).epoch - 1  # worker from before Pause
        for status in ("PLANNING", "SUCCEEDED", "FAILED"):
            with pytest.raises(StaleWorkerFencedError):
                manager.transition(project_id, run_id, stale_epoch, status, from_states=("PAUSED",))
        assert session.get(AIRunRecord, run_id).status == "PAUSED"
