# ChemDFT Design System

## Visual thesis

ChemDFT should read as a calibrated scientific instrument joined to an IDE: cool light surfaces, exact alignment, compact controls, clear state, and depth only where layers genuinely overlap. Blueprint.js supplies robust interaction behavior; ChemDFT tokens and composition supply identity.

This is the Phase 0 specification. Exact implementation values may be tuned for WCAG/platform rendering in Phase 1 without changing semantic roles.

## Color tokens — light theme

| Token | Value | Use |
|---|---:|---|
| `canvas` | `#F2F4F6` | app background/gutters |
| `surface` | `#FFFFFF` | primary documents/panels |
| `surface-subtle` | `#F7F9FA` | toolbars, grouped fields, alternate rows |
| `surface-raised` | `#FFFFFF` | popovers/dialogs only |
| `text` | `#17212B` | primary text/scientific values |
| `text-secondary` | `#596674` | metadata/secondary labels |
| `text-disabled` | `#8A949E` | unavailable controls with explanation |
| `border` | `#D6DCE2` | one-pixel separators |
| `border-strong` | `#AEB8C2` | resizers/selected boundaries |
| `accent` | `#1F63B5` | primary action/active edge/link |
| `accent-hover` | `#174F92` | hover/pressed |
| `selection` | `#E3EFFC` | selected row/range |
| `focus` | `#0B6FCB` | 2px focus indicator plus offset |
| `success` | `#237A4B` | successful operational state |
| `warning` | `#9A6500` | caution/approximation |
| `error` | `#B4232B` | failure/destructive state |
| `info` | `#315E8A` | neutral operational information |

### Provenance roles

Use color sparingly with glyph/text. Background tints are optional and very light.

| Token | Foreground | Meaning |
|---|---:|---|
| `provenance-experimental` | `#08756A` | direct experimental import |
| `provenance-calculated` | `#315EAE` | deterministic calculation |
| `provenance-extracted` | `#6651A3` | explicit document extraction |
| `provenance-digitized` | `#986400` | approximate graph/image digitization |
| `provenance-hypothesis` | `#9A3F72` | AI hypothesis/reconstruction |
| `verification` | `#237A4B` | orthogonal verified state |

Never rely on these hues alone. Dark theme is later and must define new semantic values, not invert blindly.

## Typography

- **UI:** native workhorse stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`; base 13px/18px at default density.
- **Scientific values/tabular data:** `ui-monospace, "SFMono-Regular", Consolas, monospace`; tabular numerals; 12–13px.
- **Equations:** semantic MathML where possible with `Cambria Math, STIX Two Math, serif` fallback; never rasterize ordinary equations.
- **Raw input/log/code:** `ui-monospace`; 12px/18px.
- **Labels:** 11–12px, medium weight; sentence case. Avoid excessive tracking/all-caps; short section kickers may use modest tracking.
- **Headings:** 20/26 page, 16/22 document, 13/18 section; compact weight hierarchy. No oversized application headlines.

Use scientific precision intentionally: align decimals, preserve significant figures from source, show units adjacent, and never imply extra precision through formatting.

## Spacing and sizing

Spacing scale: `2, 4, 6, 8, 12, 16, 24, 32` px. Use 4/8 for control interiors, 12/16 for panel sections, 24/32 only between major page regions.

| Element | Default |
|---|---:|
| Global header | 42px |
| Rail | 40px wide |
| Project tree row | 32px (28px future expert compact) |
| Document tab | 34px |
| Toolbar | 36px |
| Form control | 30px |
| Dense table row | 32px; multiline 44–52px |
| Status strip | 28px |
| Inspector padding | 12px; section gap 16px |
| Dialog padding | 16–24px by hierarchy, never card nesting |

## Radius, borders, elevation

- Radius tokens: `0`, `2px`, `4px`; `6px` only for major transient overlays/dialogs. Panels/tabs/tree rows use 0–2px.
- One-pixel borders/hairlines define structure. Selected panels use accent edge or border, not thick rounded fill.
- Shadows communicate true elevation only: popover/dialog/menu. Docked panels and ordinary sections use borders, not shadows.
- Resizers are 1px visible / larger invisible hit targets with focus/hover feedback.

## Component character

- Buttons are compact rectangles; primary action uses solid accent, secondary uses surface/border, tertiary is text/icon with clear hit area.
- Cards are reserved for standalone selectable objects or public pricing, not every section. Application sections use headers, rules, grids, and panels.
- Tabs use baseline/edge selection, not pills.
- Tables favor aligned columns, sticky headers, density, sorting/filtering, and provenance/status columns.
- Forms use label/value grids and collapsible sections; required/errors/help are explicit.
- Menus and dialogs use Blueprint behavior restyled to tokens, with restrained elevation.

## Motion

Functional transitions: 80–160ms for hover/focus/panel changes; 160–240ms for drawers/dialogs. No perpetual decorative motion. Scientific trajectory/vibration timing is data-driven and separately controlled. Respect reduced motion by removing spatial transitions and replacing scientific animation with step/frame/vector alternatives.

## Charts and viewports

Charts use neutral axes/grid, one emphasized selection/accent, provenance-aware series styles, and palettes chosen by semantics—not random categorical colors. Molecule viewport uses a subtle cool laboratory field and restrained lighting; no neon/glass/sci-fi effects.

## Locale and scientific formatting

- Format user-facing numbers/dates with `Intl`/equivalent for the active locale: English decimal point/comma grouping; Turkish and German decimal comma/period grouping; Russian decimal comma/nonbreaking-space grouping.
- Store and exchange canonical machine values locale-independently (for example JSON decimal point and ISO 8601 timestamps); exports declare locale when human formatting is applied.
- Display dates in locale form with timezone; provenance hover/trace also exposes an unambiguous ISO timestamp.
- Keep value and unit together with a nonbreaking space where appropriate; convert units only through an explicit deterministic display setting and retain canonical/source units.
- Never translate element symbols, method names, basis-set identifiers, chemical formulae, file formats, or canonical engine output. Localize surrounding explanations and accessible names.
- Avoid fixed-width translated labels; validate English, Turkish, Russian, and German expansion and truncation/reveal behavior.

See [Blueprint composition](BLUEPRINT_COMPOSITION_RULES.md), [accessibility](ACCESSIBILITY.md), and [anti-slop checklist](ANTI_SLOP_CHECKLIST.md).
