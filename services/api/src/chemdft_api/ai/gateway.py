from __future__ import annotations

import json
import re
import socket
import ssl
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol
from uuid import uuid4

from ..config import Settings
from ..scientific_evidence import format_scientific_evidence
from .http_transport import (
    TransportAttempt,
    TransportDiagnostic,
    TransportFailure,
    open_response,
)
from .token_policy import (
    CONSERVATIVE_FALLBACK_BYTES_PER_TOKEN,
    InputReservationBound,
    bound_from_bytes,
    payload_byte_parts,
)


class ModelTier(StrEnum):
    FAST = "FAST"
    STANDARD = "STANDARD"
    REASONING = "REASONING"


@dataclass(frozen=True, slots=True)
class ModelToolDefinition:
    name: str
    description: str
    parameters_schema: dict[str, object]


@dataclass(frozen=True, slots=True)
class ModelToolCall:
    id: str
    name: str
    arguments_json: str


@dataclass(frozen=True, slots=True)
class ModelMessage:
    role: str
    content: str
    tool_call_id: str | None = None
    tool_calls: tuple[ModelToolCall, ...] = ()


@dataclass(frozen=True, slots=True)
class ModelRequest:
    system_prompt: str
    messages: tuple[ModelMessage, ...]
    tools: tuple[ModelToolDefinition, ...] = ()
    model_tier: ModelTier = ModelTier.STANDARD
    max_tokens: int | None = None
    temperature: float = 0.0
    model_identifier: str | None = None
    max_attempts: int = 3
    # Input-token quota reserved for this exact request (INPUT_RESERVATION_V1). When set, the
    # HTTP adapter re-derives the bound from the bytes it is about to send and refuses to
    # dispatch if the reservation is smaller. None keeps legacy unreserved callers working.
    reserved_input_tokens: int | None = None
    input_bytes_per_token_floor: float = CONSERVATIVE_FALLBACK_BYTES_PER_TOKEN
    # Optional, model-card-backed sampling/reasoning settings. None (the default) sends exactly the
    # request that was sent before these fields existed, so production behaviour is unchanged.
    top_p: float | None = None
    chat_template_kwargs: tuple[tuple[str, bool], ...] | None = None
    # Extraction/chat calls whose output is validated or short: ask a reasoning model for a direct
    # answer where its model card documents a switch (see model_catalog.direct_answer_kwargs).
    direct_answer: bool = False


@dataclass(frozen=True, slots=True)
class ModelUsage:
    input_tokens: int
    output_tokens: int
    latency_ms: int
    cached_tokens: int | None = 0


@dataclass(frozen=True, slots=True)
class ModelResponse:
    content: str | None
    tool_calls: tuple[ModelToolCall, ...] = ()
    usage: ModelUsage | None = None
    model_identifier: str = "fake-model"
    provider: str = "fake"
    finish_reason: str = "stop"
    reported_usage: dict[str, int | None] | None = None
    transport: TransportDiagnostic | None = None


class ModelGatewayError(Exception):
    # Conservative default: unless an error type proves the request never reached the
    # provider, its outcome is treated as uncertain (a paid call may have been made).
    request_sent: bool = True

    def __init__(
        self,
        message: str = "",
        *,
        usage: ModelUsage | None = None,
        reported_usage: dict[str, int | None] | None = None,
        transport: TransportDiagnostic | None = None,
    ):
        super().__init__(message)
        self.usage = usage
        self.reported_usage = reported_usage
        self.transport = transport


class ModelRequestNotSentError(ModelGatewayError):
    """Raised before any network I/O: the provider never received the request, so nothing
    can have been generated or billed and its reservation is released, not charged."""

    request_sent = False


class ModelTimeoutError(ModelGatewayError):
    pass


class ModelNetworkError(ModelGatewayError):
    pass


class ModelOutputTruncatedError(ModelGatewayError):
    """The provider stopped at the output-token limit; the partial reply is discarded."""


class ModelProviderUnavailableError(ModelGatewayError):
    pass


class ModelAuthenticationError(ModelGatewayError):
    pass


class ModelRateLimitError(ModelGatewayError):
    pass


class ModelCredentialMissingError(ModelAuthenticationError, ModelRequestNotSentError):
    """No API credential is configured; detected locally, nothing was sent."""


class ModelProviderNotConfiguredError(ModelProviderUnavailableError, ModelRequestNotSentError):
    """No usable provider is configured; nothing was sent."""


class ModelOutputBudgetInsufficientError(ModelRequestNotSentError):
    """The provider requires a minimum output token budget that exceeds the
    authorized reservation. Raised instead of silently increasing max_tokens."""

    def __init__(self, required: int, requested: int) -> None:
        self.required_min_tokens = required
        self.requested_tokens = requested
        super().__init__(
            f"Provider requires a minimum output budget of {required} tokens; "
            f"the authorized reservation is {requested} tokens."
        )


class ModelInputBudgetInsufficientError(ModelRequestNotSentError):
    """The exact request needs more input quota than was reserved. Raised before any network
    I/O; the reservation is never silently enlarged or the request silently trimmed."""

    def __init__(self, required: int, reserved: int) -> None:
        self.required_input_tokens = required
        self.reserved_input_tokens = reserved
        super().__init__(
            f"The request needs an input reservation of {required} tokens; "
            f"{reserved} tokens were reserved."
        )


def not_dispatched_reason(error: ModelGatewayError) -> str:
    """Fixed, secret-free label stored on a NOT_DISPATCHED receipt (never the exception text)."""
    if isinstance(error, ModelInputBudgetInsufficientError):
        return "INPUT_RESERVATION_INSUFFICIENT"
    if isinstance(error, ModelOutputBudgetInsufficientError):
        return "OUTPUT_BUDGET_INSUFFICIENT"
    if isinstance(error, ModelCredentialMissingError):
        return "CREDENTIAL_MISSING"
    if isinstance(error, ModelProviderNotConfiguredError):
        return "PROVIDER_NOT_CONFIGURED"
    return "REQUEST_REJECTED_LOCALLY"


def wire_tool_names(tools: tuple[ModelToolDefinition, ...]) -> dict[str, str]:
    """Stable product tool IDs contain dots; wire adapters require [A-Za-z0-9_-]."""
    wire_names = {tool.name: tool.name.replace(".", "__") for tool in tools}
    if len(set(wire_names.values())) != len(wire_names) or any(
        len(n) > 64 for n in wire_names.values()
    ):
        raise ModelRequestNotSentError("Tool names cannot be represented safely by this adapter.")
    return wire_names


def chat_messages_payload(
    request: ModelRequest, wire_names: dict[str, str]
) -> list[dict[str, object]]:
    messages_payload: list[dict[str, object]] = [
        {"role": "system", "content": request.system_prompt}
    ]
    for msg in request.messages:
        entry: dict[str, object] = {"role": msg.role, "content": msg.content}
        if msg.role == "tool" and msg.tool_call_id:
            entry["tool_call_id"] = msg.tool_call_id
        if msg.role == "assistant" and msg.tool_calls:
            entry["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": wire_names.get(tc.name, tc.name.replace(".", "__")),
                        "arguments": tc.arguments_json,
                    },
                }
                for tc in msg.tool_calls
            ]
        messages_payload.append(entry)
    return messages_payload


def chat_tools_payload(
    request: ModelRequest, wire_names: dict[str, str]
) -> list[dict[str, object]]:
    return [
        {
            "type": "function",
            "function": {
                "name": wire_names[tool.name],
                "description": tool.description,
                "parameters": tool.parameters_schema,
            },
        }
        for tool in request.tools
    ]


def request_input_bound(
    request: ModelRequest, bytes_per_token_floor: float | None = None
) -> InputReservationBound:
    """Bound derived from the same serialization the HTTP adapter sends (see token_policy)."""
    names = wire_tool_names(request.tools)
    messages = chat_messages_payload(request, names)
    tools = chat_tools_payload(request, names)
    static_bytes, dynamic_bytes = payload_byte_parts(messages, tools)
    return bound_from_bytes(
        static_bytes + dynamic_bytes,
        len(messages),
        len(tools),
        bytes_per_token_floor
        if bytes_per_token_floor is not None
        else request.input_bytes_per_token_floor,
        dynamic_bytes,
    )


# Reasoning switches the provider documents for NVIDIA Nemotron chat templates; nothing else may be
# forwarded, so a profile can never smuggle an arbitrary provider field into a request.
ALLOWED_CHAT_TEMPLATE_KWARGS = frozenset(
    {"enable_thinking", "low_effort", "force_nonempty_content"}
)


def sampling_payload_fields(request: ModelRequest) -> dict[str, object]:
    """Validated optional sampling fields; raises before any I/O on an invalid value."""
    fields: dict[str, object] = {}
    if request.top_p is not None:
        value = request.top_p
        if type(value) not in (int, float) or isinstance(value, bool) or not 0 < value <= 1:
            raise ModelRequestNotSentError("top_p must be a number in (0, 1].")
        fields["top_p"] = float(value)
    if request.chat_template_kwargs is not None:
        items = dict(request.chat_template_kwargs)
        if (
            len(items) != len(request.chat_template_kwargs)
            or not items
            or not set(items) <= ALLOWED_CHAT_TEMPLATE_KWARGS
            or any(type(v) is not bool for v in items.values())
        ):
            raise ModelRequestNotSentError("Unsupported chat_template_kwargs for this adapter.")
        fields["chat_template_kwargs"] = items
    return fields


MOONSHOT_BASE = "https://api.moonshot.ai/v1"
# Request shapes Moonshot's own API documents (platform.kimi.ai K3 and K2.6 quickstarts, read
# 2026-10-18). Moonshot fixes sampling itself and refuses other values, so temperature and top_p
# are never sent; thinking is the one reviewed control per model. A model not listed here is refused
# before any I/O: a Moonshot id is never guessed.
MOONSHOT_MODELS: dict[str, dict[str, object]] = {
    "kimi-k3": {"token_field": "max_completion_tokens", "extra": {"reasoning_effort": "low"}},
    "kimi-k2.6": {"token_field": "max_tokens", "extra": {"thinking": {"type": "disabled"}}},
}


class ModelGateway(Protocol):
    def generate(self, request: ModelRequest) -> ModelResponse: ...


class FakeModelGateway:
    def __init__(self) -> None:
        self.canned_responses: list[ModelResponse] = []
        self.recorded_requests: list[ModelRequest] = []

    def set_next_response(self, response: ModelResponse) -> None:
        self.canned_responses.append(response)

    def generate(self, request: ModelRequest) -> ModelResponse:
        self.recorded_requests.append(request)
        if "CHEMDFT_INVESTIGATION_DECISION_V1" in request.system_prompt:
            # Deterministic offline model contract used by the local worker and
            # tests. It emits only typed JSON; no scientific numbers are copied
            # from the prompt into an observation.
            try:
                context = json.loads(request.messages[-1].content)
            except Exception:
                context = {}
            objective = str(context.get("objective", "")).lower()
            observations = context.get("observations") or []
            candidate = context.get("candidate_next_action")
            if "nmr" in objective:
                payload = {
                    "decision": "REQUEST_USER_INPUT",
                    "rationale_summary": "NMR capability is unavailable in this environment.",
                    "user_question": (
                        "Would you like to provide an authoritative NMR result "
                        "or change the objective?"
                    ),
                }
            elif candidate and len(observations) == 1:
                payload = {
                    "decision": "PROPOSE_STEP",
                    "rationale_summary": (
                        "A second bounded calculation is required for the comparison."
                    ),
                    "proposed_action": candidate,
                    "cited_observation_ids": [str(observations[0].get("id"))],
                }
            elif observations:
                payload = {
                    "decision": "ASSESS_AND_COMPLETE",
                    "rationale_summary": "Authoritative observations are available for assessment.",
                    "hypothesis_assessment": "SUPPORTED",
                    "cited_observation_ids": [str(item.get("id")) for item in observations],
                }
            else:
                payload = {
                    "decision": "INCONCLUSIVE",
                    "rationale_summary": "No authoritative observation is available.",
                }
            return ModelResponse(
                content=json.dumps(payload, sort_keys=True),
                usage=ModelUsage(input_tokens=100, output_tokens=60, latency_ms=1),
                model_identifier=request.model_identifier or "fake-investigation",
                provider="fake",
            )
        if self.canned_responses:
            return self.canned_responses.pop(0)

        if "CHEMDFT_EVIDENCE_ANSWER_V1" in request.system_prompt:
            try:
                payload = json.loads(request.messages[-1].content)
                question = str(payload.get("question", "")).casefold()
                is_dls_question = any(
                    term in question
                    for term in (
                        "dls",
                        "hydrodynamic",
                        "radius",
                        "figure 4",
                        "particle-size distribution",
                    )
                )
                evidence = payload.get("evidence") or []
                if "cvd" in question and "condition" in question:
                    patterns = (r"synthesis\s+was\s+carried\s+out", r"синтез\s+был\s+произведен")
                elif "unit-cell" in question or "unit cell" in question or "lattice" in question:
                    patterns = (r"cell\s+dimensions\s+were", r"размеры\s+ячеек")
                elif "xrd" in question or "diffraction" in question or "2θ" in question:
                    if any(term in question for term in ("digitiz", "figure 3", "stored point")):
                        patterns = (
                            r"figure 3 xrd dataset is digitized[^.]{0,520}\.",
                            r"на\s+рентгенограмме[\s\S]{0,600}?54,865",
                            r"x-ray\s+diffraction\s+peak\s+position",
                        )
                    else:
                        patterns = (
                            r"на\s+рентгенограмме[\s\S]{0,600}?54,865",
                            r"x-ray\s+diffraction\s+peak\s+position",
                        )
                elif is_dls_question:
                    patterns = (
                        r"figure 4 dls dataset is digitized[^.]{0,520}\.",
                        r"the distribution of particles[\s\S]{0,240}?dynamic light scattering",
                        r"1482[,.]3[\s\S]{0,180}?DLS",
                        r"1496[,\.]1[\s\S]{0,100}?1588[,\.]2",
                        r"hydrodynamic diameter[\s\S]{0,240}?1496[,\.]1",
                    )
                elif "figure 2" in question and "structure" in question and "authorit" in question:
                    patterns = (
                        r"hypoth\s*etical[^.!?\n]{0,80}structure",
                        r"гипотетическ\w*[^.!?\n]{0,80}структур",
                    )
                else:
                    patterns = ()

                claims = []
                for item in evidence[:8]:
                    if not isinstance(item, dict):
                        continue
                    passage = str(item.get("passage", ""))
                    match = next(
                        (
                            found
                            for pattern in patterns
                            if (found := re.search(pattern, passage, re.IGNORECASE))
                        ),
                        None,
                    )
                    if match is not None:
                        if is_dls_question:
                            lowered = passage.casefold()
                            dataset_start = lowered.find("figure 4 dls dataset is digitized")
                            prose_start = lowered.find("the distribution of particles")
                            if dataset_start >= 0:
                                start = dataset_start
                                end = passage.find(". ", start, start + 620)
                                quote = passage[
                                    start : end + 1 if end >= 0 else start + 600
                                ].strip()
                            elif prose_start >= 0:
                                start = prose_start
                                end = passage.find(". ", match.end())
                                quote = passage[start : end + 1 if end >= 0 else None].strip()
                            else:
                                start = lowered.rfind(
                                    "значения параметров спектра дрс", 0, match.start()
                                )
                                if start < 0:
                                    start = lowered.rfind("hydrodynamic diameter", 0, match.start())
                                if start < 0:
                                    start = max(0, passage.rfind("\n\n", 0, match.start()) + 2)
                                end = passage.find("1,2263", match.end())
                                if end < 0:
                                    end = passage.find("1.2263", match.end())
                                quote = passage[start : end + 6 if end >= 0 else None].strip()
                        elif "xrd" in question or "diffraction" in question or "2θ" in question:
                            if "figure 3 xrd dataset is digitized" in passage.casefold():
                                start = passage.casefold().find("figure 3 xrd dataset is digitized")
                            elif "на рентгенограмме" in passage.casefold():
                                start = passage.casefold().find("на рентгенограмме")
                            else:
                                start = passage.casefold().find(
                                    "reported x-ray diffraction peak position"
                                )
                            end = passage.find("\n\n", match.end())
                            quote = passage[start : end if end >= 0 else None].strip()
                        else:
                            start = passage.rfind(". ", 0, match.start()) + 2
                            previous_line = passage.rfind("\n\n", 0, match.start()) + 2
                            start = max(start, previous_line)
                            end = passage.find(". ", match.end())
                            quote = passage[start : end + 1 if end >= 0 else None].strip()
                    elif patterns:
                        continue
                    else:
                        quote = passage[:400].strip()
                    if 8 <= len(quote) <= 600 and not re.search(
                        r"(?i)system\s+override|ignore\s+all\s+previous\s+instructions",
                        quote,
                    ):
                        claims.append({"evidence_id": item["id"], "quote": quote})
                if not patterns and claims:
                    claims = claims[:1]
            except (IndexError, KeyError, TypeError, ValueError):
                claims = []
            return ModelResponse(
                content=json.dumps({"claims": claims, "unanswered": ""}),
                usage=ModelUsage(input_tokens=120, output_tokens=50, latency_ms=1),
                model_identifier=request.model_identifier or "fake-evidence",
                provider="fake",
            )

        # Inspect latest message
        latest_user_message = ""
        tool_results: list[dict[str, object]] = []
        for msg in request.messages:
            if msg.role == "user":
                latest_user_message = msg.content
            elif msg.role == "tool":
                try:
                    tool_results.append(json.loads(msg.content))
                except Exception:
                    tool_results.append({"raw": msg.content})

        user_lower = latest_user_message.lower()

        # Check for unsupported capabilities immediately
        if "nmr" in user_lower:
            return ModelResponse(
                content=(
                    "ChemDFT currently does not support NMR chemical shift predictions. "
                    "Available quantum chemistry capabilities in this environment are: "
                    "single-point energy calculations using Hartree-Fock (HF), B3LYP, and PBE "
                    "with STO-3G, 6-31G, and def2-SVP basis sets via PySCF."
                ),
                tool_calls=(),
                usage=ModelUsage(input_tokens=150, output_tokens=50, latency_ms=10),
                model_identifier=request.model_identifier or "fake-standard",
                provider="fake",
            )

        if "ccsd" in user_lower:
            return ModelResponse(
                content=(
                    "CCSD(T) calculations and geometry optimizations are not currently supported "
                    "in this ChemDFT installation. "
                    "Available methods are molecular single-point HF, B3LYP, and PBE."
                ),
                tool_calls=(),
                usage=ModelUsage(input_tokens=150, output_tokens=40, latency_ms=10),
                model_identifier=request.model_identifier or "fake-standard",
                provider="fake",
            )

        # Autonomous Molecule Creation & Identification
        mol_candidates = [
            "methane", "ethane", "benzene", "ethanol", "acetone",
            "propane", "toluene", "methanol", "ethylene", "acetylene",
            "xylene", "butanol", "tartaric acid", "2-butanol", "p-xylene", "m-xylene", "o-xylene"
        ]
        matched_molecules = [
            m for m in mol_candidates if re.search(rf"\b{re.escape(m)}\b", user_lower)
        ]
        # "p-xylene" also contains the word "xylene": the more specific name wins.
        requested_molecules = [
            m for m in matched_molecules
            if not any(
                other != m and (other.endswith(f"-{m}") or other.startswith(f"{m}-"))
                for other in matched_molecules
            )
        ]
        is_molecule_request = bool(
            requested_molecules
            and any(
                verb in user_lower
                for verb in ("create", "generate", "make", "build", "show", "draft", "resolve")
            )
        )
        if is_molecule_request:
            resolved_results = [
                tr for tr in tool_results
                if "canonical_isomeric_smiles" in tr or "alternatives" in tr
            ]
            if not resolved_results:
                return ModelResponse(
                    content=f"Resolving chemical identities for {', '.join(requested_molecules)}.",
                    tool_calls=tuple(
                        ModelToolCall(
                            id=f"res_{m}_{uuid4().hex[:6]}",
                            name="molecule.resolve",
                            arguments_json=json.dumps({"name": m}),
                        )
                        for m in requested_molecules
                    ),
                    usage=ModelUsage(input_tokens=180, output_tokens=40, latency_ms=10),
                    model_identifier=request.model_identifier or "fake-standard",
                    provider="fake",
                )

            # Check if any resolved result requires clarification
            ambiguous_items = [tr for tr in resolved_results if tr.get("clarification_required")]
            if ambiguous_items:
                prompt_text = ambiguous_items[0].get(
                    "clarification_prompt", "Please clarify which isomer you require."
                )
                return ModelResponse(
                    content=prompt_text,
                    tool_calls=(),
                    usage=ModelUsage(input_tokens=150, output_tokens=30, latency_ms=10),
                    model_identifier=request.model_identifier or "fake-standard",
                    provider="fake",
                )

            draft_results = [
                tr for tr in tool_results
                if "candidate_artifact_id" in tr or "geometry_class" in tr
            ]
            draft_names = {tr.get("name") for tr in draft_results}
            needed_drafts = [
                tr
                for tr in resolved_results
                if tr.get("resolved")
                and tr.get("name") not in draft_names
                and tr.get("canonical_isomeric_smiles")
            ]
            if needed_drafts:
                return ModelResponse(
                    content=(
                        "Generating 2D depictions and 3D RDKit conformers for "
                        f"{', '.join(tr['name'] for tr in needed_drafts)}."
                    ),
                    tool_calls=tuple(
                        ModelToolCall(
                            id=f"draft_{tr['name']}_{uuid4().hex[:6]}",
                            name="molecule.draft.create",
                            arguments_json=json.dumps(
                                {
                                    "name": tr["name"],
                                    "canonical_isomeric_smiles": tr["canonical_isomeric_smiles"],
                                    "action_key": f"action-create-{tr['name']}",
                                }
                            ),
                        )
                        for tr in needed_drafts
                    ),
                    usage=ModelUsage(input_tokens=220, output_tokens=50, latency_ms=15),
                    model_identifier=request.model_identifier or "fake-standard",
                    provider="fake",
                )

            if draft_results:
                names = [tr.get("name", "molecule") for tr in draft_results]
                return ModelResponse(
                    content=(
                        f"I have created molecular drafts for {', '.join(names)}. "
                        "Deterministic 2D depictions and 3D conformers were generated "
                        "using RDKit (ETKDGv3). "
                        "All artifacts have been created in your project workspace "
                        "in PENDING_ACCEPTANCE status. "
                        "Formal geometry acceptance remains an explicit human researcher action."
                    ),
                    tool_calls=(),
                    usage=ModelUsage(input_tokens=250, output_tokens=80, latency_ms=15),
                    model_identifier=request.model_identifier or "fake-standard",
                    provider="fake",
                )

        # Explain the missing-structure state from project data, not imagined geometry.
        if any(term in user_lower for term in ("3d", "3-d", "coordinates", "structure figure")):
            structure_results = [tr for tr in tool_results if "structures" in tr]
            if structure_results and not any(tr.get("structures") for tr in structure_results):
                has_reported_figure = "reported/hypothetical evidence only" in request.system_prompt
                figure_note = (
                    " The paper's detected structure figure is reported or hypothetical evidence, "
                    "not validated coordinates."
                    if has_reported_figure
                    else " A paper figure, if present, is source evidence and is not validated "
                    "coordinates."
                )
                return ModelResponse(
                    content=(
                        "This project has no committed StructureVersion, so the 3D viewers have "
                        "no validated atomic coordinates to display."
                        f"{figure_note} 3D visualization requires an imported or user-built "
                        "structure that passes server validation and is committed as a "
                        "StructureVersion."
                    ),
                    tool_calls=(),
                    usage=ModelUsage(input_tokens=160, output_tokens=55, latency_ms=10),
                    model_identifier=request.model_identifier or "fake-standard",
                    provider="fake",
                )

        # Check for HOMO when no calculation exists
        if "homo" in user_lower and not any("homo" in str(tr).lower() for tr in tool_results):
            return ModelResponse(
                content="No authoritative HOMO result exists in this project.",
                tool_calls=(),
                usage=ModelUsage(input_tokens=100, output_tokens=20, latency_ms=10),
                model_identifier=request.model_identifier or "fake-standard",
                provider="fake",
            )

        # Prompt injection test defense: if prompt has malicious instruction
        if "ignore all previous instructions" in user_lower or "reveal api keys" in user_lower:
            return ModelResponse(
                content=(
                    "I follow ChemDFT scientific policy and do not alter "
                    "authority, permissions, or system policies."
                ),
                tool_calls=(),
                usage=ModelUsage(input_tokens=120, output_tokens=30, latency_ms=10),
                model_identifier=request.model_identifier or "fake-standard",
                provider="fake",
            )

        # Broad literature/project questions use the source-bound knowledge tool.
        # The tool result, not the model, supplies the evidence and citation target.
        knowledge_results = [
            tr.get("results") for tr in tool_results if isinstance(tr.get("results"), list)
        ]
        knowledge_terms = ("paper", "lattice", "xrd", "particle size", "reported")
        if any(term in user_lower for term in knowledge_terms) and not knowledge_results:
            return ModelResponse(
                content="I will search the project's source-bound knowledge index.",
                tool_calls=(
                    ModelToolCall(
                        id=f"call_{uuid4().hex[:8]}",
                        name="knowledge.search",
                        arguments_json=json.dumps({"query": latest_user_message, "limit": 8}),
                    ),
                ),
                usage=ModelUsage(input_tokens=180, output_tokens=30, latency_ms=10),
                model_identifier=request.model_identifier or "fake-standard",
                provider="fake",
            )

        if knowledge_results:
            flattened = [
                item for group in knowledge_results for item in group if isinstance(item, dict)
            ]
            if flattened:
                if "xrd" in user_lower or "diffraction" in user_lower or "2theta" in user_lower:
                    positions = sorted(
                        {
                            match.group(1)
                            for item in flattened
                            if (
                                match := re.search(
                                    r"Reported X-ray diffraction peak position: ([0-9.]+)",
                                    str(item.get("content", "")),
                                )
                            )
                        },
                        key=float,
                    )
                    if positions:
                        return ModelResponse(
                            content=(
                                "The paper reports X-ray diffraction peaks at "
                                f"{', '.join(f'{value}°' for value in positions)} (2θ). "
                                "These are EXTRACTED values reported in the publication, "
                                "not independent instrument measurements."
                            ),
                            tool_calls=(),
                            usage=ModelUsage(input_tokens=220, output_tokens=50, latency_ms=15),
                            model_identifier=request.model_identifier or "fake-standard",
                            provider="fake",
                        )
                if (
                    "lattice" in user_lower
                    or "unit-cell" in user_lower
                    or "unit cell" in user_lower
                ):
                    values: dict[str, tuple[str, str]] = {}
                    for item in flattened:
                        match = re.search(
                            r"Reported (alpha|beta|gamma|a|b|c) value: ([0-9.]+)(Å|°)",
                            str(item.get("content", "")),
                        )
                        if match:
                            values[match.group(1)] = (match.group(2), match.group(3))
                    if {"a", "b", "c", "alpha", "beta", "gamma"} <= values.keys():

                        def parameter_line(*names: str) -> str:
                            symbols = {"alpha": "α", "beta": "β", "gamma": "γ"}  # noqa: RUF001
                            label = " = ".join(symbols.get(name, name) for name in names)
                            number, unit = values[names[0]]
                            return f"{label} = {number} {unit}"

                        return ModelResponse(
                            content=(
                                "The paper reports these unit-cell parameters:\n\n"
                                f"{parameter_line('a', 'b')}\n{parameter_line('c')}\n"
                                f"{parameter_line('alpha', 'beta')}\n"
                                f"{parameter_line('gamma')}\n\n"
                                "These are EXTRACTED values reported by the publication, "
                                "not raw experimental instrument measurements."
                            ),
                            tool_calls=(),
                            usage=ModelUsage(input_tokens=230, output_tokens=60, latency_ms=15),
                            model_identifier=request.model_identifier or "fake-standard",
                            provider="fake",
                        )
                excerpts = "; ".join(str(item.get("content", "")) for item in flattened[:4])
                excerpts = re.sub(
                    r"(?is)(system\s+override|ignore\s+all\s+previous\s+instructions).*?(?:immediately\.|$)",
                    "[untrusted instruction removed]",
                    excerpts,
                )
                return ModelResponse(
                    content=(
                        "The paper reports the following source-bound EXTRACTED passages from "
                        "the project knowledge index: "
                        f"{excerpts}. These are contextual retrieval results; verify the linked "
                        "source evidence before treating any value as authoritative."
                    ),
                    tool_calls=(),
                    usage=ModelUsage(input_tokens=220, output_tokens=70, latency_ms=15),
                    model_identifier=request.model_identifier or "fake-standard",
                    provider="fake",
                )

        # If user asks what energy was calculated and we have tool result with energy
        for tr in tool_results:
            if (
                "result" in tr
                and tr["result"]
                and isinstance(tr["result"], dict)
                and "energy" in tr["result"]
            ):
                energy_data = tr["result"]["energy"]
                spec = tr.get("specification", {})
                method = spec.get("method", "HF")
                basis = spec.get("basis", "STO-3G")
                val = energy_data.get("value")
                unit = energy_data.get("unit", "hartree")
                return ModelResponse(
                    content=(
                        "The PySCF calculation returned an authoritative single-point energy of "
                        f"{val} {unit} using method {method} and basis set {basis}. "
                        "This result was verified and published through "
                        "the Scientific Result Firewall."
                    ),
                    tool_calls=(),
                    usage=ModelUsage(input_tokens=250, output_tokens=60, latency_ms=15),
                    model_identifier=request.model_identifier or "fake-standard",
                    provider="fake",
                )

        # If user asks what lattice parameters are reported and we have document tool results
        for tr in tool_results:
            if "candidates" in tr or "evidence_candidates" in tr or "evidence" in tr:
                candidates = (
                    tr.get("candidates")
                    or tr.get("evidence_candidates")
                    or tr.get("evidence")
                    or []
                )
                cell_candidates = [
                    c
                    for c in candidates
                    if isinstance(c, dict)
                    and (
                        c.get("evidence_type") == "REPORTED_CELL_PARAMETER"
                        or c.get("candidate_type") == "REPORTED_CELL_PARAMETER"
                    )
                ]
                target_candidates = (
                    cell_candidates
                    if cell_candidates
                    else [c for c in candidates if isinstance(c, dict)]
                )
                if target_candidates:
                    snippets = []
                    page_num = 1
                    for c in target_candidates:
                        payload = c.get("structured_payload") or {}
                        raw = (
                            payload.get("raw_text")
                            or c.get("raw_text")
                            or format_scientific_evidence(payload)
                        )
                        anchor = c.get("source_anchor") or {}
                        page_num = anchor.get("page_number", page_num)
                        snippets.append(f"{raw}")
                    joined = ", ".join(snippets[:4])
                    return ModelResponse(
                        content=(
                            "The uploaded paper reports the following lattice parameters: "
                            f"{joined} (source: EXTRACTED evidence from page {page_num}). "
                            "Note that this is extracted textual evidence reported in the "
                            "publication, not raw experimental instrument measurements."
                        ),
                        tool_calls=(),
                        usage=ModelUsage(input_tokens=300, output_tokens=70, latency_ms=20),
                        model_identifier=request.model_identifier or "fake-standard",
                        provider="fake",
                    )

        # If user asks to calculate energy (e.g. "Calculate HF/STO-3G" or "Plan and submit...")
        is_calc_request = (
            (
                "calculate" in user_lower
                or "submit" in user_lower
                or "plan" in user_lower
                or "investigate" in user_lower
            )
            and "summarize" not in user_lower
            and "summary" not in user_lower
            and not user_lower.startswith("what")
        )
        if is_calc_request:
            # Scoped PYSCF_ENERGY_PROPOSAL profile: structure.list is deliberately not exposed and
            # the selected version is bound in the planning context, as a real model must use it.
            tool_names = {tool.name for tool in request.tools}
            proposed = any("approval_id" in tr or "calculation_id" in tr for tr in tool_results)
            if (
                "structure.list" not in tool_names
                and {"structure.version.get", "calculation.submit"} <= tool_names
                and not proposed
            ):
                try:
                    context_text = request.system_prompt.split("ProductContext", 1)[1]
                    bound = json.loads(context_text[context_text.index("{") :])
                    version_id = str(bound["selection"]["selected_structure_version_id"])
                    project_id = str(bound["project_id"])
                    version = (bound.get("scientific_input") or {}).get("version") or {}
                except (IndexError, KeyError, TypeError, ValueError):
                    version_id = project_id = ""
                    version = {}
                if version_id and project_id:
                    charge = version.get("overall_charge")
                    multiplicity = version.get("multiplicity")
                    scoped_args = {
                        "structure_version": {
                            "project_id": project_id,
                            "entity_type": "structure.version",
                            "entity_id": version_id,
                        },
                        "specification": {
                            "task_type": "ENERGY",
                            "method": {
                                "identifier": "hf",
                                "display_name": "Hartree-Fock",
                                "registry": "chemdft.method",
                            },
                            "basis": {
                                "identifier": "sto-3g",
                                "display_name": "STO-3G",
                                "registry": "chemdft.basis",
                            },
                            "charge": 0 if charge is None else charge,
                            "multiplicity": 1 if multiplicity is None else multiplicity,
                            "engine_preference": {"engine": "pyscf"},
                        },
                        "provider_preference": "LOCAL",
                        "idempotency_key": f"calc-{version_id[:8]}-hf-sto3g-scoped",
                    }
                    return ModelResponse(
                        content=(
                            "I propose a single-point HF/STO-3G energy calculation for the "
                            "selected structure version. This action requires approval."
                        ),
                        tool_calls=(
                            ModelToolCall(
                                id=f"call_{uuid4().hex[:8]}",
                                name="calculation.submit",
                                arguments_json=json.dumps(scoped_args),
                            ),
                        ),
                        usage=ModelUsage(input_tokens=300, output_tokens=50, latency_ms=15),
                        model_identifier=request.model_identifier or "fake-standard",
                        provider="fake",
                    )
            # Step 1: list structures if no structure in tool results
            has_structures = any("structures" in tr for tr in tool_results)
            if not has_structures:
                return ModelResponse(
                    content="I will inspect the available structures in this project.",
                    tool_calls=(
                        ModelToolCall(
                            id=f"call_{uuid4().hex[:8]}",
                            name="structure.list",
                            arguments_json="{}",
                        ),
                    ),
                    usage=ModelUsage(input_tokens=200, output_tokens=30, latency_ms=10),
                    model_identifier=request.model_identifier or "fake-standard",
                    provider="fake",
                )
            # Step 2: propose calculation.submit
            for tr in tool_results:
                if tr.get("structures"):
                    struct = tr["structures"][0]
                    v_id = struct["latest_version_id"]
                    p_id = struct["project_id"]
                    spec = {
                        "task_type": "ENERGY",
                        "method": {
                            "identifier": "hf",
                            "display_name": "Hartree-Fock",
                            "registry": "chemdft.method",
                        },
                        "basis": {
                            "identifier": "sto-3g",
                            "display_name": "STO-3G",
                            "registry": "chemdft.basis",
                        },
                        "charge": 0,
                        "multiplicity": 1,
                        "engine_preference": {"engine": "pyscf"},
                    }
                    submit_args = {
                        "structure_version": {
                            "project_id": p_id,
                            "entity_type": "structure.version",
                            "entity_id": v_id,
                        },
                        "specification": spec,
                        "provider_preference": "LOCAL",
                        "idempotency_key": f"calc-{v_id[:8]}-hf-sto3g",
                    }
                    return ModelResponse(
                        content=(
                            "I propose submitting a single-point HF/STO-3G energy calculation "
                            "for this structure. This action requires approval."
                        ),
                        tool_calls=(
                            ModelToolCall(
                                id=f"call_{uuid4().hex[:8]}",
                                name="calculation.submit",
                                arguments_json=json.dumps(submit_args),
                            ),
                        ),
                        usage=ModelUsage(input_tokens=300, output_tokens=50, latency_ms=15),
                        model_identifier=request.model_identifier or "fake-standard",
                        provider="fake",
                    )

        # Check if researcher promotion cleared a gate and requested calculation planning
        promoted_msg = next(
            (
                m.content
                for m in request.messages
                if "promoted by researcher" in m.content and "StructureVersion" in m.content
            ),
            None,
        )
        if promoted_msg:
            v_match = re.search(r"StructureVersion ([0-9a-f-]+)", promoted_msg)
            if v_match:
                target_version_id = v_match.group(1)
                p_match = re.search(r"project ([0-9a-f-]+)", promoted_msg) or re.search(
                    r'"project_id":\s*"([0-9a-f-]+)"',
                    request.system_prompt,
                )
                target_project_id = p_match.group(1) if p_match else "default-project"
                has_calc_call = any(
                    "calculation_id" in tr or "approval_id" in tr for tr in tool_results
                )
                if not has_calc_call:
                    calc_args = {
                        "structure_version": {
                            "project_id": target_project_id,
                            "entity_type": "structure.version",
                            "entity_id": target_version_id,
                        },
                        "specification": {
                            "task_type": "ENERGY",
                            "method": {
                                "identifier": "b3lyp",
                                "display_name": "B3LYP",
                                "registry": "chemdft.method",
                            },
                            "basis": {
                                "identifier": "sto-3g",
                                "display_name": "STO-3G",
                                "registry": "chemdft.basis",
                            },
                            "charge": 0,
                            "multiplicity": 1,
                            "engine_preference": {"engine": "pyscf"},
                        },
                        "provider_preference": "LOCAL",
                        "idempotency_key": f"calc-{target_version_id[:8]}-b3lyp-sto3g",
                    }
                    return ModelResponse(
                        content=(
                            "The human researcher has verified and promoted candidate to "
                            f"authoritative StructureVersion {target_version_id}. "
                            "I now propose submitting a B3LYP/STO-3G single-point energy "
                            "calculation. This calculation requires human execution approval."
                        ),
                        tool_calls=(
                            ModelToolCall(
                                id=f"call_{uuid4().hex[:8]}",
                                name="calculation.submit",
                                arguments_json=json.dumps(calc_args),
                            ),
                        ),
                        usage=ModelUsage(input_tokens=280, output_tokens=50, latency_ms=15),
                        model_identifier=request.model_identifier or "fake-standard",
                        provider="fake",
                    )

        # Autonomous Document Figure Extraction and Recognition Sequence
        is_extract_request = any(
            t in user_lower
            for t in (
                "extract figure",
                "extract candidate",
                "recognize candidate",
                "recognize diagram",
                "scientific reconstruction",
                "reconstruct candidate",
                "autonomous workflow",
            )
        )
        if is_extract_request or any(
            any(
                k in tr for k in ("candidates", "representation_id", "is_valid", "review_requested")
            )
            for tr in tool_results
        ):
            # Check if user already provided candidate_id
            cand_in_msg = re.search(
                r"candidate\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})",
                latest_user_message,
                re.IGNORECASE,
            )
            cand_id = cand_in_msg.group(1) if cand_in_msg else None

            # 1. Did we extract figures or need to?
            extract_tr = next(
                (tr for tr in tool_results if "candidates" in tr),
                None,
            )
            if not cand_id and not extract_tr:
                doc_in_msg = re.search(
                    r"document\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})",
                    latest_user_message,
                    re.IGNORECASE,
                ) or re.search(
                    r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})",
                    latest_user_message,
                )
                doc_id = doc_in_msg.group(1) if doc_in_msg else "doc-1"
                return ModelResponse(
                    content="Extracting figures from scientific document.",
                    tool_calls=(
                        ModelToolCall(
                            id=f"call_ext_{uuid4().hex[:8]}",
                            name="document.figures.extract",
                            arguments_json=json.dumps({"document_id": doc_id}),
                        ),
                    ),
                    usage=ModelUsage(input_tokens=200, output_tokens=30, latency_ms=10),
                    model_identifier=request.model_identifier or "fake-standard",
                    provider="fake",
                )

            if not cand_id:
                candidates_list = extract_tr.get("candidates") or [] if extract_tr else []
                if not candidates_list:
                    return ModelResponse(
                        content="No figure candidates found in the document.",
                        tool_calls=(),
                        usage=ModelUsage(input_tokens=150, output_tokens=20, latency_ms=5),
                        model_identifier=request.model_identifier or "fake-standard",
                        provider="fake",
                    )
                cand_id = candidates_list[0]["id"]

            # 2. Did we recognize diagram?
            recog_tr = next(
                (
                    tr
                    for tr in tool_results
                    if (
                        tr.get("candidate_id") == cand_id
                        or (
                            isinstance(tr.get("candidate"), dict)
                            and str(tr["candidate"].get("id")) == str(cand_id)
                        )
                    )
                    and ("canonical_isomeric_smiles" in tr or "status" in tr)
                ),
                None,
            )
            if not recog_tr:
                return ModelResponse(
                    content=f"Running molecular recognition on candidate {cand_id}.",
                    tool_calls=(
                        ModelToolCall(
                            id=f"call_rec_{uuid4().hex[:8]}",
                            name="structure_candidate.recognize",
                            arguments_json=json.dumps({"candidate_id": cand_id}),
                        ),
                    ),
                    usage=ModelUsage(input_tokens=220, output_tokens=35, latency_ms=10),
                    model_identifier=request.model_identifier or "fake-standard",
                    provider="fake",
                )

            smiles = (
                recog_tr.get("canonical_isomeric_smiles")
                or (recog_tr.get("proposal") or {}).get("canonical_isomeric_smiles")
                or "CCO"
            )
            # 3. Did we validate graph?
            val_tr = next(
                (
                    tr
                    for tr in tool_results
                    if "validation" in tr or "is_valid" in tr or "differences" in tr
                ),
                None,
            )
            if not val_tr:
                return ModelResponse(
                    content=f"Validating chemical graph for candidate {cand_id}.",
                    tool_calls=(
                        ModelToolCall(
                            id=f"call_val_{uuid4().hex[:8]}",
                            name="structure_candidate.validate_graph",
                            arguments_json=json.dumps(
                                {
                                    "candidate_id": cand_id,
                                    "content": smiles,
                                    "format": "SMILES",
                                }
                            ),
                        ),
                    ),
                    usage=ModelUsage(input_tokens=240, output_tokens=35, latency_ms=10),
                    model_identifier=request.model_identifier or "fake-standard",
                    provider="fake",
                )

            # 4. Did we request review?
            rev_tr = next(
                (tr for tr in tool_results if tr.get("gate_status") or tr.get("review_requested")),
                None,
            )
            if not rev_tr:
                return ModelResponse(
                    content=(
                        "Chemical graph validated. Requesting researcher review "
                        "and Ketcher promotion "
                        f"for candidate {cand_id}."
                    ),
                    tool_calls=(
                        ModelToolCall(
                            id=f"call_gate_{uuid4().hex[:8]}",
                            name="structure_candidate.request_review",
                            arguments_json=json.dumps(
                                {
                                    "candidate_id": cand_id,
                                    "review_reason": (
                                        "Autonomous reconstruction completed chemical graph "
                                        "validation. Human researcher Ketcher review and promotion "
                                        "required before calculations."
                                    ),
                                }
                            ),
                        ),
                    ),
                    usage=ModelUsage(input_tokens=260, output_tokens=40, latency_ms=10),
                    model_identifier=request.model_identifier or "fake-standard",
                    provider="fake",
                )

            return ModelResponse(
                content=(
                    f"Execution suspended at researcher review gate for candidate {cand_id}. "
                    "Waiting for human researcher review and promotion."
                ),
                tool_calls=(),
                usage=ModelUsage(input_tokens=200, output_tokens=30, latency_ms=5),
                model_identifier=request.model_identifier or "fake-standard",
                provider="fake",
            )

        # If user asks about documents or paper
        if "paper" in user_lower or "document" in user_lower or "lattice" in user_lower:
            has_docs = any("documents" in tr for tr in tool_results)
            has_doc_detail = any(
                "candidates" in tr or "evidence_candidates" in tr for tr in tool_results
            )
            if not has_docs and not has_doc_detail:
                return ModelResponse(
                    content="I will list the scientific documents in this project.",
                    tool_calls=(
                        ModelToolCall(
                            id=f"call_{uuid4().hex[:8]}",
                            name="document.list",
                            arguments_json="{}",
                        ),
                    ),
                    usage=ModelUsage(input_tokens=180, output_tokens=30, latency_ms=10),
                    model_identifier=request.model_identifier or "fake-standard",
                    provider="fake",
                )
            for tr in tool_results:
                if tr.get("documents"):
                    doc_id = tr["documents"][0]["id"]
                    return ModelResponse(
                        content="I will inspect the evidence candidates in this document.",
                        tool_calls=(
                            ModelToolCall(
                                id=f"call_{uuid4().hex[:8]}",
                                name="document.get",
                                arguments_json=json.dumps({"document_id": doc_id}),
                            ),
                        ),
                        usage=ModelUsage(input_tokens=220, output_tokens=35, latency_ms=10),
                        model_identifier=request.model_identifier or "fake-standard",
                        provider="fake",
                    )

        # Default: list project structures and summary
        has_structs = any("structures" in tr for tr in tool_results)
        if not has_structs:
            return ModelResponse(
                content=(
                    "I will check the structures and documents in this project "
                    "to answer your question."
                ),
                tool_calls=(
                    ModelToolCall(
                        id=f"call_{uuid4().hex[:8]}",
                        name="structure.list",
                        arguments_json="{}",
                    ),
                ),
                usage=ModelUsage(input_tokens=180, output_tokens=30, latency_ms=10),
                model_identifier=request.model_identifier or "fake-standard",
                provider="fake",
            )

        # Once structures are known, give grounded overview
        for tr in tool_results:
            if "structures" in tr:
                count = len(tr["structures"])
                names = ", ".join(s.get("name", "structure") for s in tr["structures"][:3])
                return ModelResponse(
                    content=(
                        f"This project contains {count} committed structure(s) ({names}). "
                        "You can view their 3D coordinates, inspect version provenance, "
                        "run PySCF quantum chemistry calculations, or analyze "
                        "experimental datasets."
                    ),
                    tool_calls=(),
                    usage=ModelUsage(input_tokens=220, output_tokens=60, latency_ms=15),
                    model_identifier=request.model_identifier or "fake-standard",
                    provider="fake",
                )

        return ModelResponse(
            content=(
                "I am the ChemDFT AI Scientist. How can I assist with your project's "
                "structures, calculations, or evidence?"
            ),
            tool_calls=(),
            usage=ModelUsage(input_tokens=100, output_tokens=30, latency_ms=10),
            model_identifier=request.model_identifier or "fake-standard",
            provider="fake",
        )


class HttpOpenAIModelGateway:
    def __init__(self, settings: Settings) -> None:
        self._api_key = settings.ai_api_key.get_secret_value() if settings.ai_api_key else ""
        self._base_url = settings.ai_api_base_url.rstrip("/")
        self._provider = settings.ai_provider
        self._model_fast = settings.ai_model_fast
        self._model_standard = settings.ai_model_standard
        self._model_reasoning = settings.ai_model_reasoning
        self._timeout = settings.ai_timeout_seconds

    def _resolve_model(self, tier: ModelTier) -> str:
        if tier is ModelTier.FAST:
            return self._model_fast
        if tier is ModelTier.REASONING:
            return self._model_reasoning
        return self._model_standard

    @staticmethod
    def _retry_delay(attempt: int, retry_after: str | None) -> float | None:
        """Bounded exponential backoff, respecting a provider Retry-After header.

        Returns None when the provider requests a delay longer than our
        synchronous retry window, signaling that the caller must NOT retry
        prematurely (the request may already be in flight on the provider side
        and retrying early could double-bill).

        Deliberately small: model calls are synchronous and the caller holds a
        reserved budget slot, so we never sleep long enough to starve other work.
        """
        base = 1.0
        max_delay = 10.0
        if retry_after:
            try:
                seconds = float(retry_after)
                if seconds <= 0:
                    return min(base * (2**attempt), max_delay)
                if seconds <= max_delay:
                    return seconds
                # Provider asks us to wait longer than our synchronous window.
                # Do not retry prematurely; return None so the caller raises.
                return None
            except ValueError:
                # HTTP-date Retry-After values are not parsed; fall back to
                # bounded exponential backoff rather than guessing.
                pass
        return min(base * (2**attempt), max_delay)

    def generate(self, request: ModelRequest) -> ModelResponse:
        if not self._api_key:
            raise ModelCredentialMissingError("AI API key is not configured.")
        if type(request.max_attempts) is not int or not 1 <= request.max_attempts <= 3:
            raise ModelRequestNotSentError("Invalid bounded provider attempt count.")

        model = request.model_identifier or self._resolve_model(request.model_tier)
        # Translation of stable product tool IDs belongs here, never in authorization or
        # application contracts.
        wire_names = wire_tool_names(request.tools)
        product_names = {wire: product for product, wire in wire_names.items()}
        messages_payload = chat_messages_payload(request, wire_names)
        if request.reserved_input_tokens is not None:
            required = request_input_bound(request).tokens
            if required > request.reserved_input_tokens:
                raise ModelInputBudgetInsufficientError(required, request.reserved_input_tokens)

        moonshot = self._provider == "moonshot"
        spec = MOONSHOT_MODELS.get(model) if moonshot else None
        if moonshot and spec is None:
            raise ModelRequestNotSentError("This Moonshot model has no reviewed request shape.")
        if moonshot and (request.top_p is not None or request.chat_template_kwargs is not None):
            raise ModelRequestNotSentError(
                "Moonshot fixes its own sampling and takes neither top_p nor chat_template_kwargs."
            )
        payload: dict[str, object] = {"model": model, "messages": messages_payload}
        if spec is not None:
            payload.update(dict(spec["extra"]))  # type: ignore[arg-type]
        else:
            payload["temperature"] = request.temperature
            payload.update(sampling_payload_fields(request))
        if request.max_tokens:
            # Some models (e.g. NVIDIA Nemotron) require a minimum output token
            # budget. We must never silently increase max_tokens beyond the
            # authorized reservation; if the reservation is below the provider
            # minimum, raise an explicit typed error so the caller can decide
            # whether to authorize a larger budget.
            model_lower = model.lower()
            min_output = 512 if "nemotron" in model_lower else 1
            if request.max_tokens < min_output:
                raise ModelOutputBudgetInsufficientError(
                    required=min_output, requested=request.max_tokens
                )
            payload[str(spec["token_field"]) if spec else "max_tokens"] = request.max_tokens

        if request.tools:
            payload["tools"] = chat_tools_payload(request, wire_names)

        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{self._base_url}/chat/completions",
            data=data,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self._api_key}",
            },
            method="POST",
        )

        # Bounded retries only for provider-side failures that did not consume
        # the request (429 rate limit, 5xx server errors). Connection timeouts
        # and network failures are NOT retried: the request may have reached
        # the provider and been billed even though no response was received.
        # The service layer reserves budget once and settles against the final
        # response's usage; an ambiguous failure is settled as uncertain.
        max_attempts = request.max_attempts
        body: dict[str, object] | None = None
        latency_ms = 0
        for attempt in range(max_attempts):
            start_time = time.monotonic()
            trace = TransportAttempt(self._timeout, attempt + 1, start_time)
            diagnostic = trace.diagnostic

            try:
                with open_response(req, timeout=self._timeout) as response:
                    trace.headers_ms = int((time.monotonic() - start_time) * 1000)
                    observed_status = getattr(response, "status", None)
                    trace.http_status = observed_status if type(observed_status) is int else None
                    trace.phase = "RESPONSE_BODY"
                    encoded = response.read(1048577)
                    if len(encoded) > 1048576:
                        raise ModelGatewayError(
                            "AI provider response exceeded the bounded protocol limit.",
                            transport=diagnostic("RESPONSE_TOO_LARGE"),
                        )
                    trace.phase = "PARSE_RESPONSE"
                    body = json.loads(encoded.decode("utf-8"))
                    latency_ms = int((time.monotonic() - start_time) * 1000)
                    transport = diagnostic("COMPLETE")
                    break
            except urllib.error.HTTPError as error:
                trace.http_status, trace.phase = error.code, "RESPONSE_HEADERS"
                latency_ms = int((time.monotonic() - start_time) * 1000)
                if error.code in (401, 403):
                    raise ModelAuthenticationError(
                        "Invalid or expired AI API credentials.", transport=diagnostic("HTTP_ERROR")
                    ) from None
                retryable = error.code == 429 or 500 <= error.code < 600
                if not retryable or attempt == max_attempts - 1:
                    if error.code == 429:
                        raise ModelRateLimitError(
                            "AI provider rate limit reached.",
                            transport=diagnostic("HTTP_ERROR", retry=True),
                        ) from None
                    raise ModelProviderUnavailableError(
                        f"AI provider returned HTTP {error.code}.",
                        transport=diagnostic("HTTP_ERROR", retry=retryable),
                    ) from None
                delay = self._retry_delay(attempt, error.headers.get("Retry-After"))
                if delay is None:
                    # The provider asked us to wait longer than our synchronous
                    # retry window. Do not retry prematurely; surface the rate
                    # limit so the caller can back off or notify the user.
                    if error.code == 429:
                        raise ModelRateLimitError(
                            "AI provider rate limit reached; retry later.",
                            transport=diagnostic("HTTP_ERROR", retry=True),
                        ) from None
                    raise ModelProviderUnavailableError(
                        f"AI provider returned HTTP {error.code}.",
                        transport=diagnostic("HTTP_ERROR", retry=retryable),
                    ) from None
            except TransportFailure as error:
                trace.phase = error.phase
                error_type = (
                    ModelTimeoutError if error.kind.endswith("TIMEOUT") else ModelNetworkError
                )
                raise error_type(
                    "AI provider transport failed.", transport=diagnostic(error.kind)
                ) from None
            except TimeoutError:
                # The request may have been received and billed by the provider
                # even though we did not get a response. Do not retry; fail so
                # the service layer settles the reservation as uncertain usage.
                kind = "READ_TIMEOUT" if trace.phase == "RESPONSE_BODY" else "TIMEOUT_PHASE_UNKNOWN"
                raise ModelTimeoutError(
                    "AI provider request timed out.", transport=diagnostic(kind)
                ) from None
            except urllib.error.URLError as error:
                reason = error.reason
                kind = (
                    "DNS_ERROR"
                    if isinstance(reason, socket.gaierror)
                    else "TLS_ERROR"
                    if isinstance(reason, ssl.SSLError)
                    else "TIMEOUT_PHASE_UNKNOWN"
                    if isinstance(reason, TimeoutError)
                    else "NETWORK_ERROR"
                )
                error_type = (
                    ModelTimeoutError if isinstance(reason, TimeoutError) else ModelNetworkError
                )
                raise error_type(
                    "AI provider transport failed.", transport=diagnostic(kind)
                ) from None
            except ssl.SSLError:
                raise ModelNetworkError(
                    "AI provider TLS failed.", transport=diagnostic("TLS_ERROR")
                ) from None
            except OSError:
                raise ModelNetworkError(
                    "AI provider network failed.", transport=diagnostic("NETWORK_ERROR")
                ) from None
            except (UnicodeError, ValueError):
                raise ModelGatewayError(
                    "Malformed AI provider response.", transport=diagnostic("MALFORMED_OUTPUT")
                ) from None
            except ModelGatewayError:
                raise
            except Exception:
                raise ModelGatewayError(
                    "AI provider request failed.", transport=diagnostic("PROTOCOL_ERROR")
                ) from None
            time.sleep(delay)
        def protocol_error(message, **kwargs):
            trace.phase = "PARSE_RESPONSE"
            return ModelGatewayError(
                message, transport=trace.diagnostic("MALFORMED_OUTPUT"), **kwargs
            )

        if (
            not isinstance(body, dict)
            or not isinstance(body.get("choices"), list)
            or not body["choices"]
        ):
            raise protocol_error("Invalid AI provider response.")
        choice = body["choices"][0]
        if not isinstance(choice, dict) or not isinstance(choice.get("message"), dict):
            raise protocol_error("Invalid AI provider message.")
        message = choice.get("message", {})
        # Explicitly drop provider reasoning/chain-of-thought text so it can never be
        # persisted to run records, audit logs, or surfaced to the end user.
        message.pop("reasoning_content", None)
        content = message.get("content")
        raw_tool_calls = message.get("tool_calls") or []

        if content is not None and (not isinstance(content, str) or len(content) > 65536):
            raise protocol_error("Invalid AI provider content.")
        if not isinstance(raw_tool_calls, list) or len(raw_tool_calls) > 16:
            raise protocol_error("Invalid AI provider tool calls.")
        tool_calls: list[ModelToolCall] = []
        for raw in raw_tool_calls:
            if not isinstance(raw, dict) or not isinstance(raw.get("function"), dict):
                raise protocol_error("Invalid AI provider tool call.")
            func = raw.get("function", {})
            if (
                not isinstance(func.get("name"), str)
                or not 1 <= len(func["name"]) <= 64
                or not isinstance(func.get("arguments", "{}"), str)
                or len(func.get("arguments", "{}")) > 16384
            ):
                raise protocol_error("Invalid AI provider tool arguments.")
            if not isinstance(raw.get("id", ""), str) or len(raw.get("id", "")) > 128:
                raise protocol_error("Invalid AI provider tool call identifier.")
            tool_calls.append(
                ModelToolCall(
                    id=raw.get("id", str(uuid4())),
                    name=product_names.get(func.get("name", ""), func.get("name", "")),
                    arguments_json=func.get("arguments", "{}"),
                )
            )

        finish_reason = choice.get("finish_reason") or "stop"
        # A truncated response (output token budget exhausted) may contain incomplete
        # text or malformed tool-call arguments. Refuse to consume it rather than
        # persisting or acting on partial data.
        # Missing usage means we cannot determine exact provider billing. We do
        # NOT invent token counts; the service layer settles the reservation as
        # uncertain rather than treating unknown usage as zero.
        usage_dict = body.get("usage")
        usage: ModelUsage | None = None
        reported_usage = None
        if usage_dict is not None:
            if not isinstance(usage_dict, dict):
                raise protocol_error("Invalid AI provider usage.")
            details = usage_dict.get("prompt_tokens_details")
            if details is not None and not isinstance(details, dict):
                raise protocol_error("Invalid AI provider usage.")
            reported_usage = {
                "input_tokens": usage_dict.get("prompt_tokens"),
                "output_tokens": usage_dict.get("completion_tokens"),
                "cached_tokens": (details or {}).get("cached_tokens"),
            }
            if any(type(n) is not int or n < 0 for n in reported_usage.values() if n is not None):
                raise protocol_error("Invalid AI provider usage.")
            # An empty/partial object is not evidence of a zero-token call.
            # Core counts must both be reported; cache details are optional.
            if not {"prompt_tokens", "completion_tokens"} <= usage_dict.keys():
                usage_dict = None
        if usage_dict is not None:
            details = usage_dict.get("prompt_tokens_details")
            if details is not None and not isinstance(details, dict):
                raise protocol_error("Invalid AI provider usage.")
            counts = (
                usage_dict["prompt_tokens"],
                usage_dict["completion_tokens"],
                (details or {}).get("cached_tokens"),
            )
            if any(type(n) is not int or n < 0 for n in counts[:2]) or (
                counts[2] is not None
                and (type(counts[2]) is not int or counts[2] < 0 or counts[2] > counts[0])
            ):
                raise protocol_error("Invalid AI provider usage.")
            usage = ModelUsage(
                input_tokens=usage_dict.get("prompt_tokens", 0),
                output_tokens=usage_dict.get("completion_tokens", 0),
                latency_ms=latency_ms,
                cached_tokens=(details or {}).get("cached_tokens"),
            )

        if finish_reason == "length":
            trace.phase = "PARSE_RESPONSE"
            raise ModelOutputTruncatedError(
                "AI provider response was truncated (output token limit reached).",
                usage=usage,
                reported_usage=reported_usage,
                transport=trace.diagnostic("MALFORMED_OUTPUT"),
            )

        return ModelResponse(
            content=content,
            tool_calls=tuple(tool_calls),
            usage=usage,
            model_identifier=body.get("model", model),
            provider=self._provider,
            finish_reason=finish_reason,
            reported_usage=reported_usage,
            transport=transport,
        )


class UnavailableModelGateway:
    """Unavailable is explicit, never replaced with a model or credential source."""

    def generate(self, request: ModelRequest) -> ModelResponse:
        raise ModelProviderNotConfiguredError(
            "The selected AI provider is unavailable; configure AI settings."
        )


def build_model_gateway(settings: Settings) -> ModelGateway:
    from ..auth import dev_identity_permitted

    if settings.ai_provider == "fake" and dev_identity_permitted(settings):
        return FakeModelGateway()
    if (
        settings.run_ai_integration
        and settings.ai_api_key
        and settings.ai_provider in {"openai", "openrouter", "huggingface", "nvidia"}
    ):
        return HttpOpenAIModelGateway(settings)
    return UnavailableModelGateway()
