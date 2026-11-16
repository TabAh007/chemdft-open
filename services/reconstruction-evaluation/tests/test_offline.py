import socket

import pytest
from chemdft_reconstruction.offline import deny_network


def test_model_run_network_guard_blocks_and_restores_dns_and_connect():
    original_connect = socket.socket.connect
    original_getaddrinfo = socket.getaddrinfo

    with deny_network():
        with pytest.raises(PermissionError, match="Offline evaluation"):
            socket.create_connection(("example.invalid", 443))
        with pytest.raises(PermissionError, match="Offline evaluation"):
            socket.getaddrinfo("example.invalid", 443)

    assert socket.socket.connect is original_connect
    assert socket.getaddrinfo is original_getaddrinfo
