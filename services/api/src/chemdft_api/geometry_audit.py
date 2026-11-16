"""Read-only identification of historical molecular geometry boundary failures."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from .geometry_eligibility import calculation_geometry_eligibility
from .scientific_models import StructureVersionRecord
from .storage import LocalObjectStore


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True, help="Existing SQLite database")
    parser.add_argument("--object-root", type=Path, required=True)
    args = parser.parse_args()
    database = args.database.resolve(strict=True)
    object_root = args.object_root.resolve(strict=True)
    if not object_root.is_dir():
        parser.error("--object-root must be an existing object storage directory")
    # SQLite enforces read-only access; no migrations, schema creation or repairs are run.
    engine = create_engine(f"sqlite:///file:{database}?mode=ro&uri=true")
    findings = []
    checked = 0
    with Session(engine) as session:
        for version in session.scalars(select(StructureVersionRecord)):
            if version.periodic_cell_json is not None:
                continue
            checked += 1
            eligibility = calculation_geometry_eligibility(
                session, LocalObjectStore(object_root), version
            )
            if not eligibility.eligible:
                findings.append(
                    {
                        "project_id": version.project_id,
                        "structure_id": version.structure_id,
                        **eligibility.model_dump(mode="json"),
                    }
                )
    engine.dispose()
    print(
        json.dumps(
            {"checked_versions": checked, "modified_records": 0, "ineligible_versions": findings},
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
