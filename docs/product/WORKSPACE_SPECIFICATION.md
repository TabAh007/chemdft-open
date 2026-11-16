# Main Workspace Specification

## Topology

The default desktop topology keeps the central scientific document dominant:

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ 42px global/project header: project · search · jobs · budget · account  │
├────┬─────────────────┬───────────────────────────────┬───────────────────┤
│rail│ project explorer│ central document workspace    │ context dock      │
│40px│ 220–300px       │ flexible, target ≥55% width  │ inspector / AI    │
│    │ resizable       │                               │ 300–420px         │
├────┴─────────────────┴───────────────────────────────┴───────────────────┤
│ 28px status strip; expandable Jobs / Logs / Problems / Artifacts shelf  │
└──────────────────────────────────────────────────────────────────────────┘
```

The rail and explorer may collapse independently. The right dock switches between Inspector and AI Scientist by default; wide screens may split them. The bottom shelf opens on demand and may resize to at most half the workspace. Layout sizes are remembered per user/device class, not embedded in scientific project state.

## Document model

- One active document per pane; up to two primary split panes in V1 UX, with comparison documents preferred over arbitrary four-way tiling.
- Tabs contain type glyph, concise name, state (dirty draft/running/warning), pin, and close. No provenance badge soup in tabs.
- Pinned tabs persist and stay left; unpinned overflow collapses to a searchable list after available width is used.
- Closing a committed document never deletes data. Dirty editor drafts require Save version / Discard draft / Cancel; calculation setting drafts are recoverable until explicitly discarded.
- Reopen from Recently closed or explorer. Project switching restores each project's last document set without starting jobs or spending AI tokens.
- Split view can link camera, selection, cursor, and zoom only through explicit compatible synchronization controls.

## Selection model

Selection is a typed stable reference: project/entity/version/sub-entity (atom, peak, mode, orbital, plane, data range). The active document publishes selection; inspector and AI context subscribe. Cross-view mappings create linked selections with mapping method, confidence, and source IDs. Closing a view does not destroy selection provenance.

## Context dock

- **Inspector:** deterministic properties, settings, provenance, source/artifact trace, editable fields allowed by state.
- **AI Scientist:** project conversation, selected entity references, plans, evidence, tool/job blocks, explanations.
- AI responses never cover the viewport or silently navigate. Entity links focus/open a document after explicit click/keyboard activation.

## Activity shelf

Collapsed strip: global job state counts, current selection summary, connectivity, approved/actual compute summary. Expanded panels:

- Jobs: state, name, structure, method/engine, honest progress, elapsed/remaining range, resource, cost, actions.
- Logs: streamed, searchable, severity/source labeled; raw engine log downloadable.
- Problems: validation, parser, nonconvergence, missing evidence, budget, connection issues.
- Artifacts: typed files, hashes/size/provenance, preview/download/export.

## Important states

- **No project:** product-level recent/create/import view; no fake dashboard.
- **Empty project:** onboarding actions in the central canvas plus contextual AI prompt; explorer shows real empty groups.
- **Loading:** retain shell and document skeleton geometry; state announced; no fake scientific content.
- **Disconnected:** read cached metadata where safe; disable mutations and explain job-state freshness.
- **Permission lost:** preserve local draft for recovery, block submit, identify required role.
- **Entity deleted/superseded:** show tombstone/redirect and provenance, never an ambiguous 404 inside workspace.

## Keyboard model

`⌘K/Ctrl+K` command palette; `⌘P/Ctrl+P` quick document open (if not conflicting by platform); `Ctrl+Tab` next document; platform-consistent pane focus shortcuts; arrow/tree semantics in explorer; Escape unwinds transient layers one level. Shortcuts are discoverable, remappable later, and never the only path.

## Performance contract

Panels virtualize long trees/tables/lists; scientific canvases suspend when hidden but preserve deterministic scene state; large artifacts load progressively with explicit resolution/LOD. AI panel/history must not block the active renderer or spectrum interaction.

Related: [information architecture](INFORMATION_ARCHITECTURE.md), [navigation](../design/NAVIGATION_SPEC.md), and [workspace wireframes](../wireframes/WORKSPACE_WIREFRAMES.md).
