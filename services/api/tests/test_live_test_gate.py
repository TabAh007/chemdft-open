"""Live provider tests are never activated by ambient credentials, dotenv files or markers."""

import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
LIVE_FILE = ROOT / "services/api/tests/test_ai_provider_integration.py"
FAKE_SECRET = "offline-sentinel-not-a-credential"


def run_pytest(tmp_path, *args, extra_env=None):
    (tmp_path / ".env").write_text(
        f"CHEMDFT_AI_PROVIDER=nvidia\nCHEMDFT_AI_API_KEY={FAKE_SECRET}\n"
        "CHEMDFT_RUN_AI_INTEGRATION=true\n"
    )
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(("CHEMDFT_AI", "CHEMDFT_RUN_AI", "CHEMDFT_LIVE"))
    }
    env.update(
        CHEMDFT_AI_API_KEY=FAKE_SECRET,
        CHEMDFT_RUN_AI_INTEGRATION="true",
        CHEMDFT_AI_PROVIDER="nvidia",
        PYTHONDONTWRITEBYTECODE="1",
    )
    env.update(extra_env or {})
    return subprocess.run(
        [
            sys.executable,
            "-B",
            "-m",
            "pytest",
            "-p",
            "no:cacheprovider",
            "-W",
            "ignore",
            "-c",
            str(ROOT / "pyproject.toml"),
            "--rootdir",
            str(ROOT),
            "-rs",
            str(LIVE_FILE),
            "-k",
            "real_ai_provider",
            *args,
        ],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=180,
    )


@pytest.mark.parametrize(
    "args, extra_env",
    [
        ((), None),  # default selection
        (("-m", "ai_integration"), None),  # explicitly selected markers
        (("-m", "ai_integration"), {"CHEMDFT_LIVE_AI_TESTS": "I-AUTHORIZE-LIVE-PROVIDER-CALLS"}),
    ],
)
def test_ambient_credentials_and_dotenv_never_unskip_live_provider_tests(tmp_path, args, extra_env):
    result = run_pytest(tmp_path, *args, extra_env=extra_env)
    output = result.stdout + result.stderr
    assert result.returncode == 0, output
    assert "2 skipped" in output and "passed" not in output and "failed" not in output, output
    assert "never run by pytest" in output
    assert FAKE_SECRET not in output


def test_conftest_scrubs_ambient_provider_settings_in_this_process():
    from chemdft_api.config import Settings

    assert os.environ.get("CHEMDFT_AI_API_KEY") is None
    assert os.environ["CHEMDFT_RUN_AI_INTEGRATION"] == "false"
    assert Settings.model_config["env_file"] is None
    assert Settings().ai_api_key is None and Settings().run_ai_integration is False


GATE_PLUGIN = """
def pytest_collection_finish(session):
    for item in session.items:
        skipped = any(True for _ in item.iter_markers("skip"))
        native = any(item.get_closest_marker(n) for n in ("scientific_integration", "benchmark"))
        live = bool(item.get_closest_marker("ai_integration"))
        print("ITEM", int(native), int(live), int(skipped), flush=True)
"""


def collect_only(tmp_path, files, *args, extra_env=None):
    """Collection only: the nested run never executes a test."""
    (tmp_path / "gatecheck.py").write_text(GATE_PLUGIN)
    # The offline sandbox variable is stripped here (collection only); the guard tests cover it.
    env = {
        k: v
        for k, v in os.environ.items()
        if not k.startswith(("CHEMDFT_AI", "CHEMDFT_RUN", "CHEMDFT_E2E_OFFLINE", "CHEMDFT_NATIVE"))
    }
    env["PYTHONPATH"] = str(tmp_path)
    env.update(extra_env or {})
    result = subprocess.run(
        [
            sys.executable,
            "-B",
            "-m",
            "pytest",
            "--collect-only",
            "-q",
            "-p",
            "gatecheck",
            "-p",
            "no:cacheprovider",
            "-W",
            "ignore",
            "-c",
            str(ROOT / "pyproject.toml"),
            "--rootdir",
            str(ROOT),
            *map(str, files),
            *args,
        ],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=180,
    )
    assert result.returncode in (0, 5), result.stdout + result.stderr  # 5: nothing selected
    return [
        tuple(map(int, line.split()[1:]))
        for line in result.stdout.splitlines()
        if line.startswith("ITEM")
    ]


NATIVE_FILES = (
    ROOT / "services/api/tests/test_psi4_integration.py",
    ROOT / "services/api/tests/test_pyscf_integration.py",
)


def test_native_scientific_tests_are_collected_but_skipped_unless_a_marker_selects_them(tmp_path):
    default = collect_only(tmp_path, NATIVE_FILES)
    native = [item for item in default if item[0]]
    assert len(native) > 20 and all(item[2] for item in native)  # every native test is skipped
    marker_only = collect_only(tmp_path, NATIVE_FILES, "-m", "scientific_integration")
    assert marker_only and all(
        item[2] for item in marker_only
    )  # a marker alone is not authorization
    selected = collect_only(
        tmp_path,
        NATIVE_FILES,
        "-m",
        "scientific_integration",
        extra_env={"CHEMDFT_NATIVE_TESTS": "I-AUTHORIZE-NATIVE-ENGINE-EXECUTION"},
    )
    assert selected and not any(item[2] for item in selected)  # marker plus typed authorization
    negated = collect_only(tmp_path, NATIVE_FILES, "-m", "not scientific_integration")
    assert negated == []  # nothing selected; nothing silently included


def test_marker_expression_matching_is_exact():
    from live_ai_gate import selected_by_marker_expression as selected

    assert selected("scientific_integration", "scientific_integration")
    assert selected("scientific_integration", "benchmark or scientific_integration")
    assert not selected("scientific_integration", "not scientific_integration")
    assert not selected("scientific_integration", "")
    assert not selected("scientific_integration", None)
    assert not selected("benchmark", "scientific_integration")
