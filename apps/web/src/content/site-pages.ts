/** Text of the Principles, Cost and support, and Validation pages. Every sentence is a recorded fact or an explicit limit. */

export const VALIDATION_RUN = {
  system: "α-Cr2O3 (rhombohedral, 10 atoms), antiferromagnetic",
  engine: "Quantum ESPRESSO 7.6",
  library: "SSSP PBE Efficiency v2.0",
  settings: [
    ["Functional", "PBE+U (Dudarev), U_eff(Cr) = 2.0 eV"],
    ["Cutoffs", "ecutwfc 45 Ry, ecutrho 540 Ry"],
    ["k-points", "Γ only"],
    ["Smearing", "Fermi-Dirac, 0.01 Ry"],
    ["Platform", "2 vCPU AWS EC2 pilot machine"],
    ["Container image", "chemdft-pilot:runtime-qe-0046 (sha256:83d8d131…c77a)"],
    ["Input file sha256", "6d8b931c13e66180ba43199c0454ddc9d6468404ced9a3f93ac8d32191182432"],
  ],
  columns: ["Quantity", "Through the live site", "Same pw.x input, run directly in the same image"],
  rows: [
    ["Total energy", "-476.0906515824172 Ha", "-952.18130316 Ry (= -476.09065158 Ha)"],
    ["SCF iterations", "16", "16"],
    ["Fermi energy", "12.95961 eV", "12.9596 eV"],
    ["Löwdin Cr moments (μB)", "-3.0028, -3.0028, +3.0028, +3.0028", "the same four values"],
    ["Wall time of pw.x", "57.95 s", "—"],
  ],
  liveRef: "Job 44f6ed72, run id 65106558-cff4-40b7-8890-1e3f43b79369.",
  earlier: "An earlier stored job, 58a06173, with the same settings gave -476.0906515824173 Ha, 16 iterations and the same moments.",
  limits: [
    "The native run used ChemDFT's own input generator to write pw.in. This verifies execution, parsing and reproducibility. It does not verify that the generated input is the right physics.",
    "No comparison against another code or against the literature is claimed.",
    "This is one structure on one platform. A result from one platform is not evidence for another.",
    "The only result compared against an independent run of the engine is the one above. The live platform checks below are execution checks, not independent verification.",
  ],
  liveChecksTitle: "Live platform checks, 2026-11-14 (release 0.0.53)",
  liveChecksIntro:
    "Run by the owner on chemdft.com. Each result below passed the Result Firewall (CALCULATED and VALIDATED). Nothing here was independently verified, and each result belongs to this platform (AWS pilot, PySCF 2.14.0) only.",
  liveChecks: [
    "H2, HF/STO-3G, through the AI-planned path (plan mode, approval card, approve): calculation d0c51937, PySCF 2.14.0, -1.11676 Eh (rounded to 6 digits).",
    "H2 geometry optimisation with PySCF and geomeTRIC, started manually: job 6408f6c2, converged in 4 evaluations, new structure \"H2 - optimized V2\".",
  ],
  liveChecksNotDone: [
    "Hosted geometry optimisation is switched on by an owner decision. geomeTRIC 1.1.1 is still in the deployed compute image, and whether its no-AI-training clause (clause 4) applies is an open question for a lawyer.",
    "Not tested live: an AI-proposed geometry optimisation, an AI-proposed xTB calculation (plan mode offers single-point energy only), and any independent verification of these two results.",
  ],
} as const;

export const PRINCIPLES = [
  {
    id: "values",
    title: "Scientific values come from engines",
    body: [
      "Engines (PySCF, Quantum ESPRESSO, xTB, CREST) are the only source of calculated numbers. The AI Scientist plans, explains and requests typed tools. It cannot write a result.",
      "Every result passes the Result Firewall, which records provenance and refuses a job that did not converge or whose numbers cannot be cross-checked. Model hypotheses stay labelled and separate from calculated results.",
    ],
  },
  {
    id: "honest",
    title: "Status is stated, never implied",
    body: [
      "Each release lists what was verified, on which platform and engine, what was not verified, and the known limits. Installed is not implemented, implemented is not executed, executed is not scientifically verified.",
      "The only measured agreement check so far is on the Validation page, with its limits.",
    ],
  },
  {
    id: "open",
    title: "Open core, stated plainly",
    body: [
      "The licence map says which parts are Apache-2.0 and which are not. The public source repository is at https://github.com/TabAh007/chemdft-open.",
    ],
  },
] as const;

export const AI_DISCLOSURE = {
  intro: "AI coding agents wrote a substantial part of ChemDFT's code. This section states what the repository's own history shows.",
  facts: [
    "43 commits were authored directly by Claude and 375 commits carry a Co-Authored-By trailer naming Claude models. The owner authored 652 commits.",
    "Codex and Antigravity agents are also used, under the same project rules.",
    "The owner sets the rules and is the only person who can deploy, spend money or approve a scientific run.",
  ],
  limits: [
    "The repository does not prove that every line of agent-written code was read by a human before it was merged. Nothing on this site says so.",
    "The risk is not that a model invents a number, because the architecture forbids it. The risk is that agent-written code contains defects nobody has read. The mitigation is tests and gates, not review claims.",
    "AI-planned proposals have not been shown end to end on the hosted service, and a model's scientific prose is not fact-checked by a chemist.",
  ],
} as const;

export const COST_SUPPORT = {
  cost: [
    "Scientists can use the ChemDFT website at no charge during the beta. That is permission to use the service, not a licence to the proprietary code.",
    "Pricing, public sign-up and email sign-up are not available yet. No price is promised on this page.",
    "Calculations run on cloud compute paid for by the project. Size and time limits apply and are shown before a job is submitted.",
  ],
  support: [
    "ChemDFT is maintained by one person. There is no support contract, no response-time guarantee and no on-call service.",
    "Questions, bug reports and collaboration requests go through the Contact page. Bugs and requests can also go through Feedback when you are signed in.",
    "Security reports: see the SECURITY file in the repository. The public contact address for it is still to be confirmed by the owner.",
  ],
} as const;
