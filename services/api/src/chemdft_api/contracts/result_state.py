# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
"""Read-time scientific state; never part of an immutable result payload/hash."""

from typing import Literal
from uuid import UUID

from .base import ContractModel


class EffectiveResultState(ContractModel):
    stored_authority: str
    stored_validation_state: str
    stored_verification_state: str
    authority: str
    validation_state: str
    verification_state: str
    source_lineage_validity: Literal["ACTIVE", "RETRACTED", "SUPERSEDED", "DISPUTED", "INVALIDATED"]
    eligible_for_derivation: bool
    inactive_result_ids: tuple[UUID, ...] = ()
    reason: str | None = None
