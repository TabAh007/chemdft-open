from urllib.parse import unquote

import pytest
from test_geometry_workflow import accept, drawing, generate
from test_structure_workspace import _create_project, _import


@pytest.mark.parametrize(
    "name",
    ["Hexane", "Bakı – Hexane", "β-Ethanol", "Бензол"],  # noqa: RUF001 -- Unicode names
)
def test_unicode_structure_export_preserves_name_and_edit_lineage(api, name):
    client, _, _ = api
    project = _create_project(client, "Unicode export regression")["id"]
    response = generate(client, project, name=name)
    assert response.status_code == 201, response.text
    original = accept(client, project, response.json()).json()
    structure = original["structure"]["id"]
    version = original["version"]["id"]
    base = f"/v1/projects/{project}/structures/{structure}/versions/{version}"
    before = client.get(base).json()

    exported = client.get(base + "/export?file_format=MOL")
    assert exported.status_code == 200, exported.text
    disposition = exported.headers["content-disposition"]
    disposition.encode("ascii")
    if "filename*=" in disposition:
        filename = unquote(disposition.split("filename*=UTF-8''", 1)[1])
    else:
        filename = disposition.split('filename="', 1)[1].removesuffix('"')
    assert name in filename
    assert name in exported.text
    assert before["structure"]["name"] == name
    reimported = _import(client, project, "roundtrip.mol", exported.content, "MOL")
    assert reimported.status_code == 201, reimported.text
    assert reimported.json()["structure"]["name"] == name
    roundtrip_atoms = reimported.json()["version"]["coordinates"]["atoms"]
    original_atoms = before["version"]["coordinates"]["atoms"]
    assert len(roundtrip_atoms) == len(original_atoms)
    for original_atom, roundtrip_atom in zip(original_atoms, roundtrip_atoms, strict=True):
        for key in ("index", "element", "atomic_number"):
            assert roundtrip_atom[key] == original_atom[key]
        for axis in ("x", "y", "z"):
            assert roundtrip_atom[axis] == pytest.approx(original_atom[axis], abs=5.1e-5)
    assert client.get(base).json() == before

    parent = {"entity_type": "structure.version", "entity_id": version, "project_id": project}
    edited = generate(
        client, project, name=name, mol_block=drawing("CCO"), parent_structure_version=parent
    )
    assert edited.status_code == 201, edited.text
    candidate = edited.json()
    assert candidate["manifest"]["canonical_smiles"] == "CCO"
    accepted = accept(client, project, candidate)
    assert accepted.status_code == 201, accepted.text
    child = accepted.json()["version"]
    assert child["structure_id"] == structure
    assert child["project_id"] == project
    assert child["parent_version_id"] == version
    assert child["revision"] == 2
    assert (
        child["coordinates"]["atoms"]
        == candidate["manifest"]["coordinate_representation"]["coordinates"]["atoms"]
    )
    assert client.get(base).json() == before
