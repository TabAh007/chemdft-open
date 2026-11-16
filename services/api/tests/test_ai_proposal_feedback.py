"""AI-6 offline checks: every refusal becomes a stable code, a summary and value-free issues.

Pure functions, no model or engine. Summaries keep the wording earlier clients already see in the
``error`` key; issues name a field and a problem class, with allowed values taken from the server's
own capability and enum tables, never from what the model supplied.
"""

import json

import pytest
from chemdft_api.ai.proposal_feedback import (
    ARGUMENT_SCHEMA,
    ELECTRONIC_STATE,
    ENGINE_CAPABILITY,
    ENGINE_UNAVAILABLE,
    NAVIGATOR,
    NOT_PERMITTED,
    PROFILE_SCOPE,
    STRUCTURE_VERSION,
    UNEXPECTED,
    Issue,
    ProposalRefused,
    Refusal,
    capability_issues,
    classify_refusal,
    mismatch_refusal,
    profile_issues,
    safe_detail,
    schema_issues,
)
from chemdft_api.ai.providers import AIFoundationError
from chemdft_api.ai.request_match import match_request
from chemdft_api.contracts.catalog import CalculationSubmitInput
from chemdft_api.contracts.tools import ToolErrorCode
from chemdft_api.errors import ApplicationError, EngineUnavailable, UnsupportedCalculation
from chemdft_api.tool_registry.registry import ToolInvocationError
from pydantic import ValidationError

SELECTED = "11111111-1111-4111-8111-111111111111"
SENTINEL = "SENTINEL-NEVER-ECHOED-3141"


def arguments(*, method="hf", basis="sto-3g", task="ENERGY", engine="pyscf", **spec_extra):
    return {
        "structure_version": {
            "project_id": "00000000-0000-4000-8000-000000000001",
            "entity_type": "structure.version",
            "entity_id": SELECTED,
        },
        "specification": {
            "task_type": task,
            "method": {
                "identifier": method,
                "display_name": method.upper(),
                "registry": "chemdft.method",
            },
            "basis": {
                "identifier": basis,
                "display_name": basis.upper(),
                "registry": "chemdft.basis",
            }
            if basis
            else None,
            "charge": 0,
            "multiplicity": 1,
            "engine_preference": {"engine": engine},
            **spec_extra,
        },
        "idempotency_key": "ai-approval:test-key",
    }


def validation_error(**overrides):
    bad = arguments()
    bad["specification"].update(overrides)
    with pytest.raises(ValidationError) as caught:
        CalculationSubmitInput.model_validate(bad)
    return caught.value


def test_schema_refusals_name_fields_and_problems_and_never_the_supplied_values():
    error = validation_error(task_type=SENTINEL, charge=f"{SENTINEL}-c", invented=SENTINEL)
    refusal = classify_refusal(error, arguments=arguments())
    assert refusal.code == ARGUMENT_SCHEMA
    assert refusal.summary == "Tool arguments failed schema validation."  # unchanged wording
    fields = {issue.field: issue for issue in refusal.issues}
    assert fields["specification.task_type"].code == "INVALID_CHOICE"
    assert "ENERGY" in fields["specification.task_type"].allowed
    assert fields["specification.invented"].code == "NOT_ALLOWED"
    payload = json.dumps(refusal.model_payload()) + json.dumps(refusal.stored())
    assert SENTINEL not in payload and "SENTINEL" not in payload


def test_field_paths_are_identifier_shaped_so_a_model_cannot_smuggle_text_through_a_key():
    error = validation_error(**{"x" * 80: 1, "bad key!": 2})
    paths = [issue.field for issue in schema_issues(error)]
    assert all(path and len(path) < 120 and "!" not in path and " " not in path for path in paths)
    assert any(path.endswith(".?") for path in paths)


def test_issue_count_is_bounded():
    error = validation_error(**{f"extra{i}": i for i in range(30)})
    assert len(schema_issues(error)) <= 8


def test_profile_scope_issues_say_which_part_left_the_scope_and_what_is_allowed():
    other = arguments(task="GEOMETRY_OPTIMIZATION", engine="xtb")
    other["structure_version"]["entity_id"] = "22222222-2222-4222-8222-222222222222"
    issues = {issue.field: issue for issue in profile_issues(SELECTED, other)}
    assert issues["specification.task_type"].allowed == ("ENERGY",)
    assert issues["specification.task_type"].proposed == "GEOMETRY_OPTIMIZATION"
    assert issues["specification.engine_preference.engine"].allowed == ("pyscf",)
    assert issues["structure_version.entity_id"].code == STRUCTURE_VERSION
    assert issues["structure_version.entity_id"].allowed == (SELECTED,)
    assert profile_issues(SELECTED, arguments()) == ()
    refusal = classify_refusal(
        AIFoundationError(
            "PLANNING_PROFILE_MISMATCH",
            "This profile permits only a PySCF ENERGY proposal for the selected version.",
        ),
        arguments=other,
        selected_version_id=SELECTED,
    )
    assert refusal.code == PROFILE_SCOPE
    assert (
        refusal.summary
        == "This profile permits only a PySCF ENERGY proposal for the selected version."
    )
    assert len(refusal.issues) == 3


@pytest.mark.parametrize(
    "detail, code, expected_in_summary",
    [
        (
            "Target structure version 'abc-123' does not exist in project.",
            STRUCTURE_VERSION,
            "missing or does not exist",
        ),
        (
            "Structure electronic state mismatch: odd electron count for multiplicity 1",
            ELECTRONIC_STATE,
            "electronic state",
        ),
        (
            (
                "This structure does not carry an authoritative electronic state. Explicit charge "
                "and multiplicity are required before submission."
            ),
            ELECTRONIC_STATE,
            "electronic state",
        ),
        ("Navigator does not permit this action: NO_COORDINATES", NAVIGATOR, "Navigator"),
    ],
)
def test_tool_errors_are_classified_and_quoted_fragments_are_masked(
    detail, code, expected_in_summary
):
    error_code = (
        ToolErrorCode.NOT_FOUND
        if "version" in detail
        else ToolErrorCode.SCIENTIFIC_VALIDATION_FAILED
    )
    refusal = classify_refusal(
        ToolInvocationError(error_code, detail), arguments=arguments(), selected_version_id=SELECTED
    )
    assert refusal.code == code and expected_in_summary in refusal.summary
    assert "abc-123" not in json.dumps(refusal.model_payload())
    if code == STRUCTURE_VERSION:
        assert refusal.issues[0].allowed == (SELECTED,)


def test_other_tool_errors_get_honest_generic_classes():
    forbidden = classify_refusal(ToolInvocationError(ToolErrorCode.FORBIDDEN, "no"), arguments={})
    assert forbidden.code == NOT_PERMITTED
    unavailable = classify_refusal(
        ToolInvocationError(
            ToolErrorCode.CAPABILITY_UNAVAILABLE, "AWS execution supports PySCF only."
        ),
        arguments={},
    )
    assert unavailable.code == ENGINE_CAPABILITY and "AWS execution" in unavailable.summary
    required = classify_refusal(
        ToolInvocationError(
            ToolErrorCode.VALIDATION_ERROR, "A method is required to submit a calculation."
        ),
        arguments={},
    )
    assert required.code == ARGUMENT_SCHEMA and required.summary.startswith("A method is required")


def test_capability_refusals_are_explained_from_the_engine_tables():
    issues = {i.field: i for i in capability_issues(arguments(method="mp2", basis="cc-pvdz"))}
    assert issues["specification.method.identifier"].allowed == ("b3lyp", "hf", "pbe")
    assert issues["specification.basis.identifier"].allowed == (
        "6-31g",
        "def2-svp",
        "def2-svpd",
        "sto-3g",
    )
    missing = capability_issues(arguments(basis=None))
    assert [(i.field, i.allowed) for i in missing] == [
        ("specification.basis", ("6-31g", "def2-svp", "def2-svpd", "sto-3g"))
    ]
    heavy = capability_issues(arguments(method="hf", basis="6-31g"), atomic_numbers=(1, 35))
    assert heavy and "atomic number 30" in heavy[0].message and "sto-3g" in heavy[0].allowed
    assert capability_issues(arguments(), atomic_numbers=(1, 8)) == ()
    features = capability_issues(arguments(dispersion={"model": "d3"}, solvation={"model": "pcm"}))
    assert {i.field for i in features} == {"specification.dispersion", "specification.solvation"}
    assert capability_issues(arguments(engine="orca"))[0].allowed == (
        "crest",
        "psi4",
        "pyscf",
        "xtb",
    )


def test_the_explanation_agrees_with_the_real_capability_validator():
    from chemdft_api.config import Settings
    from chemdft_api.scientific.engines.registry import validate_capability

    hosted = Settings(_env_file=None, compute_local_enabled=False)  # no engine probe in tests
    for variant in (
        arguments(method="mp2"),
        arguments(basis=None),
        arguments(basis="cc-pvdz"),
        arguments(task="NMR"),
    ):
        spec = CalculationSubmitInput.model_validate(variant).specification
        with pytest.raises(UnsupportedCalculation):
            validate_capability(spec, hosted)
        assert capability_issues(variant), variant
    for variant in (arguments(), arguments(method="b3lyp", basis="def2-svp")):
        validate_capability(CalculationSubmitInput.model_validate(variant).specification, hosted)
        assert capability_issues(variant) == ()


def test_capability_and_engine_errors_keep_their_default_wording():
    refusal = classify_refusal(
        UnsupportedCalculation(f"Basis '{SENTINEL}' is unsupported by engine 'pyscf'."),
        arguments=arguments(basis="cc-pvdz"),
        default_detail=UnsupportedCalculation.default_detail,
    )
    assert refusal.code == ENGINE_CAPABILITY
    assert (
        refusal.summary == "Requested calculation is outside the engine's supported capability set."
    )
    assert SENTINEL not in json.dumps(refusal.model_payload())
    gone = classify_refusal(
        EngineUnavailable("x"), arguments={}, default_detail=EngineUnavailable.default_detail
    )
    assert gone.code == ENGINE_UNAVAILABLE and "Do not retry with the same engine" in gone.next_step


def test_unknown_errors_get_a_generic_server_authored_refusal():
    refusal = classify_refusal(
        ApplicationError(f"secret {SENTINEL}"), default_detail="Application action failed."
    )
    assert refusal.code == UNEXPECTED and refusal.summary == "Application action failed."
    assert SENTINEL not in json.dumps(refusal.model_payload())
    odd = classify_refusal(ValueError(SENTINEL), generic_detail="Tool arguments failed validation.")
    assert odd.code == ARGUMENT_SCHEMA and SENTINEL not in json.dumps(odd.model_payload())


def test_request_conflicts_become_actionable_issues_with_the_right_advice():
    named = match_request("Calculate the HF/STO-3G energy", arguments(basis="6-31g"))
    fixable = mismatch_refusal(named, "pyscf")
    assert "Correct only the listed fields" in fixable.next_step
    (issue,) = fixable.issues
    assert (issue.requested, issue.proposed, issue.allowed) == ("sto-3g", "6-31g", ())
    impossible = mismatch_refusal(
        match_request("Calculate the CCSD(T)/cc-pVDZ energy", arguments()), "pyscf"
    )
    assert "tell the researcher in plain text" in impossible.next_step
    methods = next(i for i in impossible.issues if i.field == "specification.method.identifier")
    assert methods.requested == "ccsd(t)" and methods.allowed == ("b3lyp", "hf", "pbe")
    assert "Do not substitute another method" in methods.message


def test_a_conflict_refusal_travels_as_one_exception_with_its_explanation():
    report = match_request("HF/STO-3G", arguments(basis="6-31g"))
    refusal = mismatch_refusal(report, "pyscf")
    error = ProposalRefused(refusal)
    assert (error.code, error.detail, error.refusal) == (refusal.code, refusal.summary, refusal)
    assert classify_refusal(error) is refusal


def test_the_researcher_blocker_is_short_plain_and_says_nothing_ran():
    refusal = Refusal(
        "REQUEST_MISMATCH",
        "The proposal does not match what the researcher asked for.",
        tuple(
            Issue("REQUEST_MISMATCH", "specification.basis.identifier", f"Issue {i} " + "x" * 400)
            for i in range(6)
        ),
        "Correct only the listed fields.",
    )
    text = refusal.blocker_text(3)
    assert "3 attempts" in text and "Nothing was submitted or computed" in text
    assert len(text) <= 1200 and text.count("\n- ") <= 4
    assert "1 attempt)" in refusal.blocker_text(1)


def test_safe_detail_masks_quoted_text_and_bounds_length():
    assert safe_detail("Version 'secret-id' and \"other\" missing") == "Version '…' and '…' missing"
    assert len(safe_detail("x" * 1000)) == 240 and safe_detail(None) == ""
