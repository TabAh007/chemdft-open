# ADR-034: PostgreSQL vector storage and durable knowledge indexing

## Decision

Phase 9 uses a provider-neutral `KnowledgeVectorIndex` boundary. SQLite keeps an exact deterministic scan for local development and CI. PostgreSQL is the production adapter and stores V1 embeddings in native `vector(64)` columns supplied by `pgvector==0.5.0` (MIT), using exact cosine distance (`<=>`) with `project_id` in the database predicate. HNSW/IVFFlat indexes are deferred until corpus sizing supports evidence-based tuning.

Indexing is a dedicated durable queue, not a scientific `ComputeJob`. `KnowledgeIndexJob` and append-only `KnowledgeIndexAttempt` rows carry source fingerprints, index identity, leases, heartbeats, bounded retries, and recovery. A successful replacement is activated only after all derived chunks and embeddings commit; source authority and provenance are never modified by the worker.

## Consequences

- API uploads, memory writes, and AI requests enqueue work and return without embedding generation.
- The same typed search contract works on SQLite and PostgreSQL, and vectors never cross the API boundary.
- Normal verification remains PostgreSQL-independent; the gated integration test proves native storage and hard cross-project isolation when a pgvector service is provisioned.
- V1 intentionally fixes the native dimension at 64 for the deterministic index identity. A future model/dimension is a new index version and migration, not an implicit mixed-vector column.
