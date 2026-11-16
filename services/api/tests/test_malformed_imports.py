"""PF-2.1: malformed upload input is a controlled 4xx, never an uncaught 500, and stores nothing."""

from __future__ import annotations

import pytest
from test_structure_workspace import CIF_NACL

EXPERIMENTAL_FORM = {
    "modality": "XRD",
    "x_column": "x",
    "y_columns": "y",
    "x_label": "2theta",
    "x_unit": "degree",
    "y_label": "Intensity",
    "y_unit": "count",
    "experiment_name": "Imported XRD",
}


def _project(client) -> str:
    return client.post("/v1/projects", json={"name": "Imports", "slug": "imports"}).json()["id"]


def _experimental(client, pid: str, **overrides):
    return client.post(
        f"/v1/projects/{pid}/experimental/imports",
        data={**EXPERIMENTAL_FORM, **overrides},
        files={"upload": ("xrd.csv", b"x,y\n10,2\n11,3\n", "text/csv")},
    )


def test_a_valid_experimental_import_is_unchanged(api) -> None:
    client, _sessions, _settings = api
    pid = _project(client)
    response = _experimental(client, pid)
    assert response.status_code == 201, response.text
    assert (response.json()["state"], response.json()["point_count"]) == ("RAW", 2)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("modality", "x"),
        ("modality", "NOT_A_TECHNIQUE"),
        ("modality", ""),
        ("x_label", ""),
        ("experiment_name", ""),
        ("y_columns", " , "),
    ],
)
def test_invalid_experimental_import_fields_are_a_controlled_422(api, field, value) -> None:
    client, _sessions, _settings = api
    pid = _project(client)
    response = _experimental(client, pid, **{field: value})
    assert response.status_code == 422, (field, value, response.status_code, response.text[:200])
    body = response.json()
    assert isinstance(body["detail"], list) and body["detail"]
    assert body["detail"][0]["loc"][0] == "body"  # reported like any other invalid request body
    assert "Traceback" not in response.text and "ValidationError" not in response.text
    assert (
        client.get(f"/v1/projects/{pid}/experimental/datasets").json()["datasets"] == []
    )  # nothing stored


def test_a_valid_cif_import_is_unchanged(api) -> None:
    client, _sessions, _settings = api
    pid = _project(client)
    response = client.post(
        f"/v1/projects/{pid}/structures/imports",
        files={"upload": ("nacl.cif", CIF_NACL, "chemical/x-cif")},
        data={"file_format": "CIF", "idempotency_key": "cif-valid-1", "structure_name": "NaCl"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["version"]["id"]


@pytest.mark.parametrize(
    "content",
    [
        b"x",
        b"",
        b"data_broken\n",
        b"data_a\n_cell_length_a notanumber\n",
        CIF_NACL[: len(CIF_NACL) // 2],
        b"\x00\x01\x02\x03 binary junk",
        CIF_NACL.replace(b"_cell_length_a   5.6402", b"_cell_length_a   ?"),
    ],
    ids=["one-byte", "empty", "header-only", "bad-number", "truncated", "binary", "unknown-cell"],
)
def test_malformed_cif_is_a_controlled_4xx_and_stores_nothing(api, content) -> None:
    client, _sessions, _settings = api
    pid = _project(client)
    response = client.post(
        f"/v1/projects/{pid}/structures/imports",
        files={"upload": ("broken.cif", content, "chemical/x-cif")},
        data={"file_format": "CIF", "idempotency_key": "cif-bad-0001", "structure_name": "x"},
    )
    assert response.status_code in (400, 415, 422), (response.status_code, response.text[:200])
    assert "Traceback" not in response.text and "pymatgen" not in response.text.lower()
    assert (
        client.get(f"/v1/projects/{pid}/structures").json() == []
    )  # no structure, version or artifact
    assert (
        client.get(f"/v1/projects/{pid}/files").json() == []
        or client.get(f"/v1/projects/{pid}/files").status_code == 200
    )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("file_format", "x"),
        ("file_format", "A" * 17),
        ("idempotency_key", "short"),
    ],
)
def test_invalid_structure_import_form_values_are_a_422_and_store_nothing(
    api, field, value
) -> None:
    client, _sessions, _settings = api
    pid = _project(client)
    form = {"file_format": "XYZ", "idempotency_key": "form-valid-1", "structure_name": "H2"}
    form[field] = value
    response = client.post(
        f"/v1/projects/{pid}/structures/imports",
        files={"upload": ("h2.xyz", b"2\nH2\nH 0 0 -0.37\nH 0 0 0.37\n", "chemical/x-xyz")},
        data=form,
    )
    assert response.status_code == 422, (field, value, response.status_code, response.text[:200])
    assert response.json()["detail"][0]["loc"] == ["body", field]
    assert client.get(f"/v1/projects/{pid}/structures").json() == []
    assert client.get(f"/v1/projects/{pid}/files").json() == []  # not even the raw upload was kept
