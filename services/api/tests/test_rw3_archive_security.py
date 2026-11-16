# ruff: noqa: E501  (synthetic sentinels and assertions)
"""RW-3 security repair: the portable archive is default-deny. Synthetic credentials only.

Every test inspects the COMPLETED ZIP (all member names and bodies), not just the artifacts a scanner
would have rejected. Each input path carries its own distinct sentinel (`SENTINELS`).
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import zipfile
from uuid import uuid4

import pytest
from chemdft_api import reproducibility_bundle as bundle
from chemdft_api.errors import ExportBlocked, ExportLimitExceeded
from chemdft_api.scientific_models import (
    CalculationInputRecord,
    CalculationResultRecord,
    ComputeExecutionRecord,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
)
from chemdft_api.storage import LocalObjectStore
from rw2_support import EVIDENCE, create_project, import_structure, seed_result
from rw3_archive_support import (
    SENTINELS,
    assert_absent,
    attach_raw,
    export_bundle,
    extract_all,
    json_member,
    numeric_leaves,
    open_archive,
    real_xtb_run,
    sha256,
    store_artifact,
    whole_archive,
)
from sqlalchemy import delete, select, update

FIXED_MEMBERS = re.compile(
    r"^(README\.txt|MANIFEST\.json|SHA256SUMS|calculation/specification\.json|inputs/structure-version\.json|"
    r"inputs/structure\.xyz|inputs/calculation-input-summary\.json|results/result\.json|results/lineage\.json|"
    r"environment/execution-[1-6]\.json)$"
)


def _all_names_fixed(files):
    assert files and all(FIXED_MEMBERS.fullmatch(n) for n in files), sorted(files)


@pytest.fixture
def lab(api):
    client, sessions, settings = api
    project = create_project(client, "RW-3 archive")
    version = import_structure(client, project)
    return client, sessions, settings, project, version


# ------------------------------------------------------------- vulnerability A: artifact bytes


def test_vulnerability_a_unreviewed_artifact_bytes_never_enter_the_archive(api):
    client, sessions, settings = api
    project, _v, calc, result = real_xtb_run(api)
    log = store_artifact(sessions, settings, project, f"engine said {SENTINELS['log']} and finished\n".encode())
    binary = store_artifact(sessions, settings, project, b"\x00\x01BIN" + SENTINELS["binary"].encode() + b"\xff", kind="NATIVE_ARTIFACT", media_type="application/octet-stream", format_identifier="native.bin")
    recognized = store_artifact(sessions, settings, project, f"OPENAI_API_KEY={SENTINELS['recognized']}\n".encode())
    weird = store_artifact(sessions, settings, project, b"harmless text", kind=SENTINELS["kind"], format_identifier=SENTINELS["format_id"])
    named = store_artifact(sessions, settings, project, b"harmless text two", format_identifier=SENTINELS["artifact_name"])
    attach_raw(sessions, result, [log, binary, recognized, weird, named])
    response = export_bundle(client, project, calc)
    files = open_archive(response)
    _all_names_fixed(files)
    assert_absent(files, "log", "binary", "recognized", "kind", "format_id", "artifact_name")
    manifest = json_member(files, "MANIFEST.json")
    withheld = {w["artifact_id"]: w for w in manifest["withheld_artifacts"]}
    for artifact in (log, binary, recognized, weird, named):
        assert withheld[artifact]["disposition"] == "WITHHELD_BY_POLICY" and "sha256" not in withheld[artifact]
    assert withheld[weird]["kind"] == "UNKNOWN"  # an unreviewed kind is never echoed
    assert set(withheld[log]) == {"artifact_id", "kind", "size_bytes", "disposition"}
    # withheld raw outputs are not inputs: they do not change the class, and the manifest says so
    assert manifest["classification"] == "REPRODUCIBILITY_PACKAGE", manifest["missing"]
    assert any("withheld by policy" in text for text in manifest["limitations"])
    readme = files["README.txt"].decode()
    assert "does NOT contain raw engine outputs" in readme
    assert "cannot contain" not in readme.lower() and "never exported" not in readme.lower()


def test_no_artifact_bytes_are_ever_copied_even_for_clean_looking_files(api):
    client, sessions, settings = api
    project, _v, calc, result = real_xtb_run(api)
    clean = store_artifact(sessions, settings, project, b"total energy -1.2345 Eh\n" * 40)
    attach_raw(sessions, result, [clean])
    files = open_archive(export_bundle(client, project, calc))
    assert b"total energy -1.2345 Eh" not in whole_archive(files)  # a scanner verdict of CLEAN is not enough
    assert not any(n.startswith("artifacts/") for n in files)


# ---------------------------------------------------------- vulnerability B: structured metadata


def test_vulnerability_b_producer_and_nested_result_metadata_are_not_exported(lab):
    client, sessions, _s, project, version = lab
    producer = {
        "hardware_class": SENTINELS["producer"], "execution_backend": SENTINELS["recognized"],
        "capabilities": [SENTINELS["producer"]], "environment_digest": "f" * 64,
        "library_versions": [{"namespace": "a.b", "schema_version": "1", "values": [{"key": "k", "value": SENTINELS["producer"]}]}],
        SENTINELS["unknown_key"]: SENTINELS["producer"],
    }
    payload = {
        "notes": {"deep": {"text": SENTINELS["result_meta"]}},
        SENTINELS["result_key"]: SENTINELS["result_meta"],
        "producer": SENTINELS["result_meta"],
        "diagnostics": [SENTINELS["result_meta"]],
    }
    calc, _r = seed_result(sessions, project, version, "energy", producer=producer, payload=payload)
    files = open_archive(export_bundle(client, project, calc))
    _all_names_fixed(files)
    assert_absent(files, "producer", "recognized", "result_meta", "result_key", "unknown_key")
    result = json_member(files, "results/result.json")
    assert result["engine"] == {"adapter_version": "1.0.0", "name": "pyscf", "version": "2.14.0"}
    assert result["payload"]["total_energy"]["value"] == EVIDENCE["energy"]["payload"]["total_energy"]["value"]
    manifest = json_member(files, "MANIFEST.json")
    assert any(o["category"] == "UNAPPROVED_FIELD" and o["path"] == "payload" for o in manifest["omitted_content"])
    assert manifest["classification"] == "PROVENANCE_ARCHIVE"  # unreviewed result fields were dropped
    assert {m["category"]: m["reason_code"] for m in manifest["missing"]}["RESULT"] == "NOT_REVIEWED_FOR_EXPORT"
    # omission records name only trusted paths, never stored keys
    assert SENTINELS["result_key"] not in json.dumps(manifest)


def test_recorded_environment_is_an_allowlist_not_a_dump(api):
    client, sessions, _settings = api
    project, _v, calc, _r = real_xtb_run(api)
    with sessions() as session:
        execution = session.scalar(select(ComputeExecutionRecord).where(ComputeExecutionRecord.calculation_id == calc))
        env = dict(execution.environment_json)
        env.update({
            SENTINELS["env_key"]: SENTINELS["env"], "argv": ["/Users/" "someone/xtb", SENTINELS["env"]],
            "cwd": "/Users/" "someone/work", "AWS_SECRET_ACCESS_KEY": SENTINELS["recognized"],
        })
        env["libraries"] = {**env.get("libraries", {}), SENTINELS["env_key"]: SENTINELS["env"], "numpy": SENTINELS["env"]}
        env["thread_settings"] = {"OMP_NUM_THREADS": "1", "TOKEN": SENTINELS["env"]}
        env["platform"] = SENTINELS["env"]
        session.execute(update(ComputeExecutionRecord).where(ComputeExecutionRecord.id == execution.id).values(environment_json=env))
        session.commit()
    files = open_archive(export_bundle(client, project, calc))
    assert_absent(files, "env", "env_key", "recognized")
    assert b"/Users/" b"someone" not in whole_archive(files)
    recorded = json_member(files, "environment/execution-1.json")["recorded_environment"]
    assert recorded["thread_settings"] == {"OMP_NUM_THREADS": "1"}
    assert "platform" not in recorded and "numpy" not in recorded.get("libraries", {})
    assert re.fullmatch(r"\d+\.\d+\.\d+", recorded["python"])


def test_labels_comments_and_names_are_never_exported(api):
    client, sessions, _settings = api
    xyz = f"1\n{SENTINELS['struct_comment']}\nHe 0 0 0\n".encode()
    project, _version, calc, _r = real_xtb_run(api, xyz=xyz, name=SENTINELS["structure_name"])
    files = open_archive(export_bundle(client, project, calc))
    _all_names_fixed(files)
    assert_absent(files, "struct_comment", "structure_name")
    other = client.post("/v1/projects", json={"name": SENTINELS["project_name"], "slug": f"pn-{uuid4().hex[:8]}"}).json()["id"]
    v2 = import_structure(client, other)
    seeded, _ = seed_result(sessions, other, v2, "energy")
    assert_absent(open_archive(export_bundle(client, other, seeded)), "project_name")
    structure = json_member(files, "inputs/structure-version.json")
    assert structure["atoms"] == [{"element": "He", "x": 0.0, "y": 0.0, "z": 0.0}]
    assert "name" not in structure and structure["original_bytes_included"] is False
    xyz_member = files["inputs/structure.xyz"].decode().splitlines()
    assert xyz_member[0] == "1" and xyz_member[1].startswith("ChemDFT structure version ") and xyz_member[2].startswith("He ")


def test_comments_inside_a_hash_valid_engine_input_are_not_exported_and_degrade_the_class(api):
    client, sessions, settings = api
    project, _v, calc, _r = real_xtb_run(api)
    row_before = None
    with sessions() as session:
        row_before = session.scalar(select(CalculationInputRecord).where(CalculationInputRecord.calculation_id == calc))
        original = ScientificArtifactRecord  # noqa: F841
        artifact = session.get(ScientificArtifactRecord, row_before.normalized_input_artifact_id)
        document = json.loads(LocalObjectStore(settings.object_root).get_bytes(artifact.storage_key, 10**7))
    document["comment"] = SENTINELS["input_comment"]
    document[SENTINELS["unknown_key"]] = SENTINELS["input_comment"]
    document["atoms"][0]["label"] = SENTINELS["input_comment"]
    replaced = store_artifact(sessions, settings, project, json.dumps(document).encode(), kind="CALCULATION_INPUT", media_type="application/json", format_identifier="chemdft.calculation_input")
    with sessions() as session:
        session.execute(update(CalculationInputRecord).where(CalculationInputRecord.id == row_before.id).values(normalized_input_artifact_id=replaced))
        session.commit()
    files = open_archive(export_bundle(client, project, calc))
    assert_absent(files, "input_comment", "unknown_key")
    manifest = json_member(files, "MANIFEST.json")
    assert manifest["required_evidence"]["ENGINE_INPUT"] == "NOT_REVIEWED_FOR_EXPORT"
    assert manifest["classification"] == "PROVENANCE_ARCHIVE"
    assert "inputs/calculation-input-summary.json" not in files


def test_specification_extensions_and_unknown_keys_are_not_exported(lab):
    client, sessions, _s, project, version = lab
    spec = {
        "engine_extensions": [{"namespace": "a.b", "schema_version": "1", "values": [{"key": "k", "value": SENTINELS["spec_extension"]}]}],
        "property_requests": [SENTINELS["spec_extension"].lower().replace("_", "-") + ".x"],
        SENTINELS["unknown_key"]: SENTINELS["spec_extension"],
    }
    calc, _r = seed_result(sessions, project, version, "energy", spec=spec)
    files = open_archive(export_bundle(client, project, calc))
    assert_absent(files, "spec_extension", "unknown_key")
    assert b"sentinel-specext" not in whole_archive(files).lower()
    manifest = json_member(files, "MANIFEST.json")
    assert manifest["required_evidence"]["SPECIFICATION"] == "NOT_REVIEWED_FOR_EXPORT"


def test_provenance_parameters_producer_and_operation_text_are_not_exported(lab):
    client, sessions, _s, project, version = lab
    calc, result = seed_result(sessions, project, version, "energy")
    with sessions() as session:
        record = session.get(CalculationResultRecord, result)
        session.execute(
            update(ProvenanceRecordRow).where(ProvenanceRecordRow.id == record.provenance_record_id).values(
                parameters_json=[{"name": "x", "value": SENTINELS["provenance_param"]}],
                producer_identifier=SENTINELS["producer"], operation=SENTINELS["log"], subject_type=SENTINELS["result_meta"],
            )
        )
        session.commit()
    files = open_archive(export_bundle(client, project, calc))
    assert_absent(files, "provenance_param", "producer", "log", "result_meta")
    lineage = json_member(files, "results/lineage.json")
    assert lineage["free_form_parameters_exported"] is False
    assert lineage["records"][0]["producer"] is None and lineage["records"][0]["operation"] is None


# -------------------------------------------------------------- malformed and oversized inputs


@pytest.mark.parametrize("field,value", [
    ("payload_json", ["not", "a", "mapping", SENTINELS["result_meta"]]),
    ("payload_json", "just a string " + SENTINELS["result_meta"]),
    ("producer_software_json", [SENTINELS["producer"]]),
    ("producer_software_json", {"name": SENTINELS["producer"], "version": SENTINELS["producer"]}),
    ("raw_artifacts_json", [{"artifact_id": SENTINELS["log"]}, "x", 5, None]),
])
def test_deliberately_malformed_metadata_fails_closed_without_leaking(lab, field, value):
    client, sessions, _s, project, version = lab
    calc, result = seed_result(sessions, project, version, "energy")
    with sessions() as session:
        session.execute(update(CalculationResultRecord).where(CalculationResultRecord.id == result).values(**{field: value}))
        session.commit()
    response = export_bundle(client, project, calc)
    assert response.status_code == 200, response.text
    files = open_archive(response)
    _all_names_fixed(files)
    assert_absent(files, "result_meta", "producer", "log")
    manifest = json_member(files, "MANIFEST.json")
    assert manifest["classification"] == "PROVENANCE_ARCHIVE"


def test_non_finite_numbers_are_never_serialized_and_degrade_the_class(lab):
    client, sessions, _s, project, version = lab
    calc, result = seed_result(sessions, project, version, "energy")
    with sessions() as session:
        record = session.get(CalculationResultRecord, result)
        payload = {**record.payload_json, "scf_iterations": float("nan")}
        session.execute(update(CalculationResultRecord).where(CalculationResultRecord.id == result).values(payload_json=payload))
        session.commit()
    files = open_archive(export_bundle(client, project, calc))
    assert b"NaN" not in whole_archive(files) and b"Infinity" not in whole_archive(files)
    manifest = json_member(files, "MANIFEST.json")
    assert any(o["category"] == "NON_FINITE" for o in manifest["omitted_content"])
    assert {m["category"]: m["reason_code"] for m in manifest["missing"]}["RESULT"] == "NOT_REVIEWED_FOR_EXPORT"


def test_oversized_and_deeply_nested_stored_records_are_refused_not_partially_exported(lab):
    client, sessions, _s, project, version = lab
    calc, result = seed_result(sessions, project, version, "energy")

    def tamper(payload):
        with sessions() as session:
            session.execute(update(CalculationResultRecord).where(CalculationResultRecord.id == result).values(payload_json=payload))
            session.commit()

    tamper({SENTINELS["unknown_key"]: [[1.0]] * 3})  # an unapproved key is dropped quietly
    assert export_bundle(client, project, calc).status_code == 200
    nested: dict = {"value": 1.0}
    for _ in range(40):
        nested = {"value": nested}
    tamper(nested)
    deep = export_bundle(client, project, calc)
    assert deep.status_code == 413 and SENTINELS["log"] not in deep.text
    tamper({"modes": [[0.5] * 19_999 for _ in range(30)]})  # > MAX_NODES approved-key nodes
    assert export_bundle(client, project, calc).status_code == 413
    tamper({"modes": [0.5] * 20_001})  # one list over MAX_LIST: omitted, flagged, not truncated silently
    files = open_archive(export_bundle(client, project, calc))
    manifest = json_member(files, "MANIFEST.json")
    assert any(o["category"] == "OVERSIZED" for o in manifest["omitted_content"])
    assert manifest["classification"] == "PROVENANCE_ARCHIVE"


def test_whole_archive_limits_are_enforced_before_any_zip_is_built():
    archive = bundle.Archive()
    with pytest.raises(ExportLimitExceeded):
        archive.add("results/result.json", b"x" * (bundle.MAX_MEMBER_BYTES + 1), "big")
    archive = bundle.Archive()
    for i in range(1, bundle.MAX_MEMBERS + 1):  # only fixed names exist; fill the count with them
        archive.members[f"environment/execution-{i}.json"] = (b"{}", "env")
    with pytest.raises(ExportLimitExceeded):
        archive.add("README.txt", b"x", "late")
    archive = bundle.Archive()
    chunk = b"y" * (bundle.MAX_MEMBER_BYTES - 1)
    names = ["README.txt", "results/result.json", "results/lineage.json", "calculation/specification.json"]
    with pytest.raises(ExportLimitExceeded):
        for name in names:  # 4 x ~8 MiB exceeds the 24 MiB total
            archive.add(name, chunk, "chunk")
    for bad in ("../x.txt", "/abs.txt", "a/../b.txt", "x\\y.txt", "inputs/" + SENTINELS["format_id"] + ".bin", "a/b/c.txt", "n\nl.txt"):
        with pytest.raises(ExportBlocked):
            bundle.Archive().add(bad, b"", "x")
    duplicate = bundle.Archive()
    duplicate.add("README.txt", b"a", "r")
    with pytest.raises(ExportBlocked):
        duplicate.add("README.txt", b"b", "r")


def test_final_zip_size_limit_returns_413_and_no_content(api, monkeypatch):
    client, _sessions, _settings = api
    project, _v, calc, _r = real_xtb_run(api)
    monkeypatch.setattr(bundle, "MAX_ZIP_BYTES", 200)
    response = export_bundle(client, project, calc)
    assert response.status_code == 413 and response.headers["content-type"].startswith("application/json")


def test_final_output_tripwire_blocks_instead_of_exporting(api, monkeypatch):
    client, _sessions, _settings = api
    project, _v, calc, _r = real_xtb_run(api)
    original = bundle._lineage

    def poisoned(out, *args, **kwargs):
        original(out, *args, **kwargs)
        out.archive.add("results/lineage.json".replace("lineage", "extra"), f"token={SENTINELS['recognized']}".encode(), "x")

    monkeypatch.setattr(bundle, "_lineage", poisoned)
    response = export_bundle(client, project, calc)
    assert response.status_code == 422 and SENTINELS["recognized"] not in response.text


# ------------------------------------------------------- integrity, classification, authorization


def test_zip_extracts_safely_checksums_verify_and_manifest_is_consistent(api, tmp_path):
    client, _s, _t = api
    project, _v, calc, _r = real_xtb_run(api)
    response = export_bundle(client, project, calc)
    files = open_archive(response)
    _all_names_fixed(files)
    paths = extract_all(files, tmp_path / "x")
    assert len(paths) == len(files)
    sums = dict(line.split("  ", 1)[::-1] for line in files["SHA256SUMS"].decode().splitlines())
    assert set(sums) == set(files) - {"SHA256SUMS"}
    for name, digest in sums.items():
        assert sha256(files[name]) == digest
    manifest = json_member(files, "MANIFEST.json")
    assert {f["path"] for f in manifest["files"]} == set(files) - {"MANIFEST.json", "SHA256SUMS"}
    for entry in manifest["files"]:
        assert sha256(files[entry["path"]]) == entry["sha256"] and len(files[entry["path"]]) == entry["size_bytes"]
        assert entry["role"] and not any(c in entry["role"] for c in "\n\r")
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert all(info.date_time == (2020, 1, 1, 0, 0, 0) and not info.filename.endswith("/") for info in archive.infolist())
    for name, data in files.items():
        if name.endswith(".json"):
            json.loads(data, parse_constant=lambda c: pytest.fail(f"non-finite constant {c}"))


def test_classification_is_truthful_when_evidence_is_missing_or_unverifiable(api):
    client, sessions, settings = api
    project, _v, calc, result = real_xtb_run(api)
    manifest = json_member(open_archive(export_bundle(client, project, calc)), "MANIFEST.json")
    assert manifest["classification"] == "REPRODUCIBILITY_PACKAGE" and manifest["missing"] == []
    assert manifest["exact_reproducibility_claimed"] is False and manifest["executable_workflow"]["provided"] is False
    catalog = client.get(f"/v1/projects/{project}/calculations/{calc}/exports").json()
    variant = next(f for f in catalog["formats"] if f["format"] == "reproducibility-bundle")["variants"][0]
    assert variant["key"] == "REPRODUCIBILITY_PACKAGE"
    # 1. stored engine input bytes no longer match their recorded hash
    with sessions() as session:
        row = session.scalar(select(CalculationInputRecord).where(CalculationInputRecord.calculation_id == calc))
        artifact = session.get(ScientificArtifactRecord, row.normalized_input_artifact_id)
        path = LocalObjectStore(settings.object_root).root / artifact.storage_key
    original_bytes = path.read_bytes()
    path.write_bytes(original_bytes + b" ")
    m1 = json_member(open_archive(export_bundle(client, project, calc)), "MANIFEST.json")
    assert m1["classification"] == "PROVENANCE_ARCHIVE" and m1["required_evidence"]["ENGINE_INPUT"] == "HASH_MISMATCH"
    path.write_bytes(original_bytes)
    # 2. no recorded environment
    with sessions() as session:
        session.execute(update(ComputeExecutionRecord).where(ComputeExecutionRecord.calculation_id == calc).values(environment_json=None))
        session.commit()
    files = open_archive(export_bundle(client, project, calc))
    m2 = json_member(files, "MANIFEST.json")
    assert m2["classification"] == "PROVENANCE_ARCHIVE" and m2["required_evidence"]["ENVIRONMENT"] == "NOT_RECORDED"
    assert not any(n.startswith("environment/") for n in files)
    assert b"PROVENANCE_ARCHIVE" in files["README.txt"] and b"REPRODUCIBILITY_PACKAGE\n" not in files["README.txt"].split(b"Classification:")[1].split(b"\n\n")[0] + b"\n"
    # 3. no result at all
    with sessions() as session:
        session.execute(delete(CalculationResultRecord).where(CalculationResultRecord.id == result))
        session.commit()
    m3 = json_member(open_archive(export_bundle(client, project, calc)), "MANIFEST.json")
    assert m3["classification"] == "PROVENANCE_ARCHIVE" and m3["required_evidence"]["RESULT"] == "RECORD_MISSING"
    assert m3["scientific_standing_at_generation"]["evidence_use"] == "NO_RESULT"
    assert set(m3["reason_code_meanings"]) <= set(bundle.REASONS)


def test_archive_authorization_and_project_isolation(lab):
    client, sessions, _s, project, version = lab
    calc, _r = seed_result(sessions, project, version, "energy")
    other = create_project(client, "other")
    assert export_bundle(client, other, calc).status_code == 404
    assert export_bundle(client, project, str(uuid4())).status_code == 404
    assert export_bundle(client, str(uuid4()), calc).status_code == 404
    response = export_bundle(client, other, calc)
    assert calc not in response.text


# ----------------------------------------------------------------------- scientific fidelity


@pytest.mark.parametrize("key", ["energy", "opt", "vib_ir", "vib_raman", "tddft", "thermo", "mo"])
def test_accepted_native_evidence_keeps_every_number_unit_and_identity_exactly(lab, key):
    client, sessions, _s, project, version = lab
    calc, result = seed_result(sessions, project, version, key)
    files = open_archive(export_bundle(client, project, calc))
    exported = json_member(files, "results/result.json")
    source = EVIDENCE[key]
    # every stored number/bool survives at the same path with the same value (free text is not exported)
    assert list(numeric_leaves(exported["payload"])) == list(numeric_leaves(source["payload"]))
    assert exported["result_type"] == source["result_type"]
    manifest = json_member(files, "MANIFEST.json")
    spec = json_member(files, "calculation/specification.json")["specification"]
    stored = source["specification"]
    assert (spec["task_type"], spec["method"]["identifier"], spec["charge"], spec["multiplicity"]) == (
        stored["task_type"], stored["method"]["identifier"], stored["charge"], stored["multiplicity"])
    assert spec["engine_preference"]["engine"] == stored["engine_preference"]["engine"]
    if stored.get("basis"):
        assert spec["basis"]["identifier"] == stored["basis"]["identifier"]
    assert {m["category"]: m["reason_code"] for m in manifest["missing"]}.get("SPECIFICATION") is None
    assert {m["category"]: m["reason_code"] for m in manifest["missing"]}.get("RESULT") is None, manifest["omitted_content"]
    # units stay attached to their values
    for leaf in [e for e in manifest["omitted_content"] if e["category"] == "UNREVIEWED_IDENTIFIER"]:
        pytest.fail(f"a unit or identifier was withheld from accepted evidence: {leaf}")
    state = exported["scientific_state_at_generation"]
    assert state["evidence_use"] == "CURRENT" and state["independent_verification_state"] == "UNVERIFIED"
    assert state["effective_authority"] == "AUTHORITATIVE" and "Not independently verified" in state["independent_verification_statement"]
    with sessions() as session:
        stored_row = session.get(CalculationResultRecord, result)
        assert exported["stored_payload_sha256"] == hashlib.sha256(json.dumps(stored_row.payload_json, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def test_structure_charge_multiplicity_hashes_and_lineage_are_the_stored_ones(api):
    client, sessions, _settings = api
    water = b"3\nwater\nO 0.0 0.0 0.0\nH 0.0 0.0 0.9572\nH 0.926627 0.0 -0.239987\n"
    project, version, calc, result = real_xtb_run(api, xyz=water, name="water")
    files = open_archive(export_bundle(client, project, calc))
    structure = json_member(files, "inputs/structure-version.json")
    from chemdft_api.scientific_models import StructureVersionRecord

    with sessions() as session:
        record = session.get(StructureVersionRecord, version)
        stored_atoms = [(a["element"], a["x"], a["y"], a["z"]) for a in record.representation_json["coordinates"]["atoms"]]
        canonical = session.get(ScientificArtifactRecord, record.canonical_artifact_id)
        calc_input = session.scalar(select(CalculationInputRecord).where(CalculationInputRecord.calculation_id == calc))
        input_artifact = session.get(ScientificArtifactRecord, calc_input.normalized_input_artifact_id)
        charge, multiplicity = record.overall_charge, record.multiplicity
        provenance_id = session.get(CalculationResultRecord, result).provenance_record_id
    assert [(a["element"], a["x"], a["y"], a["z"]) for a in structure["atoms"]] == stored_atoms
    assert (structure["overall_charge"], structure["multiplicity"]) == (charge, multiplicity)
    assert structure["original_artifact_sha256"] == canonical.sha256 and structure["original_artifact_verified_in_process"] is True
    xyz = [line.split() for line in files["inputs/structure.xyz"].decode().splitlines()[2:]]
    assert [(e, float(x), float(y), float(z)) for e, x, y, z in xyz] == stored_atoms  # repr() round-trips exactly
    summary = json_member(files, "inputs/calculation-input-summary.json")
    assert summary["original_artifact_sha256"] == input_artifact.sha256 and summary["verified_against_recorded_sha256"] is True
    assert summary["document"]["charge"] == charge and summary["document"]["multiplicity"] == multiplicity
    assert [a["element"] for a in summary["document"]["atoms"]] == ["O", "H", "H"]
    lineage = json_member(files, "results/lineage.json")["records"]
    assert lineage[0]["record_id"] == provenance_id
    result_doc = json_member(files, "results/result.json")
    assert result_doc["engine"]["name"] == "xtb" and re.fullmatch(r"\d+\.\d+\.\d+", result_doc["engine"]["version"])
    energy = next(q for q in result_doc["summary_quantities"] if q["key"] == "total_energy")
    assert energy["unit"] == "Eh" and energy["value"] == result_doc["payload"]["total_energy"]["value"]


def test_historical_evidence_is_labelled_and_verification_is_never_upgraded(lab):
    from rw2_support import supersede

    client, sessions, _s, project, version = lab
    calc, result = seed_result(sessions, project, version, "energy")
    supersede(sessions, result)
    files = open_archive(export_bundle(client, project, calc))
    state = json_member(files, "results/result.json")["scientific_state_at_generation"]
    assert state["evidence_use"] == "HISTORICAL_ONLY" and state["effective_authority"] == "CANDIDATE"
    assert state["independent_verification_state"] == "UNVERIFIED"
    manifest = json_member(files, "MANIFEST.json")
    assert manifest["scientific_standing_at_generation"]["evidence_use"] == "HISTORICAL_ONLY"


def test_a_credential_pattern_scanner_is_not_a_security_boundary():
    """Why the repair is an allowlist: the platform's own scanner misses unrecognized secrets."""
    assert bundle._SECRET_TEXT.search(SENTINELS["recognized"].encode())
    for key in ("log", "binary", "producer", "result_meta", "env", "input_comment", "struct_comment", "format_id"):
        assert not bundle._SECRET_TEXT.search(SENTINELS[key].encode()), key


def test_scientific_report_does_not_embed_raw_producer_or_specification_metadata(lab):
    client, sessions, _s, project, version = lab
    producer = {"hardware_class": SENTINELS["producer"], "execution_backend": SENTINELS["recognized"], SENTINELS["unknown_key"]: SENTINELS["producer"]}
    spec = {"engine_extensions": [{"namespace": "a.b", "schema_version": "1", "values": [{"key": "k", "value": SENTINELS["spec_extension"]}]}], SENTINELS["unknown_key"]: SENTINELS["spec_extension"]}
    _calc, result = seed_result(sessions, project, version, "energy", producer=producer, spec=spec)
    with sessions() as session:
        record = session.get(CalculationResultRecord, result)
        session.execute(update(ProvenanceRecordRow).where(ProvenanceRecordRow.id == record.provenance_record_id).values(operation=SENTINELS["log"], producer_identifier=SENTINELS["producer"]))
        session.commit()
    for fmt in ("json", "html", "markdown"):
        response = client.get(f"/v1/projects/{project}/scientific-report", params=[("format", fmt), ("result_id", result)])
        assert response.status_code == 200, response.text
        for key in ("producer", "recognized", "spec_extension", "unknown_key", "log"):
            assert SENTINELS[key] not in response.text, (fmt, key)
