# ADR-013: WebMCP compatibility without core dependency

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

Browser agents and future MCP clients should use ChemDFT safely, but an evolving interface must not own business logic or determine product viability.

## Decision

Expose allowlisted typed domain actions through WebMCP as a progressive adapter; later server-side MCP can adapt the same Tool Registry. WebMCP is not a core business dependency.

## Consequences

UI/API/AI/WebMCP/MCP share services and authorization. Tool discovery never grants permission, and destructive/expensive actions retain normal approvals. See [Tool Registry](../04_TOOL_REGISTRY.md).
