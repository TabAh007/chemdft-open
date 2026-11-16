"""Opt-in safety shim for disposable E2E Python children, never production startup."""

import importlib.util
import ipaddress
import json
import os
import sys
from pathlib import Path


def install():
    def check(host, operation):
        if isinstance(host, bytes):
            host = host.decode("ascii", errors="replace")
        if host == "localhost":
            return
        try:
            address = ipaddress.ip_address(host)
            if address.is_loopback or (
                isinstance(address, ipaddress.IPv6Address)
                and address.ipv4_mapped is not None
                and address.ipv4_mapped.is_loopback
            ):
                return
        except ValueError:
            pass
        work = os.environ.get("CHEMDFT_TEST_WORKSPACE")
        if work:
            with (Path(work) / "blocked-network.jsonl").open("a") as stream:
                stream.write(json.dumps({"operation": operation, "host": str(host)}) + "\n")
        raise RuntimeError("OUTBOUND_NETWORK_BLOCKED: offline E2E permits loopback only")

    def audit(event, args):
        if event in {"socket.getaddrinfo", "socket.gethostbyname", "socket.gethostbyaddr"}:
            check(args[0], event)
        elif event in {"socket.connect", "socket.sendto"}:
            address = args[1] if event == "socket.connect" else args[2]
            if isinstance(address, tuple):
                check(address[0], event)

    sys.addaudithook(audit)
    # Do not read a repository/production .env, even in Alembic/fixture subprocesses.
    # The installed scientific prefix also inherits the socket guard for version-only
    # probes, but deliberately has no API/Pydantic dependency. It never loads Settings.
    if importlib.util.find_spec("pydantic_settings") is not None:
        from chemdft_api.config import Settings

        Settings.model_config["env_file"] = None


if os.environ.get("CHEMDFT_E2E_OFFLINE") == "1":
    try:
        install()
    except Exception:
        sys.stderr.write("OFFLINE_GUARD_STARTUP_FAILED\n")
        os._exit(78)  # Python otherwise ignores a failed sitecustomize import.


if (
    os.environ.get("CHEMDFT_NATIVE_ENGINE_GUARD") == "1"
    or os.environ.get("CHEMDFT_E2E_OFFLINE") == "1"
):
    # Offline E2E and unauthorized pytest runs never start an engine, in any child interpreter.
    try:
        import native_launch_guard

        native_launch_guard.install_in_this_process()
    except Exception:
        sys.stderr.write("NATIVE_GUARD_STARTUP_FAILED\n")
        os._exit(78)
