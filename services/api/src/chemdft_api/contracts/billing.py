# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, SecretStr, StringConstraints, field_validator

from .base import ContractModel, ContractVersion

MoneyCurrency = Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]
BillingStatus = Literal["NOT_CONFIGURED", "ACTIVE", "PAST_DUE", "GRACE", "SUSPENDED", "CANCELED"]
OveragePolicy = Literal["DENY", "ALLOW_METERED_OVERAGE"]


class Money(ContractModel):
    currency: MoneyCurrency
    minor_units: int = Field(ge=0)


class EntitlementSnapshot(ContractModel):
    managed_ai: bool
    byok_ai: bool
    compute: bool
    investigations: bool
    max_concurrent_ai: int = Field(ge=0)
    max_concurrent_compute: int = Field(ge=0)
    ai_overage_policy: OveragePolicy
    compute_overage_policy: OveragePolicy
    plan_key: str


class AllowancePeriodView(ContractModel):
    id: UUID
    period_start: datetime
    period_end: datetime
    ai_granted: Money
    ai_consumed: Money
    ai_reserved: Money
    ai_remaining: Money
    ai_overage_cap: Money
    compute_granted: Money
    compute_consumed: Money
    compute_reserved: Money
    compute_remaining: Money
    compute_overage_cap: Money
    ai_overage_policy: OveragePolicy
    compute_overage_policy: OveragePolicy


class AIUsageSummary(ContractModel):
    input_tokens: int | None = Field(ge=0)
    output_tokens: int | None = Field(ge=0)
    cached_tokens: int | None = Field(ge=0)
    usage_complete: bool = True
    reported_input_tokens: int = Field(default=0, ge=0)
    reported_output_tokens: int = Field(default=0, ge=0)
    reported_cached_tokens: int = Field(default=0, ge=0)
    reported_entries: int = Field(default=0, ge=0)
    unknown_entries: int = Field(default=0, ge=0)
    legacy_entries: int = Field(default=0, ge=0)
    pending_entries: int = Field(default=0, ge=0)
    provider_cost: Money | None = None
    known_provider_cost: Money
    provider_cost_complete: bool = True
    billable: Money
    managed_entries: int = Field(ge=0)
    byok_entries: int = Field(ge=0)


class ComputeUsageSummary(ContractModel):
    reserved: Money
    actual: Money
    billable: Money
    entries: int = Field(ge=0)


class BYOKStatusView(ContractModel):
    provider: str
    status: Literal["NOT_CONFIGURED", "CONFIGURED", "REVOKED"]
    fingerprint: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    validated: bool = False


class InvoiceView(ContractModel):
    id: UUID
    provider: str
    provider_invoice_id: str
    period_start: datetime
    period_end: datetime
    status: str
    total: Money
    amount_paid: Money
    hosted_invoice_url: str | None = None


class ReconciliationView(ContractModel):
    id: UUID
    period_start: datetime
    period_end: datetime
    ai_usage: Money
    compute_usage: Money
    invoice_total: Money
    discrepancy: Money
    status: Literal["MATCHED", "PENDING", "DISCREPANCY", "RESOLVED"]


class BillingSnapshot(ContractModel):
    schema_version: ContractVersion = "1.0.0"
    billing_account_id: UUID
    organization_id: UUID
    status: BillingStatus
    currency: MoneyCurrency
    subscription_plan: str | None = None
    subscription_status: str | None = None
    current_period_start: datetime | None = None
    current_period_end: datetime | None = None
    entitlements: EntitlementSnapshot
    allowance: AllowancePeriodView
    ai_usage: AIUsageSummary
    compute_usage: ComputeUsageSummary
    byok: tuple[BYOKStatusView, ...] = ()
    invoices: tuple[InvoiceView, ...] = ()
    reconciliation: ReconciliationView | None = None


class CreateCheckoutInput(ContractModel):
    plan_key: Annotated[str, StringConstraints(min_length=1, max_length=120)]


class CheckoutSessionView(ContractModel):
    provider: str
    session_reference: str
    checkout_url: str
    plan_key: str
    test_mode: bool


class BYOKCredentialInput(ContractModel):
    provider: Annotated[str, StringConstraints(min_length=2, max_length=64)]
    secret: SecretStr = Field(min_length=8, max_length=4096)

    @field_validator("secret")
    @classmethod
    def credential_ascii(cls, value: SecretStr) -> SecretStr:
        raw = value.get_secret_value()
        if not raw.isascii() or any(ord(c) < 33 or ord(c) > 126 for c in raw):
            raise ValueError("Provider credentials must use printable ASCII without whitespace.")
        return value


class BYOKRevocationInput(ContractModel):
    provider: Annotated[str, StringConstraints(min_length=2, max_length=64)]
