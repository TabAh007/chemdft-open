from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Protocol


class ReconstructionStatus(StrEnum):
    CANDIDATE = "CANDIDATE"
    UNSUPPORTED = "UNSUPPORTED"
    LOW_CONFIDENCE = "LOW_CONFIDENCE"
    AMBIGUOUS = "AMBIGUOUS"
    PARSE_FAILED = "PARSE_FAILED"
    MANUAL_REVIEW_REQUIRED = "MANUAL_REVIEW_REQUIRED"
    MODEL_ERROR = "MODEL_ERROR"


@dataclass(frozen=True)
class ReconstructionCandidate:
    status: ReconstructionStatus
    representation_type: str | None
    smiles: str | None
    model_id: str
    model_version: str
    parse_state: str = "NOT_ATTEMPTED"
    confidence: float | None = None
    diagnostics: tuple[str, ...] = field(default_factory=tuple)
    runtime_ms: float = 0.0
    fragment_count: int | None = None
    formula: str | None = None
    formal_charge: int | None = None
    elements: tuple[str, ...] = field(default_factory=tuple)
    authority: str = "NON_AUTHORITATIVE_CANDIDATE_ONLY"


class StructureImageReconstructor(Protocol):
    def reconstruct(
        self, image_bytes: bytes, metadata: dict[str, object]
    ) -> ReconstructionCandidate: ...
