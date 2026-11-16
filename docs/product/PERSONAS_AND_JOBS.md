# Personas and Jobs to Be Done

Personas describe observable work patterns, not fictional biographies. Expertise, trust, and control needs may overlap.

## Launch priority

1. **Primary:** computational chemists and scientists migrating from Gaussian/GaussView/ORCA/WebMO.
2. **Primary:** experimental chemists seeking calculated comparison and AI guidance.
3. **Primary:** graduate/PhD researchers spanning both modes.
4. **Buyer/collaboration context:** university research labs.
5. **Secondary expansion:** materials and petroleum/petrochemical researchers; support grows with periodic/XRD/thermal/specialized phases.

“Existing Gaussian/GaussView/ORCA/WebMO user” is treated as a workflow overlay on computational/materials personas, not a separate demographic. “Less-computational experimental scientist” is the guided end of the experimental persona; both are explicitly represented below.

## P1 — Computational chemist / legacy desktop QM user

| Field | Definition |
|---|---|
| Objectives | prepare inputs, screen conformers, run/verify QM, inspect orbitals/frequencies, reproduce and compare methods |
| Current tools | Gaussian/GaussView, ORCA, WebMO, PySCF/Psi4 scripts, shell/HPC, spreadsheets and plotting tools |
| Current pain | fragmented setup, manual file transfer/parsing, hidden history, weak linked analysis, inconsistent reproducibility |
| Expertise | high scientific and parameter literacy; infrastructure skill varies |
| ChemDFT replaces | routine input plumbing, fragmented project files, common visualization/comparison, cloud orchestration, manual provenance assembly |
| Does not replace | method judgment, primary-output review, specialty engines/workflows, institutional validation |
| AI comfort | accepts planning/diagnosis when settings and evidence are reviewable; rejects opaque automation |
| Manual controls | engine, method/basis, dispersion, solvent, charge/multiplicity, SCF/convergence, resources, constraints, raw input/output |
| Trust requirements | exact versions/inputs, convergence, units, artifacts, deterministic scenes, cross-engine verification |
| Compute sensitivity | cost/performance conscious; wants estimates, caps, queues, retries, HPC path |
| Collaboration | share reproducible calculation/result links, compare variants, review settings and failed attempts |

## P2 — Experimental chemist / guided computational user

| Field | Definition |
|---|---|
| Objectives | process FTIR/NMR/HRMS/UV–Vis data, test candidate structures, compare measured/calculated signals, understand assignments |
| Current tools | instrument/vendor software, spreadsheets, Origin/MestReNova-style tools, PDFs, collaborators' calculation outputs |
| Current pain | computation barrier, disconnected spectra and structures, opaque assignments, lost processing history |
| Expertise | high experimental/domain skill; low-to-moderate computational setup expertise |
| ChemDFT replaces | routine cross-tool transfers, first-pass processing/comparison, guided calculation setup, evidence organization |
| Does not replace | instrument acquisition/control, sample interpretation, calibration, safety, expert computational review |
| AI comfort | high when AI explains assumptions and asks before costly/scientifically material choices |
| Manual controls | processing pipeline, peak/assignment edits, structure selection, method preset rationale, units, source data access |
| Trust requirements | raw data preserved, derived steps visible, calculated vs experimental labels, ambiguity/confidence, cited evidence |
| Compute sensitivity | needs predictable caps and plain-language estimates more than provider detail |
| Collaboration | hand off data and hypotheses to computational colleagues; retain corrections and review state |

## P3 — Materials researcher

| Field | Definition |
|---|---|
| Objectives | inspect/edit periodic structures, symmetry/cells/supercells, connect phases/planes to XRD, run periodic workflows later |
| Current tools | VESTA, pymatgen/ASE scripts, crystallography tools, XRD software, CIF/POSCAR files |
| Current pain | poor linkage among structure, diffraction, literature, transformations, and computation provenance |
| Expertise | moderate-to-high; crystallographic literacy required |
| ChemDFT replaces | browser inspection, versioned transformations, project linkage, shared comparison and evidence |
| Does not replace | full refinement suites, instrument software, all periodic engines, specialty materials databases |
| AI comfort | useful for navigation and literature synthesis; skeptical of symmetry/phase claims without deterministic evidence |
| Manual controls | lattice, coordinates, occupancy, symmetry operations, replication/supercell, plane/index selection, raw CIF |
| Trust requirements | coordinate convention, cell/symmetry provenance, occupancy validation, exact transform history |
| Compute sensitivity | potentially high CPU/GPU/HPC needs; wants queue, region/data and BYOC policy |
| Collaboration | shared structures, phase hypotheses, XRD mappings, reproducible transformations |

## P4 — Graduate/PhD researcher

| Field | Definition |
|---|---|
| Objectives | learn workflows while producing defensible thesis/paper results, recover old work, compare alternatives, export figures/methods |
| Current tools | supervisor/lab conventions, mixed desktop tools, notebooks, folders, institutional HPC |
| Current pain | steep tool learning, irreproducible trial-and-error, weak provenance, cost uncertainty, knowledge scattered in papers/chats |
| Expertise | variable; grows rapidly and must not be trapped in beginner mode |
| ChemDFT replaces | repetitive setup, disconnected notes/files, basic plotting/rendering, ad hoc run logs |
| Does not replace | supervision, chemistry education, peer review, institutional data policy |
| AI comfort | often high; needs explicit separation of explanation, hypothesis, and verified result |
| Manual controls | progressive Advanced access, raw output, method/basis rationale, reproducible presets, comparison tools |
| Trust requirements | citations, failure transparency, version history, exportable manifests, no fabricated values |
| Compute sensitivity | highly budget sensitive; benefits from hard caps and included allowance clarity |
| Collaboration | supervisor review, lab sharing, comments/corrections, reproducible handoff |

## P5 — Petroleum/petrochemical researcher

| Field | Definition |
|---|---|
| Objectives | compare complex candidate structures, analyze FTIR/NMR/HRMS/XRD/thermal/DLS, connect papers and process conditions |
| Current tools | spectroscopy/thermal vendor tools, spreadsheets, Origin-style plotting, Gaussian/ORCA through specialists, literature repositories |
| Current pain | heterogeneous data, ambiguous mixtures/candidates, disconnected evidence, difficult multidisciplinary handoffs |
| Expertise | high domain/experimental; computational varies |
| ChemDFT replaces | evidence-linked project organization, cross-modality comparison, candidate/version management, guided compute |
| Does not replace | compositional separation, process simulation, instrument control, expert mixture interpretation |
| AI comfort | valuable for synthesis/search if claims cite sources and uncertainty remains visible |
| Manual controls | modality-specific processing, candidate inclusion/exclusion, assignments, conditions, source and uncertainty editing |
| Trust requirements | mixture/sample identity not overclaimed, provenance and approximate digitization unmistakable |
| Compute sensitivity | workflows can become large; needs staged plans, stop conditions, and lab budgets |
| Collaboration | multidisciplinary evidence review and shareable reports |

## P6 — University research lab (organization persona)

| Field | Definition |
|---|---|
| Objectives | standardize reproducible workflows, share compute and knowledge, govern spend/data, onboard students |
| Current tools | local licenses, shared drives, ELN/LIMS fragments, HPC scheduler, cloud accounts, lab scripts |
| Current pain | person-dependent workflows, lost provenance, duplicate compute, credential and budget sprawl |
| Expertise | mixed; PI/lab manager governance plus researcher execution |
| ChemDFT replaces | fragmented project memory, common browser access, basic orchestration/metering, reproducible collaboration |
| Does not replace | ELN/LIMS by default, institution IAM/policy, grant accounting, full HPC administration |
| AI comfort | policy-dependent; needs managed/BYOK controls, audit, retention, and provider choice |
| Manual controls | organization presets/policies, role/approval/budget controls, project export, audit visibility |
| Trust requirements | tenant isolation, provenance/tamper evidence, predictable retention, scientific validation |
| Compute sensitivity | shared pool, quotas, priority/concurrency, future BYOC/SLURM and chargeback |
| Collaboration | central need: project roles, review, reproducible links, corrections, shared knowledge |

## Jobs to be done

Priority reflects the intended product through initial launch, not what Phase 1 scaffolds. Detailed phase allocation is in [feature scope](FEATURE_SCOPE.md).

### Must have

- Draw/import a molecule; validate it; create versions/variants; inspect properties and measurements.
- Optimize geometry; find/rank conformers; run a DFT calculation with quick or expert controls.
- Calculate/inspect HOMO/LUMO, orbitals, and real vibrational modes.
- Upload FTIR; preserve raw data; derive/process it; compare with calculated IR; inspect linked modes.
- Understand a failed/nonconverged calculation and retry with explicit settings.
- Reproduce an old ChemDFT calculation from immutable inputs/artifacts.
- Import supported Gaussian/ORCA outputs through cclib-compatible validated parsing.
- Compare structures, conformers, methods/engines, original/variant, and calculated/experimental results.
- Upload a paper, review extracted evidence with coordinates, correct/ignore/promote it, and query project history.
- Export structures, scientific results/manifests, and publication figures.
- Control multi-step work by language and override every material scientific parameter manually.

### Should have

- Inspect/process NMR and HRMS; analyze UV–Vis and XRD as modality support matures.
- Upload/edit CIF, inspect lattice/symmetry/unit cells, and compare XRD.
- Rank candidate structures across multiple evidence types.
- Reopen/pin/split multiple project documents and create reusable workflow presets.
- Collaboration review, comments/corrections, shared lab budgets, and project templates.

### Later

- Deep vendor-format coverage; TG/DTG/DTA and DLS specialization.
- Production periodic/GPAW workflows, spin-density specialization, reaction paths/IRC and MD where engines provide data.
- Advanced agentic candidate generation/ranking and automated literature workflows.
- RunPod/multi-cloud routing, enterprise providers, institutional BYOC/HPC/SLURM.
- Server MCP, developer ecosystem, model fine-tuning under separate controls, and expanded regulated-enterprise features.
