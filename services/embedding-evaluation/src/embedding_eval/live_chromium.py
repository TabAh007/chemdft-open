"""Read-only, local-only comparison against the already indexed Chromium paper."""

from __future__ import annotations

import argparse
import json
import sqlite3
import time
import urllib.request
from pathlib import Path
from typing import Any

from .models import MODEL_CANDIDATES, DeterministicFakeEmbeddingGateway, HuggingFaceSentenceGateway
from .retrieval import hybrid_score, lexical_score


PROJECT_ID = "8875ce9f-6d51-4019-b8b2-226d06519c80"
QUERIES = (
    {"id": "lattice_en", "text": "lattice parameters", "target_pages": [2]},
    {"id": "xrd_en", "text": "XRD peaks", "target_pages": [6]},
    {"id": "thermal_en", "text": "thermal decomposition", "target_pages": [5]},
    {"id": "particle_en", "text": "particle size", "target_pages": [7, 8]},
    {"id": "formula", "text": "Cr2O3", "target_pages": [2, 6]},
    {"id": "doi", "text": "10.17223/24135542/33/9", "target_pages": [1]},
    {"id": "lattice_ru", "text": "параметры ячейки", "target_pages": [2]},
    {"id": "xrd_ru", "text": "пики рентгеновской дифракции", "target_pages": [6]},
    {"id": "thermal_ru", "text": "термическое разложение", "target_pages": [5]},
    {"id": "particle_ru", "text": "размер частиц", "target_pages": [7, 8]},
)


def _cosine(left: tuple[float, ...], right: tuple[float, ...]) -> float:
    return max(0.0, min(1.0, sum(a * b for a, b in zip(left, right, strict=True))))


def load_active_chunks(db_path: Path, project_id: str) -> list[dict[str, Any]]:
    uri = f"file:{db_path.resolve()}?mode=ro"
    connection = sqlite3.connect(uri, uri=True)
    connection.row_factory = sqlite3.Row
    try:
        row = connection.execute(
            "SELECT status, active_generation, chunk_count FROM knowledge_index_states "
            "WHERE project_id=? AND scope_type='PROJECT' AND scope_id=? "
            "AND index_version='knowledge-v1' LIMIT 1",
            (project_id, project_id),
        ).fetchone()
        if row is None or row["status"] != "READY" or not row["active_generation"]:
            raise RuntimeError("The selected project's active knowledge generation is not READY.")
        records = connection.execute(
            "SELECT c.id AS chunk_id, c.content, i.source_type, i.source_class, i.page_number "
            "FROM knowledge_embeddings e "
            "JOIN knowledge_chunks c ON c.id=e.chunk_id "
            "JOIN knowledge_items i ON i.id=c.knowledge_item_id "
            "WHERE e.project_id=? AND e.generation=? AND e.index_version='knowledge-v1' "
            "ORDER BY c.id",
            (project_id, row["active_generation"]),
        ).fetchall()
        if len(records) != row["chunk_count"]:
            raise RuntimeError("Active-generation chunk count does not match the API status.")
        return [dict(record) for record in records]
    finally:
        connection.close()


def api_baseline(query: str, project_id: str, api_url: str) -> list[dict[str, Any]]:
    payload = json.dumps({"query": query, "limit": 5}).encode("utf-8")
    request = urllib.request.Request(
        f"{api_url.rstrip('/')}/v1/projects/{project_id}/knowledge/search",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        results = json.loads(response.read())["results"]
    # Deliberately retain only source/page metadata, never the paper's passage text.
    return [
        {
            "page": result.get("page_number"),
            "source_type": result.get("source_type"),
            "source_class": result.get("source_class"),
        }
        for result in results[:5]
    ]


def evaluate_live(
    gateway: Any, records: list[dict[str, Any]], project_id: str, api_url: str
) -> dict[str, Any]:
    texts = [record["content"] for record in records]
    started = time.perf_counter()
    document_vectors = gateway.embed_documents(texts)
    doc_seconds = time.perf_counter() - started
    output_queries: dict[str, Any] = {}
    for query in QUERIES:
        started = time.perf_counter()
        query_vector = gateway.embed_query(query["text"]).vector
        query_ms = (time.perf_counter() - started) * 1000
        ranked: dict[str, list[tuple[dict[str, Any], float]]] = {
            "lexical": [],
            "semantic": [],
            "current_hybrid": [],
        }
        for record, embedding in zip(records, document_vectors, strict=True):
            lexical = lexical_score(query["text"], record["content"])
            semantic = _cosine(query_vector, embedding.vector)
            ranked["lexical"].append((record, lexical))
            ranked["semantic"].append((record, semantic))
            ranked["current_hybrid"].append((record, hybrid_score(lexical, semantic)))
        strategy_results: dict[str, Any] = {}
        for strategy, hits in ranked.items():
            hits.sort(key=lambda item: (-item[1], item[0]["chunk_id"]))
            pages = [record["page_number"] for record, _score in hits[:5]]
            strategy_results[strategy] = {
                "top5": [
                    {
                        "page": record["page_number"],
                        "source_type": record["source_type"],
                        "source_class": record["source_class"],
                    }
                    for record, _score in hits[:5]
                ],
                "target_page_hit_at_5": any(page in query["target_pages"] for page in pages),
            }
        strategy_results["api_current"] = {
            "top5": api_baseline(query["text"], project_id, api_url),
            "note": "Actual current API result metadata; passage text is discarded.",
        }
        output_queries[query["id"]] = {
            "query": query["text"],
            "target_pages": query["target_pages"],
            "encode_latency_ms": round(query_ms, 3),
            **strategy_results,
        }
    return {
        "model": getattr(gateway, "model", "unknown"),
        "provider": getattr(gateway, "provider", "unknown"),
        "dimension": getattr(gateway, "dimension", None),
        "chunk_count": len(records),
        "document_embedding_seconds": round(doc_seconds, 4),
        "model_device": getattr(gateway, "device", "local-fake"),
        "queries": output_queries,
        "privacy": "Read-only active generation; raw passage text held in memory and omitted from report output.",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path, default=Path("/tmp/chemdft-localhost.db"))
    parser.add_argument("--project-id", default=PROJECT_ID)
    parser.add_argument("--api-url", default="http://localhost:8123")
    parser.add_argument("--model", choices=["fake", *MODEL_CANDIDATES], required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    records = load_active_chunks(args.database, args.project_id)
    gateway = (
        DeterministicFakeEmbeddingGateway()
        if args.model == "fake"
        else HuggingFaceSentenceGateway(args.model, offline=args.offline)
    )
    result = evaluate_live(gateway, records, args.project_id, args.api_url)
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    summary = {
        "model": result["model"],
        "dimension": result["dimension"],
        "chunk_count": result["chunk_count"],
        "query_results": {
            name: {
                strategy: data.get("target_page_hit_at_5")
                for strategy, data in info.items()
                if isinstance(data, dict) and strategy != "api_current"
            }
            for name, info in result["queries"].items()
        },
    }
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
