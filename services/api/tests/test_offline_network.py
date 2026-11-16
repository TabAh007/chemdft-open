"""Regression guard: an obsolete/missing HTTP mock must fail before external I/O."""

import socket
import urllib.request

import pytest
from chemdft_api.ai.gateway import HttpOpenAIModelGateway, ModelMessage, ModelRequest
from chemdft_api.config import Settings


@pytest.mark.parametrize(
    "lookup", ["getaddrinfo", "gethostbyname", "gethostbyname_ex", "gethostbyaddr"]
)
def test_external_dns_is_denied_before_resolution(monkeypatch, offline_network, lookup):
    import _socket

    def forbidden(*_args, **_kwargs):
        raise AssertionError("The OS resolver must never be reached")

    monkeypatch.setattr(_socket, lookup, forbidden)
    with pytest.raises(pytest.fail.Exception, match="OUTBOUND_NETWORK_BLOCKED"):
        if lookup == "getaddrinfo":
            socket.getaddrinfo("provider.invalid", 443)
        else:
            getattr(socket, lookup)("provider.invalid")
    assert offline_network == ["provider.invalid"]


@pytest.mark.parametrize("operation", ["connect", "connect_ex", "sendto", "sendmsg"])
@pytest.mark.parametrize(
    "family,host", [(socket.AF_INET, "192.0.2.1"), (socket.AF_INET6, "2001:db8::1")]
)
def test_numeric_addresses_cannot_bypass_dns_denial(operation, family, host):
    if not hasattr(socket.socket, operation):
        pytest.skip("Socket operation unavailable on this platform")
    with (
        socket.socket(family, socket.SOCK_DGRAM) as sock,
        pytest.raises(pytest.fail.Exception, match="OUTBOUND_NETWORK_BLOCKED"),
    ):
        if operation == "sendto":
            sock.sendto(b"offline", (host, 443))
        elif operation == "sendmsg":
            sock.sendmsg([b"offline"], [], 0, (host, 443))
        else:
            getattr(sock, operation)((host, 443))


def test_real_gateway_transport_fails_closed_without_a_mock(monkeypatch, offline_network):
    # Exercise build_opener(...).open, the path the obsolete urlopen mock missed.
    monkeypatch.setattr(urllib.request, "getproxies", lambda: {})
    gateway = HttpOpenAIModelGateway(
        Settings(
            _env_file=None,
            ai_provider="openai",
            ai_api_key="OFFLINE-TEST-ONLY",
            ai_api_base_url="https://provider.invalid/v1",
        )
    )
    with pytest.raises(pytest.fail.Exception, match="OUTBOUND_NETWORK_BLOCKED"):
        gateway.generate(
            ModelRequest(system_prompt="Offline fixture", messages=(ModelMessage("user", "Hi"),))
        )
    assert offline_network == ["provider.invalid"]
