"""Batch B2 independent review: tests that do NOT depend on hint-driven development outputs.

Engine-pipeline tests below use a FAKE worker (monkeypatched `subprocess.run` returning canned
JSON).  They verify our wrapper (gating, status mapping, security, validation), NOT DECIMER's
accuracy.  The single real-model test, `test_real_decimer_hint_free_ethanol_drawing` (marked
`scientific_integration`, skipped when weights/worker are not provisioned), is the only DECIMER
inference test in the backend suite.  The hint-driven lookup tests live in
`test_batch_b2_molecular_recognition.py` and are NOT recognition tests.
"""

from __future__ import annotations

import io
import json
import subprocess
from pathlib import Path
from uuid import uuid4

import pytest
from b2_pdf import assemble_pdf, build_pdf, solid_page, stream_object
from chemdft_api.config import Settings
from chemdft_api.errors import RecognitionEngineUnavailable, ScientificValidationFailed
from chemdft_api.scientific.figure_extractor import (
    FigureExtractionError,
    extract_figures_from_pdf,
)
from chemdft_api.scientific.molecular_recognition import engine as engine_mod
from chemdft_api.scientific.molecular_recognition.contracts import RecognitionStatus
from chemdft_api.scientific.molecular_recognition.engine import (
    DecimerSubprocessEngine,
    DevelopmentRecognitionEngine,
    assess_image_content,
    degenerate_output_reason,
    resolve_recognition_engine,
)
from chemdft_api.scientific.molecular_recognition.validation import (
    validate_molecular_graph_proposal,
)
from chemdft_api.scientific_models import StructureRecord, StructureVersionRecord
from PIL import Image, ImageDraw
from rdkit import Chem
from rdkit.Chem import inchi
from sqlalchemy import func, select
from test_batch_b2_molecular_recognition import _compare_chemical_graphs, _project


# ---------------------------------------------------------------- helpers
def _png(image: Image.Image) -> bytes:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def _line_drawing() -> bytes:
    img = Image.new("RGB", (200, 200), "white")
    d = ImageDraw.Draw(img)
    d.line((40, 100, 100, 40), fill="black", width=3)
    d.line((100, 40, 160, 100), fill="black", width=3)
    return _png(img)


def _model_cache(tmp_path: Path) -> Path:
    pb = tmp_path / "cache" / "DECIMER-V2" / "DECIMER_model" / "saved_model.pb"
    pb.parent.mkdir(parents=True)
    pb.write_bytes(b"x")
    return tmp_path / "cache"


def _pdf(
    pages: list[tuple[str, dict[str, tuple[int, int, tuple[int, int, int]]]]], extra: str = ""
) -> bytes:
    """Strictly valid PDF; pages = [(content ops, {name: (w, h, rgb)})]. `extra` goes in /Page."""
    return build_pdf([solid_page(ops, imgs) for ops, imgs in pages], page_extra=extra)


def _fake_run(monkeypatch, stdout: bytes = b"", returncode: int = 0, raises=None):
    calls: list[dict] = []

    def run(cmd, **kwargs):
        calls.append({"cmd": cmd, **kwargs})
        if raises:
            raise raises
        return subprocess.CompletedProcess(cmd, returncode, stdout, b"")

    monkeypatch.setattr(engine_mod.subprocess, "run", run)
    return calls


# ---------------------------------------------------------------- engine selection
def test_default_engine_is_real_decimer_not_development() -> None:
    assert isinstance(resolve_recognition_engine(None, Settings()), DecimerSubprocessEngine)


def test_development_engine_refused_by_default_and_outside_local_env() -> None:
    for name in ("dev", "development", "test", "chemdft-development-engine"):
        with pytest.raises(ScientificValidationFailed):
            resolve_recognition_engine(name, Settings())
    # enabled flag alone is not enough in a non-local environment
    prod = Settings(recognition_development_engine_enabled=True, environment="production")
    with pytest.raises(ScientificValidationFailed):
        resolve_recognition_engine("dev", prod)
    local = Settings(recognition_development_engine_enabled=True, environment="development")
    assert isinstance(resolve_recognition_engine("dev", local), DevelopmentRecognitionEngine)
    with pytest.raises(ScientificValidationFailed):
        resolve_recognition_engine("nonexistent-engine", local)


def test_development_engine_output_is_labelled_as_not_inference() -> None:
    p = DevelopmentRecognitionEngine().recognize_diagram(_line_drawing(), {"category": "benzene"})
    assert any("DEVELOPMENT ENGINE" in w for w in p.validation_warnings)
    assert p.is_scientifically_verified is False


# ---------------------------------------------------------------- DECIMER wrapper (fake worker)
def test_hints_cannot_create_a_structure_on_the_decimer_path(tmp_path, monkeypatch) -> None:
    """A blank image with category/hint/raw_smiles metadata must abstain before inference."""
    calls = _fake_run(monkeypatch, stdout=b'\n{"smiles": "c1ccccc1"}\n')
    blank = _png(Image.new("RGB", (300, 300), "white"))
    eng = DecimerSubprocessEngine(model_cache=_model_cache(tmp_path))
    p = eng.recognize_diagram(
        blank, {"category": "benzene", "hint": "benzene", "raw_smiles": "c1ccccc1"}
    )
    assert p.status == RecognitionStatus.UNRECOGNIZABLE
    assert p.proposed_smiles is None and p.canonical_isomeric_smiles is None
    assert calls == []  # the model was never invoked


def test_image_gate_rejects_blank_noise_tiny_and_undecodable(tmp_path) -> None:
    import numpy as np

    rng = np.random.default_rng(1)
    noise = _png(Image.fromarray(rng.integers(0, 255, (200, 200, 3), dtype=np.uint8)))
    assert assess_image_content(noise)[0] is False
    assert assess_image_content(_png(Image.new("RGB", (200, 200), "white")))[0] is False
    assert assess_image_content(_png(Image.new("RGB", (16, 16), "white")))[0] is False
    assert assess_image_content(_line_drawing())[0] is True
    eng = DecimerSubprocessEngine(model_cache=_model_cache(tmp_path))
    assert eng.recognize_diagram(b"not-an-image").status == RecognitionStatus.PARSE_FAILED


def test_decimer_parseable_output_is_never_verified_and_carries_hallucination_warning(
    tmp_path, monkeypatch
) -> None:
    out = json.dumps({"smiles": "CCO", "token_confidences": [0.99, 0.5, 0.97]}).encode()
    _fake_run(monkeypatch, stdout=b"tf noise\n" + out + b"\n")
    p = DecimerSubprocessEngine(model_cache=_model_cache(tmp_path)).recognize_diagram(
        _line_drawing()
    )
    assert p.canonical_isomeric_smiles == "CCO"
    assert p.is_scientifically_verified is False
    assert p.confidence is None
    assert p.status == RecognitionStatus.MANUAL_REVIEW_REQUIRED
    assert any("almost any input" in w for w in p.validation_warnings)
    assert any("min=0.500" in d for d in p.diagnostics)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"returncode": 1},
        {"stdout": b"\n" + json.dumps({"error": "inference_failed: boom"}).encode() + b"\n"},
        {"stdout": b"garbage"},
        {"raises": subprocess.TimeoutExpired("x", 1)},
        {"raises": OSError("no such interpreter")},
    ],
)
def test_infrastructure_failures_are_engine_errors_not_scientific_verdicts(
    tmp_path, monkeypatch, kwargs
) -> None:
    _fake_run(monkeypatch, **kwargs)
    p = DecimerSubprocessEngine(model_cache=_model_cache(tmp_path)).recognize_diagram(
        _line_drawing()
    )
    assert p.status == RecognitionStatus.ENGINE_ERROR
    assert p.proposed_smiles is None


def test_degenerate_decoder_output_is_discarded_not_proposed(tmp_path, monkeypatch) -> None:
    """Signatures observed from real DECIMER on degraded/non-chemical images (see eval JSON)."""
    cache = _model_cache(tmp_path)
    for smiles, tokens in (
        ("C" * 40, 301),  # blurred diagram -> 40-carbon chain at the decode limit
        ("C1" + "C" * 38, 301),  # line plot -> giant ring
        (".".join(["[K]"] * 10), 63),  # bar chart -> repeated potassium
        ("C" * 25, 30),  # runaway repetition below the decode limit
    ):
        out = json.dumps({"smiles": smiles, "token_confidences": [0.7] * tokens}).encode()
        _fake_run(monkeypatch, stdout=b"\n" + out + b"\n")
        p = DecimerSubprocessEngine(model_cache=cache).recognize_diagram(_line_drawing())
        assert p.status == RecognitionStatus.UNRECOGNIZABLE, smiles
        assert p.proposed_smiles is None and p.raw_model_output is None
        assert p.canonical_isomeric_smiles is None
        assert any("decoder failure" in w for w in p.validation_warnings)
    # ordinary molecules are untouched, including a long-chain fatty acid
    for smiles in ("CCO", "CC(C)CC1=CC=C(C=C1)C(C)C(=O)O", "CCCCCCCCCCCCCCCCCC(=O)O"):
        assert degenerate_output_reason(smiles, 20) is None


def test_worker_invocation_is_shell_free_isolated_and_bounded(tmp_path, monkeypatch) -> None:
    calls = _fake_run(monkeypatch, stdout=b'\n{"smiles": "CCO"}\n')
    eng = DecimerSubprocessEngine(
        timeout_seconds=7, model_cache=_model_cache(tmp_path), cpu_seconds=11
    )
    image = _line_drawing()
    eng.recognize_diagram(image, {"category": "x; rm -rf /"})
    (call,) = calls
    assert isinstance(call["cmd"], list) and not call.get("shell")
    assert "-I" in call["cmd"]
    assert call["input"] == image  # image goes via stdin, never argv
    assert call["timeout"] == 7
    assert "x; rm" not in " ".join(call["cmd"])  # untrusted metadata never reaches argv
    assert set(call["env"]) <= {
        "PATH",
        "TF_CPP_MIN_LOG_LEVEL",
        "CUDA_VISIBLE_DEVICES",
        "OMP_NUM_THREADS",
        "HF_HUB_OFFLINE",
    }
    assert call["start_new_session"] is True
    assert call["cmd"][-1] == "11"
    # worker source: network blocked, rlimits set, no download call
    code = engine_mod._WORKER_CODE
    assert (
        "socket.getaddrinfo = _blocked" in code and "RLIMIT_CPU" in code and "RLIMIT_FSIZE" in code
    )


def test_concurrent_recognition_is_single_flight(tmp_path, monkeypatch) -> None:
    _fake_run(monkeypatch, stdout=b'\n{"smiles": "CCO"}\n')
    eng = DecimerSubprocessEngine(model_cache=_model_cache(tmp_path))
    assert engine_mod._WORKER_SLOT.acquire(blocking=False)
    try:
        with pytest.raises(RecognitionEngineUnavailable):
            eng.recognize_diagram(_line_drawing())
    finally:
        engine_mod._WORKER_SLOT.release()
    assert eng.recognize_diagram(_line_drawing()).status != RecognitionStatus.ENGINE_ERROR


def test_missing_weights_is_unsupported_and_does_not_fall_back(tmp_path) -> None:
    p = DecimerSubprocessEngine(model_cache=tmp_path).recognize_diagram(_line_drawing())
    assert p.status == RecognitionStatus.UNSUPPORTED and p.proposed_smiles is None


def test_worker_python_resolves_to_repo_venv_when_present() -> None:
    exe = Path(DecimerSubprocessEngine()._executable())
    repo_root = Path(__file__).resolve().parents[3]
    venv_python = repo_root / "services/reconstruction-evaluation/.venv/bin/python"
    if venv_python.is_file():
        assert exe == venv_python  # regression: a wrong parents[] index silently fell back


# ---------------------------------------------------------------- graph comparison meta-tests
@pytest.mark.parametrize(
    ("a", "b", "graph_same", "stereo_same", "charge_same"),
    [
        ("CC(=O)O", "CC(=O)[O-]", False, True, False),  # acetic acid vs acetate
        ("N[C@@H](C)C(=O)O", "N[C@H](C)C(=O)O", True, False, True),  # L vs D alanine
        ("C/C=C/C", "C/C=C\\C", True, False, True),  # E vs Z
        ("CC", "[2H]CC", False, True, True),  # isotope
        ("c1ccccc1", "C1=CC=CC=C1", True, True, True),  # same graph, different string
    ],
)
def test_graph_comparator_is_not_string_or_substructure_equality(
    a, b, graph_same, stereo_same, charge_same
):
    cmp = _compare_chemical_graphs(a, b)
    assert cmp["isomorphic"] is graph_same
    assert cmp["same_chiral"] is stereo_same
    assert cmp["same_charge"] is charge_same
    if not graph_same and charge_same:
        assert cmp["same_isotopes"] is False


# ---------------------------------------------------------------- validation
def test_validation_reports_double_bond_stereo_isotopes_wildcards_and_metals() -> None:
    assert validate_molecular_graph_proposal("CC=CC").status == RecognitionStatus.AMBIGUOUS
    e = validate_molecular_graph_proposal("C/C=C/C")
    assert e.status == RecognitionStatus.MANUAL_REVIEW_REQUIRED and e.has_stereochemistry
    assert any(
        "Isotopic" in w for w in validate_molecular_graph_proposal("[2H]C(Cl)(Cl)Cl").warnings
    )
    star = validate_molecular_graph_proposal("*CC")
    assert any("placeholder" in a for a in star.ambiguities)
    assert (
        validate_molecular_graph_proposal("[Pt](Cl)(Cl)(N)N").status
        == RecognitionStatus.UNSUPPORTED
    )
    assert (
        validate_molecular_graph_proposal("c1ccccc").status == RecognitionStatus.PARSE_FAILED
    )  # unclosed ring
    assert validate_molecular_graph_proposal("").status == RecognitionStatus.UNRECOGNIZABLE
    for smi in ("CCO", "C/C=C/C", "CC(=O)[O-]"):
        assert (
            validate_molecular_graph_proposal(smi).status
            != RecognitionStatus.RESEARCHER_ACCEPTED_STRUCTURE
        )


# ---------------------------------------------------------------- figure extraction geometry
def _approx(got, want, tol=0.002):
    assert all(abs(g - w) <= tol for g, w in zip(got, want, strict=True)), (got, want)


def test_bbox_matches_content_stream_placement_for_multiple_images() -> None:
    pdf = _pdf(
        [
            (
                "q 120 0 0 120 50 500 cm /Im1 Do Q q 200 0 0 100 300 100 cm /Im2 Do Q",
                {"Im1": (80, 80, (255, 0, 0)), "Im2": (100, 50, (0, 255, 0))},
            )
        ]
    )
    f1, f2 = extract_figures_from_pdf(pdf)
    _approx((f1.x, f1.y, f1.width, f1.height), (50 / 612, (792 - 620) / 792, 120 / 612, 120 / 792))
    _approx((f2.x, f2.y, f2.width, f2.height), (300 / 612, (792 - 200) / 792, 200 / 612, 100 / 792))
    assert (f1.page_number, f2.page_number) == (1, 1)
    assert f1.image_sha256 != f2.image_sha256


def test_bbox_handles_rotation_nested_transforms_and_page_rotate() -> None:
    rot = _pdf([("q 0 150 -100 0 400 300 cm /Im1 Do Q", {"Im1": (80, 120, (0, 0, 255))})])
    (f,) = extract_figures_from_pdf(rot)  # occupies x 300..400, y 300..450
    _approx((f.x, f.y, f.width, f.height), (300 / 612, (792 - 450) / 792, 100 / 612, 150 / 792))
    nested = _pdf(
        [
            (
                "q 0.5 0 0 0.5 0 0 cm q 200 0 0 200 100 100 cm /Im1 Do Q Q",
                {"Im1": (64, 64, (0, 255, 0))},
            )
        ]
    )
    (n,) = extract_figures_from_pdf(nested)  # effective (50,50,100,100)
    _approx((n.x, n.y, n.width, n.height), (50 / 612, (792 - 150) / 792, 100 / 612, 100 / 792))
    # /Rotate 90: unrotated top-left box (u,v,w,h) -> (1-v-h, u, h, w)
    p90 = _pdf(
        [("q 100 0 0 100 50 600 cm /Im1 Do Q", {"Im1": (64, 64, (255, 0, 0))})], extra="/Rotate 90"
    )
    (r,) = extract_figures_from_pdf(p90)
    u, v, w, h = 50 / 612, (792 - 700) / 792, 100 / 612, 100 / 792
    _approx((r.x, r.y, r.width, r.height), (1 - v - h, u, h, w))


def test_reused_image_object_yields_one_figure_per_placement_and_pages_are_correct() -> None:
    pdf = _pdf(
        [
            ("", {}),
            (
                "q 100 0 0 100 50 600 cm /Im1 Do Q q 100 0 0 100 300 200 cm /Im1 Do Q",
                {"Im1": (64, 64, (255, 0, 0))},
            ),
        ]
    )
    a, b = extract_figures_from_pdf(pdf)
    assert a.page_number == b.page_number == 2
    assert a.image_sha256 == b.image_sha256
    assert (a.x, a.y) != (b.x, b.y)
    assert a.figure_number != b.figure_number
    assert not a.figure_number.startswith("Figure ")  # positional label, not a paper caption number


def test_extractor_never_invents_a_placeholder_bbox() -> None:
    pdf = _pdf([("q 100 0 0 100 50 600 cm /Im1 Do Q", {"Im1": (64, 64, (255, 0, 0))})])
    (f,) = extract_figures_from_pdf(pdf)
    assert (f.x, f.y, f.width, f.height) != (0.1, 0.1, 0.8, 0.25)


def test_extractor_rejects_malformed_encrypted_and_oversized_inputs() -> None:
    with pytest.raises(FigureExtractionError):
        extract_figures_from_pdf(b"%PDF-1.4\nthis is not a pdf")
    # declared 20000x20000 image must be skipped before any decode attempt
    bomb = assemble_pdf(
        {
            1: b"<< /Type /Catalog /Pages 2 0 R >>",
            2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            3: (
                b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R "
                b"/Resources << /XObject << /Im1 4 0 R >> >> >>"
            ),
            4: stream_object(
                "/Type /XObject /Subtype /Image /Width 20000 /Height 20000 "
                "/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode",
                b"xxxx",
            ),
            5: stream_object("", b"q 100 0 0 100 0 0 cm /Im1 Do Q"),
        }
    )
    assert extract_figures_from_pdf(bomb) == ()


# ---------------------------------------------------------------- PDF fixture validity
def _assert_strictly_valid(pdf: bytes, pages: int) -> None:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(pdf), strict=True)  # raises on a broken xref / startxref
    assert len(reader.pages) == pages
    start = int(pdf[pdf.rindex(b"startxref") :].split()[1])
    assert pdf[start : start + 4] == b"xref"  # startxref really points at the table


def test_synthetic_pdf_builders_produce_strictly_valid_pdfs() -> None:
    from b2_pdf import raster_pdf

    _assert_strictly_valid(raster_pdf([(Image.new("RGB", (64, 64)), (10, 10, 100, 100))]), 1)
    _assert_strictly_valid(
        _pdf([("", {}), ("q 100 0 0 100 50 600 cm /Im1 Do Q", {"Im1": (64, 64, (255, 0, 0))})]), 2
    )
    _assert_strictly_valid(
        _pdf([("q 100 0 0 100 50 600 cm /Im1 Do Q", {"Im1": (64, 64, (0, 0, 255))})], "/Rotate 90"),
        1,
    )


@pytest.mark.parametrize("fixture", ["b2-ethanol-diagram.pdf", "b2-nonchemical-plot.pdf"])
def test_web_acceptance_fixture_pdfs_are_strictly_valid(fixture: str) -> None:
    path = Path(__file__).resolve().parents[3] / "apps" / "web" / "tests" / "fixtures" / fixture
    if not path.is_file():
        pytest.skip("browser fixture not present (PDFs are git-ignored by default)")
    pdf = path.read_bytes()
    _assert_strictly_valid(pdf, 1)
    (fig,) = extract_figures_from_pdf(pdf)
    assert (fig.pixel_width, fig.pixel_height) == (400, 300)
    # placement `q 400 0 0 300 50 100 cm` on a 612x792 page
    got = (fig.x, fig.y, fig.width, fig.height)
    want = (50 / 612, (792 - 100 - 300) / 792, 400 / 612, 300 / 792)
    assert all(abs(g - w) <= 1e-3 for g, w in zip(got, want, strict=True)), (got, want)


# ---------------------------------------------------------------- API integration
def _upload_pdf(client, project_id: str) -> str:
    pdf = _pdf([("q 150 0 0 150 50 450 cm /Im1 Do Q", {"Im1": (120, 100, (255, 255, 255))})])
    resp = client.post(
        f"/v1/projects/{project_id}/documents/imports",
        files={"upload": (f"paper-{uuid4().hex[:6]}.pdf", pdf, "application/pdf")},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["document"]["id"]


def test_api_rejects_development_engine_by_default_and_keeps_failures_out_of_the_record(
    api, monkeypatch
) -> None:
    client, sessions, _settings = api
    project = _project(client, "B2 Review Engine Gate")
    doc = _upload_pdf(client, project["id"])
    cand = client.post(f"/v1/projects/{project['id']}/documents/{doc}/figures/extract").json()[
        "candidates"
    ][0]
    url = f"/v1/projects/{project['id']}/structure-candidates/{cand['id']}/recognize"

    # development engine not selectable, with or without a hint
    r = client.post(url, json={"engine": "chemdft-development-engine", "category_hint": "benzene"})
    assert r.status_code in (400, 422), r.text
    assert r.status_code != 200

    # default engine -> real DECIMER path; with the worker failing it is 503, never a structure
    _fake_run(monkeypatch, returncode=1)
    monkeypatch.setattr(
        engine_mod.DecimerSubprocessEngine,
        "recognize_diagram",
        lambda self, image_bytes, metadata=None: engine_mod.DecimerSubprocessEngine._proposal(
            self,
            "0" * 64,
            metadata or {},
            0.0,
            status=RecognitionStatus.ENGINE_ERROR,
            warnings=("worker failed",),
            diagnostics=["Worker error: simulated"],
        ),
    )
    r = client.post(url, json={"category_hint": "benzene"})
    assert r.status_code == 503, r.text
    from chemdft_api.scientific_models import CandidateRepresentationRecord

    with sessions() as session:
        types = [
            x.representation_type
            for x in session.scalars(
                select(CandidateRepresentationRecord).where(
                    CandidateRepresentationRecord.candidate_id == cand["id"]
                )
            )
        ]
        assert types == ["IMAGE_REFERENCE"]  # nothing persisted for an infrastructure failure


def test_recognized_proposal_cannot_be_promoted_or_become_a_structure(api) -> None:
    client, sessions, settings = api
    settings.recognition_development_engine_enabled = True
    project = _project(client, "B2 Review Promotion Guard")
    doc = _upload_pdf(client, project["id"])
    cand = client.post(f"/v1/projects/{project['id']}/documents/{doc}/figures/extract").json()[
        "candidates"
    ][0]
    rec = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{cand['id']}/recognize",
        json={"engine": "dev", "category_hint": "ethanol"},
    )
    assert rec.status_code == 200
    assert rec.json()["candidate"]["candidate_state"] == "DETECTED"
    promote = client.post(
        f"/v1/projects/{project['id']}/structure-candidates/{cand['id']}/promote", json={}
    )
    assert promote.status_code in (409, 422, 404), promote.text
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(StructureRecord)) == 0
        assert session.scalar(select(func.count()).select_from(StructureVersionRecord)) == 0


def test_repeated_recognition_appends_revisions_without_collision(api) -> None:
    client, sessions, settings = api
    settings.recognition_development_engine_enabled = True
    project = _project(client, "B2 Review Revisions")
    doc = _upload_pdf(client, project["id"])
    cand = client.post(f"/v1/projects/{project['id']}/documents/{doc}/figures/extract").json()[
        "candidates"
    ][0]
    url = f"/v1/projects/{project['id']}/structure-candidates/{cand['id']}/recognize"
    for _ in range(3):
        assert (
            client.post(url, json={"engine": "dev", "category_hint": "ethanol"}).status_code == 200
        )
    from chemdft_api.scientific_models import CandidateRepresentationRecord

    with sessions() as session:
        revs = sorted(
            x.revision
            for x in session.scalars(
                select(CandidateRepresentationRecord).where(
                    CandidateRepresentationRecord.candidate_id == cand["id"]
                )
            )
        )
        assert len(revs) == len(set(revs)) == 1 + 3 * 2
    # re-extracting does not duplicate candidates
    again = client.post(f"/v1/projects/{project['id']}/documents/{doc}/figures/extract").json()[
        "candidates"
    ]
    assert [c["id"] for c in again] == [cand["id"]]


def test_viewer_cannot_extract_or_recognize_but_can_read_figure(api) -> None:
    from chemdft_api import structure_candidate_actions as actions
    from chemdft_api.actions import ProjectAccessDenied  # noqa: F401  (import check only)
    from chemdft_api.context import Identity
    from chemdft_api.models import ProjectMember, User, new_id
    from chemdft_api.storage import LocalObjectStore

    client, sessions, settings = api
    settings.recognition_development_engine_enabled = True
    project = _project(client, "B2 Review Viewer")
    doc = _upload_pdf(client, project["id"])
    cand = client.post(f"/v1/projects/{project['id']}/documents/{doc}/figures/extract").json()[
        "candidates"
    ][0]
    store = LocalObjectStore(settings.object_root)
    with sessions() as session:
        viewer = new_id()
        session.add(User(id=viewer, email="viewer-b2@chemdft.test", display_name="Viewer"))
        session.commit()
        session.add(ProjectMember(project_id=project["id"], user_id=viewer, role="viewer"))
        session.commit()
        who = Identity(user_id=viewer, organization_id=settings.dev_organization_id)
        with pytest.raises(Exception) as denied:
            actions.extract_document_figure_candidates(
                session, who, project["id"], doc, store, settings
            )
        assert (
            "access" in str(denied.value).lower() or denied.type.__name__ == "ProjectAccessDenied"
        )
        with pytest.raises(Exception) as denied2:
            actions.recognize_candidate_figure(
                session, who, project["id"], cand["id"], store, settings, "dev", "ethanol"
            )
        assert denied2.type.__name__ == "ProjectAccessDenied"
        image, media = actions.get_candidate_figure_image(
            session, who, project["id"], cand["id"], store
        )
        assert media == "image/png" and image[:4] == b"\x89PNG"


def test_figure_endpoint_refuses_foreign_or_tampered_storage_keys(api) -> None:
    from chemdft_api.scientific_models import CandidateRepresentationRecord

    client, sessions, _settings = api
    pa, pb = _project(client, "B2 Review Own A"), _project(client, "B2 Review Own B")
    ca = client.post(
        f"/v1/projects/{pa['id']}/documents/{_upload_pdf(client, pa['id'])}/figures/extract"
    ).json()["candidates"][0]
    cb = client.post(
        f"/v1/projects/{pb['id']}/documents/{_upload_pdf(client, pb['id'])}/figures/extract"
    ).json()["candidates"][0]
    # cross-project candidate id in the wrong project path -> 404
    assert (
        client.get(f"/v1/projects/{pa['id']}/structure-candidates/{cb['id']}/figure").status_code
        == 404
    )
    with sessions() as session:
        rep_a = session.scalar(
            select(CandidateRepresentationRecord).where(
                CandidateRepresentationRecord.candidate_id == ca["id"],
                CandidateRepresentationRecord.representation_type == "IMAGE_REFERENCE",
            )
        )
        rep_b = session.scalar(
            select(CandidateRepresentationRecord).where(
                CandidateRepresentationRecord.candidate_id == cb["id"],
                CandidateRepresentationRecord.representation_type == "IMAGE_REFERENCE",
            )
        )
        # even if a DB row were corrupted to point at another project's object, it is refused
        from sqlalchemy import update

        session.execute(
            update(CandidateRepresentationRecord)
            .where(CandidateRepresentationRecord.id == rep_a.id)
            .values(
                payload_json={
                    **rep_a.payload_json,
                    "storage_key": rep_b.payload_json["storage_key"],
                }
            )
        )
        session.commit()
    assert (
        client.get(f"/v1/projects/{pa['id']}/structure-candidates/{ca['id']}/figure").status_code
        == 404
    )


def test_extraction_refuses_tampered_or_foreign_source_documents(api) -> None:
    """The source PDF is untrusted input from storage too: its bytes must match the recorded
    SHA-256 and its object key must belong to the requesting project."""
    from chemdft_api.scientific_models import (
        ScientificArtifactRecord,
        ScientificDocumentRecord,
    )
    from sqlalchemy import update

    client, sessions, _settings = api
    project = _project(client, "B2 Review Source Integrity")
    other = _project(client, "B2 Review Source Integrity Other")
    doc = _upload_pdf(client, project["id"])
    url = f"/v1/projects/{project['id']}/documents/{doc}/figures/extract"
    assert client.post(url).status_code == 200  # intact source extracts

    with sessions() as session:
        artifact = session.scalar(
            select(ScientificArtifactRecord)
            .join(
                ScientificDocumentRecord,
                ScientificDocumentRecord.raw_artifact_id == ScientificArtifactRecord.id,
            )
            .where(ScientificDocumentRecord.id == doc)
        )
        genuine_sha, genuine_key = artifact.sha256, artifact.storage_key
        # 1. recorded hash no longer matches the stored bytes
        session.execute(
            update(ScientificArtifactRecord)
            .where(ScientificArtifactRecord.id == artifact.id)
            .values(sha256="0" * 64)
        )
        session.commit()
    refused = client.post(url)
    assert refused.status_code in (400, 422), refused.text
    assert "SHA-256" in refused.text

    with sessions() as session:
        # 2. key pointing outside the project's object prefix
        session.execute(
            update(ScientificArtifactRecord)
            .where(ScientificArtifactRecord.sha256 == "0" * 64)
            .values(
                sha256=genuine_sha,
                storage_key=genuine_key.replace(project["id"], other["id"], 1),
            )
        )
        session.commit()
    assert client.post(url).status_code == 404


def test_malformed_pdf_extraction_is_a_client_error_not_500(api) -> None:
    client, _sessions, _settings = api
    project = _project(client, "B2 Review Bad PDF")
    resp = client.post(
        f"/v1/projects/{project['id']}/documents/imports",
        files={"upload": ("bad.pdf", b"%PDF-1.4\nnot really", "application/pdf")},
    )
    if resp.status_code == 201:
        doc = resp.json()["document"]["id"]
        r = client.post(f"/v1/projects/{project['id']}/documents/{doc}/figures/extract")
        assert r.status_code < 500, r.text


def test_persisted_recognition_proposal_is_retrievable_after_reload(api) -> None:
    """The researcher UI reloads a candidate from the server; the stored proposal (status,
    formula, charge, warnings, ambiguities) must come back intact and for the LATEST revision,
    not be re-derived or defaulted client-side."""
    client, _sessions, settings = api
    settings.recognition_development_engine_enabled = True
    project = _project(client, "B2 Review Reload")
    doc = _upload_pdf(client, project["id"])
    cand = client.post(f"/v1/projects/{project['id']}/documents/{doc}/figures/extract").json()[
        "candidates"
    ][0]
    base = f"/v1/projects/{project['id']}/structure-candidates/{cand['id']}"

    first = client.post(f"{base}/recognize", json={"engine": "dev", "category_hint": "ethanol"})
    assert first.status_code == 200, first.text
    second = client.post(f"{base}/recognize", json={"engine": "dev", "category_hint": "acetate"})
    assert second.status_code == 200, second.text
    posted = second.json()["proposal"]
    assert posted["formal_charge"] == -1  # a charged proposal: a defaulted 0 would be wrong

    reps = client.get(f"{base}/representations").json()["representations"]
    smiles_reps = [r for r in reps if r["representation_type"] == "SMILES"]
    assert len(smiles_reps) == 2
    latest = max(smiles_reps, key=lambda r: r["revision"])
    detail = client.get(f"{base}/representations/{latest['id']}").json()
    # the representation exposes the SMILES the UI/Ketcher review path needs ...
    assert detail["smiles"] == posted["canonical_isomeric_smiles"]
    # ... and the exact proposal that was returned when it was created
    assert detail["recognition_proposal"] == posted
    assert detail["recognition_proposal"]["is_scientifically_verified"] is False
    first_detail = client.get(
        f"{base}/representations/{min(smiles_reps, key=lambda r: r['revision'])['id']}"
    ).json()
    assert first_detail["recognition_proposal"]["formula"] == "C2H6O"

    # representations that are not recognition output carry no proposal
    image_rep = next(r for r in reps if r["representation_type"] == "IMAGE_REFERENCE")
    assert (
        client.get(f"{base}/representations/{image_rep['id']}").json().get("recognition_proposal")
        is None
    )


# ---------------------------------------------------------------- real model (opt-in)
@pytest.mark.scientific_integration
def test_real_decimer_hint_free_ethanol_drawing() -> None:
    from rdkit.Chem import AllChem
    from rdkit.Chem.Draw import rdMolDraw2D

    settings = Settings()
    cache = settings.decimer_model_cache
    if not (cache / "DECIMER-V2" / "DECIMER_model" / "saved_model.pb").is_file():
        pytest.skip("DECIMER weights not provisioned")
    if (
        not Path(settings.decimer_worker_python).is_file()
        and not (
            Path(__file__).resolve().parents[3]
            / "services/reconstruction-evaluation/.venv/bin/python"
        ).is_file()
    ):
        pytest.skip("DECIMER worker environment not provisioned")
    mol = Chem.MolFromSmiles("CCO")
    AllChem.Compute2DCoords(mol)
    d = rdMolDraw2D.MolDraw2DCairo(400, 300)
    d.DrawMolecule(mol)
    d.FinishDrawing()
    eng = resolve_recognition_engine(None, settings)
    p = eng.recognize_diagram(d.GetDrawingText())  # no metadata, no hints
    assert p.status != RecognitionStatus.ENGINE_ERROR, p.diagnostics
    assert p.is_scientifically_verified is False
    assert p.proposed_smiles is not None
    cmp = _compare_chemical_graphs("CCO", p.proposed_smiles)
    assert cmp["isomorphic"] and cmp["same_charge"]
    assert inchi.MolToInchi(Chem.MolFromSmiles(p.proposed_smiles)).startswith("InChI=1S/C2H6O")
