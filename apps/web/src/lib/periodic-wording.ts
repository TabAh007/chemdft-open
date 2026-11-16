/**
 * Single source of the plain-language wording for periodic DFT results and +U defaults (release 0.0.42).
 * The Python AI app guide repeats the same sentences; tests/periodic-wording.test.ts pins both copies.
 */
export const U_DEFAULTS_NOTE =
  "Default U values are Materials Project starting values for oxides. They were calibrated for formation energies with PAW potentials, not fitted to this basis or to band gaps. Test the sensitivity by changing U.";

export const LOCAL_SPIN_LABEL = "Local spin population (Mulliken-type)";

export const LOCAL_SPIN_TOOLTIP =
  "Basis-dependent projection of the spin density onto atoms. It is not directly comparable with an experimental magnetisation or neutron moment.";

export const KS_GAP_LABEL = "Kohn-Sham gap (converged SCF)";

export const KS_GAP_NOTE = "Kohn-Sham gap from the converged SCF at the k-points used; not an optical gap.";

// ---- Quantum ESPRESSO plane-wave engine (release 0.0.43) ---------------------------------------------------------------------------
// The Python AI app guide repeats the bounded statement; tests/periodic-references-and-wording.test.ts pins both copies.

export const QE_ENGINE_LABEL = "Quantum ESPRESSO (plane waves)";
export const PYSCF_ENGINE_LABEL = "PySCF periodic (Gaussian basis)";

export const ENGINE_HELP_PYSCF =
  "PySCF periodic uses a localized Gaussian basis (GTH-DZVP-MOLOPT-SR with GTH-PBE pseudopotentials). It runs a single-point energy.";

export const ENGINE_HELP_QE =
  "Quantum ESPRESSO uses plane waves with fixed, library-recommended cutoffs and pseudopotentials (SSSP PBE Efficiency v2.0). You cannot change either; they come with the library.";

export const QE_PSEUDO_LIBRARY_LABEL = "SSSP PBE Efficiency v2.0";

export const QE_LOCAL_SPIN_LABEL = "Local spin moment (Lowdin projected)";

export const QE_LOCAL_SPIN_TOOLTIP =
  "Spin polarization of the Lowdin-orthogonalized atomic projections from projwfc.x. It depends on the projection used and is not directly comparable with an experimental magnetisation or neutron moment. Sphere-integrated moments are not shown because they depend on an arbitrary radius.";

export const QE_LOCAL_SPIN_NOTE = "Plane-wave Lowdin projection (Quantum ESPRESSO); it is not the Mulliken-type population that PySCF reports.";

export const QE_GAP_LABEL = "Kohn-Sham gap (eigenvalues, converged SCF)";

export const QE_GAP_NOTE =
  "Kohn-Sham gap taken from the eigenvalues of the converged SCF at the k-points used; not an optical gap and never read from a broadened DOS curve.";

export const QE_DOS_CAPTION =
  "Total and projected density of states (Quantum ESPRESSO dos.x and projwfc.x). Energies are relative to the Fermi level of the DOS mesh calculation; spin-up is drawn above the axis and spin-down below. The gap shown beside the chart comes from the eigenvalues, not from this curve.";

export const QE_BANDS_CAPTION =
  "Band structure along the chosen high-symmetry path (Quantum ESPRESSO bands.x). Energies are relative to the Fermi level of the converged SCF. The gap along the path is the gap between the highest occupied and lowest empty state on this path only; it is not the global gap of the crystal.";

export const QE_BANDS_GAP_LABEL = "Gap along the chosen path";

export const QE_RELAX_NOTE =
  "Atom positions were relaxed with the cell held fixed (BFGS). Cell relaxation, stress and pressure are not offered: the stress printed at these plane-wave cutoffs is not reliable.";

export const QE_AFM_LOCAL_MINIMUM_NOTE =
  "Antiferromagnetic and ferromagnetic solutions are local minima of the SCF cycle. They depend on the chosen U and on the pseudopotentials, so check them against other magnetic orders and U values before drawing conclusions.";

export const QE_ESTIMATE_LABEL =
  "Rough estimate scaled from one measured 10-atom run on this machine class; the real time can differ a lot.";

export const QE_PLANE_WAVE_FOOTNOTE =
  "Plane waves, SSSP PBE Efficiency v2.0 (fixed cutoffs and pseudopotentials), Fermi-Dirac smearing 0.01 Ry (0.005 Ha), collinear spin.";
