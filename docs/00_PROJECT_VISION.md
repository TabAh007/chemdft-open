# Project Vision

## Purpose

ChemDFT is a web-first scientific workstation in which researchers can create and edit structures, run real quantum-chemistry calculations, analyze experimental data, build evidence-linked project knowledge, compare experiment with computation, and publish reproducible results. Natural-language interaction is a primary command surface, not a substitute for expert controls.

## Governing principle

> **AI plans and explains. Scientific engines calculate. Deterministic renderers visualize.**

The product earns trust by maintaining a hard distinction between measured, calculated, extracted, digitized, hypothesized, and verified information. See [scientific integrity](02_SCIENTIFIC_INTEGRITY.md) and [data provenance](08_DATA_PROVENANCE.md).

ChemDFT is **AI-first, never AI-only**: natural language is the easiest default for multi-step scientific work, while expert/manual controls edit and invoke the same typed actions. See the permanent [product principles](product/PRODUCT_PRINCIPLES.md) and [ADR-016](adr/ADR-016-ai-first-expert-equivalent.md).

## Intended capabilities

- Draw, import, version, measure, and transform molecular and periodic structures.
- Visualize molecules, crystals, orbitals, density, ESP, and actual vibrational displacement vectors.
- Execute replaceable deterministic engines for conformer, semiempirical, DFT, and related workflows.
- Analyze FTIR, NMR, HRMS, XRD, UV–Vis, thermal, and related datasets.
- Turn papers into evidence-linked knowledge without confusing extraction or digitization with raw measurement.
- Plan multi-stage scientific workflows through typed tools with explicit permissions and budgets.
- Retrieve from documents, structured project facts, and project history.
- Export interoperable scientific artifacts, structures, data, and publication-quality figures with reproducibility metadata.
- Support ChemDFT Cloud, then additional cloud providers and bring-your-own/HPC compute.
- Support managed AI and securely connected user credentials without changing scientific truth.
- Expose the same domain actions through UI, API, AI Scientist, WebMCP, and later server-side MCP.

## Product boundaries

ChemDFT will not build a quantum-chemistry numerical kernel, use generated imagery as analytical evidence, treat project memory as automatic model training, or let an LLM directly author authoritative scientific results. Provider selection must not alter authoritative scientific semantics.

## Success properties

1. **Scientifically defensible:** results are traceable to inputs, engines, versions, settings, and artifacts.
2. **Powerful but legible:** novices can use language; experts retain direct controls and raw data access.
3. **Reproducible:** versions, immutable source artifacts, environment metadata, and explicit transformations are retained.
4. **Provider-independent:** scientific engines, compute, AI, and interfaces sit behind contracts.
5. **Economically transparent:** subscription, AI usage, and scientific compute remain understandable and separate.
6. **Secure by construction:** untrusted documents, scientific files, and calculations cross controlled boundaries.

## Durable constraints

The permanent engineering rules are in [docs/15_ENGINEERING_RULES.md](15_ENGINEERING_RULES.md). Delivery sequence and deferred questions are in the [roadmap](14_ROADMAP.md) and NEXT.md.
