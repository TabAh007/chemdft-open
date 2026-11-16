from datetime import timedelta

from chemdft_api.context import Identity
from chemdft_api.knowledge_models import KnowledgeIndexAttemptRecord, KnowledgeIndexJobRecord
from chemdft_api.knowledge_worker import (
    claim_next_job,
    heartbeat,
    process_claimed_job,
    recover_expired_jobs,
)
from chemdft_api.models import utc_now
from sqlalchemy import select


def test_knowledge_job_claim_lease_recovery_and_completion(api) -> None:
    client, sessions, settings = api
    project = client.post("/v1/projects", json={"name": "Queue", "slug": "queue"}).json()
    assert client.post(
        f"/v1/projects/{project['id']}/memory",
        json={"memory_type": "PROJECT_NOTE", "content": "Chromium source"},
    ).status_code == 201
    with sessions() as first:
        claimed = claim_next_job(first, "worker-a", lease_seconds=60)
        assert claimed is not None
        assert claim_next_job(first, "worker-b", lease_seconds=60) is None
        assert heartbeat(first, claimed[0], claimed[1], lease_seconds=60)
        job = first.get(KnowledgeIndexJobRecord, claimed[0])
        assert job is not None
        job.expires_at = utc_now() - timedelta(seconds=1)
        first.commit()
        assert recover_expired_jobs(first) == 1
        assert job.state == "PENDING"

        reclaimed = claim_next_job(first, "worker-b", lease_seconds=60)
        assert reclaimed is not None
        identity = Identity(
            user_id=settings.dev_user_id,
            organization_id=settings.dev_organization_id,
        )
        assert process_claimed_job(first, identity, reclaimed[0], reclaimed[2])

    with sessions() as session:
        job = session.scalar(
            select(KnowledgeIndexJobRecord).where(
                KnowledgeIndexJobRecord.project_id == project["id"]
            )
        )
        assert job is not None and job.state == "SUCCEEDED"
        attempts = session.scalars(
            select(KnowledgeIndexAttemptRecord).where(KnowledgeIndexAttemptRecord.job_id == job.id)
        ).all()
        assert len(attempts) == 2
        assert all(attempt.state == "SUCCEEDED" for attempt in attempts[-1:])
