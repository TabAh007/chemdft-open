"""A disposable ChemDFT environment rebuilt offline from the frozen supplied-H2 bytes.

Shared by the production replay (replay.py) and the production-flow harness (flow.py). A replica
is a temporary SQLite database, an object store, development-identity settings with the local
fake provider, and any number of projects that each hold the same supplied H2 structure, imported
through the real import actions. Nothing here touches the network, a credential, the repository's
own database or a scientific engine, and `close()` removes everything it created.
"""

from __future__ import annotations

import io
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from .capture_fixture import XYZ


@dataclass(frozen=True)
class ReplicaProject:
    project_id: str
    version_id: str
    structure_id: str


class Replica:
    def __init__(self, work, engine, sessions, store, settings, identity) -> None:
        self.work = work
        self.engine = engine
        self.sessions = sessions
        self.store = store
        self.settings = settings
        self.identity = identity
        self._closed = False

    @classmethod
    def build(cls) -> Replica:
        import chemdft_api.main  # noqa: F401  (registers every model table on the declarative Base)
        from chemdft_api.auth import ensure_dev_identity
        from chemdft_api.config import Settings
        from chemdft_api.context import Identity
        from chemdft_api.database import Base
        from chemdft_api.storage import LocalObjectStore
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker

        work = Path(tempfile.mkdtemp(prefix="chemdft-probe-replica-"))
        engine = None
        try:
            settings = Settings(
                _env_file=None,
                ai_provider="fake",
                ai_api_key=None,
                run_ai_integration=False,
                database_url=f"sqlite:///{work / 'replica.db'}",
                object_root=work / "objects",
                auto_create_schema=True,
                dev_identity_enabled=True,
            )
            engine = create_engine(settings.database_url, connect_args={"check_same_thread": False})
            Base.metadata.create_all(engine)
            sessions = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
            with sessions() as session:
                ensure_dev_identity(session, settings)
            identity = Identity(
                user_id=settings.dev_user_id, organization_id=settings.dev_organization_id
            )
            return cls(
                work, engine, sessions, LocalObjectStore(settings.object_root), settings, identity
            )
        except BaseException:
            if engine is not None:
                engine.dispose()
            shutil.rmtree(work, ignore_errors=True)
            raise

    def new_project(self, molecule=None) -> ReplicaProject:
        """A fresh project holding one structure, imported through the real actions.

        Without an argument it is the frozen supplied H2 (the probe fixture); with a
        ReferenceMolecule (tools/nvidia_probe/molecules.py) it is that molecule's unmodified source
        bytes, imported in the format the source is in.
        """
        data = XYZ if molecule is None else molecule.data()
        filename = "h2.xyz" if molecule is None else molecule.file
        media_type = "chemical/x-xyz" if molecule is None else molecule.media_type
        format_identifier = "XYZ" if molecule is None else molecule.format
        structure_name = None if molecule is None else molecule.structure_name
        from chemdft_api.actions import create_project, register_raw_file
        from chemdft_api.contracts.artifacts import (
            ScientificArtifactKind,
            ScientificArtifactRegistration,
        )
        from chemdft_api.contracts.base import ArtifactReference
        from chemdft_api.contracts.catalog import StructureImportInput
        from chemdft_api.schemas import ProjectCreate
        from chemdft_api.scientific_actions import import_structure, register_scientific_artifact

        with self.sessions() as session:
            project = create_project(
                session,
                self.identity,
                ProjectCreate(name="probe replica", slug=f"replica-{uuid4().hex[:8]}"),
            )
            stored = register_raw_file(
                session=session,
                identity=self.identity,
                object_store=self.store,
                project_id=str(project.id),
                original_name=filename,
                media_type=media_type,
                stream=io.BytesIO(data),
                max_upload_bytes=self.settings.max_upload_bytes,
            )
            artifact = register_scientific_artifact(
                session,
                self.identity,
                ScientificArtifactRegistration(
                    project_id=stored.project_id,
                    stored_file_id=stored.id,
                    kind=ScientificArtifactKind.STRUCTURE_FILE,
                    format_identifier=format_identifier,
                ),
            )
            imported = import_structure(
                session,
                self.identity,
                self.store,
                StructureImportInput(
                    project_id=stored.project_id,
                    source_artifact=ArtifactReference(
                        project_id=artifact.project_id,
                        artifact_id=artifact.id,
                        sha256=artifact.sha256,
                    ),
                    requested_format=format_identifier,
                    structure_name=structure_name,
                    selection_index=0,
                    idempotency_key=f"replica-import-{uuid4()}",
                ),
            )
            return ReplicaProject(
                str(project.id), str(imported.version.id), str(imported.version.structure_id)
            )

    def close(self) -> None:
        if not self._closed:
            self._closed = True
            self.engine.dispose()
            shutil.rmtree(self.work, ignore_errors=True)
