# ruff: noqa: E501  (long assertions)
"""RW-3.2: the export catalog and the evidence archive share one classification decision.

The browser acceptance found a CREST calculation whose catalog advertised REPRODUCIBILITY_PACKAGE while
the downloaded archive was a PROVENANCE_ARCHIVE: the catalog assessed the archive without reading the
stored engine input (``read=False``) and so never saw that it could not be exported without scientific
loss. These tests reproduce that class of divergence on a genuine xTB run (disposable storage) and assert
that the catalog now says exactly what the download produces.
"""

from __future__ import annotations

import json

from chemdft_api import reproducibility_bundle as bundle
from chemdft_api.errors import ExportLimitExceeded
from chemdft_api.scientific_models import CalculationInputRecord, ScientificArtifactRecord
from chemdft_api.storage import LocalObjectStore
from rw3_archive_support import (
    export_bundle,
    json_member,
    open_archive,
    real_xtb_run,
    store_artifact,
)
from sqlalchemy import select, update


def _catalog_bundle(client, project, calc):
    response = client.get(f"/v1/projects/{project}/calculations/{calc}/exports")
    assert response.status_code == 200, response.text
    return next(f for f in response.json()["formats"] if f["format"] == "reproducibility-bundle")


def _classification(client, project, calc):
    return json_member(open_archive(export_bundle(client, project, calc)), "MANIFEST.json")


def _input_artifact(sessions, calc):
    with sessions() as session:
        row = session.scalar(
            select(CalculationInputRecord).where(CalculationInputRecord.calculation_id == calc)
        )
        return row.id, session.get(ScientificArtifactRecord, row.normalized_input_artifact_id)


def test_catalog_agrees_when_the_engine_input_cannot_be_exported_without_loss(api):
    client, sessions, settings = api
    project, _v, calc, _r = real_xtb_run(api)
    clean = _catalog_bundle(client, project, calc)
    assert clean["available"] is True
    assert (
        clean["variants"][0]["key"]
        == _classification(client, project, calc)["classification"]
        == "REPRODUCIBILITY_PACKAGE"
    )

    # Engine input with free text and an unreviewed key, hash-valid (as CREST's input is): the archive
    # withholds it and is downgraded; the catalog must say so before the download.
    row_id, artifact = _input_artifact(sessions, calc)
    document = json.loads(
        LocalObjectStore(settings.object_root).get_bytes(artifact.storage_key, 10**7)
    )
    document["comment"] = "free text a re-run would need"
    document["engine_specific_block"] = "unreviewed engine directive"
    replaced = store_artifact(
        sessions,
        settings,
        project,
        json.dumps(document).encode(),
        kind="CALCULATION_INPUT",
        media_type="application/json",
        format_identifier="chemdft.calculation_input",
    )
    with sessions() as session:
        session.execute(
            update(CalculationInputRecord)
            .where(CalculationInputRecord.id == row_id)
            .values(normalized_input_artifact_id=replaced)
        )
        session.commit()

    variant = _catalog_bundle(client, project, calc)["variants"][0]
    manifest = _classification(client, project, calc)
    assert manifest["classification"] == "PROVENANCE_ARCHIVE"
    assert manifest["required_evidence"]["ENGINE_INPUT"] == "NOT_REVIEWED_FOR_EXPORT"
    assert variant["key"] == manifest["classification"] == "PROVENANCE_ARCHIVE"
    assert "ENGINE_INPUT: NOT_REVIEWED_FOR_EXPORT" in variant["detail"]
    # The catalog never echoes the withheld text.
    assert "free text" not in json.dumps(
        variant
    ) and "unreviewed engine directive" not in json.dumps(variant)


def test_catalog_agrees_when_stored_engine_input_bytes_fail_their_hash(api):
    client, sessions, settings = api
    project, _v, calc, _r = real_xtb_run(api)
    _row, artifact = _input_artifact(sessions, calc)
    path = LocalObjectStore(settings.object_root).root / artifact.storage_key
    original = path.read_bytes()
    try:
        path.write_bytes(original + b" ")
        variant = _catalog_bundle(client, project, calc)["variants"][0]
        manifest = _classification(client, project, calc)
        assert manifest["required_evidence"]["ENGINE_INPUT"] == "HASH_MISMATCH"
        assert variant["key"] == manifest["classification"] == "PROVENANCE_ARCHIVE"
        assert "ENGINE_INPUT: HASH_MISMATCH" in variant["detail"]
    finally:
        path.write_bytes(original)
    assert _catalog_bundle(client, project, calc)["variants"][0]["key"] == "REPRODUCIBILITY_PACKAGE"


def test_catalog_does_not_offer_an_archive_the_download_would_refuse(api, monkeypatch):
    client, _sessions, _settings = api
    project, _v, calc, _r = real_xtb_run(api)

    def refuse(*_args, **_kwargs):
        raise ExportLimitExceeded("A stored record exceeds the export bound.")

    monkeypatch.setattr(bundle, "_assess", refuse)
    option = _catalog_bundle(client, project, calc)
    assert option["available"] is False and option["variants"] == []
    assert "no archive can be produced" in option["unsupported_reason"]
    assert export_bundle(client, project, calc).status_code == 413
    # The other formats are unaffected.
    formats = {
        f["format"]: f
        for f in client.get(f"/v1/projects/{project}/calculations/{calc}/exports").json()["formats"]
    }
    assert formats["result-json"]["available"] is True


def test_catalog_classification_is_still_project_scoped(api):
    client, _sessions, _settings = api
    project, _v, calc, _r = real_xtb_run(api)
    other = client.post(
        "/v1/projects", json={"name": "other", "slug": "rw32-other-project"}
    ).json()["id"]
    assert client.get(f"/v1/projects/{other}/calculations/{calc}/exports").status_code == 404
    assert export_bundle(client, other, calc).status_code == 404
    assert _catalog_bundle(client, project, calc)["variants"][0]["key"] == "REPRODUCIBILITY_PACKAGE"
