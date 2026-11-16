"""Tests for Periodic Calculation Proposal Settings and Provenance (Release 0.0.60, Part 2)."""

from __future__ import annotations

import pytest
from chemdft_api.ai.periodic_proposal import (
    PeriodicProposalRefusalError,
    resolve_periodic_proposal_settings,
)


def test_copy_from_last_succeeded_periodic_calculation_with_provenance() -> None:
    previous_calculations = [
        {
            "id": "calc-failed-001",
            "state": "FAILED",
            "is_periodic": True,
            "specification": {"task_type": "energy"},
        },
        {
            "id": "calc-succeeded-002",
            "state": "SUCCEEDED",
            "is_periodic": True,
            "engine": "quantum_espresso",
            "specification": {
                "task_type": "energy",
                "method": {"display_name": "PBE+U"},
                "basis": {"display_name": "SSSP_PBE_PRECISION"},
                "periodic": {
                    "k_mesh": [4, 4, 4],
                    "ecutwfc_ry": 60.0,
                    "ecutrho_ry": 480.0,
                    "hubbard_u": {"Cr": 3.5},
                    "magnetic_ordering": "AFM",
                    "spin_polarized": True,
                },
            },
        },
        {
            "id": "calc-succeeded-old-003",
            "state": "SUCCEEDED",
            "is_periodic": True,
            "engine": "quantum_espresso",
            "specification": {"task_type": "energy", "method": {"display_name": "LDA"}},
        },
    ]

    settings = resolve_periodic_proposal_settings(
        is_periodic_structure=True,
        user_input_settings=None,
        previous_calculations=previous_calculations,
    )

    assert settings.source_calculation_id == "calc-succeeded-002"
    assert "copied from calculation calc-succeeded-002" in settings.provenance_note
    assert settings.functional == "PBE+U"
    assert settings.k_mesh == (4, 4, 4)
    assert settings.hubbard_u == {"Cr": 3.5}
    assert settings.ecutwfc_ry == 60.0
    assert settings.magnetic_ordering == "AFM"
    assert settings.spin_polarized is True


def test_refusal_when_no_succeeded_calculation_and_no_user_input() -> None:
    previous_calculations = [
        {"id": "calc-failed-1", "state": "FAILED", "is_periodic": True},
        {"id": "calc-canceled-2", "state": "CANCELED", "is_periodic": True},
    ]

    with pytest.raises(PeriodicProposalRefusalError, match="No previous succeeded periodic calculation"):
        resolve_periodic_proposal_settings(
            is_periodic_structure=True,
            user_input_settings={},
            previous_calculations=previous_calculations,
        )


def test_refusal_when_structure_is_molecular() -> None:
    with pytest.raises(PeriodicProposalRefusalError, match="only available for periodic crystal structures"):
        resolve_periodic_proposal_settings(
            is_periodic_structure=False,
            user_input_settings={"functional": "PBE"},
            previous_calculations=None,
        )


def test_refusal_to_invent_hubbard_u_or_kmesh_when_omitted_by_user() -> None:
    # User specifies functional, but does NOT specify Hubbard U, k-mesh, or magnetic ordering
    user_input = {
        "functional": "PBE",
    }
    settings = resolve_periodic_proposal_settings(
        is_periodic_structure=True,
        user_input_settings=user_input,
        previous_calculations=None,
    )

    # Must NOT invent Hubbard U, k-mesh, cutoffs, or magnetic ordering
    assert settings.functional == "PBE"
    assert settings.k_mesh is None
    assert settings.hubbard_u is None
    assert settings.magnetic_ordering is None
    assert settings.ecutwfc_ry is None
    assert settings.provenance_note == "specified by researcher in chat"
