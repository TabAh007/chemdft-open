"""Product template/copy lineage, separate from immutable scientific provenance."""

from datetime import datetime

from sqlalchemy import JSON, ForeignKey, ForeignKeyConstraint, String, event, inspect
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base
from .models import Project, ProjectKind, utc_now


class ExampleTemplate(Base):
    __tablename__ = "example_templates"
    __table_args__ = (
        ForeignKeyConstraint(
            ["structure_version_id", "project_id"],
            ["structure_versions.id", "structure_versions.project_id"],
        ),
    )
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), primary_key=True)
    slug: Mapped[str] = mapped_column(String(96), unique=True)
    version: Mapped[str] = mapped_column(String(32))
    structure_version_id: Mapped[str] = mapped_column(String(36))
    manifest_sha256: Mapped[str] = mapped_column(String(64))
    content_sha256: Mapped[str] = mapped_column(String(64))
    sealed: Mapped[bool] = mapped_column(default=True)
    published: Mapped[bool] = mapped_column(default=False, server_default="false")


class ProjectExampleOrigin(Base):
    __tablename__ = "project_example_origins"
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), primary_key=True)
    template_project_id: Mapped[str] = mapped_column(ForeignKey("example_templates.project_id"))
    template_version: Mapped[str] = mapped_column(String(32))
    example_slug: Mapped[str] = mapped_column(String(96))
    template_content_sha256: Mapped[str] = mapped_column(String(64))
    copied_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    copied_at: Mapped[datetime] = mapped_column(default=utc_now)
    # Relational identity mapping, not scientific values or a new producer attestation.
    record_mapping_json: Mapped[dict[str, str]] = mapped_column(JSON)


def _immutable_origin(_mapper, _connection, target):
    raise ValueError(f"{type(target).__name__} is append-only")


def _sealed_project(_mapper, _connection, target):
    state = inspect(target)
    prior = state.attrs.kind.history.deleted
    was_template = (prior[0] if prior else target.kind) == ProjectKind.EXAMPLE_TEMPLATE
    if was_template:
        raise ValueError("Example template project metadata is sealed")


def _sealed_template(_mapper, _connection, target):
    if any(
        inspect(target).attrs[name].history.has_changes()
        for name in (
            "project_id",
            "slug",
            "version",
            "structure_version_id",
            "manifest_sha256",
            "content_sha256",
            "sealed",
        )
    ):
        raise ValueError("Example template content is sealed; build a new version")


event.listen(Project, "before_update", _sealed_project)
event.listen(Project, "before_delete", _sealed_project)
event.listen(ExampleTemplate, "before_update", _sealed_template)
event.listen(ExampleTemplate, "before_delete", _immutable_origin)
event.listen(ProjectExampleOrigin, "before_update", _immutable_origin)
event.listen(ProjectExampleOrigin, "before_delete", _immutable_origin)
