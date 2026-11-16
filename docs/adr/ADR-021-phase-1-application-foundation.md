# ADR-021: Phase 1 application foundation

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

Phase 1 needed to turn the documentation-only repository into a production-grade application foundation without implementing scientific engines, AI providers, billing, WebMCP, or fake scientific data. The implementation had to preserve the Phase 0 workstation identity and keep application, domain, storage, and future scientific boundaries separate.

## Decision

Use a small pnpm workspace for TypeScript and independent uv-managed Python projects. Implement the browser workstation in Next.js App Router, React, TypeScript, next-intl, and Blueprint.js only through ChemDFT wrappers/tokens. Implement the application API in FastAPI with Pydantic, SQLAlchemy 2, Alembic migrations, and PostgreSQL as the application database target.

Authentication is represented by a normalized internal authorization context. Phase 1 ships only a development identity adapter, gated by `CHEMDFT_DEV_IDENTITY_ENABLED`; production identity provider, SSO, and session storage remain deferred.

Use explicit organization/project membership checks in application services. Project reads/writes never trust a browser-supplied project ID without server-side organization and member validation. The schema is compatible with future PostgreSQL RLS, but Phase 1 enforces authorization in application services and tests.

Use a provider-neutral `ObjectStore` protocol with a local filesystem adapter for development. Raw uploads are stored immutably with server-calculated SHA-256, size, object key, actor, timestamp, and provenance class. The API does not parse uploaded scientific content.

Use OpenAPI as the authoritative transport contract exposed by FastAPI for Phase 1 API models. TypeScript packages own UI/domain route and fixture contracts for the web shell; generated TypeScript clients are deferred until API surface area is large enough to justify generation.

## Consequences

The repository now has one root verification path, lockfiles for JavaScript and Python dependencies, CI-ready commands, route tests, authorization tests, raw-file hash tests, and visual review evidence. PostgreSQL provider and deployment choices remain intentionally open beyond the driver and migration foundation. Scientific schemas, engines, AI providers, compute providers, payments, RAG, and WebMCP remain later-phase work.

`psycopg` is the selected PostgreSQL driver for now and is flagged in the license baseline for commercial legal review because it is LGPL-licensed.
