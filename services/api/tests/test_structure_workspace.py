from uuid import UUID, uuid4

import pytest
from chemdft_api.context import Identity
from chemdft_api.contracts.catalog import StructureVersionCreateInput
from chemdft_api.scientific_models import AuditEventRecord, StructureVersionRecord
from chemdft_api.tool_registry import ToolInvocationContext, ToolInvocationError
from chemdft_api.tool_registry.catalog import build_phase_2_registry
from pydantic import ValidationError
from sqlalchemy import func, select

XYZ_WATER = b"""3
water
O 0.000000 0.000000 0.000000
H 0.758602 0.000000 0.504284
H -0.758602 0.000000 0.504284
"""

SDF_METHANE = b"""Methane
  ChemDFT

  5  4  0  0  0  0            999 V2000
    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    0.6291    0.6291    0.6291 H   0  0  0  0  0  0  0  0  0  0  0  0
   -0.6291   -0.6291    0.6291 H   0  0  0  0  0  0  0  0  0  0  0  0
   -0.6291    0.6291   -0.6291 H   0  0  0  0  0  0  0  0  0  0  0  0
    0.6291   -0.6291   -0.6291 H   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0
  1  3  1  0
  1  4  1  0
  1  5  1  0
M  END
$$$$
"""

CIF_NACL = b"""data_NaCl
_symmetry_space_group_name_H-M   'P 1'
_cell_length_a   5.6402
_cell_length_b   5.6402
_cell_length_c   5.6402
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
loop_
 _atom_site_label
 _atom_site_type_symbol
 _atom_site_fract_x
 _atom_site_fract_y
 _atom_site_fract_z
 _atom_site_occupancy
 Na1 Na 0 0 0 1
 Cl1 Cl 0.5 0.5 0.5 1
"""


def _create_project(client, name="Structures"):
    return client.post(
        "/v1/projects",
        json={"name": name, "slug": f"structures-{uuid4().hex[:8]}"},
    ).json()


def _import(client, project_id, filename, data, file_format, *, key=None):
    return client.post(
        f"/v1/projects/{project_id}/structures/imports",
        data={
            "file_format": file_format,
            "idempotency_key": key or f"import-{uuid4().hex}",
        },
        files={"upload": (filename, data, "chemical/x-" + file_format.lower())},
    )


@pytest.mark.parametrize(
    ("filename", "data", "file_format", "kind", "atoms", "bonds"),
    [
        ("water.xyz", XYZ_WATER, "XYZ", "MOLECULE", 3, 0),
        ("methane.sdf", SDF_METHANE, "SDF", "MOLECULE", 5, 4),
        ("nacl.cif", CIF_NACL, "CIF", "PERIODIC", 2, 0),
    ],
)
def test_structure_imports_real_formats_without_storage_leaks(
    api,
    filename,
    data,
    file_format,
    kind,
    atoms,
    bonds,
) -> None:
    client, sessions, _settings = api
    project = _create_project(client, f"{file_format} import")
    response = _import(client, project["id"], filename, data, file_format)

    assert response.status_code == 201, response.text
    body = response.json()
    assert "storage_key" not in str(body)
    assert body["structure"]["kind"] == kind
    assert body["version"]["revision"] == 1
    assert body["version"]["origin"] == "IMPORTED"
    assert len(body["version"]["coordinates"]["atoms"]) == atoms
    assert len(body["version"]["coordinates"]["bonds"]) == bonds
    if file_format == "CIF":
        assert body["version"]["periodic_cell"]["a"] == 5.6402
    if file_format == "XYZ":
        assert body["version"]["diagnostics"][0]["code"] == "MISSING_CONNECTIVITY"

    listed = client.get(f"/v1/projects/{project['id']}/structures").json()
    assert listed[0]["latest_revision"] == 1
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(AuditEventRecord)) >= 2


def test_import_idempotency_and_version_immutability(api) -> None:
    client, sessions, _settings = api
    project = _create_project(client, "Idempotent import")
    key = f"import-{uuid4().hex}"

    first = _import(client, project["id"], "water.xyz", XYZ_WATER, "XYZ", key=key).json()
    second = _import(client, project["id"], "water.xyz", XYZ_WATER, "XYZ", key=key).json()

    assert second["version"]["id"] == first["version"]["id"]
    with sessions() as session:
        versions = session.scalars(select(StructureVersionRecord)).all()
    assert len(versions) == 1
    assert versions[0].revision == 1


def test_optimized_origin_cannot_be_asserted_by_user_payload_or_tool(api) -> None:
    client, sessions, settings = api
    project = _create_project(client, "Origin policy")
    imported = _import(client, project["id"], "methane.sdf", SDF_METHANE, "SDF").json()
    version = imported["version"]
    coordinate_payload = dict(version["coordinates"])
    coordinate_payload.pop("structure_version_id")
    coordinate_payload.pop("source")
    payload = {
        "structure_id": imported["structure"]["id"],
        "parent_version_id": version["id"],
        "representation_artifact": version["representation_artifacts"][0],
        "coordinates": coordinate_payload,
        "overall_charge": 0,
        "multiplicity": 1,
        "requested_origin": "OPTIMIZED",
        "idempotency_key": f"edit-{uuid4().hex}",
    }

    response = client.post(
        f"/v1/projects/{project['id']}/structures/versions",
        json=payload,
    )
    assert response.status_code == 422
    with pytest.raises(ValidationError):
        StructureVersionCreateInput.model_validate(payload)

    with sessions() as session:
        registry = build_phase_2_registry(session)
        context = ToolInvocationContext(
            request_id=uuid4(),
            identity=Identity(
                user_id=settings.dev_user_id,
                organization_id=settings.dev_organization_id,
            ),
            project_id=UUID(project["id"]),
            capabilities=frozenset({"structure.write"}),
            approval_references=frozenset(),
            transport="INTERNAL",
        )
        with pytest.raises(ToolInvocationError):
            registry.invoke("structure.version.create", payload, context)


def test_manual_edit_creates_next_immutable_version(api) -> None:
    client, _sessions, _settings = api
    project = _create_project(client, "Manual edit")
    imported = _import(client, project["id"], "methane.sdf", SDF_METHANE, "SDF").json()
    version = imported["version"]
    coordinate_payload = dict(version["coordinates"])
    coordinate_payload.pop("structure_version_id")
    coordinate_payload.pop("source")
    coordinate_payload["atoms"] = [
        {**atom, "x": atom["x"] + 0.1 if atom["index"] == 0 else atom["x"]}
        for atom in coordinate_payload["atoms"]
    ]
    payload = {
        "structure_id": imported["structure"]["id"],
        "parent_version_id": version["id"],
        "representation_artifact": version["representation_artifacts"][0],
        "coordinates": coordinate_payload,
        "overall_charge": 0,
        "multiplicity": 1,
        "idempotency_key": f"edit-{uuid4().hex}",
    }

    created = client.post(
        f"/v1/projects/{project['id']}/structures/versions",
        json=payload,
    )
    assert created.status_code == 201, created.text
    new_version = created.json()["version"]
    assert new_version["origin"] == "MANUALLY_EDITED"
    assert new_version["revision"] == 2
    assert new_version["parent_version_id"] == version["id"]
    detail = client.get(
        f"/v1/projects/{project['id']}/structures/"
        f"{imported['structure']['id']}/versions/{version['id']}"
    ).json()
    assert detail["version"]["revision"] == 1

    versions = client.get(
        f"/v1/projects/{project['id']}/structures/{imported['structure']['id']}/versions"
    )
    assert versions.status_code == 200, versions.text
    version_history = versions.json()
    assert [item["version"]["revision"] for item in version_history] == [1, 2]
    assert version_history[0]["provenance"]["parser"] == "rdkit"
    assert version_history[0]["provenance"]["source_class"] == "USER_SUPPLIED"
    assert version_history[0]["provenance"]["detail"] == "MANUAL_ENTRY"
    assert version_history[0]["provenance"]["adapter"] == "chemdft.rdkit.molecular"
    assert version_history[1]["provenance"]["source_class"] == "USER_SUPPLIED"
    assert version_history[1]["provenance"]["operation"] == "chemdft.structure.version.create"
    assert "storage_key" not in str(version_history)
    assert "object_key" not in str(version_history)


def test_molecular_structure_version_exports_sdf(api) -> None:
    client, _sessions, _settings = api
    project = _create_project(client, "Molecular export")
    imported = _import(client, project["id"], "methane.sdf", SDF_METHANE, "SDF").json()

    response = client.get(
        f"/v1/projects/{project['id']}/structures/{imported['structure']['id']}/versions/"
        f"{imported['version']['id']}/export",
        params={"file_format": "SDF"},
    )

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("chemical/x-mdl-sdfile")
    assert response.headers["content-disposition"].endswith('.sdf"')
    assert b"M  END" in response.content
    assert b"$$$$" in response.content


def test_editor_mol_upload_creates_next_version_without_mutating_parent(api) -> None:
    client, _sessions, _settings = api
    project = _create_project(client, "Editor save")
    imported = _import(client, project["id"], "methane.sdf", SDF_METHANE, "SDF").json()
    parent = imported["version"]
    edited_mol = SDF_METHANE.split(b"$$$$")[0].replace(
        b"0.0000    0.0000    0.0000 C",
        b"0.2500    0.0000    0.0000 C",
    )

    response = client.post(
        f"/v1/projects/{project['id']}/structures/{imported['structure']['id']}/versions/imports",
        data={
            "file_format": "MOL",
            "parent_version_id": parent["id"],
            "idempotency_key": f"ketcher-{uuid4().hex}",
        },
        files={"upload": ("ketcher-edit.mol", edited_mol, "chemical/x-mdl-molfile")},
    )

    assert response.status_code == 201, response.text
    new_version = response.json()["version"]
    assert new_version["revision"] == 2
    assert new_version["parent_version_id"] == parent["id"]
    assert new_version["coordinates"]["atoms"][0]["x"] == 0.25
    parent_detail = client.get(
        f"/v1/projects/{project['id']}/structures/{imported['structure']['id']}/versions/{parent['id']}"
    ).json()
    assert parent_detail["version"]["revision"] == 1
    assert parent_detail["version"]["coordinates"]["atoms"][0]["x"] == 0.0
    assert "storage_key" not in str(response.json())
    assert "object_key" not in str(response.json())


def test_periodic_structure_version_exports_cif_and_rejects_molecular_format(api) -> None:
    client, _sessions, _settings = api
    project = _create_project(client, "Periodic export")
    imported = _import(client, project["id"], "nacl.cif", CIF_NACL, "CIF").json()

    cif_response = client.get(
        f"/v1/projects/{project['id']}/structures/{imported['structure']['id']}/versions/"
        f"{imported['version']['id']}/export",
        params={"file_format": "CIF"},
    )
    sdf_response = client.get(
        f"/v1/projects/{project['id']}/structures/{imported['structure']['id']}/versions/"
        f"{imported['version']['id']}/export",
        params={"file_format": "SDF"},
    )

    assert cif_response.status_code == 200, cif_response.text
    assert cif_response.headers["content-type"].startswith("chemical/x-cif")
    assert b"data_" in cif_response.content
    assert b"_cell_length_a" in cif_response.content
    assert sdf_response.status_code == 422
