# ruff: noqa: E501
"""RW-3.1: a reproducibility package needs software-environment evidence, not just hardware facts.

Environment shapes below are the ones the real workers record (psi4.py, xtb_worker.py, crest.py,
dftd4.py, pyscf_worker.py; psi4 values copied from the accepted live result). No engine is run
except one cheap real xTB single point, whose stored environment row is then rewritten.
"""

from __future__ import annotations

import hashlib
import io
import json
import zipfile

import pytest
from chemdft_api import portable_export_policy as policy
from chemdft_api.scientific_models import CalculationResultRecord, ComputeExecutionRecord
from rw3_archive_support import (
    SENTINELS,
    export_bundle,
    json_member,
    numeric_leaves,
    open_archive,
    real_xtb_run,
    whole_archive,
)
from sqlalchemy import select, update

H1, H2 = "f17166d371e6a031179e0751d957a66e04ad11c9ca32c7fb43b9d144d554f3f9", "755f12cf7d87377cc88f3ab79c733e481befb7320258ae70601b17e9a545d4b3"

PSI4 = {"engine": "psi4", "engine_version": "1.11", "package_build": "x", "package_sha256": H2, "prefix": "/p", "runtime_manifest_sha256": H1,
        "runtime_files_verified": 3, "executable_sha256": H1, "architecture": "arm64",
        "libraries": {"python": "3.12.15", "qcelemental": "0.51.2", "qcengine": "0.51.0"}}
XTB = {"python": "3.12.15", "platform": "macOS-15.1-arm64-arm-64bit", "architecture": "arm64", "libraries": {"xtb": "6.7.1"},
       "thread_settings": {"OMP_NUM_THREADS": "1"}, "build": {"engine": "xtb", "version": "6.7.1", "executable_sha256": H1, "package_archive_sha256": H2}}
CREST = {"engine": "crest", "engine_version": "3.0.2", "executable_sha256": H1, "calculator": "gfn2", "libraries": {"tblite": "0.3.0-fork"}, "architecture": "arm64"}
DFTD4 = {"engine": "dftd4", "version": "4.2.0", "adapter_version": "1.0.0", "prefix": "/p", "files": {"bin/dftd4": H1, "lib/a.dylib": H2},
         "package": "conda-forge/osx-arm64::dftd4", "package_sha256": H2}
PYSCF = {"python": "3.12.15", "platform": "macOS-15.1-arm64-arm-64bit", "architecture": "arm64",
         "libraries": {"numpy": "2.5.3", "scipy": "1.18.1"}, "thread_settings": {"OMP_NUM_THREADS": "1"}}
HARDWARE = {"architecture": "arm64", "platform": "macOS-15.1-arm64-arm-64bit", "thread_settings": {"OMP_NUM_THREADS": "1"}, "hardware_class": "local.cpu"}


def _verdict(raw, engine):
    return policy.environment_sufficiency(policy.project_environment(raw, policy.Omissions(), "environment"), engine)


@pytest.mark.parametrize(
    ("raw", "engine", "expected"),
    [
        (PSI4, "psi4", None),  # F, J: native build identity
        (XTB, "xtb", None),  # K
        (CREST, "crest", None),  # L
        (DFTD4, "dftd4", None),  # M: runtime identity via package / bin digest
        (PYSCF, "pyscf", None),  # G, I: python + library versions
        ({k: v for k, v in PSI4.items() if k not in ("executable_sha256", "package_sha256")}, "psi4", "NO_BUILD_IDENTITY"),  # E
        ({**PSI4, "executable_sha256": "not-a-digest", "package_sha256": 7}, "psi4", "NO_BUILD_IDENTITY"),  # H
        ({"architecture": "arm64"}, "psi4", "NO_BUILD_IDENTITY"),  # B
        ({"architecture": "arm64"}, "pyscf", "NO_SOFTWARE_VERSIONS"),  # B
        ({"platform": "macOS-15.1-arm64-arm-64bit"}, "xtb", "NO_BUILD_IDENTITY"),  # C
        (HARDWARE, "pyscf", "NO_SOFTWARE_VERSIONS"),  # B+C+threads
        ({**PYSCF, "libraries": {}}, "pyscf", "NO_SOFTWARE_VERSIONS"),  # python only
        ({**PYSCF, "python": "banana", "libraries": {"numpy": "x.y"}}, "pyscf", "NO_SOFTWARE_VERSIONS"),  # H
        ({"libraries": {"numpy": "2.5.3"}}, "pyscf", "NO_SOFTWARE_VERSIONS"),  # no runtime version
        ({"engine": "xtb"}, "xtb", "NO_BUILD_IDENTITY"),  # engine name alone
        ({**PYSCF, "build": {"executable_sha256": H1}}, "xtb", None),
        ({"libraries": {"numpy": "2.5.3"}, "python": "3.12.1"}, "unknown-engine", None),
        (HARDWARE, "unknown-engine", "NO_SOFTWARE_VERSIONS"),
    ],
)
def test_sufficiency_rule(raw, engine, expected):
    assert _verdict(raw, engine) == expected


def test_projection_exports_only_digests_and_versions_for_native_builds():
    env = policy.project_environment({**PSI4, "prefix": SENTINELS["env"], "package_build": SENTINELS["env"]}, policy.Omissions(), "environment")
    assert env["native_build"] == {"executable_sha256": H1, "package_sha256": H2}
    assert env["libraries"] == {"python": "3.12.15", "qcelemental": "0.51.2", "qcengine": "0.51.0"}
    assert SENTINELS["env"] not in json.dumps(env)
    assert policy.environment_sufficiency(None, "psi4") == "NO_BUILD_IDENTITY"  # D: missing


def _set_environment(sessions, calc, environment, engine=None):
    with sessions() as session:
        execution = session.scalar(select(ComputeExecutionRecord).where(ComputeExecutionRecord.calculation_id == calc))
        session.execute(update(ComputeExecutionRecord).where(ComputeExecutionRecord.id == execution.id).values(environment_json=environment))
        if engine:
            record = session.scalar(select(CalculationResultRecord).where(CalculationResultRecord.calculation_id == calc))
            session.execute(update(CalculationResultRecord).where(CalculationResultRecord.id == record.id).values(
                producer_software_json={**record.producer_software_json, "name": engine}))
        session.commit()


def test_real_xtb_run_stays_a_reproducibility_package_and_hardware_only_downgrades_it(api):
    client, sessions, _s = api
    project, _v, calc, result = real_xtb_run(api)
    files = open_archive(export_bundle(client, project, calc))
    manifest = json_member(files, "MANIFEST.json")
    assert manifest["classification"] == "REPRODUCIBILITY_PACKAGE", manifest["missing"]  # N, K
    assert "native_build" in json_member(files, "environment/execution-1.json")["recorded_environment"]
    baseline = json_member(files, "results/result.json")
    with sessions() as session:
        stored = session.get(CalculationResultRecord, result)
        stored_payload = stored.payload_json

    for environment in (HARDWARE, {"architecture": "arm64"}, {"platform": "macOS-15.1-arm64-arm-64bit"}, None, {"engine": "xtb"}):
        _set_environment(sessions, calc, environment)
        files = open_archive(export_bundle(client, project, calc))
        manifest = json_member(files, "MANIFEST.json")
        assert manifest["classification"] == "PROVENANCE_ARCHIVE"  # B, C, D, E
        # an engine name alone projects to nothing: the platform treats it as not recorded
        expected = "NOT_RECORDED" if environment in (None, {"engine": "xtb"}) else "NO_BUILD_IDENTITY"
        assert manifest["required_evidence"]["ENVIRONMENT"] == expected
        assert {"category": "ENVIRONMENT", "reason_code": expected} in manifest["missing"]  # O
        assert expected in manifest["reason_code_meanings"]
        # scientific evidence, standing and lineage are preserved (Q, R)
        result_doc = json_member(files, "results/result.json")
        assert list(numeric_leaves(result_doc["payload"])) == list(numeric_leaves(baseline["payload"]))
        assert result_doc["stored_payload_sha256"] == baseline["stored_payload_sha256"]
        assert result_doc["scientific_state_at_generation"]["independent_verification_state"] == "UNVERIFIED"
        assert "results/lineage.json" in files and "inputs/structure-version.json" in files
        assert manifest["exact_reproducibility_claimed"] is False and manifest["executable_workflow"]["provided"] is False
        # P: checksums still describe the members
        for line in files["SHA256SUMS"].decode().splitlines():
            digest, name = line.split("  ", 1)
            assert hashlib.sha256(files[name]).hexdigest() == digest
    assert stored_payload is not None


@pytest.mark.parametrize(("engine", "environment", "expected"), [
    ("psi4", PSI4, "REPRODUCIBILITY_PACKAGE"), ("psi4", {"architecture": "arm64"}, "PROVENANCE_ARCHIVE"),
    ("crest", CREST, "REPRODUCIBILITY_PACKAGE"), ("dftd4", DFTD4, "REPRODUCIBILITY_PACKAGE"),
    ("pyscf", PYSCF, "REPRODUCIBILITY_PACKAGE"), ("pyscf", HARDWARE, "PROVENANCE_ARCHIVE"),
])
def test_engine_specific_classification_in_an_archive(api, engine, environment, expected):
    client, sessions, _s = api
    project, _v, calc, _r = real_xtb_run(api)
    _set_environment(sessions, calc, environment, engine)
    manifest = json_member(open_archive(export_bundle(client, project, calc)), "MANIFEST.json")
    envs = {m["category"]: m["reason_code"] for m in manifest["missing"]}
    if expected == "REPRODUCIBILITY_PACKAGE":
        assert "ENVIRONMENT" not in envs
    else:
        assert "ENVIRONMENT" in envs
    # the xTB-built specification is engine-specific, so only the ENVIRONMENT verdict is asserted here


def test_catalog_agrees_with_the_archive_and_security_still_holds(api):
    client, sessions, _s = api
    project, _v, calc, _r = real_xtb_run(api)
    _set_environment(sessions, calc, {**HARDWARE, "cwd": SENTINELS["env"], "argv": [SENTINELS["recognized"]], SENTINELS["env_key"]: SENTINELS["env"]})
    catalog = client.get(f"/v1/projects/{project}/calculations/{calc}/exports").json()
    variant = next(f for f in catalog["formats"] if f["format"] == "reproducibility-bundle")["variants"][0]
    files = open_archive(export_bundle(client, project, calc))
    assert variant["key"] == json_member(files, "MANIFEST.json")["classification"] == "PROVENANCE_ARCHIVE"
    assert "ENVIRONMENT" in variant["detail"]
    blob = whole_archive(files)
    for key in ("env", "recognized", "env_key"):
        assert SENTINELS[key].encode() not in blob
    with zipfile.ZipFile(io.BytesIO(client.get(f"/v1/projects/{project}/calculations/{calc}/export", params={"format": "reproducibility-bundle"}).content)) as z:
        assert z.testzip() is None
