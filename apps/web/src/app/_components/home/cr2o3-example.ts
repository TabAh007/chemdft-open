/**
 * The one worked example on the home page: a stored ChemDFT calculation of alpha-Cr2O3, copied from the stored result of
 * job 5682273d (ChemDFT 0.0.46 platform run, 13 Nov 2026, Linux x86_64, pilot EC2) and the second stored run 58a06173.
 * Nothing is computed or rounded here; tests/cr2o3-example.test.ts pins every number. No experimental or literature value
 * appears on purpose. CALCULATED on this platform only: not evidence for any other platform.
 */
export const CR2O3_EXAMPLE = {
  jobId: "5682273d-6bcc-45c0-8dd1-ab2bf07b426a",
  runDate: "13 Nov 2026",
  platform: "ChemDFT 0.0.46 · Linux x86_64 · pilot EC2",
  system: "α-Cr2O3, rhombohedral cell, 10 atoms (4 Cr, 6 O), antiferromagnetic initial ordering",
  engine: "Quantum ESPRESSO 7.6",
  task: "PERIODIC_ENERGY with ionic relaxation",
  pseudopotentials: "SSSP PBE Efficiency v2.0 (Cr.us.pbe.z_14.uspp.gbrv.v1.5.upf, O.paw.pbe.z_6.ld1.psl.v0.1.upf)",
  cutoffs: "ecutwfc 45 Ry, ecutrho 540 Ry",
  kMesh: "2×2×2 (8 irreducible k-points)",
  method: "PBE+U, U_eff(Cr) = 3.7 eV (platform default, used_default_u = true)",
  converged: true,
  ionicSteps: 3,
  totalForceRyPerBohr: "0.001093",
  totalEnergyHa: "−475.99968609",
  localCrMomentMuB: "±2.9995",
  totalMagnetizationNote: "≈ 0",
  bandGapEv: "3.239",
  runtimeSeconds: "463.6",
  second: {
    jobId: "58a06173-0f87-46c1-b640-daa5c0803468",
    settings: "Γ point only, U_eff(Cr) = 2.0 eV",
    bandGapEv: "2.896",
    localCrMomentMuB: "±3.0028",
  },
  caveats: [
    "The gap is a Kohn–Sham PBE+U eigenvalue gap, not an optical or experimental gap.",
    "U is a platform default, not fitted.",
    "This one calculation is not a benchmark.",
    "Status CALCULATED with Quantum ESPRESSO 7.6 on this platform only (Linux x86_64, pilot EC2); it is not evidence for any other platform.",
  ],
} as const;
