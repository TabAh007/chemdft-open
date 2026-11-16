"""Linux x86_64 pins for the DFT-D4 CLI (offline: no engine runs)."""


def test_linux_pins_use_the_same_parameter_table_and_match_the_locked_package():
    from pathlib import Path

    from chemdft_api.scientific.engines import dftd4

    assert dftd4.LINUX_PIN["share/dftd4/parameters.toml"] == dftd4.TABLE_SHA256
    lock = Path(dftd4.__file__).parents[6].joinpath("infra/aws/ec2-pilot/d4-conda.lock").read_text()
    assert f"# sha256 {dftd4.LINUX_PACKAGE_SHA256} dftd4 4.2.0 gfortran_ha02e54d_1" in lock
    assert set(dftd4.LINUX_RUNTIME_LIBRARIES) >= {"lib/libdftd4.so.4.2.0", "lib/libmctc-lib.so.0"}


def test_linux_identity_rejects_a_prefix_whose_binary_differs(tmp_path, monkeypatch):
    import pytest
    from chemdft_api.scientific.engines import dftd4

    monkeypatch.setattr(dftd4.sys, "platform", "linux")
    for relative in dftd4.LINUX_PIN:
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"not the pinned bytes")
    with pytest.raises(ValueError, match="pinned executable/library/table differs"):
        dftd4.environment_identity(tmp_path / "bin/dftd4")
