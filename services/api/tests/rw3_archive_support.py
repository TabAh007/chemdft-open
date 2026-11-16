# ruff: noqa: E501
"""Shared helpers for the RW-3 portable-archive security and fidelity tests (synthetic data only)."""

from __future__ import annotations

import hashlib
import io
import json
import zipfile
from pathlib import Path
from uuid import uuid4

from chemdft_api.models import Project as ProjectRecord
from chemdft_api.scientific_models import (
    CalculationInputRecord,
    CalculationResultRecord,
    ScientificArtifactRecord,
)
from chemdft_api.storage import LocalObjectStore
from sqlalchemy import select, update

# One distinct synthetic value per input path, so a hit identifies the leaking path. None is a real
# credential; none matches the platform's recognized-credential pattern except where named.
SENTINELS = {
    "log": "SENTINEL-LOG-Zx9QvB3kT7mP2wR8nL5cY1dF4hJ6",
    "binary": "SENTINEL-BIN-Qm4Vt8Yc2Lr7Pn1Xd6Kb9Hs3Wf5",
    "recognized": "sk-" "synthetic-0123456789abcdef0123456789",
    "producer": "SENTINEL-PRODUCER-Ha7Jd2Kf9Lq4Mw8Nz3Rx6",
    "result_meta": "SENTINEL-RESULTMETA-Bt5Yu1Io8Pe3As7Df2Gh9",
    "result_key": "SENTINEL_RESULTKEY_Cv6Xn2Mb8Zq4",
    "env": "SENTINEL-ENV-Fg3Hj7Kl1Zx5Cv9Bn2Mq8",
    "env_key": "SENTINEL_ENVKEY_Wr4Ty8Ui2Op6",
    "input_comment": "SENTINEL-INPUTCOMMENT-Rt9Yu3Io7Pa1Sd5Fg",
    "struct_comment": "SENTINEL-STRUCTCOMMENT-Lk2Jh6Gf0Ds4Aq8",
    "format_id": "SENTINEL-FORMATID-Mn7Bv1Cx5Zl9Kj3",
    "artifact_name": "SENTINEL-ARTIFACTNAME-Pq8Wo2Ei6Ru0Ty4",
    "structure_name": "SENTINEL-STRUCTURENAME-Df3Gh7Jk1Lz5Xc9",
    "project_name": "SENTINEL-PROJECTNAME-Vb2Nm6As0Df4Gh8",
    "spec_extension": "SENTINEL-SPECEXT-Ui5Op9Qw3Er7Ty1",
    "unknown_key": "SENTINEL_UNKNOWNKEY_Hj4Kl8Zx2Cv6",
    "kind": "SENTINEL_KIND_Ty6Ui0Op4As8",
    "provenance_param": "SENTINEL-PROVPARAM-Gh1Jk5Lz9Xc3",
}


def open_archive(response) -> dict[str, bytes]:
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert archive.testzip() is None
        names = archive.namelist()
        assert len(names) == len(set(names)), "duplicate ZIP member names"
        return {name: archive.read(name) for name in names}


def whole_archive(files: dict[str, bytes]) -> bytes:
    """Everything an extractor or reader could see: every member NAME and every member body."""
    return b"\n".join([*(n.encode() for n in files), *files.values()])


def assert_absent(files: dict[str, bytes], *keys: str) -> None:
    blob = whole_archive(files)
    for key in keys:
        assert SENTINELS[key].encode() not in blob, f"sentinel {key!r} leaked into the archive"


def numeric_leaves(value, path=""):
    """Every number/bool at a path; strings and None are ignored (free text is not exported)."""
    if isinstance(value, (bool, int, float)):
        yield (path, value)
    elif isinstance(value, dict):
        for k in sorted(value):
            yield from numeric_leaves(value[k], f"{path}.{k}")
    elif isinstance(value, (list, tuple)):
        for i, v in enumerate(value):
            yield from numeric_leaves(v, f"{path}[{i}]")


def store_artifact(sessions, settings, project_id: str, data: bytes, *, kind="ENGINE_LOG",
                   media_type="text/plain", format_identifier="engine.stdout") -> str:
    stored = LocalObjectStore(settings.object_root).put_raw(project_id, io.BytesIO(data), 50_000_000)
    with sessions() as session:
        user = session.get(ProjectRecord, project_id).created_by
        artifact = ScientificArtifactRecord(
            project_id=project_id, kind=kind, media_type=media_type, format_identifier=format_identifier,
            format_version="1", size_bytes=stored.size_bytes, sha256=stored.sha256,
            storage_key=stored.key, created_by=user, extensions_json=[],
        )
        session.add(artifact)
        session.commit()
        return artifact.id


def attach_raw(sessions, result_id: str, artifact_ids: list[str]) -> None:
    with sessions() as session:
        record = session.get(CalculationResultRecord, result_id)
        refs = [
            {"project_id": record.project_id, "artifact_id": a,
             "sha256": session.get(ScientificArtifactRecord, a).sha256}
            for a in artifact_ids
        ]
        session.execute(
            update(CalculationResultRecord)
            .where(CalculationResultRecord.id == result_id)
            .values(raw_artifacts_json=[*record.raw_artifacts_json, *refs])
        )
        session.commit()


def export_bundle(client, project, calculation):
    return client.get(
        f"/v1/projects/{project}/calculations/{calculation}/export",
        params={"format": "reproducibility-bundle"},
    )


def real_xtb_run(api, *, xyz: bytes = b"1\nHelium\nHe 0 0 0\n", name: str | None = None):
    """A genuine xTB single-point through the real worker. Returns (project, version_id, calc, result)."""
    from rw2_support import import_structure
    from test_pf8b2_post_audit import process, queue

    client, sessions, _settings = api
    project = client.post("/v1/projects", json={"name": name or "archive", "slug": f"a-{uuid4().hex[:10]}"}).json()["id"]
    version = import_structure(client, project, xyz=xyz, name=name or "structure")
    _project, _source, response = queue(api, engine="xtb", task="ENERGY", project=project, source={"id": version})
    assert response.status_code == 201, response.text
    calc = response.json()["calculation"]["id"]
    detail = process(api)
    assert detail.calculation.state == "SUCCEEDED"
    with sessions() as session:
        result = session.scalar(select(CalculationResultRecord.id).where(CalculationResultRecord.calculation_id == calc))
    return project, version, calc, result


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def extract_all(files: dict[str, bytes], target: Path) -> list[Path]:
    paths = []
    for name, data in files.items():
        destination = (target / name).resolve()
        assert destination.is_relative_to(target.resolve()), f"extraction escape: {name}"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        paths.append(destination)
    return paths


def json_member(files: dict[str, bytes], name: str):
    return json.loads(files[name])


def calc_input_row(sessions, calc: str):
    with sessions() as session:
        return session.scalar(select(CalculationInputRecord).where(CalculationInputRecord.calculation_id == calc))
