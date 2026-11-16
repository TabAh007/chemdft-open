from __future__ import annotations

import io
import os
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, UnidentifiedImageError
from rdkit import Chem, rdBase
from rdkit.Chem import rdMolDescriptors

from .contracts import ReconstructionCandidate, ReconstructionStatus

MODEL_URLS = {
    "DECIMER": "https://zenodo.org/record/8300489/files/models.zip",
    "DECIMER_HandDrawn": "https://zenodo.org/records/10781330/files/DECIMER_HandDrawn_model.zip",
}
MODEL_ID = "DECIMER-Image_Transformer"
MODEL_VERSION = "2.8.0"
UNSUPPORTED_CLASSES = frozenset(
    {
        "coordination_complex",
        "polymer_repeat",
        "reaction_scheme",
        "crystal_diagram",
        "plot_molecule",
        "multiple_molecules",
        "partially_occluded",
        "abbreviation",
    }
)


class DecimerReconstructor:
    """Experimental adapter; importing DECIMER is delayed until offline preflight."""

    def __init__(
        self,
        predictor: Callable[[Any], str] | None = None,
        model_version: str = MODEL_VERSION,
        model_id: str = "DECIMER-V2",
        model_cache: Path | None = None,
    ) -> None:
        self.predictor = predictor
        self.model_version = model_version
        self.model_id = model_id
        self.model_cache = model_cache

    def _resolve_predictor(self) -> Callable[[Any], str]:
        if self.predictor is not None:
            return self.predictor
        if self.model_cache is None:
            raise RuntimeError("Set an explicit prepared DECIMER model cache path")
        _validate_model_cache(self.model_cache)
        os.environ["PYSTOW_HOME"] = str(self.model_cache)
        from DECIMER import predict_SMILES

        return predict_SMILES

    def reconstruct(
        self, image_bytes: bytes, metadata: dict[str, object]
    ) -> ReconstructionCandidate:
        started = time.perf_counter()
        image_id = str(metadata.get("image_id", "unknown"))
        try:
            with Image.open(io.BytesIO(image_bytes)) as image:
                image.load()
                model_input = np.asarray(image.convert("RGB"))
        except (UnidentifiedImageError, OSError, ValueError):
            return ReconstructionCandidate(
                status=ReconstructionStatus.UNSUPPORTED,
                representation_type=None,
                smiles=None,
                model_id=self.model_id,
                model_version=self.model_version,
                diagnostics=(f"Image {image_id} is not a decodable raster image",),
                runtime_ms=(time.perf_counter() - started) * 1000,
            )

        metadata_class = str(metadata.get("category", ""))
        hand_drawn = metadata_class == "hand_drawn"
        try:
            predictor = self._resolve_predictor()
            if self.predictor is None:
                output = predictor(model_input, hand_drawn=hand_drawn)
            else:
                output = predictor(model_input)
        except Exception as exc:  # The harness records failures rather than hiding them.
            return ReconstructionCandidate(
                status=ReconstructionStatus.MODEL_ERROR,
                representation_type=None,
                smiles=None,
                model_id=self.model_id,
                model_version=self.model_version,
                parse_state="NOT_ATTEMPTED",
                diagnostics=(f"Model inference failed: {type(exc).__name__}: {exc}",),
                runtime_ms=(time.perf_counter() - started) * 1000,
            )

        smiles = str(output).strip() if output is not None else ""
        selected_model_id = "DECIMER-HandDrawn" if hand_drawn else self.model_id
        common = {
            "smiles": smiles or None,
            "model_id": selected_model_id,
            "model_version": self.model_version,
            "confidence": None,
            "runtime_ms": (time.perf_counter() - started) * 1000,
        }
        if not smiles:
            return ReconstructionCandidate(
                status=ReconstructionStatus.MANUAL_REVIEW_REQUIRED,
                representation_type=None,
                parse_state="ABSTAINED",
                **common,
                diagnostics=("DECIMER returned no SMILES; manual reconstruction required",),
            )

        with rdBase.BlockLogs():
            molecule = Chem.MolFromSmiles(smiles, sanitize=True)
        if molecule is None:
            return ReconstructionCandidate(
                status=ReconstructionStatus.PARSE_FAILED,
                representation_type="SMILES",
                parse_state="PARSE_FAILED",
                **common,
                diagnostics=("RDKit could not parse/sanitize DECIMER output; no repair attempted",),
            )

        fragments = Chem.GetMolFrags(molecule, asMols=False)
        elements = tuple(sorted({atom.GetSymbol() for atom in molecule.GetAtoms()}))
        unsupported = tuple(element for element in elements if element not in _COMMON_ELEMENTS)
        diagnostics = [
            "RDKit parse and sanitization passed; this is not scientific validation.",
            "DECIMER does not expose calibrated confidence; human review is required.",
        ]
        if len(fragments) > 1:
            diagnostics.append(
                "Multiple disconnected fragments detected; completeness is ambiguous"
            )
        if unsupported:
            diagnostics.append(f"Elements require specialist review: {', '.join(unsupported)}")
        status = (
            ReconstructionStatus.UNSUPPORTED
            if metadata_class in UNSUPPORTED_CLASSES
            else ReconstructionStatus.AMBIGUOUS
            if len(fragments) > 1
            else ReconstructionStatus.MANUAL_REVIEW_REQUIRED
        )
        diagnostics.append("RDKit parse_state=PARSED")
        if metadata_class in UNSUPPORTED_CLASSES:
            diagnostics.append(
                f"Input class {metadata_class} is unsupported for a single-molecule candidate; "
                "raw model output is evaluation-only"
            )
        return ReconstructionCandidate(
            status=status,
            parse_state="PARSED",
            **common,
            representation_type=None if metadata_class in UNSUPPORTED_CLASSES else "SMILES",
            diagnostics=tuple(diagnostics),
            fragment_count=len(fragments),
            formula=rdMolDescriptors.CalcMolFormula(molecule),
            formal_charge=sum(atom.GetFormalCharge() for atom in molecule.GetAtoms()),
            elements=elements,
        )


_COMMON_ELEMENTS = frozenset(["B", "C", "N", "O", "F", "P", "S", "Cl", "Br", "I", "H"])


def _validate_model_cache(cache: Path) -> None:
    expected = {
        "DECIMER_model": MODEL_URLS["DECIMER"],
        "DECIMER_HandDrawn_model": MODEL_URLS["DECIMER_HandDrawn"],
    }
    for directory, model_url in expected.items():
        root = cache / "DECIMER-V2" / directory
        if not (root / "saved_model.pb").is_file():
            raise RuntimeError(f"Offline model missing: {root / 'saved_model.pb'}")
        marker = root / ".model_url"
        if not marker.is_file() or marker.read_text().strip() != model_url:
            raise RuntimeError(f"Offline model URL marker missing/mismatched: {marker}")
