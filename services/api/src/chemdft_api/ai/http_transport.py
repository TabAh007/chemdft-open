"""Standard-library HTTP transport with secret-free failure phases.

No global opener, timeout increase, retry, body logging or credential handling here.
"""

import http.client
import socket
import ssl
import time
import urllib.request
from dataclasses import asdict, dataclass


@dataclass(frozen=True, slots=True)
class TransportDiagnostic:
    phase: str
    kind: str
    elapsed_ms: int
    timeout_seconds: int
    http_status: int | None = None
    headers_ms: int | None = None
    retry_eligible: bool = False
    attempt: int = 1

    def as_dict(self):
        return asdict(self)


@dataclass(slots=True)
class TransportAttempt:
    timeout_seconds: int
    attempt: int
    started: float
    phase: str = "CONNECT_OR_HEADERS"
    http_status: int | None = None
    headers_ms: int | None = None

    def diagnostic(self, kind, *, retry=False):
        return TransportDiagnostic(
            phase=self.phase,
            kind=kind,
            http_status=self.http_status,
            elapsed_ms=int((time.monotonic() - self.started) * 1000),
            timeout_seconds=self.timeout_seconds,
            headers_ms=self.headers_ms,
            retry_eligible=retry,
            attempt=self.attempt,
        )


class TransportFailure(Exception):
    def __init__(self, kind, phase):
        super().__init__("Provider transport failed.")
        self.kind, self.phase = kind, phase


class _PhasedConnection:
    def connect(self):
        try:
            return super().connect()
        except TimeoutError:
            raise TransportFailure("CONNECTION_TIMEOUT", "CONNECT") from None
        except socket.gaierror:
            raise TransportFailure("DNS_ERROR", "CONNECT") from None
        except ssl.SSLError:
            raise TransportFailure("TLS_ERROR", "CONNECT") from None
        except OSError:
            raise TransportFailure("NETWORK_ERROR", "CONNECT") from None

    def send(self, data):
        try:
            return super().send(data)
        except TimeoutError:
            raise TransportFailure("WRITE_TIMEOUT", "REQUEST") from None

    def getresponse(self):
        try:
            return super().getresponse()
        except TimeoutError:
            raise TransportFailure("READ_TIMEOUT", "RESPONSE_HEADERS") from None


class _HTTPConnection(_PhasedConnection, http.client.HTTPConnection):
    pass


class _HTTPSConnection(_PhasedConnection, http.client.HTTPSConnection):
    pass


class _HTTPHandler(urllib.request.HTTPHandler):
    def http_open(self, req):
        return self.do_open(_HTTPConnection, req)


class _HTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, req):
        return self.do_open(_HTTPSConnection, req, context=self._context)


class _NoModelRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Redirects would dispatch again under one reservation, potentially forwarding secrets.
        return None


def open_response(request, timeout=None):
    # Default TLS verification/proxy policy; no global mutation, redirect or hidden retry.
    return urllib.request.build_opener(_HTTPHandler(), _HTTPSHandler(), _NoModelRedirect()).open(
        request, timeout=timeout
    )
