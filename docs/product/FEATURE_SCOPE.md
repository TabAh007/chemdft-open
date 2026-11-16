# Feature Scope and Release Boundaries

## Scope language

- **MUST HAVE:** required for a credible initial product capability; delivered across roadmap phases, not all in Phase 1.
- **SHOULD HAVE:** important follow-on depth after core pathways are trustworthy.
- **LATER:** intentionally deferred specialization or scale.

## Capability map

| Capability | Priority | Roadmap phase | Acceptance boundary |
|---|---:|---:|---|
| Projects/files/auth foundation | MUST | 1 | shell and contracts, no fake science |
| Scientific schemas, provenance, Tool Registry, firewall | MUST | 2 | protected authoritative writes and shared actions |
| Molecule import/edit/version + RDKit/Ketcher | MUST | 3 | originals preserved; 2D/manual actions |
| Crystal/CIF inspection and basic versioned edits | SHOULD | 3 | separate materials workspace; no Ketcher misuse |
| ScientificScene, 3Dmol, Studio, orbital/ESP/vibration views | MUST | 4 | same data; deterministic visuals |
| xTB/CREST/PySCF/Psi4/QCEngine compute | MUST | 5 | isolated engines and reproducible artifacts |
| Modal compute gateway, estimates/caps/approval/jobs | MUST | 6 | deterministic budget enforcement |
| FTIR import/process/compare/link | MUST | 7 | raw-preserving pipeline and mode mapping |
| NMR/HRMS | SHOULD | 7 | modality-specific workflows, provenance |
| XRD/UV–Vis | SHOULD | 7 | typed extensions and deterministic comparison |
| TG/DTG/DTA/DLS | LATER | 7+ | scoped validation; no generic spectrum assumptions |
| AI Scientist + Model Gateway | MUST | 8 | plan/review/execute shared tools; no protected writes |
| PDF evidence + hybrid project memory | MUST | 9 | injection-safe, source coordinates, corrections |
| Agentic candidate workflows | LATER | 10 | bounded, resumable, reviewable, budgeted |
| Subscription/managed AI/BYOK | SHOULD | 11 | separate platform/AI/compute economics |
| WebMCP/API | SHOULD | 12 | adapters over registry; no duplicate logic |
| Server MCP + BYOC/HPC | LATER | 12 | hardened institutional trust boundary |
| Production validation/hardening | MUST | 13 | scientific/security/accessibility/license gates |

## Phase 0 non-goals

No application scaffold, package manifests, dependencies, UI code, HTML prototypes, scientific algorithms, provider accounts, price values, production claims, fake data, or automated polished mockups. ASCII/Mermaid wireframes specify behavior only.

## Phase 1 scope

Phase 1 may build only the foundation defined in Phase 1 Acceptance Contract. Scientific workspaces appear as honest shell states using labeled non-scientific fixture metadata; they do not calculate, parse, or pretend to visualize scientific results.

## Cross-cutting requirements

Every implementation phase must preserve: shared typed actions, source/derived distinctions, authorization/budget controls, provider independence, i18n keys, accessible alternatives, observable job/result states, and architecture/ADR traceability.
