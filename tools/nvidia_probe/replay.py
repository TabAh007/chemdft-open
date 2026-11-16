"""Replay a model's calculation.submit arguments through ChemDFT's real approval-time steps.

The strict probe check (plan.judge) validates the model's RAW arguments against
CalculationSubmitInput. Production does not: when a model calls calculation.submit, the AI
Scientist first runs tool_policy.normalize_calculation_submit_arguments, which reshapes loose
model output (it rebuilds structure_version from the entity id alone, takes method and basis
display names and registries from the server catalogue, defaults charge and multiplicity from
the structure, accepts engine_preference as a string and assigns the idempotency key), and only
then validates the result and applies the planning profile guard. A raw strict failure is
therefore not by itself a production rejection.

This module reruns exactly those production functions, unchanged, against a disposable SQLite
project rebuilt offline from the same supplied-H2 bytes the frozen fixture was captured from.
The fixture's frozen identifiers are mapped to the replica's, and nothing else is altered. Not
replayed: validate_compute_guidance (engine availability, the method/basis capability list,
Navigator state and resource estimates), which depends on the local environment and starts no
process here.

Content-free: the arguments exist only in memory, are never stored, and the verdict holds codes
and sanitized field paths only. No network, no credentials, no scientific engine.
"""

from __future__ import annotations

import copy
import re
from uuid import UUID

from .plan import planning_context, sanitized_validation_errors

PIPELINE = (
    "tool_policy.normalize_calculation_submit_arguments, contracts.catalog.CalculationSubmitInput, "
    "planning_profiles.validate_profile_submission"
)
NOT_REPLAYED = ("validate_compute_guidance",)
_SAFE_CODE = re.compile(r"[A-Z][A-Z0-9_]{0,47}")


def _code(value) -> str:
    text = str(getattr(value, "value", value))
    return text if _SAFE_CODE.fullmatch(text) else "OTHER"


def adherence_codes(specification: dict) -> list[str]:
    """Prompt-adherence codes for a normalized specification (supplied-H2 HF/STO-3G energy)."""
    codes = []
    if specification["task_type"] != "ENERGY":
        codes.append("TASK_NOT_ENERGY")
    if specification["charge"] != 0 or specification["multiplicity"] != 1:
        codes.append("ELECTRONIC_STATE_MISMATCH")
    if specification["method"]["identifier"].lower() != "hf":
        codes.append("METHOD_NOT_HF")
    basis = specification.get("basis")
    if basis is None:
        codes.append("BASIS_MISSING")
    elif basis["identifier"].lower() != "sto-3g":
        codes.append("BASIS_NOT_STO3G")
    return codes


def case_adherence_codes(specification: dict, expect: dict) -> list[str]:
    """Adherence codes for a normalized specification against a planning case's expected values."""
    codes = []
    if specification["task_type"] != expect["task"]:
        codes.append("TASK_NOT_EXPECTED")
    engine = (specification.get("engine_preference") or {}).get("engine")
    if str(engine).lower() != expect["engine"]:
        codes.append("ENGINE_NOT_EXPECTED")
    if (specification["charge"], specification["multiplicity"]) != (
        expect["charge"],
        expect["multiplicity"],
    ):
        codes.append("ELECTRONIC_STATE_MISMATCH")
    if specification["method"]["identifier"].lower() != expect["method"]:
        codes.append("METHOD_NOT_EXPECTED")
    basis = specification.get("basis")
    if basis is None:
        codes.append("BASIS_MISSING")
    elif basis["identifier"].lower() != expect["basis"]:
        codes.append("BASIS_NOT_EXPECTED")
    return codes


class ProductionReplay:
    def __init__(self, sessions, store, project_id, context, substitutions, cleanup=None) -> None:
        self._sessions = sessions
        self._store = store
        self._project_id = str(project_id)
        self._context = context
        self._substitutions = dict(substitutions)
        self._cleanup = cleanup

    @classmethod
    def build(cls, fixture: dict) -> ProductionReplay:
        from .replica import Replica

        replica = Replica.build()
        try:
            project = replica.new_project()
            frozen = planning_context(fixture)
            context = frozen.model_copy(
                update={
                    "selection": frozen.selection.model_copy(
                        update={"selected_structure_version_id": UUID(project.version_id)}
                    )
                }
            )
            substitutions = {
                fixture["version_id"]: project.version_id,
                fixture["structure_id"]: project.structure_id,
                str(frozen.project_id): project.project_id,
            }
            return cls(
                replica.sessions,
                replica.store,
                project.project_id,
                context,
                substitutions,
                replica.close,
            )
        except BaseException:
            replica.close()
            raise

    def close(self) -> None:
        if self._cleanup is not None:
            self._cleanup()
            self._cleanup = None

    def _substitute(self, value):
        if isinstance(value, str):
            for frozen, replica in self._substitutions.items():
                value = value.replace(frozen, replica)
            return value
        if isinstance(value, dict):
            return {key: self._substitute(item) for key, item in value.items()}
        if isinstance(value, list):
            return [self._substitute(item) for item in value]
        return value

    def _guard_conditions(self, dumped: dict) -> list[str]:
        """Which of the profile guard's three conditions refused (names only, never values).

        Mirrors planning_profiles.validate_profile_submission; a test requires the two to agree.
        """
        spec = dumped["specification"]
        conditions = []
        if spec["task_type"] != "ENERGY":
            conditions.append("TASK_NOT_ENERGY")
        if spec["engine_preference"]["engine"] != "pyscf":
            conditions.append("ENGINE_NOT_PYSCF")
        selected = str(self._context.selection.selected_structure_version_id)
        if dumped["structure_version"]["entity_id"] != selected:
            conditions.append("VERSION_NOT_SELECTED")
        return conditions

    def replay(self, arguments: dict) -> dict:
        from chemdft_api.ai.planning_profiles import validate_profile_submission
        from chemdft_api.ai.providers import AIFoundationError
        from chemdft_api.ai.tool_policy import normalize_calculation_submit_arguments
        from chemdft_api.contracts.catalog import CalculationSubmitInput
        from chemdft_api.tool_registry.registry import ToolInvocationError
        from pydantic import ValidationError

        verdict: dict = {"accepted": False, "stage": None, "error_code": None}
        args = self._substitute(copy.deepcopy(arguments))
        try:
            with self._sessions() as session:
                normalized = normalize_calculation_submit_arguments(
                    session,
                    self._project_id,
                    args,
                    idempotency_key="ai-approval:probe-replay",
                    object_store=self._store,
                )
        except ToolInvocationError as error:
            verdict.update(stage="NORMALIZATION", error_code=_code(error.code))
            return verdict
        except Exception as error:  # production raised something unclassified: record its type only
            verdict.update(
                stage="NORMALIZATION", error_code=f"UNEXPECTED_{type(error).__name__}"[:48]
            )
            return verdict
        try:
            parsed = CalculationSubmitInput.model_validate(normalized)
        except ValidationError as error:
            verdict.update(stage="SCHEMA", **sanitized_validation_errors(error))
            return verdict
        dumped = parsed.model_dump(mode="json")
        try:
            validate_profile_submission(self._context, dumped)
        except AIFoundationError as error:
            verdict.update(
                stage="PROFILE_GUARD",
                error_code=_code(error.code),
                guard_conditions=self._guard_conditions(dumped),
            )
            return verdict
        adherence = adherence_codes(dumped["specification"])
        verdict.update(
            accepted=True,
            adherence_failure_codes=adherence,
            valid_for_prompt=not adherence,
        )
        return verdict
