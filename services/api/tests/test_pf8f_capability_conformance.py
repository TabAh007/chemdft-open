"""PF-8F: advertised engine capabilities must equal what validation actually accepts.

No calculation is executed; native executables are only probed for identity.
"""

from __future__ import annotations

from itertools import product
from pathlib import Path
from uuid import uuid4

import pytest
from chemdft_api.config import Settings
from chemdft_api.contracts.scientific import CalculationSpecification
from chemdft_api.errors import EngineUnavailable, UnsupportedCalculation
from chemdft_api.scientific.engines.psi4 import PAIRS, policy
from chemdft_api.scientific.engines.registry import capability_views, validate_capability

ROOT = Path(__file__).resolve().parents[3]
PSI4 = ROOT / ".chemdft/envs/psi4-1.11-py312-gate-a1-20261009/bin/psi4"


def settings(**override):
    values = {"psi4_executable": PSI4}
    values.update(override)
    return Settings(**values)


def spec(engine, method, basis="def2-svp", *, charge=0, multiplicity=1, **extra):
    document = {
        "task_type": extra.pop("task_type", "ENERGY"),
        "method": {"identifier": method, "display_name": method, "registry": "chemdft.method"},
        "basis": None
        if basis is None
        else {"identifier": basis, "display_name": basis, "registry": "chemdft.basis"},
        "charge": charge,
        "multiplicity": multiplicity,
        "engine_preference": {"engine": engine},
        **extra,
    }
    return CalculationSpecification.model_validate(document)


def views(config):
    return {view.engine: view for view in capability_views(config)}


def accepted(config, specification):
    try:
        validate_capability(specification, config)
    except (UnsupportedCalculation, EngineUnavailable):
        return False
    return True


def test_unavailable_engines_advertise_nothing(tmp_path):
    missing = tmp_path / "absent"
    config = Settings(
        scientific_worker_python=missing / "python",
        xtb_executable=missing / "xtb",
        crest_executable=missing / "crest",
        psi4_executable=missing / "psi4",
    )
    for view in capability_views(config):
        assert view.availability != "AVAILABLE", view.engine
        assert view.supported_tasks == () and view.supported_methods == (), view.engine
        assert view.supported_basis_sets == () and view.supported_optimizers == ()
        assert view.supported_method_basis_pairs == ()
        assert view.supported_optimization_levels == ()
        assert view.diagnostic


def test_every_advertised_energy_combination_validates_and_nothing_else_does():
    config = settings()
    by_engine = views(config)
    assert {"pyscf", "xtb", "crest", "psi4"} == set(by_engine)
    pyscf, xtb, psi4 = by_engine["pyscf"], by_engine["xtb"], by_engine["psi4"]
    assert pyscf.availability == xtb.availability == psi4.availability == "AVAILABLE"
    assert (pyscf.version, xtb.version, psi4.version) == ("2.14.0", "6.7.1", "1.11")

    # PySCF: the advertised method x basis grid is exactly what validates.
    for method, basis in product(pyscf.supported_methods, pyscf.supported_basis_sets):
        assert accepted(config, spec("pyscf", method, basis)), (method, basis)
    for method, basis in (("mp2", "def2-svp"), ("hf", "cc-pvdz"), ("ccsd", "sto-3g")):
        assert not accepted(config, spec("pyscf", method, basis)), (method, basis)
    assert not accepted(config, spec("pyscf", "hf", None))

    # xTB: GFN2 without a Gaussian basis.
    assert accepted(config, spec("xtb", "gfn2", None))
    assert not accepted(config, spec("xtb", "gfn2", "def2-svp"))
    assert not accepted(config, spec("xtb", "gfn1", None))

    # Psi4: only the sealed pairs; the method x basis cross product is NOT advertised.
    advertised = {(p.method, p.basis) for p in psi4.supported_method_basis_pairs}
    assert advertised == set(PAIRS)
    for method, basis in product(psi4.supported_methods, psi4.supported_basis_sets):
        # Psi4 requires its sealed SCF reference to be stated explicitly (never defaulted).
        candidate = spec("psi4", method, basis, scf={"reference": policy(method)["reference"]})
        assert accepted(config, candidate) == ((method, basis) in advertised), (method, basis)
    assert not accepted(config, spec("psi4", "hf", "sto-3g")), "implicit SCF reference accepted"


def test_state_dispersion_and_engine_restrictions_fail_closed():
    config = settings()
    d4 = {"identifier": "d4", "display_name": "D4", "registry": "chemdft.dispersion"}
    # Psi4 is restricted to neutral singlets; PySCF and xTB take explicit electronic state.
    rhf = {"scf": {"reference": "rhf"}}
    assert accepted(config, spec("psi4", "hf", "sto-3g", **rhf))
    assert not accepted(config, spec("psi4", "hf", "sto-3g", charge=1, **rhf))
    assert not accepted(config, spec("psi4", "hf", "sto-3g", multiplicity=3, **rhf))
    assert accepted(config, spec("pyscf", "hf", "sto-3g", charge=1, multiplicity=1))
    assert accepted(config, spec("pyscf", "hf", "sto-3g", charge=0, multiplicity=2))
    # No generic route may attach or hide a dispersion correction (no double counting).
    for engine, method, basis in (
        ("pyscf", "b3lyp", "def2-svp"),
        ("psi4", "b3lyp", "def2-svp"),
        ("xtb", "gfn2", None),
    ):
        assert not accepted(config, spec(engine, method, basis, dispersion=d4)), engine
    # CREST: GFN2 conformer search of neutral singlets only, never an ENERGY task.
    assert not accepted(config, spec("crest", "gfn2", None))
    assert not accepted(config, spec("crest", "gfn2", None, task_type="CONFORMER_SEARCH"))
    # DFT-D4 is a source-bound workflow, not an engine selectable by a generic specification.
    assert not accepted(config, spec("dftd4", "b3lyp", "def2-svp"))
    assert not accepted(config, spec("orca", "b3lyp", "def2-svp"))


@pytest.fixture
def project(api):
    client = api[0]
    return client.post(
        "/v1/projects", json={"name": "PF-8F semantics", "slug": f"pf8f-{uuid4()}"}
    ).json()["id"]


def test_dispersion_route_semantics_are_consistent(api, project):
    """422 = request semantically invalid; 404 = no such resource; 409 = resource of wrong kind."""
    client = api[0]
    missing = str(uuid4())
    # A source result that does not exist (or belongs elsewhere) is rejected identically.
    for call in (
        client.get(
            f"/v1/projects/{project}/dispersion-corrections/capability?source_result_id={missing}"
        ),
        client.post(
            f"/v1/projects/{project}/dispersion-corrections",
            json={"source_result_id": missing, "idempotency_key": str(uuid4())},
        ),
    ):
        assert call.status_code == 422, call.text
        assert "missing or unrelated project result" in call.text
    # Retry of a calculation that does not exist: 404.
    absent = client.post(
        f"/v1/projects/{project}/dispersion-corrections/{missing}/retry",
        json={"failed_attempt_id": str(uuid4())},
    )
    assert absent.status_code == 404, absent.text
    # Retry of an existing calculation that is not a D4 correction: 409 with a stable code.
    imported = client.post(
        f"/v1/projects/{project}/structures/imports",
        files={"upload": ("h2.xyz", b"2\nH2\nH 0 0 0\nH 0 0 0.74\n", "chemical/x-xyz")},
        data={"file_format": "XYZ", "idempotency_key": str(uuid4())},
    )
    assert imported.status_code == 201, imported.text
    queued = client.post(
        f"/v1/projects/{project}/calculations",
        json={
            "structure_version": {
                "project_id": project,
                "entity_type": "structure.version",
                "entity_id": imported.json()["version"]["id"],
            },
            "specification": spec("pyscf", "hf", "sto-3g").model_dump(mode="json"),
            "idempotency_key": str(uuid4()),
        },
    )
    assert queued.status_code == 201, queued.text
    wrong_kind = client.post(
        f"/v1/projects/{project}/dispersion-corrections/{queued.json()['calculation']['id']}/retry",
        json={"failed_attempt_id": str(uuid4())},
    )
    assert wrong_kind.status_code == 409, wrong_kind.text
    assert wrong_kind.json()["detail"]["code"] == "DFTD4_STATE_CONFLICT"


def test_pyscf_element_table_matches_the_pinned_library():
    """The static coverage table must equal what PySCF 2.14.0 actually ships (no ECP supplied)."""
    import json
    import subprocess

    from chemdft_api.scientific.engines.registry import PYSCF_MAX_ATOMIC_NUMBER

    code = (
        "import json;from pyscf import gto;from pyscf.data import elements as e;out={}\n"
        "for b in {BASES}:\n"
        "    ok=[]\n"
        "    for s in e.ELEMENTS[1:87]:\n"
        "        try: gto.basis.load(b,s); ok.append(e.charge(s))\n"
        "        except Exception: pass\n"
        "    out[b]=ok\n"
        "print(json.dumps(out))\n"
    ).replace("{BASES}", repr(tuple(PYSCF_MAX_ATOMIC_NUMBER)))
    completed = subprocess.run(
        [str(ROOT / "services/scientific-worker/.venv/bin/python"), "-B", "-c", code],
        capture_output=True,
        text=True,
        timeout=120,
        check=True,
        env={"PATH": "/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONNOUSERSITE": "1"},
    )
    shipped = json.loads(completed.stdout)
    for basis, limit in PYSCF_MAX_ATOMIC_NUMBER.items():
        covered = shipped[basis]
        # Contiguous from hydrogen through the limit, so "Z <= limit" is exact for this library.
        assert covered[:limit] == list(range(1, limit + 1)), basis
        if basis.startswith("def2"):
            assert limit == 36, "def2 bases need the def2-ECP above Z=36; the adapter supplies none"
        else:
            assert limit + 1 not in covered, basis


def _structure(api, project, symbols_and_z):
    client = api[0]
    lines = "\n".join(f"{s} 0 0 {z}" for s, z in symbols_and_z)
    xyz = (
        f"{len(symbols_and_z)}\nPF-8F element coverage | chemdft:charge=0;multiplicity=1\n{lines}\n"
    )
    response = client.post(
        f"/v1/projects/{project}/structures/imports",
        files={"upload": ("input.xyz", xyz.encode(), "chemical/x-xyz")},
        data={"file_format": "XYZ", "idempotency_key": str(uuid4())},
    )
    assert response.status_code == 201, response.text
    return response.json()["version"]


@pytest.mark.parametrize(
    "basis,elements,accepted_request",
    [
        ("def2-svp", [("Rb", 0.0), ("H", 2.4)], False),  # needs ECP; would be silently wrong
        ("def2-svpd", [("Rb", 0.0), ("H", 2.4)], False),
        ("6-31g", [("Br", 0.0), ("H", 1.4)], False),  # absent from PySCF's bundled 6-31G
        ("sto-3g", [("Xe", 0.0), ("Xe", 4.4)], False),  # beyond STO-3G coverage
        ("def2-svp", [("K", 0.0), ("H", 2.2)], True),
        ("sto-3g", [("I", 0.0), ("H", 1.6)], True),
    ],
)
def test_pyscf_unsupported_element_basis_combinations_are_rejected_before_queueing(
    api, project, basis, elements, accepted_request
):
    version = _structure(api, project, elements)
    response = api[0].post(
        f"/v1/projects/{project}/calculations",
        json={
            "structure_version": {
                "project_id": project,
                "entity_type": "structure.version",
                "entity_id": version["id"],
            },
            "specification": spec("pyscf", "hf", basis).model_dump(mode="json"),
            "idempotency_key": str(uuid4()),
        },
    )
    if accepted_request:
        assert response.status_code == 201, response.text
    else:
        assert response.status_code == 422, response.text
        assert "atomic number" in response.text
        # Nothing was created or queued for the rejected request.
        from chemdft_api.scientific_models import CalculationRecord, ComputeJobRecord
        from sqlalchemy import func, select

        with api[1]() as session:
            for model in (CalculationRecord, ComputeJobRecord):
                count = session.scalar(
                    select(func.count()).select_from(model).where(model.project_id == project)
                )
                assert count == 0, model.__name__
