"""Future package identities; historical freeze formats retain their original hashes."""

from __future__ import annotations

from .canonicalization import sha256
from .schema import ChemDFTBenchmark, Sha256, StrictModel
from .validation import validate_for_freeze


class FrozenPackage(StrictModel):
    benchmark_id: str
    benchmark_version: str
    corpus_sha256: Sha256
    qrels_sha256: Sha256
    review_sha256: Sha256
    manifest_sha256: Sha256
    package_sha256: Sha256


def canonical_parts(benchmark: ChemDFTBenchmark) -> dict:
    def dump(row):
        return row.model_dump(mode="json", exclude_none=True)

    def qrel_dump(row):
        value = dump(row)
        if "alternate_targets" in value:
            value["alternate_targets"].sort(key=lambda target: target["chunk_id"])
        return value

    return {
        "identity": dump(benchmark.identity),
        "corpus": {
            "sources": [
                dump(row) for row in sorted(benchmark.sources, key=lambda r: r.document_id)
            ],
            "chunks": [dump(row) for row in sorted(benchmark.chunks, key=lambda r: r.chunk_id)],
        },
        "queries": [dump(row) for row in sorted(benchmark.queries, key=lambda r: r.query_id)],
        "qrels": [qrel_dump(row) for row in sorted(benchmark.qrels, key=lambda r: r.query_id)],
        "reviews": [dump(row) for row in sorted(benchmark.reviews, key=lambda r: r.query_id)],
    }


def corpus_hash(benchmark: ChemDFTBenchmark) -> str:
    return sha256(canonical_parts(benchmark)["corpus"])


def qrel_hash(benchmark: ChemDFTBenchmark) -> str:
    parts = canonical_parts(benchmark)
    return sha256({"queries": parts["queries"], "qrels": parts["qrels"]})


def manifest_hash(manifest: dict) -> str:
    """Hash a manifest without its own digest field."""
    return sha256({k: v for k, v in manifest.items() if k != "manifest_sha256"})


def package_hash(manifest: dict) -> str:
    return sha256({k: v for k, v in manifest.items() if k != "package_sha256"})


def freeze_benchmark(benchmark: ChemDFTBenchmark) -> FrozenPackage:
    validate_for_freeze(benchmark)
    parts = canonical_parts(benchmark)
    manifest = {
        "identity": parts["identity"],
        "corpus_sha256": sha256(parts["corpus"]),
        "qrels_sha256": sha256({"queries": parts["queries"], "qrels": parts["qrels"]}),
        "review_sha256": sha256(parts["reviews"]),
    }
    return FrozenPackage(
        benchmark_id=benchmark.identity.benchmark_id,
        benchmark_version=benchmark.identity.version,
        corpus_sha256=manifest["corpus_sha256"],
        qrels_sha256=manifest["qrels_sha256"],
        review_sha256=manifest["review_sha256"],
        manifest_sha256=manifest_hash(manifest),
        package_sha256=package_hash(manifest),
    )
