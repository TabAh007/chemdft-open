/**
 * Content for the five public SEO landing pages.
 * All text lives in this single reviewable file.
 * Scientific numbers and facts are imported directly from repository source records:
 * - PySCF run record: apps/web/src/app/_components/home/run-record.ts
 * - Quantum ESPRESSO validation run: apps/web/src/content/site-pages.ts
 * - Engine capabilities and limits: apps/web/src/app/_components/home/content.ts
 * - Engine citations: apps/web/src/content/engine-citations.ts
 * - Cr2O3 worked example: apps/web/src/app/_components/home/cr2o3-example.ts
 */

import { RUN, fixed, scientific } from "../app/_components/home/run-record";
import { VALIDATION_RUN } from "./site-pages";
import {
  SUPPORTED_METHODS,
  SUPPORTED_BASES,
} from "../app/_components/home/content";

export interface SeoPageSection {
  heading: string;
  paragraphs: string[];
}

export interface SeoFaqItem {
  question: string;
  answer: string;
}

export interface SeoPageData {
  slug: string;
  path: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  kicker: string;
  h1: string;
  lead: string;
  sections: SeoPageSection[];
  limitsHeading: string;
  limitsParagraphs: string[];
  faqs: SeoFaqItem[];
  relatedPages: { title: string; href: string; reason: string }[];
}

/** Standard hosted atom limits enforced across ChemDFT compute providers. */
export const HOSTED_LIMITS_SUMMARY = {
  pyscfOptimization: 12,
  pyscfOrbitals: 12,
  pyscfFrequencies: 6,
  pyscfTddft: 6,
  xtb: 50,
  crest: 12,
  quantumEspresso: 20,
  periodicPyscf: 20,
} as const;

export const COMMON_LIMITS_SECTION: SeoPageSection = {
  heading: "What you can run, and the limits",
  paragraphs: [
    `ChemDFT provides hosted cloud compute for quantum chemistry and materials modeling within strictly defined, transparent boundaries. Calculations execute in isolated Linux worker environments on Amazon Web Services (AWS) pilot hardware, automatically provisioning on demand and shutting down after approximately fifteen minutes of idle time. Because computational resources are shared and free during the beta, hosted system size limits are modest and strictly enforced before submission.`,
    `For molecular quantum chemistry using PySCF 2.14.0, the hosted size limit is ${HOSTED_LIMITS_SUMMARY.pyscfOptimization} atoms for geometry optimisation and molecular orbital calculations, and ${HOSTED_LIMITS_SUMMARY.pyscfFrequencies} atoms for harmonic vibrational frequencies and time-dependent DFT (TDDFT). For semi-empirical calculations using xTB 6.7.1, the hosted limit is ${HOSTED_LIMITS_SUMMARY.xtb} atoms. For conformational search using CREST 3.0.2, the hosted limit is ${HOSTED_LIMITS_SUMMARY.crest} atoms for neutral singlet hydrocarbons and oxygenates. For periodic solid-state calculations using Quantum ESPRESSO 7.6 or periodic PySCF, the unit cell limit is ${HOSTED_LIMITS_SUMMARY.quantumEspresso} atoms.`,
    `ChemDFT does not replace high-performance computing clusters or supercomputers for large macromolecules, heavy polymers, or broad crystal supercells. Every result is provided as a transparent research aid that researchers must independently check and verify before publication. The artificial intelligence assistant plans workflows and explains findings, but it never writes, interpolates, or modifies a numerical calculation result.`,
  ],
};

/* -------------------------------------------------------------------------- */
/* 1. DFT CALCULATIONS (/en/dft-calculations)                                */
/* -------------------------------------------------------------------------- */

const DFT_CALCULATIONS_DATA: SeoPageData = {
  slug: "dft-calculations",
  path: "/en/dft-calculations",
  title: "Online DFT calculations in your browser | ChemDFT",
  metaTitle: "Online DFT calculations in your browser | ChemDFT",
  metaDescription:
    "Run density functional theory online with PySCF and Quantum ESPRESSO. Free browser access with real engine validation and hosted limits.",
  kicker: "Cloud Electronic Structure",
  h1: "Online DFT calculations in your browser",
  lead:
    "Execute rigorous density functional theory calculations directly in your web browser. ChemDFT couples an interactive molecular workstation with verified scientific engines running on isolated cloud workers, governed by a strict Result Firewall.",
  limitsHeading: "What you can run, and the limits",
  limitsParagraphs: [
    ...COMMON_LIMITS_SECTION.paragraphs,
    `Supported molecular DFT functionals in PySCF include ${SUPPORTED_METHODS.join(", ")} paired with Gaussian basis sets ${SUPPORTED_BASES.join(", ")}. In periodic Quantum ESPRESSO 7.6, the PBE functional and Dudarev PBE+U are supported with SSSP PBE Efficiency v2.0 pseudopotentials on k-point grids up to 4×4×4.`,
  ],
  sections: [
    {
      heading: "Understanding Density Functional Theory in computational research",
      paragraphs: [
        "Density Functional Theory (DFT) is the cornerstone of modern computational chemistry and solid-state physics. Grounded in the Hohenberg–Kohn theorems and the Kohn–Sham formulation, DFT proves that the ground-state properties of a many-electron system are completely determined by its electron density distribution rather than its multi-dimensional wavefunction. By replacing the intractable 3N-dimensional electronic Schrödinger equation with single-particle Kohn–Sham equations, DFT makes quantitative quantum mechanical modeling computationally accessible for molecules and solids.",
        "In practical chemical investigations, DFT provides quantitative insights into ground-state total energies, equilibrium geometries, frontier molecular orbital levels, vibrational spectra, and thermochemical reaction profiles. However, standard computational chemistry workflows historically required tedious local software installation, intricate configuration of compiler flags and numerical math libraries, manual shell scripting, and command-line execution on remote clusters. ChemDFT eliminates local operational friction by bringing established open-source engines into an accessible, provenance-tracking web interface.",
      ],
    },
    {
      heading: "What ChemDFT runs: molecular and periodic engines",
      paragraphs: [
        `ChemDFT executes genuine open-source scientific software packages inside containerized cloud environments. For molecular electronic structure, ChemDFT runs PySCF 2.14.0, supporting Restricted and Unrestricted Hartree–Fock (${SUPPORTED_METHODS[0]}), the Becke 3-parameter Lee–Yang–Parr hybrid functional (${SUPPORTED_METHODS[1]}), and the Perdew–Burke–Ernzerhof generalized gradient approximation (${SUPPORTED_METHODS[2]}). Integrals and exchange-correlation evaluations are powered by libcint and Libxc. Standard basis sets include ${SUPPORTED_BASES.join(", ")}, allowing systematic convergence from minimal representations to polarized valence double-zeta descriptions.`,
        "For rapid preliminary screening and conformer generation, ChemDFT integrates Grimme group tools: semi-empirical GFN2-xTB 6.7.1 for rapid structure optimization and CREST 3.0.2 for stochastic conformational exploration of neutral singlet molecules. For condensed-phase materials, ChemDFT hosts Quantum ESPRESSO 7.6, providing plane-wave periodic DFT using the Standard Solid State Pseudopotentials (SSSP) PBE Efficiency v2.0 library, with Hubbard U corrections for correlated transition metals, electronic density of states, and high-symmetry band structure paths.",
      ],
    },
    {
      heading: "How a calculation runs: the Scientific Result Firewall",
      paragraphs: [
        "Every job on ChemDFT follows a reproducible, auditable workflow designed around scientific integrity. First, the user prepares or imports a molecular or crystal structure. The AI Scientist can suggest appropriate methodologies or help inspect structural connectivity, but the researcher retains full control over the electronic configuration, charge, spin multiplicity, method, and basis set.",
        "Before any compute executes, the system generates an explicit approval card detailing the normalized input hash, estimated runtime, and compute reservation. When the user approves, the job is dispatched to an isolated Linux container on an AWS EC2 instance. Upon completion, raw output artifacts pass through ChemDFT's Scientific Result Firewall. The firewall checks self-consistent field (SCF) convergence, verifies producer authority, confirms hash consistency, and permanently locks the calculation results. Numerical values are read directly from engine output files; the AI model is strictly prohibited from authoring, altering, or estimating numbers.",
      ],
    },
    {
      heading: "Who ChemDFT is designed for",
      paragraphs: [
        "ChemDFT is tailored for researchers, educators, and students who need reliable quantum chemical calculations without the overhead of maintaining local software stacks or submitting jobs through complex cluster schedulers. Synthetic organic and inorganic chemists can quickly evaluate reaction thermochemistry, compare infrared spectra, or examine HOMO–LUMO energy gaps for proposed intermediates. Materials scientists can inspect crystal unit cells and calculate band structures for small periodic systems.",
        "ChemDFT serves as an exploratory research workstation and educational environment. Because hosted size limits are strictly capped, researchers handling large supramolecular assemblies, solvated biopolymers, or complex defect supercells should continue utilizing specialized institutional high-performance computing clusters.",
      ],
    },
  ],
  faqs: [
    {
      question: "Is ChemDFT really free to use during the beta?",
      answer:
        "Yes. Scientists and students can sign up using a Google account and run calculations at no financial charge during the beta period. There are no credit cards required, and per-user daily limits (10 compute jobs and 40 AI runs per day) ensure fair access.",
    },
    {
      question: "Can I run calculations on large proteins or polymers?",
      answer:
        "No. ChemDFT enforces strict hosted limits: PySCF calculations are limited to 12 atoms for optimizations/orbitals and 6 atoms for frequencies/TDDFT, while xTB supports up to 50 atoms. Large macromolecules exceed hosted capacity and should be computed on local HPC clusters.",
    },
    {
      question: "Does the AI assistant calculate or fabricate the numbers?",
      answer:
        "Never. The AI Scientist plans workflows and explains terminology, but it is architecturally separated by the Scientific Result Firewall. Every number displayed comes strictly from deterministic open-source engine output files.",
    },
    {
      question: "How do I cite calculations run on ChemDFT?",
      answer:
        "Each calculation provides complete provenance, including the exact software version, pseudopotentials, basis sets, input hashes, and primary literature DOIs. Visit our How to Cite guide for standard BibTeX and publication formats.",
    },
  ],
  relatedPages: [
    {
      title: "PySCF Online",
      href: "/en/pyscf-online",
      reason: "Explore molecular DFT methods, basis sets, and on-demand cloud worker execution.",
    },
    {
      title: "Quantum ESPRESSO Online",
      href: "/en/quantum-espresso-online",
      reason: "Learn about plane-wave periodic DFT, band structures, and density of states.",
    },
    {
      title: "HOMO-LUMO Calculator",
      href: "/en/homo-lumo-calculator",
      reason: "See how genuine frontier orbital gaps are calculated with real stored PySCF data.",
    },
    {
      title: "Gaussian Alternative",
      href: "/en/gaussian-alternative",
      reason: "Review an honest comparison between ChemDFT and commercial Gaussian software.",
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* 2. GAUSSIAN ALTERNATIVE (/en/gaussian-alternative)                         */
/* -------------------------------------------------------------------------- */

const GAUSSIAN_ALTERNATIVE_DATA: SeoPageData = {
  slug: "gaussian-alternative",
  path: "/en/gaussian-alternative",
  title: "Gaussian replacement goal & current limits | ChemDFT",
  metaTitle: "Gaussian replacement goal & current limits | ChemDFT",
  metaDescription:
    "A full Gaussian replacement is a long-term goal. Today ChemDFT runs small systems within hosted limits: PySCF (6-12 atoms), xTB (50), and QE (20 atoms).",
  kicker: "Software Comparison",
  h1: "Free alternative to Gaussian for small molecules",
  lead:
    "Serving as an open Gaussian replacement across quantum chemistry workflows is a long-term goal for ChemDFT, not a present reality. Today, ChemDFT provides an accessible browser-based workstation for small-molecule calculations within modest, transparent hosted limits. Here is an honest, objective comparison of current capabilities, strict limits, and future goals.",
  limitsHeading: "What you can run, and the limits",
  limitsParagraphs: [
    ...COMMON_LIMITS_SECTION.paragraphs,
    `While Gaussian supports vast chemical systems up to 250,000 atoms (as documented on gaussian.com Model Chemistries), ChemDFT focuses specifically on small molecules and unit cells within tightly bounded hosted limits: PySCF up to ${HOSTED_LIMITS_SUMMARY.pyscfOptimization} atoms for optimization and orbitals (${HOSTED_LIMITS_SUMMARY.pyscfFrequencies} for frequencies/TDDFT), xTB up to ${HOSTED_LIMITS_SUMMARY.xtb} atoms, CREST up to ${HOSTED_LIMITS_SUMMARY.crest} atoms (neutral H/C/O singlets only), and Quantum ESPRESSO up to ${HOSTED_LIMITS_SUMMARY.quantumEspresso} atoms.`,
  ],
  sections: [
    {
      heading: "Comparing ChemDFT and Gaussian: an honest perspective",
      paragraphs: [
        "Gaussian is a mature commercial computational chemistry suite widely cited in academic and industrial research. Developed over decades, Gaussian offers electronic structure methods ranging from Hartree–Fock and DFT to CASSCF, coupled cluster theory (CCSD(T)), composite thermochemical models (G1–G4, CBS-QB3), and solvent continuum models. However, Gaussian is proprietary commercial software requiring paid institutional licenses, cluster administration, and manual input preparation.",
        `ChemDFT is not an exact clone or a present Gaussian replacement. Becoming an open Gaussian replacement across computational chemistry workflows is our long-term goal, not a present fact. Today, ChemDFT operates as an accessible web workstation for small molecular systems within strictly bounded hosted limits: PySCF up to ${HOSTED_LIMITS_SUMMARY.pyscfOptimization} atoms for optimization and orbitals (${HOSTED_LIMITS_SUMMARY.pyscfFrequencies} atoms for frequencies and TDDFT), xTB up to ${HOSTED_LIMITS_SUMMARY.xtb} atoms, CREST up to ${HOSTED_LIMITS_SUMMARY.crest} atoms (neutral H/C/O singlets only), and Quantum ESPRESSO up to ${HOSTED_LIMITS_SUMMARY.quantumEspresso} atoms. ChemDFT tracks immutable cryptographic provenance for every calculation without software licensing fees.`,
      ],
    },
    {
      heading: "Feature comparison: ChemDFT vs. Gaussian",
      paragraphs: [
        "To evaluate whether ChemDFT meets your computational needs, consider the key architectural and scientific distinctions:",
        "1. Licensing and Access: Gaussian is commercial software licensed per machine, site, or cluster. ChemDFT is free for researchers during the beta, accessible from any web browser without installation, credit cards, or user fees.",
        `2. System Scale: Official Gaussian documentation (gaussian.com Model Chemistries) lists program limits up to 250,000 atoms with linear-scaling methods. In contrast, ChemDFT focuses on small systems within transparent hosted limits: PySCF optimization ≤${HOSTED_LIMITS_SUMMARY.pyscfOptimization} atoms (frequencies/TDDFT ≤${HOSTED_LIMITS_SUMMARY.pyscfFrequencies} atoms), xTB ≤${HOSTED_LIMITS_SUMMARY.xtb} atoms, CREST ≤${HOSTED_LIMITS_SUMMARY.crest} atoms, and periodic cells ≤${HOSTED_LIMITS_SUMMARY.quantumEspresso} atoms. Serving as an open Gaussian replacement on large systems remains a long-term goal, not a present fact.`,
        "3. File Compatibility: ChemDFT cannot execute Gaussian input files (.gjf or .com) directly. However, ChemDFT incorporates cclib 1.8.1 to parse and import output log files from Gaussian 09, Gaussian 16, and ORCA 5.x–6.1, allowing you to visualize existing results and preserve provenance.",
        "4. Available Methods: ChemDFT provides PySCF 2.14.0 (HF, B3LYP, PBE with STO-3G, 6-31G, def2-SVP, def2-SVPD), GFN2-xTB, CREST conformer searches, and periodic Quantum ESPRESSO 7.6. Advanced methods present in Gaussian—such as coupled cluster (CCSD(T)), MP2, MP4, ONIOM multi-layer models, CASSCF, and specialized solvent reaction fields—are not hosted on ChemDFT.",
      ],
    },
    {
      heading: "Who should still use Gaussian?",
      paragraphs: [
        "Researchers with advanced electronic structure requirements should continue using Gaussian or dedicated high-performance computing clusters. You will need Gaussian if your research requires:",
        "• High-accuracy benchmark thermochemistry utilizing composite energy methods (CBS-QB3, G3, G4, or W1/W2 theory).",
        "• High-level electron correlation methods such as coupled cluster theory with single, double, and perturbative triple excitations (CCSD(T)).",
        "• Multi-reference systems, transition states requiring complete active space self-consistent field (CASSCF) wavefunctions, or conical intersections.",
        `• Macromolecular complexes, polymers, or explicit solvent cavities exceeding ChemDFT's hosted limits (${HOSTED_LIMITS_SUMMARY.pyscfOptimization} atoms for PySCF or ${HOSTED_LIMITS_SUMMARY.xtb} atoms for xTB).`,
        "• Complex implicit solvation models (such as SMD, PCM, or COSMO) that are not yet enabled on ChemDFT's hosted workers.",
      ],
    },
    {
      heading: "When ChemDFT is the right choice",
      paragraphs: [
        "ChemDFT is ideal when you need rapid, reliable quantum chemistry on small molecules without licensing hurdles. It is well-suited for:",
        "• Chemistry coursework where students explore molecular orbitals, vibrational frequencies, and dipoles without software friction.",
        "• Synthetic chemists checking whether a proposed intermediate has a viable HOMO–LUMO gap or reaction thermochemistry.",
        "• Quick screening of small organic conformers using GFN2-xTB and CREST before intensive cluster calculations.",
        "• Researchers who value cryptographic provenance, immutable execution records, and clean BibTeX citations.",
      ],
    },
    {
      heading: "Trademark notice",
      paragraphs: [
        "Gaussian is a registered trademark of Gaussian, Inc. ChemDFT has no affiliation with or endorsement from Gaussian, Inc. References to Gaussian are provided strictly for comparative purposes based on public documentation.",
      ],
    },
  ],
  faqs: [
    {
      question: "Can ChemDFT run my existing Gaussian input (.gjf or .com) files?",
      answer:
        "No. ChemDFT does not execute Gaussian input files. However, you can import Gaussian 09 and Gaussian 16 output files (.log or .out) into ChemDFT using our cclib-powered parser to visualize geometries, inspect vibrational frequencies, and preserve provenance.",
    },
    {
      question: "Does ChemDFT support coupled cluster (CCSD(T)) or MP2 calculations?",
      answer:
        "No. ChemDFT's hosted engines currently support Hartree–Fock, B3LYP, and PBE density functional theory via PySCF, semi-empirical GFN2-xTB, and periodic Quantum ESPRESSO. Post-Hartree–Fock correlation methods are not hosted.",
    },
    {
      question: "Why are ChemDFT's atom limits smaller than Gaussian's?",
      answer:
        "ChemDFT provides free cloud computing on dedicated AWS workers for all registered beta users. To keep compute resources fast, predictable, and fair without charging subscription fees, hosted atom limits are restricted to small molecules and unit cells.",
    },
    {
      question: "How does ChemDFT ensure calculations are authentic without a commercial license?",
      answer:
        "ChemDFT executes established, peer-reviewed open-source engines including PySCF (BSD-3-Clause), xTB (LGPL-3.0), and Quantum ESPRESSO (GPL-2.0). All calculations run with exact version tracking and SHA-256 cryptographic provenance.",
    },
  ],
  relatedPages: [
    {
      title: "Online DFT Calculations",
      href: "/en/dft-calculations",
      reason: "Discover what methods, basis sets, and tasks ChemDFT runs in the cloud.",
    },
    {
      title: "PySCF Online",
      href: "/en/pyscf-online",
      reason: "Explore PySCF 2.14.0 features, atom limits, and on-demand worker architecture.",
    },
    {
      title: "HOMO-LUMO Calculator",
      href: "/en/homo-lumo-calculator",
      reason: "Examine genuine frontier orbital energies computed with real PySCF quantum chemistry.",
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* 3. HOMO-LUMO CALCULATOR (/en/homo-lumo-calculator)                         */
/* -------------------------------------------------------------------------- */

const HOMO_LUMO_CALCULATOR_DATA: SeoPageData = {
  slug: "homo-lumo-calculator",
  path: "/en/homo-lumo-calculator",
  title: "HOMO-LUMO gap from a real DFT calculation | ChemDFT",
  metaTitle: "HOMO-LUMO gap from a real DFT calculation | ChemDFT",
  metaDescription:
    "Calculate genuine HOMO-LUMO energy gaps with real PySCF quantum chemistry instead of formula estimates. Provenance-backed orbital data.",
  kicker: "Frontier Molecular Orbitals",
  h1: "HOMO-LUMO gap from a real DFT calculation",
  lead:
    "Looking for a HOMO-LUMO gap calculator? Most web tools require you to manually enter orbital energies into a simple subtraction formula. ChemDFT performs a genuine quantum mechanical electronic structure calculation to determine real canonical orbital eigenvalues.",
  limitsHeading: "What you can run, and the limits",
  limitsParagraphs: [
    ...COMMON_LIMITS_SECTION.paragraphs,
    `Hosted molecular orbital calculations run via PySCF 2.14.0 and are capped at 12 atoms for closed-shell and open-shell molecules. Supported basis sets include STO-3G, 6-31G, def2-SVP, and def2-SVPD, with HF, B3LYP, and PBE functionals.`,
  ],
  sections: [
    {
      heading: "What are HOMO, LUMO, and the frontier orbital gap?",
      paragraphs: [
        "In frontier molecular orbital theory, pioneered by Kenichi Fukui and Roald Hoffmann, chemical reactivity and electronic properties are predominantly governed by the electrons in the outermost boundary orbitals. The Highest Occupied Molecular Orbital (HOMO) represents the least tightly bound valence electrons and acts as an electron donor during nucleophilic reactions. The Lowest Unoccupied Molecular Orbital (LUMO) represents the lowest vacant energy level available to accept incoming electron density during electrophilic attack.",
        "The HOMO–LUMO energy difference (ΔE = E_LUMO - E_HOMO) provides a fundamental qualitative metric of molecular chemical hardness, kinetic stability, and electronic polarizability. Molecules with a large frontier orbital gap (such as noble gases, saturated alkanes, and water) are chemically inert and require substantial excitation energy. Conversely, molecules with a narrow frontier orbital gap (such as conjugated polyenes, dyes, and organic semiconductors) exhibit high chemical reactivity, soft electronic clouds, and absorption wavelengths in the near-UV or visible spectrum.",
      ],
    },
    {
      heading: "Formula calculators vs. genuine quantum chemical calculations",
      paragraphs: [
        "A common point of confusion among students and researchers searching for a 'HOMO-LUMO calculator' is the difference between a trivial arithmetic formula and a genuine scientific calculation. A formula calculator takes numbers that you already know—for example, experimental ionization potentials, cyclic voltammetry redox potentials, or pre-computed eigenvalue numbers—and calculates the arithmetic difference: ΔE = E_LUMO - E_HOMO.",
        "That arithmetic difference is not an electronic structure calculation. To obtain those frontier orbital eigenvalues from scratch, a computational chemistry engine must solve the self-consistent field (SCF) equations for the specific nuclear geometry, charge, and spin state of the molecule. ChemDFT is a genuine computational engine: you provide the 3D molecular structure (or draw it in the built-in Ketcher editor), choose an electronic method and basis set, and ChemDFT calculates the self-consistent electron density, Hamiltonian matrix, and orbital eigenvalues in an isolated worker.",
      ],
    },
    {
      heading: "Real stored water calculation: proof from the ChemDFT repository",
      paragraphs: [
        `To demonstrate how genuine orbital energies appear in ChemDFT, consider the authentic stored calculation of a water molecule (${RUN.structure.formula}) exported directly from the ChemDFT test environment:`,
        `• System: ${RUN.title}, neutral singlet (${RUN.result.electron_count} electrons: ${RUN.result.alpha_electrons} alpha, ${RUN.result.beta_electrons} beta).`,
        `• Electronic Method: ${RUN.method.method} with the ${RUN.method.basis} basis set (${RUN.result.basis_functions} basis functions, ${RUN.result.molecular_orbitals} molecular orbitals).`,
        `• Engine: ${RUN.engine.name} ${RUN.engine.version} on ${RUN.engine.hardware_class} architecture, converged in ${RUN.result.scf_iterations} SCF iterations (threshold ${scientific(RUN.method.scf_convergence_threshold)}).`,
        `• Total Ground-State Energy: ${fixed(RUN.result.total_energy_hartree, 6)} Hartree.`,
        `• HOMO (Orbital #${RUN.result.homo.index}): ${fixed(RUN.result.homo.energy_hartree, 6)} Hartree (${fixed(RUN.result.homo.energy_ev, 3)} eV).`,
        `• LUMO (Orbital #${RUN.result.lumo.index}): ${fixed(RUN.result.lumo.energy_hartree, 6)} Hartree (${fixed(RUN.result.lumo.energy_ev, 3)} eV).`,
        `• Calculated Frontier Gap: ${fixed(RUN.result.gap_hartree, 6)} Hartree (${fixed(RUN.result.gap_ev, 3)} eV).`,
        `Every number listed above is read directly from reference/water-run-record.json in the repository and verified by automated unit tests. ChemDFT records the exact input hash (${RUN.provenance.calculation_input_sha256.slice(0, 16)}...) and result hash (${RUN.provenance.result_sha256.slice(0, 16)}...) so that any calculation can be cited, checked, and audited.`,
      ],
    },
    {
      heading: "Scientific caveat: orbital gap vs. optical excitation energy",
      paragraphs: [
        "In rigorous physical chemistry, it is essential to distinguish between a ground-state Kohn–Sham or Hartree–Fock orbital eigenvalue difference and a measurable optical bandgap or UV/Vis absorption wavelength. The Kohn–Sham HOMO–LUMO gap represents single-particle orbital energies derived from the ground-state Hamiltonian. It neglects electron-hole Coulomb attraction, exchange interaction, and orbital relaxation upon electronic excitation.",
        "Under Koopmans' theorem in Hartree–Fock theory, orbital energies approximate vertical ionization potentials and electron affinities, but the eigenvalue difference systematically overestimates optical excitation energies. In standard Kohn–Sham DFT using semilocal functionals (such as PBE or B3LYP), the eigenvalue gap often underestimates optical gaps due to self-interaction errors. For true optical transition energies, researchers should utilize Time-Dependent DFT (TDDFT), which ChemDFT supports for molecules up to 6 atoms.",
      ],
    },
  ],
  faqs: [
    {
      question: "Does ChemDFT calculate the HOMO-LUMO gap from my molecule, or do I enter numbers?",
      answer:
        "ChemDFT calculates the orbital gap from your molecular geometry. You draw or upload your molecule, choose your method and basis set, and PySCF calculates the real self-consistent orbital eigenvalues.",
    },
    {
      question: "Is the HOMO-LUMO gap identical to the UV/Vis absorption peak?",
      answer:
        "No. The HOMO-LUMO gap is an orbital eigenvalue difference. It does not account for electron-hole binding or orbital relaxation during excitation. For spectroscopic excitation energies, use ChemDFT's TDDFT task.",
    },
    {
      question: "Can I inspect the spatial shape of the molecular orbitals?",
      answer:
        "Yes. ChemDFT generates molecular orbital coefficients and allows you to inspect orbital occupations, energies, and symmetry labels directly within the scientific workstation.",
    },
    {
      question: "What is the largest molecule I can calculate orbital energies for?",
      answer:
        "On ChemDFT's hosted cloud workers, molecular orbital calculations with PySCF are capped at 12 atoms to preserve interactive performance for all researchers during the free beta.",
    },
  ],
  relatedPages: [
    {
      title: "Online DFT Calculations",
      href: "/en/dft-calculations",
      reason: "Learn more about the full suite of density functional theory tools on ChemDFT.",
    },
    {
      title: "PySCF Online",
      href: "/en/pyscf-online",
      reason: "Read about PySCF 2.14.0 configuration, basis sets, and cloud architecture.",
    },
    {
      title: "How to Cite",
      href: "/en/learn/cite",
      reason: "Learn how to properly cite PySCF and orbital calculations in scientific papers.",
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* 4. PYSCF ONLINE (/en/pyscf-online)                                         */
/* -------------------------------------------------------------------------- */

const PYSCF_ONLINE_DATA: SeoPageData = {
  slug: "pyscf-online",
  path: "/en/pyscf-online",
  title: "Run PySCF online, no installation | ChemDFT",
  metaTitle: "Run PySCF online, no installation | ChemDFT",
  metaDescription:
    "Execute PySCF 2.14.0 calculations directly in your browser. HF, B3LYP, and PBE functionals with standard basis sets and on-demand cloud workers.",
  kicker: "Hosted Quantum Chemistry",
  h1: "Run PySCF online, no installation",
  lead:
    "Run PySCF 2.14.0 directly in your browser without local Python environments, compilation hurdles, or cluster maintenance. ChemDFT executes genuine PySCF jobs in isolated cloud containers with verifiable cryptographic provenance.",
  limitsHeading: "What you can run, and the limits",
  limitsParagraphs: [
    ...COMMON_LIMITS_SECTION.paragraphs,
    `Hosted PySCF calculations are bounded by strict size caps: 12 atoms for ground-state energy, geometry optimization, and molecular orbitals; and 6 atoms for harmonic vibrational frequencies and time-dependent DFT (TDDFT).`,
  ],
  sections: [
    {
      heading: "What is PySCF?",
      paragraphs: [
        "The Python Simulations of Chemistry Framework (PySCF) is a state-of-the-art open-source quantum chemistry and solid-state physics codebase developed by an international consortium of computational chemists led by Qiming Sun and Garnet Kin-Lic Chan. Built with Python for modular workflow design and C/C++ libraries (such as libcint and Libxc) for high-performance numerical integrals, PySCF has become one of the most powerful and widely cited modern computational chemistry engines.",
        "PySCF excels in ground-state Hartree–Fock, Kohn–Sham density functional theory, molecular geometry optimization, vibrational frequencies, excited-state time-dependent DFT, and advanced electronic structure methods. While PySCF is freely available under the BSD-3-Clause open-source license, running it typically requires installing a complete Python science stack, configuring specialized C-extension dependencies, and managing local compute resources.",
      ],
    },
    {
      heading: "Hosted PySCF 2.14.0 capabilities in ChemDFT",
      paragraphs: [
        `ChemDFT hosts PySCF version 2.14.0 in standardized, reproducible Linux containers. Within ChemDFT, you can execute the following molecular electronic structure tasks:`,
        `1. Electronic Methods and Functionals: Ground-state Restricted Hartree–Fock (RHF), Unrestricted Hartree–Fock (UHF), the hybrid B3LYP functional (${SUPPORTED_METHODS[1]}), and the generalized gradient approximation PBE functional (${SUPPORTED_METHODS[2]}).`,
        `2. Standard Gaussian Basis Sets: Minimal STO-3G for rapid instructional demonstrations; Pople split-valence 6-31G for foundational studies; and Ahlrichs balanced def2-SVP and diffuse def2-SVPD basis sets for rigorous molecular geometry and orbital analysis.`,
        "3. Calculation Tasks: Single-point SCF electronic energy, equilibrium geometry relaxation using PySCF analytic gradients, harmonic vibrational frequencies and normal mode displacement vectors, canonical molecular orbital eigenvalues and occupations, Time-Dependent DFT (TDDFT) singlet excited states, and gas-phase thermochemical properties (enthalpy, entropy, and Gibbs free energy).",
      ],
    },
    {
      heading: "On-demand cloud worker infrastructure",
      paragraphs: [
        "ChemDFT does not run Python or PySCF inside your local web browser. Browser-based WebAssembly implementations of heavy quantum chemistry engines suffer from severe memory constraints, lack optimized linear algebra libraries (BLAS/LAPACK), and struggle with multi-threading.",
        "Instead, ChemDFT connects your browser to dedicated AWS compute instances running hardened Linux worker containers. When you submit an approved calculation, an on-demand worker spins up, retrieves the normalized calculation parameters, executes PySCF with optimized BLAS libraries, and generates the raw output and checkpoint files. To optimize research funding and operational costs, the compute worker remains active during continuous use and automatically powers off after approximately fifteen minutes of idle time. Subsequent jobs submitted while the worker is asleep will experience a brief initialization window while the container boots.",
      ],
    },
    {
      heading: "Molecular geometry optimization and geomeTRIC note",
      paragraphs: [
        "For molecular geometry optimization, ChemDFT couples PySCF electronic energy gradients with the geomeTRIC 1.1.1 coordinate optimizer developed by Lee-Ping Wang. geomeTRIC utilizes translation-rotation internal coordinates (TRIC) to achieve robust, rapid convergence to local minima on the potential energy surface. As noted across the ChemDFT site, geomeTRIC optimizes molecular geometries using PySCF gradients; periodic crystal structures are not optimized with it.",
        "Hosted geometry optimization is enabled under explicit owner decision. The geomeTRIC 1.1.1 license includes a non-AI clause (clause 4), and whether this clause applies to general platform execution remains an open legal decision. ChemDFT maintains complete transparency regarding software licensing across its entire stack.",
      ],
    },
    {
      heading: "Scientific integrity and immutable provenance",
      paragraphs: [
        "In ChemDFT, every PySCF job is cryptographically bounded. The normalized input file is hashed with SHA-256 before submission. Upon completion, the raw engine logs, total energies, convergence iterations, and orbital coefficients are validated by the Scientific Result Firewall. If an SCF calculation fails to converge within the allotted iteration limit (default 100 cycles), the result is flagged as unconverged and refused publication as authoritative data.",
        "AI models assist you with planning basis sets and troubleshooting convergence errors, but they cannot edit or author calculation numbers. Every value you see in the interface is read directly from genuine PySCF output files.",
      ],
    },
  ],
  faqs: [
    {
      question: "Do I need to install Python, conda, or PySCF on my computer?",
      answer:
        "No. You do not need to install Python, PySCF, or any compilers. All calculations run on ChemDFT's cloud compute workers, and you interact with the system entirely through your web browser.",
    },
    {
      question: "How long does a PySCF job take to run on ChemDFT?",
      answer:
        "Small single-point calculations (such as water or benzene with minimal basis sets) complete in seconds. If the cloud worker is currently powered off, allow approximately 1 to 2 minutes for container initialization.",
    },
    {
      question: "What basis sets are supported for PySCF calculations?",
      answer:
        "ChemDFT currently supports STO-3G, 6-31G, def2-SVP, and def2-SVPD in gas-phase molecular calculations. Additional basis sets are evaluated in accordance with our hosted validation roadmap.",
    },
    {
      question: "Can I download the raw PySCF output and log files?",
      answer:
        "Yes. Every calculation preserves its raw engine log files, input parameters, and convergence records, which can be inspected directly in the workspace or exported for publication.",
    },
  ],
  relatedPages: [
    {
      title: "Online DFT Calculations",
      href: "/en/dft-calculations",
      reason: "Discover how PySCF fits into the broader ChemDFT computational chemistry platform.",
    },
    {
      title: "HOMO-LUMO Calculator",
      href: "/en/homo-lumo-calculator",
      reason: "Review real PySCF-calculated frontier orbital energies and eigenvalue gaps.",
    },
    {
      title: "Gaussian Alternative",
      href: "/en/gaussian-alternative",
      reason: "Compare PySCF cloud capabilities with traditional commercial quantum chemistry software.",
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* 5. QUANTUM ESPRESSO ONLINE (/en/quantum-espresso-online)                   */
/* -------------------------------------------------------------------------- */

const QUANTUM_ESPRESSO_ONLINE_DATA: SeoPageData = {
  slug: "quantum-espresso-online",
  path: "/en/quantum-espresso-online",
  title: "Quantum ESPRESSO online: DOS and band structure | ChemDFT",
  metaTitle: "Quantum ESPRESSO online: DOS and band structure | ChemDFT",
  metaDescription:
    "Run periodic Quantum ESPRESSO 7.6 calculations online. Compute electronic density of states, band structures, and collinear magnetic orderings.",
  kicker: "Periodic Materials Modeling",
  h1: "Quantum ESPRESSO online: DOS and band structure",
  lead:
    "Perform plane-wave periodic DFT calculations for crystalline solids in your browser. Powered by Quantum ESPRESSO 7.6 and SSSP pseudopotentials, ChemDFT computes total energies, electronic density of states, and band structures with full provenance.",
  limitsHeading: "What you can run, and the limits",
  limitsParagraphs: [
    ...COMMON_LIMITS_SECTION.paragraphs,
    `Hosted Quantum ESPRESSO calculations are strictly limited to unit cells containing at most 20 atoms. Plane-wave energy cutoffs are standardized to ecutwfc 45 Ry and ecutrho 540 Ry. Cell relaxation (variable-cell vc-relax), external stress tensors, phonon dispersions, hybrid functionals (such as HSE06), and spin–orbit coupling are not available on hosted workers.`,
  ],
  sections: [
    {
      heading: "Plane-wave periodic DFT for crystals and solids",
      paragraphs: [
        "Quantum ESPRESSO (opEn-Source Package for Research in Electronic Structure, Simulation, and Optimization) is one of the premier open-source scientific software suites for quantum modeling of materials. Developed by an international collaboration coordinated by the Quantum ESPRESSO Foundation, it implements periodic density functional theory using a plane-wave basis set and pseudopotentials.",
        "Unlike molecular quantum chemistry codes that expand electron orbitals using localized atom-centered Gaussian basis functions, plane-wave DFT expands wavefunctions in Fourier components across a 3D periodic Bravais lattice. This approach is mathematically natural for crystals, surfaces, and bulk solid-state materials, providing seamless handling of periodic boundary conditions and crystal symmetry without basis set superposition errors (BSSE).",
      ],
    },
    {
      heading: "Hosted Quantum ESPRESSO 7.6 features in ChemDFT",
      paragraphs: [
        "ChemDFT hosts Quantum ESPRESSO version 7.6, configured with optimized plane-wave solvers (pw.x) and post-processing utilities (dos.x, bands.x, projwfc.x). Key capabilities include:",
        "1. Pseudopotentials: Pre-configured with the Standard Solid State Pseudopotentials (SSSP) PBE Efficiency v2.0 library, utilizing verified ultrasoft pseudopotentials and PAW datasets across the periodic table with fixed, robust cutoffs (45 Ry wavefunction cutoff, 540 Ry charge density cutoff).",
        "2. Functionals and Hubbard U: Supports the Perdew–Burke–Ernzerhof (PBE) generalized gradient functional, as well as DFT+U calculations using the Dudarev rotationally invariant formulation to treat strong electronic correlation in transition metal d-orbitals.",
        "3. Collinear Magnetism: Enables non-magnetic, ferromagnetic, and antiferromagnetic initial spin configurations, recording Löwdin atomic magnetic moments (μB) and total cell magnetization.",
        "4. Electronic Structure Properties: Computes total ground-state energies, relaxation of atomic internal coordinates at fixed lattice volume, total electronic Density of States (DOS), and electronic band structures along high-symmetry k-paths generated automatically from the crystal symmetry by pymatgen.",
        "5. Brillouin Zone Sampling: Supports Monkhorst–Pack k-point meshes from Γ-only up to 4×4×4 grids with Fermi–Dirac thermal smearing.",
      ],
    },
    {
      heading: "Validation evidence: the α-Cr2O3 benchmark",
      paragraphs: [
        `ChemDFT's Quantum ESPRESSO implementation is verified against independent direct engine runs under identical containerized environments. On the Validation page, ChemDFT documents a published benchmark on ${VALIDATION_RUN.system}:`,
        `• System: ${VALIDATION_RUN.system}, computed with ${VALIDATION_RUN.engine} and ${VALIDATION_RUN.library}.`,
        `• Computational Settings: ${VALIDATION_RUN.settings[0]![0]}: ${VALIDATION_RUN.settings[0]![1]}; ${VALIDATION_RUN.settings[1]![0]}: ${VALIDATION_RUN.settings[1]![1]}; ${VALIDATION_RUN.settings[2]![0]}: ${VALIDATION_RUN.settings[2]![1]}; ${VALIDATION_RUN.settings[3]![0]}: ${VALIDATION_RUN.settings[3]![1]}.`,
        `• Container Image: ${VALIDATION_RUN.settings[5]![1]}, Platform: ${VALIDATION_RUN.settings[4]![1]}.`,
        `• Benchmark Comparison: The calculation submitted through the live platform (${VALIDATION_RUN.liveRef}) produced a total energy of ${VALIDATION_RUN.rows[0]![1]} in ${VALIDATION_RUN.rows[1]![1]} iterations, with a Fermi energy of ${VALIDATION_RUN.rows[2]![1]} and Löwdin Cr magnetic moments of ${VALIDATION_RUN.rows[3]![1]}.`,
        `• Direct Engine Check: Running the exact same pw.x input file directly in the standalone container produced an identical total energy of ${VALIDATION_RUN.rows[0]![2]}, identical SCF iterations (${VALIDATION_RUN.rows[1]![2]}), Fermi energy of ${VALIDATION_RUN.rows[2]![2]}, and the exact same atomic moments.`,
        "This benchmark confirms that ChemDFT's input generation, execution wrapper, and output parsing are mathematically exact and reproducible. As stated in our validation principles, this confirms software execution integrity; it does not claim literature agreement across different codes.",
      ],
    },
    {
      heading: "Explicit limitations of hosted periodic calculations",
      paragraphs: [
        "In keeping with ChemDFT's commitment to scientific transparency, several advanced periodic capabilities are explicitly unavailable on hosted workers:",
        "• Variable-cell relaxation (vc-relax) and cell shape optimization are not supported; lattice vectors remain fixed to the imported CIF coordinates.",
        "• External mechanical stress tensors and pressure calculations are not evaluated.",
        "• Phonon dispersions, vibrational thermodynamics, and electron-phonon coupling via DFPT are not hosted.",
        "• Hybrid functionals (such as HSE06, PBE0, or B3LYP for solids) and spin-orbit coupling are disabled due to intensive compute requirements.",
        "• Unit cells are strictly capped at 20 atoms. Researchers modeling large supercells, defect clusters, or complex interface slabs should export their structures to local HPC clusters.",
      ],
    },
  ],
  faqs: [
    {
      question: "Can I optimize the lattice constants and cell angles of my crystal?",
      answer:
        "No. ChemDFT supports ionic relaxation of internal atomic positions, but the unit cell vectors and volume remain fixed to the imported crystal reference. Variable-cell relaxation (vc-relax) is not available.",
    },
    {
      question: "How does ChemDFT determine the k-path for band structures?",
      answer:
        "ChemDFT utilizes pymatgen 2025.10.7 to identify the crystal space group and generate standard high-symmetry Brillouin zone paths (such as the Setyawan–Curtarolo convention) automatically.",
    },
    {
      question: "What pseudopotential library is used by Quantum ESPRESSO on ChemDFT?",
      answer:
        "ChemDFT uses the Standard Solid State Pseudopotentials (SSSP) PBE Efficiency v2.0 library, which provides thoroughly benchmarked ultrasoft and PAW datasets with verified energy cutoffs.",
    },
    {
      question: "What is the atom limit for crystal calculations?",
      answer:
        "The hosted limit is 20 atoms per unit cell. Calculations exceeding 20 atoms are blocked prior to submission to maintain responsive cloud performance for all researchers.",
    },
  ],
  relatedPages: [
    {
      title: "Platform Validation",
      href: "/en/validation",
      reason: "Read the complete Cr2O3 benchmark comparing ChemDFT to direct Quantum ESPRESSO runs.",
    },
    {
      title: "Online DFT Calculations",
      href: "/en/dft-calculations",
      reason: "Explore all supported molecular and periodic electronic structure methods.",
    },
    {
      title: "PySCF Online",
      href: "/en/pyscf-online",
      reason: "Learn about molecular quantum chemistry and on-demand cloud worker execution.",
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* 6. WEBMO ALTERNATIVE (/en/webmo-alternative)                               */
/* -------------------------------------------------------------------------- */

const WEBMO_ALTERNATIVE_DATA: SeoPageData = {
  slug: "webmo-alternative",
  path: "/en/webmo-alternative",
  title: "WebMO alternative: free browser quantum chemistry | ChemDFT",
  metaTitle: "WebMO alternative: free browser quantum chemistry | ChemDFT",
  metaDescription:
    "Looking for a WebMO alternative? ChemDFT is a free browser-based front end for quantum chemistry with zero server setup, within modest hosted limits.",
  kicker: "Software Comparison",
  h1: "WebMO alternative: browser quantum chemistry without server setup",
  lead:
    "Looking for a WebMO alternative? ChemDFT provides a free browser-based front end for quantum chemistry that runs directly in your web browser with zero server installation. Here is an honest, objective comparison of capabilities, infrastructure requirements, and hosted boundaries.",
  limitsHeading: "What you can run, and the limits",
  limitsParagraphs: [
    ...COMMON_LIMITS_SECTION.paragraphs,
    `Hosted calculations on ChemDFT run on isolated cloud workers with strict boundaries: PySCF 2.14.0 is limited to ${HOSTED_LIMITS_SUMMARY.pyscfOptimization} atoms for geometry optimisation and molecular orbitals, and ${HOSTED_LIMITS_SUMMARY.pyscfFrequencies} atoms for vibrational frequencies and TDDFT; xTB 6.7.1 is capped at ${HOSTED_LIMITS_SUMMARY.xtb} atoms; CREST 3.0.2 is limited to ${HOSTED_LIMITS_SUMMARY.crest} atoms for neutral H/C/O singlets; and Quantum ESPRESSO 7.6 accommodates unit cells up to ${HOSTED_LIMITS_SUMMARY.quantumEspresso} atoms.`,
  ],
  sections: [
    {
      heading: "Comparing ChemDFT and WebMO: an honest evaluation",
      paragraphs: [
        "WebMO is a web interface installed on a server. WebMO Basic is free.",
        "ChemDFT takes a different architectural approach. ChemDFT is a web-native scientific workstation that runs directly in your web browser with zero server installation. Instead of hosting an interface on your own hardware, ChemDFT provides managed cloud execution on on-demand worker instances. Calculations run inside isolated Linux containers, and every result is cryptographically signed with complete provenance.",
        "ChemDFT does not replace existing institutional cluster setups. Instead, it serves as a lightweight alternative for researchers, educators, and students who want to perform quantum calculations immediately without system administration.",
      ],
    },
    {
      heading: "Key differences: zero setup, hosted limits, and provenance",
      paragraphs: [
        "When evaluating whether ChemDFT or WebMO fits your laboratory, consider these operational distinctions:",
        "1. Server Installation vs. Zero Setup: WebMO is a web interface installed on a server. WebMO Basic is free. Because WebMO is installed on a server, running it requires your own server environment. ChemDFT requires zero server installation: open your browser, sign in with Google, and begin calculations immediately on hosted cloud workers.",
        "2. Compute Infrastructure: Because WebMO is installed on a server, computations execute on your own server hardware. ChemDFT provides on-demand AWS cloud compute workers for registered beta users, managing worker spin-up and automatic shutdown transparently.",
        `3. System Size Limits: Because ChemDFT provides free compute on shared infrastructure, calculation sizes are strictly bounded: PySCF optimization ≤${HOSTED_LIMITS_SUMMARY.pyscfOptimization} atoms (frequencies/TDDFT ≤${HOSTED_LIMITS_SUMMARY.pyscfFrequencies} atoms), semi-empirical xTB ≤${HOSTED_LIMITS_SUMMARY.xtb} atoms, CREST conformer searches ≤${HOSTED_LIMITS_SUMMARY.crest} atoms (neutral H/C/O singlets), and Quantum ESPRESSO ≤${HOSTED_LIMITS_SUMMARY.quantumEspresso} atoms. On your own server, calculations are limited only by your own hardware capacity if your server supports them.`,
        "4. Provenance and Scientific Integrity: ChemDFT permanently seals every calculation with SHA-256 hashes of raw input files and engine outputs, tracking exact software versions, basis sets, and pseudopotentials. Built-in AI assistance is separated by the Scientific Result Firewall, guaranteeing that the model never authors or modifies numerical data.",
      ],
    },
    {
      heading: "Where WebMO may suit a laboratory better",
      paragraphs: [
        "Because WebMO is installed on a server, it may suit a research group or academic department better in scenarios that follow from running on your own server:",
        "• Your laboratory maintains its own server hardware or local computing infrastructure and prefers running software directly on it.",
        `• Your research involves larger systems that exceed ChemDFT's hosted limits of ${HOSTED_LIMITS_SUMMARY.pyscfOptimization} atoms for PySCF DFT or ${HOSTED_LIMITS_SUMMARY.xtb} atoms for xTB, and your server supports them.`,
        "• Institutional policy requires all molecular structures, inputs, and calculation data to remain on your own server hardware.",
      ],
    },
    {
      heading: "What ChemDFT cannot do",
      paragraphs: [
        "To maintain clear expectations, researchers should note what ChemDFT cannot do:",
        "• ChemDFT cannot connect to your private university servers or submit jobs to local Slurm or PBS queues.",
        "• ChemDFT cannot run proprietary commercial engines like Gaussian, Q-Chem, or Molpro; it executes open-source engines (PySCF, xTB, CREST, Quantum ESPRESSO).",
        `• ChemDFT cannot run calculations exceeding our hosted limits (${HOSTED_LIMITS_SUMMARY.pyscfOptimization} atoms for PySCF DFT optimization, ${HOSTED_LIMITS_SUMMARY.pyscfFrequencies} atoms for frequencies, ${HOSTED_LIMITS_SUMMARY.xtb} atoms for xTB, ${HOSTED_LIMITS_SUMMARY.crest} atoms for CREST, or ${HOSTED_LIMITS_SUMMARY.quantumEspresso} atoms for Quantum ESPRESSO).`,
        "• ChemDFT cannot substitute for independent scientific verification before publication.",
        "If you require comprehensive density functional theory on small molecules, explore our /en/dft-calculations page or review our honest /en/gaussian-alternative overview.",
      ],
    },
  ],
  faqs: [
    {
      question: "Do I need to install any server software to use ChemDFT?",
      answer:
        "No. Unlike WebMO, which is a web interface installed on a server, ChemDFT runs entirely in your web browser with zero server setup. All compute executes on ChemDFT's managed cloud workers.",
    },
    {
      question: "Is WebMO Basic free, and is ChemDFT free?",
      answer:
        "WebMO Basic is free software that you install on your own server. ChemDFT is free for researchers and students during the public beta, providing hosted cloud compute without software licenses or server hardware.",
    },
    {
      question: "Can ChemDFT submit jobs to my university's computational cluster?",
      answer:
        "No. ChemDFT does not interface with local campus clusters or queue managers. All hosted jobs run on ChemDFT's dedicated AWS cloud workers within published atom limits.",
    },
    {
      question: "How does execution differ between ChemDFT and WebMO?",
      answer:
        "WebMO is a web interface installed on a server, so computations run on your own server hardware. ChemDFT directly hosts open-source engines in the cloud (PySCF 2.14.0 for molecular DFT, xTB 6.7.1, CREST 3.0.2, and Quantum ESPRESSO 7.6 for periodic solids), requiring zero server setup.",
    },
  ],
  relatedPages: [
    {
      title: "Online DFT Calculations",
      href: "/en/dft-calculations",
      reason: "Explore supported molecular DFT methods in PySCF and periodic DFT in Quantum ESPRESSO.",
    },
    {
      title: "Gaussian Software Comparison",
      href: "/en/gaussian-alternative",
      reason: "Read our transparent assessment of Gaussian capabilities, trade-offs, and long-term goals.",
    },
    {
      title: "PySCF Online",
      href: "/en/pyscf-online",
      reason: "Discover how PySCF 2.14.0 runs in the cloud with zero local software installation.",
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* 7. XTB ONLINE (/en/xtb-online)                                             */
/* -------------------------------------------------------------------------- */

const XTB_ONLINE_DATA: SeoPageData = {
  slug: "xtb-online",
  path: "/en/xtb-online",
  title: "xTB online: GFN2-xTB calculator in the browser | ChemDFT",
  metaTitle: "xTB online: GFN2-xTB calculator in the browser | ChemDFT",
  metaDescription:
    "Run xTB online with ChemDFT: an interactive GFN2-xTB calculator in the browser for semi-empirical energy and geometry optimisation up to 50 atoms.",
  kicker: "Semi-Empirical Quantum Mechanics",
  h1: "xTB online: GFN2-xTB calculator in your browser",
  lead:
    "Run xTB online directly in your browser with ChemDFT. Access an interactive GFN2-xTB calculator in the browser for rapid semi-empirical single-point energy and geometry optimisation up to 50 atoms without local software installation.",
  limitsHeading: "What you can run, and the limits",
  limitsParagraphs: [
    ...COMMON_LIMITS_SECTION.paragraphs,
    `For semi-empirical calculations, ChemDFT hosts xTB 6.7.1 with a strict size limit of ${HOSTED_LIMITS_SUMMARY.xtb} atoms for single-point energy calculations and geometry optimisation. In contrast, molecular DFT in PySCF 2.14.0 is limited to ${HOSTED_LIMITS_SUMMARY.pyscfOptimization} atoms (${HOSTED_LIMITS_SUMMARY.pyscfFrequencies} atoms for frequencies and TDDFT), CREST 3.0.2 to ${HOSTED_LIMITS_SUMMARY.crest} atoms (neutral H/C/O singlets only), and Quantum ESPRESSO 7.6 to ${HOSTED_LIMITS_SUMMARY.quantumEspresso} atoms.`,
  ],
  sections: [
    {
      heading: "Understanding xTB: semi-empirical tight-binding, not ab initio DFT",
      paragraphs: [
        "The extended tight-binding (xTB) methodology, developed by Stefan Grimme and his research group at the University of Bonn, is a family of semi-empirical quantum mechanical methods designed for rapid structural and energetic characterization of molecular systems. It is vital to emphasize a fundamental scientific distinction: xTB is a semi-empirical method, not density functional theory (DFT).",
        "While ab initio DFT calculates electron-electron repulsion integrals and exchange-correlation energies from first principles using numerical integration grids and atomic basis sets, semi-empirical tight-binding methods drastically simplify the Hamiltonian. In xTB, two-electron integrals and core repulsions are approximated using empirical parameter sets calibrated against high-level quantum mechanical benchmarks and experimental reference data. Specifically, the GFN2-xTB parametrization (Geometry, Frequency, and Non-covalent interactions) includes self-consistent charge equilibration, atomic orbital-dependent dipole and quadrupole terms, and D4 dispersion corrections.",
        "Because of these physical approximations, GFN2-xTB evaluates total energies and analytical nuclear gradients generally much faster than DFT, at lower accuracy. However, because it relies on parameterization, it does not achieve the systematic basis-set convergence or first-principles reliability of ab initio DFT.",
      ],
    },
    {
      heading: "What runs on ChemDFT: GFN2-xTB energy and geometry optimisation",
      paragraphs: [
        "ChemDFT provides access to genuine xTB 6.7.1 running inside containerized Linux cloud environments on AWS pilot instances. Researchers can utilize the interactive workstation to prepare molecular coordinates using the Ketcher structure editor, import 3D SDF or XYZ files, and launch xTB calculations with a single click.",
        "Currently, ChemDFT supports two core xTB calculation tasks: single-point total energy evaluation and unconstrained geometry optimisation. Both tasks utilize the standard GFN2-xTB Hamiltonian. For single-point runs, xTB computes electronic energies, frontier orbital eigenvalues, and atomic partial charges in seconds. For geometry optimisation, the engine iteratively relaxes nuclear coordinates until the Cartesian gradient norms and energy differences satisfy standard convergence criteria.",
        `Every calculation is bounded by ChemDFT's strict hosted limit of ${HOSTED_LIMITS_SUMMARY.xtb} atoms. This generous capacity accommodates moderately sized organic molecules, drug-like compounds, organocatalysts, and coordination complexes that would require prohibitive computing time under ab initio DFT. Every run is immutably archived with complete raw output logs, input coordinate hashes, and software version stamps.`,
      ],
    },
    {
      heading: "What ChemDFT cannot do with xTB",
      paragraphs: [
        "To maintain scientific integrity and manage shared computing resources, ChemDFT explicitly bounds its xTB capabilities:",
        `• ChemDFT cannot run xTB calculations on systems exceeding the ${HOSTED_LIMITS_SUMMARY.xtb}-atom hosted limit. Macromolecules, large peptides, and extended solvent clusters exceed worker memory and runtime quotas.`,
        "• ChemDFT cannot compute vibrational frequencies, thermodynamic thermochemistry (free energy corrections), or transition-state searches using xTB in the current hosted beta configuration.",
        "• ChemDFT cannot perform molecular dynamics simulations (xTB MD) or metadynamics using standalone xTB. For conformational exploration, use our dedicated CREST integration.",
        "• ChemDFT cannot replace rigorous DFT when benchmark thermochemical accuracy or electronic spectrum predictions are required. Semi-empirical geometries and energies should be regarded as preliminary screening data. When publication-grade DFT results are needed, researchers should transition to our /en/dft-calculations workflows or consult our /en/gaussian-alternative guide.",
        "• ChemDFT cannot accept non-standard parameter sets, custom external command-line flags, or older xTB variants (such as GFN1-xTB or GFN0-xTB).",
      ],
    },
    {
      heading: "Practical workflows: combining xTB screening with DFT verification",
      paragraphs: [
        "In modern computational chemistry, the most effective workflow pairs fast semi-empirical screening with high-accuracy ab initio verification. ChemDFT is uniquely architected to support this multi-tier approach within a single web workstation.",
        "Researchers typically begin by drawing or importing a candidate molecular structure and running a rapid GFN2-xTB geometry optimisation. Within seconds, the 50-atom calculator removes steric clashes, relaxes distorted bond lengths, and produces a realistic 3D equilibrium conformation. Once the geometry is pre-optimized, the researcher can seamlessly transition the relaxed structure into PySCF 2.14.0 for single-point DFT refinement using B3LYP or PBE with polarized basis sets (up to 12 atoms).",
        "This tiered protocol drastically reduces overall computational effort while ensuring that final reported numbers carry the full rigorous validity of first-principles electronic structure theory.",
      ],
    },
  ],
  faqs: [
    {
      question: "Is xTB the same as Density Functional Theory (DFT)?",
      answer:
        "No. xTB is a semi-empirical tight-binding method, not ab initio DFT. It uses empirical parameterizations to approximate quantum mechanical integrals, making it generally much faster than DFT, at lower accuracy.",
    },
    {
      question: "What is the maximum molecular size for xTB calculations on ChemDFT?",
      answer:
        "ChemDFT enforces a strict hosted limit of 50 atoms for GFN2-xTB single-point energy and geometry optimisation calculations on its free cloud workers.",
    },
    {
      question: "What xTB tasks can I run in my browser?",
      answer:
        "ChemDFT currently hosts single-point energy evaluations and geometry optimisations using xTB 6.7.1 with the GFN2-xTB Hamiltonian. Vibrational frequencies and molecular dynamics are not currently enabled.",
    },
    {
      question: "How should I cite xTB calculations performed on ChemDFT?",
      answer:
        "Calculations should cite the primary GFN2-xTB paper (Bannwarth, Ehlert, Grimme, J. Chem. Theory Comput. 2019) and ChemDFT. Complete BibTeX citations are available in each calculation's provenance panel.",
    },
  ],
  relatedPages: [
    {
      title: "Online DFT Calculations",
      href: "/en/dft-calculations",
      reason: "Refine your pre-optimized xTB geometries with rigorous ab initio PySCF DFT.",
    },
    {
      title: "Gaussian Software Comparison",
      href: "/en/gaussian-alternative",
      reason: "Compare hosted semi-empirical and DFT methods with commercial chemistry suites.",
    },
    {
      title: "CREST Conformer Search Online",
      href: "/en/crest-conformer-search-online",
      reason: "Explore conformational ensembles using CREST powered by GFN2-xTB metadynamics.",
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* 8. CREST CONFORMER SEARCH ONLINE (/en/crest-conformer-search-online)       */
/* -------------------------------------------------------------------------- */

const CREST_CONFORMER_SEARCH_ONLINE_DATA: SeoPageData = {
  slug: "crest-conformer-search-online",
  path: "/en/crest-conformer-search-online",
  title: "CREST conformer search online in your browser | ChemDFT",
  metaTitle: "CREST conformer search online in your browser | ChemDFT",
  metaDescription:
    "Run CREST conformer search online in your browser. Hosted exploration for neutral H, C, and O singlet molecules up to 12 atoms with verified provenance.",
  kicker: "Conformational Analysis",
  h1: "CREST conformer search online in your browser",
  lead:
    "Run CREST conformer search online directly in your browser with ChemDFT. Hosted conformational exploration is strictly limited to neutral singlet molecules containing only hydrogen, carbon, and oxygen (H, C, O) up to 12 atoms, providing transparent, reproducible ensembles with immutable provenance.",
  limitsHeading: "What you can run, and the limits",
  limitsParagraphs: [
    ...COMMON_LIMITS_SECTION.paragraphs,
    `Conformational exploration using CREST 3.0.2 is strictly restricted up front to neutral singlet molecules containing exclusively hydrogen, carbon, and oxygen (H, C, O) up to ${HOSTED_LIMITS_SUMMARY.crest} atoms. For other tasks, ChemDFT supports semi-empirical xTB 6.7.1 up to ${HOSTED_LIMITS_SUMMARY.xtb} atoms, molecular PySCF 2.14.0 up to ${HOSTED_LIMITS_SUMMARY.pyscfOptimization} atoms for optimization and orbitals (${HOSTED_LIMITS_SUMMARY.pyscfFrequencies} atoms for frequencies and TDDFT), and periodic Quantum ESPRESSO 7.6 up to ${HOSTED_LIMITS_SUMMARY.quantumEspresso} atoms.`,
  ],
  sections: [
    {
      heading: "Understanding CREST and the hosted conformational search boundaries",
      paragraphs: [
        "The Conformer-Rotamer Ensemble Sampling Tool (CREST), developed by Philipp Pracht, Fabian Bohle, and Stefan Grimme at the University of Bonn, is an established computational engine for exploring the conformational space of flexible molecules. CREST employs metadynamics (MTD) simulations and genetic structural crossing algorithms powered by the semi-empirical GFN2-xTB engine to systematically traverse torsional energy barriers and identify low-energy conformational minima.",
        `On ChemDFT's hosted cloud workers, CREST 3.0.2 is strictly bounded: it is available exclusively for neutral singlet molecules composed entirely of hydrogen, carbon, and oxygen up to ${HOSTED_LIMITS_SUMMARY.crest} atoms. Any input structure that contains other chemical elements (such as nitrogen, halogens, sulfur, or transition metals), carries an electric charge (cations or anions), possesses unpaired electron spin (radicals or triplets), or exceeds ${HOSTED_LIMITS_SUMMARY.crest} atoms is rejected before submission.`,
        "These transparent constraints ensure that automated conformational searches complete reliably within shared cloud compute timeouts while providing researchers and chemistry students with an accessible tool for exploring the stereochemistry of small organic molecules.",
      ],
    },
    {
      heading: "How CREST conformational search executes on ChemDFT cloud workers",
      paragraphs: [
        "When you initiate a CREST conformer search in ChemDFT, the workflow operates deterministically inside an isolated Linux container on an Amazon Web Services (AWS) pilot compute worker. The process follows several distinct phases:",
        "1. Input Validation: The server verifies that the molecular structure consists strictly of neutral singlet hydrocarbons or oxygenates (H, C, O only) and contains no more than 12 atoms. Charge and multiplicity are verified to ensure zero charge and singlet state.",
        "2. Metadynamics Sampling: CREST executes iterative metadynamics simulations with GFN2-xTB, applying history-dependent bias potentials to push the molecule out of local energy wells and over rotational barriers.",
        "3. Geometry Optimization and Filtering: Newly discovered structural geometries are optimized with GFN2-xTB. Redundant conformers and rotamers are identified using root-mean-square deviation (RMSD) geometry clustering and energy window thresholds.",
        "4. Provenance and Ensemble Storage: The resulting low-energy conformational ensemble, relative energies (in kcal/mol or hartree), and complete engine log files are permanently preserved through the Scientific Result Firewall with SHA-256 cryptographic hashes.",
      ],
    },
    {
      heading: "What ChemDFT cannot do with CREST",
      paragraphs: [
        "To prevent confusion and ensure scientific honesty, researchers should note what ChemDFT cannot do with CREST:",
        `• ChemDFT cannot run CREST on molecules containing any element other than hydrogen, carbon, and oxygen. Nitrogen-containing amines, halogenated compounds, thiols, and coordination complexes cannot be computed in the hosted setup.`,
        "• ChemDFT cannot run charged species, radical ions, or open-shell triplet states. All inputs must be neutral singlets.",
        `• ChemDFT cannot run conformer searches on molecules larger than ${HOSTED_LIMITS_SUMMARY.crest} atoms on hosted cloud workers. Larger flexible molecules require extensive sampling times that exceed our 15-minute worker session caps.`,
        "• ChemDFT cannot execute user-defined bash scripts, custom bias potentials, or specialized solvent MTD constraints.",
        "• ChemDFT cannot replace rigorous DFT for final conformer ranking. GFN2-xTB relative energies provide approximate rankings; publication-quality thermochemistry requires re-optimizing candidate conformers with ab initio DFT using our /en/dft-calculations tools or comparing with software reviewed in our /en/gaussian-alternative article.",
      ],
    },
    {
      heading: "Ideal research and educational applications for hosted CREST",
      paragraphs: [
        "Despite its modest size limits, ChemDFT's hosted CREST integration provides immense value for standard stereochemical and educational investigations. It is particularly well-suited for:",
        "• Exploring the conformational landscape of small alcohols (such as propanol, isopropanol, or butanediol isomers) and assessing internal hydrogen bonding.",
        "• Demonstrating ring flipping, chair-boat equilibria, and equatorial-axial substituent preferences in substituted cyclopentanes and cyclohexanes up to 12 atoms in undergraduate organic chemistry courses.",
        "• Generating unbiased starting geometries for downstream PySCF DFT single-point or vibrational frequency calculations.",
        "• Teaching students how torsional potential energy surfaces differ from single static 2D Lewis structures.",
      ],
    },
  ],
  faqs: [
    {
      question: "What elements are supported for CREST conformer searches on ChemDFT?",
      answer:
        "Hosted CREST calculations are strictly restricted to neutral singlet molecules containing only hydrogen, carbon, and oxygen (H, C, O). Molecules with nitrogen, sulfur, halogens, or other elements are not supported.",
    },
    {
      question: "What is the atom limit for CREST conformer searches?",
      answer:
        "The hosted size limit for CREST 3.0.2 is strictly 12 atoms. Larger molecules exceed worker runtime quotas and must be calculated on local computing clusters.",
    },
    {
      question: "Can I run charged ions or radical species with CREST?",
      answer:
        "No. ChemDFT only accepts neutral singlet molecules for hosted CREST searches. Charged cations, anions, and open-shell radical conformers are rejected prior to execution.",
    },
    {
      question: "Are CREST conformer energies accurate enough for publication?",
      answer:
        "CREST uses the semi-empirical GFN2-xTB engine for rapid sampling. While excellent for generating candidate geometries, final conformer energies should be refined with ab initio DFT in PySCF before publication.",
    },
  ],
  relatedPages: [
    {
      title: "xTB Online Calculator",
      href: "/en/xtb-online",
      reason: "Run semi-empirical GFN2-xTB single point and geometry optimisation up to 50 atoms.",
    },
    {
      title: "Online DFT Calculations",
      href: "/en/dft-calculations",
      reason: "Refine candidate conformers with rigorous Hartree-Fock, B3LYP, and PBE DFT in PySCF.",
    },
    {
      title: "Gaussian Software Comparison",
      href: "/en/gaussian-alternative",
      reason: "Review how ChemDFT's open-source screening tools compare with commercial alternatives.",
    },
  ],
};

export const SEO_PAGES: Record<string, SeoPageData> = {
  "dft-calculations": DFT_CALCULATIONS_DATA,
  "gaussian-alternative": GAUSSIAN_ALTERNATIVE_DATA,
  "homo-lumo-calculator": HOMO_LUMO_CALCULATOR_DATA,
  "pyscf-online": PYSCF_ONLINE_DATA,
  "quantum-espresso-online": QUANTUM_ESPRESSO_ONLINE_DATA,
  "webmo-alternative": WEBMO_ALTERNATIVE_DATA,
  "xtb-online": XTB_ONLINE_DATA,
  "crest-conformer-search-online": CREST_CONFORMER_SEARCH_ONLINE_DATA,
};

export const SEO_PAGE_SLUGS = [
  "dft-calculations",
  "gaussian-alternative",
  "homo-lumo-calculator",
  "pyscf-online",
  "quantum-espresso-online",
  "webmo-alternative",
  "xtb-online",
  "crest-conformer-search-online",
] as const;

export type SeoPageSlug = (typeof SEO_PAGE_SLUGS)[number];

export function isSeoPageSlug(value: string): value is SeoPageSlug {
  return (SEO_PAGE_SLUGS as readonly string[]).includes(value);
}
