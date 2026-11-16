# ADR-003: Python scientific backend

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

The target scientific ecosystem is predominantly Python/native-library based and calculations require isolated asynchronous execution.

## Decision

Use Python with FastAPI for the application/scientific backend direction. Keep the web client in TypeScript and separate engine execution behind adapters/workers.

## Consequences

Cross-language contracts must be versioned/generated and Python dependency isolation is essential. Scientific binaries do not run in the API process. See [application architecture](../01_ARCHITECTURE.md).
