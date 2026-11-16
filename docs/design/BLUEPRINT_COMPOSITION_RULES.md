# Blueprint.js Composition Rules

## Role

Blueprint.js is the only full component framework. Use its accessibility, interaction, focus, overlay, menu, tree, form, and keyboard foundations through a ChemDFT wrapper layer. Pages consume ChemDFT primitives and semantic tokens instead of importing arbitrary Blueprint components and default classes throughout feature code.

## Wrapper boundary

`packages/ui` should own theme variables/CSS layers and primitives such as `Button`, `IconButton`, `Menu`, `Dialog`, `Drawer`, `Tree`, `Tabs`, `FormGroup`, `Select`, `Tooltip`, `Popover`, `Callout/InlineMessage`, `Spinner/Progress`, and table helpers. Wrappers expose domain-neutral variants; provenance/job/scientific components compose them separately.

Do not fork Blueprint internals without a documented accessibility/behavior reason. Do not leak Blueprint color constants, spacing, or class selectors into domain feature packages.

## Composition rules

- **Navigation:** Tree rows are 32px, square/2px radius, indentation + disclosure + small icon + label + flexible metadata + count/status. Active state uses subtle `selection` fill and a 2–3px leading accent edge.
- **Tabs:** use line/edge-active document tabs; pinned/dirty/running states are compact glyphs with accessible labels. No pill tabs.
- **Panels:** docked surfaces use borders and headers. `Card` is not a universal section wrapper.
- **Forms:** label/value alignment, logical grouping, inline validation, units and help. Advanced sections may collapse but selected values remain summarized.
- **Buttons:** one clear primary action per local decision region. Icon-only buttons require tooltip + accessible name; destructive actions use text in confirmation.
- **Dialogs:** reserve for blocking approval/confirmation or focused creation. Do not place dialogs inside dialogs; use step regions only when the task truly spans steps.
- **Drawers:** responsive/transient replacement for docked panels, not permanent desktop floating UI.
- **Toasts:** transient confirmation only. Scientific failure, approval, provenance, or long-job state must persist in document/activity UI.
- **Callouts:** precise warning/error/evidence blocks, not colorful marketing boxes.
- **Progress:** percentage only with real telemetry; use stage list or indeterminate state otherwise.
- **Tooltips/popovers:** supplemental context, never the sole location of essential scientific source, error, or approval information.

## Theme isolation

Use one root ChemDFT theme class/provider and semantic CSS variables. Override Blueprint appearance in a documented layer with visual regression/interaction tests. Dark mode later gets an explicit token map; never sprinkle component-level dark exceptions.

## Prohibited patterns

- Another full design system or unreviewed component kit.
- Default Blueprint blue/spacing/card composition as finished identity.
- `Card` around each form/table/section or nested cards.
- Rounded/pill `Tabs`, `ButtonGroup`, or navigation used for decoration.
- Icons on every label, gratuitous intent colors, or large status tags.
- Feature code reimplementing focus, menu keyboard behavior, dialogs, or action authorization.

## Phase 1 validation

- Import lint/boundary rule: feature surfaces import ChemDFT UI primitives, not raw framework internals except allowlisted infrastructure files.
- Keyboard/focus/ARIA tests for wrapped components.
- Visual fixtures for density, long localized strings, error/disabled/loading, and provenance/job states.
- Audit confirms Blueprint is the sole full design system and no default component demo page became the product shell.
