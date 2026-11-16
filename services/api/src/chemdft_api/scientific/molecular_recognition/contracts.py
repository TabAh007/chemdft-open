"""Contracts and schemas for molecular diagram recognition (Batch B2).

Enforces strict distinction between:
- DETECTED_FIGURE: Image region extracted from PDF, awaiting recognition.
- RECOGNITION_PROPOSAL: Raw proposal emitted by recognition engine.
- VALIDATED_GRAPH_SYNTAX: RDKit verified syntax and valency; unverified scientifically.
- RESEARCHER_ACCEPTED_STRUCTURE: Explicit human researcher acceptance only.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class RecognitionStatus(StrEnum):
    DETECTED_FIGURE = "DETECTED_FIGURE"
    RECOGNITION_PROPOSAL = "RECOGNITION_PROPOSAL"
    VALIDATED_GRAPH_SYNTAX = "VALIDATED_GRAPH_SYNTAX"
    MANUAL_REVIEW_REQUIRED = "MANUAL_REVIEW_REQUIRED"
    AMBIGUOUS = "AMBIGUOUS"
    UNSUPPORTED = "UNSUPPORTED"
    PARSE_FAILED = "PARSE_FAILED"
    UNRECOGNIZABLE = "UNRECOGNIZABLE"
    # Infrastructure failure (worker missing, crashed, timed out). NOT a scientific verdict.
    ENGINE_ERROR = "ENGINE_ERROR"
    RESEARCHER_ACCEPTED_STRUCTURE = "RESEARCHER_ACCEPTED_STRUCTURE"


@dataclass(frozen=True, slots=True)
class MolecularRecognitionProposal:
    """Immutable, fully traceable unverified molecular recognition proposal."""

    # Provenance
    source_document_id: str | None
    source_document_sha256: str | None
    source_page_number: int | None
    source_figure_number: str | None
    source_figure_anchor_id: str | None
    figure_sha256: str
    figure_region: tuple[float, float, float, float]  # (x, y, width, height) relative

    # Engine details
    recognition_engine: str
    engine_version: str
    raw_model_output: str | None

    # Proposed molecular representation
    proposed_smiles: str | None
    canonical_isomeric_smiles: str | None
    formula: str | None
    formal_charge: int | None
    heavy_atom_count: int | None
    elements: tuple[str, ...]
    has_stereochemistry: bool
    confidence: float | None  # None indicates uncalibrated model (e.g. DECIMER)

    # Scientific status & diagnostics
    status: RecognitionStatus
    is_scientifically_verified: bool  # ALWAYS False for machine proposals
    validation_warnings: tuple[str, ...]
    diagnostics: tuple[str, ...]
    unresolved_ambiguities: tuple[str, ...]
    runtime_ms: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_document_id": self.source_document_id,
            "source_document_sha256": self.source_document_sha256,
            "source_page_number": self.source_page_number,
            "source_figure_number": self.source_figure_number,
            "source_figure_anchor_id": self.source_figure_anchor_id,
            "figure_sha256": self.figure_sha256,
            "figure_region": list(self.figure_region),
            "recognition_engine": self.recognition_engine,
            "engine_version": self.engine_version,
            "raw_model_output": self.raw_model_output,
            "proposed_smiles": self.proposed_smiles,
            "canonical_isomeric_smiles": self.canonical_isomeric_smiles,
            "formula": self.formula,
            "formal_charge": self.formal_charge,
            "heavy_atom_count": self.heavy_atom_count,
            "elements": list(self.elements),
            "has_stereochemistry": self.has_stereochemistry,
            "confidence": self.confidence,
            "status": self.status.value,
            "is_scientifically_verified": False,
            "validation_warnings": list(self.validation_warnings),
            "diagnostics": list(self.diagnostics),
            "unresolved_ambiguities": list(self.unresolved_ambiguities),
            "runtime_ms": self.runtime_ms,
        }
