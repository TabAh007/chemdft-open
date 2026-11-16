from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
API_SOURCE = REPOSITORY_ROOT / "services/api/src/chemdft_api"


def _source_files(directory: Path):
    return tuple(path for path in directory.rglob("*.py") if "__pycache__" not in path.parts)


def test_domain_contracts_are_framework_provider_and_engine_independent() -> None:
    forbidden = (
        "fastapi",
        "sqlalchemy",
        "react",
        "blueprint",
        "pyscf",
        "psi4",
        "qcengine",
        "modal",
        "runpod",
        "openai",
    )
    source = "\n".join(path.read_text().lower() for path in _source_files(API_SOURCE / "contracts"))
    for dependency in forbidden:
        assert f"import {dependency}" not in source
        assert f"from {dependency}" not in source


def test_application_and_registry_boundaries_do_not_depend_on_fastapi() -> None:
    files = [
        API_SOURCE / "scientific_actions.py",
        API_SOURCE / "scientific_models.py",
        *_source_files(API_SOURCE / "tool_registry"),
    ]
    source = "\n".join(path.read_text().lower() for path in files)
    assert "fastapi" not in source
    assert "httpexception" not in source


def test_core_api_does_not_install_native_scientific_engines_or_ai_sdks() -> None:
    manifests = "\n".join(
        [
            (REPOSITORY_ROOT / "services/api/pyproject.toml").read_text().lower(),
            (REPOSITORY_ROOT / "package.json").read_text().lower(),
        ]
    )
    forbidden = (
        '"pyscf',
        '"psi4',
        '"qcengine',
        '"xtb',
        '"openai',
        '"stripe',
        '"@ai-sdk',
    )
    for dependency in forbidden:
        assert dependency not in manifests


def test_engine_imports_are_isolated_from_routes_domain_and_firewall() -> None:
    inspected = [
        API_SOURCE / "main.py",
        API_SOURCE / "scientific_actions.py",
        API_SOURCE / "contracts/scientific.py",
    ]
    source = "\n".join(path.read_text().lower() for path in inspected)
    for engine in ("pyscf", "psi4", "xtb", "crest"):
        assert f"import {engine}" not in source
        assert f"from {engine}" not in source

    worker = API_SOURCE / "scientific/engines/pyscf_worker.py"
    assert "from pyscf" in worker.read_text()


def test_authoritative_contracts_have_no_unbounded_any_metadata_escape_hatch() -> None:
    source = "\n".join(path.read_text() for path in _source_files(API_SOURCE / "contracts"))
    assert "dict[str, Any]" not in source
    assert "metadata: dict" not in source
