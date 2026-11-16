"""AI-8 offline checks: an owner exception lets a probe name an UNKNOWN model, and nothing else.

Kimi K2.6 on NVIDIA has a live API id but no verified availability, so its registry row reads
UNKNOWN. A production-flow authorization may carry an explicit, written, owner-signed exception for
it with a USD spend ceiling; the registry, the model switcher and every other safeguard are
unchanged. No test contacts a provider.
"""

import json
import sys
from pathlib import Path

import pytest
from chemdft_api.ai.model_catalog import DEFINITIONS, selectable_nvidia_models
from chemdft_api.config import Settings
from pydantic import SecretStr
from test_nvidia_probe_flow_cli import SUPER, flow_dict
from test_nvidia_probe_preflight import NOW

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools"))

from nvidia_probe.authorization import (  # noqa: E402
    SCHEMA,
    AuthorizationError,
    parse_authorization,
)
from nvidia_probe.molecules import REFERENCE_FIXTURE_ID, reference_cases_digest  # noqa: E402

K26 = "moonshotai/kimi-k2.6"
K3 = "moonshotai/kimi-k3"
REASON = "Owner accepts that NVIDIA lists no Free Endpoint label for this model and may bill it."
CASES = ["h2-hf-sto3g", "ethanol-hf-sto3g"]
USD = {
    "kind": "USD_CEILING",
    "ceiling_usd": 1.0,
    "input_usd_per_million_tokens": 3.0,
    "output_usd_per_million_tokens": 15.0,
    "pricing_source": "NVIDIA partner-endpoint range read in AI-5 discovery",
}


def kimi(**overrides):
    values = {
        "models": [K26],
        "fixture": REFERENCE_FIXTURE_ID,
        "flow": {
            "planning_profile": "PYSCF_ENERGY_PROPOSAL",
            "max_model_calls_per_model": 2,
            "input_token_basis": "SERVICE_RESERVATION",
            "read_timeout_seconds": 120,
            "cases": CASES,
            "cases_sha256": reference_cases_digest(CASES),
        },
        "max_total_calls": 4,
        "max_output_tokens_per_request": 4096,
        "max_total_tokens": 100_000,
        "spend_control": USD,
        "owner_exceptions": {K26: REASON},
    }
    values.update(overrides)
    data = flow_dict(**values)
    for key in [k for k, v in values.items() if v is None]:
        data.pop(key)
    return json.dumps(data).encode()


def code_of(raw):
    with pytest.raises(AuthorizationError) as refused:
        parse_authorization(raw, now=NOW)
    return refused.value.code


def test_the_registry_row_stays_unknown_and_unselectable_whatever_an_authorization_says():
    row = next(d for d in DEFINITIONS if d.model == K26)
    assert row.availability == "UNKNOWN" and not row.development_profiles
    settings = Settings(
        _env_file=None,
        ai_provider="nvidia",
        ai_api_base_url="https://integrate.api.nvidia.com/v1",
        ai_api_key=SecretStr("offline-test"),
        ai_model_fast=K26,
        ai_model_standard=K26,
        ai_model_reasoning=K26,
        ai_development_models=K26,
    )
    assert K26 not in selectable_nvidia_models(settings)


def test_k26_is_refused_without_an_owner_exception():
    assert code_of(kimi(owner_exceptions=None)) == "MODEL_NOT_AVAILABLE"


def test_k26_is_accepted_with_a_written_exception_and_a_usd_ceiling():
    approved = parse_authorization(kimi(), now=NOW)
    assert approved.models == (K26,) and approved.owner_exceptions == (K26,)
    assert approved.spend_control.kind == "USD_CEILING"
    assert approved.sampling == "MODEL_CARD_PROFILE"


def test_an_exception_needs_a_usd_ceiling_because_the_cost_is_unknown():
    token_only = {"kind": "TOKEN_CEILING_ONLY", "acknowledged_no_cost_information": True}
    assert code_of(kimi(spend_control=token_only)) == "OWNER_EXCEPTION_NEEDS_USD_CEILING"


@pytest.mark.parametrize("exceptions", [{}, {K26: "too short"}, {SUPER: REASON}, {K26: 5}, [K26]])
def test_a_malformed_or_foreign_exception_is_refused(exceptions):
    assert code_of(kimi(owner_exceptions=exceptions)) == "OWNER_EXCEPTION_INVALID"


def test_an_exception_never_covers_a_deprecated_or_other_non_unknown_row():
    assert code_of(kimi(models=[K3], owner_exceptions={K3: REASON})) == "MODEL_NOT_AVAILABLE"
    # an AVAILABLE model needs no exception, and naming one for it is refused rather than ignored
    available = kimi(models=[SUPER], owner_exceptions={SUPER: REASON})
    assert code_of(available) == "MODEL_NOT_AVAILABLE"


def test_only_a_flow_authorization_may_carry_an_exception():
    raw = json.loads(kimi())
    raw["schema"] = SCHEMA
    assert code_of(json.dumps(raw).encode()) in {"KEYS_MISMATCH", "OWNER_EXCEPTION_NOT_ALLOWED"}


def test_an_exception_for_one_model_does_not_open_a_second_unverified_one():
    others = [
        d.model
        for d in DEFINITIONS
        if d.provider == "nvidia" and d.availability == "UNKNOWN" and d.model != K26
    ]
    if not others:
        pytest.skip("the registry holds no other UNKNOWN NVIDIA row")
    assert code_of(kimi(models=[K26, others[0]], max_total_calls=4)) == "MODEL_NOT_AVAILABLE"


# -- the direct Moonshot endpoint --

MOONSHOT = "https://api.moonshot.ai/v1"
MOONSHOT_USD = {
    "kind": "USD_CEILING",
    "ceiling_usd": 1.0,
    "input_usd_per_million_tokens": 3.0,
    "output_usd_per_million_tokens": 15.0,
    "pricing_source": "platform.kimi.ai pricing page, kimi-k3 row, read 2026-10-18",
}


def moonshot(**overrides):
    values = {
        "endpoint": MOONSHOT,
        "models": ["kimi-k3", "kimi-k2.6"],
        "sampling": "PRODUCTION_DEFAULT",
        "spend_control": MOONSHOT_USD,
        "max_total_calls": 4,
        "max_output_tokens_per_request": 3072,
        "max_total_tokens": 100_000,
        "owner_exceptions": None,
    }
    values.update(overrides)
    return kimi(**values)


def test_a_moonshot_flow_is_accepted_with_a_usd_ceiling_and_no_profile_or_exception():
    approved = parse_authorization(moonshot(), now=NOW)
    assert approved.provider == "moonshot" and approved.endpoint == MOONSHOT
    assert approved.models == ("kimi-k3", "kimi-k2.6") and approved.sampling == "PRODUCTION_DEFAULT"


@pytest.mark.parametrize(
    ("overrides", "code"),
    [
        ({"sampling": "MODEL_CARD_PROFILE"}, "PROVIDER_REQUIRES_FLOW_WITH_PRODUCTION_DEFAULT"),
        ({"owner_exceptions": {"kimi-k3": REASON}}, "MODEL_NOT_AVAILABLE"),  # AVAILABLE needs none
        (
            {"models": ["kimi-k2.5"], "owner_exceptions": {"kimi-k2.5": REASON}},
            "MODEL_NOT_REGISTERED",
        ),
        ({"models": [K26], "owner_exceptions": {K26: REASON}}, "MODEL_NOT_REGISTERED"),  # NVIDIA id
        (
            {
                "spend_control": {
                    "kind": "TOKEN_CEILING_ONLY",
                    "acknowledged_no_cost_information": True,
                }
            },
            "PAID_PROVIDER_NEEDS_USD_CEILING",
        ),
        ({"endpoint": "https://api.moonshot.cn/v1"}, "ENDPOINT_NOT_ALLOWED"),
    ],
)
def test_a_moonshot_authorization_refuses_anything_unreviewed(overrides, code):
    assert code_of(moonshot(**overrides)) == code


def test_the_flow_gateway_verifies_the_authorized_providers_identity():
    from nvidia_probe.flow import BudgetedFlowGateway

    approved = parse_authorization(moonshot(), now=NOW)
    seen = []

    class Inner:
        def __init__(self, provider):
            self.provider = provider

        def generate(self, request):
            from chemdft_api.ai.gateway import ModelResponse, ModelUsage

            seen.append(request)
            return ModelResponse(
                content="x",
                usage=ModelUsage(10, 5, 1),
                model_identifier="kimi-k2.6",
                provider=self.provider,
            )

    from chemdft_api.ai.gateway import ModelGatewayError, ModelMessage, ModelRequest

    asked = ModelRequest(
        system_prompt="s",
        messages=(ModelMessage(role="user", content="u"),),
        model_identifier="kimi-k2.6",
        max_tokens=1024,
    )
    gateway = BudgetedFlowGateway(
        Inner("moonshot"), approved, "kimi-k2.6", sampling="PRODUCTION_DEFAULT"
    )
    assert gateway.generate(asked).model_identifier == "kimi-k2.6" and len(seen) == 1
    wrong = BudgetedFlowGateway(
        Inner("nvidia"), approved, "kimi-k2.6", sampling="PRODUCTION_DEFAULT"
    )
    with pytest.raises(ModelGatewayError):
        wrong.generate(asked)


def test_a_key_file_never_crosses_providers(tmp_path, monkeypatch):
    from nvidia_probe import runner

    approved = parse_authorization(moonshot(), now=NOW)
    nvidia_key = tmp_path / "nvidia.key"
    moonshot_key = tmp_path / "moonshot.key"
    for path, text in ((nvidia_key, "throwaway-nvidia"), (moonshot_key, "throwaway-moonshot")):
        path.write_text(text)
        path.chmod(0o600)
    hosts = []
    monkeypatch.setattr(runner, "install_host_allowlist", lambda host: hosts.append(host))
    # only the NVIDIA variable is set: a Moonshot authorization must refuse, not borrow that key
    with pytest.raises(AuthorizationError):
        runner._build_gateway(approved, {runner.KEY_FILE_ENV: str(nvidia_key)}, None, 60)
    gateway = runner._build_gateway(
        approved, {runner.MOONSHOT_KEY_FILE_ENV: str(moonshot_key)}, None, 60
    )
    assert hosts == ["api.moonshot.ai"]
    assert gateway._api_key == "throwaway-moonshot" and gateway._provider == "moonshot"


# -- pacing for a low request-rate tier ---------------------------------------------------------


def paced(gap):
    data = json.loads(moonshot())
    data["flow"]["min_seconds_between_requests"] = gap
    return json.dumps(data).encode()


def test_pacing_is_optional_bounded_and_zero_by_default():
    assert parse_authorization(moonshot(), now=NOW).flow.min_seconds_between_requests == 0
    assert parse_authorization(paced(25), now=NOW).flow.min_seconds_between_requests == 25
    assert code_of(paced(121)) == "LIMIT_INVALID"
    assert code_of(paced(-1)) == "LIMIT_INVALID"


def test_pacing_waits_between_requests_without_adding_calls_or_changing_the_budget():
    from chemdft_api.ai.gateway import ModelMessage, ModelRequest, ModelResponse, ModelUsage
    from nvidia_probe.flow import _LAST_REQUEST_AT, BudgetedFlowGateway

    approved = parse_authorization(paced(25), now=NOW)
    _LAST_REQUEST_AT.pop(approved.sha256, None)
    waits, clock = [], [100.0]

    class Inner:
        def generate(self, request):
            return ModelResponse(
                content="x",
                usage=ModelUsage(10, 5, 1),
                model_identifier="kimi-k2.6",
                provider="moonshot",
            )

    def sleep(seconds):
        waits.append(round(seconds, 3))
        clock[0] += seconds

    asked = ModelRequest(
        system_prompt="s",
        messages=(ModelMessage(role="user", content="u"),),
        model_identifier="kimi-k2.6",
        max_tokens=1024,
    )
    ledger = None
    for _ in range(3):
        gateway = BudgetedFlowGateway(
            Inner(),
            approved,
            "kimi-k2.6",
            sampling="PRODUCTION_DEFAULT",
            ledger=ledger,
            clock=lambda: clock[0],
            sleep=sleep,
        )
        ledger = gateway.ledger
        gateway.generate(asked)
        clock[0] += 5  # the request itself took 5 s
    assert waits == [
        20.0,
        20.0,
    ]  # 25 s between request ends and the next start; none before the first
    assert ledger.calls_admitted == 3  # a wait is not a retry and not an extra call
