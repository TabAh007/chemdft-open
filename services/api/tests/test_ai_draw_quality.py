# ruff: noqa: E501, RUF001
"""DRAW mode quality fixes: add_copies, clear_all, compact layout, integrity verdicts, no-guess rules."""

from __future__ import annotations

import json
import math

import pytest
from chemdft_api.ai.draw import (
    MAX_COPIES,
    DrawState,
    PlanRejected,
    ambiguous_follow_up,
    formula_problem,
    integrity_problems,
    is_clear_request,
    layout_extent,
    max_justified_extent,
    overlapping_atom_pairs,
    parse_plan,
    run_ops,
    unmappable_subject,
)
from chemdft_api.ai.draw_known import KNOWN, requested_copies, verify_copies
from chemdft_api.ai.gateway import FakeModelGateway, ModelResponse, ModelUsage
from rdkit import Chem
from test_ai_draw_mode import _draw, _plan, _setup, stub_model  # noqa: F401

CORONENE = "c1cc2ccc3ccc4ccc5ccc6ccc1c1c2c3c4c5c61"


def _run(ops: list[dict], molfile: str | None = None):
    plan = parse_plan(_plan(*ops))
    return run_ops(DrawState.from_molfile(molfile), list(plan.ops), previous_molfile=None)


def _coords(molfile: str) -> list[tuple[float, float]]:
    mol = Chem.MolFromMolBlock(molfile, removeHs=False)
    conf = mol.GetConformer()
    return [
        (conf.GetAtomPosition(i).x, conf.GetAtomPosition(i).y) for i in range(mol.GetNumAtoms())
    ]


def _heavy_coords(molfile: str) -> list[tuple[float, float]]:
    mol = Chem.MolFromMolBlock(molfile, removeHs=False)
    conf = mol.GetConformer()
    return [
        (conf.GetAtomPosition(a.GetIdx()).x, conf.GetAtomPosition(a.GetIdx()).y)
        for a in mol.GetAtoms()
        if a.GetAtomicNum() > 1
    ]


def _min_distance(points: list[tuple[float, float]]) -> float:
    return min(
        (math.dist(a, b) for i, a in enumerate(points) for b in points[i + 1 :]), default=99.0
    )


def _assert_compact(molfile: str) -> None:
    mol = Chem.MolFromMolBlock(molfile, removeHs=False)
    assert overlapping_atom_pairs(mol) == 0
    assert layout_extent(mol) <= max_justified_extent(mol.GetNumAtoms())
    pts = _coords(molfile)
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    assert (max(xs) + min(xs)) / 2 == pytest.approx(0, abs=1e-3)  # centred
    assert (max(ys) + min(ys)) / 2 == pytest.approx(0, abs=1e-3)


# ------------------------------------------------------------------------------- add_copies / layout


def test_six_waters_are_six_fragments_in_a_grid_without_overlap() -> None:
    out = _run([{"op": "add_copies", "source": "water", "count": 6, "layout": "grid"}])
    step = out.steps[-1]
    assert step.ok and step.formula == "H12O6" and step.atom_count == 18  # O + 2 H as real atoms
    mol = Chem.MolFromMolBlock(step.molfile, removeHs=False)
    assert len(Chem.GetMolFrags(mol)) == 6
    _assert_compact(step.molfile)
    # 3 x 2 grid, neighbours clearly apart
    assert _min_distance(_heavy_coords(step.molfile)) >= 3.0
    assert step.new_atom_numbers == list(range(1, 19))


def test_twelve_copies_and_the_limit() -> None:
    out = _run([{"op": "add_copies", "source": "ethanol", "count": MAX_COPIES}])
    step = out.steps[-1]
    assert step.ok and step.atom_count == 36
    mol = Chem.MolFromMolBlock(step.molfile, removeHs=False)
    assert len(Chem.GetMolFrags(mol)) == 12
    _assert_compact(step.molfile)
    with pytest.raises(PlanRejected):
        parse_plan(_plan({"op": "add_copies", "source": "water", "count": MAX_COPIES + 1}))
    with pytest.raises(PlanRejected):
        parse_plan(_plan({"op": "add_copies", "source": "water", "count": 0}))


def test_add_copies_row_layout_is_one_row() -> None:
    out = _run([{"op": "add_copies", "source": "water", "count": 4, "layout": "row"}])
    ys = {round(y, 3) for _x, y in _heavy_coords(out.steps[-1].molfile)}
    assert len(ys) == 1


def test_add_copies_sources_current_label_and_unknown() -> None:
    first = _run([{"op": "load_smiles", "smiles": "CCO", "label": "ethanol"}])
    copies = _run([{"op": "add_copies", "source": "current", "count": 2}], first.steps[-1].molfile)
    mol = Chem.MolFromMolBlock(copies.steps[-1].molfile, removeHs=False)
    assert copies.steps[-1].ok and len(Chem.GetMolFrags(mol)) == 3
    labelled = _run(
        [
            {"op": "load_smiles", "smiles": "CC(=O)OC", "label": "methyl acetate"},
            {"op": "clear_all"},
            {"op": "add_copies", "source": "Methyl Acetate", "count": 2},
        ]
    )
    assert all(s.ok for s in labelled.steps) and labelled.steps[-1].formula == "C6H12O4"
    unknown = _run([{"op": "add_copies", "source": "unobtainium", "count": 2}])
    assert not unknown.steps[0].ok and "load_smiles" in (unknown.steps[0].suggestion or "")
    empty_current = _run([{"op": "add_copies", "source": "current", "count": 2}])
    assert not empty_current.steps[0].ok


def test_add_copies_respects_the_atom_limit() -> None:
    out = _run(
        [
            {"op": "load_smiles", "smiles": CORONENE, "label": "coronene"},
            {"op": "add_copies", "source": "coronene", "count": 6},
        ]
    )
    assert out.steps[0].ok and not out.steps[1].ok and "limit" in (out.steps[1].error or "")


def test_clear_all_is_one_step_and_yields_a_loadable_empty_block() -> None:
    drawn = _run([{"op": "load_smiles", "smiles": "CCO", "label": "ethanol"}])
    out = _run([{"op": "clear_all"}], drawn.steps[-1].molfile)
    step = out.steps[0]
    assert step.ok and step.atom_count == 0 and step.molfile.splitlines()[3].endswith("V2000")
    assert Chem.MolFromMolBlock(step.molfile).GetNumAtoms() == 0
    assert DrawState.from_molfile(step.molfile).mol.GetNumAtoms() == 0
    assert not _run([{"op": "clear_all"}]).steps[0].ok  # already empty


@pytest.mark.parametrize(
    ("smiles", "label"),
    [
        ("C", "single carbon"),
        (CORONENE, "large ring system"),
        ("C" * 40, "long chain"),
    ],
)
def test_layout_is_compact_for_tiny_and_large_structures(smiles: str, label: str) -> None:
    step = _run([{"op": "load_smiles", "smiles": smiles, "label": label}]).steps[-1]
    assert step.ok
    _assert_compact(step.molfile)
    mol = Chem.MolFromMolBlock(step.molfile, removeHs=False)
    if mol.GetNumBonds():
        lengths = [
            math.dist(
                _coords(step.molfile)[b.GetBeginAtomIdx()], _coords(step.molfile)[b.GetEndAtomIdx()]
            )
            for b in mol.GetBonds()
        ]
        assert 1.0 <= min(lengths) and max(lengths) <= 2.0  # bond length 1.5 within tolerance


def test_wildly_spread_input_is_re_laid_out_compactly() -> None:
    """A molfile with atoms thousands of units apart (the 'tiny specks' bug) comes back compact."""
    block = Chem.MolToMolBlock(Chem.MolFromSmiles("CCO"))
    mol = Chem.MolFromMolBlock(block)
    conf = mol.GetConformer()
    conf.SetAtomPosition(0, (0.0, 0.0, 0.0))
    conf.SetAtomPosition(1, (4000.0, 3000.0, 0.0))
    conf.SetAtomPosition(2, (-5000.0, 12.0, 0.0))
    wild = Chem.MolToMolBlock(mol)
    assert layout_extent(Chem.MolFromMolBlock(wild)) > max_justified_extent(3)
    out = _run([{"op": "add_group", "name": "OH", "attach_to": 1}], wild)
    assert out.steps[0].ok
    _assert_compact(out.steps[0].molfile)


def test_overlap_and_extent_guards_detect_bad_geometry() -> None:
    mol = Chem.MolFromSmiles("CC")
    conf = Chem.Conformer(2)
    conf.SetAtomPosition(0, (0.0, 0.0, 0.0))
    conf.SetAtomPosition(1, (0.1, 0.0, 0.0))
    mol.AddConformer(conf)
    assert overlapping_atom_pairs(mol) == 1
    assert "overlap" in " ".join(integrity_problems(mol, expected_fragments=None))
    far = Chem.MolFromSmiles("CC")
    conf2 = Chem.Conformer(2)
    conf2.SetAtomPosition(1, (5000.0, 0.0, 0.0))
    far.AddConformer(conf2)
    assert layout_extent(far) > max_justified_extent(2)


def test_integrity_problems_report_fragments_and_formula() -> None:
    assert integrity_problems(Chem.MolFromSmiles("O.O.O"), expected_fragments=1)
    assert integrity_problems(Chem.MolFromSmiles("CCO"), expected_fragments=1) == []
    assert formula_problem(Chem.MolFromSmiles("CCO")) is None


def test_copies_parser_and_verifier() -> None:
    entry, count = requested_copies("draw 6 water molecules")
    assert (entry.name, count) == ("water", 6)
    assert requested_copies("please make three ethanol")[1] == 3
    assert requested_copies("draw 2 carbon dioxide")[0].name == "carbon dioxide"
    assert requested_copies("draw ethanol") is None
    assert requested_copies("add 2 carbons and 1 oxygen") is None
    water = next(e for e in KNOWN if e.name == "water")
    assert verify_copies(water, 3, Chem.MolFromSmiles("O.O.O")) is None
    assert "14" not in (verify_copies(water, 6, Chem.MolFromSmiles("O.O.O")) or "")
    assert "3 separate" in verify_copies(water, 6, Chem.MolFromSmiles("O.O.O"))
    assert verify_copies(water, 1, Chem.MolFromSmiles("CO"))


def test_clear_requests_and_unmappable_names() -> None:
    for text in (
        "clear the drawing",
        "Clear",
        "start over",
        "please erase everything",
        "reset the canvas",
    ):
        assert is_clear_request(text), text
    for text in ("clear the methyl group", "draw ethanol", "clear atom 3"):
        assert not is_clear_request(text), text
    assert unmappable_subject("draw 1-B-3-MIHS") == "1-B-3-MIHS"
    for text in (
        "draw ethanol",
        "draw 2-propanol",
        "draw C2H6O",
        "draw CCO",
        "draw CH3COOH",
        "draw 1,3-butadiene",
        "draw water",
    ):
        assert unmappable_subject(text) is None, text


# ------------------------------------------------------------------------------------ the route


def _bad_six_waters() -> str:
    """The production failure: 6 O + 12 H, only some bonded, then a cheerful sentence."""
    return _plan(
        {"op": "add_atom", "element": "O", "count": 6},
        {"op": "add_atom", "element": "H", "count": 12},
        {"op": "add_bond", "a": 1, "b": 7},
        {"op": "add_bond", "a": 1, "b": 8},
        {"op": "add_bond", "a": 2, "b": 9},
        reply="Drew 6 water molecules.",
    )


def test_six_waters_golden_repairs_to_a_clean_grid(api, stub_model) -> None:
    script, requests = stub_model
    client, pid, cid = _setup(api)
    script.append(_bad_six_waters())
    script.append(
        _plan(
            {"op": "clear_all"},
            {"op": "add_copies", "source": "water", "count": 6},
            reply="Drew 6 water molecules.",
        )
    )
    body = _draw(client, pid, cid, "draw 6 water molecules").json()
    assert body["status"] == "OK" and body["repaired"] is True
    final = Chem.MolFromMolBlock(body["final"]["molfile"], removeHs=False)
    assert len(Chem.GetMolFrags(final)) == 6 and body["final"]["formula"] == "H12O6"
    _assert_compact(body["final"]["molfile"])
    assert "server checked" in requests[-1].messages[-1].content
    assert body["reference_check"]["name"] == "water"


def test_six_waters_from_the_start_with_add_copies_needs_no_repair(api, stub_model) -> None:
    script, requests = stub_model
    client, pid, cid = _setup(api)
    script.append(
        _plan({"op": "add_copies", "source": "water", "count": 6}, reply="Drew 6 water molecules.")
    )
    body = _draw(client, pid, cid, "draw 6 water molecules").json()
    assert body["status"] == "OK" and body["repaired"] is False and len(requests) == 1
    assert [s["description"] for s in body["steps"]] == ["Add 6 × water in a grid"]


def test_fragmented_result_is_never_reported_as_done(api, stub_model) -> None:
    """Both attempts leave 14 fragments: status NEEDS_ATTENTION, honest server text, not the model's."""
    script, requests = stub_model
    client, pid, cid = _setup(api)
    script.extend([_bad_six_waters(), _bad_six_waters()])
    body = _draw(client, pid, cid, "draw 6 water molecules").json()
    assert body["status"] == "NEEDS_ATTENTION"
    assert "Drew" not in body["reply"] and "Needs attention" in body["reply"]
    assert "fragment" in body["reply"] and len(requests) == 2
    assert body["steps"] and body["final"] is not None  # shown so the researcher can undo it


def test_wrong_copy_count_is_caught(api, stub_model) -> None:
    script, _requests = stub_model
    client, pid, cid = _setup(api)
    wrong = _plan(
        {"op": "add_copies", "source": "water", "count": 5}, reply="Drew 6 water molecules."
    )
    script.extend([wrong, wrong])
    body = _draw(client, pid, cid, "draw 6 water molecules").json()
    assert body["status"] == "NEEDS_ATTENTION" and "asked for 6 water" in body["reply"]


def test_three_ethanol_golden(api, stub_model) -> None:
    script, _requests = stub_model
    client, pid, cid = _setup(api)
    script.append(
        _plan(
            {"op": "add_copies", "source": "ethanol", "count": 3}, reply="Drew 3 ethanol molecules."
        )
    )
    body = _draw(client, pid, cid, "draw 3 ethanol").json()
    assert body["status"] == "OK" and body["final"]["formula"] == "C6H18O3"
    _assert_compact(body["final"]["molfile"])


def test_single_named_molecule_split_into_pieces_needs_attention(api, stub_model) -> None:
    script, _requests = stub_model
    client, pid, cid = _setup(api)
    broken = _plan(
        {"op": "load_smiles", "smiles": "CC(=O)C", "label": "acetone"},
        {"op": "add_copies", "source": "water", "count": 1},
        reply="Drew acetone.",
    )
    script.extend([broken, broken])
    body = _draw(client, pid, cid, "draw acetone").json()
    assert body["status"] == "NEEDS_ATTENTION" and "separate fragment" in body["reply"]


def test_acetone_is_still_correct(api, stub_model) -> None:
    script, _requests = stub_model
    client, pid, cid = _setup(api)
    script.append(
        _plan({"op": "load_smiles", "smiles": "CC(=O)C", "label": "acetone"}, reply="Drew acetone.")
    )
    body = _draw(client, pid, cid, "draw acetone").json()
    assert body["status"] == "OK" and body["final"]["formula"] == "C3H6O"
    assert body["reference_check"]["name"] == "acetone"


def test_clear_the_drawing_is_one_step_without_a_model_call(api, stub_model) -> None:
    script, requests = stub_model
    client, pid, cid = _setup(api)
    drawn = _run(
        [
            {"op": "load_smiles", "smiles": "CCO", "label": "ethanol"},
            {"op": "add_group", "name": "OH", "attach_to": 1},
        ]
    )
    body = _draw(client, pid, cid, "clear the drawing", molfile=drawn.steps[-1].molfile).json()
    assert body["status"] == "OK" and len(body["steps"]) == 1 and requests == []
    assert (
        body["steps"][0]["atom_count"] == 0
        and body["steps"][0]["description"] == "Clear the drawing"
    )
    empty = _draw(client, pid, cid, "start over", molfile=None).json()
    assert empty["status"] == "NO_CHANGE" and "already empty" in empty["reply"] and requests == []


def test_nonsense_name_is_declined_without_a_guess_or_a_model_call(api, stub_model) -> None:
    script, requests = stub_model
    client, pid, cid = _setup(api)
    body = _draw(client, pid, cid, "draw 1-B-3-MIHS").json()
    assert body["status"] == "NO_CHANGE" and requests == [] and body["steps"] == []
    assert "don't recognise '1-B-3-MIHS'" in body["reply"] and "describe" in body["reply"].lower()


def test_more_than_twelve_copies_is_declined_without_a_model_call(api, stub_model) -> None:
    _script, requests = stub_model
    client, pid, cid = _setup(api)
    body = _draw(client, pid, cid, "draw 20 water molecules").json()
    assert body["status"] == "NO_CHANGE" and "at most 12" in body["reply"] and requests == []


def test_make_it_two_clarifies_instead_of_failing(api, stub_model) -> None:
    script, _requests = stub_model
    client, pid, cid = _setup(api)
    drawn = _run([{"op": "load_smiles", "smiles": "CCO", "label": "ethanol"}])
    script.append(
        json.dumps(
            {
                "ops": [],
                "reply": "",
                "clarify": {
                    "question": "What do you mean by 'make it two'?",
                    "options": [
                        {
                            "label": "Add a second water molecule",
                            "message": "Add a second copy of the current molecule",
                        },
                        {
                            "label": "Change to a 2-carbon version",
                            "message": "Replace the drawing with a 2-carbon alcohol",
                        },
                    ],
                },
            }
        )
    )
    body = _draw(
        client, pid, cid, "make it more interesting", molfile=drawn.steps[-1].molfile
    ).json()
    assert body["status"] == "CLARIFY" and len(body["clarify"]["options"]) == 2
    # the first option, as the next request, produces the copy
    script.append(
        _plan(
            {"op": "add_copies", "source": "current", "count": 1},
            reply="Added a second water molecule.",
        )
    )
    follow = _draw(
        client, pid, cid, body["clarify"]["options"][0]["message"], molfile=drawn.steps[-1].molfile
    ).json()
    assert follow["status"] == "OK" and follow["final"]["formula"] == "C4H12O2"


def test_prompt_documents_the_new_ops_and_rules() -> None:
    from chemdft_api.ai.draw import DRAW_POLICY

    for needle in ("add_copies", "clear_all", "do NOT guess", "make it two"):
        assert needle in DRAW_POLICY


def test_model_reply_never_overrides_server_findings(api, stub_model) -> None:
    script, _requests = stub_model
    client, pid, cid = _setup(api)
    script.extend([_bad_six_waters(), _bad_six_waters()])
    body = _draw(client, pid, cid, "draw 6 water molecules").json()
    assert "Drew 6 water molecules" not in body["reply"]


_ = (FakeModelGateway, ModelResponse, ModelUsage)


def test_bare_follow_ups_get_options_from_the_server_without_a_model_call(api, stub_model) -> None:
    script, requests = stub_model
    client, pid, cid = _setup(api)
    water = _run([{"op": "load_smiles", "smiles": "CCO", "label": "ethanol"}]).steps[-1].molfile
    body = _draw(client, pid, cid, "make it two", molfile=water).json()
    assert body["status"] == "CLARIFY" and requests == [] and body["steps"] == []
    labels = [o["label"] for o in body["clarify"]["options"]]
    assert labels == ["2 molecules in total", "A 2-carbon version"]
    for text in ("again", "bigger", "more", "another one", "make it three"):
        again = _draw(client, pid, cid, text, molfile=water).json()
        assert again["status"] == "CLARIFY" and len(again["clarify"]["options"]) == 2, text
    assert requests == []
    # the first option, as the next request, goes to the model and yields the copy
    script.append(
        _plan(
            {"op": "add_copies", "source": "current", "count": 1},
            reply="Added a second water molecule.",
        )
    )
    follow = _draw(client, pid, cid, body["clarify"]["options"][0]["message"], molfile=water).json()
    assert follow["status"] == "OK" and follow["final"]["formula"] == "C4H12O2"
    # nothing on the canvas: nothing to refer to, the model decides; "make it 1" is not ambiguous
    script.append(_plan(reply="There is nothing in the drawing yet."))
    assert _draw(client, pid, cid, "make it two").json()["status"] == "NO_CHANGE"
    assert ambiguous_follow_up("make it 1", "O") is None
    assert ambiguous_follow_up("draw ethanol", "O") is None


def test_molecule_counts_for_names_outside_the_table_are_checked(api, stub_model) -> None:
    from chemdft_api.ai.draw import requested_molecule_count

    assert requested_molecule_count("draw 3 pyridine molecules") == 3
    assert requested_molecule_count("draw two molecules of acetic acid") == 2
    for text in (
        "add 3 atoms to the molecule",
        "add 2 more molecules",
        "draw ethanol",
        "add 3 hydrogens",
    ):
        assert requested_molecule_count(text) is None, text
    script, _requests = stub_model
    client, pid, cid = _setup(api)
    four = _plan(
        {"op": "load_smiles", "smiles": "c1ccncc1", "label": "pyridine"},
        {"op": "add_copies", "source": "pyridine", "count": 3},
        reply="Drew 3 pyridine molecules.",
    )
    script.extend([four, four])
    body = _draw(client, pid, cid, "draw 3 pyridine molecules").json()
    assert body["status"] == "NEEDS_ATTENTION" and "separate fragment" in body["reply"]
    assert "Drew 3" not in body["reply"]
    script.append(
        _plan(
            {"op": "load_smiles", "smiles": "c1ccncc1", "label": "pyridine"},
            {"op": "add_copies", "source": "current", "count": 2},
            reply="Drew 3 pyridine molecules.",
        )
    )
    good = _draw(client, pid, cid, "draw 3 pyridine molecules").json()
    assert good["status"] == "OK" and good["final"]["formula"] == "C15H15N3"
    assert "double it" and ambiguous_follow_up("double it", "N") is not None
    assert ambiguous_follow_up("twice", "N") is not None


def test_single_molecule_requests_expect_one_fragment(api, stub_model) -> None:
    from chemdft_api.ai.draw import single_molecule_requested

    assert single_molecule_requested("clear it and draw propane", drawing_is_empty=False)
    assert single_molecule_requested("draw propane", drawing_is_empty=True)
    assert not single_molecule_requested(
        "draw propane", drawing_is_empty=False
    )  # an edit, not a new drawing
    for text in ("draw ethanol and methanol", "draw 2 propane", "draw NaCl salt", "add an OH"):
        assert not single_molecule_requested(text, drawing_is_empty=True), text
    script, requests = stub_model
    client, pid, cid = _setup(api)
    ethanol = _run([{"op": "load_smiles", "smiles": "CCO", "label": "ethanol"}]).steps[-1].molfile
    broken = _plan(
        {"op": "clear_all"},
        {"op": "add_atom", "element": "C", "count": 3},
        reply="Cleared the drawing and drew propane.",
    )
    script.extend(
        [
            broken,
            _plan({"op": "clear_all"}, {"op": "load_smiles", "smiles": "CCC", "label": "propane"}),
        ]
    )
    body = _draw(client, pid, cid, "clear it and draw propane", molfile=ethanol).json()
    assert body["status"] == "OK" and body["repaired"] is True and body["final"]["smiles"] == "CCC"
    assert (
        "Names that add_copies accepts" in requests[0].system_prompt
        and "water" in requests[0].system_prompt
    )


def test_an_empty_result_of_a_draw_request_is_not_done(api, stub_model) -> None:
    assert integrity_problems(Chem.RWMol(), expected_fragments=1) == ["the drawing is empty"]
    assert integrity_problems(Chem.RWMol(), expected_fragments=None) == []
    script, _requests = stub_model
    client, pid, cid = _setup(api)
    ethanol = _run([{"op": "load_smiles", "smiles": "CCO", "label": "ethanol"}]).steps[-1].molfile
    only_clear = _plan({"op": "clear_all"}, reply="Cleared the drawing and drew pentane.")
    script.extend([only_clear, _plan({"op": "load_smiles", "smiles": "CCCCC", "label": "pentane"})])
    body = _draw(client, pid, cid, "clear it and draw pentane", molfile=ethanol).json()
    assert body["status"] == "OK" and body["final"]["formula"] == "C5H12"


def test_wrong_alkane_for_a_table_name_is_rejected(api, stub_model) -> None:
    """The live model drew 3 butane molecules for '3 hexane molecules'; the table now covers hexane."""
    script, _requests = stub_model
    client, pid, cid = _setup(api)
    wrong = _plan(
        {"op": "add_copies", "source": "butane", "count": 3}, reply="Drew 3 hexane molecules."
    )
    script.extend([wrong, wrong])
    body = _draw(client, pid, cid, "draw 3 hexane molecules").json()
    assert body["status"] == "NEEDS_ATTENTION" and "hexane" in body["reply"]


# ----------------------------------------------------------------------- second quality pass


def test_options_that_do_not_apply_to_the_drawing_are_dropped() -> None:
    from chemdft_api.ai.draw import option_inapplicable

    water = Chem.MolFromSmiles("O")
    ethanol = Chem.MolFromSmiles("CCO")
    assert option_inapplicable("Change to a 2-carbon version", water)
    assert option_inapplicable("Extend the carbon chain by one atom", water)
    assert option_inapplicable("Make a 3-nitrogen version", ethanol)
    assert option_inapplicable("Change to a 2-carbon version", ethanol) is None
    assert option_inapplicable("Add a second copy of the current molecule", water) is None
    assert option_inapplicable("Add an OH group on atom 1", water) is None
    kept = ambiguous_follow_up("make it two", "O", water)
    assert kept is not None and [label for label, _ in kept[1]] == ["2 molecules in total"]
    assert ambiguous_follow_up("again", "CCO", ethanol)[1].__len__() == 2


def test_water_make_it_two_runs_the_only_applicable_reading(api, stub_model) -> None:
    """Live defect: one water + 'make it two' offered 'a 2-carbon version', which drew two unbonded CH4."""
    script, requests = stub_model
    client, pid, cid = _setup(api)
    water = _run([{"op": "load_smiles", "smiles": "O", "label": "water"}]).steps[-1].molfile
    script.append(
        _plan(
            {"op": "add_copies", "source": "current", "count": 1},
            reply="Added a second water molecule.",
        )
    )
    body = _draw(client, pid, cid, "make it two", molfile=water).json()
    assert body["status"] == "OK" and body["final"]["formula"] == "H4O2" and body["clarify"] is None
    sent = requests[-1].messages[-1].content
    assert "2 molecules in total" in sent and "carbon" not in sent.lower()


def test_model_clarify_options_for_the_wrong_elements_are_dropped(api, stub_model) -> None:
    script, _requests = stub_model
    client, pid, cid = _setup(api)
    water = _run([{"op": "load_smiles", "smiles": "O", "label": "water"}]).steps[-1].molfile
    options = [
        {"label": "A second water", "message": "Add a second copy of the current molecule"},
        {"label": "A 2-carbon version", "message": "Replace the drawing with a 2-carbon chain"},
    ]
    clarify = json.dumps(
        {"ops": [], "reply": "", "clarify": {"question": "Which?", "options": options}}
    )
    script.extend([clarify, clarify])
    body = _draw(client, pid, cid, "make it somewhat bigger please", molfile=water).json()
    assert (
        body["status"] != "CLARIFY"
    )  # one applicable option is not a question; nothing is offered


def test_two_carbon_chain_claim_with_two_unbonded_fragments_needs_attention(
    api, stub_model
) -> None:
    """Live defect: 'Drew a 2-carbon chain' + Done with two separate CH4."""
    script, requests = stub_model
    client, pid, cid = _setup(api)
    water = _run([{"op": "load_smiles", "smiles": "O", "label": "water"}]).steps[-1].molfile
    broken = _plan(
        {"op": "clear_all"},
        {"op": "add_atom", "element": "C", "count": 2},
        reply="Drew a 2-carbon chain.",
    )
    script.extend([broken, broken])
    body = _draw(
        client, pid, cid, "Replace the drawing with a 2-carbon chain", molfile=water
    ).json()
    assert body["status"] == "NEEDS_ATTENTION" and len(requests) == 2
    assert "Drew a 2-carbon chain" not in body["reply"] and "2 separate fragment" in body["reply"]
    # repaired by the single retry when the model connects the atoms
    script.extend(
        [
            broken,
            _plan(
                {"op": "clear_all"},
                {"op": "load_smiles", "smiles": "CC", "label": "ethane"},
                reply="Drew a 2-carbon chain.",
            ),
        ]
    )
    fixed = _draw(
        client, pid, cid, "Replace the drawing with a 2-carbon chain", molfile=water
    ).json()
    assert (
        fixed["status"] == "OK" and fixed["repaired"] is True and fixed["final"]["smiles"] == "CC"
    )


def test_model_reply_claiming_connected_is_verified_even_if_the_request_did_not(
    api, stub_model
) -> None:
    script, _requests = stub_model
    client, pid, cid = _setup(api)
    lie = _plan(
        {"op": "add_atom", "element": "C", "count": 3}, reply="Drew a bonded propane chain."
    )
    again = _plan(
        {"op": "clear_all"},
        {"op": "add_atom", "element": "C", "count": 3},
        reply="Drew a bonded propane chain.",
    )
    script.extend([lie, again])
    body = _draw(client, pid, cid, "make me something with three carbons").json()
    assert body["status"] == "NEEDS_ATTENTION" and "bonded propane" not in body["reply"]


def test_edit_that_keeps_the_fragment_count_is_not_flagged(api, stub_model) -> None:
    script, _requests = stub_model
    client, pid, cid = _setup(api)
    ethanol = _run([{"op": "load_smiles", "smiles": "CCO", "label": "ethanol"}]).steps[-1].molfile
    script.append(
        _plan(
            {"op": "add_group", "name": "CH3", "attach_to": 1},
            reply="Added a connected methyl group.",
        )
    )
    body = _draw(client, pid, cid, "add a methyl on atom 1", molfile=ethanol).json()
    assert body["status"] == "OK"


def test_requested_molecule_count_is_info_not_a_warning(api, stub_model) -> None:
    script, _requests = stub_model
    client, pid, cid = _setup(api)
    script.append(
        _plan({"op": "add_copies", "source": "water", "count": 6}, reply="Drew 6 water molecules.")
    )
    body = _draw(client, pid, cid, "draw 6 water molecules").json()
    assert body["info"] == ["6 molecules"]
    assert not any("separate fragments" in w for w in body["warnings"])
    script.append(_plan({"op": "add_atom", "element": "O", "count": 2}, reply="Drew two oxygens."))
    other = _draw(client, pid, cid, "put two oxygen atoms on the canvas").json()
    assert other["info"] == [] and any("2 separate fragments" in w for w in other["warnings"])


def test_lone_atom_molecules_are_drawn_with_their_hydrogens_as_real_atoms() -> None:
    """Ketcher shows a bare O with implicit H as a text label 'H2O'; loaded/copied molecules get real H atoms."""
    for source, formula, atoms in (
        ("water", "H2O", 3),
        ("methane", "CH4", 5),
        ("ammonia", "H3N", 4),
    ):
        step = _run([{"op": "add_copies", "source": source, "count": 1}]).steps[-1]
        mol = Chem.MolFromMolBlock(step.molfile, removeHs=False)
        assert mol.GetNumAtoms() == atoms and mol.GetNumBonds() == atoms - 1, source
        assert step.formula == formula and len(Chem.GetMolFrags(mol)) == 1
    loaded = _run([{"op": "load_smiles", "smiles": "O", "label": "water"}]).steps[-1]
    assert loaded.atom_count == 3 and loaded.smiles == "[H]O[H]"
    # atoms built one by one and attached groups stay open for bonds (no hidden hydrogens)
    built = _run(
        [{"op": "add_atom", "element": "O"}, {"op": "add_atom", "element": "C", "attach_to": 1}]
    )
    assert built.steps[-1].atom_count == 2
    group = _run(
        [
            {"op": "load_smiles", "smiles": "CC", "label": "ethane"},
            {"op": "add_group", "name": "OH", "attach_to": 1},
        ]
    )
    assert group.steps[-1].formula == "C2H6O" and group.steps[-1].atom_count == 3
    ions = _run([{"op": "load_smiles", "smiles": "[Na+]", "label": "sodium ion"}]).steps[-1]
    assert ions.atom_count == 1


def test_plural_wording_is_not_a_connectivity_claim(api, stub_model) -> None:
    from chemdft_api.ai.draw import claims_connected

    assert claims_connected("Drew a 2-carbon chain.") and claims_connected(
        "Replace it with a connected chain"
    )
    for text in ("draw 2 propane chains", "Drew 6 water molecules.", "make two separate chains"):
        assert not claims_connected(text), text
    script, _requests = stub_model
    client, pid, cid = _setup(api)
    script.append(
        _plan({"op": "add_copies", "source": "propane", "count": 2}, reply="Drew 2 propane chains.")
    )
    body = _draw(client, pid, cid, "draw 2 propane chains").json()
    assert body["status"] == "OK" and body["final"]["formula"] == "C6H16"


def test_n_molecules_in_total_is_verified(api, stub_model) -> None:
    """Live defect: 'make it two' on one water ran 'add 1 more copy ... 2 molecules in total' and drew three."""
    from chemdft_api.ai.draw import requested_total_molecules

    assert (
        requested_total_molecules(
            "Add 1 more copies of the current molecule so the drawing has 2 molecules in total"
        )
        == 2
    )
    assert requested_total_molecules("draw ethanol") is None
    script, _requests = stub_model
    client, pid, cid = _setup(api)
    water = _run([{"op": "load_smiles", "smiles": "O", "label": "water"}]).steps[-1].molfile
    wrong = _plan(
        {"op": "add_copies", "source": "current", "count": 2},
        reply="Added a second water molecule.",
    )
    script.extend(
        [
            wrong,
            _plan(
                {"op": "clear_all"},
                {"op": "add_copies", "source": "water", "count": 2},
                reply="Added a second water molecule.",
            ),
        ]
    )
    body = _draw(client, pid, cid, "make it two", molfile=water).json()
    assert (
        body["status"] == "OK" and body["repaired"] is True and body["final"]["formula"] == "H4O2"
    )
    assert body["info"] == ["2 molecules"]
    again = _plan(
        {"op": "add_copies", "source": "water", "count": 2}, reply="Added a second water molecule."
    )
    script.extend([wrong, again])
    bad = _draw(client, pid, cid, "make it two", molfile=water).json()
    assert bad["status"] == "NEEDS_ATTENTION" and "Added a second" not in bad["reply"]


def test_a_reply_naming_a_table_molecule_that_is_not_in_the_drawing_is_flagged(
    api, stub_model
) -> None:
    """Live defect: 'Replaced with ethane.' while the drawing was dimethyl ether."""
    from chemdft_api.ai.draw_known import claimed_molecule

    assert claimed_molecule("Replaced with ethane.").name == "ethane"
    assert claimed_molecule("Drew an acetic acid.").name == "acetic acid"
    assert claimed_molecule("Added a methyl group to ethanol.") is None
    script, _requests = stub_model
    client, pid, cid = _setup(api)
    water = _run([{"op": "load_smiles", "smiles": "O", "label": "water"}]).steps[-1].molfile
    wrong = _plan(
        {"op": "clear_all"},
        {"op": "load_smiles", "smiles": "COC", "label": "dimethyl ether"},
        reply="Replaced with ethane.",
    )
    right = _plan(
        {"op": "clear_all"},
        {"op": "load_smiles", "smiles": "CC", "label": "ethane"},
        reply="Replaced with ethane.",
    )
    script.extend([wrong, right])
    body = _draw(
        client, pid, cid, "Replace the drawing with a two-carbon alkane", molfile=water
    ).json()
    assert body["status"] == "OK" and body["repaired"] is True and body["final"]["smiles"] == "CC"
    script.extend([wrong, wrong])
    bad = _draw(
        client, pid, cid, "Replace the drawing with a two-carbon alkane", molfile=water
    ).json()
    assert bad["status"] == "NEEDS_ATTENTION" and "ethane" in bad["reply"]


# ------------------------------------------------- third pass: generalising from two live conversations


def test_a_hydrogen_molecule_is_h_h_not_two_lone_atoms(api, stub_model) -> None:
    """Live: 'can you create a hydrogen molecules?' drew 2 x H (H4, 2 fragments) and said Done."""
    from chemdft_api.ai.draw import single_molecule_requested

    for text in (
        "can you create a hydrogen molecules?",
        "I want a hydrogen molecule",
        "could you please make me a nitrogen",
    ):
        assert single_molecule_requested(text, drawing_is_empty=True), text
    assert requested_copies("draw 3 hydrogen atoms") is None
    assert requested_copies("draw 3 hydrogen molecules")[1] == 3
    script, requests = stub_model
    client, pid, cid = _setup(api)
    lone = _plan({"op": "add_atom", "element": "H", "count": 2}, reply="Drew H2.")
    script.extend(
        [
            lone,
            _plan(
                {"op": "clear_all"},
                {"op": "load_smiles", "smiles": "[H][H]", "label": "hydrogen"},
                reply="Drew H2.",
            ),
        ]
    )
    body = _draw(client, pid, cid, "can you create a hydrogen molecules?").json()
    assert body["status"] == "OK" and body["repaired"] is True
    assert body["final"]["formula"] == "H2" and body["final"]["smiles"] == "[H][H]"
    script.extend([lone, lone])
    bad = _draw(client, pid, cid, "can you create a hydrogen molecule?").json()
    assert bad["status"] == "REJECTED" and "Drew H2" not in bad["reply"] and bad["steps"] == []
    assert (
        "Names that add_copies accepts" in requests[0].system_prompt
        and "hydrogen" in requests[0].system_prompt
    )


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("why two seperate?", "2 separate fragments"),
        ("why are they separate", "2 separate fragments"),
        ("how many atoms are there?", "2 atoms"),
        ("what is the formula?", "formula is H4"),
        ("what did you draw?", "formula is H4"),
    ],
)
def test_questions_about_the_drawing_are_answered_from_the_drawing(
    api, stub_model, text, expected
) -> None:
    script, requests = stub_model
    client, pid, cid = _setup(api)
    two = _run([{"op": "add_atom", "element": "H", "count": 2}]).steps[-1].molfile
    body = _draw(client, pid, cid, text, molfile=two).json()
    assert body["status"] == "NO_CHANGE" and expected in body["reply"], body["reply"]
    assert requests == [] and body["steps"] == []
    empty = _draw(client, pid, cid, text).json()
    assert empty["reply"] == "The drawing is empty." and requests == []


def test_any_other_question_answered_in_prose_is_an_answer_not_an_invalid_plan(
    api, stub_model
) -> None:
    """Live: 'why two seperate?' went to the model, which answered in words; the result was 'not a valid plan'."""
    script, _requests = stub_model
    client, pid, cid = _setup(api)
    ethanol = _run([{"op": "load_smiles", "smiles": "CCO", "label": "ethanol"}]).steps[-1].molfile
    script.append("The drawing is one connected molecule with two carbons and one oxygen.")
    body = _draw(client, pid, cid, "is this drawing connected properly?", molfile=ethanol).json()
    assert (
        body["status"] == "NO_CHANGE"
        and "connected molecule" in body["reply"]
        and body["steps"] == []
    )
    # a prose answer that states a value or a source is replaced, as for every model sentence
    script.append("Its boiling point is 78 °C according to PubChem.")
    filtered = _draw(client, pid, cid, "how is it doing?", molfile=ethanol).json()
    assert "78" not in filtered["reply"] and "PubChem" not in filtered["reply"]
    # a non-question in prose is still an invalid plan (no silent guessing)
    script.extend(["Sure, here is ethanol.", "Sure, here is ethanol."])
    rejected = _draw(client, pid, cid, "make something nice", molfile=ethanol).json()
    assert rejected["status"] == "REJECTED"


def test_diatomic_elements_are_table_molecules() -> None:
    from chemdft_api.ai.draw_known import KNOWN, known_by_name

    for name, formula in (
        ("hydrogen", "H2"),
        ("oxygen", "O2"),
        ("nitrogen", "N2"),
        ("fluorine", "F2"),
        ("chlorine", "Cl2"),
    ):
        entry = known_by_name(name)
        assert entry is not None and entry.formula == formula
    assert known_by_name("dihydrogen") is known_by_name("h2")
    step = _run([{"op": "add_copies", "source": "hydrogen", "count": 3}]).steps[-1]
    assert step.formula == "H6" and step.atom_count == 6
    assert len(Chem.GetMolFrags(Chem.MolFromMolBlock(step.molfile, removeHs=False))) == 3
    assert len(KNOWN) >= 36
