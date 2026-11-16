/**
 * Homepage copy that states what ChemDFT does. Capability claims here are limited to what the repository
 * implements today (see `services/api/src/chemdft_api/scientific/engines/registry.py` and the import worker).
 * Anything not yet executable is labelled as such, never advertised as available.
 */

/** What the product accepts today (mirrors `services/api/.../engines/registry.py`; a unit test checks it). */
export const SUPPORTED_METHODS = ["HF", "B3LYP", "PBE"] as const;
export const SUPPORTED_BASES = ["STO-3G", "6-31G", "def2-SVP", "def2-SVPD"] as const;

/** Act II: the five stages of a calculation, told over one persistent structure. Values come from the real stored run record. */
export const PROCESS_STEPS = [
  {
    id: "structure",
    label: "Structure",
    title: "Start from a structure you can account for",
    body: "Draw or import a structure. Each calculation points to the exact, immutable structure version it used.",
  },
  {
    id: "prepare",
    label: "Prepare",
    title: "State the chemistry before computing it",
    body: "Charge, multiplicity, method and basis set are explicit. The normalised calculation input is hashed.",
  },
  {
    id: "calculate",
    label: "Calculate",
    title: "A real engine does the calculation",
    body: "This recorded attempt ran PySCF in an isolated worker. The engine produced the result; the browser and AI did not.",
  },
  {
    id: "verify",
    label: "Verify",
    title: "Results are checked before they are trusted",
    body: "The platform checks convergence, output validity and producer authority before storing the result. Scientific review remains separate.",
  },
  {
    id: "explore",
    label: "Explore",
    title: "Inspect what the calculation produced",
    body: "Inspect the stored water orbitals and their energies in the workspace, alongside the method and evidence that produced them.",
  },
] as const;

export const FIREWALL_CHAIN = [
  { id: "ai", label: "AI Scientist", note: "Plans and proposes", kind: "ai" },
  { id: "registry", label: "Validated tool registry", note: "Typed, permissioned actions", kind: "system" },
  { id: "engine", label: "Scientific engine", note: "Deterministic calculation", kind: "system" },
  { id: "result", label: "Authoritative result", note: "Validated, with provenance", kind: "system" },
  { id: "explain", label: "AI interpretation", note: "Explains the stored result", kind: "ai" },
] as const;

export const AI_MAY = [
  "Plan a workflow and choose which tool to propose",
  "Explain a method, a basis set or a convergence message",
  "Interpret a stored, validated result and cite it",
  "Help troubleshoot a failed or unconverged calculation",
];
export const AI_MAY_NOT = [
  "Write an energy, spectrum, orbital or any other authoritative value",
  "Stand in for a calculation that did not run",
  "Present an estimate as if an engine produced it",
  "Change a stored result or its provenance",
];

export type EngineStatus = "available" | "unavailable" | "planned";
export const ENGINE_STATUS_LABEL: Record<EngineStatus, string> = {
  available: "Available",
  unavailable: "Not available",
  planned: "Not available yet",
};

export interface EngineCardData {
  name: string;
  /** One-line role. */
  role: string;
  status: EngineStatus;
  /** Only where the repository records it (docs/TECHNOLOGY_REGISTRY.md or the worker configuration). */
  version?: string;
  /** Two or three short statements of what it can and cannot do today. */
  lines: readonly string[];
  /** Why a card is not available (muted cards). */
  reason?: string;
}

export interface EngineSection {
  id: string;
  title: string;
  cards: readonly EngineCardData[];
}

/**
 * Every statement comes from docs/TECHNOLOGY_REGISTRY.md, services/api config.py, qe_limits.py or NEXT.md; the
 * test tests/homepage-content.test.ts pins the ones that mirror code. "Hosted" means the AWS worker behind chemdft.com.
 * Nothing here says a result is verified in general: hosted runs are few and not independently verified.
 */
export const ENGINE_SECTIONS: readonly EngineSection[] = [
  {
    id: "molecular",
    title: "Molecular calculations",
    cards: [
      {
        name: "PySCF",
        role: "Quantum chemistry for molecules",
        status: "available",
        version: "2.14.0",
        lines: [
          "HF, B3LYP and PBE with STO-3G, 6-31G, def2-SVP and def2-SVPD, in the gas phase.",
          "Energy, geometry optimisation, frequencies, orbitals, TDDFT and thermochemistry; Libxc and libcint supply functionals and integrals.",
          "Hosted size limits are tighter: 12 atoms for optimisation and orbitals, 6 for frequencies and TDDFT.",
        ],
      },
      {
        name: "geomeTRIC",
        role: "Geometry optimisation",
        status: "available",
        version: "1.1.1",
        lines: ["Optimises molecular geometries using PySCF gradients.", "Periodic structures are not optimised with it."],
      },
      {
        name: "xTB (GFN2)",
        role: "Semi-empirical energy and optimisation",
        status: "available",
        version: "6.7.1",
        lines: [
          "GFN2-xTB energy and native geometry optimisation for molecules.",
          "Hosted limit: 50 atoms. Hosted runs so far are few, with no independent Linux reference.",
        ],
      },
      {
        name: "CREST",
        role: "Conformer search",
        status: "available",
        version: "3.0.2",
        lines: [
          "GFN2 conformer search for neutral H, C and O singlets; hosted limit 12 atoms.",
          "The search is stochastic; retained conformers are not certified minima.",
        ],
      },
    ],
  },
  {
    id: "periodic",
    title: "Periodic crystals and solids",
    cards: [
      {
        name: "Quantum ESPRESSO",
        role: "Plane-wave periodic DFT",
        status: "available",
        version: "7.6 · SSSP PBE Efficiency v2.0",
        lines: [
          "PBE or PBE+U (Dudarev Hubbard U); non-magnetic, ferromagnetic or antiferromagnetic; k-point meshes from Γ up to 4×4×4.",
          "Optional relaxation of atom positions with the cell held fixed, density of states and band structure.",
          "Fixed pseudopotentials and cutoffs; at most 20 atoms. No cell relaxation, stress, phonons, hybrid functionals or spin–orbit coupling.",
        ],
      },
      {
        name: "PySCF periodic",
        role: "Gaussian-basis periodic DFT",
        status: "available",
        version: "2.14.0",
        lines: [
          "Single-point PBE or PBE+U energy with a Gaussian basis (GTH-PBE pseudopotentials); non-magnetic, ferromagnetic or antiferromagnetic.",
          "Γ point only on the hosted worker; at most 20 atoms.",
          "No relaxation, bands, density of states, forces or stress.",
        ],
      },
    ],
  },
  {
    id: "structures",
    title: "Structures and imports",
    cards: [
      { name: "RDKit", role: "Molecular structure handling", status: "available", version: "2025.9.1", lines: ["Reads and represents molecular structures.", "Does not run calculations."] },
      {
        name: "pymatgen",
        role: "Crystal structures from CIF",
        status: "available",
        version: "2025.10.7",
        lines: ["Reads crystal structures from CIF and builds the band-structure path for Quantum ESPRESSO.", "Does not run calculations."],
      },
      { name: "cclib", role: "Parsing imported output", status: "available", lines: ["Parses imported Gaussian 09/16 and ORCA 5.x–6.1 output."] },
    ],
  },
  {
    id: "unavailable",
    title: "Not available yet",
    cards: [
      {
        name: "Psi4",
        role: "Quantum chemistry",
        status: "unavailable",
        lines: [],
        reason:
          "Psi4 1.11 single-point energy for five accepted method/basis pairs (HF, B3LYP, PBE, MP2); neutral singlets only. Not available: there is no Linux build of Psi4 yet and some of its licence items are open decisions",
      },
      {
        name: "DFT-D4",
        role: "Dispersion correction",
        status: "unavailable",
        lines: [],
        reason:
          "DFT-D4 4.2.0 dispersion correction of accepted Psi4 B3LYP or PBE def2-SVP energies; combined totals are not independently verified. Not available: it accepts only a Psi4 energy, and none can be produced here",
      },
      {
        name: "GPU4PySCF",
        role: "GPU acceleration",
        status: "unavailable",
        lines: [],
        reason: "GPU acceleration. Not available: no program it could drive has a hosted workload",
      },
      {
        name: "QCElemental · QCEngine · QCFractal · Basis Set Exchange · ASE",
        role: "Interchange and orchestration",
        status: "planned",
        lines: [],
        reason: "Interchange and orchestration, not integrated",
      },
      { name: "nmrglue · pyOpenMS", role: "Spectroscopy and data", status: "planned", lines: [], reason: "NMR and mass-spectrometry data, not integrated" },
    ],
  },
];

export const ALL_ENGINE_CARDS: readonly EngineCardData[] = ENGINE_SECTIONS.flatMap((section) => section.cards);

/** Platform capabilities that are not one engine's; shown under the cards as "Also available". */
export const PLATFORM_NOW = [
  "Structure import (XYZ, MOL, SDF, CIF) and 2D drawing",
  "Orbital, vibrational, IR/Raman and thermochemistry views",
  "Experimental spectrum import and comparison",
  "An AI Scientist that works from stored results, with citations",
  "ORCID sign-in for accounts that already linked an ORCID iD in Settings",
];

export const SUPPORTED_NOW = [
  "PySCF energy, geometry optimisation, frequencies, orbitals, TDDFT, thermochemistry",
  "Native GFN2-xTB 6.7.1 energy and molecular geometry optimisation when configured",
  "CREST 3.0.2 GFN2 conformer search",
  "HF, B3LYP and PBE with STO-3G, 6-31G, def2-SVP and def2-SVPD",
  "Periodic crystals: Quantum ESPRESSO 7.6 and PySCF periodic, PBE and PBE+U, k-point meshes, atom relaxation at a fixed cell (Quantum ESPRESSO only)",
  "Import of Gaussian 09/16 and ORCA 5.x–6.1 outputs",
  ...PLATFORM_NOW,
];
export const NOT_YET = [
  "New Psi4 and DFT-D4 runs: Psi4 isn't configured on this deployment",
  "Psi4 optimisation, frequencies or charged and open-shell systems",
  "Periodic cell relaxation, stress, phonons, hybrid functionals and spin–orbit coupling",
  "Molecular dynamics and protein-scale simulation",
  "Every functional, basis set or quantum method",
  "Gaussian input-file compatibility",
  "Bring-your-own-key AI, public collaboration",
  "Public sign-up and pricing",
];
