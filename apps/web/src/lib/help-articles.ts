// Server-page content only; do not import into client workspace/help triggers.
import type { HelpTopicId } from "./help-topics";

export const HELP_ARTICLES = {
  "structure.charge": {
    product:
      "ChemDFT records charge with a saved structure version and validates the calculation input. Review the actual chemical species; onboarding does not infer a charge for you.",
    prerequisite:
      "Saved three-dimensional coordinates and a recorded charge are required for molecular computation.",
    source: {
      url: "https://pyscf.org/user/gto.html",
      label: "PySCF molecular structure documentation",
    },
  },
  "structure.multiplicity": {
    product:
      "ChemDFT stores multiplicity independently of charge. Supported frequency, TDDFT and thermochemistry paths require closed-shell singlets; an integer input alone does not establish the correct electronic state.",
    prerequisite:
      "Review charge, multiplicity and the supported task before submission.",
    source: {
      url: "https://goldbook.iupac.org/terms/view/M04062",
      label: "IUPAC Gold Book: spin multiplicity",
    },
  },
  "calculation.method": {
    product:
      "ChemDFT validates the selected method against the task and configured worker. Engine preferences are requests; execution identity and result provenance are recorded by the server.",
    prerequisite:
      "Choose an explicit supported method and basis. Onboarding does not rank methods for your system.",
    source: {
      url: "https://pyscf.org/user/scf.html",
      label: "PySCF SCF documentation",
    },
  },
  "calculation.basis": {
    product:
      "ChemDFT records the basis in the normalized calculation input and result provenance. Availability depends on the task and worker; a larger named basis is not automatically the right choice.",
    prerequisite:
      "Optimization and frequency records must have matching recorded engine, method and basis for the current thermochemistry path.",
    source: {
      url: "https://pyscf.org/user/gto.html",
      label: "PySCF molecular structure documentation",
    },
  },
  "calculation.optimization": {
    product:
      "ChemDFT preserves the starting version, optimization history and saved final geometry. The current frequency and orbital workflows require that converged optimized version.",
    prerequisite:
      "A molecular structure with reviewed charge and multiplicity, a supported worker and the optimizer are required. Navigator reports the actual blockers.",
    source: {
      url: "https://pyscf.org/interface/geomopt.html",
      label: "PySCF geometry optimization documentation",
    },
  },
  "calculation.frequency": {
    product:
      "ChemDFT validates the result and its geometry identity. The supported IR and Raman paths use the converged optimized geometry; a drawn or imported reference alone is not a frequency result.",
    prerequisite:
      "Thermochemistry additionally requires valid positive modes, established stationarity and matching calculation context. Follow the server reasons rather than treating every stored frequency as eligible.",
    source: {
      url: "https://pyscf.org/pyscf_api_docs/pyscf.hessian.html",
      label: "PySCF Hessian and harmonic-analysis API",
    },
  },
  "spectra.ir": {
    product:
      "The existing frequency pipeline produces validated frequencies and IR intensities. Broadening and display settings are presentation; measured data remain a separate source with explicit units.",
    prerequisite:
      "A calculated source and a matching confirmed, associated experimental IR spectrum with a peak set are needed for comparison.",
    source: null,
  },
  "spectra.raman": {
    product:
      "ChemDFT retains the calculation source and supports inspecting modes and spectrum display. Comparison candidates remain candidates; tolerance alone does not establish chemical identity.",
    prerequisite:
      "Use a converged optimized geometry for the supported frequency path. Comparison needs a confirmed associated experimental Raman spectrum and peaks.",
    source: null,
  },
  "spectra.uv_vis": {
    product:
      "The supported TDDFT path records the ground-state setup, excitation result and method/basis provenance. Experimental wavelengths and calculated transitions retain their own source identities.",
    prerequisite:
      "Current supported computation requires a converged optimized molecular geometry and closed-shell singlet. Comparison requires the same technique and explicit association.",
    source: null,
  },
  "spectra.experimental": {
    product:
      "Original data are preserved. Processing and peak detection produce derived versions. A comparison needs calculated data, confirmed measurement, an explicit structure association, matching technique and a processed peak set.",
    prerequisite:
      "Navigator reads the stored association and peak records. Candidate matches do not become scientific assignments merely because they fall within tolerance.",
    source: null,
  },
  "thermochemistry.frequency_requirement": {
    product:
      "The current ideal-gas rigid-rotor harmonic-oscillator path requires the ChemDFT-optimized geometry, matching frequency geometry/charge/multiplicity and engine/method/basis, valid modes and established stationarity.",
    prerequisite:
      "The server checks eligibility, including recorded optimization gradient and energy. Imaginary, zero or invalid modes and mismatched records are blockers; onboarding does not override them.",
    source: null,
  },
  "electronic.homo_lumo": {
    product:
      "ChemDFT displays validated stored orbital data. Spatial orbital or density inspection additionally requires the appropriate coefficient/grid artifacts; labels alone do not establish those artifacts.",
    prerequisite:
      "Navigator checks the result and required orbital records. Open-shell contexts must retain their recorded spin/occupation distinctions.",
    source: {
      url: "https://goldbook.iupac.org/terms/view/F02533",
      label: "IUPAC Gold Book: frontier orbitals",
    },
  },
  "crystal.unit_cell": {
    product:
      "ChemDFT preserves source cell metadata and fractional coordinates. COD 9014036 is a reference crystal; it is not asserted to be the exact Aliyeva experimental refinement.",
    prerequisite:
      "Crystal structure inspection and periodic DFT are supported with PySCF (single point, PBE/PBE+U) and Quantum ESPRESSO (single point, atom relaxation with a fixed cell, DOS, band structure, Lowdin local moments). Cell relaxation, stress or pressure, phonons, hybrid functionals, noncollinear or spin-orbit calculations and molecular dynamics are unavailable.",
    source: {
      url: "https://www.iucr.org/what-we-do/digital-standards/cif/dictionaries",
      label: "IUCr CIF dictionary definitions",
    },
  },
  "crystal.supercell": {
    product:
      "ChemDFT’s existing crystal viewer exposes cell and supercell controls. A display of repeated cells is not a periodic electronic-structure calculation.",
    prerequisite:
      "Import or select a crystal with a valid recorded unit cell. Navigator offers supported inspection and, for a periodic structure, single-point PBE or PBE+U setup in the Calculation panel.",
    source: null,
  },
  "provenance.authority": {
    product:
      "ChemDFT preserves original artifacts, version identities, producer metadata and verification state. Copying a sealed structure records product lineage separately and does not claim the copying user performed the original import or calculation.",
    prerequisite:
      "Review the source artifact and provenance before interpreting a number. A candidate or an unreviewed import is not automatically an authoritative calculated result.",
    source: null,
  },
  "firewall.ai_vs_calculation": {
    product:
      "Scientific engines calculate; deterministic validation and the Scientific Result Firewall control authoritative result writes. Models and untrusted clients cannot promote generated explanations into engine results.",
    prerequisite:
      "Inspect the actual result/source provenance. Help does not calculate, choose an optimal method or alter scientific prerequisites.",
    source: null,
  },
} as const satisfies Record<
  HelpTopicId,
  {
    product: string;
    prerequisite: string;
    source: { url: string; label: string } | null;
  }
>;
