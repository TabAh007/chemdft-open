# UI/UX Foundation

## Confirmed direction

Blueprint.js is the sole full component framework and interaction foundation. ChemDFT builds a scientific design system on top; Blueprint is not the visual identity. Do not mix full design systems. Impeccable is the planned anti-slop design QA tool.

The product is light-first, information-dense, technical, and professional: minimal rounding, thin one-pixel separators, sharp hierarchy, restrained shadows, little or no gratuitous gradients, compact rows, and data before decoration.

Avoid oversized SaaS cards, nested-card clutter, giant empty product whitespace, huge pill navigation, large rounded active-sidebar pills, decorative AI sparkles, and styling that hides scientific state.

## Workspace anatomy

- Compact global/project header with project identity, search, status, budget, and account controls.
- Hierarchical project tree using typography, indentation, hairlines, compact rows, status/provenance indicators, and direct selection—not pill tiles.
- Central multi-document workspace for structures, spectra, calculations, papers, comparisons, and reports.
- Contextual inspector for precise properties, provenance, method settings, and validation.
- AI Scientist panel as a first-class command surface that can present editable plans, estimates, evidence, and tool progress without displacing expert controls.
- Jobs/activity surface for durable computation state, approvals, costs, logs, and artifacts.

Phase 0 freezes the central multi-document workspace with a compact global rail/header, dense project explorer, dominant document area, switchable/resizable Inspector/AI context dock, and collapsed activity shelf. Large desktops may show Inspector and AI concurrently; laptops switch them; tablet/mobile reduce panel concurrency. See [workspace specification](product/WORKSPACE_SPECIFICATION.md), [navigation](design/NAVIGATION_SPEC.md), and [responsive behavior](design/RESPONSIVE_BEHAVIOR.md).

## Scientific interaction rules

- Always expose units, method/source, validation state, and approximation where relevant.
- Visually distinguish `EXPERIMENTAL`, `CALCULATED`, `EXTRACTED`, `DIGITIZED`, and `AI_HYPOTHESIS`; show `VERIFIED` independently.
- Failed, partial, nonconverged, preview, and authoritative results cannot share an ambiguous state treatment.
- Dangerous or expensive actions show scope, estimate/cap, consequences, approval, and cancellation behavior.
- Keep raw data/artifacts reachable; do not trap users in AI summaries.
- Linked charts/structures use stable selections, keyboard-accessible alternatives, and explain the mapping/confidence.
- AI structure changes preview and create variants by default.

## Design system scope for Phase 0

Define color/typography/density/spacing/elevation tokens, focus and selection states, provenance/status palettes, scientific number and unit formatting, tables/trees/forms, panels/splitters/tabs, command/search, tool plans, job states, plots, molecule/scene chrome, empty/error/loading states, and export layouts.

Accessibility targets include keyboard-first workstation operation, visible focus, semantic controls, text alternatives for non-text scientific views, non-color-only state, scalable text, and WCAG 2.2 AA for applicable interfaces. Dense does not mean illegible.

## Internationalization

All user-facing strings route through locale messages from the first implementation. Layout must tolerate Turkish, Russian, and German expansion; scientific values remain invariant apart from locale-aware display formatting. See [i18n and SEO](13_I18N_AND_SEO.md).

## Phase 0 validation artifacts

- Primary personas/jobs and end-to-end workflows.
- Information architecture and route map.
- Low-fidelity workstation states for structure → calculation → result → comparison.
- AI plan/approval/budget interaction specification.
- Design tokens and Blueprint composition rules.
- Anti-slop, accessibility, responsive, error, and scientific-state checklists.

See [ADR-002](adr/ADR-002-blueprint-ui-foundation.md) and NEXT.md.

Phase 0 artifacts are now defined in [Product Definition](product/PRODUCT_DEFINITION.md), the [Design System](design/DESIGN_SYSTEM.md), and [wireframes](wireframes/WORKSPACE_WIREFRAMES.md). Implementation remains Phase 1+.
