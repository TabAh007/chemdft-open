"""Guard tests verifying all Playwright specs are in an isolated-runner suite or explicitly excluded."""

import importlib.util
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "services/api/src"))
sys.path.insert(0, str(ROOT / "tools"))


def load_runner_module():
    spec = importlib.util.spec_from_file_location(
        "run_isolated_e2e", ROOT / "tools/run_isolated_e2e.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def get_playwright_suites() -> dict[str, str]:
    config_path = ROOT / "apps/web/playwright.isolated.config.ts"
    text = config_path.read_text(encoding="utf-8")
    match = re.search(r"const suites: Record<string, string> = \{([^}]+)\};", text)
    assert match, "Could not locate suites definition in playwright.isolated.config.ts"
    suites_block = match.group(1)
    return dict(
        re.findall(
            r'["\']?([a-zA-Z0-9_\-]+)["\']?:\s*["\']([^"\']+\.spec\.ts)["\']',
            suites_block,
        )
    )


def get_all_playwright_specs() -> set[str]:
    tests_root = ROOT / "apps/web/tests"
    return {
        str(f.relative_to(tests_root))
        for f in tests_root.glob("**/*.spec.ts")
    }


def test_every_spec_has_suite_or_explicit_exclusion():
    runner = load_runner_module()
    all_specs = get_all_playwright_specs()
    suites = get_playwright_suites()
    suite_specs = set(suites.values())
    excluded_specs = set(runner.EXCLUDED_SPECS.keys())

    # Every spec must exist in either a suite or the excluded manifest
    unmapped = sorted(all_specs - suite_specs - excluded_specs)
    assert not unmapped, (
        f"Found {len(unmapped)} Playwright spec(s) neither mapped to an isolated suite nor "
        f"explicitly excluded: {unmapped}"
    )


def test_no_spec_is_both_in_suite_and_excluded():
    runner = load_runner_module()
    suites = get_playwright_suites()
    suite_specs = set(suites.values())
    excluded_specs = set(runner.EXCLUDED_SPECS.keys())

    overlapping = sorted(suite_specs & excluded_specs)
    assert not overlapping, (
        f"Found {len(overlapping)} spec(s) that are both mapped to a suite and marked excluded: "
        f"{overlapping}"
    )


def test_every_exclusion_has_non_empty_reason():
    runner = load_runner_module()
    empty_reasons = [
        spec
        for spec, reason in runner.EXCLUDED_SPECS.items()
        if not reason or not reason.strip()
    ]
    assert not empty_reasons, (
        f"The following excluded spec(s) have an empty or whitespace-only reason: {empty_reasons}"
    )


def test_all_configured_specs_exist_on_disk():
    runner = load_runner_module()
    tests_root = ROOT / "apps/web/tests"
    suites = get_playwright_suites()

    # Every suite spec must exist
    for suite_name, spec_rel in suites.items():
        spec_path = tests_root / spec_rel
        assert spec_path.is_file(), (
            f"Suite '{suite_name}' references non-existent spec file: {spec_rel}"
        )

    # Every excluded spec must exist
    for spec_rel in runner.EXCLUDED_SPECS:
        spec_path = tests_root / spec_rel
        assert spec_path.is_file(), (
            f"Excluded manifest references non-existent spec file: {spec_rel}"
        )


def test_all_suites_registered_in_runner_cli():
    runner = load_runner_module()
    suites = get_playwright_suites()
    parser = runner.build_parser()
    suite_action = next(a for a in parser._actions if a.dest == "suite")
    registered_choices = set(suite_action.choices)

    # Every suite configured in playwright.isolated.config.ts must be registered in the runner CLI
    unregistered = sorted(set(suites.keys()) - registered_choices)
    assert not unregistered, (
        f"The following suite(s) from playwright.isolated.config.ts are not registered in the runner CLI: "
        f"{unregistered}"
    )

    # Every choice in the runner CLI must exist in playwright.isolated.config.ts
    extra_choices = sorted(registered_choices - set(suites.keys()))
    assert not extra_choices, (
        f"The runner CLI exposes suite choice(s) not defined in playwright.isolated.config.ts: "
        f"{extra_choices}"
    )

