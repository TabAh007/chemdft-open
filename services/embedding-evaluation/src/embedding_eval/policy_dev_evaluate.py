"""DEV input preparation only. No retrieval experiment is implemented or run here."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from typing import Any

from .frozen_policy_dev_v1 import load_dev_qrels


@dataclass(frozen=True)
class DevEvaluationInputs:
    qrels: tuple[dict[str, Any], ...] = field(repr=False)
    benchmark_id: str = "retrieval-policy-dev-v1"
    partition: str = "DEV"


def prepare_dev_evaluation() -> DevEvaluationInputs:
    """The future DEV runner must enter here; no external path is accepted."""
    return DevEvaluationInputs(qrels=tuple(load_dev_qrels()))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preflight", action="store_true", required=True)
    parser.parse_args(argv)
    inputs = prepare_dev_evaluation()
    print(
        json.dumps(
            {
                "benchmark_id": inputs.benchmark_id,
                "partition": inputs.partition,
                "query_count": len(inputs.qrels),
                "answerable_count": sum(not row["no_answer"] for row in inputs.qrels),
                "no_answer_count": sum(row["no_answer"] for row in inputs.qrels),
                "retrieval_scoring": "NOT_RUN",
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
