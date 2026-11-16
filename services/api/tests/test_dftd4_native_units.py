"""Native coordinate-unit equivalence, without changing legacy normalizer constants."""

import gzip
import json
import os
import re
import struct
import subprocess
from pathlib import Path

import pytest
from chemdft_api.scientific.engines.dftd4 import (
    NATIVE_ANGSTROM_TO_BOHR,
    PARAMETERS,
    command,
    digest,
    encode,
    environment_identity,
    native_environment,
    parse_evidence,
)

ROOT = Path(__file__).resolve().parents[3]
PREFIX = ROOT / ".chemdft/envs/dftd4-4.2.0-pf8e"
pytestmark = pytest.mark.skipif(
    os.environ.get("CHEMDFT_RUN_DFTD4_NATIVE") != "1", reason="isolated native opt-in required"
)


@pytest.mark.parametrize("method", ["b3lyp", "pbe"])
def test_native_angstrom_bohr_geometry_equivalence(tmp_path, method):
    module = PREFIX / "include/mctc-lib/modules/mctc_io_convert.mod"
    module_bytes = module.read_bytes()
    assert (
        digest(module_bytes) == "4d9a315b0129e83bc33a17727532b485abbfd15b4146c54f20b7af21d1e55e0b"
    )
    definition = gzip.decompress(module_bytes).decode()
    # gfortran module constants use base 16 with @ marking a base-16 exponent.
    token = re.search(
        r"'aatoau'.*?CONSTANT \(REAL 8 0 0 0 REAL \(\)\) 0 '([^']+)'", definition, re.S
    )
    assert token, definition[definition.find("'aatoau'") :][:250]
    mantissa, exponent = token[1].split("@")
    established = float.fromhex("0x" + mantissa + "p" + str(4 * int(exponent)))
    assert established == NATIVE_ANGSTROM_TO_BOHR
    assert struct.pack("<d", established) in (PREFIX / "lib/libmctc-lib.0.dylib").read_bytes()
    identity = environment_identity(PREFIX / "bin/dftd4")
    xyz = (ROOT / ".chemdft/pf8e-foundation-20261011/scratch/ethane.xyz").read_bytes()
    atoms = [
        (line.split()[0], [float(x) for x in line.split()[1:]])
        for line in xyz.decode().splitlines()[2:]
    ]
    results = {}
    for unit, filename in (("angstrom", "input.xyz"), ("bohr", "input.coord")):
        root = tmp_path / unit
        root.mkdir()
        data = (
            xyz
            if unit == "angstrom"
            else (
                "$coord\n"
                + "\n".join(
                    " ".join(format(x * established, ".17g") for x in coords)
                    + " "
                    + element.lower()
                    for element, coords in atoms
                )
                + "\n$end\n"
            ).encode()
        )
        (root / filename).write_bytes(data)
        argv = command(PREFIX / "bin/dftd4", method, PARAMETERS[method])
        argv[-1] = filename
        completed = subprocess.run(
            argv,
            cwd=root,
            env=native_environment(PREFIX / "bin/dftd4", root),
            capture_output=True,
            timeout=15,
            check=True,
        )
        output = (root / "dftd4.json").read_bytes()
        results[unit] = {
            "energy_Eh": json.loads(output)["energy"],
            "argv": argv,
            "input_sha256": digest(data),
            "output_sha256": digest(output),
        }
        target = os.environ.get("CHEMDFT_DFTD4_REPAIR_OUTPUT")
        if target:
            out = Path(target) / "native-units" / method / unit
            out.mkdir(parents=True, exist_ok=True)
            (out / filename).write_bytes(data)
            (out / "dftd4.json").write_bytes(output)
            (out / "stdout.txt").write_bytes(completed.stdout)
            (out / "stderr.txt").write_bytes(completed.stderr)
    # Predetermined equivalent-geometry tolerance, below the regression energy tolerance.
    residual = abs(results["angstrom"]["energy_Eh"] - results["bohr"]["energy_Eh"])
    assert residual <= 1e-14
    if target:
        (Path(target) / "native-units" / method / "comparison.json").write_bytes(
            encode(
                {
                    "native_angstrom_to_bohr": established,
                    "definition": "mctc-lib.0.5.2.aatoau",
                    "module_sha256": digest(module_bytes),
                    "runtime_identity": identity,
                    "results": results,
                    "absolute_difference_Eh": residual,
                    "tolerance_Eh": 1e-14,
                }
            )
        )


def test_stdout_functional_mismatch_is_rejected_even_with_coherent_hashes():
    historical = ROOT / "output/pf8e-trusted-integration-20261011/b3lyp"
    document = json.loads((historical / "chemdft.dftd4.input.evidence").read_bytes())
    raw = {
        p.name.removeprefix("dftd4.native.").removesuffix(".evidence"): p.read_bytes()
        for p in historical.glob("dftd4.native.*.evidence")
    }
    raw["stdout.txt"] = raw["stdout.txt"].replace(b"b3lyp-D4-ATM", b"pbe-D4-ATM")
    raw["hashes.json"] = encode({n: digest(b) for n, b in raw.items() if n != "hashes.json"})
    with pytest.raises(ValueError, match="functional"):
        parse_evidence(raw, document)
