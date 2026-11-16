"""Quantum ESPRESSO periodic DFT (release 0.0.43): how the engine plugs into contracts, registry, publication, citations.

No QE is run here. Hand-made candidates in the worker's format test the Result Firewall rules; the stub-based orchestration
tests are in test_qe_periodic.py."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from test_qe_periodic import cr2o3_document

from chemdft_api.calculation_actions import _require_qe_log_energy, _validate_periodic_energy_candidate
from chemdft_api.citation_block import QE_LIBRARY_KEYS, qe_citation_keys, third_party_citations
from chemdft_api.config import Settings
from chemdft_api.contracts.results import PeriodicEnergyResult
from chemdft_api.contracts.scientific import (
    CoordinateSystem,
    BasisSetReference,
    CalculationSpecification,
    CalculationTaskType,
    EnginePreference,
    PeriodicOptions,
    ScientificMethodReference,
)
from chemdft_api.errors import EngineUnavailable, UnsupportedCalculation
from chemdft_api.scientific.engines.normalization import normalized_calculation_input
from chemdft_api.scientific.engines.registry import (
    CAPABILITIES,
    capability_views,
    validate_capability,
)
from chemdft_api.scientific.qe_periodic import qe_kpath, qe_limits, qe_pseudopotentials
from chemdft_api.scientific.qe_periodic.qe_registry import (
    QE_BASIS_IDENTIFIER,
    probe_qe,
    qe_creation_refusal,
    qe_document_refusal,
    qe_limits_from_settings,
)

TESTS = Path(__file__).parent
WEB = TESTS.parents[2] / "apps" / "web"


def qe_spec(*, engine="qe", method="pbe+u", basis=QE_BASIS_IDENTIFIER, **periodic) -> CalculationSpecification:
    options = {"k_mesh": (2, 2, 2), "u_effective_ev": {"Cr": 3.7}, "magnetic_order": "antiferromagnetic"}
    options.update(periodic)
    return CalculationSpecification(
        task_type=CalculationTaskType.PERIODIC_ENERGY,
        method=ScientificMethodReference(identifier=method, display_name=method.upper(), registry="chemdft.method"),
        basis=BasisSetReference(identifier=basis, display_name=basis, registry="chemdft.basis"),
        charge=0,
        multiplicity=1,
        engine_preference=EnginePreference(engine=engine),
        periodic=PeriodicOptions(**options),
    )


@pytest.fixture
def qe_settings(tmp_path) -> Settings:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name in ("pw.x", "projwfc.x", "dos.x", "bands.x"):
        (bin_dir / name).write_text("#!/bin/sh\n")
    pseudo = tmp_path / "pseudo"
    pseudo.mkdir()
    return Settings(compute_local_enabled=True, qe_bin_dir=bin_dir, qe_pseudo_dir=pseudo)


# ------------------------------------------------------------------------------------------------ contracts


def test_periodic_options_defaults_keep_pyscf_unchanged():
    options = PeriodicOptions()
    assert (options.relax, options.dos, options.bands) == (False, False, False)
    assert options.dos_k_mesh == (6, 6, 6) and options.relax_max_steps == 30
    assert "stress" not in PeriodicOptions.model_fields and "vc_relax" not in PeriodicOptions.model_fields
    with pytest.raises(ValueError):
        PeriodicOptions(relax_max_steps=31)
    with pytest.raises(ValueError):
        PeriodicOptions(cell_relax=True)  # no cell relaxation field exists


def test_result_contract_new_fields_are_optional_and_pyscf_results_still_parse():
    old = {
        "total_energy": {"value": -443.6, "unit": {"standard": "QCSCHEMA", "code": "Eh", "dimension": "ENERGY"}},
        "converged": True, "parser_version": "1.0.0", "validator_version": "1.0.0",
    }
    result = PeriodicEnergyResult.model_validate(old)
    assert result.engine == "pyscf" and result.local_moment_kind == "mulliken-type" and result.dos is None


# ------------------------------------------------------------------------------------------------ registry


def test_probe_and_capability_views(qe_settings, tmp_path):
    assert probe_qe(qe_settings) == ("AVAILABLE", "7.6", None)
    assert probe_qe(Settings(compute_local_enabled=True))[0] == "UNAVAILABLE"
    missing = Settings(compute_local_enabled=True, qe_bin_dir=tmp_path / "nowhere", qe_pseudo_dir=tmp_path)
    state, _, diagnostic = probe_qe(missing)
    assert state == "UNAVAILABLE" and "pw.x" in diagnostic
    views = {v.engine: v for v in capability_views(qe_settings)}
    assert views["qe"].availability == "AVAILABLE" and views["qe"].supported_tasks == ("PERIODIC_ENERGY",)
    assert views["qe"].supported_basis_sets == (QE_BASIS_IDENTIFIER,)
    assert CAPABILITIES["qe"].tasks == frozenset({CalculationTaskType.PERIODIC_ENERGY})
    off = {v.engine: v for v in capability_views(Settings(compute_local_enabled=True))}
    assert off["qe"].availability != "AVAILABLE" and off["qe"].supported_tasks == ()


def test_hosted_qe_stays_off_until_the_owner_switches_it_on():
    hosted = Settings(compute_local_enabled=False, compute_aws_enabled=True)
    assert hosted.aws_qe_enabled is False
    assert probe_qe(hosted)[0] == "UNAVAILABLE"


def test_validate_capability_accepts_qe_and_refuses_the_rest(qe_settings):
    validate_capability(qe_spec(), qe_settings)
    with pytest.raises(UnsupportedCalculation, match="hybrids are not offered"):
        validate_capability(qe_spec(method="pbe0"), qe_settings)
    with pytest.raises(UnsupportedCalculation, match="basis must be"):
        validate_capability(qe_spec(basis="gth-dzvp-molopt-sr"), qe_settings)
    with pytest.raises(UnsupportedCalculation, match="U values were given but the method is PBE"):
        validate_capability(qe_spec(method="pbe"), qe_settings)
    with pytest.raises(UnsupportedCalculation, match="3d transition metals only"):
        validate_capability(qe_spec(u_effective_ev={"O": 2.0}), qe_settings)
    with pytest.raises(EngineUnavailable):
        validate_capability(qe_spec(), Settings(compute_local_enabled=True))


def test_pyscf_engine_refuses_qe_only_stages(qe_settings):
    for stage in ({"relax": True}, {"dos": True}, {"bands": True}):
        spec = qe_spec(engine="pyscf", basis="gth-dzvp-molopt-sr", **stage)
        with pytest.raises((UnsupportedCalculation, EngineUnavailable)):
            validate_capability(spec, Settings(compute_local_enabled=True))
    # and the PySCF periodic path itself is untouched by the new option defaults
    plain = qe_spec(engine="pyscf", basis="gth-dzvp-molopt-sr")
    assert plain.periodic.relax is False


def test_creation_refusals_name_the_reason(qe_settings):
    atoms = cr2o3_document()["atoms"]
    assert qe_creation_refusal(qe_settings, qe_spec(), atoms) is None
    assert "20 atoms" in qe_creation_refusal(qe_settings, qe_spec(), atoms * 3)
    assert "Gamma, 2x2x2" in qe_creation_refusal(qe_settings, qe_spec(k_mesh=(5, 5, 5)), atoms)
    bad = [dict(a) for a in atoms]
    bad[4]["element"] = "U"
    assert "not offered" in qe_creation_refusal(qe_settings, qe_spec(), bad)
    document = cr2o3_document(bands=True, band_path={"weights": [12, 12, 12, 12, 1]})
    assert qe_document_refusal(qe_settings, document) is None


def test_limits_come_from_settings_with_the_measured_defaults():
    limits = qe_limits_from_settings(Settings())
    assert (limits.max_atoms, limits.max_scf_k, limits.max_dos_k, limits.max_band_points, limits.relax_max_steps) == (20, 4, 6, 100, 30)
    assert (limits.timeout_scf_s, limits.timeout_relax_s, limits.timeout_nscf_dos_s, limits.timeout_bands_s, limits.timeout_total_s) == (1800, 3600, 1800, 1800, 3600)
    assert limits.max_memory_mb == 6000


def test_limits_match_the_web_golden_record():
    parity = json.loads((TESTS / "fixtures" / "contracts" / "qe_limits_parity.json").read_text())
    limits = qe_limits.QeLimits()
    for case in parity["cases"]:
        c = case["input"]
        est = qe_limits.estimate_seconds(
            atoms=c["atoms"], ecutwfc_ry=c["ecutwfc_ry"], scf_mesh=c["scf_mesh"], nspin=c["nspin"], relax=c["relax"],
            dos=c["dos"], dos_mesh=c["dos_mesh"], bands=c["bands"], band_points=c["band_points"])
        assert est["total"] == case["estimate_total_s"]
        assert qe_limits.estimate_memory_mb(atoms=c["atoms"], ecutwfc_ry=c["ecutwfc_ry"], band_points=c["band_points"], bands=c["bands"], dos=c["dos"]) == case["memory_mb"]
        assert qe_limits.refusal(limits, atoms=c["atoms"], ecutwfc_ry=c["ecutwfc_ry"], scf_mesh=c["scf_mesh"], relax=c["relax"],
                                 relax_max_steps=c["relax_max_steps"], dos=c["dos"], dos_mesh=c["dos_mesh"], bands=c["bands"],
                                 band_points=c["band_points"], nspin=c["nspin"]) == case["refusal"]


def test_web_element_table_equals_the_python_table():
    web = json.loads((WEB / "src" / "content" / "qe-sssp-elements.json").read_text())
    assert web["library"] == qe_pseudopotentials.PSEUDO_LIBRARY_NAME and web["doi"] == qe_pseudopotentials.PSEUDO_LIBRARY_DOI
    expected = {
        el: {"ecutwfc": w, "ecutrho": r, "library": qe_pseudopotentials.LIBRARY_BY_TAG[lib],
             "hubbard3d": "3D" in labs and el in qe_pseudopotentials.HUBBARD_3D_ELEMENTS}
        for el, (_f, _t, _z, w, r, lib, labs, _m) in qe_pseudopotentials.SSSP_EFFICIENCY_V2.items()
    }
    assert web["elements"] == expected and web["unoffered"] == sorted(qe_pseudopotentials.UNOFFERED_ELEMENTS)


# ------------------------------------------------------------------------------------------------ normalization / k-path


def test_kpath_for_the_cr2o3_cell_is_valid_and_bounded():
    d = cr2o3_document()
    path = qe_kpath.band_path_for(d["periodic_cell"]["lattice_vectors"], [a["element"] for a in d["atoms"]], [a["fractional"] for a in d["atoms"]])
    assert path["labels"][0] == "Γ" and len(path["labels"]) == len(path["points"]) == len(path["weights"])
    assert path["weights"][-1] == 1 and qe_kpath.total_points(path["weights"]) <= 100
    assert "Setyawan-Curtarolo" in path["source"]


def test_kpath_falls_back_honestly_on_nonsense():
    path = qe_kpath.band_path_for([[1, 0, 0], [0, 1, 0], [0, 0, 1]], ["H", "H"], [[0, 0, 0], [0, 0, 0]])
    assert path["labels"][0] == "Γ" and qe_kpath.total_points(path["weights"]) <= 100
    assert path["source"]  # the source line says how the path was made


# ------------------------------------------------------------------------------------------------ Result Firewall


def good_candidate(**extra):
    base = {
        "schema": "chemdft.worker.periodic-energy", "task": "PERIODIC_ENERGY", "engine": "qe", "engine_version": "7.6",
        "converged": True, "finite": True, "total_energy_hartree": -475.9995944, "scf_iterations": 14, "band_gap_ev": 3.247,
        "k_mesh": [3, 3, 3], "magnetic_order": "antiferromagnetic", "u_effective_ev": {"Cr": 3.7}, "used_default_u": True,
        "local_magnetic_moments": {"0": -2.997, "1": 2.997}, "total_magnetization": 0.0, "absolute_magnetization": 12.38,
        "fermi_energy_ev": 12.798, "irreducible_k_points": 6, "pseudopotential": "SSSP PBE Efficiency v2.0",
        "pseudopotential_files": {"Cr": "Cr.us.pbe.z_14.uspp.gbrv.v1.5.upf"}, "pseudopotential_libraries": {"Cr": "gbrv", "O": "pslibrary-0"},
        "cutoffs_ry": {"ecutwfc": 45.0, "ecutrho": 540.0}, "runtime_seconds": 130.0,
    }
    base.update(extra)
    return base


def test_qe_candidate_validates_and_carries_the_new_fields():
    result = _validate_periodic_energy_candidate(good_candidate())
    assert result.engine == "qe" and result.local_moment_kind == "lowdin-projected"
    assert result.pseudopotential_library == "SSSP PBE Efficiency v2.0" and result.cutoffs_ry == {"ecutwfc": 45.0, "ecutrho": 540.0}
    assert result.irreducible_k_points == 6 and result.fermi_energy_ev == 12.798 and result.used_default_u is True


def test_firewall_refuses_non_converged_and_unconverged_relaxation():
    with pytest.raises(ValueError, match="Nonconverged"):
        _validate_periodic_energy_candidate(good_candidate(converged=False))
    with pytest.raises(ValueError, match="relaxation that did not converge"):
        _validate_periodic_energy_candidate(good_candidate(relaxation={"converged": False}))
    ok = _validate_periodic_energy_candidate(good_candidate(relaxation={"converged": True, "ionic_steps": 6}))
    assert ok.relaxation["ionic_steps"] == 6


def test_the_native_log_must_confirm_the_energy():
    log = b"!    total energy              =    -951.99918880 Ry\n"
    _require_qe_log_energy(good_candidate(), log)  # -951.9991888 Ry / 2 = -475.9995944 Eh
    with pytest.raises(ValueError, match="contradicts"):
        _require_qe_log_energy(good_candidate(total_energy_hartree=-475.0), log)
    with pytest.raises(ValueError, match="no total energy line"):
        _require_qe_log_energy(good_candidate(), b"nothing here\n")


# ------------------------------------------------------------------------------------------------ citations


def test_citation_registry_has_every_key_the_project_detector_can_return():
    registry = third_party_citations()
    payload = {"u_effective_ev": {"Cr": 3.7}, "used_default_u": True, "local_magnetic_moments": {"0": 1.0},
               "pseudopotential_libraries": {el: lib for el, lib in {"A": "gbrv", "B": "pslibrary-0", "C": "pslibrary-1", "D": "jth",
                                                                     "E": "spms", "F": "sg15", "G": "pseudodojo", "H": "tw14"}.items()}}
    keys = qe_citation_keys(payload)
    for key in keys:
        assert key in registry, key
        entry = registry[key]
        assert entry["doi"] and entry["apa"] and entry["bibtex"] and entry["verification_source"]
    assert set(QE_LIBRARY_KEYS.values()) <= set(registry)
    assert registry["sssp_library"]["name"] == "SSSP PBE Efficiency v2.0" and registry["sssp_library"]["doi"] == "10.24435/materialscloud:f3-ym"
    minimal = qe_citation_keys({"u_effective_ev": {}, "pseudopotential_libraries": {"Mg": "gbrv"}})
    assert "dudarev1998" not in minimal and "jain2011" not in minimal and "lowdin1950" not in minimal and "pbe" in minimal


def test_python_registry_and_web_engine_references_carry_the_same_dois():
    registry = third_party_citations()
    web = (WEB / "src" / "content" / "engine-citations.ts").read_text()
    web_dois = set(re.findall(r'"doi": "([^"]+)"', web))
    for key in ("qe", "qe2009", "qe2020", "timrov2020", "lowdin1950", "prandini2018", "sssp_library", "gbrv", "pslibrary0", "pslibrary1",
                "pseudodojo", "sg15", "spms", "jth", "tw14", "pbe", "dudarev1998", "jain2011"):
        assert registry[key]["doi"] in web_dois, key
    assert "10.1103/PhysRevB.98.085127" not in json.dumps(registry) + web  # described differently from how it was expected; not used
    assert "in preparation" not in json.dumps(registry) + web


def test_no_stress_or_pressure_anywhere_in_the_input_or_the_result_contract():
    assert "stress" not in json.dumps(list(PeriodicEnergyResult.model_fields)) and "pressure" not in json.dumps(list(PeriodicEnergyResult.model_fields))
    from chemdft_api.scientific.qe_periodic import qe_inputs

    model = qe_inputs.build_model(cr2o3_document(relax=True))
    for calc in ("scf", "relax", "nscf"):
        text = qe_inputs.write_pw_input(model, calculation=calc, pseudo_dir="/p", outdir="o", k_mesh=(2, 2, 2))
        assert "tstress=.false." in text and "vc-relax" not in text and "cell_dynamics" not in text


def test_normalized_input_adds_a_band_path_only_for_qe_with_bands():
    class Version:
        id = "v1"
        overall_charge = 0  # noqa: RUF012
        multiplicity = 1  # noqa: RUF012
        periodic_cell_json = {"lattice_vectors": cr2o3_document()["periodic_cell"]["lattice_vectors"]}  # noqa: RUF012
        representation_json = {}  # noqa: RUF012

    d = cr2o3_document()
    Version.representation_json = {
        "coordinates": {
            "coordinate_system": CoordinateSystem.FRACTIONAL,
            "unit": "angstrom",
            "atoms": [{"index": i, "element": a["element"], "atomic_number": a["atomic_number"], "x": a["fractional"][0], "y": a["fractional"][1], "z": a["fractional"][2]} for i, a in enumerate(d["atoms"])],
        }
    }
    document, _payload, _hash = normalized_calculation_input(Version, qe_spec(bands=True), max_atoms=50)
    assert document["periodic"]["band_path"]["labels"][0] == "Γ"
    plain, _p, _h = normalized_calculation_input(Version, qe_spec(), max_atoms=50)
    assert "band_path" not in plain["periodic"]


def test_image_recipe_matches_the_element_table_and_the_pinned_hashes():
    infra = TESTS.parents[2] / "infra" / "aws" / "ec2-pilot"
    lock = dict(
        line.split("=", 1) for line in (infra / "qe-recipe.lock").read_text().splitlines() if "=" in line and not line.startswith("#")
    )
    assert lock["SSSP_SHA256"] == qe_pseudopotentials.PSEUDO_LIBRARY_TARBALL_SHA256
    assert lock["SSSP_URL"] == qe_pseudopotentials.PSEUDO_LIBRARY_URL and lock["SSSP_FILE_COUNT"] == "95"
    assert lock["QE_TAG"] == "qe-7.6" and re.fullmatch(r"[0-9a-f]{40}", lock["QE_COMMIT"])
    rows = [line.split("  ", 1) for line in (infra / "sssp-pbe-eff-v2.files.sha256").read_text().splitlines()]
    files = {name.removeprefix("library/") for _h, name in rows if name.startswith("library/")}
    assert len(files) == 95 and all(re.fullmatch(r"[0-9a-f]{64}", h) for h, _n in rows)
    offered = {row[0] for row in qe_pseudopotentials.SSSP_EFFICIENCY_V2.values()}
    assert offered <= files and len(files - offered) == len(qe_pseudopotentials.UNOFFERED_ELEMENTS)
    assert ("410b992b15e5a75a7dd129e6b516a512ea1f38ce02e12350cd49a632544efb16", "cutoffs.json") in [tuple(r) for r in rows]
    docker = (infra / "Dockerfile").read_text()
    assert "FROM runtime-crest AS runtime-qe" in docker and "sha256sum -c" in docker
    assert "ldd /opt/qe/bin/pw.x" in docker and "USER 10001:10001" in docker.split("AS runtime-qe")[1]
    assert lock.get("QE_SOURCE_SHA256_LOCKED", "") == "" or re.fullmatch(r"[0-9a-f]{64}", lock["QE_SOURCE_SHA256_LOCKED"])
