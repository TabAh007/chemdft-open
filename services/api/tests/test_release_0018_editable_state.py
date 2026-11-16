"""0.0.18: an unannotated XYZ is CALCULATION_USER_DECLARED; its charge/multiplicity may differ per calculation."""

from __future__ import annotations

from test_xyz_electronic_state import command, imported


def test_calculation_user_declared_reports_editable_authority_and_server_accepts_a_mismatch(
    api, monkeypatch
):
    # Engine availability is not under test; the electronic-state rule is.
    monkeypatch.setattr("chemdft_api.calculation_actions.validate_capability", lambda *a: None)
    client, _sessions, _settings = api
    project, version = imported(api, "ammonium")  # the file declares nothing: stored 0 / 1
    detail = client.get(f"/v1/projects/{project}/structures/{version['structure_id']}/versions/{version['id']}")
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["electronic_state_authority"] == "CALCULATION_USER_DECLARED"
    assert (version["overall_charge"], version["multiplicity"]) == (0, 1)
    # The Guided workspace shows editable fields for this authority; the server must accept a different value.
    response = client.post(f"/v1/projects/{project}/calculations", json=command(project, version, 1, 1))
    assert response.status_code == 201, response.text
    spec = response.json()["specification"]
    assert (spec["charge"], spec["multiplicity"]) == (1, 1)
    # ...and the stored structure is not rewritten.
    from chemdft_api.scientific_models import StructureVersionRecord

    with _sessions() as session:
        stored = session.get(StructureVersionRecord, version["id"])
        assert (stored.overall_charge, stored.multiplicity) == (0, 1)
