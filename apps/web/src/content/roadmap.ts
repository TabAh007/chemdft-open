/**
 * ChemDFT public roadmap, owner-curated.
 *
 * Seeded only with capabilities and phases that are documented in NEXT.md or docs/14_ROADMAP.md.
 * No user voting, no user names, no speculative dates or promises.
 */

export type RoadmapStatus = "planned" | "in_progress" | "done";

export interface RoadmapItem {
  id: string;
  title: string;
  shortDescription: string;
  status: RoadmapStatus;
  category?: string;
}

export interface RoadmapSection {
  status: RoadmapStatus;
  title: string;
  description: string;
  items: RoadmapItem[];
}

export const ROADMAP_ITEMS: readonly RoadmapItem[] = [
  // --- In progress ---
  {
    id: "in-app-feedback",
    title: "In-App Feedback and Bug Reporting",
    shortDescription:
      "Direct in-app feedback channel allowing signed-in researchers to send bug reports, feature ideas, and calculation method requests directly to the engineering team.",
    status: "in_progress",
    category: "User Experience",
  },
  {
    id: "google-auth-beta",
    title: "Google Authentication for Beta Testers",
    shortDescription:
      "Self-service Google sign-up for invited research testers with deterministic database-enforced beta capacity limits and owner administration.",
    status: "in_progress",
    category: "Authentication",
  },
  {
    id: "crest-conformers",
    title: "CREST Conformer Ensembles on AWS",
    shortDescription:
      "Automated conformer rotamer search and energy window exploration with CREST on on-demand cloud worker infrastructure.",
    status: "in_progress",
    category: "Computational Engines",
  },
  {
    id: "ai-scientific-grounding",
    title: "Grounded AI Scientist Copilot",
    shortDescription:
      "AI chat copilot that grounds scientific answers in stored project calculation records, claims, and experimental evidence with citations.",
    status: "in_progress",
    category: "AI Scientist",
  },

  // --- Planned ---
  {
    id: "gaussian-replacement-goal",
    title: "Long-Term Goal: Open Gaussian Replacement",
    shortDescription:
      "Serving as an open Gaussian replacement is a long-term goal, not a present fact. ChemDFT currently runs small systems within strict hosted limits (PySCF 6–12 atoms, xTB 50 atoms, CREST 12 atoms, Quantum ESPRESSO 20 atoms). Expanding toward broader methods and larger systems remains our long-term objective without speculative atom counts or delivery dates.",
    status: "planned",
    category: "Computational Engines",
  },
  {
    id: "psi4-integration",
    title: "Psi4 Secondary Verification Engine",
    shortDescription:
      "Integration of Psi4 for secondary quantum chemical verification, coupled cluster methods, and independent electronic structure checks.",
    status: "planned",
    category: "Computational Engines",
  },
  {
    id: "gpu-acceleration",
    title: "GPU-Accelerated Quantum Chemistry",
    shortDescription:
      "Acceleration of Hartree-Fock and DFT methods using GPU4PySCF on dedicated GPU compute instances for larger molecular systems.",
    status: "planned",
    category: "Compute Gateway",
  },
  {
    id: "nmr-jcamp-spectra",
    title: "NMR Shifts & JCAMP-DX Experimental Import",
    shortDescription:
      "Prediction of NMR isotropic chemical shielding and direct parser ingestion of experimental JCAMP-DX spectroscopy files.",
    status: "planned",
    category: "Spectroscopy & Experimental",
  },
  {
    id: "multi-user-organizations",
    title: "Research Team Organizations & Shared Projects",
    shortDescription:
      "Role-based multi-user workspaces and granular project-level access controls for collaborating research laboratories.",
    status: "planned",
    category: "Collaboration",
  },
  {
    id: "per-user-quotas",
    title: "Database-Backed Per-User Calculation Quotas",
    shortDescription:
      "Per-user resource allocation and customizable computational budgets managed via owner administrative controls.",
    status: "planned",
    category: "Platform & Policy",
  },

  // --- Done ---
  {
    id: "pyscf-cloud-worker",
    title: "On-Demand AWS PySCF Compute Worker",
    shortDescription:
      "Production execution of PySCF DFT single point, geometry optimization, vibrational frequencies, and thermochemistry on auto-terminating AWS workers.",
    status: "done",
    category: "Computational Engines",
  },
  {
    id: "xtb-screening",
    title: "GFN2-xTB Semi-Empirical Screening",
    shortDescription:
      "Rapid geometry optimization and preliminary energy ranking of organic molecules using semi-empirical tight-binding.",
    status: "done",
    category: "Computational Engines",
  },
  {
    id: "scientific-result-firewall",
    title: "Scientific Result Firewall",
    shortDescription:
      "Server-side provenance verification ensuring AI hypotheses never overwrite calculated values and every result links to verifiable engine artifacts.",
    status: "done",
    category: "Scientific Integrity",
  },
  {
    id: "interactive-visualization",
    title: "3D Molecular & Vibrational Spectra Visualization",
    shortDescription:
      "Interactive 3D molecular structure inspection via 3Dmol.js, collision-free vibrational IR/Raman spectra, and molecular orbital energy level diagrams.",
    status: "done",
    category: "Visualization",
  },
  {
    id: "scientific-exports",
    title: "Publication Exports & Zenodo DOI Citation",
    shortDescription:
      "Multi-format scientific exports including standalone 3D HTML, honest calculation PDF reports, and BibTeX citation packages with verified DOIs.",
    status: "done",
    category: "Reporting & Citation",
  },
  {
    id: "ketcher-2d-editor",
    title: "Integrated Ketcher 2D Structure Editor",
    shortDescription:
      "Chemical structure drawing with live SMILES generation, 3D coordinate conversion, formula calculation, and parity checks.",
    status: "done",
    category: "Chemistry Toolkit",
  },
];

export const ROADMAP_SECTIONS: readonly RoadmapSection[] = [
  {
    status: "in_progress",
    title: "In Progress",
    description: "Features actively being implemented, tested, and staged for release.",
    items: ROADMAP_ITEMS.filter((item) => item.status === "in_progress"),
  },
  {
    status: "planned",
    title: "Planned",
    description: "Architectural roadmap items approved for implementation in upcoming phases.",
    items: ROADMAP_ITEMS.filter((item) => item.status === "planned"),
  },
  {
    status: "done",
    title: "Completed",
    description: "Verified capabilities currently available in the ChemDFT scientific platform.",
    items: ROADMAP_ITEMS.filter((item) => item.status === "done"),
  },
];
