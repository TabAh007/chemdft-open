from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from .ai_models import AIModelInvocationRecord
from .billing_models import (
    AIUsageLedgerEntryRecord,
    BillingAccountRecord,
    BillingAllowancePeriodRecord,
    BillingInvoiceRecord,
    BillingRateLimitWindowRecord,
    BillingReconciliationRecord,
    BillingSubscriptionRecord,
    BillingWebhookEventRecord,
    BYOKCredentialRecord,
    ComputeUsageLedgerEntryRecord,
)
from .billing_provider import (
    BillingEvent,
    BillingProvider,
    FakeBillingProvider,
    StripeBillingProvider,
)
from .config import Settings
from .context import Identity
from .contracts.billing import (
    AIUsageSummary,
    AllowancePeriodView,
    BillingSnapshot,
    BYOKCredentialInput,
    BYOKRevocationInput,
    BYOKStatusView,
    CheckoutSessionView,
    ComputeUsageSummary,
    CreateCheckoutInput,
    EntitlementSnapshot,
    InvoiceView,
    Money,
    ReconciliationView,
)
from .errors import (
    BillingEntitlementDenied,
    BillingPlanNotFound,
)
from .models import Organization, Project, utc_now


class BillingService:
    """Organization-scoped billing semantics independent of Stripe objects."""

    def __init__(
        self,
        session: Session,
        identity: Identity,
        settings: Settings,
        provider: BillingProvider | None = None,
    ) -> None:
        self._session = session
        self._identity = identity
        self._settings = settings
        self._provider = provider or self._provider_for_settings()

    def _provider_for_settings(self) -> BillingProvider:
        if self._settings.billing_provider == "stripe":
            return StripeBillingProvider(self._settings.billing_webhook_secret)
        return FakeBillingProvider()

    def _account(self, *, create: bool = True) -> BillingAccountRecord:
        organization = self._session.get(Organization, self._identity.organization_id)
        if organization is None:
            raise BillingEntitlementDenied("The current organization does not exist.")
        account = self._session.scalar(
            select(BillingAccountRecord).where(
                BillingAccountRecord.organization_id == self._identity.organization_id
            )
        )
        if account is None and not create:
            # Read-only view: same defaults the first write would store, nothing written.
            return BillingAccountRecord(
                id=_default_account_id(organization.id),
                organization_id=organization.id,
                billing_status="NOT_CONFIGURED",
                currency=self._settings.billing_default_currency.upper(),
            )
        if account is None:
            values = {
                "id": _default_account_id(organization.id),
                "organization_id": organization.id,
                "billing_status": "NOT_CONFIGURED",
                "currency": self._settings.billing_default_currency.upper(),
            }
            if self._session.bind is not None and self._session.bind.dialect.name == "sqlite":
                from sqlalchemy.dialects.sqlite import insert

                statement = insert(BillingAccountRecord).values(**values).prefix_with("OR IGNORE")
            else:
                from sqlalchemy.dialects.postgresql import insert

                statement = (
                    insert(BillingAccountRecord)
                    .values(**values)
                    .on_conflict_do_nothing(index_elements=["organization_id"])
                )
            self._session.execute(statement)
            account = self._session.scalar(
                select(BillingAccountRecord).where(
                    BillingAccountRecord.organization_id == self._identity.organization_id
                )
            )
            if account is None:
                raise BillingEntitlementDenied("Billing account could not be initialized.")
        return account

    def snapshot(self, *, read_only: bool = False) -> BillingSnapshot:
        """Billing view. ``read_only`` never writes (no account or allowance row, no commit)."""
        account = self._account(create=not read_only)
        subscription = self._session.scalar(
            select(BillingSubscriptionRecord)
            .where(BillingSubscriptionRecord.billing_account_id == account.id)
            .order_by(BillingSubscriptionRecord.current_period_end.desc())
        )
        period_start, period_end = self._period(subscription)
        plan_key = subscription.plan_key if subscription else "unconfigured"
        plan = self._plan(plan_key, required=False) or {}
        allowance = self._allowance(account, period_start, period_end, plan, read_only=read_only)
        ai_rows = self._session.scalars(
            select(AIUsageLedgerEntryRecord).where(
                AIUsageLedgerEntryRecord.billing_account_id == account.id,
                AIUsageLedgerEntryRecord.period_start == period_start,
                AIUsageLedgerEntryRecord.period_end == period_end,
            )
        ).all()
        compute_rows = self._session.scalars(
            select(ComputeUsageLedgerEntryRecord).where(
                ComputeUsageLedgerEntryRecord.billing_account_id == account.id,
                ComputeUsageLedgerEntryRecord.period_start == period_start,
                ComputeUsageLedgerEntryRecord.period_end == period_end,
            )
        ).all()
        entitlements = self._entitlements(plan_key, plan, subscription)
        invoices = self._session.scalars(
            select(BillingInvoiceRecord)
            .where(BillingInvoiceRecord.billing_account_id == account.id)
            .order_by(BillingInvoiceRecord.period_end.desc())
            .limit(20)
        ).all()
        reconciliation = self._session.scalar(
            select(BillingReconciliationRecord)
            .where(BillingReconciliationRecord.billing_account_id == account.id)
            .order_by(BillingReconciliationRecord.period_end.desc())
        )
        if not read_only:
            self._session.commit()
        return BillingSnapshot(
            billing_account_id=UUID(account.id),
            organization_id=UUID(account.organization_id),
            status=account.billing_status,
            currency=account.currency,
            subscription_plan=subscription.plan_key if subscription else None,
            subscription_status=subscription.status if subscription else None,
            current_period_start=subscription.current_period_start if subscription else None,
            current_period_end=subscription.current_period_end if subscription else None,
            entitlements=entitlements,
            allowance=self._allowance_view(allowance, account.currency),
            ai_usage=self._ai_summary(ai_rows, account.currency, pending=self._session.scalar(
                select(func.count(AIModelInvocationRecord.id))
                .join(Project, Project.id == AIModelInvocationRecord.project_id)
                .where(Project.organization_id == account.organization_id,
                       AIModelInvocationRecord.status == "RESERVED",
                       AIModelInvocationRecord.usage_status == "UNKNOWN",
                       AIModelInvocationRecord.created_at >= period_start,
                       AIModelInvocationRecord.created_at < period_end)
            ) or 0),
            compute_usage=self._compute_summary(compute_rows, account.currency),
            byok=tuple(self._byok_views(account.id)),
            invoices=tuple(self._invoice_view(row) for row in invoices),
            reconciliation=self._reconciliation_view(reconciliation) if reconciliation else None,
        )

    def create_checkout(self, payload: CreateCheckoutInput) -> CheckoutSessionView:
        self._plan(payload.plan_key)
        account = self._account()
        if account.stripe_customer_id is None:
            account.stripe_customer_id = f"{self._provider.name}_customer_{account.id}"
            self._session.commit()
        result = self._provider.create_checkout_session(
            customer_reference=account.stripe_customer_id, plan_key=payload.plan_key
        )
        return CheckoutSessionView(
            provider=self._provider.name,
            session_reference=result["session_reference"],
            checkout_url=result["checkout_url"],
            plan_key=payload.plan_key,
            test_mode=self._provider.test_mode,
        )

    def process_webhook(self, payload: bytes, signature: str | None) -> str:
        event = self._provider.verify_webhook(payload, signature)
        digest = hashlib.sha256(payload).hexdigest()
        existing = self._session.scalar(
            select(BillingWebhookEventRecord).where(
                BillingWebhookEventRecord.provider == self._provider.name,
                BillingWebhookEventRecord.event_id == event.event_id,
            )
        )
        if existing is not None:
            return existing.status
        row = BillingWebhookEventRecord(
            id=_new_id(),
            provider=self._provider.name,
            event_id=event.event_id,
            event_type=event.event_type,
            event_created_at=_from_timestamp(event.created_at),
            payload_sha256=digest,
            status="RECEIVED",
        )
        self._session.add(row)
        self._session.flush()
        try:
            self._apply_event(event)
            row.status = "PROCESSED"
            row.processed_at = utc_now()
        except Exception as error:
            row.status = "FAILED"
            row.diagnostic = str(error)[:1000]
            self._session.commit()
            raise
        self._session.commit()
        return row.status

    def reconcile(self) -> ReconciliationView:
        account = self._account()
        subscription = self._session.scalar(
            select(BillingSubscriptionRecord)
            .where(BillingSubscriptionRecord.billing_account_id == account.id)
            .order_by(BillingSubscriptionRecord.current_period_end.desc())
        )
        start, end = self._period(subscription)
        ai_total = self._sum_ledger(
            AIUsageLedgerEntryRecord, account.id, start, end, "billable_minor_units"
        )
        compute_total = self._sum_ledger(
            ComputeUsageLedgerEntryRecord, account.id, start, end, "billable_minor_units"
        )
        invoice_total = int(
            self._session.scalar(
                select(func.coalesce(func.sum(BillingInvoiceRecord.total_minor_units), 0)).where(
                    BillingInvoiceRecord.billing_account_id == account.id,
                    BillingInvoiceRecord.period_start == start,
                    BillingInvoiceRecord.period_end == end,
                )
            )
            or 0
        )
        discrepancy = invoice_total - ai_total - compute_total
        row = self._session.scalar(
            select(BillingReconciliationRecord).where(
                BillingReconciliationRecord.billing_account_id == account.id,
                BillingReconciliationRecord.period_start == start,
                BillingReconciliationRecord.period_end == end,
            )
        )
        if row is None:
            row = BillingReconciliationRecord(
                id=_new_id(), billing_account_id=account.id, period_start=start, period_end=end
            )
            self._session.add(row)
        row.ai_usage_minor_units = ai_total
        row.compute_usage_minor_units = compute_total
        row.invoice_total_minor_units = invoice_total
        row.discrepancy_minor_units = discrepancy
        row.status = "MATCHED" if discrepancy == 0 else "DISCREPANCY"
        self._session.commit()
        return self._reconciliation_view(row)

    def configure_byok(self, payload: BYOKCredentialInput) -> BYOKStatusView:
        from .ai.providers import AIProviderService

        return AIProviderService(self._session, self._identity, self._settings).save_key(payload)

    def revoke_byok(self, payload: BYOKRevocationInput) -> None:
        from .ai.providers import AIProviderService

        AIProviderService(self._session, self._identity, self._settings).revoke_key(payload)

    def authorize_managed_ai(self, *, estimated_minor_units: int = 0) -> None:
        snapshot = self.snapshot()
        if not snapshot.entitlements.managed_ai:
            raise BillingEntitlementDenied("Managed AI is not enabled for this billing account.")
        self._authorize_allowance(
            granted=snapshot.allowance.ai_granted.minor_units,
            consumed=snapshot.allowance.ai_consumed.minor_units,
            reserved=snapshot.allowance.ai_reserved.minor_units,
            remaining=snapshot.allowance.ai_remaining.minor_units,
            estimated=estimated_minor_units,
            policy=snapshot.entitlements.ai_overage_policy,
            overage_cap=snapshot.allowance.ai_overage_cap.minor_units,
        )
        self._enforce_rate_limit("managed_ai", self._settings.billing_max_ai_calls_per_minute)

    def authorize_compute(self, *, estimated_minor_units: int = 0) -> None:
        snapshot = self.snapshot()
        if not snapshot.entitlements.compute:
            raise BillingEntitlementDenied("Compute is not enabled for this billing account.")
        self._authorize_allowance(
            granted=snapshot.allowance.compute_granted.minor_units,
            consumed=snapshot.allowance.compute_consumed.minor_units,
            reserved=snapshot.allowance.compute_reserved.minor_units,
            remaining=snapshot.allowance.compute_remaining.minor_units,
            estimated=estimated_minor_units,
            policy=snapshot.entitlements.compute_overage_policy,
            overage_cap=snapshot.allowance.compute_overage_cap.minor_units,
        )
        self._enforce_rate_limit(
            "compute", self._settings.billing_max_compute_submissions_per_minute
        )

    def ai_usage_period(self) -> tuple[datetime, datetime]:
        """Capture the accounting period before dispatch, without committing."""
        account = self._account()
        subscription = self._session.scalar(
            select(BillingSubscriptionRecord)
            .where(BillingSubscriptionRecord.billing_account_id == account.id)
            .order_by(BillingSubscriptionRecord.current_period_end.desc())
        )
        return self._period(subscription)

    def record_ai_usage(
        self,
        *,
        project_id: str,
        model_invocation_id: str,
        provider: str,
        model: str,
        mode: str,
        input_tokens: int | None,
        output_tokens: int | None,
        cached_tokens: int | None = 0,
        provider_cost_minor_units: int | None = None,
        billable_minor_units: int = 0,
        idempotency_key: str | None = None,
        usage_status: str | None = None,
        commit: bool = True,
        entry_kind: str = "USAGE",
        adjustment_of_id: str | None = None,
        usage_period: tuple[datetime, datetime] | None = None,
    ) -> AIUsageLedgerEntryRecord:
        usage_status = usage_status or (
            "REPORTED" if input_tokens is not None and output_tokens is not None else "UNKNOWN"
        )
        if usage_status not in {"REPORTED", "UNKNOWN", "LEGACY_UNSPECIFIED"}:
            raise ValueError("Invalid usage status")
        if usage_status == "REPORTED" and (input_tokens is None or output_tokens is None):
            raise ValueError("Reported usage requires both core counters")
        for value in (input_tokens, output_tokens, cached_tokens, provider_cost_minor_units):
            if value is not None and (type(value) is not int or value < 0):
                raise ValueError("Usage and provider cost must be nonnegative integers or unknown")
        if cached_tokens is not None and input_tokens is not None and cached_tokens > input_tokens:
            raise ValueError("Cached tokens cannot exceed input tokens")
        if type(billable_minor_units) is not int or billable_minor_units < 0:
            raise ValueError("Platform charge must be a confirmed nonnegative integer")
        account = self._account()
        subscription = self._session.scalar(
            select(BillingSubscriptionRecord)
            .where(BillingSubscriptionRecord.billing_account_id == account.id)
            .order_by(BillingSubscriptionRecord.current_period_end.desc())
        )
        start, end = usage_period or self._period(subscription)
        if end <= start:
            raise ValueError("Usage accounting period must have positive duration")
        key = idempotency_key or f"ai-invocation:{model_invocation_id}"
        values = dict(
            id=_new_id(),
            billing_account_id=account.id,
            project_id=project_id,
            model_invocation_id=model_invocation_id,
            provider=provider,
            model=model,
            mode=mode,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cached_tokens=cached_tokens,
            usage_status=usage_status,
            provider_cost_minor_units=provider_cost_minor_units,
            billable_minor_units=billable_minor_units,
            currency=account.currency,
            period_start=start,
            period_end=end,
            idempotency_key=key,
            entry_kind=entry_kind,
            adjustment_of_id=adjustment_of_id,
            status="POSTED",
            created_at=utc_now(),
        )
        if self._session.bind.dialect.name == "sqlite":
            from sqlalchemy.dialects.sqlite import insert
        else:
            from sqlalchemy.dialects.postgresql import insert
        inserted = self._session.scalar(
            insert(AIUsageLedgerEntryRecord)
            .values(**values)
            .on_conflict_do_nothing(index_elements=["billing_account_id", "idempotency_key"])
            .returning(AIUsageLedgerEntryRecord.id)
        )
        # Only the insertion winner increments confirmed platform spend.
        # No token-price conversion or provider-cost estimate is performed.
        if inserted is not None:
            allowance = self._allowance(
                account,
                start,
                end,
                self._plan(subscription.plan_key, required=False) if subscription else {},
            )
            self._session.execute(
                update(BillingAllowancePeriodRecord)
                .where(BillingAllowancePeriodRecord.id == allowance.id)
                .values(
                    ai_consumed_minor_units=(
                        BillingAllowancePeriodRecord.ai_consumed_minor_units + billable_minor_units
                    )
                )
                .execution_options(synchronize_session=False)
            )
            self._session.expire(allowance)
        row = self._session.scalar(
            select(AIUsageLedgerEntryRecord).where(
                AIUsageLedgerEntryRecord.billing_account_id == account.id,
                AIUsageLedgerEntryRecord.idempotency_key == key,
            )
        )
        if commit:
            self._session.commit()
        return row

    def record_compute_usage(
        self,
        *,
        project_id: str,
        compute_job_id: str | None,
        compute_execution_id: str | None,
        provider: str,
        engine: str | None,
        reserved_minor_units: int,
        actual_minor_units: int,
        billable_minor_units: int,
        idempotency_key: str | None = None,
    ) -> ComputeUsageLedgerEntryRecord:
        account = self._account()
        subscription = self._session.scalar(
            select(BillingSubscriptionRecord)
            .where(BillingSubscriptionRecord.billing_account_id == account.id)
            .order_by(BillingSubscriptionRecord.current_period_end.desc())
        )
        start, end = self._period(subscription)
        key = idempotency_key or f"compute-execution:{compute_execution_id or compute_job_id}"
        existing = self._session.scalar(
            select(ComputeUsageLedgerEntryRecord).where(
                ComputeUsageLedgerEntryRecord.billing_account_id == account.id,
                ComputeUsageLedgerEntryRecord.idempotency_key == key,
            )
        )
        if existing is not None:
            return existing
        row = ComputeUsageLedgerEntryRecord(
            id=_new_id(),
            billing_account_id=account.id,
            project_id=project_id,
            compute_job_id=compute_job_id,
            compute_execution_id=compute_execution_id,
            provider=provider,
            engine=engine,
            reserved_minor_units=reserved_minor_units,
            actual_minor_units=actual_minor_units,
            billable_minor_units=billable_minor_units,
            currency=account.currency,
            period_start=start,
            period_end=end,
            idempotency_key=key,
        )
        self._session.add(row)
        allowance = self._allowance(
            account,
            start,
            end,
            self._plan(subscription.plan_key, required=False) if subscription else {},
        )
        allowance.compute_consumed_minor_units += billable_minor_units
        self._session.commit()
        return row

    def _apply_event(self, event: BillingEvent) -> None:
        data = event.data
        customer = str(data.get("customer") or data.get("customer_id") or "")
        account = self._session.scalar(
            select(BillingAccountRecord).where(BillingAccountRecord.stripe_customer_id == customer)
        )
        if account is None:
            return
        if event.event_type.startswith("customer.subscription."):
            period = data.get("current_period", {})
            account.billing_status = _billing_status(str(data.get("status", "active")))
            existing = self._session.scalar(
                select(BillingSubscriptionRecord).where(
                    BillingSubscriptionRecord.provider == self._provider.name,
                    BillingSubscriptionRecord.provider_subscription_id == str(data.get("id")),
                )
            )
            if existing is None:
                existing = BillingSubscriptionRecord(
                    id=_new_id(),
                    billing_account_id=account.id,
                    provider=self._provider.name,
                    provider_subscription_id=str(data.get("id")),
                    plan_key=str(
                        data.get("plan_key")
                        or data.get("metadata", {}).get("plan_key")
                        or "unconfigured"
                    ),
                    status=str(data.get("status", "active")),
                    current_period_start=_from_timestamp(int(period.get("start", 0))) or utc_now(),
                    current_period_end=_from_timestamp(int(period.get("end", 0)))
                    or (utc_now() + timedelta(days=30)),
                )
                self._session.add(existing)
            else:
                existing.status = str(data.get("status", existing.status))
                existing.provider_event_created_at = _from_timestamp(event.created_at)
                existing.last_synced_at = utc_now()
        elif event.event_type.startswith("invoice."):
            invoice_id = str(data.get("id", ""))
            invoice = self._session.scalar(
                select(BillingInvoiceRecord).where(
                    BillingInvoiceRecord.provider == self._provider.name,
                    BillingInvoiceRecord.provider_invoice_id == invoice_id,
                )
            )
            if invoice is None:
                invoice = BillingInvoiceRecord(
                    id=_new_id(),
                    billing_account_id=account.id,
                    provider=self._provider.name,
                    provider_invoice_id=invoice_id,
                    period_start=_from_timestamp(int(data.get("period_start", 0))) or utc_now(),
                    period_end=_from_timestamp(int(data.get("period_end", 0)))
                    or (utc_now() + timedelta(days=30)),
                    status=str(data.get("status", "open")),
                    currency=str(data.get("currency", account.currency)).upper(),
                    subtotal_minor_units=int(data.get("subtotal", 0) or 0),
                    tax_minor_units=int(data.get("tax", 0) or 0),
                    total_minor_units=int(data.get("total", 0) or 0),
                    amount_paid_minor_units=int(data.get("amount_paid", 0) or 0),
                    hosted_invoice_url=data.get("hosted_invoice_url"),
                    provider_created_at=_from_timestamp(event.created_at),
                )
                self._session.add(invoice)

    def _plan(self, plan_key: str, *, required: bool = True) -> dict[str, Any] | None:
        try:
            definitions = json.loads(self._settings.billing_plan_definitions_json or "{}")
        except json.JSONDecodeError as error:
            raise BillingPlanNotFound("Billing plan configuration is invalid JSON.") from error
        plan = definitions.get(plan_key)
        if required and not isinstance(plan, dict):
            raise BillingPlanNotFound(f"Billing plan '{plan_key}' is not configured.")
        return plan if isinstance(plan, dict) else None

    def _entitlements(
        self, plan_key: str, plan: Mapping[str, Any], subscription: BillingSubscriptionRecord | None
    ) -> EntitlementSnapshot:
        active = subscription is not None and subscription.status in {"active", "trialing", "grace"}
        return EntitlementSnapshot(
            managed_ai=bool(
                active
                and plan.get("managed_ai", False)
                and self._settings.billing_managed_ai_enabled
                and not self._settings.billing_managed_ai_kill_switch
            ),
            byok_ai=bool(active and plan.get("byok_ai", False)),
            compute=bool(
                active
                and plan.get("compute", False)
                and self._settings.billing_compute_enabled
                and not self._settings.billing_compute_kill_switch
            ),
            investigations=bool(active and plan.get("investigations", False)),
            max_concurrent_ai=int(plan.get("max_concurrent_ai", 0)),
            max_concurrent_compute=int(plan.get("max_concurrent_compute", 0)),
            ai_overage_policy=str(plan.get("ai_overage_policy", "DENY")),
            compute_overage_policy=str(plan.get("compute_overage_policy", "DENY")),
            plan_key=plan_key,
        )

    def _allowance(
        self,
        account: BillingAccountRecord,
        start: datetime,
        end: datetime,
        plan: Mapping[str, Any],
        *,
        read_only: bool = False,
    ) -> BillingAllowancePeriodRecord:
        row = self._session.scalar(
            select(BillingAllowancePeriodRecord).where(
                BillingAllowancePeriodRecord.billing_account_id == account.id,
                BillingAllowancePeriodRecord.period_start == start,
                BillingAllowancePeriodRecord.period_end == end,
            )
        )
        if row is None and read_only:
            return BillingAllowancePeriodRecord(
                id=_default_allowance_id(account.id, start),
                billing_account_id=account.id,
                # Stored columns are naive UTC; match what a stored row would return.
                period_start=start.replace(tzinfo=None),
                period_end=end.replace(tzinfo=None),
                ai_granted_minor_units=int(plan.get("ai_granted_minor_units", 0)),
                compute_granted_minor_units=int(plan.get("compute_granted_minor_units", 0)),
                ai_consumed_minor_units=0,
                ai_reserved_minor_units=0,
                compute_consumed_minor_units=0,
                compute_reserved_minor_units=0,
                ai_overage_policy=str(plan.get("ai_overage_policy", "DENY")),
                compute_overage_policy=str(plan.get("compute_overage_policy", "DENY")),
                ai_overage_cap_minor_units=int(plan.get("ai_overage_cap_minor_units", 0)),
                compute_overage_cap_minor_units=int(plan.get("compute_overage_cap_minor_units", 0)),
            )
        if row is None:
            values = dict(
                id=_default_allowance_id(account.id, start),
                billing_account_id=account.id,
                period_start=start,
                period_end=end,
                ai_granted_minor_units=int(plan.get("ai_granted_minor_units", 0)),
                compute_granted_minor_units=int(plan.get("compute_granted_minor_units", 0)),
                ai_overage_policy=str(plan.get("ai_overage_policy", "DENY")),
                compute_overage_policy=str(plan.get("compute_overage_policy", "DENY")),
                ai_overage_cap_minor_units=int(plan.get("ai_overage_cap_minor_units", 0)),
                compute_overage_cap_minor_units=int(plan.get("compute_overage_cap_minor_units", 0)),
            )
            if self._session.bind.dialect.name == "sqlite":
                from sqlalchemy.dialects.sqlite import insert
            else:
                from sqlalchemy.dialects.postgresql import insert
            self._session.execute(
                insert(BillingAllowancePeriodRecord)
                .values(**values)
                .on_conflict_do_nothing(
                    index_elements=["billing_account_id", "period_start", "period_end"]
                )
            )
            row = self._session.scalar(
                select(BillingAllowancePeriodRecord).where(
                    BillingAllowancePeriodRecord.billing_account_id == account.id,
                    BillingAllowancePeriodRecord.period_start == start,
                    BillingAllowancePeriodRecord.period_end == end,
                )
            )
        return row

    def _period(self, subscription: BillingSubscriptionRecord | None) -> tuple[datetime, datetime]:
        if subscription is not None:
            return subscription.current_period_start, subscription.current_period_end
        start = utc_now().replace(hour=0, minute=0, second=0, microsecond=0)
        return start, start + timedelta(days=self._settings.billing_allowance_period_days)

    def _allowance_view(
        self, row: BillingAllowancePeriodRecord, currency: str
    ) -> AllowancePeriodView:
        return AllowancePeriodView(
            id=UUID(row.id),
            period_start=row.period_start,
            period_end=row.period_end,
            ai_granted=Money(currency=currency, minor_units=row.ai_granted_minor_units),
            ai_consumed=Money(currency=currency, minor_units=row.ai_consumed_minor_units),
            ai_reserved=Money(currency=currency, minor_units=row.ai_reserved_minor_units),
            ai_remaining=Money(
                currency=currency,
                minor_units=max(
                    0,
                    row.ai_granted_minor_units
                    - row.ai_consumed_minor_units
                    - row.ai_reserved_minor_units,
                ),
            ),
            ai_overage_cap=Money(currency=currency, minor_units=row.ai_overage_cap_minor_units),
            compute_granted=Money(currency=currency, minor_units=row.compute_granted_minor_units),
            compute_consumed=Money(currency=currency, minor_units=row.compute_consumed_minor_units),
            compute_reserved=Money(currency=currency, minor_units=row.compute_reserved_minor_units),
            compute_remaining=Money(
                currency=currency,
                minor_units=max(
                    0,
                    row.compute_granted_minor_units
                    - row.compute_consumed_minor_units
                    - row.compute_reserved_minor_units,
                ),
            ),
            compute_overage_cap=Money(
                currency=currency, minor_units=row.compute_overage_cap_minor_units
            ),
            ai_overage_policy=row.ai_overage_policy,
            compute_overage_policy=row.compute_overage_policy,
        )

    def _ai_summary(
        self, rows: list[AIUsageLedgerEntryRecord], currency: str, *, pending: int = 0
    ) -> AIUsageSummary:
        # A later reported adjustment supersedes an unknown observation, never
        # its confirmed platform charge. Charges still sum every append-only row.
        superseded = {r.adjustment_of_id for r in rows if r.entry_kind == "USAGE_REPORT"}
        observations = [r for r in rows if r.id not in superseded]
        totals = {}
        for name in ("input_tokens", "output_tokens", "cached_tokens"):
            known = sum(
                getattr(r, name)
                for r in observations
                if r.usage_status != "LEGACY_UNSPECIFIED" and getattr(r, name) is not None
            )
            complete = not pending and all(
                r.usage_status != "LEGACY_UNSPECIFIED" and getattr(r, name) is not None
                for r in observations
            )
            totals[name] = known if complete else None
            totals[f"reported_{name}"] = known
        cost_complete = not pending and all(
            r.usage_status != "LEGACY_UNSPECIFIED" and r.provider_cost_minor_units is not None
            for r in observations
        )
        known_cost = Money(
            currency=currency,
            minor_units=sum(
                r.provider_cost_minor_units
                for r in observations
                if r.usage_status != "LEGACY_UNSPECIFIED"
                and r.provider_cost_minor_units is not None
            ),
        )
        return AIUsageSummary(
            **totals,
            usage_complete=all(
                totals[n] is not None for n in ("input_tokens", "output_tokens", "cached_tokens")
            ),
            reported_entries=sum(r.usage_status == "REPORTED" for r in observations),
            unknown_entries=sum(r.usage_status == "UNKNOWN" for r in observations),
            legacy_entries=sum(r.usage_status == "LEGACY_UNSPECIFIED" for r in observations),
            pending_entries=pending,
            provider_cost=known_cost if cost_complete else None,
            known_provider_cost=known_cost,
            provider_cost_complete=cost_complete,
            billable=Money(
                currency=currency, minor_units=sum(r.billable_minor_units for r in rows)
            ),
            managed_entries=sum(r.mode == "MANAGED" and r.entry_kind == "USAGE" for r in rows),
            byok_entries=sum(r.mode == "BYOK" and r.entry_kind == "USAGE" for r in rows),
        )

    def _compute_summary(
        self, rows: list[ComputeUsageLedgerEntryRecord], currency: str
    ) -> ComputeUsageSummary:
        return ComputeUsageSummary(
            reserved=Money(
                currency=currency, minor_units=sum(row.reserved_minor_units for row in rows)
            ),
            actual=Money(
                currency=currency, minor_units=sum(row.actual_minor_units for row in rows)
            ),
            billable=Money(
                currency=currency, minor_units=sum(row.billable_minor_units for row in rows)
            ),
            entries=len(rows),
        )

    def _byok_views(self, account_id: str) -> list[BYOKStatusView]:
        rows = self._session.scalars(
            select(BYOKCredentialRecord).where(
                BYOKCredentialRecord.billing_account_id == account_id,
                BYOKCredentialRecord.user_id == self._identity.user_id,
            )
        ).all()
        return [
            BYOKStatusView(
                provider=row.provider,
                status=row.status,
                fingerprint=row.fingerprint[:12],
                updated_at=row.updated_at,
                validated=row.validated_at is not None,
                created_at=row.created_at,
            )
            for row in rows
        ]

    def _invoice_view(self, row: BillingInvoiceRecord) -> InvoiceView:
        return InvoiceView(
            id=UUID(row.id),
            provider=row.provider,
            provider_invoice_id=row.provider_invoice_id,
            period_start=row.period_start,
            period_end=row.period_end,
            status=row.status,
            total=Money(currency=row.currency, minor_units=row.total_minor_units),
            amount_paid=Money(currency=row.currency, minor_units=row.amount_paid_minor_units),
            hosted_invoice_url=row.hosted_invoice_url,
        )

    def _reconciliation_view(self, row: BillingReconciliationRecord) -> ReconciliationView:
        currency = self._account().currency
        return ReconciliationView(
            id=UUID(row.id),
            period_start=row.period_start,
            period_end=row.period_end,
            ai_usage=Money(currency=currency, minor_units=row.ai_usage_minor_units),
            compute_usage=Money(currency=currency, minor_units=row.compute_usage_minor_units),
            invoice_total=Money(currency=currency, minor_units=row.invoice_total_minor_units),
            discrepancy=Money(currency=currency, minor_units=abs(row.discrepancy_minor_units)),
            status=row.status,
        )

    def _sum_ledger(
        self, model: type[Any], account_id: str, start: datetime, end: datetime, column: str
    ) -> int:
        field = getattr(model, column)
        return int(
            self._session.scalar(
                select(func.coalesce(func.sum(field), 0)).where(
                    model.billing_account_id == account_id,
                    model.period_start == start,
                    model.period_end == end,
                )
            )
            or 0
        )

    @staticmethod
    def _authorize_allowance(
        *,
        granted: int,
        consumed: int,
        reserved: int,
        remaining: int,
        estimated: int,
        policy: str,
        overage_cap: int,
    ) -> None:
        if estimated <= remaining:
            return
        if policy != "ALLOW_METERED_OVERAGE":
            raise BillingEntitlementDenied(
                "The allowance or configured overage policy does not permit this usage."
            )
        overage = consumed + reserved + estimated - granted
        if overage > overage_cap:
            raise BillingEntitlementDenied("The configured overage cap does not permit this usage.")

    def _enforce_rate_limit(self, limit_key: str, limit: int) -> None:
        account = self._account()
        window_start = utc_now().replace(second=0, microsecond=0)
        row = self._session.scalar(
            select(BillingRateLimitWindowRecord).where(
                BillingRateLimitWindowRecord.billing_account_id == account.id,
                BillingRateLimitWindowRecord.limit_key == limit_key,
                BillingRateLimitWindowRecord.window_start == window_start,
            )
        )
        if row is None:
            row = BillingRateLimitWindowRecord(
                id=_new_id(),
                billing_account_id=account.id,
                limit_key=limit_key,
                window_start=window_start,
                count=0,
            )
            self._session.add(row)
            self._session.flush()
        if row.count >= limit:
            self._session.rollback()
            raise BillingEntitlementDenied("The account rate limit has been reached.")
        row.count += 1
        self._session.commit()


def _default_account_id(organization_id: str) -> str:
    """Stable id: the read-only view and the row a write path later creates share it."""
    return str(uuid5(NAMESPACE_URL, f"chemdft-billing-default:{organization_id}"))


def _default_allowance_id(account_id: str, start: datetime) -> str:
    return str(uuid5(NAMESPACE_URL, f"chemdft-allowance-default:{account_id}:{start:%Y%m%d}"))


def _new_id() -> str:
    from .models import new_id

    return new_id()


def _from_timestamp(value: int | None) -> datetime | None:
    return datetime.fromtimestamp(value, tz=UTC) if value else None


def _billing_status(status: str) -> str:
    return {
        "active": "ACTIVE",
        "trialing": "ACTIVE",
        "past_due": "PAST_DUE",
        "canceled": "CANCELED",
        "unpaid": "SUSPENDED",
    }.get(status, "NOT_CONFIGURED")
