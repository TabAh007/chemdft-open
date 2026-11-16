#!/usr/bin/env python3
"""Serve a DISPOSABLE COPY of the accepted (2026-10-06) native-engine evidence database.

The copy lives under /tmp and is migrated to the current schema there; the original database and
object store are only read (copied) and never opened for writing. Used to verify viewers and exports
against genuine PySCF results (Raman, TDDFT, thermochemistry, optimization, density/ESP/orbital fields).

    python3 tools/rw2_evidence_stack.py --api-port 8191 --web-port 3191
"""

import argparse
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services/api/src"))
from chemdft_api.test_environment import validate_test_storage  # noqa: E402

SOURCE_DB = ROOT / ".chemdft/chemdft.db"
SOURCE_OBJECTS = ROOT / ".chemdft/objects"


def wait_http(url: str, process: subprocess.Popen, seconds: int = 120) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"service exited early: {url}")
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status < 400:
                    return
        except Exception:
            time.sleep(0.5)
    raise RuntimeError(f"timeout waiting for {url}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-port", type=int, default=8191)
    parser.add_argument("--web-port", type=int, default=3191)
    args = parser.parse_args()
    if args.api_port in (8148, 8000) or args.web_port in (3148, 3000):
        raise SystemExit("refusing interactive ports")
    work = Path(tempfile.mkdtemp(prefix="chemdft-rw2-evidence-", dir="/tmp")).resolve()
    database, objects = work / "data/evidence.db", work / "objects"
    database.parent.mkdir()
    shutil.copy2(SOURCE_DB, database)
    shutil.copytree(SOURCE_OBJECTS, objects)
    validate_test_storage(f"sqlite:///{database}", objects, str(work), ROOT)
    env = os.environ.copy()
    env.update({
        "PYTHONDONTWRITEBYTECODE": "1", "PYTHONPATH": str(ROOT / "services/api/src"),
        # Development identity (the copied evidence belongs to the default local developer); storage is the
        # /tmp copy validated above, so the persistent databases can never be reached by this process.
        "CHEMDFT_ENVIRONMENT": "development", "CHEMDFT_TEST_WORKSPACE": str(work),
        "CHEMDFT_DATABASE_URL": f"sqlite:///{database}", "CHEMDFT_OBJECT_ROOT": str(objects),
        "CHEMDFT_AUTO_CREATE_SCHEMA": "false", "CHEMDFT_AUTH_MODE": "dev", "CHEMDFT_DEV_IDENTITY_ENABLED": "true",
        "CHEMDFT_AUTH_DATABASE_URL": f"file:{work / 'auth.db'}", "CHEMDFT_AI_PROVIDER": "fake",
        "CHEMDFT_API_BASE_URL": f"http://127.0.0.1:{args.api_port}",
        "CHEMDFT_E2E_API_PORT": str(args.api_port), "CHEMDFT_E2E_WEB_PORT": str(args.web_port),
        "CHEMDFT_WEB_DIST_DIR": ".next-rw2-evidence", "TMPDIR": str(work),
    })
    subprocess.check_call([str(ROOT / ".venv/bin/alembic"), "-c", str(ROOT / "services/api/alembic.ini"), "upgrade", "head"],
                          cwd=ROOT / "services/api", env=env)
    next_env = ROOT / "apps/web/next-env.d.ts"
    original = next_env.read_bytes() if next_env.exists() else None
    api = subprocess.Popen([str(ROOT / ".venv/bin/uvicorn"), "chemdft_api.main:app", "--host", "127.0.0.1", "--port", str(args.api_port)],
                           cwd=ROOT, env=env, stdout=open(work / "api.log", "w"), stderr=subprocess.STDOUT)
    web = subprocess.Popen([str(ROOT / "apps/web/node_modules/.bin/next"), "dev", "--hostname", "127.0.0.1", "--port", str(args.web_port)],
                           cwd=ROOT / "apps/web", env=env, stdout=open(work / "web.log", "w"), stderr=subprocess.STDOUT)
    def stop(*_):
        for p in (web, api):
            if p.poll() is None:
                p.terminate()
        for p in (web, api):
            try:
                p.wait(timeout=10)
            except subprocess.TimeoutExpired:
                p.kill()
        if original is not None and next_env.exists() and b".next-rw2-evidence/" in next_env.read_bytes():
            next_env.write_bytes(original)
        shutil.rmtree(work, ignore_errors=True)
        sys.exit(0)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    wait_http(f"http://127.0.0.1:{args.api_port}/health", api)
    wait_http(f"http://127.0.0.1:{args.web_port}/en", web)
    print(f"RW2_EVIDENCE_READY api={args.api_port} web={args.web_port} workspace={work}", flush=True)
    api.wait()
    return 0


if __name__ == "__main__":
    sys.exit(main())
