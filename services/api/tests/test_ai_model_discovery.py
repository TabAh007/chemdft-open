"""The discovery catalogue lists identifiers; it never grants capability, access or selection."""

from collections import Counter
from pathlib import Path

import pytest
from chemdft_api.ai.model_catalog import (
    DEFINITIONS,
    LIGHTNING,
    NVIDIA_BASE,
    SAMPLING_PROFILES,
    selectable_nvidia_models,
)
from chemdft_api.ai.model_discovery import (
    DISCOVERED_MODELS,
    EVIDENCE_REQUIRED_STATES,
    FREE_ENDPOINT_EVIDENCE,
    FREE_ENDPOINT_LABELLED,
    FREE_ENDPOINT_NOT_CATALOGUED,
    PROBE_OBSERVED,
    PROBE_RUN_EVIDENCE,
    Blocker,
    CategoryBasis,
    DiscoveredModel,
    DiscoveryCategory,
    DiscoverySource,
    DiscoveryState,
    discovered_model,
    probe_candidates,
)
from chemdft_api.config import Settings
from pydantic import SecretStr

NINE_BATCH = (
    "nvidia/nemotron-3.5-lightning-30b-a3b",
    "nvidia/nemotron-3-super-120b-a12b",
    "nvidia/nemotron-3-ultra-550b-a55b",
    "nvidia/nemotron-3.5-super-vl-120b-a12b",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    "deepseek-ai/deepseek-v4.1-flash",
    "meta/muse-glimmer-30b",
    "stepfun-ai/step-5-preview",
    "google/gemma-4-31b-it",
)


def nvidia_settings(**models):
    return Settings(
        _env_file=None,
        ai_provider="nvidia",
        ai_api_base_url=NVIDIA_BASE,
        ai_api_key=SecretStr("offline-test"),
        ai_model_fast=models.get("fast", LIGHTNING),
        ai_model_standard=models.get("standard", LIGHTNING),
        ai_model_reasoning=models.get("reasoning", LIGHTNING),
    )


def test_identifiers_are_unique_well_formed_and_the_public_listing_is_fully_recorded():
    ids = [entry.model for entry in DISCOVERED_MODELS]
    assert len(ids) == len(set(ids))
    assert all(i.count("/") == 1 and i == i.strip() and " " not in i for i in ids)
    confirmed = [e for e in DISCOVERED_MODELS if e.identifier_confirmed]
    assert len(confirmed) == 81  # the 2026-10-17 public /v1/models listing, none omitted
    assert all(DiscoverySource.PUBLIC_MODEL_LIST in e.sources for e in confirmed)
    docs_only = [e for e in DISCOVERED_MODELS if not e.identifier_confirmed]
    assert docs_only and all(Blocker.NOT_IN_PUBLIC_MODEL_LIST in e.blockers for e in docs_only)


def test_states_need_evidence_and_only_observed_ones_are_claimed():
    states = Counter(e.state for e in DISCOVERED_MODELS)
    assert states == {
        DiscoveryState.COST_UNVERIFIED: 133,
        DiscoveryState.UNAVAILABLE: 4,
        DiscoveryState.FREE_ACCESS_VERIFIED: 13,  # labelled free, not (successfully) called
        DiscoveryState.ACCESSIBLE: 4,  # answered requests; no proposal has passed even strictly
        DiscoveryState.TESTED: 4,  # called, no usable response
        DiscoveryState.INCOMPATIBLE: 1,  # a required ChemDFT check failed once
    }
    # nothing is COMPATIBLE: no model has produced a proposal that passed even the strict check
    assert DiscoveryState.COMPATIBLE not in states
    for entry in DISCOVERED_MODELS:
        assert bool(entry.evidence) is (
            entry.state
            in {
                DiscoveryState.FREE_ACCESS_VERIFIED,
                DiscoveryState.ACCESSIBLE,
                DiscoveryState.TESTED,
                DiscoveryState.INCOMPATIBLE,
            }
        )
        if entry.model in PROBE_OBSERVED:
            assert entry.note
            assert set(PROBE_RUN_EVIDENCE[n] for n in PROBE_OBSERVED[entry.model][2]) <= set(
                entry.evidence
            )
        else:
            assert not set(PROBE_RUN_EVIDENCE) & set(entry.evidence)
    assert set(PROBE_OBSERVED) == set(NINE_BATCH)
    for state in EVIDENCE_REQUIRED_STATES:
        with pytest.raises(ValueError):
            DiscoveredModel(
                model="x/y",
                category=DiscoveryCategory.LANGUAGE,
                category_basis=CategoryBasis.NONE,
                sources=(DiscoverySource.DOCS_INDEX,),
                state=state,
                blockers=(),
                registered=False,
            )
    assert {s.value for s in DiscoveryState} == {
        "DISCOVERED",
        "FREE ACCESS VERIFIED",
        "ACCESSIBLE",
        "TESTED",
        "COMPATIBLE",
        "INCOMPATIBLE",
        "UNAVAILABLE",
        "COST UNVERIFIED",
    }


def test_free_access_rests_on_the_free_endpoint_label_plus_the_owner_account_evidence():
    assert len(FREE_ENDPOINT_LABELLED) == 22 and len(FREE_ENDPOINT_NOT_CATALOGUED) == 17
    assert (
        len(FREE_ENDPOINT_LABELLED) + len(FREE_ENDPOINT_NOT_CATALOGUED) == 39
    )  # the filter's count
    assert not FREE_ENDPOINT_LABELLED & set(FREE_ENDPOINT_NOT_CATALOGUED)
    for model in FREE_ENDPOINT_LABELLED:
        entry = discovered_model(model)
        assert entry is not None and entry.identifier_confirmed, model  # exact public spelling
        assert Blocker.NO_ACCOUNT_COST_EVIDENCE not in entry.blockers
    for entry in DISCOVERED_MODELS:
        if entry.model not in FREE_ENDPOINT_LABELLED:
            assert Blocker.NO_ACCOUNT_COST_EVIDENCE in entry.blockers, entry.model
            assert entry.state is not DiscoveryState.FREE_ACCESS_VERIFIED
    assert any("Up to 40 rpm" in e for e in FREE_ENDPOINT_EVIDENCE)
    assert any("nim_type_preview" in e for e in FREE_ENDPOINT_EVIDENCE)


def test_probe_candidates_are_the_free_chat_models_with_reviewed_sampling_minus_the_incompatible():
    assert set(probe_candidates()) == set(NINE_BATCH) - {"nvidia/nemotron-3.5-super-vl-120b-a12b"}
    for model in probe_candidates():
        entry = discovered_model(model)
        assert model in FREE_ENDPOINT_LABELLED and model in SAMPLING_PROFILES
        assert entry.state is not DiscoveryState.INCOMPATIBLE
    # free-labelled but not probeable: embedding, safety guards, translation, no reviewed profile
    for model in ("nvidia/nemotron-3-embed-1b", "meta/llama-guard-4-12b", "openai/gpt-oss-20b"):
        assert model in FREE_ENDPOINT_LABELLED and model not in probe_candidates()


def test_every_registered_nvidia_model_is_catalogued_and_deprecations_are_unavailable():
    registry = {d.model: d for d in DEFINITIONS if d.provider == "nvidia"}
    for model, definition in registry.items():
        entry = discovered_model(model)
        assert entry is not None and entry.registered, model
        expected = (
            DiscoveryState.UNAVAILABLE
            if definition.availability == "DEPRECATED"
            else PROBE_OBSERVED[model][0]
            if model in PROBE_OBSERVED
            else DiscoveryState.FREE_ACCESS_VERIFIED
            if model in FREE_ENDPOINT_LABELLED
            else DiscoveryState.COST_UNVERIFIED
        )
        assert entry.state is expected, model
        assert (Blocker.REGISTRY_DEPRECATED in entry.blockers) is (
            expected is DiscoveryState.UNAVAILABLE
        )
    assert {e.model for e in DISCOVERED_MODELS if e.registered} == set(registry)


def test_non_chat_families_have_no_adapter():
    molecular = [e for e in DISCOVERED_MODELS if e.category is DiscoveryCategory.MOLECULAR_BIOLOGY]
    assert {"nvidia/genmol", "nvidia/molmim", "mit/diffdock", "mit/boltz2"} <= {
        e.model for e in molecular
    }
    for entry in DISCOVERED_MODELS:
        if entry.category in {
            DiscoveryCategory.MOLECULAR_BIOLOGY,
            DiscoveryCategory.RETRIEVAL,
            DiscoveryCategory.DOCUMENT_PARSING,
        }:
            assert Blocker.NO_ADAPTER in entry.blockers, entry.model
        else:
            assert Blocker.NO_ADAPTER not in entry.blockers, entry.model
    assert Counter(e.category_basis for e in DISCOVERED_MODELS)[CategoryBasis.NONE] == len(
        [e for e in DISCOVERED_MODELS if e.category is DiscoveryCategory.UNCLASSIFIED]
    )


def test_the_catalogue_carries_no_capability_claims():
    fields = set(DiscoveredModel.__dataclass_fields__)
    assert not {"capabilities", "tool_calling", "context", "selectable", "price", "free"} & fields


def test_catalogue_entries_never_become_selectable():
    discovered = [e.model for e in DISCOVERED_MODELS]
    # Even when a server is configured to use any discovered model, only the reviewed,
    # tool-verified registry row is selectable.
    for model in discovered:
        selected = selectable_nvidia_models(nvidia_settings(fast=model, standard=model))
        assert selected <= {LIGHTNING}, model
    assert selectable_nvidia_models(nvidia_settings()) == {LIGHTNING}


def test_production_code_does_not_consume_the_catalogue():
    source = Path(__import__("chemdft_api").__file__).parent
    for path in source.rglob("*.py"):
        if path.name == "model_discovery.py":
            continue
        assert "model_discovery" not in path.read_text(), path


def test_runs_5_to_7_are_recorded_as_evidence_for_super_and_step_5_without_changing_any_state():
    """AI-6: production-flow runs are dated evidence on the rows they cover, nothing more."""
    run5, run6, run7 = PROBE_RUN_EVIDENCE[4], PROBE_RUN_EVIDENCE[5], PROBE_RUN_EVIDENCE[6]
    assert "run 5" in run5 and "d2dba187e6f5" in run5 and "2 of 6 authorized requests" in run5
    assert "run 6" in run6 and "2e5e7a9b600d" in run6 and "2 of 6 authorized requests" in run6
    assert "request matching" in run6 and "nothing approved or computed" in run6
    assert "run 7" in run7 and "1a5ac36c2630" in run7 and "4 of 6 authorized requests" in run7
    assert "h2o-pbe-def2svp" in run7 and "ethanol-b3lyp-631g" in run7
    covered = {"nvidia/nemotron-3-super-120b-a12b", "stepfun-ai/step-5-preview"}
    for run in (run5, run6, run7):
        assert {entry.model for entry in DISCOVERED_MODELS if run in entry.evidence} == covered
    for model in covered:
        entry = discovered_model(model)
        assert (
            entry.state is DiscoveryState.ACCESSIBLE
        )  # unchanged: single samples are not COMPATIBLE
        assert "valid for the prompt" in entry.note and "not a rate" in entry.note
        assert "Runs 5 to 7" in entry.note and "unchanged" in entry.note
    assert DiscoveryState.COMPATIBLE not in {entry.state for entry in DISCOVERED_MODELS}
