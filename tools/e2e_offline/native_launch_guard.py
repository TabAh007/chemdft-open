"""Process-level refusal to start a native scientific engine (or an engine worker).

Pure functions plus one audit-hook factory, shared by the pytest guard (`live_ai_gate`) and by
`sitecustomize` (so nested Python workers started by a test or by an offline E2E stack inherit it).
A launch is refused, never retried or downgraded. Version/help-only invocations are capability
probes and are allowed. This module imports nothing from the application and opens no socket.
"""

from __future__ import annotations

import os
import sys

PROBE_FLAGS = frozenset({"--version", "-V", "version", "--help", "-h"})
ENGINE_BINARIES = frozenset({"psi4", "xtb", "crest", "dftd4", "orca", "cp2k", "nwchem", "qcengine"})
ENGINE_ENTRY_MARKERS = (
    "pyscf_worker",
    "xtb_worker",
    "compute_worker",
    "scientific.engines",
    "/.chemdft/envs/",
)
BLOCK_MESSAGE = (
    "NATIVE_ENGINE_BLOCKED: engines start only with -m scientific_integration (or benchmark), "
    "CHEMDFT_NATIVE_TESTS=<authorization phrase> and outside the offline sandbox"
)


def launches_native_engine(executable, argv) -> bool:
    """True for an engine binary, an engine worker or a worker entry point (not a version probe)."""
    names = [os.fspath(executable) if executable else ""]
    names += [os.fspath(a) if isinstance(a, (str, bytes, os.PathLike)) else "" for a in argv or ()]
    names = [n.decode(errors="replace") if isinstance(n, bytes) else n for n in names]
    rest = names[2:]  # names[1] is argv[0]
    if rest and all(item in PROBE_FLAGS for item in rest):
        return False  # `xtb --version` and friends are capability probes, not calculations
    if os.path.basename(names[0]).lower() in ENGINE_BINARIES:
        return True
    return any(marker in item for item in names for marker in ENGINE_ENTRY_MARKERS)


def audit_hook(is_allowed, refuse):
    """Audit hook that raises `refuse(BLOCK_MESSAGE)` for an engine launch unless allowed."""

    def audit(event, args):
        if is_allowed():
            return
        if event in {"subprocess.Popen", "os.exec", "os.posix_spawn"}:
            executable, argv = args[0], args[1]
        elif event == "os.system":
            executable, argv = None, [args[0]]
        else:
            return
        if launches_native_engine(executable, argv):
            raise refuse(BLOCK_MESSAGE)

    return audit


def install_in_this_process() -> None:
    """For child interpreters (via sitecustomize): refuse every engine launch.

    A pytest process steps aside here: its own guard (conftest) reports a refused launch as a skip
    and is the only one that can be authorized; this hook protects the interpreters around it.
    """
    sys.addaudithook(audit_hook(lambda: "pytest" in sys.modules, RuntimeError))
