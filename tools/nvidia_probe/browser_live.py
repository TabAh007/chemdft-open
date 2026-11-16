"""Budget-enforced live API process for the browser acceptance of real NVIDIA models (AI-8).

NOT executed by any test, task or default command. The browser suite `ai-live-browser` starts this
module in place of the plain API server. It reuses the production-flow authorization (a
`chemdft.nvidia-flow-authorization.v1` file naming the models and cases), the arming variable bound
to that file's hash, the private key-file check, the host allowlist and the budget ledger. Every
model request the real AI Scientist service makes for a browser user passes through
`BrowserBudgetGateway`, which admits it against the ledger (calls, tokens, wall clock), allows only
the authorized models, makes one attempt, verifies the response identity, refuses everything after
the first stop, and writes a content-free report. It never selects a model, never approves anything
and never retries; the service's own bounded repair loop is the only source of repeat requests.
"""

from __future__ import annotations

import json
import os
import stat
import sys
import threading
import time
from dataclasses import replace
from pathlib import Path
from urllib.parse import urlsplit

from chemdft_api.ai.gateway import ModelRequestNotSentError

from .authorization import AuthorizationError, load_authorization
from .flow import BudgetedFlowGateway
from .ledger import BudgetLedger
from .runner import ALLOWED_HOST, _arming_error, install_host_allowlist

AUTHORIZATION_ENV = "CHEMDFT_LIVE_AUTHORIZATION"
REPORT_ENV = "CHEMDFT_LIVE_REPORT"
KEY_FILE_ENV = "CHEMDFT_AI_API_KEY_FILE"
MOONSHOT_KEY_FILE_ENV = "CHEMDFT_MOONSHOT_API_KEY_FILE"


class BrowserBudgetGateway:
    """One shared budget over every request of a browser session; fail closed after a stop."""

    def __init__(
        self,
        inner=None,
        authorization=None,
        *,
        report_path: Path | None = None,
        clock=time.monotonic,
    ):
        self._inner = inner
        self._authorization = authorization
        self._clock = clock
        self._started = clock()
        self._ledger = BudgetLedger(authorization)
        self._lock = threading.Lock()  # the ledger admits one open call at a time
        self._report_path = report_path
        self.records: list[dict] = []
        self.stopped_by: str | None = None

    def summary(self) -> dict:
        ledger = self._ledger
        return {
            "kind": "BROWSER_LIVE_BUDGET_REPORT",
            "authorization_sha256": self._authorization.sha256,
            "models": list(self._authorization.models),
            "max_total_calls": self._authorization.max_total_calls,
            "max_total_tokens": self._authorization.max_total_tokens,
            "calls_admitted": ledger.calls_admitted,
            "committed_tokens_upper_bound": ledger.committed_tokens,
            "unknown_usage_calls": ledger.unknown_usage_calls,
            "stopped_by": self.stopped_by,
            "retries": 0,
            "fallback": "none",
            "requests": list(self.records),
        }

    def _write(self) -> None:
        if self._report_path is not None:
            self._report_path.write_text(json.dumps(self.summary(), indent=1) + "\n")

    def _refuse(self, model, reason: str) -> None:
        self.records.append(
            {
                "index": len(self.records) + 1,
                "model": model,
                "outcome": "NOT_SENT",
                "reason": reason,
            }
        )
        self.stopped_by = self.stopped_by or reason
        self._write()
        raise ModelRequestNotSentError("The live budget gateway refused this request.")

    def bind(self, inner):
        """A gateway for one provider's client that shares this budget, ledger and report."""
        return _Bound(self, inner)

    def generate(self, request):
        return self._generate(self._inner, request)

    def _generate(self, inner, request):
        with self._lock:
            model = request.model_identifier
            if self.stopped_by:
                self._refuse(model, f"AFTER_STOP_{self.stopped_by}")
            if model not in self._authorization.models:
                self._refuse(model, "MODEL_NOT_AUTHORIZED")
            # The service already applied this model's development sampling; PRODUCTION_DEFAULT here
            # means "send exactly what the service built", never a second profile.
            attempt = BudgetedFlowGateway(
                inner,
                self._authorization,
                model,
                sampling="PRODUCTION_DEFAULT",
                input_basis="SERVICE_RESERVATION",
                ledger=self._ledger,
                started=self._started,
                clock=self._clock,
            )
            try:
                response = attempt.generate(request)
            finally:
                for record in attempt.records:
                    record["index"] = len(self.records) + 1
                    record["model"] = model
                    self.records.append(record)
                if attempt.stopped_by:
                    self.stopped_by = attempt.stopped_by
                self._write()
            return replace(response, provider=self._authorization.provider)


class _Bound:
    def __init__(self, budget: BrowserBudgetGateway, inner) -> None:
        self._budget, self._inner = budget, inner

    def generate(self, request):
        return self._budget._generate(self._inner, request)


def _key_file_private(path: Path) -> None:
    """Checks mode and type only; the key's content is never read here."""
    info = path.stat()
    if not path.is_file() or path.is_symlink() or info.st_mode & (stat.S_IRWXG | stat.S_IRWXO):
        raise AuthorizationError("KEY_FILE_NOT_PRIVATE", "use a regular 0600 file")


def plan_summary(auth) -> dict:
    """What the authorization allows, in numbers; reads nothing secret and opens no socket."""
    per_request = auth.max_input_tokens_per_request + auth.max_output_tokens_per_request
    return {
        "authorized_by": auth.authorized_by,
        "expires_at": auth.expires_at.isoformat(),
        "authorization_sha256": auth.sha256,
        "provider": auth.provider,
        "models": list(auth.models),
        "cases": list(auth.flow.cases),
        "flows": len(auth.models) * (len(auth.flow.cases) or 1),
        "max_total_calls": auth.max_total_calls,
        "max_model_calls_per_flow": auth.flow.max_model_calls_per_model,
        "max_input_tokens_per_request": auth.max_input_tokens_per_request,
        "max_output_tokens_per_request": auth.max_output_tokens_per_request,
        "max_total_tokens": auth.max_total_tokens,
        "worst_case_tokens_at_the_call_ceiling": min(
            auth.max_total_calls * per_request, auth.max_total_tokens
        ),
        "max_wall_clock_seconds": auth.max_wall_clock_seconds,
        "per_call_wall_clock_seconds": auth.per_call_wall_clock_seconds,
        "spend_control": auth.spend_control.kind,
        "retries": 0,
        "fallback": "none",
        "never_approves": True,
    }


def main(argv=None, environ=os.environ) -> int:
    mode = (argv if argv is not None else sys.argv[1:]) or ["--serve"]
    if mode not in (["--validate"], ["--check"], ["--serve"]):
        print("REFUSED: use --validate, --check or --serve")
        return 2
    try:
        auth = load_authorization(Path(environ[AUTHORIZATION_ENV]))
        if auth.flow is None:
            raise AuthorizationError("FLOW_AUTHORIZATION_REQUIRED", "the flow schema is required")
        if mode == ["--validate"]:
            print(
                json.dumps({"mode": "LIVE_BROWSER_VALIDATE_ONLY_NO_NETWORK", **plan_summary(auth)})
            )
            return 0
        refusal = _arming_error(auth, environ)
        if refusal:
            print(refusal)
            return 2
        _key_file_private(
            Path(environ[MOONSHOT_KEY_FILE_ENV if auth.provider == "moonshot" else KEY_FILE_ENV])
        )
        if mode == ["--check"]:
            print(json.dumps({"mode": "LIVE_BROWSER_ARMED_CHECK", **plan_summary(auth)}))
            return 0
        report = Path(environ[REPORT_ENV])
    except (KeyError, AuthorizationError, OSError) as error:
        print(f"REFUSED: {error}")
        return 2
    install_host_allowlist(urlsplit(auth.endpoint).hostname or ALLOWED_HOST)

    from chemdft_api.ai import providers

    shared: dict = {}
    real_build = providers.build_model_gateway
    real_http = providers.HttpOpenAIModelGateway

    def budgeted(inner):
        from chemdft_api.ai.gateway import UnavailableModelGateway

        if isinstance(inner, UnavailableModelGateway):
            return inner  # not configured: fail closed, never substitute
        if "budget" not in shared:
            shared["budget"] = BrowserBudgetGateway(None, auth, report_path=report)
        return shared["budget"].bind(inner)

    providers.build_model_gateway = lambda settings: budgeted(real_build(settings))
    providers.HttpOpenAIModelGateway = lambda settings: budgeted(real_http(settings))

    import uvicorn
    from chemdft_api.main import app

    print(
        f"live budget gateway armed for {auth.sha256[:16]}; models {list(auth.models)}", flush=True
    )
    uvicorn.run(
        app, host="127.0.0.1", port=int(environ["CHEMDFT_E2E_API_PORT"]), log_level="warning"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
