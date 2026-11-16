"""Skip a test ONLY when the native engine binary or the retained evidence file it reads is absent.

Where the engine or evidence exists (the owner's development checkout) the tests run unchanged. A fresh clone or the public
export has neither, and a test that needs a real engine must say so instead of failing. Every skip names the missing path.
"""

from __future__ import annotations

from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]

REQUIRED_PATHS: dict[str, tuple[str, str]] = {
    "worker": ("services/scientific-worker/.venv/bin/python", "PySCF scientific-worker environment is not installed"),
    "xtb": (".chemdft/envs/xtb/bin/xtb", "xTB 6.7.1 native binary is not installed"),
    "crest": (".chemdft/envs/crest-3.0.2-ewinfix-a1/bin/crest-pf8c-ewinfix", "the patched CREST 3.0.2 binary is not installed"),
    "psi4": (".chemdft/envs/psi4-1.11-py312-gate-a1-20261009/bin/psi4", "the accepted Psi4 1.11 CLI is not installed"),
    "d4_evidence": ("output/pf8e-trusted-integration-20261011/b3lyp/calculation-detail.json", "retained DFT-D4 acceptance evidence is absent"),
    "crest_evidence": (".chemdft/pf8c-gate-b/native-acceptance/butane-three-member-run/manifest.json", "retained CREST acceptance evidence is absent"),
    "qe_lock": ("infra/aws/ec2-pilot/qe-recipe.lock", "infra/aws QE image lock is not part of this checkout"),
    "d4_lock": ("infra/aws/ec2-pilot/d4-conda.lock", "infra/aws DFT-D4 conda lock is not part of this checkout"),
    "brand": ("services/api/src/chemdft_api/assets/brand/logo-horizontal-light.svg", "brand artwork is not licensed for the public export"),
}

# test file -> {requirement keys (all needed): test function names (parametrisation ignored)}
TESTS: dict[str, list[tuple[tuple[str, ...], tuple[str, ...]]]] = {
    "test_crest_integration.py": [(("crest",), (
        "test_actual_native_termination", "test_genuine_sorting_completion_is_not_search_completion",
        "test_internal_window_changes_are_not_final_authorization", "test_issue494_compares_only_compatible_protocols",
        "test_live_resource_limits_do_not_accept_truncated_evidence", "test_native_evidence_corruption_fails_closed",
        "test_outer_restart_fails_closed_pending_native_restart_acceptance", "test_unmodified_crest_installation_cannot_be_selected"))],
    "test_xtb_optimization.py": [(("xtb",), (
        "test_native_evidence_rejects_corruption_and_crashes", "test_native_maxcycle_one_never_publishes_convergence",
        "test_native_real_molecular_optimization", "test_runner_preserves_complete_native_samples_from_truncated_failed_execution"))],
    "test_optimization_integration.py": [(("worker",), (
        "test_queued_optimization_cancellation_publishes_no_final_version",
        "test_real_h2_optimization_persists_trajectory_and_publishes_version",
        "test_real_max_step_nonconvergence_retains_steps_without_final_version"))],
    "test_pf8b2_post_audit.py": [(("worker",), (
        "test_pyscf_optimization_requires_explicit_producer", "test_real_pyscf_cancellation_has_no_late_publication_or_orphans"))],
    "test_pf8f_optimization_publication.py": [(("worker",), (
        "test_cancel_requested_before_publication_finalizes_canceled_without_result",
        "test_firewall_rejected_optimization_ends_failed_without_half_published_state",
        "test_lease_lost_between_evidence_commit_and_publication_is_fenced",
        "test_stale_worker_cannot_publish_or_overwrite_recovered_optimization",
        "test_unexpected_publication_errors_are_not_swallowed_as_scientific_rejection",
        "test_valid_optimization_still_publishes_atomically"))],
    "test_thermochemistry.py": [(("worker",), (
        "test_firewall_rejects_tampered_thermochemistry_publication", "test_gate_rejects_any_imaginary_mode_before_calling_pyscf",
        "test_gate_rejects_geometry_that_is_not_a_chemdft_optimization", "test_gate_rejects_missing_electronic_energy_artifact",
        "test_gate_rejects_non_stationary_gradient", "test_pyscf_point_group_lookup_is_too_strict_but_chemdft_is_not",
        "test_requests_with_invalid_temperature_or_pressure_are_rejected",
        "test_temperature_pressure_change_reuses_persisted_data_without_scf_or_hessian",
        "test_thermochemistry_cannot_request_new_electronic_structure_work", "test_unknown_source_or_wrong_structure_is_rejected",
        "test_water_optimized_chain_publishes_authoritative_thermochemistry"))],
    "test_pf8f_capability_conformance.py": [(("worker", "xtb", "psi4"), (
        "test_every_advertised_energy_combination_validates_and_nothing_else_does",
        "test_pyscf_element_table_matches_the_pinned_library", "test_state_dispersion_and_engine_restrictions_fail_closed"))],
    "test_dftd4_acceptance_repair.py": [(("d4_evidence",), ("test_legacy_d4_payload_round_trips_without_changing_hash",))],
    "test_pf8c_b1_post_audit.py": [(("crest_evidence",), ("test_member_qualification_preserves_native_science_and_legacy_records",))],
    "test_qe_periodic_integration.py": [(("qe_lock",), ("test_image_recipe_matches_the_element_table_and_the_pinned_hashes",))],
    "test_dftd4_linux_identity.py": [(("d4_lock",), ("test_linux_pins_use_the_same_parameter_table_and_match_the_locked_package",))],
    "test_export_presentation_0024.py": [(("brand",), ("test_html_has_inline_logo_favicon_and_release_and_is_offline",))],
    "test_project_export.py": [(("brand",), ("test_project_exports_suite",))],
}


def missing_requirement(item: pytest.Item) -> str | None:
    """The skip reason for this test, or None when everything it needs is present (or it needs nothing)."""
    entries = TESTS.get(Path(str(item.fspath)).name)
    if not entries:
        return None
    name = getattr(item, "originalname", None) or item.name
    for keys, names in entries:
        if name not in names:
            continue
        for key in keys:
            relative, why = REQUIRED_PATHS[key]
            if not (ROOT / relative).exists():
                return f"{why} (missing {relative})"
    return None
