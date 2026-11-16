# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated
from uuid import UUID

from pydantic import Field, StringConstraints, model_validator

from .base import ContractModel, ContractVersion, EntityReference, NamespacedExtension, Sha256


class ScientificArtifactKind(StrEnum):
    RAW_UPLOAD = "RAW_UPLOAD"
    STRUCTURE_FILE = "STRUCTURE_FILE"
    COORDINATES = "COORDINATES"
    SPECTRUM_DATA = "SPECTRUM_DATA"
    CALCULATION_INPUT = "CALCULATION_INPUT"
    CALCULATION_OUTPUT = "CALCULATION_OUTPUT"
    ENGINE_LOG = "ENGINE_LOG"
    NORMALIZED_RESULT = "NORMALIZED_RESULT"
    ENVIRONMENT_MANIFEST = "ENVIRONMENT_MANIFEST"
    CHECKPOINT = "CHECKPOINT"
    VOLUMETRIC_GRID = "VOLUMETRIC_GRID"
    ORBITAL_GRID = "ORBITAL_GRID"
    MO_COEFFICIENTS = "MO_COEFFICIENTS"
    EXPORT = "EXPORT"
    FIGURE = "FIGURE"
    REPORT = "REPORT"


class ScientificArtifact(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    id: UUID
    project_id: UUID
    kind: ScientificArtifactKind
    media_type: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    format_identifier: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    format_version: Annotated[str, StringConstraints(max_length=64)] | None = None
    size_bytes: int = Field(ge=0)
    sha256: Sha256
    created_by: UUID
    created_at: datetime
    source_relation: EntityReference | None = None
    compression: Annotated[str, StringConstraints(max_length=32)] | None = None
    extensions: tuple[NamespacedExtension, ...] = Field(default=(), max_length=8)

    @model_validator(mode="after")
    def source_is_project_scoped(self) -> ScientificArtifact:
        if self.source_relation and self.source_relation.project_id != self.project_id:
            raise ValueError("Artifact source relation cannot cross project boundaries")
        return self


class ScientificArtifactRegistration(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    project_id: UUID
    stored_file_id: UUID
    kind: ScientificArtifactKind
    format_identifier: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    format_version: Annotated[str, StringConstraints(max_length=64)] | None = None
    source_relation: EntityReference | None = None
    compression: Annotated[str, StringConstraints(max_length=32)] | None = None
    extensions: tuple[NamespacedExtension, ...] = Field(default=(), max_length=8)

    @model_validator(mode="after")
    def source_is_project_scoped(self) -> ScientificArtifactRegistration:
        if self.source_relation and self.source_relation.project_id != self.project_id:
            raise ValueError("Artifact source relation cannot cross project boundaries")
        return self
