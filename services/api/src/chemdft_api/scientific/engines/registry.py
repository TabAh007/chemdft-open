# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from ...config import Settings
from ...contracts.catalog import EngineCapabilityView
from ...contracts.scientific import CalculationSpecification, CalculationTaskType
from ...errors import EngineUnavailable, UnsupportedCalculation

PYSCF_METHODS = frozenset({"hf", "b3lyp", "pbe"})
PYSCF_BASES = frozenset({"sto-3g", "6-31g", "def2-svp", "def2-svpd"})
PYSCF_PERIODIC_METHODS = frozenset({"pbe", "pbe+u"})
PYSCF_PERIODIC_BASES = frozenset({"gth-dzvp-molopt-sr"})
XTB_METHODS = frozenset({"gfn2"})
GEOMETRIC_VERSION = "1.1.1"
# Highest atomic number for which the pinned PySCF 2.14.0 library ships the basis contiguously from
# hydrogen *and* no effective core potential is required. def2 bases need the def2-ECP for Z > 36;
# the adapter supplies none, so such inputs would run an ECP basis with all electrons and publish a
# meaningless energy. A scan test (test_pf8f_capability_conformance) ties this table to the library.
PYSCF_MAX_ATOMIC_NUMBER = {"sto-3g": 53, "6-31g": 30, "def2-svp": 36, "def2-svpd": 36}
# Elements covered by the GTH-DZVP-MOLOPT-SR basis and GTH-PBE pseudopotential in PySCF 2.14.0:
# Z=1-56 (H-Ba) and Z=72-86 (Hf-Rn); lanthanides and actinides are not covered.
PYSCF_PERIODIC_COVERED_ATOMIC_NUMBERS = frozenset(range(1, 57)) | frozenset(range(72, 87))

# Authoritative scientific metadata catalog. display_name and registry are NEVER taken from
# AI-supplied arguments; they are always resolved server-side from the identifier. This
# prevents the model from controlling how methods/basis sets are labelled or namespaced.
SCIENTIFIC_METHOD_CATALOG: dict[str, dict[str, str]] = {
    "hf": {"display_name": "Hartree-Fock", "registry": "chemdft.method"},
    "b3lyp": {"display_name": "B3LYP", "registry": "chemdft.method"},
    "pbe": {"display_name": "PBE", "registry": "chemdft.method"},
    "pbe+u": {"display_name": "PBE+U", "registry": "chemdft.method"},
    "gfn2": {"display_name": "GFN2-xTB", "registry": "chemdft.method"},
    "mp2": {"display_name": "MP2", "registry": "chemdft.method"},
}

SCIENTIFIC_BASIS_CATALOG: dict[str, dict[str, str]] = {
    "sto-3g": {"display_name": "STO-3G", "registry": "chemdft.basis"},
    "6-31g": {"display_name": "6-31G", "registry": "chemdft.basis"},
    "def2-svp": {"display_name": "def2-SVP", "registry": "chemdft.basis"},
    "def2-svpd": {"display_name": "def2-SVPD", "registry": "chemdft.basis"},
    "gth-dzvp-molopt-sr": {"display_name": "GTH-DZVP-MOLOPT-SR", "registry": "chemdft.basis"},
    "pw-sssp-pbe-eff-v2": {
        "display_name": "Plane waves, SSSP PBE Efficiency v2.0",
        "registry": "chemdft.basis",
    },
}


def authoritative_method(identifier: str) -> dict[str, str] | None:
    """Return the server-authoritative method metadata for an identifier, or None."""
    return SCIENTIFIC_METHOD_CATALOG.get(str(identifier).lower())


def authoritative_basis(identifier: str) -> dict[str, str] | None:
    """Return the server-authoritative basis metadata for an identifier, or None."""
    return SCIENTIFIC_BASIS_CATALOG.get(str(identifier).lower())


@dataclass(frozen=True, slots=True)
class EngineCapability:
    engine: str
    tasks: frozenset[CalculationTaskType]
    methods: frozenset[str]
    basis_sets: frozenset[str]


CAPABILITIES = {
    "pyscf": EngineCapability(
        engine="pyscf",
        tasks=frozenset(
            {
                CalculationTaskType.ENERGY,
                CalculationTaskType.PERIODIC_ENERGY,
                CalculationTaskType.GEOMETRY_OPTIMIZATION,
                CalculationTaskType.FREQUENCY,
                CalculationTaskType.ORBITAL,
                CalculationTaskType.TDDFT,
                CalculationTaskType.THERMOCHEMISTRY,
            }
        ),
        methods=PYSCF_METHODS,
        basis_sets=PYSCF_BASES,
    ),
    "qe": EngineCapability(
        engine="qe",
        tasks=frozenset({CalculationTaskType.PERIODIC_ENERGY}),
        methods=PYSCF_PERIODIC_METHODS,
        basis_sets=frozenset({"pw-sssp-pbe-eff-v2"}),
    ),
    "xtb": EngineCapability(
        engine="xtb",
        tasks=frozenset({CalculationTaskType.ENERGY, CalculationTaskType.GEOMETRY_OPTIMIZATION}),
        methods=XTB_METHODS,
        basis_sets=frozenset(),
    ),
    "crest": EngineCapability(
        "crest", frozenset({CalculationTaskType.CONFORMER_SEARCH}), XTB_METHODS, frozenset()
    ),
    "psi4": EngineCapability(
        "psi4",
        frozenset({CalculationTaskType.ENERGY}),
        frozenset({"hf", "b3lyp", "pbe", "mp2"}),
        frozenset({"sto-3g", "def2-svp"}),
    ),
}


def _probe_python(path: Path) -> tuple[str, str | None, str | None]:
    if not path.is_file():
        return "UNAVAILABLE", None, "Configured isolated worker is not installed."
    try:
        completed = subprocess.run(
            [str(path), "-c", "import pyscf; print(pyscf.__version__)"],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired):
        return "MISCONFIGURED", None, "Configured worker could not be inspected."
    if completed.returncode != 0:
        return "MISCONFIGURED", None, "Configured worker cannot import pinned PySCF."
    return "AVAILABLE", completed.stdout.strip(), None


def _probe_xtb(path: Path | None) -> tuple[str, str | None, str | None]:
    if path is None:
        return "UNAVAILABLE", None, "No server-controlled executable is configured."
    resolved = configured_path(path)
    if not resolved.is_file():
        return "UNAVAILABLE", None, "Configured xTB executable does not exist."
    try:
        completed = subprocess.run(
            [str(resolved), "--version"],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return "MISCONFIGURED", None, "Configured xTB executable could not be inspected."
    if completed.returncode != 0:
        return "MISCONFIGURED", None, "Configured xTB executable returned non-zero on --version."
    match = re.search(r"xtb\s+version\s+([0-9]+\.[0-9]+\.[0-9]+)", completed.stdout)
    if not match:
        return (
            "MISCONFIGURED",
            None,
            "Configured xTB output did not contain a valid version string.",
        )
    return "AVAILABLE", match.group(1), None


def validate_pyscf_elements(basis: str, atomic_numbers) -> None:
    """Reject element/basis combinations the adapter cannot run correctly, before queueing."""
    limit = PYSCF_MAX_ATOMIC_NUMBER.get(basis.lower())
    if limit is None:
        supported_bases = ", ".join(sorted(PYSCF_MAX_ATOMIC_NUMBER.keys()))
        raise UnsupportedCalculation(
            f"A supported explicit basis set is required. Basis '{basis}' is unsupported by PySCF. "
            f"Supported basis sets: {supported_bases}."
        )
    unsupported = sorted({int(z) for z in atomic_numbers if int(z) > limit})
    if unsupported:
        raise UnsupportedCalculation(
            f"Basis {basis.lower()} is supported only through atomic number {limit}; "
            f"elements {unsupported} would need an effective core potential or are not "
            "available in the pinned PySCF library."
        )


def validate_pyscf_periodic_elements(atomic_numbers_or_symbols) -> None:
    """Reject elements not covered by the GTH-DZVP-MOLOPT-SR basis and GTH-PBE pseudopotential."""
    from ..structures import atomic_number_for_symbol  # the project's single element table

    resolved_z: list[int] = []
    for item in atomic_numbers_or_symbols:
        if isinstance(item, int) or (isinstance(item, str) and item.isdigit()):
            resolved_z.append(int(item))
        elif isinstance(item, str):
            try:
                resolved_z.append(atomic_number_for_symbol(item.strip().capitalize()))
            except Exception as error:
                raise UnsupportedCalculation(
                    f"Element '{item}' is unrecognized or not covered by the periodic GTH-DZVP-MOLOPT-SR basis."
                ) from error
    unsupported = sorted(
        {z for z in resolved_z if z not in PYSCF_PERIODIC_COVERED_ATOMIC_NUMBERS}
    )
    if unsupported:
        raise UnsupportedCalculation(
            "Periodic DFT with GTH-DZVP-MOLOPT-SR and GTH-PBE pseudopotential supports "
            f"elements Z=1-56 (H-Ba) and Z=72-86 (Hf-Rn). "
            f"Atomic numbers {unsupported} are not supported."
        )


def configured_path(path: Path) -> Path:
    """Make a configured path absolute without dereferencing a virtualenv symlink."""
    if path.is_absolute():
        return path
    candidate = Path.cwd() / path
    if candidate.exists():
        return candidate
    for parent in Path(__file__).resolve().parents:
        if (parent / path).exists():
            return parent / path
    return candidate


def _hosted_aws_xtb(settings: Settings) -> bool:
    """Hosted backend: xTB is not installed here; its energy comes from the pinned AWS image."""
    return _hosted_aws_pyscf(settings)


def _hosted_aws_crest(settings: Settings) -> bool:
    """Hosted backend: CREST runs from the pinned AWS image, and only once its Linux binary digest
    has been recorded for this deployment (otherwise it stays unavailable)."""
    return _hosted_aws_pyscf(settings) and bool(settings.aws_crest_binary_sha256)


HOSTED_GEOMETRIC_REFUSAL = (
    "PySCF geometry optimisation is not available in the hosted version: it needs geomeTRIC, whose licence "
    "forbids use in AI-training datasets, so the hosted compute image does not include it. Single-point energy, "
    "frequency and thermochemistry tasks, and xTB (ANCopt) optimisation, are unaffected. To optimise with PySCF, "
    "run ChemDFT yourself; see docs/SELF_HOSTING.md (Self-hosting)."
)


def hosted_geometric_unavailable(settings: Settings) -> bool:
    """Hosted backend (no local engine) whose compute image does not carry geomeTRIC."""
    return not settings.compute_local_enabled and not settings.compute_aws_geometric_available


def _hosted_aws_pyscf(settings: Settings) -> bool:
    """Hosted backend: no engine runs in this process; PySCF energy comes from the pinned AWS image."""
    if settings.compute_local_enabled or not settings.compute_aws_enabled:
        return False
    from ...aws_compute import AwsEc2ComputeProvider

    return AwsEc2ComputeProvider(settings).can_queue()


def capability_views(settings: Settings) -> tuple[EngineCapabilityView, ...]:
    hosted_pyscf = _hosted_aws_pyscf(settings)
    hosted_xtb = _hosted_aws_xtb(settings)
    if hosted_pyscf:
        # Same rule as validate_capability: the pinned compute image defines the version and the
        # provider re-verifies it against the engine's own result before anything is published.
        pyscf_state, pyscf_version, pyscf_diagnostic = "AVAILABLE", settings.aws_pyscf_version, None
    else:
        pyscf_state, pyscf_version, pyscf_diagnostic = _probe_python(
            configured_path(settings.scientific_worker_python)
        )
    configured = {
        "pyscf": (pyscf_state, pyscf_version, pyscf_diagnostic),
        "xtb": ("AVAILABLE", settings.aws_xtb_version, None)
        if hosted_xtb
        else _probe_xtb(settings.xtb_executable),
        "crest": ("AVAILABLE", _crest_version(), None)
        if _hosted_aws_crest(settings)
        else _probe_crest(settings.crest_executable),
        "psi4": _probe_psi4(settings.psi4_executable),
        "qe": _probe_qe(settings),
    }
    # An engine that is not verifiably AVAILABLE advertises nothing: clients that read the
    # supported lists without also checking availability must never offer an unusable engine.
    return tuple(
        EngineCapabilityView(
            engine=name,
            availability=state,
            version=version,
            supported_tasks=tuple(
                sorted(
                    task.value
                    for task in CAPABILITIES[name].tasks
                    if state == "AVAILABLE"
                    if not (
                        name == "pyscf"
                        and task == CalculationTaskType.GEOMETRY_OPTIMIZATION
                        and hosted_geometric_unavailable(settings)
                    )  # geomeTRIC is not in the hosted image: do not advertise PySCF optimisation
                    if not (
                        hosted_pyscf
                        and name == "pyscf"
                        and task
                        not in (
                            CalculationTaskType.ENERGY,
                            CalculationTaskType.GEOMETRY_OPTIMIZATION,
                            CalculationTaskType.FREQUENCY,
                            CalculationTaskType.THERMOCHEMISTRY,
                            CalculationTaskType.ORBITAL,
                            CalculationTaskType.TDDFT,
                        )
                    )  # only these PySCF tasks have an AWS path
                    if not (
                        hosted_xtb
                        and name == "xtb"
                        and task
                        not in (CalculationTaskType.ENERGY, CalculationTaskType.GEOMETRY_OPTIMIZATION)
                    )  # only xTB energy and optimization have an AWS path
                    if not (
                        name == "xtb"
                        and version != "6.7.1"
                        and task == CalculationTaskType.GEOMETRY_OPTIMIZATION
                    )
                )
            ),
            supported_methods=tuple(sorted(CAPABILITIES[name].methods))
            if state == "AVAILABLE"
            else (),
            supported_basis_sets=tuple(sorted(CAPABILITIES[name].basis_sets))
            if state == "AVAILABLE"
            else (),
            supported_method_basis_pairs=_psi4_pairs()
            if name == "psi4" and state == "AVAILABLE"
            else (),
            supported_optimizers=("xtb-ancopt",)
            if name == "xtb" and version == "6.7.1" and state == "AVAILABLE"
            else ("geometric",)
            if name == "pyscf" and state == "AVAILABLE" and not hosted_geometric_unavailable(settings)
            else (),
            supported_optimization_levels=("normal",)
            if name == "xtb" and version == "6.7.1" and state == "AVAILABLE"
            else (),
            max_atomic_number_by_basis=dict(PYSCF_MAX_ATOMIC_NUMBER)
            if name == "pyscf" and state == "AVAILABLE"
            else {},
            diagnostic=diagnostic,
        )
        for name, (state, version, diagnostic) in configured.items()
    )


def _probe_qe(settings: Settings) -> tuple[str, str | None, str | None]:
    from ..qe_periodic.qe_registry import probe_qe

    return probe_qe(settings)


def _crest_version() -> str:
    from .crest import VERSION

    return VERSION


def _probe_crest(path: Path | None) -> tuple[str, str | None, str | None]:
    import hashlib

    from .crest import BINARY_SHA256, VERSION

    if path is None or not configured_path(path).is_file():
        return "UNAVAILABLE", None, "Accepted isolated CREST build is not installed."
    resolved = configured_path(path)
    with resolved.open("rb") as source:
        actual = hashlib.file_digest(source, "sha256").hexdigest()
    if actual != BINARY_SHA256:
        return "MISCONFIGURED", None, "CREST digest differs from the accepted patched build."
    try:
        probe = subprocess.run(
            [str(resolved), "--version"], capture_output=True, text=True, timeout=10
        )
        if probe.returncode or "crest 3.0.2" not in probe.stdout:
            return "MISCONFIGURED", None, "Accepted CREST executable did not identify itself."
    except (OSError, subprocess.TimeoutExpired):
        return "MISCONFIGURED", None, "Accepted CREST executable cannot run on this host."
    return (
        "AVAILABLE",
        VERSION,
        "Local EWIN correction; embedded tblite 0.3.0-fork; neutral singlet H/C/O only.",
    )


def _psi4_pairs() -> tuple[dict[str, str], ...]:
    from .psi4 import PAIRS

    return tuple({"method": method, "basis": basis} for method, basis in sorted(PAIRS))


def _probe_psi4(path: Path | None) -> tuple[str, str | None, str | None]:
    if path is None:
        return "UNAVAILABLE", None, "No accepted native Psi4 CLI is configured."
    from .psi4 import environment_identity

    try:
        environment_identity(configured_path(path))
    except (OSError, ValueError) as error:
        return "MISCONFIGURED", None, str(error)
    return (
        "AVAILABLE",
        "1.11",
        (
            "ENERGY only: RHF/STO-3G, RHF/def2-SVP, B3LYP/def2-SVP, PBE/def2-SVP, "
            "conventional all-electron RHF-MP2/def2-SVP; neutral H/C/O singlets; fixed presets."
        ),
    )


def validate_capability(specification: CalculationSpecification, settings: Settings) -> None:
    engine = specification.engine_preference.engine
    if specification.conformer_search is not None and (
        engine != "crest" or specification.task_type != CalculationTaskType.CONFORMER_SEARCH
    ):
        raise UnsupportedCalculation("Conformer search settings require the CREST search task.")
    if engine == "crest":
        from .crest import VERSION

        if _hosted_aws_crest(settings):
            state = "AVAILABLE"
        else:
            state, _version, _ = _probe_crest(settings.crest_executable)
        if state != "AVAILABLE":
            raise EngineUnavailable("Accepted patched CREST build is unavailable.")
        if specification.engine_preference.allowed_version not in (None, VERSION):
            raise UnsupportedCalculation("CREST requires the explicitly patched build identity.")
        if (
            specification.task_type != CalculationTaskType.CONFORMER_SEARCH
            or specification.method.identifier.lower() != "gfn2"
            or specification.conformer_search is None
        ):
            raise UnsupportedCalculation(
                "CREST requires GFN2 and explicit conformer-search settings."
            )
        if specification.charge != 0 or specification.multiplicity != 1:
            raise UnsupportedCalculation(
                "CREST currently supports validated neutral singlets only."
            )
        if any(
            (
                specification.basis,
                specification.dispersion,
                specification.solvation,
                specification.constraints,
                specification.scf,
                specification.optimization,
                specification.hessian,
                specification.tddft,
                specification.raman,
                specification.thermochemistry,
                specification.property_requests,
                specification.engine_extensions,
            )
        ):
            raise UnsupportedCalculation("Unvalidated CREST options are not enabled.")
        return
    if engine == "psi4":
        from .psi4 import validate_specification

        try:
            validate_specification(specification)
        except ValueError as error:
            raise UnsupportedCalculation(str(error)) from error
        state, _version, diagnostic = _probe_psi4(settings.psi4_executable)
        if state != "AVAILABLE":
            raise EngineUnavailable(diagnostic)
        return
    if engine == "qe":
        from ..qe_periodic.qe_registry import validate_qe_specification

        validate_qe_specification(specification, settings)
        return
    capability = CAPABILITIES.get(engine)
    if capability is None:
        raise UnsupportedCalculation("Unknown engine preference.")
    if engine == "xtb":
        if not settings.compute_local_enabled and settings.compute_aws_enabled:
            # Hosted backend (same rule as PySCF below): the pinned image defines the xTB version and the provider
            # re-verifies it against the engine's own result before anything is published.
            state, version, _diagnostic = "AVAILABLE", settings.aws_xtb_version, None
        else:
            state, version, _diagnostic = _probe_xtb(settings.xtb_executable)
        if state != "AVAILABLE":
            raise EngineUnavailable("Configured xTB executable is unavailable.")
        allowed = specification.engine_preference.allowed_version
        if allowed and allowed != version:
            raise UnsupportedCalculation(
                "Installed engine version violates the requested constraint."
            )
        if specification.task_type not in capability.tasks:
            supported_tasks = ", ".join(sorted(t.value for t in capability.tasks))
            raise UnsupportedCalculation(
                f"Task is unsupported by the selected engine adapter ({engine}). "
                f"Supported tasks: {supported_tasks}."
            )
        method = specification.method.identifier.lower()
        if method not in capability.methods:
            supported_methods = ", ".join(sorted(capability.methods))
            raise UnsupportedCalculation(
                f"Method is unsupported by the selected engine adapter ({engine}). "
                f"Supported methods: {supported_methods}."
            )
        if specification.basis is not None:
            raise UnsupportedCalculation("xTB does not support Gaussian basis sets.")
        if specification.dispersion is not None:
            raise UnsupportedCalculation(
                "GFN2 has built-in dispersion; separate dispersion model is not supported."
            )
        if specification.solvation is not None:
            raise UnsupportedCalculation("Solvation is not enabled and cannot be silently ignored.")
        if specification.constraints:
            raise UnsupportedCalculation("Constraints are not supported by this adapter.")
        if specification.task_type is CalculationTaskType.GEOMETRY_OPTIMIZATION:
            options = specification.optimization
            if (
                version != "6.7.1"
                or options is None
                or options.optimizer != "xtb-ancopt"
                or options.xtb_level != "normal"
            ):
                raise UnsupportedCalculation(
                    "Native optimization requires xTB 6.7.1 and explicit ANCopt normal settings."
                )
            if (
                any(
                    value is not None
                    for key, value in options.model_dump().items()
                    if key.startswith("convergence_")
                )
                or specification.scf is not None
            ):
                raise UnsupportedCalculation(
                    "Native optimization does not support geomeTRIC or SCF threshold overrides."
                )
        elif specification.optimization is not None:
            raise UnsupportedCalculation("Optimization settings require geometry optimization.")
        if specification.hessian is not None:
            raise UnsupportedCalculation("Hessian settings require frequency analysis.")
        if specification.tddft is not None:
            raise UnsupportedCalculation("TDDFT is not supported by xTB.")
        if specification.raman is not None:
            raise UnsupportedCalculation("Raman is not supported by xTB.")
        if specification.thermochemistry is not None:
            raise UnsupportedCalculation("Thermochemistry is not supported by xTB.")
        if specification.property_requests or specification.engine_extensions:
            raise UnsupportedCalculation("Unsupported properties or engine extensions.")
        if specification.scf and specification.scf.reference is not None:
            raise UnsupportedCalculation("Explicit SCF reference is not supported by this adapter.")
        return
    if engine != "pyscf":
        raise EngineUnavailable(f"{engine} authoritative execution is not enabled in Phase 5.")
    if settings.compute_local_enabled:
        state, version, _diagnostic = _probe_python(
            configured_path(settings.scientific_worker_python)
        )
    else:
        # Hosted backend: no engine runs here. The pinned compute image defines the version, and
        # the provider re-verifies it against the engine's own result before anything is published.
        state, version = "AVAILABLE", settings.aws_pyscf_version
    if state != "AVAILABLE":
        raise EngineUnavailable()
    allowed = specification.engine_preference.allowed_version
    if allowed and allowed != version:
        raise UnsupportedCalculation("Installed engine version violates the requested constraint.")

    if specification.task_type not in capability.tasks:
        supported_tasks = ", ".join(sorted(t.value for t in capability.tasks))
        raise UnsupportedCalculation(
            f"Task is unsupported by the selected engine adapter ({engine}). "
            f"Supported tasks: {supported_tasks}."
        )
    method = specification.method.identifier.lower()
    if specification.task_type is CalculationTaskType.PERIODIC_ENERGY:
        if method not in PYSCF_PERIODIC_METHODS:
            supported_methods = ", ".join(sorted(PYSCF_PERIODIC_METHODS))
            raise UnsupportedCalculation(
                f"Method is unsupported for periodic calculations ({engine}). "
                f"Supported methods: {supported_methods}."
            )
        if (
            specification.basis is None
            or specification.basis.identifier.lower() not in PYSCF_PERIODIC_BASES
        ):
            basis_id = specification.basis.identifier if specification.basis else "none"
            supported_bases = ", ".join(sorted(PYSCF_PERIODIC_BASES))
            raise UnsupportedCalculation(
                f"A supported explicit basis set is required. Basis '{basis_id}' is unsupported by engine '{engine}'. "
                f"Supported basis sets: {supported_bases}."
            )
        if any(
            (
                specification.optimization,
                specification.hessian,
                specification.tddft,
                specification.raman,
                specification.thermochemistry,
                specification.conformer_search,
            )
        ):
            raise UnsupportedCalculation(
                "Molecular options (geometry optimization, frequencies, TDDFT, Raman, thermochemistry, "
                "conformer search) do not apply to periodic calculations; only a single-point periodic energy is supported."
            )
        periodic = specification.periodic
        if periodic is not None and (periodic.relax or periodic.dos or periodic.bands):
            raise UnsupportedCalculation(
                "Atom relaxation, density of states and band structure need the Quantum ESPRESSO plane-wave "
                "engine; the PySCF periodic engine runs a single-point energy only."
            )
    else:
        if method not in capability.methods:
            supported_methods = ", ".join(sorted(capability.methods))
            raise UnsupportedCalculation(
                f"Method is unsupported by the selected engine adapter ({engine}). "
                f"Supported methods: {supported_methods}."
            )
        if (
            specification.basis is None
            or specification.basis.identifier.lower() not in capability.basis_sets
        ):
            basis_id = specification.basis.identifier if specification.basis else "none"
            supported_bases = ", ".join(sorted(capability.basis_sets))
            raise UnsupportedCalculation(
                f"A supported explicit basis set is required. Basis '{basis_id}' is unsupported by engine '{engine}'. "
                f"Supported basis sets: {supported_bases}."
            )
    if specification.dispersion is not None:
        raise UnsupportedCalculation("Dispersion is not enabled and cannot be silently ignored.")
    if specification.solvation is not None:
        raise UnsupportedCalculation("Solvation is not enabled and cannot be silently ignored.")
    if specification.constraints:
        raise UnsupportedCalculation("Constraints are not supported by this adapter.")
    if specification.task_type is CalculationTaskType.PERIODIC_ENERGY:
        if specification.property_requests or specification.engine_extensions:
            raise UnsupportedCalculation("Unsupported periodic properties or engine extensions.")
        return
    else:
        if method == "pbe+u":
            raise UnsupportedCalculation("Method 'pbe+u' is supported for periodic calculations only.")
        if specification.basis and specification.basis.identifier.lower() == "gth-dzvp-molopt-sr":
            raise UnsupportedCalculation(
                "Basis 'gth-dzvp-molopt-sr' is supported for periodic calculations only."
            )
        if specification.periodic is not None:
            raise UnsupportedCalculation("Periodic options require the periodic energy task.")
    if specification.task_type is CalculationTaskType.GEOMETRY_OPTIMIZATION:
        if specification.optimization is None:
            raise UnsupportedCalculation("Optimization settings are required.")
        if (
            engine == "pyscf"
            and specification.optimization.optimizer == "geometric"
            and hosted_geometric_unavailable(settings)
        ):
            raise EngineUnavailable(HOSTED_GEOMETRIC_REFUSAL)
        if (
            specification.optimization.optimizer != "geometric"
            or specification.optimization.xtb_level is not None
        ):
            raise UnsupportedCalculation("PySCF optimization requires geomeTRIC settings.")
        if specification.property_requests or specification.engine_extensions:
            raise UnsupportedCalculation(
                "Unsupported optimization properties or engine extensions."
            )
        if specification.scf and specification.scf.reference is not None:
            raise UnsupportedCalculation("Explicit SCF reference is not supported by this adapter.")
        if settings.compute_local_enabled:
            completed = subprocess.run(
                [
                    str(configured_path(settings.scientific_worker_python)),
                    "-c",
                    "import geometric; print(geometric.__version__)",
                ],
                capture_output=True,
                text=True,
                check=False,
                timeout=30,
            )
            if completed.returncode or completed.stdout.strip() != GEOMETRIC_VERSION:
                raise EngineUnavailable(
                    "Geometry optimisation needs geomeTRIC, which is an optional extra and not part of a "
                    "default install (its licence forbids use in AI-training datasets). Install it with "
                    "'uv sync --project services/scientific-worker --extra optimization' to enable "
                    "optimisation, or use single-point and frequency tasks, which do not need it."
                )
        # Hosted backend: no worker Python exists here. geomeTRIC is pinned in the compute image
        # lock and the provider checks optimizer_version against the engine's own result.
    elif specification.optimization is not None:
        raise UnsupportedCalculation("Optimization settings require geometry optimization.")
    if specification.thermochemistry is not None and (
        specification.task_type is not CalculationTaskType.THERMOCHEMISTRY
    ):
        raise UnsupportedCalculation("Thermochemistry options require the thermochemistry task.")
    if specification.task_type is CalculationTaskType.THERMOCHEMISTRY:
        if specification.thermochemistry is None:
            raise UnsupportedCalculation("Thermochemistry options are required.")
        if (
            specification.hessian is not None
            or specification.tddft is not None
            or specification.raman is not None
            or specification.optimization is not None
        ):
            raise UnsupportedCalculation(
                "Thermochemistry reuses persisted frequency data; it cannot request new "
                "optimization, Hessian, TDDFT or Raman work."
            )
        if specification.property_requests or specification.engine_extensions:
            raise UnsupportedCalculation("Unsupported thermochemistry properties or extensions.")
        if specification.scf and specification.scf.reference is not None:
            raise UnsupportedCalculation("Explicit SCF reference is not supported by this adapter.")
        if specification.multiplicity != 1:
            raise UnsupportedCalculation("Thermochemistry V1 supports closed-shell singlets only.")
    elif specification.task_type is CalculationTaskType.FREQUENCY:
        if specification.hessian is None:
            raise UnsupportedCalculation(
                "Analytic Hessian settings are required for frequency analysis."
            )
        if specification.property_requests or specification.engine_extensions:
            raise UnsupportedCalculation("Unsupported frequency properties or engine extensions.")
        if specification.scf and specification.scf.reference is not None:
            raise UnsupportedCalculation("Explicit SCF reference is not supported by this adapter.")
    elif specification.task_type is CalculationTaskType.ORBITAL:
        if specification.hessian is not None:
            raise UnsupportedCalculation("Hessian settings do not apply to orbital analysis.")
        if specification.optimization is not None:
            raise UnsupportedCalculation("Optimization settings do not apply to orbital analysis.")
        if specification.property_requests or specification.engine_extensions:
            raise UnsupportedCalculation("Unsupported molecular-orbital properties or extensions.")
        if specification.scf and specification.scf.reference is not None:
            raise UnsupportedCalculation("Explicit SCF reference is not supported by this adapter.")
    elif specification.task_type is CalculationTaskType.TDDFT:
        if specification.hessian is not None:
            raise UnsupportedCalculation("Hessian settings do not apply to TDDFT analysis.")
        if specification.optimization is not None:
            raise UnsupportedCalculation("Optimization settings do not apply to TDDFT analysis.")
        if specification.property_requests or specification.engine_extensions:
            raise UnsupportedCalculation("Unsupported TDDFT properties or extensions.")
        if specification.scf and specification.scf.reference is not None:
            raise UnsupportedCalculation("Explicit SCF reference is not supported by this adapter.")
    elif specification.hessian is not None:
        raise UnsupportedCalculation("Hessian settings require frequency analysis.")
