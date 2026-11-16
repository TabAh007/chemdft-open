"""Compare the acceptance snapshot with read-only persisted scientific records."""

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--baseline", required=True, type=Path)
parser.add_argument("--project", required=True)
parser.add_argument("--output", required=True, type=Path)
args = parser.parse_args()
before = json.loads(args.baseline.read_text())
connection = sqlite3.connect("file:.chemdft/chemdft.db?mode=ro", uri=True)
connection.row_factory = sqlite3.Row
report = {"project_id": args.project, "read_only": True, "tables": {}}
for table, expected in before.items():
    if table == "artifact_bytes":
        continue
    # Table names come only from the previously captured local schema snapshot.
    assert table.replace("_", "").isalnum()
    actual = [
        dict(row)
        for row in connection.execute(
            f'SELECT * FROM "{table}" WHERE project_id=? ORDER BY id', (args.project,)
        )
    ]
    if table in {"audit_events", "tool_invocations"}:
        original = {row["id"]: row for row in expected}
        assert all(
            next(item for item in actual if item["id"] == key) == row
            for key, row in original.items()
        )
        additions = [item for item in actual if item["id"] not in original]
        # Only normal AI audit activity may be appended by the requested question.
        assert all(
            item.get("tool_name") == "knowledge.search"
            or item.get("event_name", "").startswith("ai.")
            for item in additions
        )
        report["tables"][table] = {"existing_unchanged": True, "appended_ai_rows": len(additions)}
    else:
        assert actual == expected, f"Scientific records changed: {table}"
        report["tables"][table] = {"unchanged": True, "count": len(actual)}
artifacts = connection.execute(
    "SELECT id, storage_key, sha256 FROM scientific_artifacts WHERE project_id=?", (args.project,)
).fetchall()
actual_hashes = {
    row["id"]: hashlib.sha256(
        (Path(".chemdft/objects") / row["storage_key"]).read_bytes()
    ).hexdigest()
    for row in artifacts
}
assert actual_hashes == before["artifact_bytes"], "Scientific artifact bytes changed"
assert all(actual_hashes[row["id"]] == row["sha256"] for row in artifacts)
report["artifact_bytes"] = {
    "unchanged": True,
    "count": len(actual_hashes),
    "sha256_by_id": actual_hashes,
}
args.output.write_text(json.dumps(report, indent=2))
print(
    f"Unchanged: {len(artifacts)} artifact files and {len(report['tables'])} project tables; "
    "no calculation or field regeneration."
)
