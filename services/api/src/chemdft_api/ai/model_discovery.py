"""NVIDIA model discovery catalogue: what was LISTED, never what is usable.

Every row records an identifier that NVIDIA publishes and nothing the model can do. There is no
capability field here on purpose: capabilities, tool calling and selectability come only from the
reviewed rows in model_catalog.DEFINITIONS (plus ChemDFT's own adapter verification), so adding a
model to this catalogue cannot make it selectable.

Sources and what they do not prove:

* PUBLIC_MODEL_LIST - the unauthenticated GET {NVIDIA_BASE}/models listing captured on
  LISTING_CAPTURED_ON. It is not account-specific: it does not show quota, trial credits, billing
  or entitlement.
* DOCS_INDEX - NVIDIA's API reference index. A name there is documentation, not proof that the
  chat-completions endpoint serves it (many docs-only names are absent from the public listing).

Category is a coarse filing label taken from the docs section or, failing that, from the identifier.
UNCLASSIFIED means neither said anything. A hint is not a capability claim.

State vocabulary and evidence rules: a state in EVIDENCE_REQUIRED_STATES cannot be constructed
without at least one evidence reference. FREE_ACCESS_VERIFIED means, narrowly: NVIDIA's own model
catalogue labels the endpoint a "Free Endpoint" (nim_type_preview) AND the owner's account shows
rate-limited trial access (see FREE_ENDPOINT_EVIDENCE). It is policy-level evidence, not a billing
guarantee, and it is not ACCESSIBLE: only a successful call (or an authenticated model list) proves
the key can use a model. Everything not labelled free stays COST_UNVERIFIED (or UNAVAILABLE where
the reviewed registry already records the endpoint as deprecated) and is never called.
"""

from dataclasses import dataclass
from enum import StrEnum

from .model_catalog import DEFINITIONS, NVIDIA_BASE, SAMPLING_PROFILES

LISTING_URL = f"{NVIDIA_BASE}/models"
LISTING_CAPTURED_ON = "2026-10-17"
DOCS_INDEX_URL = "https://docs.api.nvidia.com/nim/reference"
FREE_ENDPOINT_CAPTURED_ON = "2026-10-17"
FREE_ENDPOINT_EVIDENCE = (
    "build.nvidia.com/models?filters=nimType:nim_type_preview: 'Free Endpoint' label, "
    "39 models, captured 2026-10-17",
    "docs.api.nvidia.com/nim/docs/product: Developer Program members have free access to NIM API "
    "endpoints for prototyping (fetched 2026-10-17)",
    "owner account evidence 2026-10-17: signed in to build.nvidia.com, API key ACTIVE, "
    "'Your API Rate Limit: Up to 40 rpm' (screenshots supplied in chat)",
)
PROBE_RUN_EVIDENCE = (
    "tools/nvidia_probe run 1, 2026-10-17T19:02:21Z, authorization sha256 7936b0dd..., "
    "report sha256 551bea5dc68c51fd8df5ca654f3f1998a6b51bb13687b1aa5d9f4ee91e72bb57: "
    "17 of 27 planned calls sent, stopped by MODEL_IDENTITY_MISMATCH, no retries",
    "tools/nvidia_probe run 2, 2026-10-17T19:17:23Z, authorization sha256 5bceb593..., "
    "report sha256 dcb34e91c37c7ef1c37a5cf0e92ab636cea762bcd3cf990a572d4622599a78ee: "
    "5 of 5 planned calls sent, completed, no retries",
    "tools/nvidia_probe run 3 (AI-5 retest, option A), 2026-10-17T20:31:12Z, authorization sha256 "
    "72799f6a..., report sha256 "
    "06df9fdd96dba3702533394aa3f52299286777f7d1124d56dc9ab8b127875526: 2 of 2 planned calls sent, "
    "completed, no retries",
    "tools/nvidia_probe run 4 (AI-5 retest, option B), 2026-10-17T20:40:10Z, authorization sha256 "
    "072e090b..., report sha256 "
    "f5a553326966411bfad5beaf2871a6b8bfcd79af9d3f8daece1ecc94584faaa7: 4 of 4 planned calls sent, "
    "completed, no retries",
    "tools/nvidia_probe production-flow run 5 (AI-5, the real AI Scientist service, model-card "
    "sampling), 2026-10-17T21:34Z, authorization sha256 ee9bd449..., report sha256 "
    "d2dba187e6f5b1c280284cc3ee82684909e67530239392b7e1a8d97ced10fd5d: 2 of 6 authorized requests "
    "sent (one per model; each flow ended after its first reply), completed, no retries; nothing "
    "approved or computed",
    "tools/nvidia_probe production-flow run 6 (AI-6, the real AI Scientist service with request "
    "matching, model-card sampling), 2026-10-18T02:52Z, authorization sha256 edf618b0..., report "
    "sha256 2e5e7a9b600d9540de38b10d1b504129140d610ab65a3155ae225d73f512ae80: 2 of 6 authorized "
    "requests sent (one per model; each flow ended after its first reply), completed, no "
    "retries; nothing approved or computed",
    "tools/nvidia_probe reference-cases flow run 7 (AI-6, the real AI Scientist service with "
    "request matching, model-card sampling; water h2o-pbe-def2svp and ethanol "
    "ethanol-b3lyp-631g), 2026-10-18T06:33Z, authorization sha256 097b1e22..., report sha256 "
    "1a5ac36c2630bf156e7c5829fd430a5ab88e60014e136de5d46fd8a5dfa7e6be: 4 of 6 authorized "
    "requests sent (one per model and case; each flow ended after its first reply), completed, "
    "no retries; nothing approved or computed",
)
# Identifiers (API spelling from the public listing) of catalogue rows whose build.nvidia.com card
# carries the "Free Endpoint" label. The site's slugs differ in punctuation (glm-5-3 vs glm-5.3);
# they were matched on letters and digits only.
FREE_ENDPOINT_LABELLED = frozenset(
    {
        "deepseek-ai/deepseek-v4.1-flash",
        "google/diffusiongemma-26b-a4b-it",
        "google/gemma-4-31b-it",
        "meta/llama-3.2-11b-vision-instruct",
        "meta/llama-3.2-90b-vision-instruct",
        "meta/llama-guard-4-12b",
        "meta/muse-glimmer-30b",
        "nvidia/ising-calibration-1.5-31b",
        "nvidia/llama-3.1-nemotron-safety-guard-8b-v3",
        "nvidia/nemotron-3-embed-1b",
        "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
        "nvidia/nemotron-3-super-120b-a12b",
        "nvidia/nemotron-3-ultra-550b-a55b",
        "nvidia/nemotron-3.5-content-safety",
        "nvidia/nemotron-3.5-lightning-30b-a3b",
        "nvidia/nemotron-3.5-super-vl-120b-a12b",
        "nvidia/riva-translate-4b-instruct-v2",
        "openai/gpt-oss-20b",
        "poolside/laguna-xs-2.1",
        "stepfun-ai/step-5-preview",
        "z-ai/glm-5.3",
        "z-ai/glm-5.3-flash",
    }
)
# The other free-labelled cards (vision, video, speech, driving, tabular) are not catalogue rows.
FREE_ENDPOINT_NOT_CATALOGUED = (
    "google/google-paligemma",
    "nvidia/active-speaker-detection",
    "nvidia/bevformer",
    "nvidia/bnr",
    "nvidia/body-pose",
    "nvidia/cosmos-transfer2_5-2b",
    "nvidia/cosmos3-nano",
    "nvidia/cosmos3-nano-reasoner",
    "nvidia/ising-calibration-1-35b-a3b",
    "nvidia/kumo-relational",
    "nvidia/kumo-tabular",
    "nvidia/magpie-tts-zeroshot",
    "nvidia/nemotron-voicechat",
    "nvidia/sparsedrive",
    "nvidia/streampetr",
    "nvidia/studiovoice",
    "nvidia/synthetic-video-detector",
)


class DiscoveryState(StrEnum):
    DISCOVERED = "DISCOVERED"
    FREE_ACCESS_VERIFIED = "FREE ACCESS VERIFIED"
    ACCESSIBLE = "ACCESSIBLE"
    TESTED = "TESTED"
    COMPATIBLE = "COMPATIBLE"
    INCOMPATIBLE = "INCOMPATIBLE"
    UNAVAILABLE = "UNAVAILABLE"
    COST_UNVERIFIED = "COST UNVERIFIED"


EVIDENCE_REQUIRED_STATES = frozenset(
    {
        DiscoveryState.FREE_ACCESS_VERIFIED,
        DiscoveryState.ACCESSIBLE,
        DiscoveryState.TESTED,
        DiscoveryState.COMPATIBLE,
        DiscoveryState.INCOMPATIBLE,
    }
)


class DiscoverySource(StrEnum):
    PUBLIC_MODEL_LIST = "PUBLIC_MODEL_LIST"
    DOCS_INDEX = "DOCS_INDEX"


class DiscoveryCategory(StrEnum):
    LANGUAGE = "LANGUAGE"
    CODING = "CODING"
    MULTIMODAL = "MULTIMODAL"
    DOCUMENT_PARSING = "DOCUMENT_PARSING"
    RETRIEVAL = "RETRIEVAL"
    SAFETY_GUARD = "SAFETY_GUARD"
    MOLECULAR_BIOLOGY = "MOLECULAR_BIOLOGY"
    UNCLASSIFIED = "UNCLASSIFIED"


class CategoryBasis(StrEnum):
    DOCS_INDEX_SECTION = "DOCS_INDEX_SECTION"
    IDENTIFIER_HINT = "IDENTIFIER_HINT"
    NONE = "NONE"


class Blocker(StrEnum):
    NO_ACCOUNT_COST_EVIDENCE = "NO_ACCOUNT_COST_EVIDENCE"
    NOT_IN_PUBLIC_MODEL_LIST = "NOT_IN_PUBLIC_MODEL_LIST"
    NO_ADAPTER = "NO_ADAPTER"  # a non-chat endpoint family ChemDFT has no adapter for
    NO_SAMPLING_PROFILE = "NO_SAMPLING_PROFILE"  # no reviewed model-card profile: not probeable
    TOOL_CALLING_NOT_VERIFIED = "TOOL_CALLING_NOT_VERIFIED"
    REGISTRY_DEPRECATED = "REGISTRY_DEPRECATED"


NON_CHAT_CATEGORIES = frozenset(
    {
        DiscoveryCategory.MOLECULAR_BIOLOGY,
        DiscoveryCategory.RETRIEVAL,
        DiscoveryCategory.DOCUMENT_PARSING,
    }
)

_SOURCES = {
    "P": (DiscoverySource.PUBLIC_MODEL_LIST,),
    "D": (DiscoverySource.DOCS_INDEX,),
    "PD": (DiscoverySource.PUBLIC_MODEL_LIST, DiscoverySource.DOCS_INDEX),
}

# (identifier, category, category basis, sources). Identifiers from the docs index are the index's
# own spelling with provider spaces removed; only PUBLIC_MODEL_LIST rows are confirmed spellings.
_ROWS = (
    ("01-ai/yi-large", "LANGUAGE", "IDENTIFIER_HINT", "P"),
    ("adept/fuyu-8b", "MULTIMODAL", "IDENTIFIER_HINT", "PD"),
    ("ai21labs/jamba-1.5-large-instruct", "LANGUAGE", "IDENTIFIER_HINT", "P"),
    ("aisingapore/sea-lion-7b-instruct", "LANGUAGE", "IDENTIFIER_HINT", "P"),
    ("arc/evo2-40b", "MOLECULAR_BIOLOGY", "DOCS_INDEX_SECTION", "D"),
    ("arc/evo2-7b-forward", "MOLECULAR_BIOLOGY", "DOCS_INDEX_SECTION", "D"),
    ("baai/bge-m3", "RETRIEVAL", "DOCS_INDEX_SECTION", "D"),
    ("bigcode/starcoder2-15b", "CODING", "IDENTIFIER_HINT", "P"),
    ("colabfold/msa-search", "MOLECULAR_BIOLOGY", "DOCS_INDEX_SECTION", "D"),
    ("databricks/dbrx-instruct", "LANGUAGE", "IDENTIFIER_HINT", "P"),
    ("deepmind/alphafold2", "MOLECULAR_BIOLOGY", "DOCS_INDEX_SECTION", "D"),
    ("deepmind/alphafold2-multimer", "MOLECULAR_BIOLOGY", "DOCS_INDEX_SECTION", "D"),
    ("deepseek-ai/deepseek-coder-6.7b-instruct", "CODING", "IDENTIFIER_HINT", "P"),
    ("deepseek-ai/deepseek-v4-flash", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("deepseek-ai/deepseek-v4-flash-0731", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("deepseek-ai/deepseek-v4-pro", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("deepseek-ai/deepseek-v4.1-flash", "LANGUAGE", "IDENTIFIER_HINT", "P"),
    ("google/codegemma-1.1-7b", "CODING", "IDENTIFIER_HINT", "P"),
    ("google/codegemma-7b", "CODING", "IDENTIFIER_HINT", "PD"),
    ("google/deplot", "MULTIMODAL", "IDENTIFIER_HINT", "P"),
    ("google/diffusiongemma-26b-a4b-it", "MULTIMODAL", "DOCS_INDEX_SECTION", "PD"),
    ("google/gemma-2b", "LANGUAGE", "IDENTIFIER_HINT", "P"),
    ("google/gemma-3-12b-it", "LANGUAGE", "IDENTIFIER_HINT", "P"),
    ("google/gemma-3-27b-it", "MULTIMODAL", "DOCS_INDEX_SECTION", "D"),
    ("google/gemma-3-4b-it", "LANGUAGE", "IDENTIFIER_HINT", "P"),
    ("google/gemma-3n-e4b-it", "MULTIMODAL", "DOCS_INDEX_SECTION", "D"),
    ("google/gemma-4-31b-it", "MULTIMODAL", "DOCS_INDEX_SECTION", "PD"),
    ("google/gemma-7b", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("google/paligemma", "MULTIMODAL", "IDENTIFIER_HINT", "D"),
    ("google/recurrentgemma-2b", "LANGUAGE", "IDENTIFIER_HINT", "P"),
    ("ibm/granite-3.0-3b-a800m-instruct", "LANGUAGE", "IDENTIFIER_HINT", "P"),
    ("ibm/granite-3.0-8b-instruct", "LANGUAGE", "IDENTIFIER_HINT", "P"),
    ("ibm/granite-34b-code-instruct", "CODING", "IDENTIFIER_HINT", "P"),
    ("ibm/granite-8b-code-instruct", "CODING", "IDENTIFIER_HINT", "P"),
    ("ipd/proteinmpnn", "MOLECULAR_BIOLOGY", "DOCS_INDEX_SECTION", "D"),
    ("ipd/rfdiffusion", "MOLECULAR_BIOLOGY", "DOCS_INDEX_SECTION", "D"),
    ("meta/codellama-70b", "CODING", "IDENTIFIER_HINT", "P"),
    ("meta/llama-3.1-70b-instruct", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("meta/llama-3.1-8b-instruct", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("meta/llama-3.2-11b-vision-instruct", "MULTIMODAL", "IDENTIFIER_HINT", "PD"),
    ("meta/llama-3.2-1b-instruct", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("meta/llama-3.2-3b-instruct", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("meta/llama-3.2-90b-vision-instruct", "MULTIMODAL", "IDENTIFIER_HINT", "PD"),
    ("meta/llama-3.3-70b-instruct", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("meta/llama-guard-4-12b", "SAFETY_GUARD", "IDENTIFIER_HINT", "PD"),
    ("meta/llama2-70b", "LANGUAGE", "DOCS_INDEX_SECTION", "PD"),
    ("meta/muse-glimmer-30b", "MULTIMODAL", "DOCS_INDEX_SECTION", "PD"),
    ("microsoft/kosmos-2", "MULTIMODAL", "IDENTIFIER_HINT", "P"),
    ("microsoft/phi-3-vision-128k-instruct", "MULTIMODAL", "IDENTIFIER_HINT", "P"),
    ("microsoft/phi-3.5-moe-instruct", "LANGUAGE", "IDENTIFIER_HINT", "P"),
    ("microsoft/phi-4-mini-flash-reasoning", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("microsoft/phi-4-mini-instruct", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("microsoft/phi-4-multimodal-instruct", "MULTIMODAL", "IDENTIFIER_HINT", "D"),
    ("minimaxai/minimax-m2.5", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("minimaxai/minimax-m2.7", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("minimaxai/minimax-m3", "MULTIMODAL", "DOCS_INDEX_SECTION", "D"),
    ("mistralai/codestral-22b-instruct-v0.1", "CODING", "IDENTIFIER_HINT", "P"),
    ("mistralai/ministral-14b-instruct-2512", "MULTIMODAL", "DOCS_INDEX_SECTION", "D"),
    ("mistralai/mistral-7b-instruct-v0.3", "MULTIMODAL", "DOCS_INDEX_SECTION", "PD"),
    ("mistralai/mistral-large", "LANGUAGE", "IDENTIFIER_HINT", "P"),
    ("mistralai/mistral-large-2-instruct", "LANGUAGE", "IDENTIFIER_HINT", "P"),
    ("mistralai/mistral-large-3-675b-instruct-2512", "MULTIMODAL", "DOCS_INDEX_SECTION", "D"),
    ("mistralai/mistral-medium-3-5-128b", "MULTIMODAL", "DOCS_INDEX_SECTION", "D"),
    ("mistralai/mistral-small-4-119b-2603", "MULTIMODAL", "DOCS_INDEX_SECTION", "D"),
    ("mistralai/mixtral-8x22b-instruct", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("mistralai/mixtral-8x22b-v0.1", "LANGUAGE", "IDENTIFIER_HINT", "P"),
    ("mistralai/mixtral-8x7b-instruct", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("mit/boltz2", "MOLECULAR_BIOLOGY", "DOCS_INDEX_SECTION", "D"),
    ("mit/diffdock", "MOLECULAR_BIOLOGY", "DOCS_INDEX_SECTION", "D"),
    ("moonshotai/kimi-k2-instruct", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("moonshotai/kimi-k2-thinking", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("moonshotai/kimi-k2.5", "MULTIMODAL", "DOCS_INDEX_SECTION", "D"),
    ("moonshotai/kimi-k2.6", "MULTIMODAL", "DOCS_INDEX_SECTION", "PD"),
    ("moonshotai/kimi-k3", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("nv-mistralai/mistral-nemo-12b-instruct", "LANGUAGE", "IDENTIFIER_HINT", "P"),
    ("nvidia/ai-synthetic-video-detector", "UNCLASSIFIED", "NONE", "P"),
    ("nvidia/cosmos-reason2-8b", "UNCLASSIFIED", "NONE", "P"),
    ("nvidia/deepseek-v4.1-flash", "MULTIMODAL", "DOCS_INDEX_SECTION", "D"),
    ("nvidia/embed-qa-4", "RETRIEVAL", "IDENTIFIER_HINT", "PD"),
    ("nvidia/genmol", "MOLECULAR_BIOLOGY", "DOCS_INDEX_SECTION", "D"),
    ("nvidia/gliner-pii", "SAFETY_GUARD", "IDENTIFIER_HINT", "D"),
    ("nvidia/ising-calibration-1.5-31b", "MULTIMODAL", "DOCS_INDEX_SECTION", "PD"),
    ("nvidia/llama-3.1-nemoguard-8b-content-safety", "SAFETY_GUARD", "IDENTIFIER_HINT", "PD"),
    ("nvidia/llama-3.1-nemoguard-8b-topic-control", "SAFETY_GUARD", "IDENTIFIER_HINT", "PD"),
    ("nvidia/llama-3.1-nemotron-51b-instruct", "LANGUAGE", "IDENTIFIER_HINT", "P"),
    ("nvidia/llama-3.1-nemotron-70b-instruct", "LANGUAGE", "IDENTIFIER_HINT", "P"),
    ("nvidia/llama-3.1-nemotron-safety-guard-8b-v3", "SAFETY_GUARD", "IDENTIFIER_HINT", "PD"),
    ("nvidia/llama-3.1-nemotron-ultra-253b-v1", "LANGUAGE", "DOCS_INDEX_SECTION", "PD"),
    ("nvidia/llama-3.2-nemoretriever-1b-vlm-embed-v1", "RETRIEVAL", "IDENTIFIER_HINT", "PD"),
    ("nvidia/llama-3.2-nemoretriever-300m-embed-v2", "RETRIEVAL", "IDENTIFIER_HINT", "D"),
    ("nvidia/llama-3.2-nemoretriever-500m-rerank-v2", "RETRIEVAL", "IDENTIFIER_HINT", "D"),
    ("nvidia/llama-3.2-nv-embedqa-1b-v1", "RETRIEVAL", "IDENTIFIER_HINT", "PD"),
    ("nvidia/llama-3.2-nv-embedqa-1b-v2", "RETRIEVAL", "IDENTIFIER_HINT", "D"),
    ("nvidia/llama-3.2-nv-rerankqa-1b-v1", "RETRIEVAL", "IDENTIFIER_HINT", "D"),
    ("nvidia/llama-3.2-nv-rerankqa-1b-v2", "RETRIEVAL", "IDENTIFIER_HINT", "D"),
    ("nvidia/llama-3.3-nemotron-super-49b-v1", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("nvidia/llama-3.3-nemotron-super-49b-v1.5", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("nvidia/llama-nemotron-embed-1b-v2", "RETRIEVAL", "IDENTIFIER_HINT", "D"),
    ("nvidia/llama-nemotron-embed-vl-1b-v2", "RETRIEVAL", "IDENTIFIER_HINT", "PD"),
    ("nvidia/llama-nemotron-rerank-1b-v2", "RETRIEVAL", "IDENTIFIER_HINT", "D"),
    ("nvidia/llama-nemotron-rerank-vl-1b-v2", "RETRIEVAL", "IDENTIFIER_HINT", "D"),
    ("nvidia/llama3-chatqa-1.5-70b", "LANGUAGE", "IDENTIFIER_HINT", "P"),
    ("nvidia/mistral-nemo-minitron-8b-8k-instruct", "LANGUAGE", "IDENTIFIER_HINT", "P"),
    ("nvidia/molmim", "MOLECULAR_BIOLOGY", "DOCS_INDEX_SECTION", "D"),
    ("nvidia/nemoguard-jailbreak-detect", "SAFETY_GUARD", "IDENTIFIER_HINT", "D"),
    ("nvidia/nemoretriever-parse", "DOCUMENT_PARSING", "IDENTIFIER_HINT", "D"),
    ("nvidia/nemotron-3-content-safety", "SAFETY_GUARD", "IDENTIFIER_HINT", "D"),
    ("nvidia/nemotron-3-embed-1b", "RETRIEVAL", "IDENTIFIER_HINT", "PD"),
    ("nvidia/nemotron-3-nano-30b-a3b", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", "MULTIMODAL", "IDENTIFIER_HINT", "PD"),
    ("nvidia/nemotron-3-super-120b-a12b", "LANGUAGE", "DOCS_INDEX_SECTION", "PD"),
    ("nvidia/nemotron-3-ultra-550b-a55b", "LANGUAGE", "DOCS_INDEX_SECTION", "PD"),
    ("nvidia/nemotron-3.5-content-safety", "SAFETY_GUARD", "IDENTIFIER_HINT", "PD"),
    ("nvidia/nemotron-3.5-lightning-30b-a3b", "LANGUAGE", "DOCS_INDEX_SECTION", "PD"),
    ("nvidia/nemotron-3.5-super-vl-120b-a12b", "MULTIMODAL", "IDENTIFIER_HINT", "PD"),
    ("nvidia/nemotron-4-340b-instruct", "LANGUAGE", "IDENTIFIER_HINT", "P"),
    ("nvidia/nemotron-4-340b-reward", "SAFETY_GUARD", "IDENTIFIER_HINT", "P"),
    ("nvidia/nemotron-content-safety-reasoning-4b", "SAFETY_GUARD", "IDENTIFIER_HINT", "D"),
    ("nvidia/nemotron-nano-12b-v2-vl", "MULTIMODAL", "IDENTIFIER_HINT", "D"),
    ("nvidia/nemotron-nano-3-30b-a3b", "LANGUAGE", "IDENTIFIER_HINT", "P"),
    ("nvidia/nemotron-nano-9b-v2", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("nvidia/nemotron-parse", "DOCUMENT_PARSING", "IDENTIFIER_HINT", "PD"),
    ("nvidia/nemotron-parse-2.0", "DOCUMENT_PARSING", "IDENTIFIER_HINT", "PD"),
    ("nvidia/neva-22b", "MULTIMODAL", "IDENTIFIER_HINT", "PD"),
    ("nvidia/nv-embedqa-e5-v5", "RETRIEVAL", "IDENTIFIER_HINT", "D"),
    ("nvidia/nv-embedqa-mistral-7b-v2", "RETRIEVAL", "IDENTIFIER_HINT", "P"),
    ("nvidia/nv-rerankqa-mistral-4b-v3", "RETRIEVAL", "IDENTIFIER_HINT", "D"),
    ("nvidia/nvclip", "RETRIEVAL", "IDENTIFIER_HINT", "PD"),
    ("nvidia/riva-translate-4b-instruct", "LANGUAGE", "IDENTIFIER_HINT", "P"),
    ("nvidia/riva-translate-4b-instruct-v2", "LANGUAGE", "DOCS_INDEX_SECTION", "PD"),
    ("nvidia/vila", "MULTIMODAL", "IDENTIFIER_HINT", "PD"),
    ("openai/gpt-oss-120b", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("openai/gpt-oss-20b", "LANGUAGE", "DOCS_INDEX_SECTION", "PD"),
    ("openfold/openfold2", "MOLECULAR_BIOLOGY", "DOCS_INDEX_SECTION", "D"),
    ("openfold/openfold3", "MOLECULAR_BIOLOGY", "DOCS_INDEX_SECTION", "D"),
    ("poolside/laguna-xs-2.1", "LANGUAGE", "DOCS_INDEX_SECTION", "PD"),
    ("qwen/qwen2.5-coder-32b-instruct", "CODING", "IDENTIFIER_HINT", "D"),
    ("qwen/qwen3-next-80b-a3b-instruct", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("qwen/qwen3-next-80b-a3b-thinking", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("qwen/qwen3.5-122b-a10b", "MULTIMODAL", "DOCS_INDEX_SECTION", "D"),
    ("qwen/qwq-32b", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("sarvamai/sarvam-m", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("snowflake/arctic-embed-l", "RETRIEVAL", "IDENTIFIER_HINT", "PD"),
    ("stepfun-ai/step-3.5-flash", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("stepfun-ai/step-3.7-flash", "MULTIMODAL", "DOCS_INDEX_SECTION", "D"),
    ("stepfun-ai/step-5-preview", "MULTIMODAL", "DOCS_INDEX_SECTION", "PD"),
    ("stockmark/stockmark-2-100b-instruct", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("thinkingmachines/inkling", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("upstage/solar-10.7b-instruct", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("writer/palmyra-creative-122b", "LANGUAGE", "IDENTIFIER_HINT", "P"),
    ("writer/palmyra-fin-70b-32k", "LANGUAGE", "IDENTIFIER_HINT", "P"),
    ("writer/palmyra-med-70b", "LANGUAGE", "IDENTIFIER_HINT", "P"),
    ("writer/palmyra-med-70b-32k", "LANGUAGE", "IDENTIFIER_HINT", "P"),
    ("z-ai/glm-5.2", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("z-ai/glm-5.3", "LANGUAGE", "DOCS_INDEX_SECTION", "PD"),
    ("z-ai/glm-5.3-flash", "LANGUAGE", "DOCS_INDEX_SECTION", "PD"),
    ("z-ai/glm4.7", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("z-ai/glm5.1", "LANGUAGE", "DOCS_INDEX_SECTION", "D"),
    ("zyphra/zamba2-7b-instruct", "LANGUAGE", "IDENTIFIER_HINT", "P"),
)

# Docs-index entries judged outside ChemDFT's scientific-assistant scope (image/video generation,
# autonomous driving, climate, routing, medical segmentation, tabular foundation models). Listed for
# transparency; they are not catalogue rows.
EXCLUDED_AS_OUT_OF_SCOPE = (
    "black-forest-labs/flux.1-kontext-dev",
    "black-forest-labs/flux.3-image-klein",
    "blackforestlabs/flux.1-dev",
    "blackforestlabs/flux.1-schnell",
    "blackforestlabs/flux.2-klein-4b",
    "hive/ai-generated-image-detection",
    "hive/deepfake-image-detection",
    "microsoft/trellis",
    "nvidia/bevformer",
    "nvidia/corrdiff",
    "nvidia/cosmos-predict1-7b",
    "nvidia/cuOpt",
    "nvidia/fourcastnet",
    "nvidia/kumo-relational",
    "nvidia/kumo-tabular",
    "nvidia/nv-dinov2",
    "nvidia/nv-grounding-dino",
    "nvidia/retail-object-detection",
    "nvidia/sparsedrive",
    "nvidia/streampetr",
    "nvidia/vista3d",
    "nvidia/visual-changenet",
    "stabilityai/stable-diffusion-3-medium",
    "stabilityai/stable-diffusion-xl",
    "stabilityai/stable-video-diffusion",
)

_TIMEOUT = (
    "Probe 2026-10-17: TEXT and TOOL requests both timed out at the 60 s read timeout (no "
    "retry); no usable response; PROPOSAL not run. Two single requests, not a failure rate."
)
# What the single authorized probe run actually observed (one request per case, temperature per
# the model-card profile). ACCESSIBLE = at least one successful response; TESTED = called but no
# usable response; INCOMPATIBLE = a required ChemDFT check failed in an observed request (a single
# request, not a rate). Nothing is COMPATIBLE: no model has yet produced a calculation proposal
# that passed even the strict check, and production acceptance of the strict failures is unknown.
PROBE_OBSERVED = {
    "nvidia/nemotron-3.5-lightning-30b-a3b": (DiscoveryState.TESTED, _TIMEOUT, (0,)),
    "deepseek-ai/deepseek-v4.1-flash": (DiscoveryState.TESTED, _TIMEOUT, (0,)),
    "google/gemma-4-31b-it": (DiscoveryState.TESTED, _TIMEOUT, (0,)),
    "nvidia/nemotron-3-ultra-550b-a55b": (
        DiscoveryState.TESTED,
        "Probe 2026-10-17: TEXT returned HTTP 503 and TOOL HTTP 500 within 0.7 s; no usable "
        "response; PROPOSAL not run.",
        (0,),
    ),
    "nvidia/nemotron-3.5-super-vl-120b-a12b": (
        DiscoveryState.INCOMPATIBLE,
        "Probe 2026-10-17: TEXT returned HTTP 500; the TOOL reply named response model "
        "'private/nvidia/nemotron-3.5-super-120b-a12b', not the requested id, so the probe's "
        "identity rule stopped the run.",
        (0,),
    ),
    "meta/muse-glimmer-30b": (
        DiscoveryState.ACCESSIBLE,
        "Probe 2026-10-17: TEXT ok in 23.4 s; TOOL ok in 14.9 s with a schema-valid "
        "structure.version.get. PROPOSAL timed out at the 60 s read timeout twice, so no "
        "proposal exists yet; it may need a longer read timeout (the probe's is fixed at 60 s).",
        (0, 1, 3),
    ),
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning": (
        DiscoveryState.ACCESSIBLE,
        "Probe 2026-10-17: TEXT ok 2.6 s; TOOL ok 5.8 s with a schema-valid "
        "structure.version.get. PROPOSAL returned HTTP 503 twice (0.4 s each), so no proposal "
        "exists yet; the smaller TEXT and TOOL requests were served.",
        (0, 1, 3),
    ),
    "nvidia/nemotron-3-super-120b-a12b": (
        DiscoveryState.ACCESSIBLE,
        "Probe 2026-10-17: TEXT ok 6.2 s; TOOL ok 2.2 s with a schema-valid structure.version.get. "
        "PROPOSAL answered three times (5.1, 5.9, 7.8 s) with calculation.submit calls that all "
        "failed the probe's STRICT raw-schema check. In the last two the strict errors were "
        "structure_version and specification not being objects (JSON strings, which production "
        "unwraps). Production replay: the second was refused at the planning-profile guard "
        "(task, engine or version, not recorded); the third was refused at normalization "
        "(NOT_FOUND: the version id supplied does not exist in the project). The first was not "
        "replayed. Three requests at temperature 1.0, not a failure rate; production would return "
        "the error and let the model retry, which no probe tests. Production-flow run 5 (AI-5, "
        "the real AI Scientist service at model-card sampling): one request, 5.8 s, 9,617 in / "
        "299 out, gave a calculation.submit accepted on the first attempt and valid for the "
        "prompt (neutral singlet H2, HF/STO-3G, PySCF ENERGY); approval pending, nothing "
        "computed. Production-flow run 6 (AI-6, request matching on): one request, 4.9 s, 9,612 in "
        "/ 324 out, again a first-attempt calculation.submit valid for the prompt; approval "
        "pending, nothing computed. Production-flow run 7 (AI-6 reference cases): one request "
        "each on water (PBE/def2-SVP, 4.7 s, 9,434 in / 270 out) and ethanol (B3LYP/6-31G, "
        "8.5 s, 9,923 in / 285 out), both first-attempt proposals matching every named "
        "parameter; approvals pending, nothing computed. Runs 5 to 7 are single samples on "
        "three molecules, not a rate; the state above is unchanged.",
        (0, 1, 2, 3, 4, 5, 6),
    ),
    "stepfun-ai/step-5-preview": (
        DiscoveryState.ACCESSIBLE,
        "Probe 2026-10-17: TEXT ok 2.7 s; TOOL ok 3.4 s with a schema-valid structure.version.get. "
        "PROPOSAL: answered twice (25.2 s; 31.6 s, 1,481 in / 818 out), timed out once at 60 s. "
        "The second reply failed the probe's STRICT raw check (structure_version and specification "
        "were JSON strings) but the production replay ACCEPTED it (normalization, schema and "
        "profile guard); its basis was not STO-3G (missing or another basis, not recorded), so it "
        "is not valid for the prompt, and compute guidance was not replayed. The first answered "
        "reply was never replayed. Single requests at temperature 1.0. Production-flow run 5 "
        "(AI-5, the real AI Scientist service at model-card sampling): one request, 12.2 s, "
        "8,897 in / 792 out, gave a calculation.submit accepted on the first attempt and valid "
        "for the prompt (neutral singlet H2, HF/STO-3G, PySCF ENERGY); approval pending, nothing "
        "computed. Production-flow run 6 (AI-6, request matching on): one request, 20.1 s, "
        "8,838 in / 981 out, again a first-attempt calculation.submit valid for the prompt; "
        "approval pending, nothing computed. Production-flow run 7 (AI-6 reference cases): one "
        "request each on water (PBE/def2-SVP, 31.3 s, 8,730 in / 975 out) and ethanol "
        "(B3LYP/6-31G, 34.6 s, 9,158 in / 1,087 out), both first-attempt proposals matching "
        "every named parameter; approvals pending, nothing computed. Runs 5 to 7 are single "
        "samples on three molecules, not a rate; the state above is unchanged.",
        (0, 1, 2, 3, 4, 5, 6),
    ),
}

NOTES = {
    "z-ai/glm-5.3": "build.nvidia.com showed 'Deprecation in 11d' on 2026-10-17.",
    "moonshotai/kimi-k3": (
        "NVIDIA API: HTTP 410 Gone, end of life 2026-10-15T08:00:00Z (checked 2026-10-17). The "
        "model page's availability table reads Free Endpoint: Deprecated, Partner Endpoint: "
        "Available (paid, per-token); it is not a free endpoint."
    ),
    "moonshotai/kimi-k2.6": (
        "Public API lookup: HTTP 200 (the id exists). build.nvidia.com has no live model page "
        "(404) and no catalogue card, so no Free Endpoint label could be verified; the docs "
        "reference "
        "page says only that the trial service is governed by the API Trial Terms."
    ),
    "moonshotai/kimi-k2-thinking": "NVIDIA API: 410 Gone, end of life 2026-05-12 (2026-10-17).",
    "moonshotai/kimi-k2-instruct": "NVIDIA API: 410 Gone, end of life 2026-05-12 (2026-10-17).",
    "deepseek-ai/deepseek-v4-flash": "NVIDIA API: 410 Gone, end of life 2026-08-07 (2026-10-17).",
    "nvidia/deepseek-v4.1-flash": (
        "The docs index files this under 'nvidia'; the public listing has "
        "deepseek-ai/deepseek-v4.1-flash. Identifiers must be exact, so the two are not merged."
    ),
    "nvidia/nemotron-3-nano-30b-a3b": (
        "Possibly the same model as nvidia/nemotron-nano-3-30b-a3b (public listing); the "
        "spellings differ, so they are not merged."
    ),
}


@dataclass(frozen=True, slots=True)
class DiscoveredModel:
    model: str
    category: DiscoveryCategory
    category_basis: CategoryBasis
    sources: tuple[DiscoverySource, ...]
    state: DiscoveryState
    blockers: tuple[Blocker, ...]
    registered: bool
    evidence: tuple[str, ...] = ()
    note: str | None = None

    def __post_init__(self) -> None:
        if self.state in EVIDENCE_REQUIRED_STATES and not self.evidence:
            raise ValueError(f"{self.model}: state {self.state.value} requires evidence")

    @property
    def provider(self) -> str:
        return self.model.partition("/")[0]

    @property
    def identifier_confirmed(self) -> bool:
        return DiscoverySource.PUBLIC_MODEL_LIST in self.sources


def _build() -> tuple[DiscoveredModel, ...]:
    registry = {d.model: d for d in DEFINITIONS if d.provider == "nvidia"}
    built = []
    for model, category, basis, sources in _ROWS:
        category = DiscoveryCategory(category)
        source_set = _SOURCES[sources]
        definition = registry.get(model)
        free = model in FREE_ENDPOINT_LABELLED
        blockers = [] if free else [Blocker.NO_ACCOUNT_COST_EVIDENCE]
        if DiscoverySource.PUBLIC_MODEL_LIST not in source_set:
            blockers.append(Blocker.NOT_IN_PUBLIC_MODEL_LIST)
        if category in NON_CHAT_CATEGORIES:
            blockers.append(Blocker.NO_ADAPTER)
        else:
            if model not in SAMPLING_PROFILES:
                blockers.append(Blocker.NO_SAMPLING_PROFILE)
            if not (definition and definition.tool_verified):
                blockers.append(Blocker.TOOL_CALLING_NOT_VERIFIED)
        deprecated = bool(definition and definition.availability == "DEPRECATED")
        if deprecated:
            blockers.append(Blocker.REGISTRY_DEPRECATED)
        observed = PROBE_OBSERVED.get(model)
        built.append(
            DiscoveredModel(
                model=model,
                category=category,
                category_basis=CategoryBasis(basis),
                sources=source_set,
                state=(
                    DiscoveryState.UNAVAILABLE
                    if deprecated
                    else observed[0]
                    if observed
                    else DiscoveryState.FREE_ACCESS_VERIFIED
                    if free
                    else DiscoveryState.COST_UNVERIFIED
                ),
                blockers=tuple(blockers),
                registered=definition is not None,
                evidence=(
                    FREE_ENDPOINT_EVIDENCE + tuple(PROBE_RUN_EVIDENCE[n] for n in observed[2])
                    if free and not deprecated and observed
                    else FREE_ENDPOINT_EVIDENCE
                    if free and not deprecated
                    else ()
                ),
                note=" ".join(x for x in (NOTES.get(model), observed[1] if observed else None) if x)
                or None,
            )
        )
    return tuple(built)


DISCOVERED_MODELS = _build()
_BY_MODEL = {entry.model: entry for entry in DISCOVERED_MODELS}


def discovered_model(model: str) -> DiscoveredModel | None:
    return _BY_MODEL.get(model)


def probe_candidates() -> tuple[str, ...]:
    """Models a probe authorization could name today.

    Free-labelled, spelling confirmed by the public listing, chat-shaped, registered as available,
    carrying a reviewed sampling profile and not yet found INCOMPATIBLE by a probe (naming such a
    model in a new authorization, for example after a fix, is still possible).
    """
    registry = {d.model: d for d in DEFINITIONS if d.provider == "nvidia"}
    return tuple(
        entry.model
        for entry in DISCOVERED_MODELS
        if entry.model in FREE_ENDPOINT_LABELLED
        and entry.state is not DiscoveryState.INCOMPATIBLE
        and entry.identifier_confirmed
        and entry.category not in NON_CHAT_CATEGORIES
        and entry.model in SAMPLING_PROFILES
        and entry.model in registry
        and registry[entry.model].availability == "AVAILABLE"
        and registry[entry.model].adapter_supported
    )
