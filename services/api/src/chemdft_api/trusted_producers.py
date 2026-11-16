from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Final
from uuid import UUID


class ProducerType(StrEnum):
    SCIENTIFIC_WORKER = "SCIENTIFIC_WORKER"
    VALIDATED_IMPORT_PIPELINE = "VALIDATED_IMPORT_PIPELINE"
    VALIDATED_DETERMINISTIC_TRANSFORM = "VALIDATED_DETERMINISTIC_TRANSFORM"


_ISSUER_TOKEN: Final[object] = object()


@dataclass(frozen=True, slots=True, init=False)
class TrustedProducerContext:
    producer_id: str
    producer_type: ProducerType
    project_id: UUID
    attestation_id: str
    _issued: bool

    def __init__(
        self,
        producer_id: str,
        producer_type: ProducerType,
        project_id: UUID,
        attestation_id: str,
        *,
        _token: object,
    ) -> None:
        if _token is not _ISSUER_TOKEN:
            raise TypeError("Trusted producer contexts require verified internal issuance")
        if not producer_id or not attestation_id:
            raise ValueError("Producer and attestation identity are required")
        object.__setattr__(self, "producer_id", producer_id)
        object.__setattr__(self, "producer_type", producer_type)
        object.__setattr__(self, "project_id", project_id)
        object.__setattr__(self, "attestation_id", attestation_id)
        object.__setattr__(self, "_issued", True)


def issue_trusted_producer_context(
    *, producer_id: str, producer_type: ProducerType, project_id: UUID, attestation_id: str
) -> TrustedProducerContext:
    """Internal composition seam; production issuance must verify service identity."""
    return TrustedProducerContext(
        producer_id,
        producer_type,
        project_id,
        attestation_id,
        _token=_ISSUER_TOKEN,
    )


def is_issued_trusted_producer(value: object) -> bool:
    return (
        isinstance(value, TrustedProducerContext)
        and value._issued is True
        and isinstance(value.producer_type, ProducerType)
    )
