"""Deterministic scientific method recommendations for ChemDFT structures (Release 0.0.60, Part 4).

Generates method advice strictly based on objective structure facts:
- Periodic transition-metal oxide (e.g. Cr2O3): recommends DFT+U and magnetic ordering.
- Periodic non-transition-metal crystal (e.g. Si, NaCl): recommends standard PBE with SSSP.
- Molecular structure (e.g. H2O): recommends PySCF B3LYP/def2-SVP (notes HF/STO-3G is educational).
- Unsupported elements: reports exact unsupported element.
Every suggestion is labelled 'suggestion, not a result' and cites docs/TECHNOLOGY_REGISTRY.md.
"""

from __future__ import annotations

from dataclasses import dataclass

TRANSITION_METALS = {
    # 3d
    "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn",
    # 4d
    "Y", "Zr", "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd",
    # 5d
    "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg",
    # Lanthanides / Actinides
    "La", "Ce", "Pr", "Nd", "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb", "Lu",
    "Ac", "Th", "Pa", "U", "Np", "Pu", "Am", "Cm",
}

# Elements unsupported by standard automated DFT pseudopotential/basis libraries in ChemDFT
UNSUPPORTED_ELEMENTS = {
    "Og", "Ts", "Lv", "Mc", "Fl", "Nh", "Cn", "Rg", "Ds", "Mt", "Hs", "Bh",
    "Sg", "Db", "Rf", "Lr", "No", "Md", "Fm", "Es", "Cf", "Bk",
}


@dataclass(frozen=True)
class MethodAdvice:
    recommended_engine: str
    recommended_method: str
    recommended_basis_or_ecp: str
    rationale: str
    citation: str
    caveat: str = "Suggestion, not a result."
    unsupported_elements: tuple[str, ...] = ()


def advise_calculation_method(
    *,
    is_periodic: bool,
    elements: list[str] | set[str] | tuple[str, ...],
) -> MethodAdvice:
    """Deterministic method recommendation based on structure facts."""
    el_set = set(elements)

    # Check for unsupported elements
    unsupported = sorted(el_set.intersection(UNSUPPORTED_ELEMENTS))
    if unsupported:
        return MethodAdvice(
            recommended_engine="none",
            recommended_method="none",
            recommended_basis_or_ecp="none",
            rationale=(
                f"Structure contains elements that are unsupported by the standard automated "
                f"computational libraries in ChemDFT: {', '.join(unsupported)}."
            ),
            citation="docs/TECHNOLOGY_REGISTRY.md",
            unsupported_elements=tuple(unsupported),
        )

    if is_periodic:
        has_tm = bool(el_set.intersection(TRANSITION_METALS))
        has_oxygen = "O" in el_set

        if has_tm and has_oxygen:
            # Periodic transition-metal oxide (e.g. Cr2O3, TiO2, Fe2O3)
            return MethodAdvice(
                recommended_engine="quantum_espresso",
                recommended_method="PBE+U",
                recommended_basis_or_ecp="SSSP_PBE_PRECISION",
                rationale=(
                    "Periodic transition-metal oxide detected. Standard semi-local DFT (PBE/GGA) "
                    "strongly underestimates localized 3d/4d electron correlation, leading to "
                    "underestimated bandgaps and incorrect magnetic ground states. DFT+U with "
                    "Hubbard U corrections on the transition metal atoms and explicit magnetic "
                    "ordering (ferromagnetic or antiferromagnetic) is recommended."
                ),
                citation="docs/TECHNOLOGY_REGISTRY.md (Quantum ESPRESSO SSSP baseline)",
            )

        if has_tm:
            # Periodic transition-metal intermetallic/chalcogenide
            return MethodAdvice(
                recommended_engine="quantum_espresso",
                recommended_method="PBE (spin-polarized) or PBE+U",
                recommended_basis_or_ecp="SSSP_PBE_PRECISION",
                rationale=(
                    "Periodic transition-metal system detected. Consider spin polarization and "
                    "Hubbard U corrections if localized d/f states dominate near the Fermi level."
                ),
                citation="docs/TECHNOLOGY_REGISTRY.md (Quantum ESPRESSO)",
            )

        # Periodic non-transition metal crystal (e.g. Si, NaCl, GaAs)
        return MethodAdvice(
            recommended_engine="quantum_espresso",
            recommended_method="PBE",
            recommended_basis_or_ecp="SSSP_PBE_PRECISION",
            rationale=(
                "Non-transition metal crystal detected. Standard PBE (GGA) functional with SSSP "
                "precision pseudopotentials provides a reliable, well-tested baseline for "
                "structural relaxation and electronic band structure."
            ),
            citation="docs/TECHNOLOGY_REGISTRY.md (Quantum ESPRESSO)",
        )

    # Molecular structure (non-periodic)
    return MethodAdvice(
        recommended_engine="pyscf",
        recommended_method="B3LYP",
        recommended_basis_or_ecp="def2-SVP",
        rationale=(
            "Molecular structure detected. For general organic and main-group molecules, "
            "DFT with the B3LYP hybrid exchange-correlation functional and def2-SVP basis set "
            "provides a balanced description of electronic structure and geometry. "
            "Hartree-Fock (HF) with STO-3G is suitable for fast educational checks only."
        ),
        citation="docs/TECHNOLOGY_REGISTRY.md (PySCF molecular engine)",
    )
