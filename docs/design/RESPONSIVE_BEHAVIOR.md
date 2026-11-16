# Responsive Behavior

ChemDFT is desktop/workstation-first within a responsive browser product. Responsive behavior preserves scientific context by reducing concurrent panels, not by hiding critical state.

## Large desktop — approximately ≥1440px

- Header + rail + expanded project explorer + dominant central document + right context dock.
- Inspector and AI Scientist may split when width permits; two-pane document split supported.
- Bottom activity shelf collapses/expands without covering primary content.

## Normal laptop — approximately 1100–1439px

- Rail remains; explorer collapsible/resizable.
- Right dock shows Inspector or AI Scientist, not both; can collapse to icon/edge control.
- Central workspace remains at least the primary visual area. Split view allowed when each document minimum is met; otherwise comparison document switches to stacked/overlay mode.

## Tablet — approximately 768–1099px

- Rail becomes compact header/drawer; explorer is a temporary drawer.
- One central document at a time. Inspector and AI are modal/nonmodal side sheets that never stack together.
- Editing is limited to controls that remain reliable with touch; complex precision workflows display desktop recommendation, not a broken squeezed toolbar.
- Jobs, approvals, result review, simple annotations/selections, and AI are fully supported.

## Mobile — <768px

- Supported: project list/overview, AI conversation/plans, job status/log summary, compute approvals/cancellation, simple result/provenance inspection, notifications, downloads/shares where safe.
- Not claimed: full 2D/3D molecule or crystal editing, precision measurement, multi-pane spectrum comparison, large expert forms, Publication Studio.
- Unsupported editing routes open a faithful read-only summary with “Continue on desktop” and preserve pending context/deep link.

## Panel adaptation

| Desktop component | Laptop | Tablet | Mobile |
|---|---|---|---|
| Project explorer | collapsible dock | drawer | project/entity navigator page |
| Inspector/AI | switchable dock | one dock | side sheet/full-height panel | full route/sheet |
| Activity shelf | expandable dock | expandable dock | Jobs sheet | Jobs route |
| Document tabs | full + overflow | compact + overflow | document switcher | back stack/switcher |
| Advanced settings | side/inline inspector | dock/dialog | full sheet | read/approve summary only |

## Touch and resizing

Hit targets are at least 24×24 CSS px for compact desktop with pointer and expand toward 44×44 for touch layouts. Splitters have larger invisible hit areas and keyboard controls. Toolbars collapse by priority into labeled menus; never hide state/provenance/units before decorative icons.

## Open boundary

Exact breakpoints may adjust after Phase 1 shell testing; behavior classes and mobile limitations are frozen. Dark-mode priority remains open. See [ADR-020](../adr/ADR-020-desktop-first-responsive.md).
