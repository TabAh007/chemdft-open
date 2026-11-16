from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=160)
    slug: str = Field(min_length=1, max_length=96, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("Project name cannot be blank")
        return cleaned


class ProjectRename(BaseModel):
    """Name-only edit; the slug never changes."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=160)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("Project name cannot be blank")
        return cleaned


class ProjectRead(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)
    id: str
    organization_id: str
    name: str
    slug: str
    role: str
    created_at: datetime
    updated_at: datetime


class FileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    original_name: str
    media_type: str
    size_bytes: int
    sha256: str
    provenance_class: str
    created_at: datetime


class WorkspaceHistoryRead(BaseModel):
    id: str
    project_id: str
    event_name: str
    label: str
    occurred_at: datetime
    outcome: str
    target_kind: str | None = None
    target_id: str | None = None
    source_id: str | None = None


class HealthRead(BaseModel):
    status: str
    service: str
    scientific_execution: str


class MeOrganization(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    name: str
    kind: str
    role: str


class MeSetup(BaseModel):
    model_config = ConfigDict(extra="forbid")
    has_personal_organization: bool
    project_count: int


class MeRead(BaseModel):
    """Stable product identity for the UI. No credentials, tokens, claims or provider internals."""

    model_config = ConfigDict(extra="forbid")
    id: str
    display_name: str
    email: str
    kind: str
    auth_mode: str
    organization: MeOrganization
    setup: MeSetup
