# Phase 9 Knowledge Architecture

ChemDFT knowledge is a project-scoped retrieval index over existing scientific records. It is never an authority store:

```text
ScientificDocument / Evidence / Structure / Calculation / Dataset / Memory
        -> deterministic source chunks
        -> lexical + embedding indexes
        -> project-scoped KnowledgeService
        -> bounded, source-bound retrieval result
        -> AI context / manual project search
```

`KnowledgeItem` preserves source entity, revision/hash, document/page/anchor, evidence, source class, and verification state. `KnowledgeChunk` is bounded searchable context; embeddings are internal derived records and are not returned by any public contract.

The default development and CI gateway is `DeterministicFakeEmbeddingGateway` (`fake/deterministic-hash-v1`, 64 dimensions). `SQLiteVectorIndex` is the exact-scan local/test adapter; production PostgreSQL uses `PostgresPgvectorIndex` and native `vector(64)` storage from `pgvector==0.5.0` (MIT). V1 deliberately uses exact cosine distance (`<=>`) with tenant predicates in the SQL query; HNSW/IVFFlat tuning is deferred until corpus sizing is known. Index version, provider, model, dimension, normalization, content hash, and generation identity are stored with each embedding so incompatible vectors cannot mix.

All service methods authorize the project before querying and repeat `project_id` predicates on item, chunk, and embedding joins. Source class and verification remain separate. A retrieved passage can inform an answer but cannot promote itself to `EXPERIMENTAL`, `CALCULATED`, `EXTRACTED`, or `DIGITIZED`.

Indexing is durable and asynchronous: source changes enqueue an idempotent `KnowledgeIndexJob`, a dedicated worker claims a lease, records append-only attempts, heartbeats, retries bounded failures, and activates only a successful generation. API, AI, and upload requests never generate embeddings. Expired leases are recoverable from database state, and a failed replacement leaves the previous usable index intact.

Project memory is explicit and user-confirmed (`PROJECT_NOTE`, `USER_CONFIRMED_FACT`, or `WORKFLOW_DECISION`). It is contextual knowledge, not scientific evidence. External literature connectors remain deferred and are kept separate from imported project documents.
