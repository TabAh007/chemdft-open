import hashlib
from pathlib import Path

from chemdft_api.models import StoredFile


def test_raw_upload_preserves_bytes_hash_and_provenance(api) -> None:
    client, sessions, settings = api
    project = client.post(
        "/v1/projects", json={"name": "Raw evidence", "slug": "raw-evidence"}
    ).json()
    source = b"data_demo\n_symmetry_space_group_name_H-M 'P 1'\n"

    response = client.post(
        f"/v1/projects/{project['id']}/files",
        files={"upload": ("source.cif", source, "chemical/x-cif")},
    )

    assert response.status_code == 201
    metadata = response.json()
    assert "object_key" not in metadata
    with sessions() as session:
        stored = session.get(StoredFile, metadata["id"])
        assert stored is not None
        stored_path = Path(settings.object_root) / stored.object_key
    assert stored_path.read_bytes() == source
    assert metadata["sha256"] == hashlib.sha256(source).hexdigest()
    assert metadata["size_bytes"] == len(source)
    assert metadata["provenance_class"] == "raw"


def test_viewer_cannot_upload(api) -> None:
    client, sessions, settings = api
    project = client.post("/v1/projects", json={"name": "Restricted", "slug": "restricted"}).json()
    viewer_id = "00000000-0000-4000-8000-000000000003"
    from chemdft_api.models import ProjectMember, User

    with sessions() as session:
        session.add(User(id=viewer_id, email="viewer@example.invalid", display_name="Viewer"))
        session.flush()
        session.add(ProjectMember(project_id=project["id"], user_id=viewer_id, role="viewer"))
        session.commit()

    response = client.post(
        f"/v1/projects/{project['id']}/files",
        headers={
            "X-ChemDFT-User-ID": viewer_id,
            "X-ChemDFT-Organization-ID": settings.dev_organization_id,
        },
        files={"upload": ("source.xyz", b"0\nempty\n", "chemical/x-xyz")},
    )
    assert response.status_code == 403
