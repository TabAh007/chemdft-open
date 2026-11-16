# ADR-048: Adaptive Workspace Layout, In-House Accessible Splitter, and Unified Export

- **Status:** Accepted and implemented (Release 0.0.33); verified across unit, integration, and Playwright viewport test suites.
- **Date:** 2026-11-10
- **Scope:** Workspace layout adaptation, container-width responsiveness, pane resizing, and export consolidation (`apps/web`, Release 0.0.33).
- **Consulted:** `docs/TECHNOLOGY_REGISTRY.md` (Index and Frontend entries), `docs/15_ENGINEERING_RULES.md` (Rule 16 Impeccable, Rule 20 Desktop-first), `docs/14_ROADMAP.md` (UI-1 Workstation), `docs/02_SCIENTIFIC_INTEGRITY.md`.

---

## Context

ChemDFT's AI Scientist workstation must be comfortable and productive on a wide range of desktop and laptop displays, from high-resolution monitors down to an 11" screen and 16" laptops with tiled or shrunken windows. The hard minimum supported viewport is 1024x600, along with 834px wide (tablet portrait) and ~860px wide (half-screen). Phone layout (<834px) remains explicitly deferred.

Key design requirements:
1. **Vertical space budget:** Top bar 44px, exactly one action row, status bar 22px; the molecular viewer must occupy at least 55% of the total window height.
2. **Width tiers:** Determined by the container width of the workspace, not merely `window.innerWidth`:
   - `wide` (>=1500px): Full 3-column workstation (Explorer 240px, 3D viewer, AI Scientist dock ~380px).
   - `medium` (1100–1499px): Explorer collapses to a 48px icon rail; AI dock ~300px.
   - `narrow` (<1100px): One side panel at a time using Blueprint `AppDrawer` slide-overs (scrim, focus trap, Esc-to-close, aria-label).
   - `1024x600`: Icon rail, AI in top bar, secondary actions folded into `More ▾`, viewer height preserved.
3. **Resizable & collapsible panes:** Explorer and AI dock widths must be user-resizable via drag and keyboard, collapsible, and remembered across sessions via `localStorage` (fail-soft with zero errors when storage is unavailable).
4. **Unified Export control:** Consolidate seven disparate export buttons across the workstation into a single, persistent "Export" menu in the action row, preserving all underlying file formats, calculations, and citation metadata.

---

## Evaluation of Splitter Approaches

### 1. Candidate Library: `react-resizable-panels`
- **Published version:** 2.1.7 (latest published on npm).
- **License:** MIT.
- **Bundle impact:** ~15–20 kB minified.
- **Compatibility:** While functional in React 18, React 19 and Next.js 16 App Router SSR/hydration require specific ref patterns and client-boundary wrappers. More importantly, wrapping the complex ChemDFT workbench in `<PanelGroup>` and `<Panel>` components necessitates intrusive restructuring of the existing CSS Grid workstation layout and risks interfering with Three.js canvas auto-resize observers.

### 2. In-House Accessible `WorkspaceSplitter` (Selected)
- **Implementation:** Custom React component (`apps/web/src/app/_components/workspace-splitter.tsx`) using CSS Grid column track sizing, standard pointer events (`setPointerCapture`), and accessible keyboard controls.
- **Dependencies added:** **Zero** external npm dependencies.
- **Accessibility:** WAI-ARIA `role="separator"`, `aria-orientation="vertical"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, `aria-label`, visible keyboard focus ring, Arrow Left/Right key adjustments (10px step, 50px with Shift), Home/End keys (collapse/expand), and double-click to reset.
- **Resilience:** Wrapped in try/catch persistence helper (`persisted-layout.ts`); gracefully defaults to standard widths if `localStorage` throws or is disabled in restricted environments.

---

## Decision

1. **Implement `WorkspaceSplitter` in-house:** Reject external panel libraries in favor of a lean, accessible 100-line React component strictly adhering to WAI-ARIA separator guidelines.
2. **Container-width tier hook (`useWorkspaceTier`):** Measure the actual bounding box of the workstation shell via `ResizeObserver`, classifying layout into `wide`, `medium`, `narrow`, and `compact-height`.
3. **Slide-over drawers for narrow viewports:** On `<1100px`, Explorer and AI Scientist dock open as modal slide-over overlays (`AppDrawer`) with inert background scrim, keyboard escape handling, and focus return. Both drawers can never be open simultaneously.
4. **Single unified `ExportMenu`:** Replace disparate export controls across Project Overview, Comparison Workstation, Molecular Orbital Workspace, Molecule Editor, and 3D Viewer Toolbar with one shared `ExportMenu` component mounted permanently on the right of the action row.
5. **Plain Explorer:** Fold all empty catalog sections into a single summary line ("Nothing yet: ...") with section counts on non-empty headers, changing UI wording from "Committed" to "Saved" with an explanatory scientific integrity tooltip.

---

## Consequences

- **Positive:**
  - Zero bundle bloat; no third-party package dependencies added.
  - Zero hydration mismatches; clean CSS Grid and flexbox architecture.
  - Fully verified across 7 viewport resolutions (1024x600, 1280x720, 1366x768, 1440x900, 1728x900, 860x800, 834x1112) with 100% green Playwright automated tests.
  - Full keyboard accessibility and WCAG AAA color contrast.
- **Negative / Trade-offs:**
  - Drag resizing requires explicit mouse/touch pointer event handling rather than declarative panel props.
  - Phone layout (<834px) is deferred and explicitly unsupported.

