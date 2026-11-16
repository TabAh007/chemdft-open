# Engine capability matrix

Audited 2026-10-11 against the code at HEAD `88791648` plus the PF-8F corrections, the live
`/v1/projects/{id}/calculations/capabilities` response, and `test_pf8f_capability_conformance.py`
(which fails if the advertised capabilities and the validators ever diverge). The previous version
of this file (2026-09-16) predated Psi4, xTB, CREST and DFT-D4 and has been replaced.

An engine that is not verifiably `AVAILABLE` advertises **no** tasks, methods, bases or optimizers.
Every request is validated before queueing; unsupported combinations are refused with HTTP 422
and nothing is created.

| Engine (pinned identity) | Tasks | Methods / bases | Electronic state | Elements / size | Convergence & output |
|---|---|---|---|---|---|
| **PySCF 2.14.0** (isolated worker venv) | ENERGY, PERIODIC_ENERGY, GEOMETRY_OPTIMIZATION (geomeTRIC 1.1.1), FREQUENCY (analytic Hessian), ORBITAL, TDDFT, THERMOCHEMISTRY | HF, B3LYP, PBE, PBE+U × STO-3G, 6-31G, def2-SVP, def2-SVPD, gth-dzvp-molopt-sr. `b3lyp` is LibXC B3LYP (VWN-RPA); `b3lyp5` (VWN5) is **not** offered | Explicit charge/multiplicity bound to the structure's authoritative state; RHF/RKS for singlets, UHF/UKS otherwise. FREQUENCY, TDDFT and THERMOCHEMISTRY are closed-shell only. PERIODIC_ENERGY supports KRKS, KUKS, and KUKSpU (+U on transition metals) with collinear AFM/FM magnetism. Hosted PySCF periodic: Gamma only, one-hour limit (release 0.0.44; Gamma, 10 atoms measured 1009 s; larger meshes use Quantum ESPRESSO) | H–I (STO-3G), H–Zn (6-31G), H–Kr (def2-SVP/SVPD). Higher Z is refused: def2 needs an ECP the adapter does not supply, and the bundled 6-31G/STO-3G stop earlier. For PERIODIC_ENERGY, Z=1–56 and 72–86 with GTH-PBE pseudo and gth-dzvp-molopt-sr basis, ≤ `aws_periodic_max_atoms` (20). Gas phase (molecules) or 3D periodic cells; no dispersion, solvation or constraints | SCF `converged` flag, iterations, total energy (Eh). Default SCF threshold 1e-9 (molecules) or 1e-6 (periodic, Fermi smearing 0.005 Ha) and default DFT grid are not user-tunable; ENERGY and PERIODIC_ENERGY candidates are cross-checked against PySCF's own log before publication |
| **Quantum ESPRESSO 7.6** (plane waves, separate programs pw.x / projwfc.x / dos.x / bands.x; image NOT built, hosted switch OFF) | PERIODIC_ENERGY only, with options: atom relaxation (cell fixed), DOS/PDOS, band structure | PBE, PBE+U (Dudarev, ortho-atomic projectors) × `pw-sssp-pbe-eff-v2` (SSSP PBE Efficiency v2.0, fixed cutoffs and pseudopotentials) | Collinear: none, ferromagnetic, antiferromagnetic (alternating along the cell diagonal); Fermi-Dirac smearing 0.01 Ry | 92 elements of the library (La, Pa, U not offered); +U on 3d metals with a 3D projector; at most 20 atoms; SCF mesh up to 4x4x4, DOS up to 6x6x6, band path up to 100 k-points | Converged flag from XML and stdout, energy cross-checked with the pw.x log, Kohn-Sham gap from eigenvalues, Lowdin local moments; no stress, pressure, vc-relax, phonons, hybrids, noncollinear or MD |
| **xTB 6.7.1** (GFN2) | ENERGY, GEOMETRY_OPTIMIZATION (ANCopt, `normal`) | GFN2-xTB only; no basis set; no separate dispersion | Charge and `--uhf` from multiplicity, parity-validated | Any element xTB supports; molecules only | Total energy (Eh), optimization trajectory. Semi-empirical: never comparable with ab initio totals |
| **CREST 3.0.2 + EWIN fix** (hash-pinned patched build) | CONFORMER_SEARCH | GFN2 (embedded tblite fork) | Neutral singlets only | H/C/O only | Ensemble with relative energies; explicit search settings required |
| **Psi4 1.11** (sealed conda prefix) | ENERGY only | Exactly: HF/STO-3G, HF/def2-SVP, B3LYP/def2-SVP, PBE/def2-SVP, MP2/def2-SVP (conventional, all-electron). The method × basis cross product is **not** supported; clients must use `supported_method_basis_pairs`. The SCF reference must be stated (`rhf`/`rks`) | Neutral closed-shell singlets | H, C, O only, ≤ 100 atoms | Sealed presets (SCF e/d-convergence 1e-10/1e-8 HF, 1e-11/1e-9 DFT; DFT grid 99×590 Treutler); `fail_on_maxiter`; native JSON re-parsed and cross-checked by the Result Firewall |
| **DFT-D4 4.2.0** (hash-pinned prefix) | Source-bound correction of an existing result (not a selectable engine) | B3LYP and PBE, def2-SVP, BJ damping / EEQ charges / approximate ATM, exact published coefficients | Neutral singlets | H/C/O, ≤ 128 atoms | Publishes a distinct `chemdft.dispersion-corrected-energy` result: AUTHORITATIVE / VALIDATED / **UNVERIFIED**. Generic specifications with `dispersion` are refused by every engine (no double counting) |

## Advertised versus implemented

`GET …/calculations/capabilities` reports availability, version, tasks, methods, bases, optimizers
and (Psi4) exact method/basis pairs. It does not carry structured charge, multiplicity or element
limits; those are enforced by validation (422 with an explanatory message) and described in the
free-text `diagnostic` of Psi4 and CREST. DFT-D4 availability is per source result
(`GET …/dispersion-corrections/capability?source_result_id=`), because it depends on the source.

Known limits that are enforced but not machine-readable: element/basis coverage for PySCF, the Psi4
element and electronic-state restriction, CREST's neutral-singlet restriction.

## Not supported (and therefore never advertised)

Periodic geometry or cell optimization, periodic band structures, DOS, forces, stress, periodic hybrid functionals, implicit solvation, constraints, user-selected DFT grids, other functionals or
bases, ECP-requiring elements, DFT-D3/D4 inside PySCF/Psi4, D4 variants other than BJ/EEQ/ATM,
open-shell Psi4, charged Psi4, and any engine not listed above.
