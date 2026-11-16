# Product Definition

## Statement

**ChemDFT is an AI-native computational chemistry and experimental-analysis workspace in the browser.**

Primary position: **Online DFT & Computational Chemistry Software.**

## Promise

Turn a scientific question, structure, spectrum, crystal, or paper into a reviewable and reproducible workflow: plan with an AI Scientist, control exact settings when needed, execute real scientific engines, inspect deterministic linked results, preserve evidence/provenance, and export work that can be traced and repeated.

The promise is reduced workflow friction—not guaranteed scientific correctness, successful convergence, or a replacement for researcher judgment.

## Product shape

ChemDFT combines:

- molecular and crystal/materials editing;
- computational chemistry and orchestration;
- experimental spectrum/data processing;
- project-aware semantic, structured, and historical retrieval;
- AI planning/explanation plus expert/manual operation;
- deterministic molecular, volumetric, vibration, crystal, and chart visualization;
- evidence, provenance, versioning, and collaboration-ready project memory;
- transparent compute estimation, approval, metering, and future BYOC/HPC;
- scientific/import/export and publication workflows.

## Boundaries

ChemDFT is not a Gaussian, ORCA, WebMO, or GaussView clone; a chat wrapper; a standalone molecule viewer; a single DFT submission form; a vector-only RAG product; an AI image generator for scientific evidence; or a new quantum-chemistry numerical kernel.

It does not replace method selection, experimental judgment, instrument acquisition software, institutional safety/compliance processes, or the need to inspect primary outputs. AI explanations are interpretations and hypotheses, never authoritative calculation records.

## Initial focus

The launch wedge is molecule-centered computational work and calculated-versus-experimental spectroscopy for individual researchers and university labs. Materials/crystal, XRD, petroleum/petrochemical, thermal, DLS, vendor-specific formats, broad enterprise/HPC, and advanced agentic workflows expand through the roadmap; they do not receive equal V1 depth.

## Success criteria

- A new researcher can move from structure/import to a reviewed calculation plan without learning provider infrastructure.
- An expert can inspect and override every scientifically material parameter.
- AI and manual paths create the same normalized action request.
- A result is traceable to immutable input, job, engine/version, method, settings, artifacts, and source class.
- Failed/nonconverged work is diagnosable and reproducible, not hidden.
- Calculated and experimental views link deterministically with ambiguity/confidence visible.
- Costs remain separated into platform, AI, and scientific compute.

## Onboarding

No forced multi-step wizard. A dismissible first-project launch surface asks “What would you like to do?” and offers Draw a molecule, Import structure, Upload experimental data, Import Gaussian/ORCA result, Upload a research paper, and Ask ChemDFT. Choosing an action opens the relevant workspace with a short contextual hint; experts may skip permanently.

## Settings architecture

- **General:** language, locale display, unit/display preferences, future theme.
- **AI:** ChemDFT Auto, connected BYOK providers, preference policy, AI cost/token controls.
- **Compute:** default per-workflow cap, low-cost auto-run policy, future provider/BYOC policy.
- **Scientific:** method presets, unit conventions, visualization defaults, expert defaults.
- **Privacy:** project memory, retention, AI data use, export/delete controls.
- **Advanced:** expert mode, raw inputs, future developer/API controls.

Settings use organization policy → project setting → user preference precedence where applicable; enforced organization security/budget policy cannot be weakened locally.

## Pricing concept

Do not assign prices in Phase 0. Plan four clear offers: Free (exploration/small limited work), Researcher (projects, AI Scientist, RAG, BYOK, included allowance + pay-as-you-go compute), Pro/Power User (priority, concurrency, storage/compute scale), and Lab/University (team workspace, shared pools, governance, BYOK, future HPC/BYOC). Every offer separates platform subscription, managed AI, and scientific compute instead of hiding them in one credit number.

See [personas and jobs](PERSONAS_AND_JOBS.md), [feature scope](FEATURE_SCOPE.md), and [product principles](PRODUCT_PRINCIPLES.md).
