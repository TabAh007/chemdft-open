#!/usr/bin/env python3
"""Run selected browser tests against a fresh, disposable ChemDFT stack."""

import argparse
import base64
import contextlib
import hashlib
import json
import os
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services/api/src"))
sys.path.insert(0, str(ROOT / "tools/e2e_offline"))
from chemdft_api.test_environment import TestEnvironmentError, validate_test_storage  # noqa: E402
from nvidia_stub import STAND_IN_KEY  # noqa: E402

MAX_WEB_SOURCE_BYTES = 64 * 1024**2
MAX_WORKSPACE_BYTES = 2 * 1024**3
MIN_FREE_BYTES = 12 * 1024**3
OFFLINE_SUITES = frozenset(
    {
        "ui-1-ai-scientist",
        "approval-geometry-offline",
        "ai-molecule-creator",
        "ai-model-switching",
        "ai-scientific-workflow",
        "ai-scientist",
        "scientific-safety",
        "ai-nvidia-planning",
        "ai-scientific-execution",
        "ai-kimi-integration",
        "scientific-claims",
    }
)
# Playwright specs under apps/web/tests that must not run against the offline isolated runner,
# along with explicit, non-empty reasons (live services, mock APIs, native binaries, seeded data, etc.).
EXCLUDED_SPECS: dict[str, str] = {
    # Presentation fixture tests requiring standalone mock servers (ports 8291-8293)
    "e2e/ai-context-follows-page.spec.ts": "Requires dedicated AI context mock server and custom web port routing.",
    "e2e/ai-panel-layout.spec.ts": "Requires dedicated AI panel layout mock server and custom web port routing.",
    "e2e/ai-60-audit.spec.ts": "Requires dedicated AI panel layout mock server and custom web port routing.",
    "e2e/claims-workstation.spec.ts": "Requires dedicated claims-mock-api.mjs server on port 8292.",
    "e2e/release-0018-captures.spec.ts": "Requires the three fixture mock APIs and release-0018-proxy.mjs (see playwright.release-0018.config.ts).",
    "e2e/comparison-workstation.spec.ts": "Requires dedicated comparison-mock-api.mjs server on port 8293.",
    "e2e/jobs-workstation.spec.ts": "Requires dedicated jobs-mock-api.mjs server on port 8291.",
    "e2e/settings-redesign.spec.ts": "Requires dedicated settings-mock-api.mjs server on port 8292.",
    # Evidence stack tests requiring pre-seeded database and research artifacts
    "e2e/compare-fixture.spec.ts": "Requires tools/rw2_evidence_stack.py pre-seeded evidence database.",
    "e2e/compare-large-library.spec.ts": "Requires tools/rw2_evidence_stack.py pre-seeded evidence database.",
    "e2e/compare-workstation.spec.ts": "Requires tools/rw2_evidence_stack.py pre-seeded evidence database.",
    "e2e/results-inspector-evidence.spec.ts": "Requires tools/rw2_evidence_stack.py pre-seeded evidence database.",
    "e2e/rw2-cube-evidence.spec.ts": "Requires tools/rw2_evidence_stack.py pre-seeded evidence database.",
    "e2e/rw2-evidence-viewers.spec.ts": "Requires tools/rw2_evidence_stack.py pre-seeded evidence database.",
    "e2e/rw3-workflows.spec.ts": "Requires tools/rw2_evidence_stack.py pre-seeded evidence database.",
    "e2e/rw32-researcher-ux.spec.ts": "Requires tools/rw2_evidence_stack.py pre-seeded evidence database.",
    # External fixture tests requiring local external Gaussian/ORCA fixtures
    "e2e/experimental-spectra-flow.spec.ts": "Requires Gaussian 16 log fixture in .chemdft/external-fixtures.",
    "e2e/external-import-flow.spec.ts": "Requires Gaussian and ORCA output files in .chemdft/external-fixtures.",
    # Desktop real files / real acceptance tests
    "e2e/phase7-real-pdf-flow.spec.ts": "Requires uncommitted real PDF on Desktop (Desktop/chemdft-acceptance).",
    "e2e/ai-scientist-acceptance.spec.ts": "Requires persistent acceptance project ID via CHEMDFT_ACCEPTANCE_PROJECT_ID.",
    # Guided workflow & visualization tests requiring persistent seeded Water/Chromium projects
    "e2e/final-visualization-polish.spec.ts": "Requires persistent seeded Water project f39aefcf-a1cd-4606-8f03-f9b18eadb96d.",
    "e2e/guided-visual-acceptance.spec.ts": "Requires persistent seeded Water project f39aefcf-a1cd-4606-8f03-f9b18eadb96d.",
    "e2e/guided-workflow-acceptance.spec.ts": "Requires persistent seeded Water project f39aefcf-a1cd-4606-8f03-f9b18eadb96d.",
    "e2e/integration-overview-guided-results.spec.ts": "Requires persistent seeded Water project f39aefcf-a1cd-4606-8f03-f9b18eadb96d.",
    "e2e/ir-spectroscopy-flow.spec.ts": "Requires persistent seeded Water project f39aefcf-a1cd-4606-8f03-f9b18eadb96d.",
    "e2e/pre-merge-fixes.spec.ts": "Requires persistent seeded Water and Chromium projects.",
    "e2e/raman-spectroscopy-flow.spec.ts": "Requires persistent seeded Water project f39aefcf-a1cd-4606-8f03-f9b18eadb96d.",
    "e2e/tddft-flow.spec.ts": "Requires persistent seeded Water project f39aefcf-a1cd-4606-8f03-f9b18eadb96d.",
    "e2e/unified-visualization-acceptance.spec.ts": "Requires persistent seeded Water project f39aefcf-a1cd-4606-8f03-f9b18eadb96d.",
    # Calculation / compute worker / binary tests requiring active execution engines
    "e2e/investigation-flow.spec.ts": "Requires live background investigation_worker running during the test.",
    "e2e/optimization-trajectory.spec.ts": "Requires live compute worker executing native PySCF geometry optimization.",
    "e2e/pf8b13-calculation-lifecycle.spec.ts": "Requires live compute worker executing native PySCF calculations.",
    "e2e/pf8b13-corrections.spec.ts": "Requires live compute worker executing native PySCF calculations.",
    "e2e/pf8b13-result-association.spec.ts": "Requires live compute worker executing native PySCF calculations.",
    "e2e/pf8b2-native-optimization.spec.ts": "Requires live compute worker executing native PySCF geometry optimization.",
    "e2e/pf8c-conformer-workstation.spec.ts": "Requires native CREST binary and compute worker.",
    "e2e/pf8c-context-correction.spec.ts": "Requires live compute worker executing native calculations.",
    "e2e/pf8d-c1-layout.spec.ts": "Requires Psi4 calculation engine availability enabled in capabilities.",
    "e2e/project-evidence-workspace.spec.ts": "Requires live background knowledge_worker for document indexing.",
    "e2e/thermochemistry-flow.spec.ts": "Requires live compute worker executing native PySCF thermochemistry.",
    # Legacy shared-stack & interactive flow tests
    "e2e/foundation.spec.ts": "Legacy comprehensive foundation spec targeting shared dev stack.",
    "e2e/chrome109-workspace-layout.spec.ts": "Mock-transport layout spec with its own config (playwright.layout.config.ts); needs no stack.",
    "e2e/molecule-editor-flow.spec.ts": "Mock-transport spec with real Ketcher and its own config (playwright.editor.config.ts); needs no stack.",
    "e2e/molecule-editor-ai-draw.spec.ts": "Mock-transport spec with real Ketcher and its own config (playwright.editor.config.ts); needs no stack.",
    "e2e/molecule-editor-ai-draw-layout.spec.ts": "Mock-transport layout spec with its own config (playwright.editor.config.ts); needs no stack.",
    "e2e/hardening-0-0-8.spec.ts": "Release 0.0.8 UI pass on the disposable evidence stack (tools/rw2_evidence_stack.py): Guided path to Review, Cite this calculation on a genuine result, overflow/axe/tap-target audit; needs that stack and the installed Chrome.",
    "e2e/home-nav-layout.spec.ts": "Public header layout, More menu and collapsed menu with captures (playwright.editor.config.ts); needs no stack.",
    "e2e/overscroll-swipe-back.spec.ts": "Computed overscroll-behavior on public pages and contact text (playwright.editor.config.ts); needs no stack.",
    "e2e/releases-license-layout.spec.ts": "Footer, Releases menu item, anchors and keyboard on the public pages (playwright.editor.config.ts); needs no stack.",
    "e2e/paper-fixes-0-0-11.spec.ts": "Mock-transport spec for release 0.0.11 paper-test fixes (playwright.editor.config.ts); needs no stack.",
    "e2e/other-pages-layout.spec.ts": "Layout measurements of other pages against fixture mock APIs via page.route (playwright.editor.config.ts); needs no stack.",
    "e2e/molecule-editor-ai-draw-fit.spec.ts": "Mock-transport fit-to-view spec with its own config (playwright.editor.config.ts); needs no stack.",
    "e2e/molecule-editor-layout.spec.ts": "Mock-transport layout spec with its own config (playwright.editor.config.ts); needs no stack.",
    "e2e/export-share.spec.ts": "Mock-transport spec for export and share UI with its own config (playwright.editor.config.ts); needs no stack.",
    "e2e/release-0033-workspace-matrix.spec.ts": "Viewport matrix and accessibility spec with its own standalone config (playwright.release-0033.config.ts); needs no stack.",
    "e2e/release-0039-compact-workspace.spec.ts": "Offline compact-layout spec with its own standalone config (playwright.release-0039.config.ts); needs no stack.",
    "e2e/release-0040-wrapping-controls.spec.ts": "Offline wrapping-controls spec with its own standalone config (playwright.release-0040.config.ts); needs no stack.",
    "e2e/release-0041-periodic-setup.spec.ts": "Offline periodic-setup spec with its own standalone config (playwright.release-0041.config.ts); needs no stack.",
    "e2e/release-0043-qe-periodic.spec.ts": "Offline Quantum ESPRESSO periodic spec (engine selector, QE options, DOS/band charts from a marked fixture) with its own standalone config (playwright.release-0043.config.ts); needs no stack.",
    "e2e/release-0034-workspace-matrix.spec.ts": "Viewport matrix and accessibility spec with its own standalone config (playwright.release-0034.config.ts); needs no stack.",
    "e2e/contact.spec.ts": "Public contact form spec with mock transport (needs no stack).",
    "e2e/localhost-real-flow.spec.ts": "Interactive stack flow requiring manual navigation and local project creation.",
    "e2e/missing-project.spec.ts": "Relies on legacy desktop project filter (testInfo.project.name !== 'desktop') not configured in isolated runner.",
    "e2e/scientific-comparison.spec.ts": "Navigates directly to /comparison without prior database project seeding, failing heading expectation.",
    "e2e/ui-audit.spec.ts": "Multi-viewport and AI dock responsiveness audit; runs via mock transport with playwright.editor.config.ts.",
    # Foundation, Auth, Examples, Navigator, and Onboarding specs requiring specific stack services
    "e2e-ai-foundation/foundation.spec.ts": "Requires fake-credential server and billing/secret configuration.",
    "e2e-auth/auth-isolation.spec.ts": "Requires Better Auth server and FastAPI in JWT auth mode.",
    "e2e-auth/beta-account.spec.ts": "Requires Better Auth server and FastAPI in JWT auth mode (release 0.0.10 owner spec).",
    "e2e-auth/homepage.spec.ts": "Requires Better Auth server and JWT auth mode stack.",
    "e2e-examples/examples.spec.ts": "Requires seeded published examples and JWT auth mode.",
    "e2e-navigator/navigator.spec.ts": "Requires ../../services/api relative paths and legacy navigator configuration.",
    "e2e-onboarding/onboarding.spec.ts": "Requires Better Auth server in JWT auth mode.",
    # Renderer specs requiring web-only review routes, capture flags, or GPU/Canvas inspection
    "e2e-renderer/homepage-review-capture.spec.ts": "Visual review capture requiring CHEMDFT_HOMEPAGE_CAPTURE=1 and real GPU.",
    "e2e-renderer/homepage.spec.ts": "Requires web-only dev stack without API and inspectAtoms() helper.",
    "e2e-renderer/molecular-renderer.spec.ts": "Requires /renderer-review review route and web-only dev stack.",
    "e2e-renderer/pf3h.spec.ts": "Requires web-only dev stack and legacy structure transition frames.",
    "e2e-renderer/review-capture.spec.ts": "Visual review capture requiring CHEMDFT_RENDERER_CAPTURE=1 and real GPU.",
}
# The one offline suite that talks to a model endpoint: a loopback stand-in behind the real HTTP
# gateway (tools/e2e_offline/nvidia_stub.py). It is never hosted-compatibility evidence.
STAND_IN_SUITE = "ai-nvidia-planning"
# Browser checks of direct Kimi: the loopback stand-in also answers as Moonshot (test-only base).
KIMI_SUITE = "ai-kimi-integration"
# The one suite that sends real requests to NVIDIA through the budget-enforcing launcher
# (tools/nvidia_probe/browser_live.py). It refuses to start without a valid, armed authorization.
LIVE_SUITE = "ai-live-browser"
# The one suite that also runs ONE local PySCF calculation from a live real-model proposal after an
# explicit approval click; bound to a single case, a single model and an execution arming variable.
LIVE_EXEC_SUITE = "ai-live-execution"
LIVE_SUITES = (LIVE_SUITE, LIVE_EXEC_SUITE)
EXEC_CASE_ID = "A-h2-hf-sto3g"
EXEC_PLANNING_CASE = "h2-hf-sto3g"
EXEC_MODEL = "nvidia/nemotron-3-super-120b-a12b"
EXEC_ARM_ENV = "CHEMDFT_LIVE_EXECUTION_ARMED"
EXEC_LIMITS = {
    "engine": "pyscf",
    "engine_version": "2.14.0",
    "threads": 1,
    "memory_bytes": 2 * 1024**3,
    "scratch_bytes": 1024**3,
    "wall_seconds": 180,
    "max_atoms": 2,
    "local_only": True,
}
REHEARSAL_CASES = ["h2-hf-sto3g", "h2o-hf-631g", "ethanol-hf-sto3g"]
STAND_IN_FLOW_MODELS = [
    "nvidia/nemotron-3-super-120b-a12b",
    "stepfun-ai/step-5-preview",
]
MOONSHOT_REHEARSAL_MODELS = ["kimi-k2.6", "kimi-k3"]
LIVE_ENV_KEEP = ("PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "SHELL", "TERM")
STAND_IN_MODELS = {
    "CHEMDFT_AI_MODEL_FAST": "stepfun-ai/step-5-preview",
    "CHEMDFT_AI_MODEL_STANDARD": "nvidia/nemotron-3.5-lightning-30b-a3b",
    "CHEMDFT_AI_MODEL_REASONING": "nvidia/nemotron-3-super-120b-a12b",
    "CHEMDFT_AI_DEVELOPMENT_MODELS": "nvidia/nemotron-3-super-120b-a12b,stepfun-ai/step-5-preview",
}


def offline_environment(parent: dict[str, str]) -> dict[str, str]:
    """Pass OS runtime essentials, never inherited service settings or credentials."""
    env = {
        key: parent[key]
        for key in (
            "PATH",
            "HOME",
            "USER",
            "LOGNAME",
            "LANG",
            "LC_ALL",
            "TMPDIR",
            "SHELL",
            "TERM",
        )
        if key in parent
    }
    env.update(
        {
            "CHEMDFT_E2E_OFFLINE": "1",
            "CHEMDFT_AI_PROVIDER": "fake",
            "CHEMDFT_RUN_AI_INTEGRATION": "false",
            "CHEMDFT_E2E_WORKER_MODE": "disabled",
            "PYTHONPATH": os.pathsep.join(
                (str(ROOT / "tools/e2e_offline"), str(ROOT / "services/api/src"))
            ),
            "PYTHONDONTWRITEBYTECODE": "1",
            "NEXT_TELEMETRY_DISABLED": "1",
            "OPENBLAS_NUM_THREADS": "1",
            "OMP_NUM_THREADS": "1",
            "VECLIB_MAXIMUM_THREADS": "1",
        }
    )
    return env


def free_loopback_port(*taken: int) -> int:
    for _ in range(50):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        if port >= 1024 and port not in taken and available(port):
            return port
    raise TestEnvironmentError("TEST_PORT_UNAVAILABLE: no free loopback port for the stand-in")


def write_rehearsal_authorization(
    work: Path, provider: str = "nvidia", models: list | None = None, cases: list | None = None
) -> Path:
    """A flow authorization for the rehearsal only; it names the stand-in, never a person."""
    sys.path.insert(0, str(ROOT / "tools"))
    from nvidia_probe.molecules import REFERENCE_FIXTURE_ID, reference_cases_digest

    now = datetime.now(UTC)
    cases = cases or REHEARSAL_CASES
    models = models or (
        MOONSHOT_REHEARSAL_MODELS if provider == "moonshot" else STAND_IN_FLOW_MODELS
    )
    calls = len(models) * len(cases) * 2
    data = {
        "schema": "chemdft.nvidia-flow-authorization.v1",
        "authorized_by": "REHEARSAL against the loopback stand-in; no provider",
        "authorized_at": now.isoformat(),
        "expires_at": (now + timedelta(hours=2)).isoformat(),
        "endpoint": "https://api.moonshot.ai/v1"
        if provider == "moonshot"
        else "https://integrate.api.nvidia.com/v1",
        "models": models,
        "flow": {
            "planning_profile": "PYSCF_ENERGY_PROPOSAL",
            "max_model_calls_per_model": 2,
            "input_token_basis": "SERVICE_RESERVATION",
            "read_timeout_seconds": 120,
            "cases": cases,
            "cases_sha256": reference_cases_digest(cases),
        },
        "max_total_calls": calls,
        "max_input_tokens_per_request": 32768,
        "max_output_tokens_per_request": 2048,
        "max_total_tokens": min(208000, calls * 34000),
        "max_wall_clock_seconds": 1800,
        "per_call_wall_clock_seconds": 150,
        "spend_control": {
            "kind": "USD_CEILING",
            "ceiling_usd": 1.0,
            "input_usd_per_million_tokens": 3.0,
            "output_usd_per_million_tokens": 15.0,
            "pricing_source": "rehearsal against the loopback stand-in; no provider is billed",
        }
        if provider == "moonshot"
        else {"kind": "TOKEN_CEILING_ONLY", "acknowledged_no_cost_information": True},
        "no_retries": True,
        "no_fallback": True,
        "no_scientific_compute": True,
        "no_production_data": True,
        "fixture": REFERENCE_FIXTURE_ID,
        "sampling": "PRODUCTION_DEFAULT" if provider == "moonshot" else "MODEL_CARD_PROFILE",
    }
    path = work / "rehearsal-authorization.json"
    path.write_text(json.dumps(data, indent=1))
    return path


def live_check(validate_only: bool) -> dict:
    """Validate (and, unless validate_only, arm-check) the live authorization in a clean process.

    The check runs the launcher's own refusals with a minimal environment; it reads no key content
    and opens no socket. A failure stops the runner before any workspace or service exists.
    """
    path = os.environ.get("CHEMDFT_LIVE_AUTHORIZATION")
    if not path:
        raise TestEnvironmentError(
            "TEST_LIVE_AUTHORIZATION_REQUIRED: set CHEMDFT_LIVE_AUTHORIZATION to the approved file"
        )
    env = {key: os.environ[key] for key in LIVE_ENV_KEEP if key in os.environ}
    env.update(
        PYTHONPATH=str(ROOT / "tools"),
        CHEMDFT_LIVE_AUTHORIZATION=path,
        CHEMDFT_LIVE_REPORT="/dev/null",
    )
    for source, target in (
        ("CHEMDFT_NVIDIA_PROBE_ARMED", "CHEMDFT_NVIDIA_PROBE_ARMED"),
        ("CHEMDFT_NVIDIA_PROBE_KEY_FILE", "CHEMDFT_AI_API_KEY_FILE"),
        ("CHEMDFT_MOONSHOT_PROBE_KEY_FILE", "CHEMDFT_MOONSHOT_API_KEY_FILE"),
    ):
        if source in os.environ:
            env[target] = os.environ[source]
    done = subprocess.run(
        [
            str(ROOT / ".venv/bin/python"),
            "-B",
            "-m",
            "nvidia_probe.browser_live",
            "--validate" if validate_only else "--check",
        ],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    if done.returncode != 0:
        raise TestEnvironmentError(
            f"TEST_LIVE_REFUSED: {done.stdout.strip() or done.stderr[-200:]}"
        )
    return json.loads(done.stdout.strip().splitlines()[-1])


def execution_binding(plan: dict) -> dict:
    """What the explicit execution approval binds: model, case, structure, settings, limits."""
    sys.path.insert(0, str(ROOT / "tools"))
    from scientific_execution.cases import execution_case

    case = execution_case(EXEC_CASE_ID)
    return {
        "case": case.id,
        "model": EXEC_MODEL,
        "structure_sha256": case.recorded_sha256,
        "geometry_basis": case.geometry_basis,
        "prompt": case.prompt,
        "expect": case.expect,
        "limits": EXEC_LIMITS,
        "nvidia_authorization_sha256": plan.get("authorization_sha256"),
    }


def execution_binding_digest(plan: dict) -> str:
    return hashlib.sha256(
        json.dumps(execution_binding(plan), sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def planning_fixture() -> str:
    """The reference molecules and planning cases the browser suite uses, from their one source."""
    sys.path.insert(0, str(ROOT / "tools"))
    from nvidia_probe.molecules import PLANNING_CASES, reference_molecules

    molecules = {
        key: {
            "file": m.file,
            "format": m.format,
            "sha256": m.sha256,
            "structure_name": m.structure_name,
            "media_type": m.media_type,
            "formula": m.formula,
            "atoms": m.atoms,
            "charge": m.charge,
            "multiplicity": m.multiplicity,
            "source": m.source["identifier"],
        }
        for key, m in reference_molecules().items()
    }
    cases = [
        {"id": c.id, "molecule": c.molecule, "prompt": c.prompt, "kind": c.kind, "expect": c.expect}
        for c in PLANNING_CASES
    ]
    return json.dumps({"molecules": molecules, "cases": cases})


def execution_fixture() -> str:
    """The three first real cases (AI-7) for the browser suite, from their one source."""
    sys.path.insert(0, str(ROOT / "tools"))
    from scientific_execution.cases import (
        EXECUTION_CASES,
        EXPECTED_ENGINE_VERSION,
        H2_REFERENCE_ENERGY_EH,
        H2_REFERENCE_TOLERANCE_EH,
    )

    cases = [
        {
            "id": c.id,
            "label": c.label,
            "prompt": c.prompt,
            "filename": c.filename,
            "format": c.format,
            "mediaType": c.media_type,
            "structureName": c.structure_name,
            "dataBase64": base64.b64encode(c.data()).decode(),
            "sha256": c.recorded_sha256,
            "geometryBasis": c.geometry_basis,
            "expect": c.expect,
            "referenceEnergy": H2_REFERENCE_ENERGY_EH if c.comparable_reference else None,
            "referenceTolerance": H2_REFERENCE_TOLERANCE_EH if c.comparable_reference else None,
        }
        for c in EXECUTION_CASES
    ]
    return json.dumps({"cases": cases, "engineVersion": EXPECTED_ENGINE_VERSION})


def live_summary(database: Path, execution: bool = False) -> dict:
    """Real persisted states of a live pass: proposals only, or exactly one authorized run."""
    with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as conn:
        executions = conn.execute("SELECT count(*) FROM compute_executions").fetchone()[0]
        results = conn.execute("SELECT count(*) FROM calculation_results").fetchone()[0]
        jobs = conn.execute("SELECT count(*) FROM compute_jobs").fetchone()[0]
        providers = [
            r[0] for r in conn.execute("SELECT DISTINCT provider FROM ai_model_invocations")
        ]
        runs = dict(conn.execute("SELECT status, count(*) FROM ai_runs GROUP BY status"))
        job_states = dict(conn.execute("SELECT state, count(*) FROM compute_jobs GROUP BY state"))
    allowed = (1, 1, 1) if execution else (0, 0, 0)
    if (executions, results, jobs) != allowed:
        raise TestEnvironmentError(
            "TEST_LIVE_INVARIANT_FAILED: compute jobs, executions or results differ from the "
            f"authorized {allowed}: {(jobs, executions, results)}"
        )
    return {
        "category": "LIVE_REAL_MODEL_BROWSER_APPROVED_EXECUTION_ONE_LOCAL_PYSCF_RUN"
        if execution
        else "LIVE_NVIDIA_BROWSER_PROPOSALS_ONLY_NO_SCIENTIFIC_EXECUTION",
        "executions": executions,
        "calculated_results": results,
        "compute_jobs": jobs,
        "job_states": job_states,
        "providers": providers,
        "run_states": runs,
        "worker": "enabled" if execution else "disabled",
    }


def offline_summary(work: Path, database: Path, stand_in: bool = False) -> dict:
    """Read real persisted states; never infer a scientific success from a queued job."""
    with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as conn:
        executions = conn.execute("SELECT count(*) FROM compute_executions").fetchone()[0]
        results = conn.execute("SELECT count(*) FROM calculation_results").fetchone()[0]
        providers = conn.execute("SELECT DISTINCT provider FROM ai_model_invocations").fetchall()
        jobs = dict(conn.execute("SELECT state, count(*) FROM compute_jobs GROUP BY state"))
        runs = dict(conn.execute("SELECT status, count(*) FROM ai_runs GROUP BY status"))
    expected_providers = {"nvidia", "moonshot"} if stand_in else {"fake"}
    if executions or results or any(row[0] not in expected_providers for row in providers):
        raise TestEnvironmentError("TEST_OFFLINE_INVARIANT_FAILED: execution/result/provider")
    if (work / "blocked-network.jsonl").exists():
        raise TestEnvironmentError("TEST_OFFLINE_NETWORK_ATTEMPT: inspect blocked-network.jsonl")
    return {
        "category": "OFFLINE_NVIDIA_STAND_IN_NO_SCIENTIFIC_EXECUTION"
        if stand_in
        else "OFFLINE_FAKE_AI_NO_SCIENTIFIC_EXECUTION",
        "executions": executions,
        "calculated_results": results,
        "providers": [row[0] for row in providers],
        "job_states": jobs,
        "run_states": runs,
        "worker": "disabled",
    }


def preserve_diagnostics(work: Path, destination: Path) -> None:
    """Copy only bounded test outputs/logs; never copy databases, secrets or Next caches."""
    for relative in ("output", "ui-1-browser", "playwright-results"):
        source = work / relative
        if source.is_dir():
            shutil.copytree(source, destination / relative, symlinks=False)
    for pattern in ("*.log", "*.json", "*.jsonl", "*.png"):
        for source in work.glob(pattern):
            if source.is_file() and not source.is_symlink():
                shutil.copyfile(source, destination / source.name)


def initialize_database(env: dict[str, str], database: Path) -> None:
    validate_test_storage(
        env["CHEMDFT_DATABASE_URL"], env["CHEMDFT_OBJECT_ROOT"], env["CHEMDFT_TEST_WORKSPACE"], ROOT
    )
    if database.exists():
        raise TestEnvironmentError("TEST_DATABASE_EXISTS: refusing to migrate existing storage")
    subprocess.run(
        [str(ROOT / ".venv/bin/python"), "-B", "-m", "alembic", "upgrade", "head"],
        cwd=ROOT / "services/api",
        env=env,
        check=True,
        capture_output=True,
    )
    with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as connection:
        if connection.execute("SELECT version_num FROM alembic_version").fetchone() != (
            "0030_beta_readiness",
        ):
            raise TestEnvironmentError("TEST_MIGRATION_HEAD_MISMATCH")
    subprocess.run(
        [
            str(ROOT / ".venv/bin/python"),
            "-B",
            "-c",
            "from chemdft_api.auth import ensure_dev_identity; "
            "from chemdft_api.config import get_settings; "
            "from chemdft_api.database import SessionLocal; "
            "s=SessionLocal(); ensure_dev_identity(s,get_settings()); s.close()",
        ],
        cwd=ROOT,
        env=env,
        check=True,
        capture_output=True,
    )


def prepare_web_workspace(work: Path) -> Path:
    """Copy small web sources; share installed dependencies without overwriting sources."""
    destination = work / "apps/web"
    size = 0

    def copy_file(source, target):
        nonlocal size
        if Path(source).is_symlink():
            raise TestEnvironmentError("TEST_SOURCE_SYMLINK: refusing to copy unknown source links")
        size += Path(source).stat().st_size
        if size > MAX_WEB_SOURCE_BYTES:
            raise TestEnvironmentError("TEST_SOURCE_SIZE: web source copy exceeds 64 MiB")
        return shutil.copy2(source, target)

    shutil.copytree(
        ROOT / "apps/web",
        destination,
        copy_function=copy_file,
        ignore=shutil.ignore_patterns(
            "node_modules",
            ".next*",
            ".env*",
            ".turbo",
            "*.tsbuildinfo",
            "playwright-report",
            "test-results",
            "*.db",
            "*.sqlite*",
            ".DS_Store",
            ".impeccable",
        ),
    )
    copy_file(ROOT / "tsconfig.base.json", work / "tsconfig.base.json")
    (destination / "node_modules").symlink_to(
        ROOT / "apps/web/node_modules", target_is_directory=True
    )
    (work / "node_modules").symlink_to(ROOT / "node_modules", target_is_directory=True)
    (work / "services").symlink_to(ROOT / "services", target_is_directory=True)
    return destination


def workspace_bytes(work: Path) -> int:
    return sum(
        path.stat().st_size for path in work.rglob("*") if not path.is_symlink() and path.is_file()
    )


def manual_worker_command() -> list[str]:
    # SIGTERM becomes a Python exception, allowing the native runner's finally
    # block to terminate the scientific subprocess's separate process group.
    return [
        str(ROOT / ".venv/bin/python"),
        "-B",
        "-c",
        "import signal\ndef stop(*_): raise SystemExit(143)\n"
        "signal.signal(signal.SIGTERM, stop)\n"
        "from chemdft_api.compute_worker import run\nrun()",
    ]


def manual_worker_authorized(database: Path, ready: dict, actor_id: str) -> bool:
    """Observe actual UI consent; this function never creates or decides approval."""
    with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as connection:
        row = connection.execute(
            "SELECT a.status, a.project_id, a.run_id, a.actor_id, a.action_fingerprint, "
            "a.normalized_arguments_json, r.status, r.waiting_calculation_id "
            "FROM ai_approvals a JOIN ai_runs r ON r.id=a.run_id WHERE a.id=?",
            (ready["approval_id"],),
        ).fetchone()
        if row is None:
            raise TestEnvironmentError("TEST_APPROVAL_MISSING")
        if row[0] == "PENDING":
            return False
        if row[0] != "APPROVED":
            raise TestEnvironmentError("TEST_HUMAN_APPROVAL_REFUSED")
        args = json.loads(row[5])
        spec = args.get("specification", {})
        target = args.get("structure_version", {})
        fingerprint = hashlib.sha256(
            json.dumps(args, sort_keys=True, separators=(",", ":"), default=str).encode()
        ).hexdigest()
        if (
            row[1] != ready["project_id"]
            or row[2] != ready["run_id"]
            or row[3] != actor_id
            or row[4] != ready["action_fingerprint"]
            or row[4] != fingerprint
            or target.get("entity_id") != ready["structure_version_id"]
            or target.get("project_id") != row[1]
            or target.get("entity_type") != "structure.version"
            or spec.get("charge") != 0
            or spec.get("multiplicity") != 1
            or str(spec.get("method", {}).get("identifier", "")).lower() != "hf"
            or str(spec.get("basis", {}).get("identifier", "")).lower() != "sto-3g"
            or spec.get("engine_preference", {}).get("engine") != "pyscf"
            or spec.get("task_type") != "ENERGY"
        ):
            raise TestEnvironmentError("TEST_APPROVAL_BINDING_MISMATCH")
        if row[6] != "WAITING_FOR_CALCULATION" or not row[7]:
            return False
        jobs = connection.execute(
            "SELECT project_id, calculation_id, state FROM compute_jobs"
        ).fetchall()
        if jobs != [(row[1], row[7], "READY")]:
            raise TestEnvironmentError(
                "TEST_COMPUTE_QUEUE_MISMATCH: expected exactly one approved job"
            )
        return True


def available(port: int) -> bool:
    with socket.socket() as sock:
        return sock.connect_ex(("127.0.0.1", port)) != 0


def verify_stack_identity(env: dict[str, str]) -> None:
    """Read both services before any test can create a scientific record."""
    for url in (
        f"http://127.0.0.1:{env['CHEMDFT_E2E_API_PORT']}/v1/me",
        f"http://127.0.0.1:{env['CHEMDFT_E2E_WEB_PORT']}/api/chemdft/v1/me",
    ):
        with urllib.request.urlopen(url, timeout=15) as response:
            identity = json.load(response)
        if (
            identity.get("id") != env["CHEMDFT_DEV_USER_ID"]
            or identity.get("organization", {}).get("id") != env["CHEMDFT_DEV_ORGANIZATION_ID"]
        ):
            raise TestEnvironmentError(
                f"TEST_SERVICE_IDENTITY_MISMATCH: refusing service reuse at {url}"
            )


def wait_http(
    url: str, process: subprocess.Popen, seconds: int = 90, *, workspace: Path | None = None
) -> None:
    deadline = time.monotonic() + seconds
    last_watch = 0.0
    while time.monotonic() < deadline:
        if workspace is not None and time.monotonic() - last_watch > 5:
            last_watch = time.monotonic()
            if (
                workspace_bytes(workspace) > MAX_WORKSPACE_BYTES
                or shutil.disk_usage(workspace).free < MIN_FREE_BYTES
            ):
                raise TestEnvironmentError(
                    "TEST_DISK_RESERVE: disposable startup exceeds disk limits"
                )
        if process.poll() is not None:
            raise RuntimeError(f"TEST_SERVICE_EXITED: {url} exited with {process.returncode}")
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status < 400:
                    return
        except Exception:
            time.sleep(0.5)
    raise RuntimeError(f"TEST_SERVICE_TIMEOUT: {url} did not become ready")


def smoke(api_port: int, database: Path, objects: Path) -> None:
    base = f"http://127.0.0.1:{api_port}/v1/projects"
    slug = f"isolated-{uuid.uuid4().hex[:12]}"
    request = urllib.request.Request(
        base,
        data=json.dumps({"name": "Isolated safety smoke", "slug": slug}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        project = json.load(response)
    boundary = f"chemdft-{uuid.uuid4().hex}"
    xyz = b"3\nwater\nO 0 0 0\nH 0.758602 0 0.504284\nH -0.758602 0 0.504284\n"
    parts = []
    for name, value in (("file_format", "XYZ"), ("idempotency_key", str(uuid.uuid4()))):
        parts.append(
            (
                f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'
            ).encode()
        )
    parts.append(
        (
            f'--{boundary}\r\nContent-Disposition: form-data; name="upload"; '
            'filename="water.xyz"\r\nContent-Type: chemical/x-xyz\r\n\r\n'
        ).encode()
        + xyz
        + b"\r\n"
    )
    body = b"".join(parts) + f"--{boundary}--\r\n".encode()
    request = urllib.request.Request(
        f"{base}/{project['id']}/structures/imports",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        structure = json.load(response)
    with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as connection:
        saved_project = connection.execute(
            "select count(*) from projects where id=?", (project["id"],)
        ).fetchone()[0]
        saved_version = connection.execute(
            "select count(*) from structure_versions where id=?", (structure["version"]["id"],)
        ).fetchone()[0]
    if saved_project != 1 or saved_version != 1 or not any(objects.rglob("*")):
        raise RuntimeError(
            "TEST_SMOKE_PERSISTENCE_FAILED: project, structure version or object missing"
        )
    print(
        f"TEST_SMOKE_OK project={project['id']} version={structure['version']['id']} "
        f"isolated_db={database} isolated_objects={objects}"
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-port", type=int, default=8123)
    parser.add_argument("--web-port", type=int, default=3100)
    parser.add_argument("--check-only", action="store_true")
    parser.add_argument(
        "--offline",
        action="store_true",
        help="fake AI, no compute worker, clean environment and loopback-only sandbox",
    )
    parser.add_argument("--artifacts-dir", help="new output/playwright directory for evidence")
    parser.add_argument(
        "--smoke",
        action="store_true",
        help="create one project and structure in the disposable stack",
    )
    parser.add_argument(
        "--suite",
        choices=(
            "geometry",
            "scientific-safety",
            "psi4-ui",
            "rw1-journey",
            "rw2-analysis",
            "ai-molecule-creator",
            "ai-model-switching",
            "ai-scientist",
            "molecular-recognition",
            "molecular-correction",
            "ai-scientific-workflow",
            "ai-calculation-execution",
            "as-c1-nvidia",
            "approval-geometry-offline",
            "ui-1-ai-scientist",
            "ai-scientific-execution",
            STAND_IN_SUITE,
            KIMI_SUITE,
            LIVE_SUITE,
            LIVE_EXEC_SUITE,
            "scientific-claims",
        ),
        default="geometry",
    )
    parser.add_argument(
        "--no-worker",
        action="store_true",
        help="test queue submission/cancellation without native execution",
    )
    parser.add_argument(
        "--accept-local-resource-limitations",
        action="store_true",
        help="explicitly accept macOS local execution without hard RAM/disk isolation",
    )
    parser.add_argument(
        "--manual-approval-seconds",
        type=int,
        default=600,
        help="live NVIDIA flow: wait for personal UI approval, at most 1800 seconds",
    )
    parser.add_argument(
        "--retain-on-failure",
        action="store_true",
        help="retain the disposable workspace, logs and traces on failure",
    )
    parser.add_argument(
        "--retain-workspace",
        action="store_true",
        help="preserve disposable calculation evidence and service logs after acceptance",
    )
    parser.add_argument(
        "--live-validate",
        action="store_true",
        help="ai-live-browser: validate the authorization and print its limits; start nothing",
    )
    parser.add_argument(
        "--live-rehearsal",
        action="store_true",
        help="ai-live-browser: run the identical launcher and spec against the loopback stand-in "
        "(no provider, no real key); proves the harness before any authorized live pass",
    )
    parser.add_argument(
        "--live-provider",
        choices=("nvidia", "moonshot"),
        default="nvidia",
        help="ai-live-browser rehearsal only: which provider the stand-in impersonates",
    )
    parser.add_argument("playwright_args", nargs=argparse.REMAINDER)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if args.suite in (STAND_IN_SUITE, KIMI_SUITE) and not args.offline:
        raise TestEnvironmentError(
            "TEST_STAND_IN_REQUIRES_OFFLINE: the NVIDIA stand-in suite runs only with --offline"
        )
    # This branch runs before creating storage, loading settings or starting a service.
    if args.offline:
        if args.suite not in OFFLINE_SUITES:
            raise TestEnvironmentError("TEST_OFFLINE_SUITE_REQUIRED: live/native suite forbidden")
        args.no_worker = True
        if os.environ.get("_CHEMDFT_OFFLINE_SANDBOXED") != "1":
            sandbox = shutil.which("sandbox-exec")
            if sys.platform != "darwin" or sandbox is None:
                raise TestEnvironmentError("TEST_OFFLINE_SANDBOX_UNAVAILABLE: no stack was started")
            env = offline_environment(os.environ)
            env["_CHEMDFT_OFFLINE_SANDBOXED"] = "1"
            return subprocess.call(
                [
                    sandbox,
                    "-f",
                    str(ROOT / "tools/e2e_offline/loopback-only.sb"),
                    sys.executable,
                    "-B",
                    str(Path(__file__).resolve()),
                    *sys.argv[1:],
                ],
                env=env,
            )
    live_plan = None
    live_exec = args.suite == LIVE_EXEC_SUITE
    if args.suite in LIVE_SUITES:
        if args.offline:
            raise TestEnvironmentError(
                "TEST_LIVE_REFUSES_OFFLINE: the live suite needs the network"
            )
        if args.playwright_args or args.smoke:
            raise TestEnvironmentError(
                "TEST_LIVE_OPTIONS: one authorized live pass permits no repetition or smoke run"
            )
        if args.live_rehearsal:
            if args.live_validate:
                raise TestEnvironmentError("TEST_LIVE_REHEARSAL_HAS_NOTHING_TO_VALIDATE")
            live_plan = {
                "rehearsal": True,
                "provider": "nvidia" if live_exec else args.live_provider,
                "cases": [EXEC_PLANNING_CASE] if live_exec else REHEARSAL_CASES,
                "models": [EXEC_MODEL]
                if live_exec
                else (
                    MOONSHOT_REHEARSAL_MODELS
                    if args.live_provider == "moonshot"
                    else STAND_IN_FLOW_MODELS
                ),
            }
        else:
            live_plan = live_check(args.live_validate)
            if live_exec:
                if live_plan["models"] != [EXEC_MODEL] or live_plan["cases"] != [
                    EXEC_PLANNING_CASE
                ]:
                    raise TestEnvironmentError(
                        "TEST_LIVE_EXECUTION_SCOPE: the execution suite runs exactly one model "
                        "and one case"
                    )
                live_plan = {
                    **live_plan,
                    "execution_binding": execution_binding(live_plan),
                    "execution_binding_sha256": execution_binding_digest(live_plan),
                }
            if args.live_validate:
                print(json.dumps(live_plan, indent=2))
                return 0
            if live_exec and (
                os.environ.get("CHEMDFT_LIVE_EXECUTION_CASE") != EXEC_CASE_ID
                or os.environ.get(EXEC_ARM_ENV)
                != f"EXECUTE-{live_plan['execution_binding_sha256'][:16]}"
            ):
                raise TestEnvironmentError(
                    "TEST_LIVE_EXECUTION_NOT_ARMED: native execution needs "
                    f"CHEMDFT_LIVE_EXECUTION_CASE={EXEC_CASE_ID} and {EXEC_ARM_ENV} bound to the "
                    "printed binding digest"
                )
        # Native compute exists only in the real execution pass; all else keeps the worker off.
        if not live_exec or live_plan.get("rehearsal"):
            args.no_worker = True
    elif args.live_validate or args.live_rehearsal:
        raise TestEnvironmentError("TEST_LIVE_OPTION_NEEDS_LIVE_SUITE")
    manual = args.suite == "as-c1-nvidia"
    if manual and (args.playwright_args or args.smoke or args.no_worker):
        raise TestEnvironmentError(
            "TEST_MANUAL_OPTIONS: one manual H2 experiment permits no test repetition, "
            "smoke, or worker override"
        )
    if manual and not args.accept_local_resource_limitations:
        raise TestEnvironmentError(
            "TEST_RESOURCE_ACCEPTANCE_REQUIRED: live local H2 needs explicit acceptance of "
            "missing hard memory/disk isolation; no workspace or service was started"
        )
    if not 30 <= args.manual_approval_seconds <= 1800:
        raise TestEnvironmentError("TEST_APPROVAL_TIMEOUT_INVALID: use 30-1800 seconds")
    if not all(1024 <= port <= 65535 for port in (args.api_port, args.web_port)):
        raise TestEnvironmentError(
            "TEST_PORT_INVALID: ports must be integers between 1024 and 65535"
        )
    if any(
        arg in ("-c", "--config")
        or arg.startswith("--config=")
        or (arg.startswith("-c") and not arg.startswith("--"))
        for arg in args.playwright_args
    ):
        raise TestEnvironmentError(
            "TEST_CONFIG_OVERRIDE: the runner requires playwright.isolated.config.ts"
        )
    if any(arg.startswith("--grep-invert") for arg in args.playwright_args):
        raise TestEnvironmentError(
            "TEST_NATIVE_EXCLUSION_REQUIRED: native campaign exclusions cannot be overridden"
        )
    if (
        args.api_port in (8148, 8000)
        or args.web_port in (3148, 3000)
        or args.api_port == args.web_port
    ):
        raise TestEnvironmentError(
            "TEST_PORT_PROTECTED: choose ports separate from the interactive stack"
        )
    if args.check_only:
        validate_test_storage(
            os.environ.get("CHEMDFT_DATABASE_URL"),
            os.environ.get("CHEMDFT_OBJECT_ROOT"),
            os.environ.get("CHEMDFT_TEST_WORKSPACE"),
            ROOT,
        )
        print("TEST_STORAGE_OK")
        return 0
    if not available(args.api_port) or not available(args.web_port):
        raise TestEnvironmentError(
            "TEST_PORT_OCCUPIED: isolated ports must be free; refusing server reuse"
        )
    if shutil.disk_usage(ROOT).free < MIN_FREE_BYTES:
        raise TestEnvironmentError("TEST_DISK_RESERVE: at least 12 GiB free space is required")
    artifacts = None
    if args.artifacts_dir:
        artifacts = (ROOT / args.artifacts_dir).resolve()
        if not artifacts.is_relative_to((ROOT / "output/playwright").resolve()):
            raise TestEnvironmentError("TEST_ARTIFACT_PATH: use output/playwright only")
        artifacts.mkdir(parents=True, exist_ok=False)
    directory = tempfile.mkdtemp(prefix="chemdft-isolated-e2e-", dir="/tmp")
    success = False
    try:
        work = Path(directory).resolve()
        database = work / "data/test.db"
        objects = work / "objects"
        database.parent.mkdir()
        objects.mkdir()
        validate_test_storage(f"sqlite:///{database}", objects, str(work), ROOT)
        env = os.environ.copy()
        ai_provider = "fake"
        run_ai_integration = "false"
        rehearsal = bool(live_plan and live_plan.get("rehearsal"))
        stand_in = args.suite in (STAND_IN_SUITE, KIMI_SUITE) or rehearsal
        stand_in_port = 0
        if stand_in:
            # The real HTTP gateway is pointed at a loopback stand-in with a fixed, non-secret test
            # credential. No provider is contacted and no real key is read or created.
            stand_in_port = free_loopback_port(args.api_port, args.web_port)
            ai_provider, run_ai_integration = "nvidia", "true"
            env.pop("CHEMDFT_AI_API_KEY", None)
            stand_in_key = work / "ai-api-key.secret"
            with stand_in_key.open("x") as key_stream:
                os.chmod(stand_in_key, 0o600)
                key_stream.write(STAND_IN_KEY)
            env.update(
                {
                    **STAND_IN_MODELS,
                    "CHEMDFT_AI_API_KEY_FILE": str(stand_in_key),
                    "CHEMDFT_AI_API_BASE_URL": f"http://127.0.0.1:{stand_in_port}/v1",
                    "CHEMDFT_BILLING_MANAGED_AI_ENABLED": "true",
                    "CHEMDFT_AI_TIMEOUT_SECONDS": "30",
                    "CHEMDFT_E2E_STAND_IN_URL": f"http://127.0.0.1:{stand_in_port}",
                    "CHEMDFT_E2E_PLANNING_FIXTURE": planning_fixture(),
                }
            )
        if args.suite == KIMI_SUITE:
            env.update(
                {
                    "CHEMDFT_MOONSHOT_API_KEY_FILE": str(stand_in_key),
                    "CHEMDFT_MOONSHOT_MODELS": "kimi-k2.6,kimi-k3",
                    "CHEMDFT_MOONSHOT_API_BASE_URL": f"http://127.0.0.1:{stand_in_port}/v1",
                }
            )
        api_cwd = work
        if live_plan is not None:
            # Real requests, one shared budget: the key stays a file path (never in an environment),
            # the API runs from a directory with no .env, and the launcher enforces the limits.
            # A rehearsal differs only in what answers: the loopback stand-in and its test key.
            ai_provider, run_ai_integration = "nvidia", "true"
            env.pop("CHEMDFT_AI_API_KEY", None)
            api_cwd = work / "api-cwd"
            (api_cwd / "services").mkdir(parents=True)
            (api_cwd / "services/scientific-worker").symlink_to(ROOT / "services/scientific-worker")
            provider = live_plan.get("provider", "nvidia")
            key_variable = (
                "CHEMDFT_MOONSHOT_PROBE_KEY_FILE"
                if provider == "moonshot"
                else "CHEMDFT_NVIDIA_PROBE_KEY_FILE"
            )
            if rehearsal:
                authorization = write_rehearsal_authorization(
                    work, provider, live_plan["models"], live_plan["cases"]
                )
                digest = hashlib.sha256(authorization.read_bytes()).hexdigest()
                env["CHEMDFT_LIVE_AUTHORIZATION"] = str(authorization)
                env["CHEMDFT_NVIDIA_PROBE_ARMED"] = f"EXECUTE-{digest[:16]}"
                env[key_variable] = str(stand_in_key)
                os.environ.update(
                    {
                        k: env[k]
                        for k in (
                            "CHEMDFT_LIVE_AUTHORIZATION",
                            "CHEMDFT_NVIDIA_PROBE_ARMED",
                            key_variable,
                        )
                    }
                )
                live_plan = {**live_check(False), "rehearsal": True}
                if provider == "moonshot":
                    # Mirror the real Moonshot-only pass: the primary provider holds no key.
                    env.pop("CHEMDFT_AI_API_KEY_FILE", None)
                    env.update(
                        {
                            "CHEMDFT_MOONSHOT_API_KEY_FILE": str(stand_in_key),
                            "CHEMDFT_MOONSHOT_MODELS": ",".join(live_plan["models"]),
                            "CHEMDFT_MOONSHOT_API_BASE_URL": f"http://127.0.0.1:{stand_in_port}/v1",
                        }
                    )
            elif provider == "moonshot":
                # The primary provider keeps NVIDIA settings with no key; only Moonshot is live.
                env.pop("CHEMDFT_AI_API_KEY_FILE", None)
                env.update(
                    {
                        **STAND_IN_MODELS,
                        "CHEMDFT_MOONSHOT_API_KEY_FILE": os.environ[key_variable],
                        "CHEMDFT_MOONSHOT_MODELS": ",".join(live_plan["models"]),
                        "CHEMDFT_AI_API_BASE_URL": "https://integrate.api.nvidia.com/v1",
                        "CHEMDFT_AI_TIMEOUT_SECONDS": "150",
                    }
                )
            else:
                env.update(
                    {
                        **STAND_IN_MODELS,
                        "CHEMDFT_AI_API_KEY_FILE": os.environ[key_variable],
                        "CHEMDFT_AI_API_BASE_URL": "https://integrate.api.nvidia.com/v1",
                        "CHEMDFT_AI_TIMEOUT_SECONDS": "150",
                    }
                )
            env.update(
                {
                    "CHEMDFT_BILLING_MANAGED_AI_ENABLED": "true",
                    "CHEMDFT_LIVE_AUTHORIZATION": env.get(
                        "CHEMDFT_LIVE_AUTHORIZATION",
                        os.environ.get("CHEMDFT_LIVE_AUTHORIZATION", ""),
                    ),
                    "CHEMDFT_LIVE_REPORT": str(work / "live-report.json"),
                    "CHEMDFT_E2E_PLANNING_FIXTURE": planning_fixture(),
                    "CHEMDFT_E2E_LIVE_CASES": json.dumps(live_plan["cases"]),
                    "CHEMDFT_E2E_LIVE_MODELS": json.dumps(live_plan["models"]),
                    "PYTHONPATH": str(ROOT / "tools"),
                }
            )
            if live_exec:
                env["CHEMDFT_E2E_EXECUTION_FIXTURE"] = execution_fixture()
                env["CHEMDFT_E2E_LIVE_REHEARSAL"] = "1" if rehearsal else "0"
                if not rehearsal:
                    # The established local envelope, stated explicitly (nothing left to defaults).
                    env.update(
                        {
                            "CHEMDFT_SCIENTIFIC_THREADS": str(EXEC_LIMITS["threads"]),
                            "CHEMDFT_SCIENTIFIC_MAX_ATOMS": str(EXEC_LIMITS["max_atoms"]),
                            "CHEMDFT_SCIENTIFIC_EXECUTION_TIMEOUT_SECONDS": str(
                                EXEC_LIMITS["wall_seconds"]
                            ),
                            "CHEMDFT_COMPUTE_LOCAL_MEMORY_BYTES": str(EXEC_LIMITS["memory_bytes"]),
                            "CHEMDFT_COMPUTE_LOCAL_TEMPORARY_STORAGE_BYTES": str(
                                EXEC_LIMITS["scratch_bytes"]
                            ),
                            "CHEMDFT_SCIENTIFIC_MAX_OUTPUT_BYTES": str(5 * 1024**2),
                            "CHEMDFT_COMPUTE_LOCAL_ENABLED": "true",
                        }
                    )
        if args.suite == "ai-scientific-execution":
            env["CHEMDFT_E2E_EXECUTION_FIXTURE"] = execution_fixture()
        if args.suite == "as-c1-nvidia":
            from chemdft_api.config import Settings

            parent_settings = Settings()
            if (
                parent_settings.ai_provider != "nvidia"
                or not parent_settings.ai_api_key
                or parent_settings.ai_api_base_url.rstrip("/")
                != "https://integrate.api.nvidia.com/v1"
                or parent_settings.ai_model_standard != "nvidia/nemotron-3.5-lightning-30b-a3b"
            ):
                raise TestEnvironmentError(
                    "TEST_NVIDIA_CONFIGURATION_REQUIRED: no fallback is permitted"
                )
            ai_provider = os.environ.get("CHEMDFT_AI_PROVIDER", parent_settings.ai_provider)
            run_ai_integration = "true" if parent_settings.run_ai_integration else "false"
            # Never place the AI API key in a child process environment (visible via
            # /proc/<pid>/environ and process listings). Write it to a 0600 file inside
            # the isolated workspace and pass only the file path.
            env.pop("CHEMDFT_AI_API_KEY", None)
            if parent_settings.ai_api_key:
                key_file = work / "ai-api-key.secret"
                with key_file.open("x") as key_stream:
                    os.chmod(key_file, 0o600)
                    key_stream.write(parent_settings.ai_api_key.get_secret_value())
                env["CHEMDFT_AI_API_KEY_FILE"] = str(key_file)
            if parent_settings.ai_api_base_url:
                env["CHEMDFT_AI_API_BASE_URL"] = parent_settings.ai_api_base_url
            if parent_settings.ai_model_standard:
                env["CHEMDFT_AI_MODEL_STANDARD"] = parent_settings.ai_model_standard
            env["CHEMDFT_BILLING_MANAGED_AI_ENABLED"] = "true"
            env["CHEMDFT_AI_MAX_TOOL_STEPS"] = "3"
            env["CHEMDFT_AI_MAX_TOKENS_PER_RUN"] = "2048"
            env["CHEMDFT_AI_TIMEOUT_SECONDS"] = "60"
            env["CHEMDFT_SCIENTIFIC_THREADS"] = "1"
            env["CHEMDFT_SCIENTIFIC_MAX_ATOMS"] = "2"
            env["CHEMDFT_SCIENTIFIC_EXECUTION_TIMEOUT_SECONDS"] = "180"
            env["CHEMDFT_COMPUTE_LOCAL_MEMORY_BYTES"] = str(2 * 1024**3)
            env["CHEMDFT_COMPUTE_LOCAL_TEMPORARY_STORAGE_BYTES"] = str(1024**3)
            env["CHEMDFT_SCIENTIFIC_MAX_OUTPUT_BYTES"] = str(5 * 1024**2)

        env.update(
            {
                "PYTHONDONTWRITEBYTECODE": "1",
                "PYTHONPATH": env.get("PYTHONPATH", str(ROOT / "services/api/src"))
                if args.offline
                else os.pathsep.join(
                    [str(ROOT / "services/api/src")]
                    + ([str(ROOT / "tools")] if live_plan is not None else [])
                ),
                "CHEMDFT_TEST_MODE": "1",
                "CHEMDFT_ENVIRONMENT": "test",
                "CHEMDFT_TEST_WORKSPACE": str(work),
                # The web sources run from a copy; fixtures still need the repository's tools.
                "CHEMDFT_REPO_ROOT": str(ROOT),
                "CHEMDFT_DATABASE_URL": f"sqlite:///{database}",
                "CHEMDFT_OBJECT_ROOT": str(objects),
                "CHEMDFT_AUTO_CREATE_SCHEMA": "false",
                "CHEMDFT_AUTH_MODE": "dev",
                "CHEMDFT_DEV_IDENTITY_ENABLED": "true",
                "CHEMDFT_DEV_USER_ID": str(uuid.uuid4()),
                "CHEMDFT_DEV_ORGANIZATION_ID": str(uuid.uuid4()),
                "CHEMDFT_AUTH_DATABASE_URL": f"file:{work / 'auth.db'}",
                "CHEMDFT_CREST_LOCK_PATH": str(work / "crest.lock"),
                "CHEMDFT_BYOK_LOCAL_ROOT": str(work / "byok-secrets"),
                "CHEMDFT_AI_PROVIDER": ai_provider,
                "CHEMDFT_RUN_AI_INTEGRATION": run_ai_integration,
                "CHEMDFT_COMPUTE_WORKER_ID": "isolated-e2e-worker",
                "CHEMDFT_COMPUTE_WORKER_POLL_SECONDS": "0.5",
                "CHEMDFT_API_BASE_URL": f"http://127.0.0.1:{args.api_port}",
                "CHEMDFT_E2E_API_PORT": str(args.api_port),
                "CHEMDFT_E2E_WEB_PORT": str(args.web_port),
                "CHEMDFT_E2E_SUITE": args.suite,
                "CHEMDFT_E2E_REPOSITORY_ROOT": str(ROOT),
                "CHEMDFT_E2E_WORKER_MODE": "disabled"
                if (
                    manual
                    or args.no_worker
                    or args.suite
                    in {
                        "scientific-safety",
                        "approval-geometry-offline",
                        "ui-1-ai-scientist",
                        LIVE_SUITE,
                    }
                )
                else "enabled",
                "CHEMDFT_E2E_MANUAL_APPROVAL": "1" if manual else "0",
                "CHEMDFT_E2E_APPROVAL_SECONDS": str(args.manual_approval_seconds),
                "CHEMDFT_PF8D_OUTPUT": str(work / "psi4-ui"),
                "CHEMDFT_WEB_DIST_DIR": ".next-isolated-e2e",
                "TMPDIR": str(work),
                "NEXT_TELEMETRY_DISABLED": "1",
            }
        )
        initialize_database(env, database)
        web_workspace = prepare_web_workspace(work)
        processes = []
        logs = []
        try:
            commands = [
                (
                    [
                        str(ROOT / ".venv/bin/uvicorn"),
                        "chemdft_api.main:app",
                        "--host",
                        "127.0.0.1",
                        "--port",
                        str(args.api_port),
                    ],
                    ROOT,
                ),
                (
                    [
                        str(ROOT / "apps/web/node_modules/.bin/next"),
                        "dev",
                        "--webpack",
                        "--hostname",
                        "127.0.0.1",
                        "--port",
                        str(args.web_port),
                    ],
                    web_workspace,
                ),
            ]
            if live_plan is not None:
                commands[0] = (
                    [str(ROOT / ".venv/bin/python"), "-B", "-m", "nvidia_probe.browser_live"],
                    api_cwd,
                )
            if env["CHEMDFT_E2E_WORKER_MODE"] == "enabled":
                commands.append(
                    (
                        [str(ROOT / ".venv/bin/python"), "-B", "-m", "chemdft_api.compute_worker"],
                        api_cwd if live_exec else ROOT,  # the live pass loads no repository .env
                    )
                )
            if stand_in:
                commands.append(
                    (
                        [
                            str(ROOT / ".venv/bin/python"),
                            "-B",
                            str(ROOT / "tools/e2e_offline/nvidia_stub.py"),
                            "--port",
                            str(stand_in_port),
                        ],
                        ROOT,
                    )
                )
            for index, (command, cwd) in enumerate(commands):
                log = open(work / f"service-{index}.log", "w")  # noqa: SIM115 - closed in finally
                logs.append(log)
                processes.append(
                    subprocess.Popen(
                        command,
                        cwd=cwd,
                        env=env,
                        stdout=log,
                        stderr=subprocess.STDOUT,
                        start_new_session=True,
                    )
                )
            wait_http(f"http://127.0.0.1:{args.api_port}/health", processes[0], workspace=work)
            wait_http(f"http://127.0.0.1:{args.web_port}/en", processes[1], workspace=work)
            if stand_in:
                wait_http(
                    f"http://127.0.0.1:{stand_in_port}/__control/health",
                    processes[-1],
                    workspace=work,
                )
            verify_stack_identity(env)
            if args.smoke:
                smoke(args.api_port, database, objects)
                success = True
                return 0
            command = [
                str(ROOT / "apps/web/node_modules/.bin/playwright"),
                "test",
                "--config",
                "playwright.isolated.config.ts",
            ]
            command += (
                args.playwright_args[1:]
                if args.playwright_args[:1] == ["--"]
                else args.playwright_args
            )
            if manual:
                command.append("--headed")
            test_process = subprocess.Popen(
                command, cwd=web_workspace, env=env, start_new_session=True
            )
            processes.append(test_process)
            worker_started = False
            last_watch = 0.0
            while test_process.poll() is None:
                if time.monotonic() - last_watch >= 5:
                    last_watch = time.monotonic()
                    if (
                        workspace_bytes(work) > MAX_WORKSPACE_BYTES
                        or shutil.disk_usage(work).free < MIN_FREE_BYTES
                    ):
                        raise TestEnvironmentError(
                            "TEST_DISK_RESERVE: workspace exceeds 2 GiB "
                            "or free disk is below 12 GiB"
                        )
                ready_path = work / "manual-approval-ready.json"
                if manual and not worker_started and ready_path.is_file():
                    ready = json.loads(ready_path.read_text())
                    if manual_worker_authorized(database, ready, env["CHEMDFT_DEV_USER_ID"]):
                        worker_env = {**env, "CHEMDFT_COMPUTE_WORKER_ONCE": "1"}
                        log = open(work / "manual-compute-worker.log", "w")  # noqa: SIM115
                        logs.append(log)
                        # Convert termination to a Python exception so the native
                        # subprocess runner's finally block can stop its own group.
                        worker_command = manual_worker_command()
                        processes.append(
                            subprocess.Popen(
                                worker_command,
                                cwd=ROOT,
                                env=worker_env,
                                stdout=log,
                                stderr=subprocess.STDOUT,
                                start_new_session=True,
                            )
                        )
                        worker_started = True
                time.sleep(0.5)
            result = test_process.returncode
            if args.offline:
                summary = offline_summary(work, database, stand_in)
                (work / "offline-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
            if live_plan is not None:
                summary = live_summary(database, execution=live_exec and not rehearsal)
                (work / "live-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
            success = result == 0
            return result
        finally:
            for process in reversed(processes):
                if process.poll() is None:
                    with contextlib.suppress(ProcessLookupError):
                        os.killpg(process.pid, signal.SIGTERM)
            for process in reversed(processes):
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    with contextlib.suppress(ProcessLookupError):
                        os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
            for log in logs:
                log.close()
    finally:
        try:
            if args.artifacts_dir:
                preserve_diagnostics(Path(directory), artifacts)
        finally:
            if args.retain_workspace or (args.retain_on_failure and not success):
                print(f"TEST_DIAGNOSTICS_RETAINED: {directory}", file=sys.stderr)
            else:
                shutil.rmtree(directory)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (TestEnvironmentError, RuntimeError) as error:
        print(error, file=sys.stderr)
        sys.exit(2)
