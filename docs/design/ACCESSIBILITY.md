# Accessibility Specification

Target WCAG 2.2 AA where applicable. Scientific density and canvas technology do not excuse inaccessible controls or information loss.

## Keyboard and focus

- Every application command has a keyboard-reachable control; common operations support shortcuts disclosed in menus/tooltips.
- Logical focus order follows header → rail/explorer → active document → inspector/context dock → activity shelf, with shortcuts/landmarks to move among regions.
- Visible 2px focus indicator meets contrast and is distinct from selection. Focus is restored after dialogs, drawers, tab closure, and document changes.
- Tree, tabs, menus, grids/tables, dialogs, splitters, toolbar roving focus, and command palette follow established ARIA keyboard patterns.
- Canvas interactions provide an adjacent accessible selection list/table and keyboard commands where feasible.

## Semantics and announcements

- Named landmarks, headings, document titles, tab states, and breadcrumbs expose orientation.
- Icon-only controls have accessible names; scientific symbols include spoken expansions where ambiguity exists.
- Job state, validation, approval, estimate changes, new errors, and selection links use polite/assertive live regions proportional to urgency—never continuous log spam.
- Provenance glyphs always include source/verification text for assistive technology.

## Nonvisual scientific alternatives

- Molecule/crystal: atom/site table with element, index, coordinates, selection, bonds/neighbors where useful; measurement workflow accepts atom indices and reports numeric result.
- Spectrum/chart: data/peak table with axes/units, series, assignments, keyboard range controls, and “focus in chart.”
- Orbital/surface: source calculation, orbital/energy/occupancy/isovalue/grid/legend and downloadable numerical artifact; description does not pretend to replace spatial interpretation.
- Vibration: mode/frequency/intensity, vectors/table, involved atoms, phase stepping, and reduced-motion view.
- Comparison: metrics, source versions, mappings, differences, conflicts, and synchronized-state controls in text/table form.

## Color, contrast, type

Text/control/focus contrast meets AA; boundaries and selected states remain legible in high contrast. State never depends only on hue—use label, glyph, line style, position, or pattern. Support browser zoom to 200% without lost controls/content; tables/canvases may scroll within clearly labeled regions. Do not lock line height or truncate essential scientific values without a reveal.

## Motion

Respect `prefers-reduced-motion`. Remove panel/scroll/selection animation and autoplay. Scientific animation defaults off or paused for reduced motion and offers vector arrows, frame stepping, phase slider, and numeric data. No constant rotation or decorative motion.

## Forms, errors, and approvals

Labels, descriptions, units, required state, constraints, and errors are programmatically associated. Error summary focuses and links to fields; exact scientific error is preserved. Approval sheets announce total range, maximum cap, plan revision, and consequences before the primary action. Destructive actions cannot rely on color or vague button text.

## Testing contract

- Automated semantic/contrast smoke checks plus manual keyboard and screen-reader passes.
- 200% zoom/reflow, high-contrast, reduced-motion, and long English/German/Russian/Turkish strings.
- Canvas/table equivalence tests for selection and values.
- No critical action reachable only through hover, drag, precise pointer, color, animation, or AI conversation.

See [responsive behavior](RESPONSIVE_BEHAVIOR.md) and Phase 1 acceptance.
