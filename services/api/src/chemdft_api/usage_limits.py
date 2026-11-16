"""Simple per-user daily usage limits for the invitation-only beta (billing stays disabled).

A limit of 0 means "not limited" (the local-development default). Hosted deployments set finite
values so a handful of invited researchers cannot cause uncontrolled model or compute spending.
These are counters over the last 24 hours of durable rows; they are not billing and not a hard
financial cap (provider prices are unknown), only a bound on how much work one account can request.
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import Settings
from .errors import UsageLimitReached
from .models import utc_now


def _count_recent(session: Session, model, user_column, created_column, user_id: str) -> int:
    since = utc_now() - timedelta(hours=24)
    return int(
        session.scalar(
            select(func.count())
            .select_from(model)
            .where(user_column == user_id, created_column >= since)
        )
        or 0
    )


def enforce_ai_run_limit(session: Session, settings: Settings, user_id: str) -> None:
    limit = settings.beta_max_ai_runs_per_user_day
    if limit <= 0:
        return
    from .ai_models import AIRunRecord

    if (
        _count_recent(session, AIRunRecord, AIRunRecord.actor_id, AIRunRecord.created_at, user_id)
        >= limit
    ):
        raise UsageLimitReached(
            f"Daily AI limit reached ({limit} AI runs per 24 hours). Please try again later."
        )


def enforce_compute_job_limit(session: Session, settings: Settings, user_id: str) -> None:
    limit = settings.beta_max_compute_jobs_per_user_day
    if limit <= 0:
        return
    from .scientific_models import ComputeJobRecord

    if (
        _count_recent(
            session,
            ComputeJobRecord,
            ComputeJobRecord.submitted_by,
            ComputeJobRecord.created_at,
            user_id,
        )
        >= limit
    ):
        raise UsageLimitReached(
            f"Daily calculation limit reached ({limit} calculations per 24 hours). "
            "Please try again later."
        )
