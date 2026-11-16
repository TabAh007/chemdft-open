# ruff: noqa: E501
"""Per-account limits and gates for SELF-SIGNUP accounts (ADR-045).

Only accounts with an `account_profiles` row are limited: the owner and the researchers invited before open
signup have none and keep the older behaviour (`usage_limits.py`). Every limit is a config key; 0 means
unlimited. Counters are taken from durable rows (jobs, AI runs, projects, stored bytes), so there is no
separate counter to drift. A refusal is audited without free text and raises a named error.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .account_models import AccountAuditEvent, AccountProfile
from .config import Settings
from .errors import AccountPolicyError
from .models import Project, StoredFile, utc_now

_TERMINAL_JOB_STATES = ("SUCCEEDED", "FAILED", "CANCELED")
MB = 1024 * 1024


def get_profile(session: Session, user_id: str) -> AccountProfile | None:
    return session.get(AccountProfile, user_id)


def audit(
    session: Session, event: str, user_id: str | None, outcome: str, reason: str | None = None
) -> None:
    session.add(AccountAuditEvent(event=event, user_id=user_id, outcome=outcome, reason=reason))
    session.commit()


def _refuse(
    session: Session, user_id: str, event: str, code: str, message: str, status: int = 429
) -> None:
    audit(session, event, user_id, "REFUSED", code)
    raise AccountPolicyError(code, message, status_code=status)


def ai_allowed(settings: Settings, profile: AccountProfile) -> bool:
    return settings.ai_for_new_users if profile.ai_enabled is None else profile.ai_enabled


def _require_verified(session: Session, profile: AccountProfile, event: str) -> None:
    if profile.email_verified_at is None:
        _refuse(
            session,
            profile.user_id,
            event,
            "EMAIL_NOT_VERIFIED",
            "Verify your email address before running calculations or using the AI Scientist.",
            403,
        )


def _job_counts(session: Session, user_id: str) -> tuple[int, int, int]:
    from .scientific_models import ComputeJobRecord

    now = utc_now()

    def since(delta: timedelta) -> int:
        return int(
            session.scalar(
                select(func.count())
                .select_from(ComputeJobRecord)
                .where(
                    ComputeJobRecord.submitted_by == user_id,
                    ComputeJobRecord.created_at >= now - delta,
                )
            )
            or 0
        )

    active = int(
        session.scalar(
            select(func.count())
            .select_from(ComputeJobRecord)
            .where(
                ComputeJobRecord.submitted_by == user_id,
                ComputeJobRecord.state.notin_(_TERMINAL_JOB_STATES),
            )
        )
        or 0
    )
    return since(timedelta(hours=24)), since(timedelta(days=30)), active


def _ai_runs_today(session: Session, user_id: str) -> int:
    from .ai_models import AIRunRecord

    return int(
        session.scalar(
            select(func.count())
            .select_from(AIRunRecord)
            .where(
                AIRunRecord.actor_id == user_id,
                AIRunRecord.created_at >= utc_now() - timedelta(hours=24),
            )
        )
        or 0
    )


def _project_count(session: Session, user_id: str) -> int:
    return int(
        session.scalar(
            select(func.count()).select_from(Project).where(Project.created_by == user_id)
        )
        or 0
    )


def _stored_bytes(session: Session, user_id: str) -> int:
    from .scientific_models import ScientificArtifactRecord

    files = session.scalar(
        select(func.coalesce(func.sum(StoredFile.size_bytes), 0)).where(
            StoredFile.created_by == user_id
        )
    )
    artifacts = session.scalar(
        select(func.coalesce(func.sum(ScientificArtifactRecord.size_bytes), 0)).where(
            ScientificArtifactRecord.created_by == user_id
        )
    )
    return int(files or 0) + int(artifacts or 0)


def enforce_compute(session: Session, settings: Settings, user_id: str) -> None:
    profile = get_profile(session, user_id)
    if profile is None or profile.deleted_at is not None:
        return
    _require_verified(session, profile, "compute_submit")
    day, month, active = _job_counts(session, user_id)
    if settings.quota_concurrent_jobs and active >= settings.quota_concurrent_jobs:
        _refuse(
            session,
            user_id,
            "compute_submit",
            "QUOTA_CONCURRENT_JOBS",
            f"You already have {active} calculations queued or running "
            f"(limit {settings.quota_concurrent_jobs}). Wait for one to finish.",
        )
    if settings.quota_jobs_per_day and day >= settings.quota_jobs_per_day:
        _refuse(
            session,
            user_id,
            "compute_submit",
            "QUOTA_JOBS_DAY",
            f"Daily calculation limit reached ({settings.quota_jobs_per_day} per 24 hours).",
        )
    if settings.quota_jobs_per_month and month >= settings.quota_jobs_per_month:
        _refuse(
            session,
            user_id,
            "compute_submit",
            "QUOTA_JOBS_MONTH",
            f"Monthly calculation limit reached ({settings.quota_jobs_per_month} per 30 days).",
        )


def enforce_ai(session: Session, settings: Settings, user_id: str) -> None:
    profile = get_profile(session, user_id)
    if profile is None or profile.deleted_at is not None:
        return
    _require_verified(session, profile, "ai_run")
    if not ai_allowed(settings, profile):
        _refuse(
            session,
            user_id,
            "ai_run",
            "AI_NOT_ENABLED",
            "The AI Scientist is not enabled for new accounts during the beta.",
            403,
        )
    if (
        settings.quota_ai_runs_per_day
        and _ai_runs_today(session, user_id) >= settings.quota_ai_runs_per_day
    ):
        _refuse(
            session,
            user_id,
            "ai_run",
            "QUOTA_AI_RUNS_DAY",
            f"Daily AI limit reached ({settings.quota_ai_runs_per_day} AI runs per 24 hours).",
        )


def enforce_project_create(session: Session, settings: Settings, user_id: str) -> None:
    profile = get_profile(session, user_id)
    if profile is None or profile.deleted_at is not None:
        return
    if (
        settings.quota_max_projects
        and _project_count(session, user_id) >= settings.quota_max_projects
    ):
        _refuse(
            session,
            user_id,
            "project_create",
            "QUOTA_PROJECTS",
            f"Project limit reached ({settings.quota_max_projects} projects).",
        )


def upload_limit_bytes(session: Session, settings: Settings, user_id: str) -> int:
    """The per-file byte limit that applies to this caller (the global limit for accounts without a profile)."""
    profile = get_profile(session, user_id)
    if profile is None or not settings.quota_upload_mb:
        return settings.max_upload_bytes
    return min(settings.max_upload_bytes, settings.quota_upload_mb * MB)


def enforce_upload(
    session: Session, settings: Settings, user_id: str, size_bytes: int | None
) -> None:
    """Storage check before accepting an upload of `size_bytes` (None = unknown, only the total is checked)."""
    profile = get_profile(session, user_id)
    if profile is None or profile.deleted_at is not None:
        return
    limit = upload_limit_bytes(session, settings, user_id)
    if size_bytes is not None and size_bytes > limit:
        _refuse(
            session,
            user_id,
            "upload",
            "QUOTA_UPLOAD_SIZE",
            f"File exceeds the {limit // MB} MB upload limit for beta accounts.",
            413,
        )
    if (
        settings.quota_storage_mb
        and _stored_bytes(session, user_id) + (size_bytes or 0) > settings.quota_storage_mb * MB
    ):
        _refuse(
            session,
            user_id,
            "upload",
            "QUOTA_STORAGE",
            f"Storage limit reached ({settings.quota_storage_mb} MB of uploaded and generated files).",
        )


@dataclass(frozen=True)
class QuotaLine:
    key: str
    label: str
    used: int | None
    limit: int | None  # None = not limited
    unit: str


def limits_view(session: Session, settings: Settings, user_id: str) -> dict:
    profile = get_profile(session, user_id)
    if profile is None:
        return {"applies": False, "email_verified": True, "ai_enabled": True, "quotas": []}
    day, month, active = _job_counts(session, user_id)

    def lim(value: int) -> int | None:
        return value or None

    lines = [
        QuotaLine(
            "jobs_day", "Calculations per day", day, lim(settings.quota_jobs_per_day), "jobs"
        ),
        QuotaLine(
            "jobs_month",
            "Calculations per 30 days",
            month,
            lim(settings.quota_jobs_per_month),
            "jobs",
        ),
        QuotaLine(
            "concurrent_jobs",
            "Running or queued calculations",
            active,
            lim(settings.quota_concurrent_jobs),
            "jobs",
        ),
        QuotaLine(
            "ai_runs_day",
            "AI runs per day",
            _ai_runs_today(session, user_id),
            lim(settings.quota_ai_runs_per_day),
            "runs",
        ),
        QuotaLine(
            "projects",
            "Projects",
            _project_count(session, user_id),
            lim(settings.quota_max_projects),
            "projects",
        ),
        QuotaLine(
            "storage_mb",
            "Stored files",
            _stored_bytes(session, user_id) // MB,
            lim(settings.quota_storage_mb),
            "MB",
        ),
        QuotaLine(
            "upload_mb",
            "Largest single upload",
            None,
            upload_limit_bytes(session, settings, user_id) // MB,
            "MB",
        ),
    ]
    return {
        "applies": True,
        "email_verified": profile.email_verified_at is not None,
        "ai_enabled": ai_allowed(settings, profile),
        "quotas": [line.__dict__ for line in lines],
    }
