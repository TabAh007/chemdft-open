# ADR-033: Require property-specific result validation

Status: Accepted

Authoritative calculated payloads must match a registered task-specific type and validator. Phase 5 registers `ENERGY → EnergyResult`; unknown generic worker payloads are rejected. A successful exit code is insufficient: convergence, finiteness, unit, method/basis identity, artifacts, provenance, and lifecycle must all pass before firewall publication.
