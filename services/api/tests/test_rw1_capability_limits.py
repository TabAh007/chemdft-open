"""RW-1: advisory element limits in the capability response must equal what validation enforces.

No calculation is executed; executables are only probed for identity.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from chemdft_api.config import Settings
from chemdft_api.errors import UnsupportedCalculation
from chemdft_api.scientific.engines.registry import (
    PYSCF_MAX_ATOMIC_NUMBER,
    capability_views,
    validate_pyscf_elements,
)

ROOT = Path(__file__).resolve().parents[3]
PSI4 = ROOT / ".chemdft/envs/psi4-1.11-py312-gate-a1-20261009/bin/psi4"


def views(config):
    return {view.engine: view for view in capability_views(config)}


def test_unavailable_engines_advertise_no_limits(tmp_path):
    missing = tmp_path / "absent"
    config = Settings(
        scientific_worker_python=missing / "python",
        xtb_executable=missing / "xtb",
        crest_executable=missing / "crest",
        psi4_executable=missing / "psi4",
    )
    for view in capability_views(config):
        assert view.max_atomic_number_by_basis == {}, view.engine


def test_only_an_available_pyscf_advertises_limits_and_they_match_enforcement():
    all_views = views(Settings(psi4_executable=PSI4))
    pyscf = all_views["pyscf"]
    for name, view in all_views.items():
        if name != "pyscf":
            assert view.max_atomic_number_by_basis == {}, name
    if pyscf.availability != "AVAILABLE":
        pytest.skip("PySCF worker is not available in this environment")
    limits = pyscf.max_atomic_number_by_basis
    assert limits == dict(PYSCF_MAX_ATOMIC_NUMBER)
    # Every advertised basis carries a limit, so a client can never treat a basis as unbounded.
    assert set(pyscf.supported_basis_sets) <= set(limits)
    for basis, limit in limits.items():
        validate_pyscf_elements(basis, [1, limit])  # the advertised limit itself is accepted
        with pytest.raises(UnsupportedCalculation):
            validate_pyscf_elements(basis, [1, limit + 1])  # one beyond is rejected before queueing


def test_field_is_additive_in_the_serialized_contract():
    payload = views(Settings(psi4_executable=PSI4))["xtb"].model_dump(mode="json")
    assert payload["max_atomic_number_by_basis"] == {}
    # Existing fields are unchanged.
    existing = {"engine", "availability", "supported_tasks", "supported_method_basis_pairs"}
    assert existing <= set(payload)
