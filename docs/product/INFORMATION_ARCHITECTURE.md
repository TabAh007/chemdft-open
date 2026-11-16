# Application Information Architecture

## Organizing model

The application exposes research objects by user task and context, not database tables. Global navigation answers “where am I working?”; the project explorer answers “what evidence/work exists?”; document tabs answer “what am I inspecting?”; the inspector answers “what is selected?”; the AI Scientist answers “what should happen next and why?”

## Global destinations

| Destination | Purpose | Placement |
|---|---|---|
| Projects | recent/starred/all projects, create/import | global rail/home |
| Jobs | cross-project durable calculations and approvals | global rail; count/status indicator |
| Search/Command | entities, actions, papers, jobs | header + `⌘K` / `Ctrl+K` |
| Settings | personal, AI, compute, scientific, privacy, advanced | account menu/global route |
| Organization | people, policy, shared budgets/usage | account/org switcher, permission-gated |
| Billing & usage | platform, AI, compute separated | organization/settings, not project explorer |

Compute is not a promotional destination: provider policy belongs in Settings; running work belongs in Jobs; an individual execution belongs to its calculation document/inspector.

## Project explorer

```text
PROJECT
▾ ASPHALTENE STUDY
  ├─ Overview
  ├─ Samples
  │  └─ Sample A
  ├─ Structures                          5
  │  ├─ Candidate A
  │  │  └─ Versions / conformers on expand
  │  └─ Candidate B
  ├─ Experiments
  │  ├─ FTIR
  │  ├─ NMR
  │  ├─ HRMS
  │  └─ XRD
  ├─ Calculations                       12
  ├─ Literature                        18
  └─ Reports
```

- Results and artifacts appear under their calculation when expanded and in the opened calculation document; no top-level “Results” bucket.
- Evidence is surfaced inside Literature, related entity inspectors, search, and comparison; a project Evidence view may appear when volume justifies it, but is not a default top-level node.
- StructureVersion and Conformer are expandable children/inspectable views, not permanent top-level navigation.
- AI Scientist is a workspace surface, not a tree folder.
- Tools are reached through contextual toolbars and command palette; a compact optional Tools group may expose Structure Editor, Spectrum Analysis, and Compare shortcuts without duplicating project content.

## Document/workspace types

Molecule, crystal, spectrum/modality, calculation/result, orbital/surface, PDF/evidence, comparison, and report open as documents. Documents may have internal subviews (for example Molecule → 2D, Scientific 3D, Studio, Properties, Orbitals, Vibrations, Calculations, History).

Tabs show concise type-aware names, state glyphs, and close controls on hover/focus. Pinned documents occupy a fixed leading section and survive workspace restore. Unpinned inactive tabs collapse into a searchable overflow list instead of shrinking indefinitely. Recently closed documents are reopenable. The active explorer item and active document synchronize when they represent the same entity; changing selection inside a document does not navigate the tree.

## Right context dock

Inspector and AI Scientist share a resizable right dock with mode tabs. On wide desktops they may split vertically or into two columns; on normal laptops only one is visible at a time. The inspector is selection-bound and deterministic. The AI Scientist retains conversation/plan state and references selections via entity chips/links, not copied text alone.

## Bottom activity shelf

A collapsed 26–30px status strip shows selection summary, job count/state, connectivity, and accrued approved cost. Expanding reveals Jobs, Logs, Problems, and Artifacts. It never fakes engine progress. Scientific workspace remains dominant.

## Conceptual route families

```text
/{locale}/projects
/{locale}/projects/{projectId}/overview
/{locale}/projects/{projectId}/workspace?document={documentId}
/{locale}/jobs
/{locale}/settings/{section}
/{locale}/organizations/{organizationId}/{members|usage|policies}
```

Exact Next.js segments are Phase 1 implementation details. Deep links must resolve stable IDs and reconstruct document/subview/selection state without encoding secrets or trusting client project IDs for authorization.

## Command palette

`⌘K` / `Ctrl+K` handles navigation and deterministic actions: Open FTIR-03, Go to calculation #142, Show HOMO, Measure distance, Compare Candidate A with B, Export CIF, Search papers. It uses local/structured search first and does not spend AI tokens for known actions. Natural-language ambiguity can explicitly hand off to the AI Scientist.

See [workspace specification](WORKSPACE_SPECIFICATION.md), [navigation specification](../design/NAVIGATION_SPEC.md), and [ADR-017](../adr/ADR-017-multi-document-workspace.md).
