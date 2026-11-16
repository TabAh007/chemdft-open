"""Engine implementations and dispatch for molecular diagram recognition (Batch B2).

Supports:
1. DecimerSubprocessEngine: Isolated worker subprocess invoking DECIMER on local CPU. This is the
   only engine that performs real model inference.
2. DevelopmentRecognitionEngine: A hint-driven LOOKUP TABLE used by unit tests. It looks at the
   caller-supplied category/hint string, never at image content. It must never be offered to
   researchers; `resolve_recognition_engine` refuses it unless explicitly enabled for local dev.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, ClassVar, Protocol

from PIL import Image

from ...config import Settings
from ...errors import RecognitionEngineUnavailable, ScientificValidationFailed
from .contracts import MolecularRecognitionProposal, RecognitionStatus
from .validation import validate_molecular_graph_proposal


class MolecularRecognitionEngine(Protocol):
    """Protocol for molecular diagram recognition engines."""

    @property
    def engine_name(self) -> str: ...

    @property
    def engine_version(self) -> str: ...

    def recognize_diagram(
        self,
        image_bytes: bytes,
        metadata: dict[str, Any] | None = None,
    ) -> MolecularRecognitionProposal: ...


class DevelopmentRecognitionEngine:
    """Deterministic development engine for unit tests, development sets, and offline testing.

    Identifies test benchmark molecules and enforces genuine failure/abstention handling
    for nonchemical images, unannotated diagrams, and low-quality inputs.
    """

    engine_name = "chemdft-development-engine"
    engine_version = "1.0.0"

    # Known development-set benchmark fingerprints (image content SHA256 or category hint)
    DEV_BENCHMARK_PROPOSALS: ClassVar[dict[str, str]] = {
        "benzene": "c1ccccc1",
        "ethanol": "CCO",
        "acetone": "CC(=O)C",
        "charged": "CC(=O)[O-]",  # Acetate ion
        "acetate": "CC(=O)[O-]",
        "pyridine": "c1ccncc1",
        "aromatic": "c1ccncc1",
        "l_alanine": "N[C@@H](C)C(=O)O",  # Chiral L-alanine
        "stereochemical": "N[C@@H](C)C(=O)O",
        "multiple_structures": "CCO.c1ccccc1",  # Mixture/two structures
    }

    def recognize_diagram(
        self,
        image_bytes: bytes,
        metadata: dict[str, Any] | None = None,
    ) -> MolecularRecognitionProposal:
        started = time.perf_counter()
        meta = metadata or {}
        img_sha256 = hashlib.sha256(image_bytes).hexdigest()

        # Check image decodability
        try:
            with Image.open(io.BytesIO(image_bytes)) as pil_img:
                pil_img.load()
                img_width, img_height = pil_img.size
        except Exception as exc:
            runtime_ms = (time.perf_counter() - started) * 1000
            return MolecularRecognitionProposal(
                source_document_id=str(meta.get("document_id"))
                if meta.get("document_id")
                else None,
                source_document_sha256=str(meta.get("document_sha256"))
                if meta.get("document_sha256")
                else None,
                source_page_number=int(meta["page_number"]) if "page_number" in meta else None,
                source_figure_number=str(meta.get("figure_number"))
                if meta.get("figure_number")
                else None,
                source_figure_anchor_id=str(meta.get("anchor_id"))
                if meta.get("anchor_id")
                else None,
                figure_sha256=img_sha256,
                figure_region=tuple(meta.get("figure_region", (0.0, 0.0, 1.0, 1.0))),
                recognition_engine=self.engine_name,
                engine_version=self.engine_version,
                raw_model_output=None,
                proposed_smiles=None,
                canonical_isomeric_smiles=None,
                formula=None,
                formal_charge=None,
                heavy_atom_count=None,
                elements=(),
                has_stereochemistry=False,
                confidence=None,
                status=RecognitionStatus.PARSE_FAILED,
                is_scientifically_verified=False,
                validation_warnings=("Image cannot be decoded into standard raster format.",),
                diagnostics=(f"Image decoding exception: {exc}",),
                unresolved_ambiguities=(),
                runtime_ms=runtime_ms,
            )

        category = str(meta.get("category", "")).lower()
        hint = str(meta.get("hint", "")).lower()

        # Handle explicit non-chemical or unrecognizable test cases
        raw_smiles: str | None = None
        engine_diag: list[str] = [
            "DEVELOPMENT ENGINE: output is a lookup keyed on the supplied category/hint string. "
            "No image-to-structure inference was performed.",
            f"Input dimensions: {img_width}x{img_height} px",
        ]

        if category in ("nonchemical", "plot", "photo", "xrd", "table"):
            raw_smiles = None
            engine_diag.append(
                f"Image categorized as non-chemical diagram ({category}); "
                "abstained from proposing molecule."
            )
        elif category in ("unrecognizable", "corrupted", "noise"):
            raw_smiles = None
            engine_diag.append(
                "Diagram resolution or contrast is insufficient for structure recognition."
            )
        elif category in ("low_quality", "blurred"):
            raw_smiles = meta.get("raw_smiles", "C1CC1")  # Questionable / blurry cyclopropane
            engine_diag.append("Low contrast/blur detected in figure crop; high uncertainty.")
        elif category in ("missing_labels",):
            raw_smiles = "C=O"  # Missing substituent label
            engine_diag.append(
                "Diagram contains unannotated terminal bonds or missing element labels."
            )
        elif hint in self.DEV_BENCHMARK_PROPOSALS:
            raw_smiles = self.DEV_BENCHMARK_PROPOSALS[hint]
        elif category in self.DEV_BENCHMARK_PROPOSALS:
            raw_smiles = self.DEV_BENCHMARK_PROPOSALS[category]
        elif "raw_smiles" in meta:
            raw_smiles = str(meta["raw_smiles"])
        else:
            # Fallback for arbitrary unrecognized image
            raw_smiles = None
            engine_diag.append("No recognizable chemical graph proposal identified in figure.")

        validation = validate_molecular_graph_proposal(
            raw_smiles=raw_smiles,
            engine_diagnostics=engine_diag,
            category_hint=category,
        )

        runtime_ms = (time.perf_counter() - started) * 1000

        return MolecularRecognitionProposal(
            source_document_id=str(meta.get("document_id")) if meta.get("document_id") else None,
            source_document_sha256=str(meta.get("document_sha256"))
            if meta.get("document_sha256")
            else None,
            source_page_number=int(meta["page_number"]) if "page_number" in meta else None,
            source_figure_number=str(meta.get("figure_number"))
            if meta.get("figure_number")
            else None,
            source_figure_anchor_id=str(meta.get("anchor_id")) if meta.get("anchor_id") else None,
            figure_sha256=img_sha256,
            figure_region=tuple(meta.get("figure_region", (0.0, 0.0, 1.0, 1.0))),
            recognition_engine=self.engine_name,
            engine_version=self.engine_version,
            raw_model_output=raw_smiles,
            proposed_smiles=raw_smiles,
            canonical_isomeric_smiles=validation.canonical_isomeric_smiles,
            formula=validation.formula,
            formal_charge=validation.formal_charge,
            heavy_atom_count=validation.heavy_atom_count,
            elements=validation.elements,
            has_stereochemistry=validation.has_stereochemistry,
            confidence=None,  # Explicitly uncalibrated
            status=validation.status,
            is_scientifically_verified=False,
            validation_warnings=(
                "DEVELOPMENT ENGINE: not a recognition model; result does not depend on the image.",
                *validation.warnings,
            ),
            diagnostics=validation.diagnostics,
            unresolved_ambiguities=validation.ambiguities,
            runtime_ms=runtime_ms,
        )


# --- DECIMER worker -------------------------------------------------------------------------
# The worker is the only place TensorFlow/DECIMER is imported. It runs in a separate interpreter
# (isolated mode, minimal environment), with socket egress blocked and CPU/file-size limits set
# before any heavy import. argv: <pystow home> <cpu seconds>.
_WORKER_CODE = r"""
import io, json, os, resource, socket, sys

pystow_home, cpu_seconds = sys.argv[1], int(sys.argv[2])
os.environ["PYSTOW_HOME"] = pystow_home
resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
resource.setrlimit(resource.RLIMIT_FSIZE, (64 * 1024 * 1024, 64 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))

def _blocked(*_a, **_k):
    raise PermissionError("network access is blocked in the recognition worker")

socket.socket.connect = _blocked
socket.socket.connect_ex = _blocked
socket.create_connection = _blocked
socket.getaddrinfo = _blocked

def emit(obj):
    sys.stdout.write("\n" + json.dumps(obj) + "\n")
    sys.stdout.flush()

from PIL import Image
import numpy as np
Image.MAX_IMAGE_PIXELS = 25_000_000

payload = sys.stdin.buffer.read()
try:
    with Image.open(io.BytesIO(payload)) as img:
        img.load()
        arr = np.asarray(img.convert("RGB"))
except Exception as e:
    emit({"error": "image_decode_failed: " + type(e).__name__})
    sys.exit(0)

try:
    from DECIMER import predict_SMILES
    smiles, tokens = predict_SMILES(arr, confidence=True)
    confs = [float(c) for _tok, c in tokens]
    emit({"smiles": str(smiles).strip() if smiles else None, "token_confidences": confs})
except Exception as e:
    emit({"error": "inference_failed: " + type(e).__name__ + ": " + str(e)[:300]})
"""

MAX_RECOGNITION_PIXELS = 25_000_000
MIN_RECOGNITION_DIMENSION = 32
# Single-flight guard: DECIMER needs ~GBs of RAM per process; never run several at once.
_WORKER_SLOT = threading.BoundedSemaphore(1)


def assess_image_content(image_bytes: bytes) -> tuple[bool, tuple[str, ...], tuple[int, int]]:
    """Cheap, deterministic pre-inference gate.

    Returns (ok, abstention_reasons, (width, height)). This only rejects images that cannot
    plausibly be line drawings (blank or noise/filled-area images). It is a heuristic abstention
    filter, NOT a chemical-diagram classifier: a plot or table with sparse ink passes it.
    """
    with Image.open(io.BytesIO(image_bytes)) as img:
        width, height = img.size
        if width * height > MAX_RECOGNITION_PIXELS:
            return (
                False,
                (f"Image has {width * height} pixels; limit is {MAX_RECOGNITION_PIXELS}.",),
                (width, height),
            )
        img.load()
        gray = img.convert("L")
    if width < MIN_RECOGNITION_DIMENSION or height < MIN_RECOGNITION_DIMENSION:
        return False, ("Image is smaller than 32x32 px.",), (width, height)
    histogram = gray.histogram()
    total = width * height
    mean = sum(level * count for level, count in enumerate(histogram)) / total
    # Background is the majority tone; ink is whatever departs strongly from it.
    background_is_light = mean >= 128
    ink = sum(histogram[:128]) if background_is_light else sum(histogram[128:])
    ink_fraction = ink / total
    reasons: list[str] = []
    if ink_fraction < 0.0005:
        reasons.append("Image has no line content (blank or uniform).")
    elif ink_fraction > 0.35:
        reasons.append(
            f"Image is {ink_fraction:.0%} filled; this is not a sparse line drawing "
            "(photo, noise, or filled plot)."
        )
    return not reasons, tuple(reasons), (width, height)


# DECIMER decodes at most 300 tokens; reaching that limit without an end token is its signature
# failure on non-structure or degraded images (observed: 40-carbon alkane chains from a blurred
# diagram, ring-of-C from a line plot). Repetition screens catch the same junk at shorter length.
MAX_DECODE_TOKENS = 300
MAX_TOKEN_RUN = 20
MAX_IDENTICAL_FRAGMENTS = 4
_SMILES_TOKEN = re.compile(r"\[[^\]]+\]|Br|Cl|%\d\d|.")


def degenerate_output_reason(smiles: str, token_count: int) -> str | None:
    """Return why a model output looks like decoder failure rather than a structure, else None.

    This is a failure-signature filter, NOT a correctness check: a plausible wrong structure
    (for example from a cropped diagram) passes it and must be caught by human review.
    """
    if token_count >= MAX_DECODE_TOKENS:
        return f"decoder reached its {MAX_DECODE_TOKENS}-token limit without finishing"
    tokens = _SMILES_TOKEN.findall(smiles)
    run, longest, previous = 0, 0, None
    for token in tokens:
        run = run + 1 if token == previous else 1
        previous = token
        longest = max(longest, run)
    if longest >= MAX_TOKEN_RUN:
        return f"one SMILES token repeated {longest} times consecutively"
    fragments = [f for f in smiles.split(".") if f]
    if fragments and max(fragments.count(f) for f in fragments) >= MAX_IDENTICAL_FRAGMENTS:
        return "the same fragment is repeated many times"
    return None


def _provenance_fields(meta: dict[str, Any]) -> dict[str, Any]:
    return {
        "source_document_id": str(meta["document_id"]) if meta.get("document_id") else None,
        "source_document_sha256": str(meta["document_sha256"])
        if meta.get("document_sha256")
        else None,
        "source_page_number": int(meta["page_number"]) if "page_number" in meta else None,
        "source_figure_number": str(meta["figure_number"]) if meta.get("figure_number") else None,
        "source_figure_anchor_id": str(meta["anchor_id"]) if meta.get("anchor_id") else None,
        "figure_region": tuple(meta.get("figure_region", (0.0, 0.0, 1.0, 1.0))),
    }


class DecimerSubprocessEngine:
    """Isolated subprocess worker engine for running DECIMER 2.8.0 on CPU.

    Executes DECIMER in a separate interpreter so native TensorFlow crashes, memory growth and
    CPU use cannot affect the API process. The worker has no network access, CPU/file-size
    rlimits, a wall-clock timeout, a minimal environment, and receives the image on stdin (no
    shell, no file paths, no string interpolation of untrusted data).
    """

    engine_name = "DECIMER-Image_Transformer"
    engine_version = "2.8.0"

    def __init__(
        self,
        timeout_seconds: int = 180,
        model_cache: Path | None = None,
        worker_python: Path | None = None,
        cpu_seconds: int = 600,
    ) -> None:
        self.timeout_seconds = timeout_seconds
        self.cpu_seconds = cpu_seconds
        self.model_cache = model_cache or Path(os.path.expanduser("~/.data"))
        self.worker_python = worker_python

    def _executable(self) -> str:
        if self.worker_python is not None and self.worker_python.is_file():
            return str(self.worker_python)
        # services/api/src/chemdft_api/scientific/molecular_recognition/engine.py -> repo root
        repo_root = Path(__file__).resolve().parents[6]
        candidate = (
            repo_root / "services" / "reconstruction-evaluation" / ".venv" / "bin" / "python"
        )
        return str(candidate) if candidate.is_file() else sys.executable

    def _proposal(
        self,
        image_sha256: str,
        meta: dict[str, Any],
        started: float,
        *,
        status: RecognitionStatus,
        warnings: tuple[str, ...],
        diagnostics: list[str],
    ) -> MolecularRecognitionProposal:
        return MolecularRecognitionProposal(
            **_provenance_fields(meta),
            figure_sha256=image_sha256,
            recognition_engine=self.engine_name,
            engine_version=self.engine_version,
            raw_model_output=None,
            proposed_smiles=None,
            canonical_isomeric_smiles=None,
            formula=None,
            formal_charge=None,
            heavy_atom_count=None,
            elements=(),
            has_stereochemistry=False,
            confidence=None,
            status=status,
            is_scientifically_verified=False,
            validation_warnings=warnings,
            diagnostics=tuple(diagnostics),
            unresolved_ambiguities=(),
            runtime_ms=(time.perf_counter() - started) * 1000,
        )

    def recognize_diagram(
        self,
        image_bytes: bytes,
        metadata: dict[str, Any] | None = None,
    ) -> MolecularRecognitionProposal:
        started = time.perf_counter()
        meta = metadata or {}
        img_sha256 = hashlib.sha256(image_bytes).hexdigest()

        saved_model_pb = self.model_cache / "DECIMER-V2" / "DECIMER_model" / "saved_model.pb"
        if not saved_model_pb.is_file():
            return self._proposal(
                img_sha256,
                meta,
                started,
                status=RecognitionStatus.UNSUPPORTED,
                warnings=("DECIMER model weights not installed in local cache.",),
                diagnostics=[f"Expected weights at: {saved_model_pb}"],
            )

        try:
            ok, reasons, (img_w, img_h) = assess_image_content(image_bytes)
        except Exception as exc:
            return self._proposal(
                img_sha256,
                meta,
                started,
                status=RecognitionStatus.PARSE_FAILED,
                warnings=("Image cannot be decoded into standard raster format.",),
                diagnostics=[f"Image decoding exception: {type(exc).__name__}"],
            )
        if not ok:
            return self._proposal(
                img_sha256,
                meta,
                started,
                status=RecognitionStatus.UNRECOGNIZABLE,
                warnings=(
                    "Recognition abstained before model inference: image is not a plausible "
                    "line drawing.",
                ),
                diagnostics=[f"Input dimensions: {img_w}x{img_h} px", *reasons],
            )

        if not _WORKER_SLOT.acquire(blocking=False):
            raise RecognitionEngineUnavailable(
                "Another molecular recognition job is running; retry shortly."
            )
        try:
            proc = subprocess.run(
                [
                    self._executable(),
                    "-I",
                    "-c",
                    _WORKER_CODE,
                    str(self.model_cache),
                    str(self.cpu_seconds),
                ],
                input=image_bytes,
                capture_output=True,
                timeout=self.timeout_seconds,
                env={
                    "PATH": "/usr/bin:/bin",
                    "TF_CPP_MIN_LOG_LEVEL": "3",
                    "CUDA_VISIBLE_DEVICES": "",
                    "OMP_NUM_THREADS": "4",
                    "HF_HUB_OFFLINE": "1",
                },
                start_new_session=True,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return self._proposal(
                img_sha256,
                meta,
                started,
                status=RecognitionStatus.ENGINE_ERROR,
                warnings=("Recognition worker timed out; no structure was proposed.",),
                diagnostics=[f"Worker timed out after {self.timeout_seconds} seconds."],
            )
        except Exception as exc:
            return self._proposal(
                img_sha256,
                meta,
                started,
                status=RecognitionStatus.ENGINE_ERROR,
                warnings=("Recognition worker could not be started.",),
                diagnostics=[f"Failed to spawn DECIMER worker: {type(exc).__name__}"],
            )
        finally:
            _WORKER_SLOT.release()

        out: dict[str, Any] | None = None
        if proc.returncode == 0:
            for line in reversed(proc.stdout.decode("utf-8", errors="replace").splitlines()):
                if line.startswith("{"):
                    try:
                        out = json.loads(line)
                    except json.JSONDecodeError:
                        out = None
                    break
        if out is None or "error" in out:
            detail = (
                out["error"]
                if out
                else f"worker exit code {proc.returncode}: "
                + proc.stderr.decode("utf-8", errors="replace")[-400:]
            )
            return self._proposal(
                img_sha256,
                meta,
                started,
                status=RecognitionStatus.ENGINE_ERROR,
                warnings=(
                    "Recognition engine failed; this is an infrastructure error, not a "
                    "statement about the figure.",
                ),
                diagnostics=[f"Worker error: {detail}"],
            )

        raw_smiles = out.get("smiles")
        confs = [float(c) for c in out.get("token_confidences") or []]
        engine_diag = [
            "DECIMER inference executed in isolated worker process.",
            f"Input dimensions: {img_w}x{img_h} px",
        ]
        if confs:
            engine_diag.append(
                f"DECIMER token confidence (uncalibrated): min={min(confs):.3f}, "
                f"mean={sum(confs) / len(confs):.3f}, tokens={len(confs)}"
            )
        degenerate = degenerate_output_reason(raw_smiles, len(confs)) if raw_smiles else None
        if degenerate:
            return self._proposal(
                img_sha256,
                meta,
                started,
                status=RecognitionStatus.UNRECOGNIZABLE,
                warnings=(
                    "Recognition abstained: the model output looks like decoder failure "
                    f"({degenerate}). No structure is proposed.",
                ),
                diagnostics=[*engine_diag, f"Discarded model output: {raw_smiles[:120]}"],
            )
        validation = validate_molecular_graph_proposal(
            raw_smiles=raw_smiles,
            engine_diagnostics=engine_diag,
            category_hint=str(meta.get("category", "")),
        )
        warnings = list(validation.warnings)
        if validation.is_parseable:
            warnings.insert(
                0,
                "DECIMER emits a SMILES for almost any input, including non-chemical images; "
                "a parseable result is not evidence that the figure shows this molecule.",
            )
        return MolecularRecognitionProposal(
            **_provenance_fields(meta),
            figure_sha256=img_sha256,
            recognition_engine=self.engine_name,
            engine_version=self.engine_version,
            raw_model_output=raw_smiles,
            proposed_smiles=raw_smiles,
            canonical_isomeric_smiles=validation.canonical_isomeric_smiles,
            formula=validation.formula,
            formal_charge=validation.formal_charge,
            heavy_atom_count=validation.heavy_atom_count,
            elements=validation.elements,
            has_stereochemistry=validation.has_stereochemistry,
            confidence=None,  # DECIMER has no calibrated confidence score
            status=validation.status,
            is_scientifically_verified=False,
            validation_warnings=tuple(warnings),
            diagnostics=validation.diagnostics,
            unresolved_ambiguities=validation.ambiguities,
            runtime_ms=(time.perf_counter() - started) * 1000,
        )


DEVELOPMENT_ENGINE_NAMES = frozenset({"dev", "development", "test", "chemdft-development-engine"})
DECIMER_ENGINE_NAMES = frozenset({"decimer", "DECIMER-Image_Transformer"})


def resolve_recognition_engine(
    preferred: str | None = None, settings: Settings | None = None
) -> MolecularRecognitionEngine:
    """Resolve a recognition engine. The default is real DECIMER inference.

    The development (lookup) engine is only returned when `settings` explicitly enables it in a
    local environment; otherwise requesting it is an error, never a silent substitution.
    """
    settings = settings or Settings()
    if preferred is None or preferred in DECIMER_ENGINE_NAMES:
        return DecimerSubprocessEngine(
            timeout_seconds=settings.decimer_wall_seconds,
            model_cache=settings.decimer_model_cache,
            worker_python=settings.decimer_worker_python,
            cpu_seconds=settings.decimer_cpu_seconds,
        )
    if preferred in DEVELOPMENT_ENGINE_NAMES:
        if settings.recognition_development_engine_enabled and settings.environment in (
            "development",
            "test",
            "local",
        ):
            return DevelopmentRecognitionEngine()
        raise ScientificValidationFailed(
            "The development recognition engine is not available in this environment."
        )
    raise ScientificValidationFailed(f"Unknown molecular recognition engine: {preferred!r}.")
