"""Experimental AWS EC2 compute provider (session-based, opt-in, offline-tested).

Design contract (see docs/implementation/AWS_COMPUTE_PROVIDER.md):

* The provider NEVER starts, stops or resizes EC2. Starting the pilot instance is possible only
  through the Lambda guard and only from ``aws_session_control`` (an explicit, owner-approved
  operator command). This module may invoke the guard with ``{"operation": "poll"}`` only, and the
  command allow-list below rejects every other EC2/guard/SSM/IAM action.
* Work happens inside an already authorized, time-limited session recorded in a local session
  file. No session, an expiring session, or a guard that disagrees with the file means the
  provider reports itself unavailable; the worker then does not claim AWS jobs at all.
* All AWS access is the installed AWS CLI through explicit argument arrays (never a shell) under
  the isolated ``chemdft-pilot`` login profile, with the exact operator identity verified first.
  boto3 is not used.
* Scientific values come only from the existing ``pyscf_worker.py`` run in the pinned container
  by ``infra/aws/ec2-pilot/host-workflow.sh``. This module transports the immutable input,
  verifies SHA-256 hashes of everything it brings back, and returns a normal ``ExecutionResult``
  that the existing Result Firewall judges. It never computes, edits or fills in a value.
"""

from __future__ import annotations

import configparser
import contextlib
import hashlib
import json
import os
import re
import select
import stat
import subprocess
import tempfile
import time
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .config import Settings
from .contracts.catalog import WorkloadReference
from .errors import UnsupportedCalculation
from .scientific.engines.interfaces import ExecutionResult

AWS_PROVIDER = "aws"
WORKLOAD_PYSCF_ENERGY = WorkloadReference(
    workload_type="chemdft.pyscf.energy.v1", workload_version="1.0.0"
)
WORKLOAD_PYSCF_FREQUENCY = WorkloadReference(
    workload_type="chemdft.pyscf.frequency.v1", workload_version="1.0.0"
)
WORKLOAD_PYSCF_ORBITAL = WorkloadReference(
    workload_type="chemdft.pyscf.orbital.v1", workload_version="1.0.0"
)
WORKLOAD_PYSCF_THERMOCHEMISTRY = WorkloadReference(
    workload_type="chemdft.pyscf.thermochemistry.v1", workload_version="1.0.0"
)
WORKLOAD_PYSCF_OPTIMIZATION = WorkloadReference(
    workload_type="chemdft.pyscf.optimization.v1", workload_version="1.0.0"
)
WORKLOAD_PYSCF_TDDFT = WorkloadReference(
    workload_type="chemdft.pyscf.tddft.v1", workload_version="1.0.0"
)
WORKLOAD_PYSCF_PERIODIC_ENERGY = WorkloadReference(
    workload_type="chemdft.pyscf.periodic-energy.v1", workload_version="1.0.0"
)
WORKLOAD_QE_PERIODIC_ENERGY = WorkloadReference(
    workload_type="chemdft.qe.periodic-energy.v1", workload_version="1.0.0"
)
WORKLOAD_XTB_ENERGY = WorkloadReference(
    workload_type="chemdft.xtb.energy.v1", workload_version="1.0.0"
)
WORKLOAD_XTB_OPTIMIZATION = WorkloadReference(
    workload_type="chemdft.xtb.optimization.v1", workload_version="1.0.0"
)
WORKLOAD_CREST_SEARCH = WorkloadReference(
    workload_type="chemdft.crest.conformer-search.v1", workload_version="1.0.0"
)
# Single source of truth for what has actually been EXECUTED on AWS (ENERGY only). Allowed-by-code is
# wider (aws_supports_specification); the UI and AI text claim only these pairs. The same list is in
# apps/web/src/lib/aws-verified.ts; tests compare both with tests/fixtures/aws-verified-pairs.json.
# 2026-11-03: water HF/STO-3G (job ffb3574d) and PBE/6-31G (job 01dd78af), PubChem CID 962 V1, added.
AWS_VERIFIED_ENERGY_PAIRS: tuple[tuple[str, str, str], ...] = (
    ("hf", "sto-3g", "H2"),
    ("b3lyp", "def2-svp", "water"),
    ("hf", "sto-3g", "water"),
    ("pbe", "6-31g", "water"),
)
# Executed on AWS (job ad4a9b01, 2026-10-27): PySCF GEOMETRY_OPTIMIZATION, B3LYP/def2-SVP, water.
AWS_VERIFIED_OPTIMIZATION_PAIRS: tuple[tuple[str, str, str], ...] = (("b3lyp", "def2-svp", "water"),)
# Executed on AWS (job 0f472396, 2026-10-27): PySCF FREQUENCY (analytic Hessian), B3LYP/def2-SVP, water.
AWS_VERIFIED_FREQUENCY_PAIRS: tuple[tuple[str, str, str], ...] = (("b3lyp", "def2-svp", "water"),)
# Executed on AWS (job dbe97dd6, 2026-10-27): PySCF THERMOCHEMISTRY derived from the verified frequency, water.
AWS_VERIFIED_THERMOCHEMISTRY_PAIRS: tuple[tuple[str, str, str], ...] = (("b3lyp", "def2-svp", "water"),)
# Executed on AWS (job be84c239, 2026-11-02): PySCF TDDFT, B3LYP/def2-SVP, water, 5 singlets (Guided UI).
AWS_VERIFIED_TDDFT_PAIRS: tuple[tuple[str, str, str], ...] = (("b3lyp", "def2-svp", "water"),)
# Executed on AWS (job 69d9052f, 2026-11-02): xTB 6.7.1 GFN2 ENERGY, neutral singlet water. Semi-empirical:
# never comparable with ab initio totals. The basis slot is "builtin" because GFN2 has no user basis.
AWS_VERIFIED_XTB_ENERGY_PAIRS: tuple[tuple[str, str, str], ...] = (("gfn2", "builtin", "water"),)
# Executed on AWS (job 8cf0ae40, 2026-11-03, second attempt after job f36644a9 failed): xTB 6.7.1 GFN2
# GEOMETRY_OPTIMIZATION (ANCopt), neutral singlet water. Semi-empirical; never compared with PySCF totals.
AWS_VERIFIED_XTB_OPTIMIZATION_PAIRS: tuple[tuple[str, str, str], ...] = (("gfn2", "builtin", "water"),)
AWS_ENERGY_TASK = "ENERGY"
AWS_OPTIMIZATION_TASK = "GEOMETRY_OPTIMIZATION"
AWS_FREQUENCY_TASK = "FREQUENCY"
AWS_THERMOCHEMISTRY_TASK = "THERMOCHEMISTRY"
AWS_ORBITAL_TASK = "ORBITAL"
AWS_TDDFT_TASK = "TDDFT"
AWS_PERIODIC_ENERGY_TASK = "PERIODIC_ENERGY"
# Hosted allow-list by engine. PySCF TDDFT and xTB ENERGY are implemented here but listed as
# EXECUTED on AWS only after a verified job (see AWS_VERIFIED_* above); the copy claims those only.
AWS_PYSCF_TASKS = frozenset({
    AWS_ENERGY_TASK, AWS_OPTIMIZATION_TASK, AWS_FREQUENCY_TASK, AWS_THERMOCHEMISTRY_TASK,
    AWS_ORBITAL_TASK, AWS_TDDFT_TASK,
})  # fmt: skip
AWS_PYSCF_PERIODIC_TASKS = frozenset({AWS_PERIODIC_ENERGY_TASK})
AWS_PYSCF_ALL_TASKS = AWS_PYSCF_TASKS | AWS_PYSCF_PERIODIC_TASKS
AWS_XTB_TASKS = frozenset({AWS_ENERGY_TASK, AWS_OPTIMIZATION_TASK})
AWS_CONFORMER_TASK = "CONFORMER_SEARCH"
AWS_CREST_TASKS = frozenset({AWS_CONFORMER_TASK})
# CREST writes a variable set of native files (stdout, ensembles, energies); each is hash-checked.
CREST_NATIVE_NAME = re.compile(r"^[A-Za-z0-9._-]{1,96}$")
CREST_NATIVE_MAX_FILES = 64
# Largest optimization steps file the provider will fetch; also bounded by the host's 20 MiB cap.
HOST_OUTPUT_CAP_BYTES = 20 * 1024 * 1024

# Facts of the approved pilot. tests/test_aws_compute_provider.py asserts these equal the
# infrastructure generator's constants so the two cannot silently drift apart.
PROFILE = "chemdft-pilot"
HOSTED_PROFILE = "chemdft-hosted"  # profile name inside the refreshed instance-role credentials file
SESSION_KEY = "pilot/chemdft-session/current.json"
REGION = "us-east-1"
# The pinned AWS account comes from the environment so no account id lives in source. Unset (or any other value) fails closed:
# the identity check below then refuses every AWS action. Production must set CHEMDFT_AWS_ACCOUNT_ID before the next backend deploy.
ACCOUNT = os.environ.get("CHEMDFT_AWS_ACCOUNT_ID", "123456789012")
OPERATOR_USER = "chemdft-operator"
EXPECTED_ARN = f"arn:aws:iam::{ACCOUNT}:user/{OPERATOR_USER}"
# Owner decision 2026-10-28 (DECISIONS.md): the account root identity is allowed for approved AWS
# work, via `aws login` only (no access keys); IAM changes stay forbidden. The command allow-list in
# this module still applies to root.
ROOT_ARN = f"arn:aws:iam::{ACCOUNT}:root"
ALLOWED_ARNS = frozenset({EXPECTED_ARN, ROOT_ARN})
GUARD_FUNCTION = "chemdft-ec2-pilot-guard"
SSM_DOCUMENT = "ChemDFT-PilotSession"
HARDWARE_CLASS = "aws.ec2.m7i-flex.large"
WORKFLOW_SCRIPT = (
    Path(__file__).resolve().parents[4] / "infra" / "aws" / "ec2-pilot" / "host-workflow.sh"
)
SESSION_SCHEMA = "chemdft.aws.session.v1"
# The operator's s3:ListBucket grant is conditioned on the pilot/ prefix, so a GET/HEAD of a key
# that does not exist yet is answered 403 (not 404). Existence is asked with a prefix listing.
EXISTS_QUERY = "length(Contents || `[]`)"

_UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
_KEY = re.compile(
    rf"^pilot/(?:chemdft-jobs/{_UUID}/(?:input/input\.json|status\.json|receipt\.json|"
    rf"evidence\.tar\.gz|(?:in|out)__[A-Za-z0-9._-]+)|"
    # release 0.0.45: one pointer per calculation to its host run, so a retried attempt never launches a second run
    rf"chemdft-jobs/_calc/[A-Za-z0-9._-]{{1,64}}/run\.json|chemdft-workflow/[0-9a-f]{{64}}\.sh|"
    rf"chemdft-session/current\.json)$"
)
_BUCKET = re.compile(r"^chemdft-ec2-pilot-artifacts-[a-z0-9]+$")
_INSTANCE = re.compile(r"^i-[0-9a-f]{8,17}$")
_IMAGE = re.compile(r"^sha256:[0-9a-f]{64}$")
_SHA = re.compile(r"^[0-9a-f]{64}$")
_CALCULATION_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
_RUN_ID = re.compile(rf"^{_UUID}$")

# The xTB optimization evidence files (shared with the validator, never a second list).
from .scientific.engines.xtb_optimization import NATIVE_FILES as XTB_NATIVE_FILES  # noqa: E402

JOB_FILES = {
    "result": "out__result.json",
    "engine_log": "out__engine.log",
    "stdout": "out__stdout.log",
    "stderr": "out__stderr.log",
    "steps": "out__steps.jsonl",
}


class AwsProviderError(RuntimeError):
    """A stable-coded AWS-side failure. The message never contains credentials or raw CLI output."""

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail


# ---------------------------------------------------------------------------------------------
# Session record (written only by aws_session_control after an owner-approved guard start)
# ---------------------------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class AwsSession:
    instance_id: str
    deadline_epoch: int
    opened_epoch: int

    def remaining(self, now: float) -> float:
        return self.deadline_epoch - now


def parse_session(text: str) -> AwsSession | None:
    """Parse a session record; None when malformed, forged-looking, or marked closed."""
    try:
        data = json.loads(text)
        if data.get("schema") != SESSION_SCHEMA or data.get("closed"):
            return None
        instance = str(data["instance_id"])
        if not _INSTANCE.match(instance):
            return None
        return AwsSession(instance, int(data["deadline_epoch"]), int(data["opened_epoch"]))
    except (ValueError, KeyError, TypeError, AttributeError):
        return None


def session_record_json(session: AwsSession | None, instance_id: str, now: float) -> str:
    """The record the owner tool writes (open) or publishes as closed (session is None)."""
    if session is None:
        return json.dumps(
            {"schema": SESSION_SCHEMA, "closed": True, "instance_id": instance_id,
             "closed_epoch": int(now)}, sort_keys=True,
        )  # fmt: skip
    return json.dumps(
        {"schema": SESSION_SCHEMA, "instance_id": session.instance_id,
         "deadline_epoch": session.deadline_epoch, "opened_epoch": session.opened_epoch},
        sort_keys=True,
    )  # fmt: skip


def read_session(path: Path | None) -> AwsSession | None:
    """Parse the local session record; None when absent or malformed. Never contacts AWS."""
    if path is None:
        return None
    try:
        if not path.is_file() or path.is_symlink():
            return None
        return parse_session(path.read_text())
    except OSError:
        return None


_S3_SESSION_CACHE: dict[tuple[str, str], tuple[float, AwsSession | None]] = {}
S3_SESSION_TTL_SECONDS = 30.0
S3_SESSION_ERROR_TTL_SECONDS = 10.0


def read_s3_session(settings: Settings, cli: AwsCli | None = None, *, monotonic=time.monotonic):
    """The owner-published session record, cached ~30 s. Any error fails CLOSED (no session)."""
    key = settings.aws_session_s3_key
    if not key or not settings.aws_pilot_bucket:
        return None
    cache_key = (settings.aws_pilot_bucket, key)
    now = monotonic()
    cached = _S3_SESSION_CACHE.get(cache_key)
    if cached and cached[0] > now:
        return cached[1]
    session: AwsSession | None = None
    ttl = S3_SESSION_TTL_SECONDS
    try:
        with tempfile.TemporaryDirectory(prefix="chemdft-session-") as directory:
            target = Path(directory) / "current.json"
            if (cli or AwsCli(settings)).get(key, target):
                session = parse_session(target.read_text())
    except (AwsProviderError, OSError):
        ttl = S3_SESSION_ERROR_TTL_SECONDS
    _S3_SESSION_CACHE[cache_key] = (now + ttl, session)
    return session


def current_session(settings: Settings, cli: AwsCli | None = None) -> AwsSession | None:
    if settings.aws_session_s3_key:
        return read_s3_session(settings, cli)
    return read_session(settings.aws_session_file)


def host_engine_name(engine: str, task: object) -> str:
    """The engine selector handed to host-workflow.sh. Periodic PySCF needs its own worker (release 0.0.46)."""
    if engine == "pyscf" and str(task) in AWS_PYSCF_PERIODIC_TASKS:
        return "pyscf-periodic"
    return engine


def aws_runtime_limit_seconds(settings: Settings, task: object, engine: object = None) -> int:
    """Wall-clock limit for one hosted job. Optimization has its own limit (xTB's ANCopt a shorter
    one than geomeTRIC); everything else keeps the global one, so ENERGY behaviour is unchanged."""
    task = str(getattr(task, "value", task)).upper()
    if task == AWS_OPTIMIZATION_TASK:
        if str(getattr(engine, "value", engine) or "").lower() == "xtb":
            return settings.aws_xtb_optimization_timeout_seconds
        return settings.aws_optimization_timeout_seconds
    if task == "ENERGY" and str(getattr(engine, "value", engine) or "").lower() == "pyscf":
        return settings.aws_energy_timeout_seconds
    if task == AWS_PERIODIC_ENERGY_TASK:
        if str(getattr(engine, "value", engine) or "").lower() == "qe":
            return settings.aws_qe_timeout_total_seconds
        return settings.aws_periodic_timeout_seconds
    if task == AWS_FREQUENCY_TASK:
        return settings.aws_frequency_timeout_seconds
    if task == AWS_TDDFT_TASK:
        return settings.aws_tddft_timeout_seconds
    if task == AWS_CONFORMER_TASK:
        return settings.aws_crest_timeout_seconds
    return settings.scientific_execution_timeout_seconds


def session_is_authorized(
    settings: Settings,
    now: float | None = None,
    cli: AwsCli | None = None,
    task: object = AWS_ENERGY_TASK,
) -> bool:
    """Cheap check used by the worker claim gate; True only for a usable session record."""
    if not settings.compute_aws_enabled:
        return False
    session = current_session(settings, cli)
    if session is None or session.instance_id != settings.aws_instance_id:
        return False
    return session.remaining(time.time() if now is None else now) >= (
        aws_runtime_limit_seconds(settings, task) + settings.aws_job_overhead_seconds + 120
    )


def aws_supports_specification(specification: Any) -> bool:
    """Hosted allow-list: PySCF ENERGY (executed on AWS for AWS_VERIFIED_ENERGY_PAIRS) and PySCF
    GEOMETRY_OPTIMIZATION (executed on AWS for AWS_VERIFIED_OPTIMIZATION_PAIRS)."""
    try:
        task = getattr(specification.task_type, "value", specification.task_type)
        engine = specification.engine_preference.engine
    except AttributeError:
        return False
    return (
        (str(engine) == "pyscf" and (str(task) in AWS_PYSCF_TASKS or str(task) in AWS_PYSCF_PERIODIC_TASKS))
        or (str(engine) == "xtb" and str(task) in AWS_XTB_TASKS)
        or (str(engine) == "crest" and str(task) in AWS_CREST_TASKS)
        or (str(engine) == "qe" and str(task) == AWS_PERIODIC_ENERGY_TASK)
    )


def aws_crest_refusal(settings: Settings, document: dict[str, Any]) -> str | None:
    """Plain-language reason a hosted CREST search must be refused before submit, else None."""
    atoms = document.get("atoms")
    if not settings.aws_crest_binary_sha256:
        return "Hosted CREST is not configured on this deployment (no Linux binary digest recorded)."
    if os.environ.get("CHEMDFT_AWS_CREST_BINARY_SHA256") != settings.aws_crest_binary_sha256:
        return (
            "Hosted CREST needs CHEMDFT_AWS_CREST_BINARY_SHA256 set as a process environment "
            "variable (the validator reads it there)."
        )
    if document.get("engine_executable_sha256") != settings.aws_crest_binary_sha256:
        return "Hosted CREST input does not name the recorded Linux CREST binary."
    if (
        document.get("multiplicity", 1) != 1
        or document.get("charge", 0) != 0
        or str(document.get("method", "")).lower() != "gfn2"
        or document.get("basis") is not None
    ):
        return "Hosted CREST runs neutral closed-shell GFN2 conformer searches only."
    if not isinstance(atoms, list) or not atoms or len(atoms) > settings.aws_crest_max_atoms:
        return (
            f"Hosted CREST is limited to {settings.aws_crest_max_atoms} atoms while it is "
            "being accepted."
        )
    if any(a.get("element") not in ("H", "C", "O") for a in atoms):
        return "Hosted CREST accepts H, C and O only."
    return None


def aws_orbital_refusal(settings: Settings, multiplicity: object, atom_count: int) -> str | None:
    """Plain-language reason a hosted molecular-orbital calculation must be refused, else None."""
    if multiplicity != 1:
        return (
            "Hosted molecular-orbital analysis runs closed-shell molecules only "
            "(multiplicity 1). Open-shell orbitals are not available on the hosted beta."
        )
    if atom_count > settings.aws_orbital_max_atoms:
        return (
            f"Hosted molecular-orbital analysis is limited to {settings.aws_orbital_max_atoms} "
            f"atoms; this structure has {atom_count}."
        )
    return None


def aws_tddft_refusal(
    settings: Settings, multiplicity: object, atom_count: int, nstates: object = None
) -> str | None:
    """Plain-language reason a hosted TDDFT calculation must be refused before submit, else None."""
    if multiplicity != 1:
        return (
            "Hosted TDDFT runs closed-shell singlet molecules only (multiplicity 1). "
            "Open-shell excited states are not available on the hosted beta."
        )
    if atom_count > settings.aws_tddft_max_atoms:
        return (
            f"Hosted TDDFT is limited to {settings.aws_tddft_max_atoms} atoms while it is "
            f"being accepted; this structure has {atom_count}."
        )
    if isinstance(nstates, int) and nstates > settings.aws_tddft_max_states:
        return (
            f"Hosted TDDFT is limited to {settings.aws_tddft_max_states} excited states; "
            f"{nstates} were requested."
        )
    return None


def aws_frequency_refusal(
    settings: Settings, multiplicity: object, atom_count: int, raman: bool = False
) -> str | None:
    """Plain-language reason a hosted frequency analysis must be refused before submit, else None."""
    if multiplicity != 1:
        return (
            "Hosted frequency analysis runs closed-shell molecules only (multiplicity 1). "
            "Open-shell frequencies are not available on the hosted beta."
        )
    if raman:
        return "Hosted frequency analysis does not include Raman activities yet."
    if atom_count > settings.aws_frequency_max_atoms:
        return (
            f"Hosted frequency analysis is limited to {settings.aws_frequency_max_atoms} "
            f"atoms; this structure has {atom_count}."
        )
    return None


def aws_optimization_refusal(
    settings: Settings, multiplicity: int, atom_count: int, engine: object = None
) -> str | None:
    """Plain-language reason a hosted optimization must be refused before submit, else None."""
    if int(multiplicity) != 1:
        return (
            "Hosted geometry optimization runs closed-shell molecules only (multiplicity 1). "
            "Open-shell optimization is not available on the hosted beta."
        )
    is_xtb = str(getattr(engine, "value", engine) or "").lower() == "xtb"
    limit = settings.aws_xtb_max_atoms if is_xtb else settings.aws_optimization_max_atoms
    if atom_count > limit:
        return (
            f"Hosted {'xTB ' if is_xtb else ''}geometry optimization is limited to {limit} "
            f"atoms while it is being accepted; this structure has {atom_count}."
        )
    return None


def aws_periodic_refusal(
    settings: Settings,
    atom_count: int,
    k_mesh: Any = (1, 1, 1),
) -> str | None:
    """Plain-language reason a hosted periodic DFT calculation must be refused before submit, else None."""
    if atom_count > settings.aws_periodic_max_atoms:
        return (
            f"Hosted periodic DFT is limited to {settings.aws_periodic_max_atoms} atoms in the unit cell; "
            f"this structure has {atom_count}."
        )
    allowed = [m.strip() for m in settings.aws_periodic_allowed_kmeshes.split(",") if m.strip()]
    if isinstance(k_mesh, (list, tuple)) and len(k_mesh) == 3:
        k_str = f"{k_mesh[0]}x{k_mesh[1]}x{k_mesh[2]}"
    else:
        k_str = str(k_mesh)
    if k_str not in allowed:
        return (
            f"k-point mesh {k_str} is not offered for PySCF periodic jobs on the hosted beta (allowed: {', '.join(allowed)}). "
            "Bigger k-point meshes are available with the Quantum ESPRESSO engine on the hosted beta "
            "(up to the Quantum ESPRESSO limits) when Quantum ESPRESSO is enabled."
        )
    return None


# ---------------------------------------------------------------------------------------------
# Strict AWS CLI wrapper
# ---------------------------------------------------------------------------------------------
def profile_for(settings: Settings) -> str:
    return HOSTED_PROFILE if settings.aws_credential_mode == "instance_role" else PROFILE


def validate_argv(
    argv: Sequence[str], settings: Settings, guard_operations: Sequence[str] = ("poll",)
) -> None:
    """Allow-list of exact AWS CLI invocations. Anything else is refused before it can run.

    ``guard_operations`` is ("poll",) for the provider. Only the owner-run session controller
    constructs a CLI that also permits "start"/"stop"; nothing in this module can.
    """

    def deny(reason: str) -> AwsProviderError:
        return AwsProviderError("AWS_COMMAND_NOT_ALLOWED", reason)

    if not argv or any((not isinstance(a, str)) or "\x00" in a or "\n" in a for a in argv):
        raise deny("malformed argument array")
    prefix = [
        "aws", "--profile", profile_for(settings), "--region", REGION,
        "--output", "json", "--no-cli-pager",
    ]  # fmt: skip
    if list(argv[:8]) != prefix:
        raise deny("profile/region prefix")
    rest = list(argv[8:])
    bucket = settings.aws_pilot_bucket
    if bucket is None or not _BUCKET.match(bucket):
        raise deny("unapproved bucket")
    if rest[:2] == ["sts", "get-caller-identity"] and len(rest) == 2:
        return
    if rest[:2] == ["s3", "cp"] and len(rest) == 5 and rest[2] == "--only-show-errors":
        remote = [a for a in rest[3:] if a.startswith("s3://")]
        local = [a for a in rest[3:] if not a.startswith("s3://")]
        if len(remote) != 1 or len(local) != 1:
            raise deny("exactly one s3 uri and one local path")
        match = re.fullmatch(r"s3://([^/]+)/(.+)", remote[0])
        if not match or match.group(1) != bucket or not _KEY.match(match.group(2)):
            raise deny("s3 key outside the approved pilot job/workflow prefixes")
        return
    if rest[:2] == ["s3api", "head-object"] and len(rest) == 8:
        opts = dict(zip(rest[2::2], rest[3::2], strict=True))
        if (
            set(opts) == {"--bucket", "--key", "--query"}
            and opts["--bucket"] == bucket
            and _KEY.match(opts["--key"])
            and opts["--query"] == "ContentLength"
        ):
            return
        raise deny("head-object arguments")
    if rest[:2] == ["s3api", "list-objects-v2"] and len(rest) == 10:
        opts = dict(zip(rest[2::2], rest[3::2], strict=True))
        if (
            set(opts) == {"--bucket", "--prefix", "--max-keys", "--query"}
            and opts["--bucket"] == bucket
            and _KEY.match(opts["--prefix"])
            and opts["--max-keys"] == "1"
            and opts["--query"] == EXISTS_QUERY
        ):
            return
        raise deny("list-objects-v2 arguments")
    if rest[:2] == ["lambda", "invoke"]:
        head = [
            "lambda",
            "invoke",
            "--function-name",
            GUARD_FUNCTION,
            "--cli-binary-format",
            "raw-in-base64-out",
            "--payload",
        ]
        payloads = {f'{{"operation":"{op}"}}' for op in guard_operations}
        if rest[:7] == head and len(rest) == 9 and rest[7] in payloads:
            return
        raise deny("guard invocation with an operation that is not permitted here")
    if rest[:2] == ["ec2", "describe-instances"]:
        if rest == ["ec2", "describe-instances", "--instance-ids", settings.aws_instance_id]:
            return
        raise deny("describe-instances target")
    if rest[:2] == ["ssm", "start-session"]:
        if rest == [
            "ssm",
            "start-session",
            "--target",
            settings.aws_instance_id or "",
            "--document-name",
            SSM_DOCUMENT,
        ]:
            return
        raise deny("ssm session target/document")
    raise deny(f"{rest[0] if rest else ''} {rest[1] if len(rest) > 1 else ''}".strip())


def clean_environment(config_file: Path, environ: dict[str, str]) -> dict[str, str]:
    """Isolated login profile only: no inherited AWS_* routes, no shared keys, no IMDS."""
    parser = configparser.ConfigParser(interpolation=None)
    if not config_file.is_file() or not parser.read(config_file):
        raise AwsProviderError("AWS_PROFILE_MISSING", "dedicated login config does not exist")
    section = f"profile {PROFILE}"
    if section not in parser:
        raise AwsProviderError("AWS_PROFILE_MISSING", "dedicated profile is absent")
    profile = dict(parser[section])
    if set(profile) - {"login_session", "region", "output"}:
        raise AwsProviderError("AWS_PROFILE_UNSAFE", "non-login credential route in profile")
    if profile.get("login_session") not in ALLOWED_ARNS or profile.get("region") != REGION:
        raise AwsProviderError("AWS_PROFILE_UNSAFE", "profile is not the ChemDFT operator")
    clean = {k: v for k, v in environ.items() if not k.startswith("AWS_")}
    clean.update(
        {
            "AWS_CONFIG_FILE": str(config_file.resolve()),
            "AWS_SHARED_CREDENTIALS_FILE": os.devnull,
            "AWS_EC2_METADATA_DISABLED": "true",
            "AWS_CLI_AUTO_PROMPT": "off",
            "AWS_PAGER": "",
        }
    )
    return clean


def hosted_environment(credentials_file: Path, environ: dict[str, str]) -> dict[str, str]:
    """Instance-role credentials only: a private file refreshed by the host, never IMDS or env keys."""
    try:
        info = credentials_file.lstat()
    except OSError as error:
        raise AwsProviderError("AWS_PROFILE_MISSING", "credentials file is absent") from error
    if not stat.S_ISREG(info.st_mode) or info.st_size == 0:
        raise AwsProviderError("AWS_PROFILE_UNSAFE", "credentials file is not a regular file")
    if info.st_mode & 0o077:
        raise AwsProviderError("AWS_PROFILE_UNSAFE", "credentials file is readable by others")
    clean = {k: v for k, v in environ.items() if not k.startswith("AWS_")}
    clean.update(
        {
            "AWS_SHARED_CREDENTIALS_FILE": str(credentials_file),
            "AWS_CONFIG_FILE": os.devnull,
            "AWS_EC2_METADATA_DISABLED": "true",
            "AWS_CLI_AUTO_PROMPT": "off",
            "AWS_PAGER": "",
        }
    )
    return clean


class AwsCli:
    """Allow-listed AWS CLI calls. ``run`` and ``popen`` are injectable for offline tests."""

    def __init__(
        self,
        settings: Settings,
        *,
        run: Callable[..., Any] = subprocess.run,
        popen: Callable[..., Any] = subprocess.Popen,
        environ: dict[str, str] | None = None,
        guard_operations: Sequence[str] = ("poll",),
    ) -> None:
        self._settings = settings
        self._guard_operations = tuple(guard_operations)
        self._run = run
        self._popen = popen
        self._environ = dict(os.environ if environ is None else environ)
        self._env: dict[str, str] | None = None

    def environment(self) -> dict[str, str]:
        if self._env is None:
            if self._settings.aws_credential_mode == "instance_role":
                if self._settings.aws_credentials_file is None:
                    raise AwsProviderError("AWS_PROFILE_MISSING", "no credentials file configured")
                self._env = hosted_environment(self._settings.aws_credentials_file, self._environ)
            else:
                if self._settings.aws_config_file is None:
                    raise AwsProviderError("AWS_PROFILE_MISSING", "no dedicated config configured")
                self._env = clean_environment(self._settings.aws_config_file, self._environ)
        return self._env

    def argv(self, *arguments: str) -> list[str]:
        return [
            "aws", "--profile", profile_for(self._settings), "--region", REGION,
            "--output", "json", "--no-cli-pager", *arguments,
        ]  # fmt: skip

    def call(self, *arguments: str, timeout: int = 60) -> tuple[int, bytes, bytes]:
        argv = self.argv(*arguments)
        validate_argv(argv, self._settings, self._guard_operations)
        try:
            completed = self._run(
                argv, env=self.environment(), capture_output=True, timeout=timeout, check=False
            )
        except subprocess.TimeoutExpired as error:
            raise AwsProviderError("AWS_CLI_TIMEOUT", arguments[0]) from error
        except OSError as error:
            raise AwsProviderError(
                "AWS_CLI_UNAVAILABLE", "the AWS CLI could not be executed"
            ) from error
        return completed.returncode, completed.stdout or b"", completed.stderr or b""

    def json_call(self, *arguments: str, timeout: int = 60) -> dict[str, Any]:
        code, out, _ = self.call(*arguments, timeout=timeout)
        if code != 0:
            raise AwsProviderError("AWS_CALL_FAILED", f"{arguments[0]} {arguments[1]}")
        try:
            value = json.loads(out or b"{}")
        except ValueError as error:
            raise AwsProviderError("AWS_BAD_RESPONSE", "response was not JSON") from error
        if not isinstance(value, dict):
            raise AwsProviderError("AWS_BAD_RESPONSE", "response was not an object")
        return value

    # -- identity and guard (read-only) -------------------------------------------------------
    def verify_identity(self) -> None:
        identity = self.json_call("sts", "get-caller-identity")
        if self._settings.aws_credential_mode == "instance_role":
            role = re.escape(self._settings.aws_backend_role_name)
            pattern = rf"^arn:aws:sts::{ACCOUNT}:assumed-role/{role}/i-[0-9a-f]{{8,17}}$"
            if identity.get("Account") != ACCOUNT or not re.match(pattern, identity.get("Arn", "")):
                raise AwsProviderError("AWS_IDENTITY_MISMATCH", "not the ChemDFT backend role")
            return
        if identity.get("Account") != ACCOUNT or identity.get("Arn") not in ALLOWED_ARNS:
            raise AwsProviderError("AWS_IDENTITY_MISMATCH", "not the ChemDFT pilot operator or owner")
        self._verified_arn = str(identity["Arn"])

    def poll_guard(self) -> dict[str, Any]:
        """operation=poll never starts EC2 (verified in runtime_guard.control)."""
        return self.invoke_guard("poll")

    def invoke_guard(self, operation: str) -> dict[str, Any]:
        if operation not in self._guard_operations:
            raise AwsProviderError("AWS_COMMAND_NOT_ALLOWED", f"guard operation {operation}")
        with tempfile.TemporaryDirectory(prefix="chemdft-guard-") as directory:
            out = Path(directory) / "guard.json"
            meta = self.json_call(
                "lambda", "invoke", "--function-name", GUARD_FUNCTION,
                "--cli-binary-format", "raw-in-base64-out",
                "--payload", f'{{"operation":"{operation}"}}', str(out), timeout=90,
            )  # fmt: skip
            try:
                text = out.read_text()
                value = json.loads(text)
            except (OSError, ValueError) as error:
                raise AwsProviderError("GUARD_ERROR", "guard response unreadable") from error
        if meta.get("StatusCode") != 200 or meta.get("FunctionError"):
            if "InsufficientInstanceCapacity" in text:
                raise AwsProviderError("AWS_CAPACITY_ERROR", "InsufficientInstanceCapacity")
            raise AwsProviderError("GUARD_ERROR", "guard reported a function error")
        if not isinstance(value, dict):
            raise AwsProviderError("GUARD_ERROR", "guard response malformed")
        return value

    def instance_info(self) -> tuple[str, int | None]:
        """Independent read of the pilot instance: (state, launch epoch). EC2 DescribeInstances only."""
        data = self.json_call("ec2", "describe-instances", "--instance-ids",
                              self._settings.aws_instance_id or "")  # fmt: skip
        try:
            instance = data["Reservations"][0]["Instances"][0]
            state = str(instance["State"]["Name"])
        except (KeyError, IndexError, TypeError) as error:
            raise AwsProviderError("AWS_BAD_RESPONSE", "unexpected describe-instances shape") from error
        launch = None
        try:
            launch = int(datetime.fromisoformat(str(instance["LaunchTime"])).timestamp())
        except (KeyError, ValueError):
            pass
        return state, launch

    def instance_state(self) -> str:
        return self.instance_info()[0]

    # -- S3 (approved pilot job/workflow prefixes only) ---------------------------------------
    def put(self, local: Path, key: str) -> None:
        uri = f"s3://{self._settings.aws_pilot_bucket}/{key}"
        code, _, _ = self.call("s3", "cp", "--only-show-errors", str(local), uri, timeout=120)
        if code != 0:
            raise AwsProviderError("S3_UPLOAD_FAILED", key.rsplit("/", 1)[-1])

    def get(self, key: str, destination: Path) -> bool:
        """True when downloaded, False when the object does not exist (yet)."""
        uri = f"s3://{self._settings.aws_pilot_bucket}/{key}"
        code, _, err = self.call(
            "s3", "cp", "--only-show-errors", uri, str(destination), timeout=120
        )
        if code == 0:
            return True
        if b"404" in err or b"NoSuchKey" in err or b"Not Found" in err:
            return False
        raise AwsProviderError("S3_DOWNLOAD_FAILED", key.rsplit("/", 1)[-1])

    def exists(self, key: str) -> bool:
        """Exact-key existence via a prefix listing (permitted); never infers it from a 403."""
        code, out, _ = self.call(
            "s3api", "list-objects-v2", "--bucket", self._settings.aws_pilot_bucket or "",
            "--prefix", key, "--max-keys", "1", "--query", EXISTS_QUERY,
        )  # fmt: skip
        if code != 0:
            raise AwsProviderError("S3_DOWNLOAD_FAILED", "listing failed")
        return out.decode().strip() not in {"", "0", "null"}

    def content_length(self, key: str) -> int:
        code, out, _ = self.call(
            "s3api", "head-object", "--bucket", self._settings.aws_pilot_bucket or "",
            "--key", key, "--query", "ContentLength",
        )  # fmt: skip
        if code != 0:
            raise AwsProviderError("S3_DOWNLOAD_FAILED", "object length unavailable")
        try:
            return int(out.decode().strip())
        except ValueError as error:
            raise AwsProviderError("S3_DOWNLOAD_FAILED", "length unavailable") from error

    # -- SSM interactive shell (the only command channel the operator policy grants) ----------
    def ssm_run_line(
        self, line: str, *, ok: bytes, failed: bytes, timeout: float, clock=time.monotonic
    ) -> str:
        """Send ONE validated command line to the logged shell and wait for a marker.

        Returns 'ok', 'failed' or 'timeout'."""
        argv = self.argv(
            "ssm", "start-session", "--target", self._settings.aws_instance_id or "",
            "--document-name", SSM_DOCUMENT,
        )  # fmt: skip
        validate_argv(argv, self._settings)
        try:
            process = self._popen(
                argv, env=self.environment(), stdin=subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            )  # fmt: skip
        except OSError as error:
            raise AwsProviderError("SSM_UNAVAILABLE", "session could not be started") from error
        result = "timeout"
        try:
            process.stdin.write(line.encode() + b"\n")
            process.stdin.flush()
            buffer = b""
            deadline = clock() + timeout
            while clock() < deadline:
                ready, _, _ = select.select([process.stdout], [], [], 0.5)
                if ready:
                    chunk = os.read(process.stdout.fileno(), 4096)
                    if not chunk:
                        result = "failed"
                        break
                    buffer += chunk
                    if ok in buffer:
                        result = "ok"
                        break
                    if failed in buffer:
                        result = "failed"
                        break
                elif process.poll() is not None:
                    result = "failed"
                    break
        except (OSError, ValueError):
            result = "failed"
        finally:
            # Always leave the shell cleanly so session logs flush BEFORE any guard stop.
            try:
                process.stdin.write(b"exit\n")
                process.stdin.flush()
                process.stdin.close()
            except (OSError, ValueError):
                pass
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
        return result


# ---------------------------------------------------------------------------------------------
# The provider
# ---------------------------------------------------------------------------------------------
def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class AwsEc2ComputeProvider:
    provider = AWS_PROVIDER

    def __init__(
        self,
        settings: Settings,
        *,
        cli: AwsCli | None = None,
        clock: Callable[[], float] = time.monotonic,
        wall: Callable[[], float] = time.time,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._settings = settings
        self._cli = cli or AwsCli(settings)
        self._clock = clock
        self._wall = wall
        self._sleep = sleep

    # -- capability (no AWS call; purely local configuration + session record) -----------------
    def missing_configuration(self) -> list[str]:
        s = self._settings
        missing = []
        if s.aws_credential_mode == "instance_role":
            if s.aws_credentials_file is None:
                missing.append("aws_credentials_file")
        elif s.aws_config_file is None:
            missing.append("aws_config_file")
        if not (s.aws_pilot_bucket and _BUCKET.match(s.aws_pilot_bucket)):
            missing.append("aws_pilot_bucket")
        if not (s.aws_instance_id and _INSTANCE.match(s.aws_instance_id)):
            missing.append("aws_instance_id")
        if not (s.aws_image_id and _IMAGE.match(s.aws_image_id)):
            missing.append("aws_image_id")
        if s.aws_session_file is None and not s.aws_session_s3_key:
            missing.append("aws_session_file or aws_session_s3_key")
        if s.aws_session_s3_key and s.aws_session_s3_key != SESSION_KEY:
            missing.append("aws_session_s3_key (must be the approved session key)")
        if not WORKFLOW_SCRIPT.is_file():
            missing.append("host-workflow.sh")
        return missing

    def can_queue(self) -> bool:
        """Hosted API: accept AWS jobs now and let them wait READY until the owner opens a session.

        Needs no credentials in the API process (only the compute worker talks to AWS)."""
        s = self._settings
        return bool(
            s.compute_aws_enabled
            and (s.aws_queue_without_session or s.aws_on_demand_enabled)
            and s.aws_pilot_bucket
            and _BUCKET.match(s.aws_pilot_bucket)
            and s.aws_instance_id
            and _INSTANCE.match(s.aws_instance_id)
            and s.aws_image_id
            and _IMAGE.match(s.aws_image_id)
        )

    def capabilities(self):
        from .compute_gateway import ProviderCapability

        summary = "AWS EC2 pilot, session-based PySCF energy (experimental)"
        if not self._settings.compute_aws_enabled:
            return ProviderCapability(
                self.provider, "UNAVAILABLE", summary, True, False,
                "AWS execution is disabled; it must be explicitly enabled.",
            )  # fmt: skip
        missing = self.missing_configuration()
        if missing:
            return ProviderCapability(
                self.provider, "MISCONFIGURED", summary, True, False,
                "Missing AWS settings: " + ", ".join(missing),
            )  # fmt: skip
        if not session_is_authorized(self._settings, self._wall(), self._cli):
            diagnostic = "No owner-approved AWS compute session with enough time remaining is open."
            if self._settings.aws_on_demand_enabled:
                from .aws_worker_lifecycle import visible_diagnostic

                diagnostic = visible_diagnostic(self._settings, self._wall()) or diagnostic
            return ProviderCapability(
                self.provider, "UNAVAILABLE", summary, True, False, diagnostic
            )  # fmt: skip
        return ProviderCapability(self.provider, "AVAILABLE", summary, True, False)

    # -- execution ----------------------------------------------------------------------------
    @staticmethod
    def _failure(code: str, message: str, *, timed_out: bool = False, exit_code=None, ref=None):
        return ExecutionResult(
            exit_code=exit_code,
            timed_out=timed_out,
            stdout=b"",
            stderr=f"{message}".encode()[:1000],
            engine_log=b"",
            result_document=None,
            failure_code=code,
            provider_ref=ref,
        )

    def execute(
        self,
        *,
        calculation_id: str,
        normalized_input: bytes,
        engine: str | None = None,
        workload: WorkloadReference | None = None,
        allowed_version: str | None = None,
        on_step=None,
        on_tick=None,
        execution_id: str | None = None,
        attempt_number: int | None = None,
    ) -> ExecutionResult:
        del execution_id, attempt_number
        settings = self._settings
        document = json.loads(normalized_input) if normalized_input else {}
        resolved = (engine or str(document.get("engine", ""))).strip().lower()
        task = str(document.get("task", "")).upper()
        if not (
            (resolved == "pyscf" and (task in AWS_PYSCF_TASKS or task in AWS_PYSCF_PERIODIC_TASKS))
            or (resolved == "xtb" and task in AWS_XTB_TASKS)
            or (resolved == "crest" and task in AWS_CREST_TASKS)
            or (resolved == "qe" and task == AWS_PERIODIC_ENERGY_TASK)
        ):
            raise UnsupportedCalculation(
                "The AWS provider currently supports PySCF single-point energy, "
                "periodic energy, geometry optimization, frequency analysis, thermochemistry, molecular "
                "orbitals and TDDFT, xTB (GFN2) single-point energy and geometry optimization, and "
                "CREST conformer search, plus Quantum ESPRESSO periodic DFT when it is switched on."
            )
        qe = resolved == "qe"
        periodic = task == AWS_PERIODIC_ENERGY_TASK and not qe
        optimization = task == AWS_OPTIMIZATION_TASK
        frequency = task == AWS_FREQUENCY_TASK
        thermochemistry = task == AWS_THERMOCHEMISTRY_TASK
        orbital = task == AWS_ORBITAL_TASK
        tddft = task == AWS_TDDFT_TASK
        xtb = resolved == "xtb"
        crest = resolved == "crest"
        expected_workload = (
            WORKLOAD_CREST_SEARCH
            if crest
            else WORKLOAD_QE_PERIODIC_ENERGY
            if qe
            else WORKLOAD_XTB_OPTIMIZATION
            if xtb and optimization
            else WORKLOAD_XTB_ENERGY
            if xtb
            else WORKLOAD_PYSCF_PERIODIC_ENERGY
            if periodic
            else WORKLOAD_PYSCF_TDDFT
            if tddft
            else WORKLOAD_PYSCF_OPTIMIZATION
            if optimization
            else WORKLOAD_PYSCF_FREQUENCY
            if frequency
            else WORKLOAD_PYSCF_THERMOCHEMISTRY
            if thermochemistry
            else WORKLOAD_PYSCF_ORBITAL
            if orbital
            else WORKLOAD_PYSCF_ENERGY
        )
        if workload is not None and workload != expected_workload:
            kind = (
                "CREST conformer search"
                if crest
                else "Quantum ESPRESSO periodic energy"
                if qe
                else "xTB optimization"
                if xtb and optimization
                else "xTB energy"
                if xtb
                else "periodic energy"
                if periodic
                else "TDDFT"
                if tddft
                else "optimization"
                if optimization
                else "frequency"
                if frequency
                else "thermochemistry"
                if thermochemistry
                else "orbital"
                if orbital
                else "energy"
            )
            raise UnsupportedCalculation(
                f"AWS {kind} execution requires the {expected_workload.workload_type} workload."
            )
        if periodic:
            atoms = document.get("atoms")
            periodic_opts = document.get("periodic") or {}
            k_mesh = periodic_opts.get("k_mesh", (1, 1, 1))
            reason = aws_periodic_refusal(
                settings,
                len(atoms) if isinstance(atoms, list) else settings.aws_periodic_max_atoms + 1,
                k_mesh,
            )
            if reason:
                raise UnsupportedCalculation(reason)
        if qe:
            from .scientific.qe_periodic.qe_registry import (
                hosted_qe,
                qe_document_refusal,
                qe_limits_from_settings,
            )

            if not hosted_qe(settings):
                raise UnsupportedCalculation("Quantum ESPRESSO is not switched on for the hosted compute image.")
            reason = qe_document_refusal(settings, document)
            if reason:
                raise UnsupportedCalculation(reason)
            limits = qe_limits_from_settings(settings)
            document["qe_limits"] = {key: getattr(limits, key) for key in limits.__dataclass_fields__}
            normalized_input = json.dumps(document, sort_keys=True).encode()
        if crest:
            from .scientific.engines.crest import validate_input as validate_crest_input

            reason = aws_crest_refusal(settings, document)
            if reason is None:
                try:
                    validate_crest_input(document)
                except (ValueError, KeyError, TypeError) as error:
                    reason = f"Hosted CREST input was refused: {error}"
            if reason:
                raise UnsupportedCalculation(reason)
        if tddft:
            atoms = document.get("atoms")
            options = document.get("tddft")
            reason = aws_tddft_refusal(
                settings,
                document.get("multiplicity", 1),
                len(atoms) if isinstance(atoms, list) else settings.aws_tddft_max_atoms + 1,
                options.get("nstates") if isinstance(options, dict) else None,
            )
            if reason:
                raise UnsupportedCalculation(reason)
        if xtb:
            atoms = document.get("atoms")
            if (
                document.get("multiplicity", 1) != 1
                or document.get("charge", 0) != 0
                or str(document.get("method", "")).lower() != "gfn2"
                or document.get("basis") is not None
                or not isinstance(atoms, list)
                or len(atoms) > settings.aws_xtb_max_atoms
            ):
                raise UnsupportedCalculation(
                    "Hosted xTB runs neutral closed-shell GFN2 single-point energies and geometry "
                    f"optimizations of at most {settings.aws_xtb_max_atoms} atoms only."
                )
        if orbital:
            atoms = document.get("atoms")
            reason = aws_orbital_refusal(
                settings,
                document.get("multiplicity", 1),
                len(atoms) if isinstance(atoms, list) else settings.aws_orbital_max_atoms + 1,
            )
            if reason:
                raise UnsupportedCalculation(reason)
        if thermochemistry and document.get("multiplicity", 1) != 1:
            raise UnsupportedCalculation(
                "Hosted thermochemistry runs closed-shell molecules only (multiplicity 1)."
            )
        if thermochemistry:
            atoms = document.get("atoms")
            if not isinstance(atoms, list) or len(atoms) > settings.aws_frequency_max_atoms:
                raise UnsupportedCalculation(
                    "Hosted thermochemistry is limited to "
                    f"{settings.aws_frequency_max_atoms} atoms, like the frequency analysis it uses."
                )
        if frequency:
            atoms = document.get("atoms")
            reason = aws_frequency_refusal(
                settings,
                document.get("multiplicity", 1),
                len(atoms) if isinstance(atoms, list) else settings.aws_frequency_max_atoms + 1,
                raman=document.get("raman") is not None,
            )
            if reason:
                raise UnsupportedCalculation(reason)
        if optimization and not xtb:
            atoms = document.get("atoms")
            reason = aws_optimization_refusal(
                settings,
                document.get("multiplicity", 1),
                len(atoms) if isinstance(atoms, list) else settings.aws_optimization_max_atoms + 1,
            )
            if reason:
                raise UnsupportedCalculation(reason)
        if crest:
            from .scientific.engines.crest import VERSION as CREST_VERSION

            pinned = CREST_VERSION
        elif qe:
            pinned = settings.aws_qe_version
        else:
            pinned = settings.aws_xtb_version if xtb else settings.aws_pyscf_version
        requested = allowed_version or document.get("engine_version")
        if requested and requested != pinned:
            raise UnsupportedCalculation(
                f"The AWS image provides {'CREST' if crest else 'Quantum ESPRESSO' if qe else 'xTB' if xtb else 'PySCF'} "
                f"{pinned}, not the requested {requested}."
            )

        run_id = str(uuid.uuid4())
        limit = aws_runtime_limit_seconds(settings, task, resolved)
        try:
            session = self._authorize(limit)
            self._cli.verify_identity()
            self._verify_guard(session)
            outcome = self._run_remote(
                run_id, normalized_input, limit, session, on_tick, task=task, on_step=on_step,
                engine=resolved, calculation_id=calculation_id,
            )
        except AwsProviderError as error:
            return self._failure(self._code_class(error.code), str(error), ref=None)
        return outcome

    @staticmethod
    def _code_class(code: str) -> str:
        integrity = {
            "AWS_HASH_MISMATCH",
            "AWS_MISSING_OUTPUT",
            "AWS_BAD_STATUS",
            "AWS_BAD_RESULT",
            "AWS_OUTPUT_TOO_LARGE",
        }
        return "RESULT_VALIDATION_FAILED" if code in integrity else "ENGINE_UNAVAILABLE"

    def _authorize(self, limit: int) -> AwsSession:
        if self.capabilities().availability != "AVAILABLE":
            raise AwsProviderError(
                "NO_AUTHORIZED_AWS_SESSION", self.capabilities().diagnostic or ""
            )
        session = current_session(self._settings, self._cli)
        if session is None:
            raise AwsProviderError("NO_AUTHORIZED_AWS_SESSION", "session record unreadable")
        needed = limit + self._settings.aws_job_overhead_seconds + 120
        if session.remaining(self._wall()) < needed:
            raise AwsProviderError("AWS_SESSION_EXPIRING", "not enough session time for this job")
        return session

    def _verify_guard(self, session: AwsSession) -> None:
        if not self._settings.aws_guard_poll_enabled:
            # Hosted: no guard access by design. The instance must be running and its launch must
            # belong to the recorded session; the guard, the host timer and the quota still bound it.
            state, launch = self._cli.instance_info()
            if state != "running":
                raise AwsProviderError("AWS_SESSION_NOT_RUNNING", f"instance state {state}")
            if launch is None or not 0 <= session.opened_epoch - launch <= 1800:
                raise AwsProviderError("AWS_SESSION_MISMATCH", "launch does not match the session")
            return
        try:
            state = self._cli.poll_guard()
        except AwsProviderError as error:
            raise AwsProviderError("GUARD_UNAVAILABLE", error.detail or error.code) from error
        status = state.get("status")
        if status in {"QUOTA_EXHAUSTED_OR_MONTH_END"}:
            raise AwsProviderError("GUARD_ADMISSION_REFUSED", str(status))
        if status != "running":
            raise AwsProviderError("AWS_SESSION_NOT_RUNNING", f"guard status {status}")
        deadline = state.get("deadline")
        if not isinstance(deadline, int) or deadline != session.deadline_epoch:
            raise AwsProviderError(
                "AWS_SESSION_MISMATCH", "guard deadline differs from the session"
            )

    def _run_remote(
        self, run_id, normalized_input, limit, session, on_tick, *, task=AWS_ENERGY_TASK,
        on_step=None, engine="pyscf", calculation_id=None,
    ) -> ExecutionResult:
        settings = self._settings
        cli = self._cli
        input_sha = _sha(normalized_input)
        script = WORKFLOW_SCRIPT.read_bytes()
        script_sha = _sha(script)
        prefix = f"pilot/chemdft-jobs/{run_id}"
        pointer_key = (
            f"pilot/chemdft-jobs/_calc/{calculation_id}/run.json"
            if calculation_id and _CALCULATION_ID.match(calculation_id)
            else None
        )
        with tempfile.TemporaryDirectory(prefix="chemdft-aws-") as directory:
            work = Path(directory)
            # Release 0.0.45: an execution that was lost (lease lapse, worker restart) is retried by the queue. It must not
            # start a second host run while the first is still running or has a receipt: attach to that run instead.
            prior = self._prior_run(pointer_key, work, input_sha) if pointer_key else None
            if prior is not None:
                run_id, launched_epoch = prior
                prefix = f"pilot/chemdft-jobs/{run_id}"
                budget = max(0.0, launched_epoch + limit + settings.aws_job_overhead_seconds - self._wall())
            else:
                (work / "input.json").write_bytes(normalized_input)
                (work / "host-workflow.sh").write_bytes(script)
                cli.put(work / "input.json", f"{prefix}/input/input.json")
                cli.put(work / "host-workflow.sh", f"pilot/chemdft-workflow/{script_sha}.sh")
                if pointer_key:
                    self._write_pointer(pointer_key, work, run_id, input_sha, int(self._wall()), launched=True)

                launch = self._launch_line(
                    run_id, input_sha, script_sha, limit,
                    host_engine_name(engine, task), calculation_id,
                )
                marker = f"CHEMDFT_LAUNCHED {run_id}".encode()
                outcome = cli.ssm_run_line(
                    launch,
                    ok=marker,
                    failed=b"CHEMDFT_LAUNCH_FAILED",
                    timeout=120,
                    clock=self._clock,
                )
                if outcome != "ok":
                    if pointer_key:  # nothing runs on the host: a later attempt may launch again
                        self._write_pointer(pointer_key, work, run_id, input_sha, int(self._wall()), launched=False)
                    raise AwsProviderError("SSM_LAUNCH_FAILED", f"launch outcome {outcome}")
                budget = limit + settings.aws_job_overhead_seconds

            deadline = self._clock() + budget
            tick_every = max(1.0, settings.compute_heartbeat_seconds / 4)
            last_tick = self._clock()
            receipt = work / "receipt.json"
            while True:
                if cli.exists(f"{prefix}/receipt.json") and cli.get(
                    f"{prefix}/receipt.json", receipt
                ):
                    break
                now = self._clock()
                if session.remaining(self._wall()) < 90:
                    self._cancel(run_id, script_sha)
                    raise AwsProviderError("AWS_SESSION_EXPIRING", "session ended during the job")
                if now >= deadline:
                    self._cancel(run_id, script_sha)
                    return self._failure(
                        "ENGINE_UNAVAILABLE", "AWS_JOB_TIMEOUT: no receipt before the deadline",
                        timed_out=True, ref=f"aws:{run_id}",
                    )  # fmt: skip
                if on_tick is not None and now - last_tick >= tick_every:
                    last_tick = now
                    try:
                        if on_tick() is False:
                            self._cancel(run_id, script_sha)
                            return self._failure(
                                "ENGINE_UNAVAILABLE", "AWS_JOB_CANCELED", exit_code=-1,
                                ref=f"aws:{run_id}",
                            )  # fmt: skip
                    except Exception:  # a heartbeat must not disturb the run
                        pass
                self._sleep(settings.aws_poll_seconds)
            return self._collect(
                run_id, prefix, input_sha, session, work, task=task, on_step=on_step,
                engine=engine,
            )

    def _prior_run(self, pointer_key: str, work: Path, input_sha: str) -> tuple[str, int] | None:
        """The run id and launch time of an earlier host run of the same calculation, if it was really launched."""
        target = work / "prior-run.json"
        if not self._cli.exists(pointer_key) or not self._cli.get(pointer_key, target):
            return None
        try:
            data = json.loads(target.read_text())
            run = str(data["run_id"])
            launched = int(data["launched_epoch"])
        except (ValueError, KeyError, TypeError):
            return None
        if not data.get("launched") or not _RUN_ID.match(run) or data.get("input_sha") != input_sha:
            return None
        return run, launched

    def _write_pointer(self, pointer_key: str, work: Path, run_id: str, input_sha: str, epoch: int, *, launched: bool) -> None:
        document = {"run_id": run_id, "input_sha": input_sha, "launched_epoch": epoch, "launched": launched}
        path = work / "run-pointer.json"
        path.write_text(json.dumps(document, sort_keys=True))
        self._cli.put(path, pointer_key)

    def _launch_line(
        self, run_id: str, input_sha: str, script_sha: str, limit: int, engine: str = "pyscf",
        calculation_id: str | None = None,
    ) -> str:
        s = self._settings
        for value, pattern in (
            (run_id, _RUN_ID), (input_sha, _SHA), (script_sha, _SHA),
            (s.aws_image_id or "", _IMAGE), (s.aws_pilot_bucket or "", _BUCKET),
        ):  # fmt: skip
            if not pattern.match(value):
                raise AwsProviderError("AWS_BAD_ARGUMENT", "refusing to build a command line")
        if not (10 <= int(limit) <= 3600):
            raise AwsProviderError("AWS_BAD_ARGUMENT", "timeout out of range")
        if engine not in {"pyscf", "pyscf-periodic", "xtb", "crest", "qe"}:
            raise AwsProviderError("AWS_BAD_ARGUMENT", "unknown engine")
        # PySCF keeps the exact historical command line; other engines add a worker selector.
        worker_argument = f" {engine}" if engine in {"pyscf-periodic", "xtb", "crest", "qe"} else ""
        if engine == "crest":
            # The Result Firewall binds CREST's invocation.json to the real calculation id.
            if not _CALCULATION_ID.match(calculation_id or ""):
                raise AwsProviderError("AWS_BAD_ARGUMENT", "refusing to build a command line")
            worker_argument += f" {calculation_id}"
        installed = f"/usr/local/sbin/chemdft-host-workflow-{script_sha}.sh"
        staging = f"/tmp/cw-{script_sha}.sh"
        steps = [
            f"AWS_DEFAULT_REGION=us-east-1 aws s3 cp --only-show-errors "
            f"s3://{s.aws_pilot_bucket}/pilot/chemdft-workflow/{script_sha}.sh {staging}",
            f"sudo -n install -o root -g root -m 0755 {staging} {installed}",
            f"echo '{script_sha}  {installed}' | sudo -n sha256sum -c -",
            f"sudo -n systemd-run --no-block --collect --quiet --unit chemdft-job-{run_id} "
            f"--property=RuntimeMaxSec={int(limit) + 120} "
            f"--setenv=CHEMDFT_PILOT_BUCKET={s.aws_pilot_bucket} "
            f"{installed} job {run_id} {input_sha} {s.aws_image_id} {int(limit)}{worker_argument}",
        ]
        # The marker is assembled by printf so the shell's echo of this line cannot contain it.
        return (
            " && ".join(steps)
            + f" && printf 'CHEMDFT_%s %s\\n' LAUNCHED {run_id}"
            + " || printf 'CHEMDFT_%s\\n' LAUNCH_FAILED"
        )

    def _cancel(self, run_id: str, script_sha: str) -> None:
        installed = f"/usr/local/sbin/chemdft-host-workflow-{script_sha}.sh"
        line = f"sudo -n {installed} cancel {run_id}; printf 'CHEMDFT_%s\\n' CANCEL_DONE"
        # If this fails, the host's RuntimeMaxSec/watchdog and shutdown timer still bound the job.
        with contextlib.suppress(AwsProviderError):
            self._cli.ssm_run_line(
                line, ok=b"CHEMDFT_CANCEL_DONE", failed=b"CHEMDFT_NEVER", timeout=45,
                clock=self._clock,
            )  # fmt: skip

    def _download_checked(self, prefix: str, name: str, expected: dict, work: Path) -> bytes:
        destination = work / name
        if not self._cli.get(f"{prefix}/{name}", destination):
            raise AwsProviderError("AWS_MISSING_OUTPUT", name)
        data = destination.read_bytes()
        if len(data) != expected.get("bytes") or _sha(data) != expected.get("sha256"):
            raise AwsProviderError("AWS_HASH_MISMATCH", name)
        return data

    def _collect(
        self, run_id, prefix, input_sha, session, work: Path, *, task=AWS_ENERGY_TASK,
        on_step=None, engine="pyscf",
    ) -> ExecutionResult:
        settings = self._settings
        optimization = task == AWS_OPTIMIZATION_TASK
        try:
            receipt = json.loads((work / "receipt.json").read_text())
        except ValueError as error:
            raise AwsProviderError("AWS_BAD_STATUS", "receipt.json is not JSON") from error
        if not isinstance(receipt, dict):
            raise AwsProviderError("AWS_BAD_STATUS", "receipt.json is not an object")
        status_path = work / "status.json"
        if not self._cli.get(f"{prefix}/status.json", status_path):
            raise AwsProviderError("AWS_MISSING_OUTPUT", "status.json")
        status_bytes = status_path.read_bytes()
        if _sha(status_bytes) != receipt.get("status_sha256"):
            raise AwsProviderError("AWS_HASH_MISMATCH", "status.json")
        try:
            status = json.loads(status_bytes)
        except ValueError as error:
            raise AwsProviderError("AWS_BAD_STATUS", "status.json is not JSON") from error
        if (
            status.get("schema") != "chemdft.aws.job-status.v1"
            or status.get("run_id") != run_id
            or status.get("input_sha256") != input_sha
            or status.get("image_id") != settings.aws_image_id
        ):
            raise AwsProviderError("AWS_BAD_STATUS", "status does not match this job")
        files = status.get("files") or {}
        # The input echoed by the host must be byte-identical to what was sent.
        echoed = files.get("in/input.json") or {}
        if echoed.get("sha256") != input_sha:
            raise AwsProviderError("AWS_HASH_MISMATCH", "input.json")
        archive_key = f"{prefix}/evidence.tar.gz"
        if self._cli.content_length(archive_key) != receipt.get("archive_bytes"):
            raise AwsProviderError("AWS_HASH_MISMATCH", "evidence.tar.gz length")

        # Hard cap on everything the host reports: the host's own 20 MiB watchdog applies to the
        # whole out/ directory, and the provider refuses to trust a larger claim.
        reported = sum(
            int(item.get("bytes") or 0) for name, item in files.items() if name.startswith("out/")
        )
        if reported > HOST_OUTPUT_CAP_BYTES:
            raise AwsProviderError("AWS_OUTPUT_TOO_LARGE", "host-reported outputs exceed the cap")

        def fetch(label: str, *, required: bool) -> bytes | None:
            relative = {
                "result": "out/result.json", "engine_log": "out/engine.log",
                "stdout": "out/stdout.log", "stderr": "out/stderr.log",
                "steps": "out/steps.jsonl",
            }[label]  # fmt: skip
            expected = files.get(relative)
            if expected is None:
                if required:
                    raise AwsProviderError("AWS_MISSING_OUTPUT", relative)
                return None
            if label == "steps" and int(expected.get("bytes") or 0) > min(
                settings.scientific_max_output_bytes, HOST_OUTPUT_CAP_BYTES
            ):
                raise AwsProviderError("AWS_OUTPUT_TOO_LARGE", relative)
            return self._download_checked(prefix, JOB_FILES[label], expected, work)

        state = status.get("state")
        exit_code = status.get("exit_code")
        stdout = fetch("stdout", required=False) or b""
        stderr = fetch("stderr", required=False) or b""
        engine_log = fetch("engine_log", required=False) or b""
        result_bytes = fetch("result", required=False)
        steps_bytes = fetch("steps", required=False) if optimization else None
        # xTB's ANCopt evidence (xtbopt.log, xtbopt.xyz, invocation/execution records, ...) is what the
        # optimization validator re-reads; each file is hash-checked against the host's status.
        xtb_native: dict[str, bytes] = {}
        if optimization and engine == "xtb":
            for native_name in XTB_NATIVE_FILES:
                expected = files.get(f"out/native/{native_name}")
                if expected is not None:
                    xtb_native[native_name] = self._download_checked(
                        prefix, f"out__native__{native_name}", expected, work
                    )
        # CREST writes a variable set of native files; the host reports each with its hash and size.
        crest_native: dict[str, bytes] = {}
        if engine == "crest":
            names = sorted(
                name.removeprefix("out/native/")
                for name in files
                if name.startswith("out/native/")
            )
            if len(names) > CREST_NATIVE_MAX_FILES or any(
                not CREST_NATIVE_NAME.fullmatch(name) for name in names
            ):
                raise AwsProviderError("AWS_BAD_RESULT", "unexpected CREST native file set")
            for native_name in names:
                crest_native[native_name] = self._download_checked(
                    prefix, f"out__native__{native_name}", files[f"out/native/{native_name}"], work
                )
        reference = f"aws:{run_id}"
        provenance = {
            "provider": AWS_PROVIDER, "run_id": run_id, "instance_id": session.instance_id,
            "image_id": settings.aws_image_id, "hardware_class": HARDWARE_CLASS,
            "input_sha256": input_sha, "host_state": state, "host_exit_code": exit_code,
            "result_sha256": _sha(result_bytes) if result_bytes else None,
            "engine_log_sha256": _sha(engine_log) if engine_log else None,
            "archive_sha256_host_reported": receipt.get("archive_sha256"),
            "evidence": f"s3://{settings.aws_pilot_bucket}/{prefix}/",
            "session_deadline_epoch": session.deadline_epoch,
            "verified_by": getattr(self, "_verified_arn", EXPECTED_ARN),
            "collected_utc": datetime.fromtimestamp(self._wall(), UTC).isoformat(),
        }  # fmt: skip
        if optimization or task in {
            AWS_FREQUENCY_TASK, AWS_THERMOCHEMISTRY_TASK, AWS_ORBITAL_TASK, AWS_TDDFT_TASK
        }:  # PySCF ENERGY provenance stays byte-for-byte
            provenance["task"] = task
        if engine in {"xtb", "crest", "qe"}:
            provenance["engine"] = engine
        if engine == "qe":
            provenance["task"] = task
        if engine == "crest":
            provenance["task"] = task
            provenance["crest_binary_sha256"] = settings.aws_crest_binary_sha256
        if optimization:
            provenance["steps_sha256"] = _sha(steps_bytes) if steps_bytes else None
        if xtb_native or crest_native:
            provenance["native_sha256"] = {
                name: _sha(data) for name, data in sorted({**xtb_native, **crest_native}.items())
            }
        header = (
            "# CHEMDFT_AWS_PROVENANCE " + json.dumps(provenance, sort_keys=True) + "\n"
        ).encode()
        limit_bytes = settings.scientific_max_output_bytes

        # xTB's validator re-parses the native evidence and compares it with the worker result, hashing
        # EVERY artifact it is given (`evidence_sha256`); steps.jsonl is not part of that evidence, so it
        # is passed to the observer (replay_steps) but never listed as a native artifact for xTB.
        native = {"steps.jsonl": steps_bytes} if steps_bytes and engine != "xtb" else {}
        native.update(xtb_native)
        native.update(crest_native)
        replayed = False

        def replay_steps() -> None:
            """Feed the hash-verified steps to the same observer the local runner uses."""
            nonlocal replayed
            if replayed or not steps_bytes or on_step is None:
                return
            replayed = True
            for line in steps_bytes.decode("utf-8", errors="replace").splitlines():
                if line.strip() and on_step(json.loads(line)) is False:
                    break

        def result(**kwargs) -> ExecutionResult:
            return ExecutionResult(
                stdout=(header + stdout)[:limit_bytes], stderr=stderr[:limit_bytes],
                engine_log=engine_log[:limit_bytes], provider_ref=reference,
                native_artifacts=native, **kwargs,
            )  # fmt: skip

        if state != "WORKER_EXITED_ZERO":
            timed = bool(status.get("timed_out"))
            stderr = stderr + f"\nAWS_HOST_STATE {state} {status.get('failure') or ''}".encode()
            if state in {"MISSING_RESULT", "MISSING_NATIVE_LOG"}:
                return result(
                    exit_code=-1, timed_out=False, result_document=None,
                    failure_code="RESULT_VALIDATION_FAILED",
                )  # fmt: skip
            if state in {"FAILED", "IMAGE_MISSING"} or exit_code is None:
                return result(
                    exit_code=None, timed_out=False, result_document=None,
                    failure_code="ENGINE_UNAVAILABLE",
                )  # fmt: skip
            document = self._parse_result(result_bytes) if result_bytes else None
            replay_steps()
            return result(exit_code=int(exit_code), timed_out=timed, result_document=document)

        if result_bytes is None:
            raise AwsProviderError("AWS_MISSING_OUTPUT", "result.json")
        if not status.get("native_log"):
            raise AwsProviderError("AWS_MISSING_OUTPUT", "engine.log")
        document = self._parse_result(result_bytes)
        self._check_result_identity(document, task, engine)
        if optimization and not steps_bytes:
            raise AwsProviderError("AWS_MISSING_OUTPUT", "out/steps.jsonl")
        replay_steps()
        return result(exit_code=0, timed_out=False, result_document=document)

    @staticmethod
    def _parse_result(data: bytes | None) -> dict[str, object] | None:
        if data is None:
            return None
        try:
            value = json.loads(data)
        except ValueError as error:
            raise AwsProviderError("AWS_BAD_RESULT", "result.json is not JSON") from error
        if not isinstance(value, dict):
            raise AwsProviderError("AWS_BAD_RESULT", "result.json is not an object")
        return value

    def _check_result_identity(
        self, document: dict[str, object] | None, task: str = AWS_ENERGY_TASK,
        engine: str = "pyscf",
    ) -> None:
        """Provenance sanity: the numbers must claim to come from the requested engine (PySCF or
        xTB at its pinned version) on Linux x86_64."""
        if not document:
            raise AwsProviderError("AWS_BAD_RESULT", "empty result")
        environment = document.get("environment") or {}
        if engine == "crest":
            from .scientific.engines.crest import CALCULATOR as CREST_CALCULATOR
            from .scientific.engines.crest import VERSION as CREST_VERSION

            if (
                str(document.get("engine", "")).lower() != "crest"
                or document.get("engine_version") != CREST_VERSION
                or document.get("schema") != "chemdft.worker.conformer-ensemble"
                or document.get("task") != AWS_CONFORMER_TASK
                or document.get("method") != "gfn2"
                or environment.get("engine") != "crest"
                or environment.get("engine_version") != CREST_VERSION
                or environment.get("calculator") != CREST_CALCULATOR
                or environment.get("executable_sha256") != self._settings.aws_crest_binary_sha256
                or not self._settings.aws_crest_binary_sha256
                or environment.get("architecture") != "x86_64"
            ):
                raise AwsProviderError(
                    "AWS_BAD_RESULT",
                    "result does not identify the recorded Linux x86_64 CREST build",
                )
            return
        if engine == "qe":
            if (
                str(document.get("engine", "")).lower() != "qe"
                or document.get("engine_version") != self._settings.aws_qe_version
                or document.get("schema") != "chemdft.worker.periodic-energy"
                or document.get("task") != AWS_PERIODIC_ENERGY_TASK
                or not str(environment.get("platform", "")).startswith("Linux")
                or environment.get("architecture") != "x86_64"
            ):
                raise AwsProviderError(
                    "AWS_BAD_RESULT",
                    "result does not identify Quantum ESPRESSO periodic DFT on Linux x86_64",
                )
            return
        if engine == "xtb":
            expected_schema = (
                "chemdft.worker.optimization" if task == AWS_OPTIMIZATION_TASK
                else "chemdft.worker.energy"
            )
            expected_task = AWS_OPTIMIZATION_TASK if task == AWS_OPTIMIZATION_TASK else AWS_ENERGY_TASK
            if (
                str(document.get("engine", "")).lower() != "xtb"
                or document.get("engine_version") != self._settings.aws_xtb_version
                or document.get("schema") != expected_schema
                or document.get("task") != expected_task
                or (task == AWS_OPTIMIZATION_TASK and document.get("optimizer") != "xtb-ancopt")
                or str(document.get("method", "")).lower() != "gfn2"
                or not str(environment.get("platform", "")).startswith("Linux")
                or environment.get("architecture") != "x86_64"
            ):
                raise AwsProviderError(
                    "AWS_BAD_RESULT",
                    "result does not identify xTB GFN2 "
                    f"{'optimization' if task == AWS_OPTIMIZATION_TASK else 'energy'} on Linux x86_64",
                )
            return
        if (
            str(document.get("engine", "")).lower() != "pyscf"
            or document.get("engine_version") != self._settings.aws_pyscf_version
            or not str(environment.get("platform", "")).startswith("Linux")
            or environment.get("architecture") != "x86_64"
        ):
            raise AwsProviderError(
                "AWS_BAD_RESULT", "result does not identify PySCF on Linux x86_64"
            )
        if task == AWS_FREQUENCY_TASK and (
            document.get("schema") != "chemdft.worker.vibrational-analysis"
            or document.get("task") != AWS_FREQUENCY_TASK
        ):
            raise AwsProviderError(
                "AWS_BAD_RESULT", "result is not a PySCF analytic-Hessian frequency analysis"
            )
        if task == AWS_TDDFT_TASK and (
            document.get("schema") != "chemdft.worker.tddft"
            or document.get("task") != AWS_TDDFT_TASK
        ):
            raise AwsProviderError(
                "AWS_BAD_RESULT", "result is not a PySCF closed-shell TDDFT result"
            )
        if task == AWS_ORBITAL_TASK and (
            document.get("schema") != "chemdft.worker.molecular-orbitals"
            or document.get("task") != AWS_ORBITAL_TASK
        ):
            raise AwsProviderError(
                "AWS_BAD_RESULT", "result is not a PySCF molecular-orbital result"
            )
        if task == AWS_THERMOCHEMISTRY_TASK and (
            document.get("schema") != "chemdft.worker.thermochemistry"
            or document.get("task") != AWS_THERMOCHEMISTRY_TASK
        ):
            raise AwsProviderError(
                "AWS_BAD_RESULT", "result is not a PySCF harmonic thermochemistry result"
            )
        if task == AWS_OPTIMIZATION_TASK and (
            document.get("schema") != "chemdft.worker.optimization"
            or document.get("task") != AWS_OPTIMIZATION_TASK
            or document.get("optimizer") != "geometric"
        ):
            raise AwsProviderError(
                "AWS_BAD_RESULT", "result is not a PySCF geomeTRIC optimization"
            )
