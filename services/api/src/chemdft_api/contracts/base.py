# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

ContractVersion = Literal["1.0.0"]
Sha256 = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
NamespacedIdentifier = Annotated[
    str,
    StringConstraints(pattern=r"^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$", min_length=3, max_length=160),
]
JsonScalar = str | int | float | bool | None


class ContractModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
        use_enum_values=False,
    )


class EntityReference(ContractModel):
    project_id: UUID
    entity_type: NamespacedIdentifier
    entity_id: UUID


class ArtifactReference(ContractModel):
    project_id: UUID
    artifact_id: UUID
    sha256: Sha256


class ExtensionValue(ContractModel):
    key: Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_.-]{0,63}$")]
    value: JsonScalar


class NamespacedExtension(ContractModel):
    namespace: NamespacedIdentifier
    schema_version: Annotated[str, StringConstraints(min_length=1, max_length=32)]
    values: tuple[ExtensionValue, ...] = Field(default=(), max_length=64)
