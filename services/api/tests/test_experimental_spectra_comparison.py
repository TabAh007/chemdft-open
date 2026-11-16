# ruff: noqa: E501
"""Calculated/imported <-> experimental comparison: candidate matching, metrics, scaling, UV/Vis bands, authority."""

from __future__ import annotations

import pytest
from chemdft_api import external_import_actions
from chemdft_api.models import User, new_id
from chemdft_api.scientific_models import (
    CalculationInputRecord,
    CalculationRecord,
    CalculationResultRecord,
    ImportedResultRecord,
    ProvenanceInputRow,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
    SpectrumComparisonRecord,
    StructureRecord,
)
from external_import_support import fake_runner
from spectra_support import (
    import_spectrum,
    ir_text,
    peaks,
    raman_text,
    report_with_excitations,
    requires_spectra_worker,
    transform,
    uv_text,
)
from sqlalchemy import func, select

pytestmark = requires_spectra_worker
WATER_PEAKS = (
    (1595.0, 18.0, 0.9),
    (3705.0, 30.0, 0.5),
    (3790.0, 30.0, 0.4),
)  # near the synthetic imported modes 1600 / 3700 / 3800


@pytest.fixture
def project(api):
    client, _, _ = api
    response = client.post(
        "/v1/projects", json={"name": "Spectra comparison", "slug": "spectra-comparison"}
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


@pytest.fixture
def imported(api, project, monkeypatch):
    """One confirmed External Import (synthetic, plumbing only) giving imported vibrations (with IR and Raman) and excitations."""
    client, _, _ = api
    monkeypatch.setattr(
        external_import_actions,
        "run_import_worker",
        fake_runner(lambda data: report_with_excitations(data, raman=True)),
    )
    response = client.post(
        f"/v1/projects/{project}/external-imports",
        files={
            "upload": ("water.log", b"synthetic external output placeholder\n" * 20, "text/plain")
        },
        data={"idempotency_key": "import-key-0001"},
    )
    assert response.status_code == 201, response.text
    view = response.json()
    confirmed = client.post(
        f"/v1/projects/{project}/external-imports/{view['id']}/confirm",
        json={"preview_sha256": view["preview_sha256"], "idempotency_key": "import-confirm-01"},
    )
    assert confirmed.status_code == 200, confirmed.text
    return {r["result_type"]: r["id"] for r in confirmed.json()["results"]}


def ir_peaks(client, project, **kwargs):
    raw = import_spectrum(
        client,
        project,
        ir_text(peaks=kwargs.pop("shape", WATER_PEAKS), noise=0.002),
        key=kwargs.pop("key", "ir-water-0001"),
        association=kwargs.pop("association", None),
        choices=kwargs.pop("choices", None),
    )
    corrected = transform(client, project, raw["id"], "baseline.snip", {"half_window_x": 80}).json()
    found = peaks(client, project, corrected["id"], {"prominence_sigma": 8}).json()
    return raw, corrected, found


def compare(
    client,
    project,
    experimental,
    peak_set,
    source_id,
    kind="IMPORTED_RESULT",
    key="compare-key-0001",
    **extra,
):
    body = {
        "experimental_dataset_id": experimental["id"],
        "peak_set_dataset_id": peak_set["id"],
        "calculated": {"kind": kind, "id": source_id},
        "tolerance": 30.0,
        "idempotency_key": key,
        **extra,
    }
    return client.post(f"/v1/projects/{project}/experimental/spectra/comparisons", json=body)


def seed_chemdft_vibrations(sessions, project_id: str, with_raman: bool = False) -> str:
    """A validated `chemdft.vibrational-analysis` row with the payload keys the comparison reads (FK targets are not needed for plumbing)."""
    from chemdft_api.contracts.results import VibrationalMode

    def quantity(value: float, unit: str) -> dict:
        return {
            "value": value,
            "unit": {"standard": "UCUM", "code": unit, "dimension": "OTHER_DECLARED"},
            "source_unit": None,
            "uncertainty": None,
            "precision": None,
            "approximation": "EXACT_AS_REPORTED",
        }

    modes = []
    for i, f in enumerate((1600.0, 3700.0, 3800.0)):
        mode = VibrationalMode.model_validate(
            {
                "index": i,
                "frequency_cm1": f,
                "imaginary": False,
                "displacement_vectors": [[0.0, 0.0, 0.1], [0.0, 0.5, -0.2], [0.0, -0.5, -0.2]],
                "ir_intensity": quantity(50.0 + i, "km/mol"),
                "raman_activity": quantity(2.0 + i, "angstrom^4/amu") if with_raman else None,
            }
        )
        modes.append(mode.model_dump(mode="json"))
    payload = {
        "payload_schema": "chemdft.vibrational-analysis",
        "input_structure_version_id": new_id(),
        "method": "B3LYP",
        "basis": "6-31G(d)",
        "engine": "pyscf",
        "modes": modes,
    }
    return _seed_result(sessions, project_id, "chemdft.vibrational-analysis", payload)


def _seed_result(sessions, project_id: str, result_type: str, payload: dict) -> str:
    result_id = new_id()
    with sessions() as session:
        # The isolated test identity is deliberately not the legacy default user id.
        user = session.scalars(select(User.id).order_by(User.created_at)).first()
        calculation = CalculationRecord(project_id=project_id, state="SUCCEEDED", created_by=user)
        artifact = ScientificArtifactRecord(
            project_id=project_id,
            kind="CALCULATION_INPUT",
            media_type="application/json",
            format_identifier="test.input",
            format_version="1.0.0",
            size_bytes=2,
            sha256="0" * 64,
            storage_key=f"test/{result_id}",
            created_by=user,
            extensions_json=[],
        )
        session.add_all([calculation, artifact])
        session.flush()
        session.add(
            CalculationInputRecord(
                project_id=project_id,
                calculation_id=calculation.id,
                structure_version_id=new_id(),
                specification_json={},
                normalized_input_artifact_id=artifact.id,
            )
        )
        provenance = ProvenanceRecordRow(
            project_id=project_id,
            subject_type="calculation.result",
            subject_id=result_id,
            source_class="CALCULATED",
            detail="DETERMINISTIC_TRANSFORM",
            verification_state="UNVERIFIED",
            producer_kind="SOFTWARE",
            producer_identifier="test",
            producer_software_version="1",
            source_artifact_id=None,
            operation="test",
            operation_version="1",
            parameters_json=[],
            approximate=False,
            supersedes_id=None,
            correlation_id=calculation.id,
        )
        session.add(provenance)
        session.flush()
        session.add(
            CalculationResultRecord(
                id=result_id,
                project_id=project_id,
                calculation_id=calculation.id,
                calculation_input_id=session.scalar(
                    select(CalculationInputRecord.id).where(
                        CalculationInputRecord.calculation_id == calculation.id
                    )
                ),
                result_type=result_type,
                authority="AUTHORITATIVE",
                source_class="CALCULATED",
                verification_state="UNVERIFIED",
                validation_state="VALIDATED",
                trusted_producer_id="test",
                trusted_producer_type="SCIENTIFIC_WORKER",
                producer_attestation_id="test",
                producer_software_json={},
                payload_json=payload,
                provenance_record_id=provenance.id,
                raw_artifacts_json=[],
                idempotency_key=f"seed-{result_id}",
                request_id=new_id(),
                correlation_id=new_id(),
            )
        )
        session.commit()
    return result_id


def seed_chemdft_tddft(sessions, project_id: str) -> str:
    """A validated `chemdft.tddft` row shaped like the real payload: states live under `excited_states`."""
    from chemdft_api.contracts.results import ExcitedState

    def state(index: int, ev: float, f: float) -> dict:
        return ExcitedState.model_validate(
            {
                "index": index,
                "state_label": f"S{index + 1}",
                "energy_hartree": ev / 27.211386245988,
                "energy_ev": ev,
                "wavelength_nm": 1239.8419843320025 / ev,
                "oscillator_strength": f,
                "transition_dipole": [0.0, 0.0, 0.1],
            }
        ).model_dump(mode="json")

    payload = {
        "payload_schema": "chemdft.tddft",
        "input_structure_version_id": new_id(),
        "method": "b3lyp",
        "basis": "def2-svpd",
        "engine": "pyscf",
        "excited_states": [state(0, 4.45, 0.0004), state(1, 6.0, 0.0023), state(2, 6.4, 0.31)],
    }
    return _seed_result(sessions, project_id, "chemdft.tddft", payload)


def calc_counts(sessions) -> tuple[int, int]:
    with sessions() as session:
        return session.scalar(
            select(func.count()).select_from(CalculationResultRecord)
        ), session.scalar(select(func.count()).select_from(ImportedResultRecord))


def test_sources_are_listed_per_technique(api, project, imported):
    client, _, _ = api
    base = f"/v1/projects/{project}/experimental/spectra/comparison-sources"
    ir = client.get(base, params={"technique": "IR"}).json()["sources"]
    assert (
        len(ir) == 1
        and ir[0]["kind"] == "IMPORTED_RESULT"
        and ir[0]["item_count"] == 3
        and ir[0]["has_intensities"]
        and ir[0]["phase"] == "UNKNOWN"
    )
    assert "imported from Gaussian" in ir[0]["label"]
    assert len(client.get(base, params={"technique": "RAMAN"}).json()["sources"]) == 1
    uv = client.get(base, params={"technique": "UVVIS"}).json()["sources"]
    assert len(uv) == 1 and uv[0]["item_count"] == 3


def test_ir_comparison_is_candidate_matching_with_full_metrics(api, project, imported):
    client, sessions, _ = api
    before = calc_counts(sessions)
    _, corrected, found = ir_peaks(client, project)
    response = compare(client, project, corrected, found, imported["chemdft.imported.vibrations"])
    assert response.status_code == 201, response.text
    view = response.json()
    assert (
        view["technique"] == "IR"
        and view["method"] == "gated_optimal_assignment"
        and view["axis"] == "cm^-1"
        and view["authority"] == "DETERMINISTIC_TRANSFORM"
    )
    metrics = view["metrics"]
    assert (
        metrics["matched"] == 3
        and metrics["experimental_peaks"] >= 3
        and metrics["calculated_considered"] == 3
    )
    assert (
        metrics["mae"] is not None
        and metrics["rmse"] is not None
        and metrics["signed_bias"] is not None
        and metrics["max_abs_delta"] is not None
    )
    assert (
        metrics["mae_upper_bound_by_construction"] == 30.0
        and "unmatched" in metrics["mae_note"]
        and len(metrics["tolerance_sensitivity"]) == 3
    )
    assert (
        metrics["matched_fraction_of_experimental_peaks"] is not None
        and metrics["unmatched_experimental"] == metrics["experimental_peaks"] - 3
    )
    deltas = {p["calculated_index"]: p["delta"] for p in view["pairs"]}
    assert (
        deltas[0] == pytest.approx(1596.0 - 1600.0, abs=3.0)
        and deltas[1] == pytest.approx(3705.0 - 3700.0, abs=6.0)
        and deltas[2] == pytest.approx(3790.0 - 3800.0, abs=8.0)
    )
    assert {p["status"] for p in view["pairs"]} <= {"CANDIDATE_MATCH", "AMBIGUOUS_CANDIDATE"}
    assert (
        "ASSIGNED" not in str(view)
        and "not assignments" in view["assignment_statement"]
        and "no intensity agreement is claimed" in view["intensity_statement"]
    )
    assert view["scaling"]["mode"] == "UNSCALED" and view["scaling"]["factor"] is None
    assert (
        view["calculated"]["kind"] == "IMPORTED_RESULT" and view["calculated"]["phase"] == "UNKNOWN"
    )
    assert "CALCULATION_PHASE_UNKNOWN" in [
        d["code"] for d in view["diagnostics"]
    ] or "PHASE_UNKNOWN" in [d["code"] for d in view["diagnostics"]]
    assert view["experimental_phase"]["status"] == "NOT_SUPPLIED"
    assert (
        calc_counts(sessions) == before
    )  # a comparison never creates or changes a calculation / imported result
    with sessions() as session:
        row = session.get(SpectrumComparisonRecord, view["id"])
        provenance = session.get(ProvenanceRecordRow, view["provenance_record_id"])
        assert (provenance.source_class, provenance.detail) == (
            "EXPERIMENTAL",
            "DETERMINISTIC_TRANSFORM",
        ) and provenance.subject_id == row.id
        inputs = session.scalars(
            select(ProvenanceInputRow)
            .where(ProvenanceInputRow.provenance_record_id == provenance.id)
            .order_by(ProvenanceInputRow.position)
        ).all()
        assert [(i.input_type, i.input_id) for i in inputs] == [
            ("ENTITY", corrected["id"]),
            ("ENTITY", found["id"]),
            ("ENTITY", imported["chemdft.imported.vibrations"]),
        ]
        assert (
            inputs[2].input_sha256
            == session.get(
                ImportedResultRecord, imported["chemdft.imported.vibrations"]
            ).payload_sha256
        )
    assert (
        client.get(f"/v1/projects/{project}/experimental/spectra/comparisons/{view['id']}").json()[
            "record_sha256"
        ]
        == view["record_sha256"]
    )
    assert [
        c["id"]
        for c in client.get(
            f"/v1/projects/{project}/experimental/spectra/comparisons",
            params={"experimental_dataset_id": corrected["id"]},
        ).json()["comparisons"]
    ] == [view["id"]]


def test_scaling_is_explicit_persisted_and_changes_the_gate_result(api, project, imported):
    client, _, _ = api
    _, raw, found = ir_peaks(
        client,
        project,
        shape=((1536.0, 18.0, 0.9), (3552.0, 30.0, 0.5), (3648.0, 30.0, 0.4)),
        key="ir-scaled-0001",
    )
    source = imported["chemdft.imported.vibrations"]
    unscaled = compare(client, project, raw, found, source, key="cmp-unscaled-01").json()
    scaled = compare(
        client,
        project,
        raw,
        found,
        source,
        key="cmp-scaled-0001",
        scaling={"mode": "USER_FACTOR", "factor": 0.96},
    ).json()
    assert unscaled["metrics"]["matched"] == 0 and unscaled["metrics"]["unmatched_calculated"] == 3
    assert scaled["metrics"]["matched"] == 3 and scaled["scaling"] == {
        "mode": "USER_FACTOR",
        "factor": 0.96,
        "source": "entered by the user for this comparison; not a library or literature value",
    }
    assert scaled["pairs"][0]["calculated_position_source"] == 1600.0 and scaled["pairs"][0][
        "calculated_position"
    ] == pytest.approx(1536.0)
    assert "USER_SCALE_FACTOR" in [d["code"] for d in scaled["diagnostics"]]
    assert (
        compare(
            client,
            project,
            raw,
            found,
            source,
            key="cmp-bad-factor-1",
            scaling={"mode": "USER_FACTOR", "factor": 3.0},
        ).status_code
        == 422
    )
    assert (
        compare(
            client,
            project,
            raw,
            found,
            source,
            key="cmp-no-factor-01",
            scaling={"mode": "USER_FACTOR"},
        ).status_code
        == 422
    )
    with_literature = compare(
        client,
        project,
        raw,
        found,
        source,
        key="cmp-lit-factor-1",
        scaling={"mode": "LITERATURE", "factor": 0.96},
    )
    assert with_literature.status_code == 422  # there is no literature mode


def test_comparison_is_idempotent_and_validates_its_inputs(api, project, imported):
    client, sessions, _ = api
    _, raw, found = ir_peaks(client, project)
    source = imported["chemdft.imported.vibrations"]
    first = compare(client, project, raw, found, source)
    again = compare(client, project, raw, found, source)
    assert again.status_code == 201 and again.json()["id"] == first.json()["id"]
    assert compare(client, project, raw, found, source, tolerance=10.0).status_code == 409
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(SpectrumComparisonRecord)) == 1
    other_raw = import_spectrum(client, project, ir_text(peaks=WATER_PEAKS), key="ir-other-0001")
    assert (
        compare(client, project, other_raw, found, source, key="cmp-wrong-peaks-1").status_code
        == 422
    )  # peak set belongs to another spectrum
    assert (
        compare(client, project, found, found, source, key="cmp-peaks-peaks-1").status_code == 422
    )
    assert (
        compare(client, project, raw, found, new_id(), key="cmp-missing-src-1").status_code == 404
    )
    assert (
        compare(
            client,
            project,
            raw,
            found,
            imported["chemdft.imported.excitations"],
            key="cmp-wrong-kind-01",
        ).status_code
        == 404
    )  # excitations do not apply to IR
    assert (
        compare(client, project, raw, found, source, key="cmp-axis-ev-0001", axis="eV").status_code
        == 422
    )
    body = {
        "experimental_dataset_id": raw["id"],
        "peak_set_dataset_id": found["id"],
        "calculated": {"kind": "IMPORTED_RESULT", "id": source},
        "idempotency_key": "cmp-no-tolerance",
    }
    assert (
        client.post(
            f"/v1/projects/{project}/experimental/spectra/comparisons", json=body
        ).status_code
        == 422
    )  # tolerance has no default


def test_phase_mismatch_is_reported_for_a_condensed_sample_against_a_gas_phase_calculation(
    api, project
):
    client, sessions, _ = api
    result_id = seed_chemdft_vibrations(sessions, project)
    liquid = import_spectrum(
        client,
        project,
        ir_text(header=None, delimiter=" ", peaks=WATER_PEAKS),
        key="ir-liquid-0002",
        choices={
            "x_unit": "cm^-1",
            "y_quantity": "ABSORBANCE",
            "y_unit": "absorbance",
            "metadata": {"phase": "LIQUID"},
        },
    )
    corrected = transform(
        client, project, liquid["id"], "baseline.snip", {"half_window_x": 80}
    ).json()
    liquid_peaks = peaks(client, project, corrected["id"], {"prominence_sigma": 8}).json()
    response = compare(
        client,
        project,
        corrected,
        liquid_peaks,
        result_id,
        kind="CALCULATION_RESULT",
        key="cmp-liquid-0001",
    )
    assert response.status_code == 201, response.text
    view = response.json()
    assert (
        view["calculated"]["kind"] == "CALCULATION_RESULT"
        and view["calculated"]["phase"] == "GAS"
        and view["experimental_phase"]["value"] == "LIQUID"
    )
    assert "PHASE_MISMATCH" in [d["code"] for d in view["diagnostics"]]
    assert view["metrics"]["matched"] == 3


def test_phase_is_unknown_when_not_supplied(api, project):
    client, sessions, _ = api
    result_id = seed_chemdft_vibrations(sessions, project)
    _, corrected, found = ir_peaks(client, project)
    view = compare(client, project, corrected, found, result_id, kind="CALCULATION_RESULT").json()
    assert (
        "PHASE_UNKNOWN" in [d["code"] for d in view["diagnostics"]]
        and view["experimental_phase"]["status"] == "NOT_SUPPLIED"
    )


def test_raman_comparison_uses_activities_and_never_a_laser_default(api, project, imported):
    client, _, _ = api
    raw = import_spectrum(
        client, project, raman_text(), technique="RAMAN", name="raman.txt", key="raman-key-0001"
    )
    corrected = transform(client, project, raw["id"], "baseline.snip", {"half_window_x": 60}).json()
    found = peaks(client, project, corrected["id"], {"prominence_sigma": 10}).json()
    view = compare(
        client, project, corrected, found, imported["chemdft.imported.vibrations"], tolerance=40.0
    ).json()
    assert (
        view["technique"] == "RAMAN"
        and view["calculated"]["technique"] == "RAMAN"
        and view["axis"] == "cm^-1"
    )
    excluded = {e["reason"]: e["count"] for e in view["metrics"]["calculated_excluded"]}
    assert (
        view["metrics"]["matched"] == 0
        and view["metrics"]["calculated_considered"] == 1
        and excluded["outside_experimental_window"] == 2
    )  # 3700/3800 lie above the measured 3200 cm^-1
    assert (
        view["metrics"]["unmatched_calculated"] == 1
        and view["metrics"]["unmatched_experimental"] >= 3
    )
    assert (
        raw["acquisition"]["excitation_wavelength_nm"]["status"] == "NOT_SUPPLIED"
    )  # not invented anywhere along the way


def test_uvvis_band_comparison_is_quantitative_only_for_absolute_cross_sections(
    api, project, imported
):
    client, sessions, _ = api
    raw = import_spectrum(
        client, project, uv_text(0.042), technique="UVVIS", name="uv.csv", key="uv-key-0001"
    )
    found = peaks(client, project, raw["id"], {"prominence_sigma": 20}).json()
    assert found["peak_set"]["peak_count"] >= 1
    source = imported["chemdft.imported.excitations"]
    view = compare(
        client,
        project,
        raw,
        found,
        source,
        tolerance=0.1,
        axis="eV",
        bands=[{"label": "n-pi*", "lo_nm": 230, "hi_nm": 340}],
        key="cmp-uv-0001",
    ).json()
    assert (
        view["technique"] == "UVVIS"
        and view["axis"] == "eV"
        and view["scaling"]["mode"] == "UNSCALED"
    )
    band = view["bands"][0]
    assert band["experimental"]["f"] == pytest.approx(0.042, rel=0.02) and band[
        "f_calculated_sum"
    ] == pytest.approx(0.0004)
    assert (
        band["calculated_states_in_band"] == [0]
        and band["limit_sensitivity"]["f_min"]
        <= band["experimental"]["f"]
        <= band["limit_sensitivity"]["f_max"]
    )
    assert "cm^-1" in band["integration_domain"] and "RATIO_IS_NOT_A_SCORE" in [
        n["code"] for n in band["notes"]
    ]
    assert (
        view["metrics"]["calculated_total"] == 3
        and {e["reason"]: e["count"] for e in view["metrics"]["calculated_excluded"]}[
            "outside_experimental_window"
        ]
        == 1
    )
    assert "VERTICAL_EXCITATIONS" in [d["code"] for d in view["diagnostics"]]
    assert (
        compare(
            client,
            project,
            raw,
            found,
            source,
            tolerance=0.1,
            axis="eV",
            scaling={"mode": "USER_FACTOR", "factor": 0.9},
            key="cmp-uv-scaled-01",
        ).status_code
        == 422
    )
    absorbance = import_spectrum(
        client,
        project,
        uv_text(0.042, header="Wavelength (nm),Absorbance"),
        technique="UVVIS",
        name="uvabs.csv",
        key="uv-key-0002",
    )
    abs_peaks = peaks(client, project, absorbance["id"], {"prominence_sigma": 20}).json()
    qualitative = compare(
        client,
        project,
        absorbance,
        abs_peaks,
        source,
        tolerance=0.1,
        axis="eV",
        bands=[{"lo_nm": 230, "hi_nm": 340}],
        key="cmp-uv-abs-0001",
    ).json()["bands"][0]
    assert qualitative["experimental"] is None and "NO_QUANTITATIVE_EXPERIMENTAL_BAND" in [
        n["code"] for n in qualitative["notes"]
    ]
    normalised = transform(client, project, raw["id"], "normalize.max", {"target": 1}).json()
    norm_peaks = peaks(client, project, normalised["id"], {"prominence_sigma": 20}).json()
    relative = compare(
        client,
        project,
        normalised,
        norm_peaks,
        source,
        tolerance=0.1,
        axis="eV",
        bands=[{"lo_nm": 230, "hi_nm": 340}],
        key="cmp-uv-rel-0001",
    ).json()["bands"][0]
    assert relative["experimental"] is None  # normalised data are never treated as raw intensities
    with sessions() as session:
        assert (
            session.scalar(select(func.count()).select_from(StructureRecord)) >= 1
        )  # the imported structure exists; nothing else was created by comparing


def test_uvvis_comparison_reads_the_real_chemdft_tddft_payload(api, project):
    client, sessions, _ = api
    result_id = seed_chemdft_tddft(sessions, project)
    sources = client.get(
        f"/v1/projects/{project}/experimental/spectra/comparison-sources",
        params={"technique": "UVVIS"},
    ).json()["sources"]
    assert [(s["kind"], s["id"], s["item_count"], s["phase"]) for s in sources] == [
        ("CALCULATION_RESULT", result_id, 3, "GAS")
    ]
    raw = import_spectrum(
        client, project, uv_text(0.042), technique="UVVIS", name="uv.csv", key="uv-real-shape-1"
    )
    found = peaks(client, project, raw["id"], {"prominence_sigma": 20}).json()
    body = {
        "experimental_dataset_id": raw["id"],
        "peak_set_dataset_id": found["id"],
        "calculated": {"kind": "CALCULATION_RESULT", "id": result_id},
        "tolerance": 0.3,
        "axis": "eV",
        "bands": [{"label": "n-pi*", "lo_nm": 230, "hi_nm": 340}],
        "idempotency_key": "cmp-real-shape-01",
    }
    view = client.post(f"/v1/projects/{project}/experimental/spectra/comparisons", json=body)
    assert view.status_code == 201, view.text
    comparison = view.json()
    assert (
        comparison["calculated"]["kind"] == "CALCULATION_RESULT"
        and comparison["calculated"]["phase"] == "GAS"
    )
    assert (
        comparison["metrics"]["calculated_total"] == 3 and comparison["metrics"]["matched"] == 1
    )  # 4.45 eV (278.6 nm) pairs with the 280 nm band
    assert comparison["bands"][0]["f_calculated_sum"] == pytest.approx(0.0004) and comparison[
        "bands"
    ][0]["experimental"]["f"] == pytest.approx(0.042, rel=0.02)
    assert "PHASE_UNKNOWN" in [d["code"] for d in comparison["diagnostics"]]
