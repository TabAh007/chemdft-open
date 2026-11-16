"""Reviewed model evidence; no discovery calls, credentials, fallback or model activation.

Status is evidence about a specific endpoint/adapter, not a service-level guarantee.
User availability/quotas/BYOK remain AIProviderService's responsibility.
"""

from dataclasses import dataclass

from ..contracts.ai_models import AIModelCapability

NVIDIA_BASE = "https://integrate.api.nvidia.com/v1"
LIGHTNING = "nvidia/nemotron-3.5-lightning-30b-a3b"
TRIAL_LIMITATION = (
    "NVIDIA trial evaluation terms apply; external beta service rights are not confirmed."
)
COMMON_REQUIREMENTS = (
    "Explicit server-approved provider/model and endpoint",
    "Existing authorized credential, integration opt-in and available quota",
    "Verified tool adapter before selection; no automatic fallback",
)


# Capabilities each request class needs from a registry row. Evidence comes only from the
# reviewed rows below: documented capabilities plus ChemDFT's own tool-adapter verification.
PROFILE_REQUIREMENTS = {
    "EVIDENCE": "Text",
    "GENERAL": "Tool calling",
    "PYSCF_ENERGY_PROPOSAL": "Tool calling",
    "STRUCTURE_EDIT_PROPOSAL": "Tool calling",
    "PERIODIC_ENERGY_PROPOSAL": "Tool calling",
}


def profile_ineligibility(capability: AIModelCapability, profile: str) -> str | None:
    """Server-authored reason this registry row cannot serve a request class, or None."""
    needed = PROFILE_REQUIREMENTS.get(profile)
    if needed is None:
        return "Unknown planning profile."
    if not capability.selectable:
        return capability.unselectable_reason or "This model is not selectable."
    if capability.eligibility == "DEVELOPMENT":
        # Development eligibility rests on hosted evidence for named profiles only; the generic
        # documented-capability and tool-verification requirements below do not apply to it.
        if profile in capability.planning_profiles:
            return None
        covered = ", ".join(capability.planning_profiles) or "no profile"
        return f"Development eligibility covers only: {covered}."
    if needed not in capability.documented_capabilities:
        return f"The registry does not document {needed.lower()} for this model."
    if needed == "Tool calling" and not capability.tool_compatibility_verified:
        return "Tool calling is not verified against ChemDFT's adapter."
    return None


@dataclass(frozen=True, slots=True)
class ModelDefinition:
    provider: str
    model: str
    name: str
    availability: str
    capabilities: tuple[str, ...]
    context: str
    sources: tuple[str, ...]
    limitations: tuple[str, ...] = ()
    adapter_supported: bool = True
    tool_verified: bool = False
    # Planning profiles for which the registry holds dated hosted evidence, and that evidence.
    # Non-empty means the row MAY be offered on a server whose operator lists the model in
    # CHEMDFT_AI_DEVELOPMENT_MODELS; it never makes the row selectable by itself.
    development_profiles: tuple[str, ...] = ()
    development_evidence: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class SamplingProfile:
    """Provider-documented sampling/reasoning settings for one model; opt-in, never a default.

    Production requests keep the gateway default (temperature 0, no top_p, no reasoning field).
    Only an explicitly authorized probe may apply a profile, and only values the provider's own
    model card or API reference states are recorded here.
    """

    temperature: float
    top_p: float
    chat_template_kwargs: tuple[tuple[str, bool], ...] | None
    source_urls: tuple[str, ...]
    reviewed_on: str
    note: str


_NIM_REFERENCE = "https://docs.api.nvidia.com/nim/reference/"
SAMPLING_PROFILES: dict[str, SamplingProfile] = {
    LIGHTNING: SamplingProfile(
        temperature=1.0,
        top_p=0.95,
        chat_template_kwargs=None,
        source_urls=(_NIM_REFERENCE + "nvidia-nemotron-3-5-lightning-30b-a3b",),
        reviewed_on="2026-10-17",
        note=(
            "Model card lists Temperature 1.0 and Top_P 0.95. No reasoning switch was found in the "
            "part of the page that was read, so none is sent."
        ),
    ),
    "nvidia/nemotron-3-super-120b-a12b": SamplingProfile(
        temperature=1.0,
        top_p=0.95,
        chat_template_kwargs=(("enable_thinking", True), ("low_effort", True)),
        source_urls=(_NIM_REFERENCE + "nvidia-nemotron-3-super-120b-a12b",),
        reviewed_on="2026-10-17",
        note=(
            "Card recommends temperature 1.0 and top_p 0.95 for all tasks; reasoning is on by "
            "default through chat_template_kwargs.enable_thinking, and low_effort is the "
            "documented starting point before tuning token budgets."
        ),
    ),
    "nvidia/nemotron-3-ultra-550b-a55b": SamplingProfile(
        temperature=1.0,
        top_p=0.95,
        chat_template_kwargs=(("enable_thinking", True),),
        source_urls=(_NIM_REFERENCE + "nvidia-nemotron-3-ultra-550b-a55b",),
        reviewed_on="2026-10-17",
        note=(
            "The reference page's own examples use temperature 1.0 and top_p 0.95 (not labelled a "
            "recommendation); reasoning is on by default via chat_template_kwargs.enable_thinking."
        ),
    ),
    "nvidia/nemotron-3.5-super-vl-120b-a12b": SamplingProfile(
        temperature=1.0,
        top_p=0.95,
        chat_template_kwargs=None,
        source_urls=(_NIM_REFERENCE + "nvidia-nemotron-3_5-super-vl-120b-a12b",),
        reviewed_on="2026-10-17",
        note=(
            "'Recommended Sampling': text temperature 1.0, top_p 0.95 (vision 0.6/0.95, not used: "
            "text-only requests). enable_thinking is a chat-template switch with no stated "
            "default or placement, so none is sent."
        ),
    ),
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning": SamplingProfile(
        temperature=0.6,
        top_p=0.95,
        chat_template_kwargs=(("enable_thinking", True),),
        source_urls=(_NIM_REFERENCE + "nvidia-nemotron-3-nano-omni-30b-a3b-reasoning",),
        reviewed_on="2026-10-17",
        note=(
            "Suggested thinking-mode sampling temperature 0.6, top_p 0.95; reasoning is on by "
            "default. The page recommends an output length of at least 20,480 tokens for "
            "reasoning tasks, far above a probe cap, so truncation is an expected outcome."
        ),
    ),
    "deepseek-ai/deepseek-v4.1-flash": SamplingProfile(
        temperature=1.0,
        top_p=0.95,
        chat_template_kwargs=None,
        source_urls=(
            "https://build.nvidia.com/deepseek-ai/deepseek-v4.1-flash/modelcard",
            _NIM_REFERENCE + "nvidia-deepseek-v4_1-flash",
        ),
        reviewed_on="2026-10-17",
        note=(
            "Model card: the source recommends temperature 1.0 and top_p 0.95 or 1.0, and "
            "max_tokens of at least 256K (not reachable under a probe cap). Reasoning effort is "
            "a numeric 1-100 setting whose request placement the page does not state, so none "
            "is sent."
        ),
    ),
    "meta/muse-glimmer-30b": SamplingProfile(
        temperature=1.0,
        top_p=0.95,
        chat_template_kwargs=None,
        source_urls=(_NIM_REFERENCE + "meta-muse-glimmer-30b",),
        reviewed_on="2026-10-17",
        note=(
            "Recommended temperature 1.0, top_p 0.95, top_k 64; top_k is not sent (the gateway "
            "has no top_k field). Reasoning strength (low/medium/high/xhigh) has no stated "
            "parameter name, so none is sent."
        ),
    ),
    "stepfun-ai/step-5-preview": SamplingProfile(
        temperature=1.0,
        top_p=0.95,
        chat_template_kwargs=None,
        source_urls=(_NIM_REFERENCE + "stepfun-ai-step-5-preview",),
        reviewed_on="2026-10-17",
        note=(
            "Model builder recommends temperature 1.0, top_p 0.95, top_k 0 (top_k 0 is not "
            "sent). No reasoning control or function-calling request example is documented."
        ),
    ),
    "moonshotai/kimi-k2.6": SamplingProfile(
        temperature=1.0,
        top_p=0.95,
        chat_template_kwargs=None,
        source_urls=(_NIM_REFERENCE + "moonshotai-kimi-k2-6",),
        reviewed_on="2026-10-18",
        note=(
            "The NVIDIA reference page states no sampling or reasoning parameters. The model "
            "builder's own API documentation (Moonshot, platform.kimi.ai K2.6 quickstart, read "
            "2026-10-18) fixes temperature 1.0 with thinking enabled and top_p 0.95 and says other "
            "values may be refused; those values are used and nothing else is sent. Applies only "
            "to an explicitly authorized probe: the row stays UNKNOWN and not selectable."
        ),
    ),
    "google/gemma-4-31b-it": SamplingProfile(
        temperature=1.0,
        top_p=0.95,
        chat_template_kwargs=None,
        source_urls=(_NIM_REFERENCE + "google-gemma-4-31b-it",),
        reviewed_on="2026-10-17",
        note=(
            "Partner-recommended temperature 1.0, top_p 0.95, top_k 64; top_k is not sent. "
            "Thinking is enabled by a system-prompt token, not an API field, and is left off."
        ),
    ),
}


def sampling_profile(model: str) -> SamplingProfile | None:
    return SAMPLING_PROFILES.get(model)


DEFINITIONS = (
    ModelDefinition(
        "nvidia",
        LIGHTNING,
        "Nemotron 3.5 Lightning 30B A3B",
        "AVAILABLE",
        ("Text", "Tool calling", "Reasoning", "Streaming"),
        "1M (published)",
        (f"https://build.nvidia.com/{LIGHTNING}",),
        (
            "Historical tool responses verified; V2 timed out; hosted proposal acceptance failed.",
            "Current adapter is non-streamed, temperature 0; no reasoning override is sent.",
        ),
        tool_verified=True,
    ),
    ModelDefinition(
        "nvidia",
        "nvidia/nemotron-3-super-120b-a12b",
        "Nemotron 3 Super 120B A12B",
        "AVAILABLE",
        ("Text", "Tool calling", "Reasoning", "Streaming"),
        "1M (published)",
        (
            "https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b/build",
            "https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b/modelcard",
        ),
        (
            "Free access rests on the owner's account evidence, not a billing guarantee.",
            "The model card's sampling and thinking settings are applied only on the development "
            "path; production requests stay at temperature 0.",
            "Single samples at temperature 1.0 on H2, water and ethanol: repeatability, production "
            "temperature 0 and scientific correctness are not established.",
            "Hosted evidence is single production-flow requests on three molecules (AI-5 run 5 "
            "and AI-6 run 6 on H2, AI-6 run 7 on water and ethanol); earlier compact-probe replies "
            "failed ChemDFT's strict raw-argument check.",
        ),
        development_profiles=(
            "PYSCF_ENERGY_PROPOSAL",
            "STRUCTURE_EDIT_PROPOSAL",
            "PERIODIC_ENERGY_PROPOSAL",
        ),
        development_evidence=(
            "AI-5 run 5, 2026-10-17, real AI Scientist service, model-card sampling: one request "
            "gave a proposal accepted on the first attempt and valid for the prompt (HF/STO-3G, "
            "PySCF ENERGY, neutral singlet H2); approval pending, nothing computed.",
            "AI-6 run 6, 2026-10-18, the same service with request matching: one request gave "
            "another first-attempt proposal valid for the same prompt; approval pending, nothing "
            "computed.",
            "AI-6 run 7, 2026-10-18, reference cases: one request each on water (PBE/def2-SVP) "
            "and ethanol (B3LYP/6-31G) gave first-attempt proposals matching every named "
            "parameter; approvals pending, nothing computed.",
            "AI-8 live browser run, 2026-10-18: selected in the browser's model switcher, one "
            "request each for H2 (HF/STO-3G), water (HF/6-31G) and ethanol (HF/STO-3G) "
            "through the real service gave first-attempt proposals matching all six named "
            "parameters (latency 6.0 to 11.0 s; "
            "9,467 to 9,981 input and 309 to 346 output tokens); "
            "each was inspected on the approval screen and "
            "rejected, and no compute job existed.",
        ),
    ),
    ModelDefinition(
        "nvidia",
        "deepseek-ai/deepseek-v4-flash",
        "DeepSeek V4 Flash (NVIDIA)",
        "DEPRECATED",
        ("Text", "Agentic"),
        "1M (published)",
        ("https://build.nvidia.com/deepseek-ai/deepseek-v4-flash",),
        (
            "Deprecated free endpoint; partner availability is a separate service.",
            "NVIDIA API: HTTP 410 Gone, end of life 2026-08-07T09:00:00Z (checked 2026-10-17).",
        ),
    ),
    ModelDefinition(
        "nvidia",
        "deepseek-ai/deepseek-v4.1-flash",
        "DeepSeek V4.1 Flash (candidate)",
        "AVAILABLE",
        ("Text", "Image input", "Tool calling", "Reasoning"),
        "1M (published)",
        ("https://build.nvidia.com/deepseek-ai/deepseek-v4.1-flash",),
        (
            "Distinct model, not an alias; tool and streaming parameter compatibility unknown.",
            "Image input is not implemented in ChemDFT's planning adapter.",
        ),
    ),
    ModelDefinition(
        "nvidia",
        "moonshotai/kimi-k3",
        "Kimi K3 (NVIDIA)",
        "DEPRECATED",
        ("Text", "Image input", "Agentic", "Reasoning"),
        "1M (published)",
        ("https://build.nvidia.com/moonshotai/kimi-k3",),
        (
            "Deprecated free endpoint; NVIDIA account/tool adapter compatibility not verified.",
            "NVIDIA API: HTTP 410 Gone, end of life 2026-10-15T08:00:00Z (checked 2026-10-17).",
            "The model page lists Free Endpoint as Deprecated; only paid partner endpoints remain.",
        ),
    ),
    ModelDefinition(
        "nvidia",
        "moonshotai/kimi-k2-thinking",
        "Kimi K2 Thinking (NVIDIA)",
        "DEPRECATED",
        ("Text", "Tool calling", "Reasoning"),
        "256K (published)",
        ("https://build.nvidia.com/moonshotai/kimi-k2-thinking",),
        (
            "Deprecated free endpoint; reasoning/tool continuation compatibility not verified.",
            "NVIDIA API: HTTP 410 Gone, end of life 2026-05-12T00:00:00Z (checked 2026-10-17).",
        ),
    ),
    ModelDefinition(
        "nvidia",
        "moonshotai/kimi-k2-instruct",
        "Kimi K2 Instruct (NVIDIA)",
        "DEPRECATED",
        ("Text", "Agentic"),
        "UNKNOWN",
        ("https://build.nvidia.com/moonshotai/kimi-k2-instruct",),
        (
            "Deprecated free endpoint; no current ChemDFT compatibility verification.",
            "NVIDIA API: HTTP 410 Gone, end of life 2026-05-12T00:00:00Z (checked 2026-10-17).",
        ),
    ),
    ModelDefinition(
        "nvidia",
        "moonshotai/kimi-k2.6",
        "Kimi K2.6 (catalogue unresolved)",
        "UNKNOWN",
        (),
        "UNKNOWN",
        (
            "https://build.nvidia.com/moonshotai/kimi-k2.5",
            "https://build.nvidia.com/moonshotai/kimi-k2.6",
            "https://docs.api.nvidia.com/nim/reference/moonshotai-kimi-k2-6",
        ),
        (
            "The NVIDIA API lists this id (public lookup HTTP 200, 2026-10-17), but "
            "build.nvidia.com has no live model page (404) and no catalogue card: no Free Endpoint "
            "label could be verified, so free eligibility and billing are UNVERIFIED.",
            "K2.5 is not in the API (HTTP 404); its page redirects to the missing K2.6 page.",
            "AI-8 live probe 2026-10-18 (owner exception, USD ceiling): three production-flow "
            "chat-completion requests each returned HTTP 404 in about 0.5 s with no usage, so the "
            "model is not callable with this account and key today although the model-list "
            "lookup still shows the id.",
        ),
    ),
    ModelDefinition(
        "nvidia",
        "nvidia/nemotron-3-ultra-550b-a55b",
        "Nemotron 3 Ultra 550B A55B",
        "AVAILABLE",
        ("Text", "Tool calling", "Reasoning"),
        "1M (published)",
        ("https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b/modelcard",),
        (
            "Free Endpoint label seen on build.nvidia.com 2026-10-17; never exercised by ChemDFT.",
            "Tool calling is documented but not verified against ChemDFT's adapter.",
            "Reasoning is on by default and consumes output tokens.",
        ),
    ),
    ModelDefinition(
        "nvidia",
        "nvidia/nemotron-3.5-super-vl-120b-a12b",
        "Nemotron 3.5 Super VL 120B A12B",
        "AVAILABLE",
        ("Text", "Image input", "Tool calling", "Reasoning"),
        "1M (published)",
        ("https://build.nvidia.com/nvidia/nemotron-3.5-super-vl-120b-a12b/modelcard",),
        (
            "Free Endpoint label seen on build.nvidia.com 2026-10-17; never exercised by ChemDFT.",
            "Tool calling is documented but not verified against ChemDFT's adapter.",
            "Image input is not implemented in ChemDFT's planning adapter.",
        ),
    ),
    ModelDefinition(
        "nvidia",
        "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
        "Nemotron 3 Nano Omni 30B A3B Reasoning",
        "AVAILABLE",
        ("Text", "Tool calling", "Reasoning"),
        "256K (published)",
        ("https://build.nvidia.com/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning/modelcard",),
        (
            "Free Endpoint label seen on build.nvidia.com 2026-10-17; never exercised by ChemDFT.",
            "Tool calling is documented but not verified against ChemDFT's adapter.",
            "Other input modalities are not implemented in ChemDFT's planning adapter.",
        ),
    ),
    ModelDefinition(
        "nvidia",
        "meta/muse-glimmer-30b",
        "Muse Glimmer 30B",
        "AVAILABLE",
        ("Text", "Image input", "Tool calling", "Reasoning"),
        "131K+ (published)",
        ("https://build.nvidia.com/meta/muse-glimmer-30b/modelcard",),
        (
            "Free Endpoint label seen on build.nvidia.com 2026-10-17; never exercised by ChemDFT.",
            "Tool calling is documented but not verified against ChemDFT's adapter.",
            "Image input is not implemented in ChemDFT's planning adapter.",
        ),
    ),
    ModelDefinition(
        "nvidia",
        "stepfun-ai/step-5-preview",
        "Step 5 Preview",
        "AVAILABLE",
        ("Text", "Image input", "Reasoning"),
        "1M (published)",
        ("https://build.nvidia.com/stepfun-ai/step-5-preview/modelcard",),
        (
            "Free Endpoint label seen on build.nvidia.com 2026-10-17.",
            "The reference page documents no function-calling request shape; tool calls were "
            "observed only in ChemDFT's own requests.",
            "Image input is not implemented in ChemDFT's planning adapter.",
            "Single samples at temperature 1.0 on H2, water and ethanol: repeatability, production "
            "temperature 0 and scientific correctness are not established.",
            "Hosted evidence is single production-flow requests on three molecules (AI-5 run 5 "
            "and AI-6 run 6 on H2, AI-6 run 7 on water and ethanol); one earlier compact-probe "
            "reply was accepted by the production replay but used the wrong basis.",
        ),
        development_profiles=(
            "PYSCF_ENERGY_PROPOSAL",
            "STRUCTURE_EDIT_PROPOSAL",
            "PERIODIC_ENERGY_PROPOSAL",
        ),
        development_evidence=(
            "AI-5 run 5, 2026-10-17, real AI Scientist service, model-card sampling: one request "
            "gave a proposal accepted on the first attempt and valid for the prompt (HF/STO-3G, "
            "PySCF ENERGY, neutral singlet H2); approval pending, nothing computed.",
            "AI-6 run 6, 2026-10-18, the same service with request matching: one request gave "
            "another first-attempt proposal valid for the same prompt; approval pending, nothing "
            "computed.",
            "AI-6 run 7, 2026-10-18, reference cases: one request each on water (PBE/def2-SVP) "
            "and ethanol (B3LYP/6-31G) gave first-attempt proposals matching every named "
            "parameter; approvals pending, nothing computed.",
            "AI-8 live browser run, 2026-10-18: selected in the browser's model switcher, one "
            "request each for H2 (HF/STO-3G), water (HF/6-31G) and ethanol (HF/STO-3G) "
            "through the real service gave first-attempt proposals matching all six named "
            "parameters (latency 25.6 to 51.7 s; "
            "8,828 to 9,281 input and 757 to 1,474 output tokens); "
            "each was inspected on the approval screen and "
            "rejected, and no compute job existed.",
        ),
    ),
    ModelDefinition(
        "nvidia",
        "google/gemma-4-31b-it",
        "Gemma 4 31B IT",
        "AVAILABLE",
        ("Text", "Tool calling"),
        "256K (published)",
        ("https://build.nvidia.com/google/gemma-4-31b-it/modelcard",),
        (
            "Free Endpoint label seen on build.nvidia.com 2026-10-17; never exercised by ChemDFT.",
            "Tool calling is documented but not verified against ChemDFT's adapter.",
            "The docs index files this model under visual models; image input is not exercised.",
        ),
    ),
    ModelDefinition(
        "moonshot",
        "kimi-k3",
        "Kimi K3 (Moonshot)",
        "AVAILABLE",
        ("Text", "Tool calling", "Reasoning", "Streaming"),
        "1M (published)",
        (
            "https://platform.kimi.ai/docs/overview",
            "https://platform.kimi.ai/docs/api/models-overview",
            "https://platform.kimi.ai/docs/api/chat",
        ),
        (
            "Direct Moonshot API with a reviewed request shape (reasoning_effort low, sampling "
            "fixed by Moonshot and never sent); routed only when the server has a Moonshot key "
            "and lists the model, and offered only with registry evidence.",
            "Direct Moonshot API: offered only on a server that holds a Moonshot key and lists "
            "the model, for development use; the structure-edit and periodic-energy "
            "proposal profiles are enabled under development eligibility, not yet "
            "hosted-verified; "
            "single-sample evidence, and Tier0 allows 3 requests a minute until $10 of "
            "cumulative paid recharge.",
            "Direct provider terms, privacy and pricing require review before activation.",
        ),
        development_profiles=(
            "PYSCF_ENERGY_PROPOSAL",
            "STRUCTURE_EDIT_PROPOSAL",
            "PERIODIC_ENERGY_PROPOSAL",
        ),
        development_evidence=(
            "AI-9 direct run 1, 2026-10-18, real service, one request per molecule: water gave a "
            "first-attempt proposal matching all six named parameters; H2 was refused by "
            "validation (no repair allowed in that run); ethanol hit HTTP 429 (Moonshot Tier0). "
            "Approvals pending, nothing computed.",
            "AI-9 paced follow-up, 2026-10-18: H2 and ethanol each gave a first-attempt proposal "
            "matching all six named parameters (9.0 s and 9.4 s); nothing approved or computed.",
            "AI-9 live browser run, 2026-10-18: selected in the browser's model switcher, one "
            "request each for H2 (HF/STO-3G) and water (HF/6-31G) through the real service gave "
            "first-attempt proposals matching all six named parameters (7.8 s each); both were "
            "inspected on the approval screen and rejected, and no compute job existed.",
            "Single samples at Moonshot's fixed sampling with reasoning effort low: "
            "repeatability, scientific correctness and browser behaviour on the real endpoint "
            "are not established.",
        ),
    ),
    ModelDefinition(
        "moonshot",
        "kimi-k2.6",
        "Kimi K2.6 (Moonshot)",
        "AVAILABLE",
        ("Text", "Tool calling", "Reasoning", "Streaming"),
        "256K (published)",
        (
            "https://platform.kimi.ai/docs/guide/kimi-k2-6-quickstart",
            "https://platform.kimi.ai/docs/pricing/chat-k26",
        ),
        (
            "Direct Moonshot API with a reviewed request shape (thinking disabled, sampling "
            "fixed by Moonshot and never sent); routed only when the server has a Moonshot key "
            "and lists the model, and offered only with registry evidence.",
            "Direct Moonshot API: offered only on a server that holds a Moonshot key and lists "
            "the model, for development use; the structure-edit and periodic-energy "
            "proposal profiles are enabled under development eligibility, not yet "
            "hosted-verified; "
            "single-sample evidence, and Tier0 allows 3 requests a minute until $10 of "
            "cumulative paid recharge.",
            "Direct provider terms, privacy and pricing require review before activation.",
        ),
        development_profiles=(
            "PYSCF_ENERGY_PROPOSAL",
            "STRUCTURE_EDIT_PROPOSAL",
            "PERIODIC_ENERGY_PROPOSAL",
        ),
        development_evidence=(
            "AI-9 direct run 1, 2026-10-18, real service, one request per molecule: H2 and "
            "ethanol gave first-attempt proposals matching all six named parameters; water began "
            "with a legitimate structure lookup and ended at that run's one-call limit.",
            "AI-9 paced follow-up, 2026-10-18: water gave a first-attempt proposal matching all "
            "six named parameters (3.6 s); nothing approved or computed.",
            "AI-9 live browser run, 2026-10-18: selected in the browser's model switcher, one "
            "request each for H2 (HF/STO-3G) and water (HF/6-31G) through the real service gave "
            "first-attempt proposals matching all six named parameters (3.7 s and 4.1 s); both "
            "were inspected on the approval screen and rejected, and no compute job existed.",
            "Single samples at Moonshot's fixed sampling with thinking disabled: repeatability, "
            "scientific correctness and browser behaviour on the real endpoint are not "
            "established.",
        ),
    ),
)


def development_models(settings) -> frozenset[str]:
    """Models the operator explicitly enabled for development/test use (empty by default)."""
    raw = getattr(settings, "ai_development_models", "") or ""
    return frozenset(part.strip() for part in raw.split(",") if part.strip())


def moonshot_models(settings) -> frozenset[str]:
    """Moonshot models the operator listed for this server (empty by default)."""
    raw = getattr(settings, "moonshot_models", "") or ""
    return frozenset(part.strip() for part in raw.split(",") if part.strip())


def moonshot_route_configured(settings) -> bool:
    """A Moonshot key and an operator list exist and the integration switch is on."""
    return bool(
        getattr(settings, "moonshot_api_key", None)
        and moonshot_models(settings)
        and settings.run_ai_integration
    )


def loopback_host(base_url: str) -> bool:
    from urllib.parse import urlsplit

    host = urlsplit(base_url).hostname or ""
    return host in {"127.0.0.1", "localhost", "::1"}


def nvidia_route_configured(settings) -> bool:
    """True only for the exact NVIDIA endpoint (or, in the isolated test environment, loopback).

    The loopback allowance exists for disposable browser tests that stand a local stand-in behind
    the real HTTP gateway; it is inert in every other environment, so a production configuration
    can never present a different host as NVIDIA.
    """
    if settings.ai_provider != "nvidia":
        return False
    base = (settings.ai_api_base_url or NVIDIA_BASE).rstrip("/")
    return base == NVIDIA_BASE or (settings.environment == "test" and loopback_host(base))


def model_catalogue(settings) -> tuple[AIModelCapability, ...]:
    configured_models = {
        settings.ai_model_fast,
        settings.ai_model_standard,
        settings.ai_model_reasoning,
    }
    nvidia_route = nvidia_route_configured(settings)
    moonshot_route = moonshot_route_configured(settings)
    enabled_for_development = development_models(settings)
    enabled_moonshot = moonshot_models(settings)
    rows = []
    for definition in DEFINITIONS:
        configured = (
            nvidia_route
            and definition.provider == "nvidia"
            and (definition.model in configured_models)
        ) or (
            moonshot_route
            and definition.provider == "moonshot"
            and definition.model in moonshot_models(settings)
        )
        standard = (
            configured
            and definition.tool_verified
            and (definition.availability == "AVAILABLE" and definition.adapter_supported)
        )
        # Development eligibility needs the operator's explicit opt-in AND registry evidence; it
        # is never inferred, never a default and never a substitute for tool verification.
        development = (
            not standard
            and configured
            and bool(definition.development_profiles)
            and definition.model
            in (enabled_moonshot if definition.provider == "moonshot" else enabled_for_development)
            and definition.availability == "AVAILABLE"
            and definition.adapter_supported
        )
        selectable = standard or development
        eligibility = "STANDARD" if standard else "DEVELOPMENT" if development else "NONE"
        status = (
            "UNSUPPORTED"
            if not definition.adapter_supported
            else "UNAVAILABLE"
            if definition.availability == "DEPRECATED"
            else "LIVE-VERIFIED"
            if standard
            else "CONFIGURED"
            if configured
            else "DOCUMENTED"
        )
        reasons = []
        if not definition.adapter_supported:
            reasons.append("ChemDFT has no adapter for this direct provider endpoint.")
        if definition.availability == "DEPRECATED":
            reasons.append("The published endpoint is deprecated.")
        elif definition.availability == "UNKNOWN":
            reasons.append("Endpoint availability is unknown; the registry has no evidence.")
        if definition.provider == "nvidia" and not nvidia_route:
            reasons.append("This server is not configured for the NVIDIA endpoint.")
        elif definition.provider == "moonshot" and not moonshot_route:
            reasons.append("This server is not configured for the Moonshot endpoint.")
        elif not configured and definition.adapter_supported:
            reasons.append("Not configured as a fast, standard or reasoning model on this server.")
        if not definition.tool_verified and definition.adapter_supported:
            reasons.append("Tool calling is not verified against ChemDFT's adapter.")
        if definition.development_profiles and not development and not standard:
            reasons.append("Development eligibility is not enabled for this model on this server.")
        row = AIModelCapability(
            provider=definition.provider,
            model_identifier=definition.model,
            display_name=definition.name,
            status=status,
            endpoint=(
                NVIDIA_BASE if definition.provider == "nvidia" else "https://api.moonshot.ai/v1"
            )
            + "/chat/completions",
            endpoint_availability=definition.availability,
            documented_capabilities=definition.capabilities,
            published_context=definition.context,
            configuration_requirements=COMMON_REQUIREMENTS,
            configured=configured,
            selectable=selectable,
            tool_compatibility_verified=definition.tool_verified and nvidia_route,
            eligibility=eligibility,
            development_evidence=definition.development_evidence if development else (),
            verification_scope=(
                "Development eligibility only: dated hosted evidence is listed under "
                "development evidence; not tool-verified, not a COMPATIBLE label"
                if development
                else "2026-10-16 historical tool selection/structure read; "
                "not proposal acceptance or SLA"
                if definition.tool_verified and nvidia_route
                else "No live ChemDFT verification"
            ),
            limitations=definition.limitations
            + (
                (
                    "Development eligibility: normal selection needs repeated, multi-molecule "
                    "hosted acceptance recorded in the registry; this is not that.",
                )
                if development
                else ()
            )
            + ((TRIAL_LIMITATION,) if definition.provider == "nvidia" else ())
            + ("Rate limit, current account entitlement and cost are UNKNOWN.",),
            source_urls=definition.sources,
            reviewed_on="2026-10-16",
            unselectable_reason=None if selectable else " ".join(reasons) or None,
        )
        rows.append(
            row.model_copy(
                update={
                    "planning_profiles": definition.development_profiles
                    if development
                    else tuple(
                        profile
                        for profile in PROFILE_REQUIREMENTS
                        if profile_ineligibility(row, profile) is None
                    )
                }
            )
        )
    return tuple(rows)


def selectable_models(settings, provider: str) -> frozenset[str]:
    return frozenset(
        row.model_identifier
        for row in model_catalogue(settings)
        if row.selectable and row.provider == provider
    )


def selectable_nvidia_models(settings) -> frozenset[str]:
    return selectable_models(settings, "nvidia")


def model_eligibility(settings, provider: str, model: str) -> str | None:
    """STANDARD, DEVELOPMENT or NONE for a registry row; None when the registry has no row."""
    row = next(
        (
            r
            for r in model_catalogue(settings)
            if r.provider == provider and r.model_identifier == model
        ),
        None,
    )
    return row.eligibility if row is not None else None


# Documented direct-answer switch (reasoning off) for models whose provider model card states one.
# NVIDIA catalog page for nemotron-3.5-lightning, read 2026-10-28: "Configurable on/off via chat
# template (enable_thinking=True/False)"; thinking is on by default, and False gives direct answers.
# Without it every call spent ~1.5-2k hidden reasoning tokens and hit the evidence output cap.
DIRECT_ANSWER_KWARGS: dict[tuple[str, str], tuple[tuple[str, bool], ...]] = {
    ("nvidia", LIGHTNING): (("enable_thinking", False),),
}


def direct_answer_kwargs(provider: str, model: str) -> tuple[tuple[str, bool], ...] | None:
    return DIRECT_ANSWER_KWARGS.get((provider, model))


def service_sampling_profile(settings, provider: str, model: str) -> SamplingProfile | None:
    """Documented sampling for a service request, only for a development-eligible NVIDIA model.

    Every other model keeps the gateway default (temperature 0, no top_p, no reasoning field), so
    production behaviour changes only where an operator opted a specific model into the
    development path and the registry holds hosted evidence gathered with exactly this profile.
    """
    if provider != "nvidia":
        return None
    row = next(
        (
            r
            for r in model_catalogue(settings)
            if r.provider == provider and r.model_identifier == model
        ),
        None,
    )
    if row is None or row.eligibility != "DEVELOPMENT":
        return None
    return SAMPLING_PROFILES.get(model)
