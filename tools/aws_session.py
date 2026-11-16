#!/usr/bin/env python3
"""Owner-run control of ONE approved AWS compute session (status / open / close).

``status`` is read-only (identity, guard poll, instance state, local session record).
``open`` asks the Lambda guard to start the existing pilot instance. It reserves guard-metered
quota hours, so it needs BOTH ``--approve "START ONE CHEMDFT AWS SESSION"`` AND an interactive typed
confirmation. ``close`` asks the guard to stop the instance and removes the local record.
``disable`` is the emergency stop for the on-demand worker: it pauses every start (including the
automatic ones) and stops a running worker. Only the owner can re-arm it, by setting the ledger item
{pk: "switch", disabled: false}.

    uv run --offline --frozen python tools/aws_session.py status
    uv run --offline --frozen python tools/aws_session.py open --approve "START ONE CHEMDFT AWS SESSION"
    uv run --offline --frozen python tools/aws_session.py close

Settings come from the CHEMDFT_* environment (compute_aws_enabled, aws_config_file,
aws_pilot_bucket, aws_instance_id, aws_image_id, aws_session_file). Do NOT run ``open`` without the
researcher's explicit approval for that session. The tool never retries a start and cannot
override the guard's monthly quota, two-hour limit or independent shutdown timer.
"""

from __future__ import annotations

import argparse
import json
import sys

from chemdft_api.aws_compute import AwsProviderError
from chemdft_api.aws_session_control import SessionController
from chemdft_api.config import get_settings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("status", "open", "close", "disable"))
    parser.add_argument("--approve", default="", help="exact owner approval phrase (open only)")
    args = parser.parse_args(argv)
    controller = SessionController(get_settings())
    try:
        if args.action == "status":
            print(json.dumps(controller.status(), indent=2, sort_keys=True))
        elif args.action == "open":
            if not sys.stdin.isatty():
                raise AwsProviderError(
                    "SESSION_NOT_CONFIRMED", "an interactive terminal is required"
                )
            session = controller.open(approval=args.approve, confirm=input)
            print(f"SESSION OPEN until epoch {session.deadline_epoch} (guard deadline)")
        elif args.action == "disable":
            print(json.dumps(controller.disable(), indent=2, sort_keys=True))
            print("DISABLED: no worker start is possible until the owner re-arms the ledger switch")
        else:
            controller.close()
            print("SESSION CLOSED: guard stop requested and instance independently read as stopped")
    except AwsProviderError as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
