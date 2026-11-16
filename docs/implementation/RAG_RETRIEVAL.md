# RAG Retrieval Contract

Phase 9 V1 uses deterministic scientific-aware chunks (document page/paragraph, evidence candidate/anchor, structure metadata, calculation summary, dataset metadata, and confirmed project memory). Chunk identity is a SHA-256 of source identity, revision, page, content, and chunker version.

Search performs:

1. Unicode/unit-preserving normalization and exact lexical token matching.
2. Deterministic embedding similarity through a provider-neutral gateway and `KnowledgeVectorIndex` adapter (`SQLiteVectorIndex` or `PostgresPgvectorIndex`).
3. Bounded hybrid scoring (`0.65 * lexical + 0.35 * semantic`) and stable tie-breaking.
4. Typed filters for source type/class, document, structure, calculation, year, and DOI.

Results contain snippets, relevance components, source class, verification state, document/page/anchor identifiers, citation type, and index version. They never contain embedding vectors, object/storage keys, or provider secrets. The `knowledge.search` Tool Registry action uses the same service and cannot escape its project scope.

Index states are `PENDING`, `INDEXING`, `READY`, `FAILED`, and `STALE`. `KnowledgeIndexJob` states and leases are durable; `chemdft-knowledge-worker` supports continuous and one-shot operation. Indexing failures leave source records and the previous active retrieval generation usable. Reindexing uses a source fingerprint plus index version as its idempotency key.
