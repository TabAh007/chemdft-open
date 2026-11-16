# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
"""Public model evidence, separate from credentials and current-user availability."""

from typing import Literal

from pydantic import Field

from .base import ContractModel


class AIModelCapability(ContractModel):
    provider: str
    model_identifier: str
    display_name: str
    status: Literal["DOCUMENTED", "CONFIGURED", "LIVE-VERIFIED", "UNAVAILABLE", "UNSUPPORTED"]
    endpoint: str
    endpoint_availability: Literal["AVAILABLE", "DEPRECATED", "UNKNOWN"]
    documented_capabilities: tuple[str, ...] = Field(max_length=12)
    published_context: str
    configuration_requirements: tuple[str, ...] = Field(max_length=12)
    configured: bool
    selectable: bool
    tool_compatibility_verified: bool
    proposal_workflow_verified: bool = False
    # Server-authored. STANDARD: normal selection (registry tool verification). DEVELOPMENT: the
    # operator enabled this exact model for development/test use because the registry holds hosted
    # evidence for the profiles below; it is not a COMPATIBLE label and never a default or a
    # fallback. NONE: not selectable. Never taken from the client.
    eligibility: Literal["STANDARD", "DEVELOPMENT", "NONE"] = "NONE"
    # The dated hosted evidence a DEVELOPMENT eligibility rests on (empty otherwise).
    development_evidence: tuple[str, ...] = Field(default=(), max_length=4)
    # Server-authored: planning profiles this exact registry row may serve. Empty when the
    # model is not selectable. Derived from registry evidence only, never from the client.
    planning_profiles: tuple[str, ...] = Field(default=(), max_length=8)
    unselectable_reason: str | None = None
    verification_scope: str
    limitations: tuple[str, ...] = Field(max_length=12)
    source_urls: tuple[str, ...] = Field(max_length=6)
    reviewed_on: str
