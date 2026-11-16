"""Fail-closed policy for live provider tests.

pytest never reads repository `.env` credentials or ambient provider keys, and never runs an
`ai_integration` test: they are skipped unconditionally, whatever credentials exist and however
they are selected. Live provider verification is a separate, budgeted path with its own typed
authorization (`tools/nvidia_probe`); the autouse network guard in conftest additionally keeps
every pytest process from reaching an external provider.
"""

import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "tools/e2e_offline"))
import native_launch_guard

LIVE_TEST_SKIP_REASON = (
    "live provider test: never run by pytest; use the authorized tools/nvidia_probe runner"
)
# Credentials must come from an explicit test fixture, never from the shell or a dotenv file.
AMBIENT_AI_SECRET_ENV = ("CHEMDFT_AI_API_KEY", "CHEMDFT_AI_API_KEY_FILE")


def scrub_ambient_provider_settings(environ=os.environ) -> list[str]:
    """Remove ambient provider credentials and force the integration switch off."""
    removed = [name for name in AMBIENT_AI_SECRET_ENV if environ.pop(name, None) is not None]
    environ["CHEMDFT_RUN_AI_INTEGRATION"] = "false"
    return removed


# Native-engine campaigns are opt-in by marker too: a plain `pytest services/api/tests` must not
# start real scientific calculations (see pyproject markers). Select them explicitly with
# `-m scientific_integration` (or `-m benchmark`), outside the offline sandbox, with approval.
NATIVE_OPT_IN_MARKERS = ("scientific_integration", "benchmark")
NATIVE_SKIP_REASON = (
    "native scientific test: needs -m <marker> and CHEMDFT_NATIVE_TESTS authorization"
)


def selected_by_marker_expression(marker: str, markexpr: str | None) -> bool:
    """True when `-m` positively names the marker (`-m "not marker"` does not select it)."""
    expression = markexpr or ""
    return any(
        not re.search(r"\bnot\s*$", expression[: match.start()])
        for match in re.finditer(rf"\b{re.escape(marker)}\b", expression)
    )


# ---------------------------------------------------------------------------------------------
# Native scientific engines: a launch needs explicit opt-in AND typed authorization. A plain
# `pytest services/api/tests` once started real xTB/CREST/Psi4 processes (the engine tests are
# ordinary tests when the binaries exist), so a process-level guard now refuses to start an engine
# or an engine worker in any pytest process and reports the test as skipped.
NATIVE_ENV = "CHEMDFT_NATIVE_TESTS"
NATIVE_PHRASE = "I-AUTHORIZE-NATIVE-ENGINE-EXECUTION"
BLOCK_MESSAGE = native_launch_guard.BLOCK_MESSAGE
launches_native_engine = native_launch_guard.launches_native_engine


def native_authorized(markexpr: str | None, environ=os.environ) -> bool:
    return (
        environ.get(NATIVE_ENV) == NATIVE_PHRASE
        and any(selected_by_marker_expression(m, markexpr) for m in NATIVE_OPT_IN_MARKERS)
        and environ.get("CHEMDFT_E2E_OFFLINE") != "1"
    )


_guard = {"allowed": False, "installed": False, "modules": set(), "tests": set()}


def _refuse(message):
    import pytest

    # PYTEST_CURRENT_TEST is "<module path>::<test> (<phase>)": remember which module fired.
    current = os.environ.get("PYTEST_CURRENT_TEST", "")
    _guard["modules"].add(current.split("::")[0])
    _guard["tests"].add(current.rsplit(" (", 1)[0])  # the node id, whichever phase fired
    return pytest.skip.Exception(message)  # a skip, never a launch or a green pass


_audit = native_launch_guard.audit_hook(lambda: _guard["allowed"], _refuse)


def configure_native_guard(config, environ=os.environ) -> bool:
    """Install the process-wide guard; allowed only under the full native authorization."""
    _guard["allowed"] = native_authorized(config.option.markexpr, environ)
    if not _guard["allowed"]:
        # Nested Python workers started by a test inherit the same refusal via sitecustomize.
        site = str(Path(native_launch_guard.__file__).resolve().parent)
        paths = [p for p in environ.get("PYTHONPATH", "").split(os.pathsep) if p and p != site]
        environ["PYTHONPATH"] = os.pathsep.join([site, *paths])
        environ["CHEMDFT_NATIVE_ENGINE_GUARD"] = "1"
    if not _guard["installed"]:
        sys.addaudithook(_audit)
        _guard["installed"] = True
    return _guard["allowed"]


# Teardown noise a refused engine launch leaves behind when it fired inside a module-scoped fixture
# that hosts an ASGI test client: later tests of that module fail setup with these signatures.
FIXTURE_UNWIND_SIGNATURES = ("CancelledError", "This portal is not running")


def convert_blocked_report(item, report) -> None:
    """Report a test whose engine launch was refused as skipped, not failed.

    The refusal can surface wrapped (a worker thread, an ASGI task group, a teardown that follows),
    so a failure of an item carrying the refusal text is turned into a skip, and so is a setup
    failure with a fixture-unwind signature in a module where the guard has already fired.
    Nothing else is converted.
    """
    text = str(report.longrepr)
    module_fired = item.nodeid.split("::")[0] in _guard["modules"]
    unwind = (
        report.when == "setup"
        and module_fired
        and any(signature in text for signature in FIXTURE_UNWIND_SIGNATURES)
    )
    fired = item.nodeid in _guard["tests"]  # the refusal fired while this very test was running
    if report.failed and (
        getattr(item, "_native_blocked", False)
        or fired
        or "NATIVE_ENGINE_BLOCKED" in text
        or unwind
    ):
        item._native_blocked = True
        report.outcome = "skipped"
        report.longrepr = (str(item.path), item.location[1] or 0, f"Skipped: {BLOCK_MESSAGE}")
