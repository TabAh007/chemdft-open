# ADR-014: English-first but internationalization-ready

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

English launches first, with Turkish, Russian, and German planned next. Retrofitting strings/routes would be expensive and error-prone.

## Decision

Use locale-aware routing/messages from the first application code and never scatter hard-coded user-facing English through components.

## Consequences

Phase 0 tests layout expansion and scientific formatting; Phase 1 selects next-intl or equivalent. Canonical scientific values remain locale-independent. See [i18n and SEO](../13_I18N_AND_SEO.md).
