from __future__ import annotations

from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4

import pytest
from chemdft_api.ai.structure_inspection import (
    is_structure_inspection_request,
    structure_inspection_answer,
)
from chemdft_api.contracts.ai import PostMessageInput
from chemdft_api.contracts.catalog import CalculationSubmitInput
from pydantic import ValidationError

QUESTION = (
    "What structure is currently open, where did its coordinates come from, "
    "and does it have authoritative bond connectivity?"
)
WATER = b"3\nTest water\nO 0 0 0\nH 0 0 0.9572\nH 0.926627 0 -0.239987\n"


def test_structure_request_is_bounded_and_does_not_capture_paper_or_edit_questions():
    assert is_structure_inspection_request(QUESTION)
    assert not is_structure_inspection_request("What structure does Figure 2 in the paper report?")
    assert not is_structure_inspection_request("Promote visual bonds in the current structure")
    assert not is_structure_inspection_request("Calculate the current structure")


def test_exact_version_selection_has_no_latest_or_other_structure_fallback():
    saved = {
        "id": "v1",
        "revision": 1,
        "origin": "IMPORTED",
        "atom_count": 3,
        "bond_count": 0,
        "source_class": "USER_SUPPLIED",
        "source_format": "XYZ",
    }
    newer = {**saved, "id": "v2", "revision": 2, "bond_count": 2}
    view = {"selected_structure_id": "s", "selected_structure_version_id": "v1"}
    graph = SimpleNamespace(
        structures=({"id": "s", "name": "Water", "versions": (saved, newer)},), current_view=view
    )
    original = deepcopy(saved)
    answer = structure_inspection_answer({"project_context": graph})
    assert answer.status == "SUPPORTED"
    assert "0 authoritative bonds" in answer.content
    assert "XYZ" in answer.content
    assert answer.citations[0]["entity_id"] == "v1"
    assert "display" in answer.content
    assert saved == original
    for bad in (None, "missing", "v3"):
        view["selected_structure_version_id"] = bad
        assert (
            structure_inspection_answer({"project_context": graph}).status
            == "INSUFFICIENT_EVIDENCE"
        )
    view.update(selected_structure_version_id="v1", selected_structure_id="other")
    assert not structure_inspection_answer({"project_context": graph}).citations


def test_visualization_extras_are_rejected_by_ai_and_calculation_contracts():
    for field in ("visual_bonds", "coordinates", "authority", "periodic_cell"):
        with pytest.raises(ValidationError):
            PostMessageInput.model_validate({"content": QUESTION, field: []})
    assert not (
        {"visual_bonds", "coordinates", "bonds"} & CalculationSubmitInput.model_fields.keys()
    )
    with pytest.raises(ValidationError) as error:
        CalculationSubmitInput.model_validate({"visual_bonds": [{"displayOnly": True}]})
    assert any(item["type"] == "extra_forbidden" for item in error.value.errors())


@pytest.mark.parametrize("mode", ["STANDARD", "EVIDENCE"])
def test_structure_answer_is_source_bound_and_keeps_coordinates_exports_and_authority(api, mode):
    client, _sessions, _settings = api
    project = client.post(
        "/v1/projects", json={"name": "Structure inspection", "slug": f"view-{uuid4().hex}"}
    ).json()
    pid = project["id"]
    imported = client.post(
        f"/v1/projects/{pid}/structures/imports",
        files={"upload": ("water.xyz", WATER, "chemical/x-xyz")},
        data={
            "file_format": "XYZ",
            "idempotency_key": f"import-{uuid4()}",
            "structure_name": "Water",
        },
    ).json()
    sid, vid = imported["structure"]["id"], imported["version"]["id"]
    path = f"/v1/projects/{pid}/structures/{sid}/versions/{vid}"
    before = client.get(path).json()
    assert before["version"]["coordinates"]["bonds"] == []
    conversation = client.post(f"/v1/projects/{pid}/ai/conversations", json={}).json()[
        "conversation"
    ]["id"]
    response = client.post(
        f"/v1/projects/{pid}/ai/conversations/{conversation}/messages",
        json={
            "content": QUESTION,
            "mode": mode,
            "selected_structure_id": sid,
            "selected_structure_version_id": vid,
        },
    )
    assert response.status_code == 201, response.text
    answer = response.json()["messages"][-1]
    assert answer["evidence_status"] == "SUPPORTED"
    for text in (
        "USER_SUPPLIED",
        "IMPORTED",
        "XYZ",
        "3 atoms",
        "0 authoritative bonds",
        "not authoritative connectivity",
    ):
        assert text in answer["content"]
    assert answer["citations"][0]["entity_id"] == vid
    assert response.json()["latest_run"]["steps"] == []
    assert client.get(path).json() == before
    exported = client.get(path + "/export", params={"file_format": "SDF"})
    assert exported.status_code == 200, exported.text
    from rdkit import Chem

    mol = Chem.MolFromMolBlock(exported.text.split("$$$$")[0], sanitize=False, removeHs=False)
    assert mol.GetNumAtoms() == 3
    assert mol.GetNumBonds() == 0
    assert client.get(path).json() == before
