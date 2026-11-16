"""Read-only benchmark fixture export; never generates or modifies scientific fields."""

import hashlib
import json
import sqlite3
from pathlib import Path

import numpy as np

PROJECT = "f39aefcf-a1cd-4606-8f03-f9b18eadb96d"
connection = sqlite3.connect("file:.chemdft/chemdft.db?mode=ro", uri=True)
connection.row_factory = sqlite3.Row
fields, chosen = {}, []
results = connection.execute(
    "select id, payload_json from calculation_results where project_id=? order by id",
    (PROJECT,),
).fetchall()
assert len(results) == 1, "Acceptance requires the existing single water result"
result_id = results[0]["id"]
result = json.loads(results[0]["payload_json"])
frontier = result["frontier_by_spin"][0]
for row in connection.execute(
    "select * from scientific_artifacts where project_id=? and kind='VOLUMETRIC_GRID' order by id",
    (PROJECT,),
):
    path = Path(".chemdft/objects") / row["storage_key"]
    assert hashlib.sha256(path.read_bytes()).hexdigest() == row["sha256"]
    with np.load(path, allow_pickle=False) as artifact:
        manifest = json.loads(str(artifact["manifest_json"][0]))
        if manifest["grid_profile"] != "STANDARD" or manifest["calculation_result_id"] != result_id:
            continue
        kind, index = manifest["field_quantity"], manifest.get("orbital_index")
        label = (
            "HOMO"
            if kind == "MO_AMPLITUDE" and index == frontier["homo_index"]
            else "LUMO"
            if kind == "MO_AMPLITUDE" and index == frontier["lumo_index"]
            else kind
            if kind != "MO_AMPLITUDE"
            else None
        )
        if label:
            assert label not in fields, "Ambiguous saved benchmark artifact"
            fields[label] = {
                "manifest": manifest,
                "field_values": artifact["field_values"].ravel(order="C").tolist(),
            }
            chosen.append(
                {
                    "label": label,
                    "artifact_id": row["id"],
                    "sha256": row["sha256"],
                    "grid_sha256": manifest["grid_sha256"],
                }
            )
version = connection.execute(
    "select representation_json from structure_versions where id=?",
    (result["input_structure_version_id"],),
).fetchone()
assert set(fields) == {"HOMO", "LUMO", "ELECTRON_DENSITY", "ELECTROSTATIC_POTENTIAL"}
Path("tools/renderer-benchmark/data").mkdir(exist_ok=True)
Path("tools/renderer-benchmark/data/fields.json").write_text(
    json.dumps(
        {
            "fields": fields,
            "structure": json.loads(version[0]),
        },
        separators=(",", ":"),
    )
)
Path("output/foundation-ux/benchmark-inputs.json").write_text(json.dumps(chosen, indent=2))
print("Copied four exact, hash-checked saved grids; no engine execution.")
