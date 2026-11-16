"""Proposal capabilities, not permission to execute or open a compute session."""

import subprocess
import time
from functools import lru_cache
from pathlib import Path

from ..aws_compute import AwsEc2ComputeProvider
from ..config import Settings
from ..contracts.scientific import CalculationTaskType
from ..scientific.engines.registry import (
    CAPABILITIES,
    GEOMETRIC_VERSION,
    _probe_python,
    configured_path,
)
from .facts import Capabilities


@lru_cache(maxsize=8)
def _observe(path: str, _time_bucket: int) -> Capabilities:
    state, _version, _diagnostic = _probe_python(Path(path))
    if state != "AVAILABLE":
        return Capabilities()
    optimizer = False
    try:
        probe = subprocess.run(
            [path, "-c", "import geometric; print(geometric.__version__)"],
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
        optimizer = probe.returncode == 0 and probe.stdout.strip() == GEOMETRIC_VERSION
    except (OSError, subprocess.TimeoutExpired):
        pass
    tasks = frozenset(task.value for task in CAPABILITIES["pyscf"].tasks)
    if not optimizer:
        tasks -= {CalculationTaskType.GEOMETRY_OPTIMIZATION.value}
    return Capabilities(tasks, optimizer)


def aws_proposals_available(settings: Settings, provider_preference: str = "AUTO") -> bool:
    """Static AWS configuration only: no credentials, session read, guard or AWS request.

    Hosted queue admission and a fully configured dedicated provider can describe work
    before a session opens. Actual queueing/claim/execution retain their own gates.
    """
    if provider_preference != "CLOUD" and not (
        provider_preference == "AUTO" and settings.compute_default_provider == "aws"
    ):
        return False
    if not settings.compute_aws_enabled:
        return False
    provider = AwsEc2ComputeProvider(settings)
    return provider.can_queue() or not provider.missing_configuration()


def observe(settings: Settings, *, provider_preference: str = "AUTO") -> Capabilities:
    aws = aws_proposals_available(settings, provider_preference)
    # CLOUD never falls back to local. AUTO retains the existing local fallback for
    # tasks outside the AWS provider's single-point ENERGY scope.
    local = (
        settings.compute_local_enabled
        and provider_preference != "CLOUD"
        and (
            provider_preference == "LOCAL" or settings.compute_default_provider in {"local", "aws"}
        )
    )
    observed = (
        _observe(
            str(configured_path(settings.scientific_worker_python)), int(time.monotonic() // 60)
        )
        if local
        else Capabilities()
    )
    if aws:
        # AI proposals stay ENERGY-only on the hosted path until optimization is accepted on AWS.
        return Capabilities(observed.tasks | {CalculationTaskType.ENERGY.value}, observed.optimizer)
    return observed
