"""Regenerate the mock-transport fixtures for the DRAW-mode editor specs from the real server engine.

    uv run --project services/api python tools/gen_draw_fixtures.py

Each file is a DrawResponse produced by chemdft_api.ai.draw (RDKit), so the molfiles the Playwright specs
load into Ketcher are exactly what the server would return for that plan. No model is involved.
"""

from __future__ import annotations

import json
from pathlib import Path

from chemdft_api.ai.draw import DrawState, parse_plan, run_ops
from chemdft_api.ai.draw_service import _step_view
from chemdft_api.contracts.ai import DrawResponse

OUT = Path(__file__).resolve().parent.parent / "apps/web/tests/e2e/fixtures/ai-draw"


def plan(*ops: dict) -> list:
    return list(parse_plan(json.dumps({"ops": list(ops)})).ops)


def respond(status: str, reply: str, ops: list | None = None, base: str | None = None, **extra) -> dict:
    state = DrawState.from_molfile(base)
    steps = []
    if ops:
        steps = run_ops(state, ops, previous_molfile=None).steps
    ok = [s for s in steps if s.ok]
    final = None
    if ok:
        final = {"molfile": ok[-1].molfile, "smiles": ok[-1].smiles, "formula": ok[-1].formula, "atom_count": ok[-1].atom_count}
    body = DrawResponse(
        status=status, reply=reply, steps=tuple(_step_view(s) for s in steps), final=final,
        model="nemotron-3.5-lightning-30b-a3b", input_tokens=412, output_tokens=64, **extra,
    )
    return json.loads(body.model_dump_json())


def save(name: str, data: dict) -> None:
    (OUT / f"{name}.json").write_text(json.dumps(data, indent=1) + "\n")


ethanol = plan(
    {"op": "add_atom", "element": "C", "count": 2},
    {"op": "add_bond", "a": 1, "b": 2},
    {"op": "add_atom", "element": "O", "attach_to": 2},
)
eth = respond("OK", "Drew ethanol.", ethanol)
save("ethanol", eth)
save("phenol", respond("OK", "Drew phenol.", plan({"op": "add_ring", "size": 6, "aromatic": True}, {"op": "add_group", "name": "OH", "attach_to": 1})))
save("add-oh-on-ethanol", respond("OK", "Added an OH group.", plan({"op": "add_group", "name": "OH", "attach_to": 1}), base=eth["final"]["molfile"]))
save("caffeine", respond("OK", "Drew a proposed structure.", plan({"op": "load_smiles", "smiles": "CN1C=NC2=C1C(=O)N(C(=O)N2C)C", "label": "caffeine"}), proposals=[{"label": "caffeine", "smiles": "CN1C=NC2=C1C(=O)N(C(=O)N2C)C", "note": "AI-proposed structure for 'caffeine' — verify against a trusted source before use"}], warnings=["AI-proposed structure for 'caffeine' — verify against a trusted source before use"]))
options = [
    {"label": "Methanediamine H2N-CH2-NH2", "message": "Draw 1 C, 2 N and 6 H as methanediamine"},
    {"label": "Methylhydrazine CH3-NH-NH2", "message": "Draw 1 C, 2 N and 6 H as methylhydrazine"},
]
save("clarify", respond("CLARIFY", "Which structure?", clarify={"question": "Which structure do you mean?", "options": options}))
save("methanediamine", respond("OK", "Drew methanediamine.", plan({"op": "add_atom", "element": "N"}, {"op": "add_atom", "element": "C", "attach_to": 1}, {"op": "add_atom", "element": "N", "attach_to": 2})))
partial = respond("PARTIAL", "", plan({"op": "add_atom", "element": "C"}, {"op": "add_atom", "element": "C", "count": 5, "attach_to": 1}))
partial["reply"] = "Stopped at step 2: " + partial["steps"][-1]["error"] + " The 1 earlier step(s) are valid and were kept."
save("partial", partial)
save("refused", respond("REFUSED", "I can only draw or edit the structure here. I do not give energies, spectra, properties or literature in the drawing assistant: run a calculation for values, or use Evidence for cited sources."))
save("six-waters", respond("OK", "Drew 6 water molecules.", plan({"op": "add_copies", "source": "water", "count": 6, "layout": "grid"}), info=["6 molecules"]))
save("single-water", respond("OK", "Drew water.", plan({"op": "load_smiles", "smiles": "O", "label": "water"})))
save("single-water-atoms", respond("OK", "Drew water with explicit hydrogens.", plan({"op": "load_smiles", "smiles": "[H]O[H]", "label": "water"})))
save("three-ethanol", respond("OK", "Drew 3 ethanol molecules.", plan({"op": "add_copies", "source": "ethanol", "count": 3, "layout": "grid"})))
save("twelve-ethanol", respond("OK", "Drew 12 ethanol molecules.", plan({"op": "add_copies", "source": "ethanol", "count": 12, "layout": "grid"})))
save("clear", respond("OK", "Cleared the drawing.", plan({"op": "clear_all"}), base=eth["final"]["molfile"]))
save("big-chain", respond("OK", "Drew a long chain and two waters.", plan({"op": "load_smiles", "smiles": "C" * 40, "label": "tetracontane"}, {"op": "add_copies", "source": "water", "count": 2})))
attention = respond("NEEDS_ATTENTION", "", plan({"op": "add_copies", "source": "water", "count": 5}))
attention["reply"] = "Needs attention, not done: asked for 6 water molecule(s) (6 x H2O); the drawing has 5 separate fragment(s) (5 x H2O), of which 5 are water. The steps are shown so you can inspect them; use Undo all, or rephrase the request."
save("needs-attention", attention)
print("wrote", sorted(p.name for p in OUT.iterdir()))
