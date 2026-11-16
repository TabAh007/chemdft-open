# Internationalization and SEO

## Internationalization

Launch in English (`en`); next target locales are Turkish (`tr`), Russian (`ru`), and German (`de`). Public and authenticated routing should support locale prefixes such as `/en/`, `/tr/`, `/ru/`, and `/de/`, compatible with next-intl or an equivalent selected in Phase 1.

Architecture rules:

- No hard-coded user-facing English throughout components; messages use stable semantic keys.
- Server and client validation errors map stable codes to locale messages.
- User-generated content, engine output, filenames, and citations are not silently translated.
- Scientific values, formulas, atom labels, and stored canonical units do not change by language; presentation may apply locale-aware decimal/date formatting without changing exported canonical data.
- Unit symbols, chemical nomenclature, pluralization, interpolation, and accessibility text receive domain-aware review.
- Layouts tolerate longer German/Turkish strings, Cyrillic, keyboard navigation, and future right-to-left support without promising an RTL launch.
- URLs store locale separately from stable resource IDs; changing language does not duplicate scientific entities.
- Exports record locale and retain machine-readable canonical values/units.

## SEO position

Brand: **ChemDFT**. Primary positioning: **Online DFT & Computational Chemistry Software**.

Phase -1 creates no thin or fake SEO pages. Public-content architecture should later support evidence-based, useful pages for:

`/dft-calculations`, `/online-dft-calculation`, `/computational-chemistry-software`, `/quantum-chemistry-software`, `/molecular-modeling`, `/homo-lumo-calculator`, `/ftir-analysis`, `/nmr-analysis`, `/xrd-analysis`, `/uv-vis-analysis`, `/gaussian-alternative`, `/webmo-alternative`, `/orca-alternative`, and `/pyscf-online`.

## Public-content requirements

- Locale-aware canonical and alternate links; no automatic indexing of private/project routes.
- Server-rendered metadata and semantic content appropriate to the framework selected in Phase 1.
- Original pages that explain real capabilities, methods, limitations, provenance, examples, and validation—not keyword shells.
- Accurate comparison pages that distinguish open-source engines, proprietary products, and ChemDFT's integration role; no false affiliation or unsupported claims.
- Structured data only where it truthfully matches visible content.
- Performance/accessibility targets and an XML sitemap/robots policy for public routes.
- Scientific examples must use real validated/demonstration data with source/provenance and must never be AI-fabricated.

Phase 0 freezes locale-prefixed public and authenticated route families (for example `/en/dft-calculations`). Phase 1 selects exact framework segment syntax and locale detection/redirect behavior without changing stable resource identity. See [ADR-014](adr/ADR-014-i18n-ready.md), [UI/UX](10_UI_UX_FOUNDATION.md), and the Phase 1 acceptance contract.
