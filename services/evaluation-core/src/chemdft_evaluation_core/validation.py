"""Explicit gate for a reviewed benchmark before freeze and evaluation."""

from __future__ import annotations

from .schema import ChemDFTBenchmark


def validate_for_freeze(benchmark: ChemDFTBenchmark) -> ChemDFTBenchmark:
    if not benchmark.sources or not benchmark.chunks or not benchmark.queries:
        raise ValueError("a frozen benchmark needs sources, chunks, and queries")
    if not benchmark.scoring_qrels():
        raise ValueError("a frozen benchmark needs at least one accepted QREL")
    return benchmark
