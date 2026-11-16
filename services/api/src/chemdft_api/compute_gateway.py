from __future__ import annotations

import hashlib
import json
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Protocol
from uuid import UUID

from .aws_compute import AWS_PROVIDER, AwsEc2ComputeProvider
from .config import Settings
from .contracts.catalog import (
    ComputeEstimate,
    ComputeRequirement,
    IsolationClass,
    MoneyAmount,
    ReproducibilityClass,
    WorkloadReference,
)
from .errors import EngineUnavailable, UnsupportedCalculation
from .models import utc_now
from .scientific.engines.interfaces import ExecutionResult, LocalSubprocessRequest
from .scientific.engines.registry import (
    CAPABILITIES,
    _probe_python,
    _probe_xtb,
    configured_path,
)
from .scientific.engines.runner import LocalSubprocessRunner

LOCAL_PROVIDER = "local"
MODAL_PROVIDER = "modal"
WORKLOAD_PYSCF_ENERGY = WorkloadReference(
    workload_type="chemdft.pyscf.energy.v1", workload_version="1.0.0"
)
WORKLOAD_XTB_ENERGY = WorkloadReference(
    workload_type="chemdft.xtb.energy.v1", workload_version="1.0.0"
)
WORKLOAD_XTB_OPTIMIZATION = WorkloadReference(
    workload_type="chemdft.xtb.optimization.v1", workload_version="1.0.0"
)
WORKLOAD_PYSCF_OPTIMIZATION = WorkloadReference(
    workload_type="chemdft.pyscf.optimization.v1", workload_version="1.0.0"
)
WORKLOAD_PYSCF_FREQUENCY = WorkloadReference(
    workload_type="chemdft.pyscf.frequency.v1", workload_version="1.0.0"
)
WORKLOAD_PYSCF_ORBITAL = WorkloadReference(
    workload_type="chemdft.pyscf.orbital.v1", workload_version="1.0.0"
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
WORKLOAD_PYSCF_THERMOCHEMISTRY = WorkloadReference(
    workload_type="chemdft.pyscf.thermochemistry.v1", workload_version="1.0.0"
)
WORKLOAD_PSI4_ENERGY = WorkloadReference(
    workload_type="chemdft.psi4.energy.v1", workload_version="1.0.0"
)
ZERO_USD = MoneyAmount(currency="USD", minor_units=0)


WORKLOAD_CREST_SEARCH = WorkloadReference(
    workload_type="chemdft.crest.conformer-search.v1", workload_version="1.0.0"
)


class ComputeProviderUnavailable(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class ProviderCapability:
    provider: str
    availability: str
    summary: str
    supports_cpu: bool
    supports_gpu: bool
    diagnostic: str | None = None


@dataclass(frozen=True, slots=True)
class ExecutionAuthorization:
    token: str
    token_hash: str
    expires_at: datetime


class ComputeProvider(Protocol):
    provider: str

    def capabilities(self) -> ProviderCapability: ...

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
    ) -> ExecutionResult: ...


class LocalComputeProvider:
    provider = LOCAL_PROVIDER

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def capabilities(self) -> ProviderCapability:
        interpreter = configured_path(self._settings.scientific_worker_python)
        if interpreter.is_file():
            return ProviderCapability(
                provider=self.provider,
                availability="AVAILABLE",
                summary="Local isolated PySCF subprocess",
                supports_cpu=True,
                supports_gpu=False,
            )
        return ProviderCapability(
            provider=self.provider,
            availability="UNAVAILABLE",
            summary="Local isolated PySCF subprocess",
            supports_cpu=True,
            supports_gpu=False,
            diagnostic="Configured scientific worker Python is not installed.",
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
        input_data = json.loads(normalized_input) if normalized_input else {}
        if str(input_data.get("task", "")).upper() == "PERIODIC_ENERGY":
            # Execution-time memory cap from Settings; kept out of the hashed normalized input.
            input_data["max_memory_mb"] = int(self._settings.aws_periodic_max_memory_mb)
            normalized_input = json.dumps(input_data, sort_keys=True).encode()

        # 1. Resolve explicit engine identity without method-name heuristics
        resolved_engine = (engine or "").strip().lower() or None
        if not resolved_engine and workload is not None:
            workload_type = getattr(workload, "workload_type", "") or ""
            if workload_type.startswith("chemdft.xtb."):
                resolved_engine = "xtb"
            elif workload_type == "chemdft.crest.conformer-search.v1":
                resolved_engine = "crest"
            elif workload_type == "chemdft.dftd4.correction.v1":
                resolved_engine = "dftd4"
            elif workload_type == "chemdft.psi4.energy.v1":
                resolved_engine = "psi4"
            elif workload_type.startswith("chemdft.pyscf."):
                resolved_engine = "pyscf"
            elif workload_type == WORKLOAD_QE_PERIODIC_ENERGY.workload_type:
                resolved_engine = "qe"
            else:
                raise UnsupportedCalculation(f"Unsupported workload type: '{workload_type}'.")

        input_engine = str(input_data.get("engine", "")).strip().lower() or None

        # Guard against forged or mismatched engine in normalized input
        if resolved_engine and input_engine and input_engine != resolved_engine:
            raise UnsupportedCalculation(
                f"Engine mismatch between authorized specification ('{resolved_engine}') "
                f"and normalized input ('{input_engine}')."
            )

        if not resolved_engine and input_engine:
            resolved_engine = input_engine

        # Fail closed on missing/ambiguous engine identity
        if not resolved_engine:
            raise UnsupportedCalculation(
                "Explicit engine identity is required; ambiguous calculation requests fail closed."
            )

        if resolved_engine == "qe":
            return self._execute_qe(
                input_data,
                calculation_id=calculation_id,
                workload=workload,
                allowed_version=allowed_version,
                on_step=on_step,
                on_tick=on_tick,
            )

        if resolved_engine == "dftd4":
            from .scientific.engines.dftd4 import execute_native
            if (
                workload is None
                or workload.workload_type != "chemdft.dftd4.correction.v1"
                or workload.workload_version != "1.0.0"
                or not execution_id
                or not attempt_number
                or allowed_version != "4.2.0"
                or self._settings.dftd4_executable is None
            ):
                raise EngineUnavailable("Authorized pinned DFT-D4 workload is required.")
            return execute_native(
                input_data,
                configured_path(self._settings.dftd4_executable),
                self._settings,
                calculation_id=calculation_id,
                execution_id=execution_id,
                attempt_number=attempt_number,
                on_tick=on_tick,
            )

        if resolved_engine == "psi4":
            from .scientific.engines.psi4 import execute_native, validate_input

            validate_input(input_data)
            if workload != WORKLOAD_PSI4_ENERGY or not execution_id or not attempt_number:
                raise UnsupportedCalculation(
                    "Psi4 requires an authorized workload/execution/attempt."
                )
            if allowed_version not in (None, "1.11") or self._settings.psi4_executable is None:
                raise EngineUnavailable("Accepted Psi4 1.11 CLI is not configured.")
            return execute_native(
                input_data,
                configured_path(self._settings.psi4_executable),
                self._settings,
                calculation_id=calculation_id,
                execution_id=execution_id,
                attempt_number=attempt_number,
                on_tick=on_tick,
            )

        if resolved_engine == "crest":
            from .scientific.engines.crest import execute_native, validate_input
            from .scientific.engines.interfaces import ExecutionResult

            try:
                validate_input(input_data)
                if workload is not None and workload != WORKLOAD_CREST_SEARCH:
                    raise ValueError("CREST workload does not match its authorized task")
                if allowed_version and allowed_version != input_data["engine_version"]:
                    raise ValueError("CREST version constraint mismatch")
                if self._settings.crest_executable is None:
                    raise ValueError("CREST executable is not configured")
                return execute_native(
                    input_data,
                    configured_path(self._settings.crest_executable),
                    self._settings,
                    calculation_id=calculation_id,
                    on_tick=on_tick,
                )
            except (ValueError, OSError, KeyError) as error:
                return ExecutionResult(
                    exit_code=1,
                    timed_out=False,
                    stdout=b"",
                    stderr=str(error).encode(),
                    engine_log=b"",
                    result_document=None,
                )

        # 2. Validate engine capability exists in registry
        capability = CAPABILITIES.get(resolved_engine)
        if capability is None or resolved_engine not in ("xtb", "pyscf"):
            raise UnsupportedCalculation(f"Unsupported calculation engine: '{resolved_engine}'.")

        # 3. Validate method, task, and basis consistency
        method = str(input_data.get("method", "")).strip().lower()
        task = str(input_data.get("task", "")).strip().upper()
        basis = input_data.get("basis")

        if resolved_engine == "xtb":
            if task and task not in ("ENERGY", "GEOMETRY_OPTIMIZATION"):
                raise UnsupportedCalculation(f"Task '{task}' is unsupported by xTB engine adapter.")
            if method and method not in capability.methods:
                raise UnsupportedCalculation(
                    f"Method '{method}' is unsupported by xTB engine adapter (expected GFN2)."
                )
            if basis is not None:
                raise UnsupportedCalculation("xTB does not support Gaussian basis sets.")
        elif resolved_engine == "pyscf":
            if method and method == "gfn2":
                raise UnsupportedCalculation(
                    "Method 'gfn2' is unsupported by PySCF engine adapter."
                )
            if method and method not in capability.methods:
                raise UnsupportedCalculation(
                    f"Method '{method}' is unsupported by PySCF engine adapter."
                )

        # 4. Validate exact engine version constraints
        if resolved_engine == "xtb":
            state, version, diagnostic = _probe_xtb(self._settings.xtb_executable)
            if state != "AVAILABLE" or not version:
                raise EngineUnavailable(f"Configured xTB executable is unavailable: {diagnostic}")
            req_version = allowed_version or input_data.get("engine_version")
            if req_version and req_version != version:
                raise UnsupportedCalculation(
                    f"Installed xTB version '{version}' violates "
                    f"requested constraint '{req_version}'."
                )
        elif resolved_engine == "pyscf":
            state, version, diagnostic = _probe_python(
                configured_path(self._settings.scientific_worker_python)
            )
            if state != "AVAILABLE" or not version:
                raise EngineUnavailable(f"Configured PySCF worker is unavailable: {diagnostic}")
            req_version = allowed_version or input_data.get("engine_version")
            if req_version and req_version != version:
                raise UnsupportedCalculation(
                    f"Installed PySCF version '{version}' violates "
                    f"requested constraint '{req_version}'."
                )

        # 5. Dispatch to verified isolated worker
        if resolved_engine == "xtb":
            worker_script = Path(__file__).parent / "scientific" / "engines" / "xtb_worker.py"
            xtb_exec = (
                configured_path(self._settings.xtb_executable)
                if self._settings.xtb_executable
                else None
            )
            extra_args = ()
            if xtb_exec and xtb_exec.is_file():
                extra_args = ("--xtb-executable", str(xtb_exec.resolve()))
            result = LocalSubprocessRunner().execute(
                LocalSubprocessRequest(
                    calculation_id=calculation_id,
                    normalized_input=normalized_input,
                    interpreter=configured_path(self._settings.scientific_worker_python),
                    worker_script=worker_script.resolve(),
                    timeout_seconds=self._settings.scientific_execution_timeout_seconds,
                    max_output_bytes=self._settings.scientific_max_output_bytes,
                    threads=self._settings.scientific_threads,
                    max_scratch_bytes=self._settings.compute_local_temporary_storage_bytes,
                    extra_args=extra_args,
                ),
                on_step=on_step,
                on_tick=on_tick,
                tick_interval_seconds=self._tick_interval_seconds(),
            )
        else:
            task = str(input_data.get("task", "")).upper()
            if task == "PERIODIC_ENERGY":
                worker_script = (
                    Path(__file__).parent / "scientific" / "engines" / "pyscf_periodic_worker.py"
                )
                timeout_seconds = self._settings.aws_periodic_timeout_seconds
                max_scratch_bytes = self._settings.aws_periodic_max_scratch_bytes
            else:
                worker_script = Path(__file__).parent / "scientific" / "engines" / "pyscf_worker.py"
                timeout_seconds = self._settings.scientific_execution_timeout_seconds
                max_scratch_bytes = self._settings.compute_local_temporary_storage_bytes
            result = LocalSubprocessRunner().execute(
                LocalSubprocessRequest(
                    calculation_id=calculation_id,
                    normalized_input=normalized_input,
                    interpreter=configured_path(self._settings.scientific_worker_python),
                    worker_script=worker_script.resolve(),
                    timeout_seconds=timeout_seconds,
                    max_output_bytes=self._settings.scientific_max_output_bytes,
                    threads=self._settings.scientific_threads,
                    max_scratch_bytes=max_scratch_bytes,
                ),
                on_step=on_step,
                on_tick=on_tick,
                tick_interval_seconds=self._tick_interval_seconds(),
            )

        # 6. Post-execution verification
        if result.exit_code == 0 and result.result_document:
            worker_engine = str(result.result_document.get("engine", "")).strip().lower()
            if worker_engine and worker_engine != resolved_engine:
                raise ValueError(
                    f"Executed engine '{worker_engine}' does not match "
                    f"requested engine '{resolved_engine}'."
                )
        return result

    def _execute_qe(
        self, input_data, *, calculation_id, workload, allowed_version, on_step, on_tick
    ) -> ExecutionResult:
        """Quantum ESPRESSO periodic job (separate QE programs started by the worker script)."""
        from .scientific.qe_periodic.qe_registry import probe_qe, qe_limits_from_settings

        task = str(input_data.get("task", "")).upper()
        if task != "PERIODIC_ENERGY":
            raise UnsupportedCalculation("Quantum ESPRESSO runs the periodic energy task only.")
        if workload is not None and workload != WORKLOAD_QE_PERIODIC_ENERGY:
            raise UnsupportedCalculation("Quantum ESPRESSO requires its own periodic workload.")
        state, version, diagnostic = probe_qe(self._settings)
        if state != "AVAILABLE":
            raise EngineUnavailable(f"Quantum ESPRESSO is unavailable: {diagnostic}")
        requested = allowed_version or input_data.get("engine_version")
        if requested and requested != version:
            raise UnsupportedCalculation(
                f"Installed Quantum ESPRESSO {version} violates the constraint '{requested}'."
            )
        limits = qe_limits_from_settings(self._settings)
        document = dict(input_data)
        # Execution-time settings, kept out of the hashed normalized input.
        document["qe_limits"] = {
            key: getattr(limits, key) for key in limits.__dataclass_fields__
        }
        document["qe_runtime"] = {
            "bin_dir": str(configured_path(self._settings.qe_bin_dir))
            if self._settings.qe_bin_dir
            else "",
            "pseudo_dir": str(configured_path(self._settings.qe_pseudo_dir))
            if self._settings.qe_pseudo_dir
            else "",
        }
        worker_script = (
            Path(__file__).parent / "scientific" / "qe_periodic" / "qe_periodic_worker.py"
        )
        result = LocalSubprocessRunner().execute(
            LocalSubprocessRequest(
                calculation_id=calculation_id,
                normalized_input=json.dumps(document, sort_keys=True).encode(),
                interpreter=configured_path(self._settings.scientific_worker_python),
                worker_script=worker_script.resolve(),
                timeout_seconds=limits.timeout_total_s,
                max_output_bytes=self._settings.scientific_max_output_bytes,
                threads=1,
                max_scratch_bytes=limits.max_scratch_bytes,
            ),
            on_step=on_step,
            on_tick=on_tick,
            tick_interval_seconds=self._tick_interval_seconds(),
        )
        if result.exit_code == 0 and result.result_document:
            if str(result.result_document.get("engine", "")).lower() != "qe":
                raise ValueError("Executed engine does not match the requested engine 'qe'.")
            if str(result.result_document.get("engine_version", "")) != str(version):
                raise ValueError(
                    "Quantum ESPRESSO reported a version that differs from the configured "
                    f"{version}; the result is not published."
                )
        return result

    def _tick_interval_seconds(self) -> float:
        # Several ticks fit inside one heartbeat window, so a single slow tick cannot lapse a lease.
        return max(1.0, self._settings.compute_heartbeat_seconds / 4)


class ModalComputeProvider:
    provider = MODAL_PROVIDER

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def capabilities(self) -> ProviderCapability:
        if not self._settings.compute_modal_enabled:
            return ProviderCapability(
                provider=self.provider,
                availability="UNAVAILABLE",
                summary="Modal CPU/GPU adapter seam",
                supports_cpu=True,
                supports_gpu=True,
                diagnostic="Modal execution is disabled; set server credentials/configuration.",
            )
        try:
            import modal  # noqa: F401
        except ModuleNotFoundError:
            return ProviderCapability(
                provider=self.provider,
                availability="MISCONFIGURED",
                summary="Modal CPU/GPU adapter seam",
                supports_cpu=True,
                supports_gpu=True,
                diagnostic="modal==1.5.5 is not installed in this API environment.",
            )
        return ProviderCapability(
            provider=self.provider,
            availability="AVAILABLE",
            summary="Modal serverless CPU/GPU function",
            supports_cpu=True,
            supports_gpu=True,
        )

    def execute(self, *, calculation_id: str, normalized_input: bytes) -> ExecutionResult:
        capability = self.capabilities()
        if capability.availability != "AVAILABLE":
            raise ComputeProviderUnavailable(capability.diagnostic or "Modal is unavailable.")
        raise ComputeProviderUnavailable(
            "Modal CPU execution is gated pending deployed function credentials."
        )


def provider_capabilities(settings: Settings) -> tuple[ProviderCapability, ...]:
    return (
        LocalComputeProvider(settings).capabilities(),
        ModalComputeProvider(settings).capabilities(),
        AwsEc2ComputeProvider(settings).capabilities(),
    )


def choose_provider(settings: Settings, preference: str) -> str:
    local_disabled = ComputeProviderUnavailable(
        "Local compute is disabled on this deployment; calculations run on the AWS compute pilot."
    )
    if preference == "LOCAL":
        if not settings.compute_local_enabled:
            raise local_disabled
        return LOCAL_PROVIDER
    if preference == "CLOUD" and AwsEc2ComputeProvider(settings).can_queue():
        return AWS_PROVIDER
    if preference == "CLOUD" and settings.compute_aws_enabled:
        # Explicit opt-in only. Unavailable (no approved session, misconfigured) is reported,
        # never silently replaced by a different provider.
        aws_capability = AwsEc2ComputeProvider(settings).capabilities()
        if aws_capability.availability == "AVAILABLE":
            return AWS_PROVIDER
        raise ComputeProviderUnavailable(aws_capability.diagnostic or "AWS compute is unavailable.")
    if preference == "CLOUD":
        modal_capability = ModalComputeProvider(settings).capabilities()
        if modal_capability.availability == "AVAILABLE":
            return MODAL_PROVIDER
        raise ComputeProviderUnavailable(
            modal_capability.diagnostic or "Cloud compute is unavailable."
        )
    aws_default = settings.compute_default_provider == AWS_PROVIDER
    if aws_default and AwsEc2ComputeProvider(settings).can_queue():
        return AWS_PROVIDER
    if aws_default and settings.compute_aws_enabled:
        if AwsEc2ComputeProvider(settings).capabilities().availability == "AVAILABLE":
            return AWS_PROVIDER
        # AUTO means "the platform chooses": with no open, owner-approved session the platform
        # keeps working locally (the job records the provider that actually ran it).
        if not settings.compute_local_enabled:
            raise ComputeProviderUnavailable(
                AwsEc2ComputeProvider(settings).capabilities().diagnostic
                or "AWS compute is unavailable."
            )
        return LOCAL_PROVIDER
    if settings.compute_default_provider == LOCAL_PROVIDER:
        if not settings.compute_local_enabled:
            raise local_disabled
        return LOCAL_PROVIDER
    return MODAL_PROVIDER


def default_requirement(settings: Settings, provider: str) -> ComputeRequirement:
    if provider == AWS_PROVIDER:
        # Mirrors the host workflow's container limits (1 CPU, 4 GiB, 512 MiB tmpfs).
        return ComputeRequirement(
            cpu_count=1,
            memory_bytes=4 * 1024 * 1024 * 1024,
            accelerator_count=0,
            temporary_storage_bytes=512 * 1024 * 1024,
            runtime_limit_seconds=settings.scientific_execution_timeout_seconds,
            isolation_class=IsolationClass.MANAGED_CONTAINER,
            reproducibility_class=ReproducibilityClass.PINNED_CONTAINER_IMAGE,
        )
    if provider == MODAL_PROVIDER:
        return ComputeRequirement(
            cpu_count=max(1, settings.scientific_threads),
            memory_bytes=settings.compute_local_memory_bytes,
            accelerator_count=0,
            temporary_storage_bytes=settings.compute_local_temporary_storage_bytes,
            runtime_limit_seconds=settings.scientific_execution_timeout_seconds,
            isolation_class=IsolationClass.MANAGED_CONTAINER,
            reproducibility_class=ReproducibilityClass.PINNED_CONTAINER_IMAGE,
        )
    return ComputeRequirement(
        cpu_count=max(1, settings.scientific_threads),
        memory_bytes=settings.compute_local_memory_bytes,
        accelerator_count=0,
        temporary_storage_bytes=settings.compute_local_temporary_storage_bytes,
        runtime_limit_seconds=settings.scientific_execution_timeout_seconds,
        isolation_class=IsolationClass.LOCAL_DEVELOPMENT,
        reproducibility_class=ReproducibilityClass.LOCAL_PINNED_ENVIRONMENT,
    )


def requirement_hash(requirement: ComputeRequirement) -> str:
    payload = json.dumps(requirement.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


def estimate_for_requirement(
    *,
    estimate_id: UUID,
    project_id: UUID,
    requirement: ComputeRequirement,
    provider: str,
) -> ComputeEstimate:
    now = utc_now()
    if provider == LOCAL_PROVIDER:
        return ComputeEstimate(
            id=estimate_id,
            project_id=project_id,
            requirement_hash=requirement_hash(requirement),
            provider="local",
            provider_summary="Local provider / no provider charge",
            runtime_low_seconds=1,
            runtime_high_seconds=requirement.runtime_limit_seconds,
            cost_low=ZERO_USD,
            cost_high=ZERO_USD,
            confidence="MEDIUM",
            assumptions=("Uses the configured local isolated scientific worker.",),
            valid_until=now + timedelta(minutes=15),
            created_at=now,
        )
    if provider == AWS_PROVIDER:
        return ComputeEstimate(
            id=estimate_id,
            project_id=project_id,
            requirement_hash=requirement_hash(requirement),
            provider="aws",
            provider_summary="AWS EC2 pilot / approved session; per-job cost not metered",
            runtime_low_seconds=None,
            runtime_high_seconds=requirement.runtime_limit_seconds,
            cost_low=None,
            cost_high=None,
            confidence="LOW",
            assumptions=(
                "EC2 time is billed per approved session, not per calculation.",
                "Actual AWS charges are UNKNOWN and are not attributed to this job.",
            ),
            valid_until=now + timedelta(minutes=15),
            created_at=now,
        )
    return ComputeEstimate(
        id=estimate_id,
        project_id=project_id,
        requirement_hash=requirement_hash(requirement),
        provider="modal",
        provider_summary="Modal CPU/GPU estimate unavailable until credentials are configured",
        runtime_low_seconds=None,
        runtime_high_seconds=None,
        cost_low=None,
        cost_high=None,
        confidence="LOW",
        assumptions=("Provider quote unavailable without configured Modal execution.",),
        valid_until=now + timedelta(minutes=15),
        created_at=now,
    )


def issue_execution_authorization(
    *, job_id: str, execution_id: str, input_hash: str, ttl_seconds: int
) -> ExecutionAuthorization:
    token = secrets.token_urlsafe(32)
    expires_at = utc_now() + timedelta(seconds=ttl_seconds)
    material = f"{job_id}:{execution_id}:{input_hash}:{token}:{expires_at.isoformat()}"
    return ExecutionAuthorization(
        token=token,
        token_hash=hashlib.sha256(material.encode()).hexdigest(),
        expires_at=expires_at,
    )


def lease_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
