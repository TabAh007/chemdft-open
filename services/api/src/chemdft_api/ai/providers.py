"""Explicit human-scoped provider resolution; one source, one model, no fallback."""

from __future__ import annotations

import hashlib

from pydantic import SecretStr
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..ai_models import AIPreferenceRecord
from ..auth import dev_identity_permitted
from ..billing_models import BYOKCredentialRecord
from ..config import Settings
from ..context import Identity, ServiceIdentity
from ..contracts.ai_foundation import (
    AIAvailability,
    AIPreferencesInput,
    AIProviderOption,
    AISettingsView,
)
from ..contracts.billing import BYOKCredentialInput, BYOKRevocationInput, BYOKStatusView
from ..errors import ApplicationError, BillingSecretUnavailable, ProjectAccessDenied
from ..models import utc_now
from .gateway import MOONSHOT_BASE, HttpOpenAIModelGateway, ModelGateway, build_model_gateway
from .model_catalog import (
    loopback_host,
    model_catalogue,
    moonshot_models,
    moonshot_route_configured,
    profile_ineligibility,
    selectable_models,
    selectable_nvidia_models,
)
from .secrets import SecretProvider, build_secret_provider


class AIFoundationError(ApplicationError):
    # False only when the request provably never reached the provider (see
    # gateway.ModelRequestNotSentError); callers then release, rather than charge, any
    # reservation. The default is the conservative "outcome uncertain".
    request_sent: bool = True

    def __init__(self, code: str, detail: str, status_code: int = 409) -> None:
        self.code = code
        self.status_code = status_code
        super().__init__(detail)


class AIProviderService:
    def __init__(
        self,
        session: Session,
        identity: Identity,
        settings: Settings,
        secret_provider: SecretProvider | None = None,
    ) -> None:
        if isinstance(identity, ServiceIdentity):
            raise ProjectAccessDenied("AI preferences and credentials require a human identity.")
        self.session, self.identity, self.settings = session, identity, settings
        self._secret_provider = secret_provider
        self._used_reference = None
        self._pinned: AIPreferencesInput | None = None

    def pin(self, mode: str, provider: str, model: str) -> None:
        """Bind this service to the selection recorded for a run.

        A pinned service ignores later preference changes: availability and routing are
        evaluated for the bound pair only, and an unavailable pair fails closed (no fallback).
        """
        self._pinned = AIPreferencesInput(mode=mode, provider=provider, model=model)

    @property
    def pinned(self) -> bool:
        return self._pinned is not None

    def secret_provider(self) -> SecretProvider:
        try:
            backend = self._secret_provider or build_secret_provider(self.settings)
        except OSError:
            raise BillingSecretUnavailable() from None
        if not dev_identity_permitted(self.settings) and not backend.production_safe:
            raise BillingSecretUnavailable()
        return backend

    def options(self) -> tuple[AIProviderOption, ...]:
        models = tuple(
            dict.fromkeys(
                [
                    self.settings.ai_model_fast,
                    self.settings.ai_model_standard,
                    self.settings.ai_model_reasoning,
                ]
            )
        )
        provider = (
            self.settings.ai_provider
            if self.settings.ai_provider in {"openai", "openrouter", "huggingface", "nvidia"}
            else "openai"
        )
        if provider == "nvidia":
            eligible = selectable_nvidia_models(self.settings)
            models = tuple(model for model in models if model in eligible)
        options = [AIProviderOption(provider=provider, models=models)]
        # Direct Moonshot is offered beside the primary provider only when the server has a key and
        # an operator list AND a listed model's registry row has evidence; otherwise nothing shows.
        if provider != "moonshot" and moonshot_route_configured(self.settings):
            kimi = tuple(
                sorted(
                    model
                    for model in selectable_models(self.settings, "moonshot")
                    if model in moonshot_models(self.settings)
                )
            )
            if kimi:
                options.append(AIProviderOption(provider="moonshot", models=kimi))
        if dev_identity_permitted(self.settings) and self.settings.ai_provider == "fake":
            options.insert(
                0,
                AIProviderOption(
                    provider="fake",
                    models=("fake-standard", "fake-alternate"),
                    local_test_only=True,
                ),
            )
        return tuple(options)

    def preferences(self) -> AIPreferencesInput:
        if self._pinned is not None:
            return self._pinned
        row = self.session.get(AIPreferenceRecord, self.identity.user_id)
        if row:
            return AIPreferencesInput(mode=row.mode, provider=row.provider, model=row.model)
        options = self.options()
        chosen = options[0]
        return AIPreferencesInput(
            mode="MANAGED",
            provider=chosen.provider,
            model="fake-standard" if chosen.provider == "fake" else self.settings.ai_model_standard,
        )

    def profile_gate(self, profile: str) -> None:
        """Refuse a request class the effective model's registry evidence cannot serve."""
        chosen = self.preferences()
        catalogue = [r for r in model_catalogue(self.settings) if r.provider == chosen.provider]
        if chosen.provider == "fake" or not catalogue:
            # The local fixture and providers the registry holds no rows for (generic BYOK
            # endpoints) keep their server-approved-model behaviour; the registry has no evidence
            # to judge them by, which the model selector states.
            return
        row = next((r for r in catalogue if r.model_identifier == chosen.model), None)
        reason = (
            "The selected model has no registry evidence."
            if row is None
            else profile_ineligibility(row, profile)
        )
        if reason is not None:
            raise AIFoundationError(
                "MODEL_PROFILE_INELIGIBLE",
                f"The selected model cannot serve this request: {reason} "
                "Choose another model; no fallback was used.",
                422,
            )

    def save_preferences(self, payload: AIPreferencesInput) -> AISettingsView:
        option = next((o for o in self.options() if o.provider == payload.provider), None)
        if not option:
            raise AIFoundationError("PROVIDER_UNAVAILABLE", "This provider is not configured.", 422)
        if payload.model not in option.models:
            raise AIFoundationError(
                "MODEL_UNAVAILABLE", "This model is not in the server-approved catalogue.", 422
            )
        if payload.mode == "BYOK" and payload.provider == "fake":
            raise AIFoundationError(
                "PROVIDER_UNAVAILABLE", "The local test fixture cannot use BYOK.", 422
            )
        row = self.session.get(AIPreferenceRecord, self.identity.user_id)
        if row is None:
            row = AIPreferenceRecord(user_id=self.identity.user_id, **payload.model_dump())
            self.session.add(row)
        else:
            row.mode, row.provider, row.model = payload.mode, payload.provider, payload.model
        self.session.commit()
        return self.view()

    def credentials(self) -> tuple[BYOKStatusView, ...]:
        return tuple(
            self._credential_view(row)
            for row in self.session.scalars(
                select(BYOKCredentialRecord).where(
                    BYOKCredentialRecord.user_id == self.identity.user_id,
                    BYOKCredentialRecord.billing_account_id == self._account().id,
                )
            ).all()
        )

    def _account(self):
        from ..billing_service import BillingService

        return BillingService(self.session, self.identity, self.settings)._account()

    def _credential(self, provider: str) -> BYOKCredentialRecord | None:
        return self.session.scalar(
            select(BYOKCredentialRecord).where(
                BYOKCredentialRecord.billing_account_id == self._account().id,
                BYOKCredentialRecord.user_id == self.identity.user_id,
                BYOKCredentialRecord.provider == provider,
            )
        )

    @staticmethod
    def _credential_view(row: BYOKCredentialRecord) -> BYOKStatusView:
        return BYOKStatusView(
            provider=row.provider,
            status=row.status,
            fingerprint=row.fingerprint[:12],
            created_at=row.created_at,
            updated_at=row.updated_at,
            validated=row.validated_at is not None,
        )

    def save_key(self, payload: BYOKCredentialInput) -> BYOKStatusView:
        # Obtain safe storage first: unavailable storage writes no credential/account.
        backend = self.secret_provider()
        if payload.provider not in {o.provider for o in self.options() if not o.local_test_only}:
            raise AIFoundationError(
                "PROVIDER_UNAVAILABLE", "This BYOK provider is not configured.", 422
            )
        row = self._credential(payload.provider)
        previous = row.secret_reference if row else None
        value = payload.secret.get_secret_value()
        try:
            reference = backend.put_secret(value)
        except (OSError, BillingSecretUnavailable):
            raise AIFoundationError(
                "KEY_SAVE_FAILED", "Secure credential storage is unavailable.", 503
            ) from None
        try:
            if row is None:
                row = BYOKCredentialRecord(
                    billing_account_id=self._account().id,
                    user_id=self.identity.user_id,
                    provider=payload.provider,
                )
                self.session.add(row)
                row.secret_reference = reference
                row.fingerprint = hashlib.sha256(value.encode()).hexdigest()
                row.status, row.revoked_at, row.validated_at = "CONFIGURED", None, None
                row.updated_at = utc_now()
            else:
                changed = self.session.execute(
                    update(BYOKCredentialRecord)
                    .where(
                        BYOKCredentialRecord.id == row.id,
                        BYOKCredentialRecord.secret_reference == previous,
                    )
                    .values(
                        secret_reference=reference,
                        fingerprint=hashlib.sha256(value.encode()).hexdigest(),
                        status="CONFIGURED",
                        revoked_at=None,
                        validated_at=None,
                        updated_at=utc_now(),
                    )
                )
                if changed.rowcount != 1:
                    raise ValueError("credential was changed concurrently")
            self.session.commit()
        except Exception:
            self.session.rollback()
            backend.delete_secret(reference)
            raise AIFoundationError(
                "KEY_SAVE_FAILED", "The credential could not be saved.", 503
            ) from None
        finally:
            value = ""
        if previous:
            backend.delete_secret(previous)
        return self._credential_view(row)

    def revoke_key(self, payload: BYOKRevocationInput) -> None:
        row = self._credential(payload.provider)
        if row and row.secret_reference:
            reference = row.secret_reference
            backend = self.secret_provider()
            changed = self.session.execute(
                update(BYOKCredentialRecord)
                .where(
                    BYOKCredentialRecord.id == row.id,
                    BYOKCredentialRecord.secret_reference == reference,
                )
                .values(
                    secret_reference=None, status="REVOKED", revoked_at=utc_now(), validated_at=None
                )
            )
            if changed.rowcount != 1:
                self.session.rollback()
                raise AIFoundationError(
                    "CREDENTIAL_STALE", "The credential changed. Refresh before revoking."
                )
            self.session.commit()
            backend.delete_secret(reference)

    def availability(self) -> AIAvailability:
        pref = self.preferences()
        local_test = (
            pref.provider == "fake"
            and self.settings.ai_provider == "fake"
            and dev_identity_permitted(self.settings)
        )
        managed = local_test or (
            self.settings.billing_managed_ai_enabled
            and not self.settings.billing_managed_ai_kill_switch
        )
        byok = self.settings.billing_byok_enabled
        allowance = "NOT_APPLICABLE"
        if self.settings.billing_enabled:
            from ..billing_service import BillingService

            snap = BillingService(self.session, self.identity, self.settings).snapshot()
            managed = managed and snap.entitlements.managed_ai
            byok = byok and snap.entitlements.byok_ai
            allowance = (
                "AVAILABLE"
                if snap.allowance.ai_remaining.minor_units > 0
                or (
                    snap.entitlements.ai_overage_policy == "ALLOW_METERED_OVERAGE"
                    and snap.allowance.ai_consumed.minor_units
                    + snap.allowance.ai_reserved.minor_units
                    < snap.allowance.ai_granted.minor_units
                    + snap.allowance.ai_overage_cap.minor_units
                )
                else "EXCEEDED"
            )
        storage = False
        try:
            backend = self.secret_provider()
            storage = True
        except (BillingSecretUnavailable, OSError):
            backend = None
        code = None
        if pref.mode == "NONE":
            code = "AI_DISABLED"
        elif pref.provider not in {o.provider for o in self.options()}:
            code = "PROVIDER_UNAVAILABLE"
        elif pref.model not in {
            m for o in self.options() if o.provider == pref.provider for m in o.models
        }:
            code = "MODEL_UNAVAILABLE"
        elif pref.mode == "MANAGED":
            if not managed:
                code = "MANAGED_AI_UNAVAILABLE"
            elif allowance == "EXCEEDED":
                code = "ALLOWANCE_EXCEEDED"
            elif not local_test and not self._managed_provider_ready(pref.provider):
                code = "MANAGED_PROVIDER_UNAVAILABLE"
        else:
            if not byok:
                code = "BYOK_DISABLED"
            elif not storage:
                code = "SECRET_PROVIDER_UNAVAILABLE"
            else:
                row = self._credential(pref.provider)
                if row and row.status == "REVOKED":
                    code = "BYOK_KEY_REVOKED"
                elif (
                    not row
                    or row.status != "CONFIGURED"
                    or not row.secret_reference
                    or not backend.exists(row.secret_reference)
                ):
                    code = "BYOK_KEY_MISSING"
        return AIAvailability(
            mode=pref.mode,
            provider=pref.provider,
            model=pref.model,
            available=code is None,
            error_code=code,
            managed_enabled=managed,
            byok_enabled=byok,
            secret_storage_available=storage,
            local_test_only=local_test,
            allowance_status=allowance,
        )

    def _moonshot_base(self) -> str:
        base = (self.settings.moonshot_api_base_url or MOONSHOT_BASE).rstrip("/")
        if base == MOONSHOT_BASE or (self.settings.environment == "test" and loopback_host(base)):
            return base
        return MOONSHOT_BASE

    def _managed_provider_ready(self, provider: str) -> bool:
        """The server holds the credential and switch for exactly this provider; never another."""
        if not self.settings.run_ai_integration:
            return False
        if provider == self.settings.ai_provider:
            return bool(self.settings.ai_api_key)
        if provider == "moonshot":
            return moonshot_route_configured(self.settings)
        return False

    def view(self) -> AISettingsView:
        return AISettingsView(
            preferences=self.preferences(),
            availability=self.availability(),
            providers=self.options(),
            credentials=self.credentials(),
            model_capabilities=model_catalogue(self.settings),
        )

    def gateway(self) -> tuple[ModelGateway, AIAvailability]:
        state = self.availability()
        if not state.available:
            raise AIFoundationError(
                state.error_code or "AI_UNAVAILABLE",
                "The selected AI mode/provider is unavailable. "
                "Configure AI settings; no fallback was used.",
                503,
            )
        if state.mode == "MANAGED":
            if self.settings.billing_enabled:
                from ..billing_service import BillingService

                BillingService(self.session, self.identity, self.settings).authorize_managed_ai()
            if state.provider == "moonshot" and self.settings.ai_provider != "moonshot":
                config = self.settings.model_copy(
                    update={
                        "ai_provider": "moonshot",
                        "ai_api_key": self.settings.moonshot_api_key,
                        "ai_api_base_url": self._moonshot_base(),
                    }
                )
                return HttpOpenAIModelGateway(config), state
            return build_model_gateway(self.settings), state
        row = self._credential(state.provider)
        if not row or not row.secret_reference:
            raise AIFoundationError(
                "BYOK_KEY_MISSING", "Configure a BYOK key for the selected provider.", 503
            )
        try:
            key = self.secret_provider().get_secret(row.secret_reference)
        except BillingSecretUnavailable:
            raise AIFoundationError(
                "BYOK_KEY_UNAVAILABLE", "The selected BYOK credential cannot be read.", 503
            ) from None
        self._used_reference = row.secret_reference
        bases = {
            "openai": "https://api.openai.com/v1",
            "openrouter": "https://openrouter.ai/api/v1",
            "huggingface": "https://router.huggingface.co/v1",
            "nvidia": "https://integrate.api.nvidia.com/v1",
            "moonshot": MOONSHOT_BASE,
        }
        config = self.settings.model_copy(
            update={
                "ai_provider": state.provider,
                "ai_api_key": SecretStr(key),
                "ai_api_base_url": bases[state.provider],
                "run_ai_integration": True,
            }
        )
        return HttpOpenAIModelGateway(config), state

    def mark_validated(self, provider: str) -> None:
        # A response from an old request must not validate a replacement/revoked key.
        if self._used_reference:
            self.session.execute(
                update(BYOKCredentialRecord)
                .where(
                    BYOKCredentialRecord.billing_account_id == self._account().id,
                    BYOKCredentialRecord.user_id == self.identity.user_id,
                    BYOKCredentialRecord.provider == provider,
                    BYOKCredentialRecord.status == "CONFIGURED",
                    BYOKCredentialRecord.secret_reference == self._used_reference,
                )
                .values(validated_at=utc_now()),
                execution_options={"synchronize_session": False},
            )
            self.session.commit()
