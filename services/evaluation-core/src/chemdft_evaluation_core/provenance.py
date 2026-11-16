"""Review and source provenance checks performed before a future freeze."""

from __future__ import annotations

from .schema import ChemDFTBenchmark, ReviewDecision


def scoring_ids(benchmark: ChemDFTBenchmark) -> tuple[str, ...]:
    """Deterministic reviewed scoring set; rejected rows remain in provenance."""
    return tuple(sorted(row.query_id for row in benchmark.scoring_qrels()))


def rejected_ids(benchmark: ChemDFTBenchmark) -> tuple[str, ...]:
    return tuple(
        sorted(row.query_id for row in benchmark.reviews if row.decision == ReviewDecision.REJECTED)
    )
