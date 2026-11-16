# Proprietary to ChemDFT. All rights reserved.
"""Server-side rules for the Quantum ESPRESSO periodic engine: capability probe, specification validation, element and
hosted-limit checks. Kept out of the Apache-2.0 engine wrappers; registry.py and the dispatch code call into here."""

from __future__ import annotations

from pathlib import Path

from ...errors import EngineUnavailable, UnsupportedCalculation
from .qe_limits import QeLimits, refusal
from .qe_pseudopotentials import (
    HUBBARD_3D_ELEMENTS,
    PSEUDO_LIBRARY_NAME,
    SSSP_EFFICIENCY_V2,
    pseudo_for_element,
    unsupported_element_message,
)

QE_BASIS_IDENTIFIER = "pw-sssp-pbe-eff-v2"
QE_BASIS_DISPLAY = "Plane waves, SSSP PBE Efficiency v2.0"
REQUIRED_PROGRAMS = ("pw.x", "projwfc.x", "dos.x", "bands.x")


def qe_limits_from_settings(settings) -> QeLimits:
    return QeLimits(
        max_atoms=settings.aws_qe_max_atoms,
        max_scf_k=settings.aws_qe_max_scf_k,
        max_dos_k=settings.aws_qe_max_dos_k,
        max_band_points=settings.aws_qe_max_band_points,
        relax_max_steps=settings.aws_qe_relax_max_steps,
        timeout_scf_s=settings.aws_qe_timeout_scf_seconds,
        timeout_relax_s=settings.aws_qe_timeout_relax_seconds,
        timeout_nscf_dos_s=settings.aws_qe_timeout_nscf_dos_seconds,
        timeout_bands_s=settings.aws_qe_timeout_bands_seconds,
        timeout_total_s=settings.aws_qe_timeout_total_seconds,
        max_memory_mb=settings.aws_qe_max_memory_mb,
        max_scratch_bytes=settings.aws_qe_max_scratch_bytes,
    )


def hosted_qe(settings) -> bool:
    """Hosted backend: QE lives in the pinned AWS image and is offered only once the owner switched it on."""
    if settings.compute_local_enabled or not settings.compute_aws_enabled or not settings.aws_qe_enabled:
        return False
    from ...aws_compute import AwsEc2ComputeProvider

    return AwsEc2ComputeProvider(settings).can_queue()


def probe_qe(settings) -> tuple[str, str | None, str | None]:
    if hosted_qe(settings):
        return "AVAILABLE", settings.aws_qe_version, None
    if not settings.compute_local_enabled:
        return "UNAVAILABLE", None, "Quantum ESPRESSO is not enabled on this deployment."
    bin_dir, pseudo_dir = settings.qe_bin_dir, settings.qe_pseudo_dir
    if bin_dir is None or pseudo_dir is None:
        return "UNAVAILABLE", None, "Quantum ESPRESSO directories are not configured."
    missing = [name for name in REQUIRED_PROGRAMS if not (Path(bin_dir) / name).is_file()]
    if missing:
        return "UNAVAILABLE", None, f"Quantum ESPRESSO programs not found: {', '.join(missing)}."
    if not Path(pseudo_dir).is_dir():
        return "UNAVAILABLE", None, "The SSSP pseudopotential directory does not exist."
    return "AVAILABLE", settings.aws_qe_version, None


def validate_qe_periodic_elements(symbols) -> None:
    for symbol in symbols:
        if pseudo_for_element(str(symbol)) is None:
            raise UnsupportedCalculation(unsupported_element_message(str(symbol)))


def validate_qe_specification(specification, settings) -> None:
    from ...contracts.scientific import CalculationTaskType

    if specification.task_type is not CalculationTaskType.PERIODIC_ENERGY:
        raise UnsupportedCalculation(
            "Quantum ESPRESSO runs periodic crystals only: single-point energy, atom relaxation (cell fixed), "
            "DOS/PDOS and band structure are options of the periodic energy task."
        )
    state, version, diagnostic = probe_qe(settings)
    if state != "AVAILABLE":
        raise EngineUnavailable(diagnostic or "Quantum ESPRESSO is unavailable.")
    allowed = specification.engine_preference.allowed_version
    if allowed and allowed != version:
        raise UnsupportedCalculation("Installed Quantum ESPRESSO version violates the requested constraint.")
    method = specification.method.identifier.lower()
    if method not in ("pbe", "pbe+u"):
        raise UnsupportedCalculation(
            "Quantum ESPRESSO periodic DFT supports PBE and PBE+U (Dudarev) only; hybrids are not offered."
        )
    if specification.basis is None or specification.basis.identifier.lower() != QE_BASIS_IDENTIFIER:
        raise UnsupportedCalculation(
            f"Quantum ESPRESSO uses plane waves with the fixed library {PSEUDO_LIBRARY_NAME}; "
            f"the basis must be '{QE_BASIS_IDENTIFIER}'."
        )
    if specification.periodic is None:
        raise UnsupportedCalculation("Periodic options are required for a Quantum ESPRESSO calculation.")
    if any(
        (
            specification.optimization, specification.hessian, specification.tddft, specification.raman,
            specification.thermochemistry, specification.conformer_search, specification.scf,
            specification.dispersion, specification.solvation, specification.constraints,
            specification.property_requests, specification.engine_extensions,
        )
    ):
        raise UnsupportedCalculation(
            "Molecular, SCF-threshold, dispersion, solvation, constraint and extension options do not apply to "
            "Quantum ESPRESSO periodic calculations."
        )
    options = specification.periodic
    unknown_u = [el for el in options.u_effective_ev if el not in HUBBARD_3D_ELEMENTS]
    if unknown_u:
        raise UnsupportedCalculation(f"+U is offered on 3d transition metals only; not on {', '.join(sorted(unknown_u))}.")
    if method == "pbe" and options.u_effective_ev:
        raise UnsupportedCalculation("U values were given but the method is PBE; choose PBE+U.")
    # lazily bounded by element-dependent limits in qe_creation_refusal (needs the structure)


def qe_creation_refusal(settings, specification, atoms: list[dict]) -> str | None:
    """Plain-language refusal for a QE calculation on this structure (atom count, elements, k-meshes, memory, time)."""
    elements = []
    for atom in atoms:
        symbol = atom.get("element")
        if symbol not in elements:
            elements.append(symbol)
    for symbol in elements:
        if symbol not in SSSP_EFFICIENCY_V2:
            return unsupported_element_message(symbol)
    options = specification.periodic
    ecut = max(pseudo_for_element(s)["ecutwfc_ry"] for s in elements)
    nspin = 2 if options.magnetic_order != "none" else 1
    return refusal(
        qe_limits_from_settings(settings),
        atoms=len(atoms),
        ecutwfc_ry=ecut,
        scf_mesh=options.k_mesh,
        relax=options.relax,
        relax_max_steps=options.relax_max_steps,
        dos=options.dos,
        dos_mesh=options.dos_k_mesh,
        bands=options.bands,
        band_points=60 if options.bands else 0,
        nspin=nspin,
    )


def qe_document_refusal(settings, document: dict) -> str | None:
    """Same checks as qe_creation_refusal, from the normalized input document (used again by the hosted provider)."""
    options = document.get("periodic") or {}
    atoms = document.get("atoms") or []
    symbols = []
    for atom in atoms:
        symbol = atom.get("element")
        if symbol not in symbols:
            symbols.append(symbol)
    for symbol in symbols:
        if symbol not in SSSP_EFFICIENCY_V2:
            return unsupported_element_message(str(symbol))
    ecut = max(pseudo_for_element(s)["ecutwfc_ry"] for s in symbols)
    path = options.get("band_path") or {}
    weights = path.get("weights") or []
    band_points = (sum(int(w) for w in weights[:-1]) + 1) if weights else 0
    return refusal(
        qe_limits_from_settings(settings),
        atoms=len(atoms),
        ecutwfc_ry=ecut,
        scf_mesh=tuple(options.get("k_mesh") or (1, 1, 1)),
        relax=bool(options.get("relax")),
        relax_max_steps=int(options.get("relax_max_steps", 30)),
        dos=bool(options.get("dos")),
        dos_mesh=tuple(options.get("dos_k_mesh") or (6, 6, 6)),
        bands=bool(options.get("bands")),
        band_points=band_points,
        nspin=2 if options.get("magnetic_order", "none") != "none" else 1,
    )
