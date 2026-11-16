"""Hosted-like private beta flow: jwt users, no local engine, AWS jobs queued, per-user limits."""

from __future__ import annotations

import pytest

XYZ = b"2\nH2\nH 0 0 -0.37\nH 0 0 0.37\n"
PINNED = "sha256:" + "a" * 64


@pytest.fixture
def beta(multiuser):
    settings = multiuser.settings
    settings.compute_local_enabled = False
    settings.compute_aws_enabled = True
    settings.compute_default_provider = "aws"
    settings.aws_queue_without_session = True
    settings.aws_pilot_bucket = "chemdft-ec2-pilot-artifacts-testbucket"
    settings.aws_instance_id = "i-" "0123456789abcdef0"
    settings.aws_image_id = PINNED
    settings.beta_max_compute_jobs_per_user_day = 1
    return multiuser


def _prepare(actor, slug):
    project = actor.create_project(slug)
    imported = actor.post(
        f"/v1/projects/{project['id']}/structures/imports",
        files={"upload": ("h2.xyz", XYZ, "chemical/x-xyz")},
        data={"file_format": "XYZ", "idempotency_key": f"{slug}-import-1", "structure_name": "H2"},
    )
    assert imported.status_code == 201, imported.text
    return project, imported.json()["version"]


def _calculation(actor, project, version, key, preference="AUTO"):
    return actor.post(
        f"/v1/projects/{project['id']}/calculations",
        json={
            "structure_version": {
                "project_id": project["id"], "entity_type": "structure.version",
                "entity_id": version["id"],
            },
            "specification": {
                "task_type": "ENERGY",
                "method": {"identifier": "hf", "display_name": "HF", "registry": "chemdft.method"},
                "basis": {"identifier": "sto-3g", "display_name": "STO-3G", "registry": "chemdft.basis"},
                "charge": 0, "multiplicity": 1,
                "engine_preference": {"engine": "pyscf", "allowed_version": "2.14.0"},
            },
            "provider_preference": preference,
            "idempotency_key": key,
        },
    )  # fmt: skip


def test_invited_users_queue_aws_calculations_with_their_own_daily_limit(beta):
    alice, bob = beta.actor("alice"), beta.actor("bob")
    project_a, version_a = _prepare(alice, "beta-a")
    project_b, version_b = _prepare(bob, "beta-b")
    first = _calculation(alice, project_a, version_a, "beta-a-calc-0001")
    assert first.status_code == 201, first.text
    assert first.json()["compute_job"]["provider"] == "aws"
    assert first.json()["compute_job"]["state"] == "READY"  # waits for an owner-opened session
    blocked = _calculation(alice, project_a, version_a, "beta-a-calc-0002")
    assert blocked.status_code == 429 and "Daily calculation limit" in blocked.text
    own = _calculation(bob, project_b, version_b, "beta-b-calc-0001")  # bob's allowance is his own
    assert own.status_code == 201, own.text


def test_no_local_engine_means_local_requests_are_refused_clearly(beta):
    alice = beta.actor("alice")
    project, version = _prepare(alice, "beta-local")
    refused = _calculation(alice, project, version, "beta-local-0001", preference="LOCAL")
    assert refused.status_code >= 400 and "Local compute is disabled" in refused.text


def test_users_cannot_see_or_use_each_others_calculations(beta):
    alice, bob = beta.actor("alice"), beta.actor("bob")
    project_a, version_a = _prepare(alice, "iso-a")
    created = _calculation(alice, project_a, version_a, "iso-a-calc-0001").json()
    calculation_url = f"/v1/projects/{project_a['id']}/calculations/{created['calculation']['id']}"
    assert alice.get(calculation_url).status_code == 200
    assert bob.get(calculation_url).status_code in (403, 404)
    assert _calculation(bob, project_a, version_a, "iso-x-calc-0001").status_code in (403, 404)


def test_requests_without_a_valid_token_or_with_a_spoofed_identity_are_rejected(beta):
    alice = beta.actor("alice")
    project, _version = _prepare(alice, "auth-a")
    path = f"/v1/projects/{project['id']}"
    assert beta.client.get(path).status_code == 401
    spoof = {"X-ChemDFT-User-ID": alice.user_id, "X-ChemDFT-Organization-ID": alice.organization_id}
    assert beta.client.get(path, headers=spoof).status_code == 401
