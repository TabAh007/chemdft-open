# Navigation Specification

## Global rail

40px conceptual width with small, familiar icons and tooltips/accessible names. Destinations: Projects, Jobs, Search/Command, and account/organization access. Active state is a narrow accent edge plus subtle background. No labels hidden without tooltip and no decorative icon inventory.

## Project explorer

- Width 220–300px, resizable/collapsible; rows 32px default.
- Header shows project name/status and compact overflow; no project marketing card.
- Hierarchy uses disclosure, 12–16px indentation steps, hairlines only when helpful, small type icons, state dots, counts aligned right.
- Groups: Overview, Samples, Structures, Experiments (by modality), Calculations, Literature, Reports; optional compact Tools shortcuts below a separator.
- Structure versions/conformers, result/artifact children, and evidence appear on expansion/context, not permanent first-level clutter.
- Compute balance/credits never appear as a large sidebar card; a small budget state may appear in the header/status strip and open Usage.

## Row anatomy

```text
│accent│disclose│icon│ label …………………… │status│count│
```

Hover adds only a quiet background and relevant trailing action. Selection and keyboard focus are visually distinct. Rename, context menu, drag/drop, loading, permission, error, and archived/superseded states retain stable row geometry.

## Project tree behavior

- Arrow keys follow ARIA tree behavior; typeahead searches visible siblings; Enter opens; right/left expand/collapse.
- Single click selects/opens based on platform convention; destructive actions never occur on single click.
- Drag/drop previews exact destination and operation; scientifically meaningful moves do not rewrite provenance/ownership without server validation.
- Counts are server-derived metadata and not badges competing for attention.
- Filter/search shows ancestors and preserves current expansion when cleared.

## Document navigation

Opening an entity creates/focuses its document. Explorer selection follows the active entity document. Internal subview/atom/peak selection does not churn the tree. Middle click/explicit “Open in split” may open beside; comparison uses a dedicated comparison document when semantics matter.

Tab overflow becomes a searchable switcher with pinned/recent/open groups. Never shrink tab labels to illegibility or create multiple tab rows by default.

## Command/search

`⌘K/Ctrl+K` is a unified deterministic palette for navigation and known actions. Results group Actions, Open documents, Project entities, Jobs, and Literature. Each shows shortcut/context and disabled reason. Free-form scientific reasoning is handed to AI Scientist explicitly; ordinary navigation never invokes an LLM.

## Breadcrumbs

Use only where context is otherwise ambiguous, such as Project / Structure / Version / Calculation. Breadcrumbs identify scope; they do not duplicate every tree level in all documents.

See [information architecture](../product/INFORMATION_ARCHITECTURE.md) and [workspace specification](../product/WORKSPACE_SPECIFICATION.md).
