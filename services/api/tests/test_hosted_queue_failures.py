"""Hosted job-queue silent-failure fixes: a writable CREST lock default and a logged, named lock failure."""

import logging
from pathlib import Path

import pytest
from chemdft_api import compute_worker
from chemdft_api.calculation_actions import CrestLockUnavailable, open_crest_lock
from chemdft_api.config import Settings


def test_lock_default_is_under_the_object_dir_when_hosted_and_explicit_wins(tmp_path) -> None:
    hosted = Settings(object_root=Path("/data/objects"))
    assert hosted.effective_crest_lock_path() == Path("/data/objects/locks/crest.lock")
    local = Settings(object_root=Path("./.chemdft/objects"))
    assert local.effective_crest_lock_path() == Path("./.chemdft/locks/crest.lock")
    explicit = Settings(object_root=Path("/data/objects"), crest_lock_path=tmp_path / "x.lock")
    assert explicit.effective_crest_lock_path() == tmp_path / "x.lock"
    with open_crest_lock(
        Settings(object_root=tmp_path / "objects")
    ) as lock:  # absolute: created under it
        assert Path(lock.name) == tmp_path / "objects" / "locks" / "crest.lock"


def test_unwritable_lock_path_raises_a_clear_error_naming_the_path(tmp_path) -> None:
    blocker = tmp_path / "file"
    blocker.write_text("not a directory")
    with pytest.raises(CrestLockUnavailable) as raised:
        open_crest_lock(Settings(crest_lock_path=blocker / "locks" / "crest.lock"))
    assert str(blocker) in str(raised.value) and "CHEMDFT_CREST_LOCK_PATH" in str(raised.value)


def test_worker_loop_logs_a_failing_poll_instead_of_swallowing_it(monkeypatch, caplog) -> None:
    calls = {"n": 0}

    def failing(_worker_id: str) -> bool:
        calls["n"] += 1
        raise CrestLockUnavailable("lock cannot be opened at /nowhere")

    def stop(_seconds: float) -> None:
        if calls["n"] >= 3:
            raise KeyboardInterrupt

    monkeypatch.setattr(compute_worker, "run_once", failing)
    monkeypatch.setattr(compute_worker.time, "sleep", stop)
    monkeypatch.delenv("CHEMDFT_COMPUTE_WORKER_ONCE", raising=False)
    with (
        caplog.at_level(logging.ERROR, logger="chemdft.compute_worker"),
        pytest.raises(KeyboardInterrupt),
    ):
        compute_worker.run()
    records = [r for r in caplog.records if "poll failed" in r.getMessage()]
    assert len(records) == 1  # three failures, one logged line (rate limited per message)
    assert "/nowhere" in records[0].getMessage()
