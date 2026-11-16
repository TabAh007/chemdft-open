from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

import numpy as np

from .models import HuggingFaceMoleculeEncoder
from .molecules import (
    MOLECULES,
    build_morgan_fingerprints,
    canonical_model_smiles,
    molecular_metrics,
)


def _fingerprint_vectors() -> dict[str, tuple[float, ...]]:
    from rdkit import DataStructs

    fingerprints = build_morgan_fingerprints()
    output = {}
    for item_id, fingerprint in fingerprints.items():
        bits = np.zeros((fingerprint.GetNumBits(),), dtype=np.int8)
        DataStructs.ConvertToNumpyArray(fingerprint, bits)
        output[item_id] = tuple(float(value) for value in bits)
    return output


def evaluate_molecules(encoder: Any, *, batch_size: int = 16) -> dict[str, Any]:
    smiles = canonical_model_smiles()
    started = time.perf_counter()
    matrix = encoder.encode(smiles, batch_size=batch_size)
    elapsed = time.perf_counter() - started
    if matrix.shape[0] != len(MOLECULES):
        raise ValueError("Molecule encoder did not return one vector for each input.")
    vectors = {
        item.id: tuple(float(value) for value in vector)
        for item, vector in zip(MOLECULES, matrix, strict=True)
    }
    metrics = molecular_metrics(MOLECULES, vectors)
    return {
        "model": getattr(encoder, "model_name", "Morgan-RDKit"),
        "device": getattr(encoder, "device", "CPU"),
        "dimension": int(matrix.shape[1]),
        "molecule_count": len(MOLECULES),
        "encoding_seconds": round(elapsed, 4),
        "milliseconds_per_molecule": round(elapsed / len(MOLECULES) * 1000, 3),
        "vector_index_bytes_float32": len(MOLECULES) * int(matrix.shape[1]) * 4,
        "estimated_api_cost_usd": 0.0,
        "metrics": metrics,
        "notes": {
            "fingerprints": "RDKit Morgan radius=2, 2048 bits, chirality enabled; reference only.",
            "metrics": "Tiny deterministic set; scores are exploratory, not chemistry truth.",
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=["smi-ted", "molformer", "morgan"], required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.model == "morgan":
        from rdkit import DataStructs

        fingerprints = build_morgan_fingerprints()
        started = time.perf_counter()
        vectors = _fingerprint_vectors()
        encoding_seconds = time.perf_counter() - started
        result = {
            "model": "Morgan-RDKit",
            "device": "CPU",
            "dimension": 2048,
            "molecule_count": len(MOLECULES),
            "encoding_seconds": round(encoding_seconds, 4),
            "milliseconds_per_molecule": round(encoding_seconds / len(MOLECULES) * 1000, 3),
            "vector_index_bytes_float32": len(MOLECULES) * 2048 * 4,
            "estimated_api_cost_usd": 0.0,
            "metrics": molecular_metrics(
                MOLECULES,
                vectors,
                similarity_fn=lambda left, right: DataStructs.TanimotoSimilarity(
                    fingerprints[left], fingerprints[right]
                ),
            ),
            "notes": {"fingerprints": "Morgan radius=2, 2048 bits, chirality enabled."},
        }
    else:
        result = evaluate_molecules(HuggingFaceMoleculeEncoder(args.model))
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
