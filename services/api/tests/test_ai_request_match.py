"""AI-6 offline checks: a proposal must be what the researcher explicitly asked for.

Pure functions only: no model, project, engine or network. The vocabulary is the server's own
capability tables plus a list of well-known names it cannot run; unknown wording yields no
constraint, several values yield an AMBIGUOUS parameter, and one value is enforced.
"""

import pytest
from chemdft_api.ai.request_match import (
    AMBIGUOUS,
    MATCH,
    MISMATCH,
    NOT_SPECIFIED,
    match_request,
    proposal_summary,
    read_request,
)


def proposal(
    *,
    method="hf",
    basis="sto-3g",
    task="ENERGY",
    engine="pyscf",
    charge=0,
    multiplicity=1,
    **extra,
):
    spec = {
        "task_type": task,
        "method": {
            "identifier": method,
            "display_name": method.upper(),
            "registry": "chemdft.method",
        },
        "basis": {"identifier": basis, "display_name": basis.upper(), "registry": "chemdft.basis"}
        if basis
        else None,
        "charge": charge,
        "multiplicity": multiplicity,
        "engine_preference": {"engine": engine},
        **extra,
    }
    return {"structure_version": {"entity_id": "v"}, "specification": spec}


def outcomes(text, **proposed):
    report = match_request(text, proposal(**proposed))
    return {item.parameter: item.outcome for item in report.items}, report


def constraints(text):
    reading = read_request(text)
    return {c.parameter: (c.value, c.supported) for c in reading.constraints}, reading


@pytest.mark.parametrize(
    "text, expected",
    [
        (
            "Calculate the Hartree-Fock single-point energy of the selected H2 structure with "
            "PySCF using the STO-3G basis.",
            {
                "method": ("hf", True),
                "basis": ("sto-3g", True),
                "engine": ("pyscf", True),
                "task": ("ENERGY", True),
            },
        ),
        ("Plan HF/STO-3G for this molecule", {"method": ("hf", True), "basis": ("sto-3g", True)}),
        ("run b3lyp/6-31g", {"method": ("b3lyp", True), "basis": ("6-31g", True)}),
        (
            "PBE / def2-SVPD single point",
            {"method": ("pbe", True), "basis": ("def2-svpd", True), "task": ("ENERGY", True)},
        ),
        ("Use the def2-SVP basis set", {"basis": ("def2-svp", True)}),
        ("energy of ethanol", {}),
        ("Hello, what can you do?", {}),
        ("", {}),
    ],
)
def test_explicit_wording_becomes_constraints_and_other_wording_does_not(text, expected):
    found, reading = constraints(text)
    assert found == expected
    assert reading.ambiguous == ()


@pytest.mark.parametrize(
    "text, parameter, value",
    [
        ("Compute the PBE0/def2-SVP energy", "method", "pbe0"),
        ("CCSD(T)/cc-pVDZ please", "method", "ccsd(t)"),
        ("b3lyp with 6-31G*", "basis", "6-31g*"),
        ("use 6-311+G(d,p)", "basis", "6-311+g(d,p)"),
        ("with the cc-pVTZ basis", "basis", "cc-pvtz"),
        ("run it in ORCA", "engine", "orca"),
        ("wB97X-D3/def2-TZVP", "method", "wb97x"),
    ],
)
def test_named_values_the_server_cannot_run_are_still_constraints(text, parameter, value):
    found, _ = constraints(text)
    assert found[parameter] == (value, False)


def test_a_longer_name_is_never_confused_with_its_prefix():
    # 6-31G* is not 6-31G, PBE0 is not PBE and def2-SVPD is not def2-SVP;
    # "Gaussian basis" names no engine.
    assert constraints("6-31G* basis")[0]["basis"][0] == "6-31g*"
    assert constraints("PBE0 hybrid")[0]["method"][0] == "pbe0"
    assert constraints("def2-SVPD basis")[0]["basis"][0] == "def2-svpd"
    assert "engine" not in constraints("a Gaussian basis set of double-zeta quality")[0]


def test_several_values_for_one_parameter_are_ambiguous_and_not_enforced():
    found, reading = constraints("Compare HF/STO-3G with B3LYP/6-31G energies")
    assert "method" not in found and "basis" not in found
    assert set(reading.ambiguous) == {"method", "basis"}
    items, report = outcomes("Compare HF/STO-3G with B3LYP/6-31G", method="pbe", basis="def2-svp")
    assert items["method"] == AMBIGUOUS and items["basis"] == AMBIGUOUS and report.ok


def test_ruled_out_values_are_never_accepted():
    found, reading = constraints("Use STO-3G, not 6-31G, for the HF energy")
    assert found["basis"] == ("sto-3g", True) and ("basis", "6-31g") in reading.excluded
    items, report = outcomes("Use STO-3G, not 6-31G, for the HF energy", basis="6-31g")
    assert items["basis"] == MISMATCH and not report.ok
    only_negated, _ = outcomes("any method except B3LYP please", method="b3lyp")
    assert only_negated["method"] == MISMATCH
    assert outcomes("any method except B3LYP please", method="hf")[1].ok


def test_a_proposal_that_agrees_matches_and_unnamed_parameters_are_not_specified():
    items, report = outcomes("Calculate the HF/STO-3G energy with PySCF")
    assert items == {
        "task": MATCH,
        "engine": MATCH,
        "method": MATCH,
        "basis": MATCH,
        "charge": NOT_SPECIFIED,
        "multiplicity": NOT_SPECIFIED,
    }
    assert report.ok and report.conflicts == ()


def test_hf_sto3g_requested_and_hf_631g_proposed_is_a_reported_conflict():
    items, report = outcomes("Please compute the HF/STO-3G energy", basis="6-31g")
    assert items["basis"] == MISMATCH and items["method"] == MATCH
    (conflict,) = report.conflicts
    assert (conflict.parameter, conflict.requested, conflict.proposed) == (
        "basis",
        "sto-3g",
        "6-31g",
    )
    assert conflict.requested_available is True and conflict.mention == "STO-3G"


@pytest.mark.parametrize(
    "text, proposed, parameter",
    [
        ("HF/STO-3G energy", {"method": "b3lyp"}, "method"),
        ("B3LYP/6-31G energy", {"method": "hf"}, "method"),
        ("energy with PySCF", {"engine": "xtb", "basis": None}, "engine"),
        ("compute the single-point energy", {"task": "GEOMETRY_OPTIMIZATION"}, "task"),
        ("optimize the geometry", {"task": "ENERGY"}, "task"),
        ("neutral molecule, charge 0", {"charge": 1}, "charge"),
        ("a charge of +1 cation", {"charge": 0}, "charge"),
        ("triplet state energy", {"multiplicity": 1}, "multiplicity"),
        ("multiplicity 2", {"multiplicity": 1}, "multiplicity"),
        ("closed-shell singlet", {"multiplicity": 3}, "multiplicity"),
    ],
)
def test_each_enforced_parameter_detects_its_own_substitution(text, proposed, parameter):
    items, report = outcomes(text, **proposed)
    assert items[parameter] == MISMATCH
    assert parameter in {c.parameter for c in report.conflicts}


@pytest.mark.parametrize(
    "text, proposed",
    [
        ("compute the PBE0/def2-SVP energy", {"method": "pbe", "basis": "def2-svp"}),
        ("compute the PBE0/def2-SVP energy", {"method": "b3lyp", "basis": "def2-svp"}),
        ("CCSD(T)/cc-pVDZ energy", {"method": "hf", "basis": "sto-3g"}),
        ("energy in ORCA", {"engine": "pyscf"}),
    ],
)
def test_a_substitute_for_something_the_server_cannot_run_is_reported_not_accepted(text, proposed):
    report = match_request(text, proposal(**proposed))
    assert not report.ok
    assert any(item.requested_available is False for item in report.conflicts)


def test_proposing_exactly_the_unavailable_value_agrees_here_and_the_engine_check_refuses_it():
    report = match_request(
        "compute the PBE0/def2-SVP energy", proposal(method="pbe0", basis="def2-svp")
    )
    assert report.ok  # no substitution happened; the capability validator is the next gate
    method = next(item for item in report.items if item.parameter == "method")
    assert method.outcome == MATCH and method.requested_available is False


def test_requested_features_the_proposal_lacks_are_conflicts():
    for text, feature in (
        ("PBE-D3(BJ)/def2-SVP energy", "dispersion"),
        ("energy with a PCM solvent model", "solvation"),
        ("scan with a constrained bond", "constraints"),
    ):
        report = match_request(text, proposal())
        assert any(
            item.parameter == feature and item.outcome == MISMATCH for item in report.items
        ), text
    assert match_request("plain HF/STO-3G energy", proposal()).ok


def test_the_proposal_summary_reads_only_comparable_facts():
    summary = proposal_summary(
        proposal(method="B3LYP", basis="6-31G", dispersion={"model": "d3"}, constraints=[{"x": 1}])
    )
    assert summary == {
        "task": "ENERGY",
        "engine": "pyscf",
        "method": "b3lyp",
        "basis": "6-31g",
        "charge": 0,
        "multiplicity": 1,
        "dispersion": True,
        "solvation": False,
        "constraints": True,
    }
    assert proposal_summary({})["method"] is None


def test_items_serialize_for_the_approval_record():
    _, report = outcomes("HF/STO-3G energy", basis="6-31g")
    rows = {row["parameter"]: row for row in report.as_dicts()}
    assert rows["basis"] == {
        "parameter": "basis",
        "outcome": "MISMATCH",
        "requested": "sto-3g",
        "proposed": "6-31g",
        "requested_available": True,
        "mention": "STO-3G",
        "excluded": False,
    }
    assert rows["charge"]["outcome"] == NOT_SPECIFIED and rows["charge"]["requested"] is None


SCOPE = {
    "task": {"ENERGY"},
    "engine": {"pyscf"},
    "method": {"hf", "b3lyp", "pbe"},
    "basis": {"sto-3g", "6-31g", "def2-svp", "def2-svpd"},
}


def test_a_planning_scope_makes_values_the_server_knows_unavailable_to_this_run():
    # MP2 is in the method catalogue (Psi4) but not available to a PySCF energy run, and
    # optimisation is outside an ENERGY scope: both are reported conflicts, never substitutions.
    mp2 = next(
        i
        for i in match_request("Calculate the MP2/STO-3G energy", proposal(), SCOPE).items
        if i.parameter == "method"
    )
    assert (mp2.outcome, mp2.requested, mp2.requested_available) == (MISMATCH, "mp2", False)
    task = next(
        i
        for i in match_request("Optimize the geometry of this molecule", proposal(), SCOPE).items
        if i.parameter == "task"
    )
    assert (task.outcome, task.requested, task.requested_available) == (
        MISMATCH,
        "GEOMETRY_OPTIMIZATION",
        False,
    )
    # Without a scope the server-wide catalogue decides, and in-scope requests stay available.
    assert next(
        i
        for i in match_request("Calculate the MP2/STO-3G energy", proposal()).items
        if i.parameter == "method"
    ).requested_available
    inside = match_request("Calculate the HF/STO-3G energy with PySCF", proposal(), SCOPE)
    assert inside.ok and all(i.requested_available in (True, None) for i in inside.items)
