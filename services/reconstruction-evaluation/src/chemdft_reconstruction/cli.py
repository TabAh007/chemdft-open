from __future__ import annotations

import argparse
import csv
import importlib.metadata
import json
import platform
from collections import defaultdict
from dataclasses import replace
from pathlib import Path
from typing import Any

from .decimer_adapter import MODEL_ID, MODEL_VERSION, DecimerReconstructor
from .evaluation import has_stereochemistry, score_prediction
from .offline import deny_network

ROOT = Path(__file__).parents[2]
DEFAULT_DATASET = ROOT / "data" / "v1"


def evaluate(
    dataset: Path,
    output: Path,
    cache: Path,
    reuse_results: Path | None = None,
) -> dict[str, Any]:
    manifest = json.loads((dataset / "manifest.json").read_text())
    adapter = DecimerReconstructor(model_cache=cache, model_id=MODEL_ID)
    cached_by_id = {}
    if reuse_results is not None:
        cached_by_id = {
            row["case_id"]: row
            for row in json.loads(reuse_results.read_text())
            if row.get("model_version") == MODEL_VERSION
        }
    rows: list[dict[str, Any]] = []
    review_rows: list[dict[str, Any]] = []
    category_rows: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for case in manifest["examples"]:
        image_bytes = (dataset / case["image_path"]).read_bytes()
        metadata = {"image_id": case["case_id"], "category": case["category"]}
        cached = cached_by_id.get(case["case_id"])
        cache_valid = cached and cached.get("image_sha256") == case["image_sha256"]
        cached_model_matches = cached and (
            case["category"] != "hand_drawn" or cached.get("model_id") == "DECIMER-HandDrawn"
        )
        if cache_valid and cached_model_matches:
            cached_smiles = cached.get("model_output_smiles")
            result = DecimerReconstructor(
                predictor=lambda _image, value=cached_smiles: value,
                model_version=MODEL_VERSION,
                model_id=MODEL_ID,
            ).reconstruct(image_bytes, metadata)
            result = replace(result, runtime_ms=float(cached.get("runtime_ms", result.runtime_ms)))
        else:
            result = adapter.reconstruct(image_bytes, metadata)
        score = (
            score_prediction(case["ground_truth_smiles"], result.smiles)
            if case["scorable"]
            else None
        )
        record = {
            "case_id": case["case_id"],
            "category": case["category"],
            "ground_truth_smiles": case["ground_truth_smiles"],
            "model_output_smiles": result.smiles,
            "status": result.status.value,
            "representation_type": result.representation_type,
            "confidence": result.confidence,
            "parse_state": score.parse_state if score else result.parse_state,
            "graph_match": score.graph_match if score else None,
            "connectivity_match": score.connectivity_match if score else None,
            "stereochemistry_match": score.stereochemistry_match if score else None,
            "stereochemistry_applicable": (
                has_stereochemistry(case["ground_truth_smiles"])
                if case["ground_truth_smiles"]
                else False
            ),
            "formula_match": score.formula_match if score else None,
            "charge_match": score.charge_match if score else None,
            "atom_precision": score.atom_precision if score else None,
            "atom_recall": score.atom_recall if score else None,
            "atom_f1": score.atom_f1 if score else None,
            "bond_precision": score.bond_precision if score else None,
            "bond_recall": score.bond_recall if score else None,
            "bond_order_accuracy": score.bond_order_accuracy if score else None,
            "formula": result.formula,
            "formal_charge": result.formal_charge,
            "fragment_count": result.fragment_count,
            "elements": list(result.elements),
            "confident_looking_incorrect": score.confident_looking_incorrect if score else False,
            "valid_output_on_unsupported_input": (
                result.status.value == "UNSUPPORTED" and result.parse_state == "PARSED"
            ),
            "runtime_ms": result.runtime_ms,
            "preprocessing_recipe": case["preprocessing_recipe"],
            "preprocessing_version": case["preprocessing_version"],
            "model_id": result.model_id,
            "model_version": result.model_version,
            "diagnostics": list(result.diagnostics) + (list(score.diagnostics) if score else []),
            "image_sha256": case["image_sha256"],
            "license": case["license"],
        }
        rows.append(record)
        category_rows[case["category"]].append(record)
        if (
            not case["scorable"]
            or score is None
            or score.graph_match is not True
            or result.status.value != "MANUAL_REVIEW_REQUIRED"
        ):
            review_rows.append(
                {
                    "case_id": case["case_id"],
                    "category": case["category"],
                    "ground_truth": case["ground_truth_smiles"] or "not a single-molecule target",
                    "prediction": result.smiles or "(none)",
                    "graph_correct": score.graph_match if score else "not applicable",
                    "main_error": "; ".join(record["diagnostics"]),
                    "recommended_action": "MANUAL_REVIEW_REQUIRED",
                }
            )

    output.mkdir(parents=True, exist_ok=True)
    _write_json(output / "results.json", rows)
    _write_csv(output / "results.csv", rows)
    _write_csv(output / "human-review.csv", review_rows)
    summary = _summarize(category_rows)
    _write_json(output / "category-summary.json", summary)
    _write_csv(output / "category-summary.csv", summary)
    run_info = {
        "dataset_id": manifest["dataset_id"],
        "dataset_count": len(rows),
        "model_id": MODEL_ID,
        "model_version": MODEL_VERSION,
        "decimer_package_version": _package_version("decimer", MODEL_VERSION),
        "tensorflow_version": _package_version("tensorflow", None),
        "python_version": platform.python_version(),
        "platform": platform.platform(),
        "machine_architecture": platform.machine(),
        "model_assets": _model_asset_provenance(cache),
        "runtime_mode": (
            "local CPU; Python network/DNS access blocked; no confidence score consumed"
        ),
        "results": "per-case JSON/CSV plus category summary and human review sheet",
        "authority": "evaluation output only; no candidate persistence or promotion",
    }
    _write_json(output / "run.json", run_info)
    return {"run": run_info, "categories": summary, "review_count": len(review_rows)}


def _package_version(name: str, fallback: str | None) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return fallback


def _model_asset_provenance(cache: Path) -> dict[str, Any] | None:
    path = cache / "DECIMER-V2" / "model-provenance.json"
    return json.loads(path.read_text()) if path.is_file() else None


def _summarize(categories: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    rows = []
    unsupported = {
        "coordination_complex",
        "polymer_repeat",
        "reaction_scheme",
        "crystal_diagram",
        "plot_molecule",
        "multiple_molecules",
        "partially_occluded",
        "hand_drawn",
        "abbreviation",
    }
    for category, items in sorted(categories.items()):
        scorable = [item for item in items if item["ground_truth_smiles"]]
        parsed = sum(item["parse_state"] == "PARSED" for item in items)
        correct = sum(item["graph_match"] is True for item in scorable)
        stereo_items = [item for item in scorable if item["stereochemistry_applicable"]]
        stereo_denominator = len(stereo_items)
        stereo_correct = sum(item["graph_match"] is True for item in stereo_items)
        graph_correct_rate = correct / len(scorable) if scorable else None
        rows.append(
            {
                "category": category,
                "n": len(items),
                "parse_success_rate": parsed / len(items) if items else None,
                "graph_correct_n": correct,
                "graph_correct_rate": graph_correct_rate,
                "stereo_correct_n": stereo_correct,
                "stereo_correct_rate": stereo_correct / stereo_denominator
                if stereo_denominator
                else None,
                "stereo_applicable_n": stereo_denominator,
                "mean_atom_f1": _mean([item["atom_f1"] for item in scorable]),
                "mean_bond_precision": _mean([item["bond_precision"] for item in scorable]),
                "mean_bond_recall": _mean([item["bond_recall"] for item in scorable]),
                "mean_bond_order_accuracy": _mean(
                    [item["bond_order_accuracy"] for item in scorable]
                ),
                "valid_output_false_positives": sum(
                    item["confident_looking_incorrect"] for item in scorable
                ),
                "valid_output_on_unsupported_input": sum(
                    item["valid_output_on_unsupported_input"] for item in items
                ),
                "median_runtime_ms": _median([item["runtime_ms"] for item in items]),
                "recommendation": (
                    "ABSTAIN / UNSUPPORTED"
                    if category in unsupported
                    or (graph_correct_rate is not None and graph_correct_rate < 0.8)
                    else "GOOD ONLY WITH HUMAN REVIEW"
                ),
            }
        )
    return rows


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    return ordered[middle] if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / 2


def _mean(values: list[float | None]) -> float | None:
    present = [float(value) for value in values if value is not None]
    return sum(present) / len(present) if present else None


def _write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("")
        return
    with path.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(
            {
                key: json.dumps(value, sort_keys=True) if isinstance(value, (list, dict)) else value
                for key, value in row.items()
            }
            for row in rows
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the offline DECIMER evaluation harness")
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--model-cache",
        type=Path,
        required=True,
        help="Prepared PYSTOW_HOME; must not be inside the repo",
    )
    parser.add_argument(
        "--reuse-results",
        type=Path,
        help=(
            "Optional earlier results JSON; matching cases are reused except for "
            "mismatched hand-drawn model runs"
        ),
    )
    args = parser.parse_args()
    cache = args.model_cache.expanduser().resolve()
    if args.output.resolve().is_relative_to(cache) or cache.is_relative_to(args.output.resolve()):
        parser.error("Output and model cache must be separate directories")
    with deny_network():
        summary = evaluate(
            args.dataset.resolve(),
            args.output.resolve(),
            cache,
            args.reuse_results.resolve() if args.reuse_results else None,
        )
    print(json.dumps(summary, indent=2))
