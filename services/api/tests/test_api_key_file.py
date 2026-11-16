"""Credential-file boundary tests. Offline; no provider request, key or network is used."""

import os

import pytest
from chemdft_api.config import MAX_SECRET_FILE_BYTES, SecretFileError, Settings, read_secret_file

# Obviously synthetic marker used only to prove it never reaches an error message.
MARKER = "synthetic-test-credential-0123456789"


def _write(path, content=MARKER, mode=0o600):
    path.write_bytes(content if isinstance(content, bytes) else content.encode())
    path.chmod(mode)
    return path


def test_private_file_is_read_and_trailing_newline_removed(tmp_path):
    path = _write(tmp_path / "key", MARKER + "\n")
    assert read_secret_file(path) == MARKER
    settings = Settings(_env_file=None, ai_api_key_file=path)
    assert settings.ai_api_key is not None
    assert settings.ai_api_key.get_secret_value() == MARKER
    assert MARKER not in repr(settings)


@pytest.mark.parametrize("mode", [0o640, 0o604, 0o644, 0o660, 0o666, 0o700 | 0o010])
def test_group_or_other_access_is_rejected_without_leaking_content(tmp_path, mode):
    path = _write(tmp_path / "key", mode=mode)
    with pytest.raises(ValueError) as error:
        Settings(_env_file=None, ai_api_key_file=path)
    assert MARKER not in str(error.value)


def test_symlink_is_rejected_even_when_target_is_private(tmp_path):
    target = _write(tmp_path / "real")
    link = tmp_path / "link"
    link.symlink_to(target)
    with pytest.raises(SecretFileError, match="symbolic link"):
        read_secret_file(link)


def test_hard_link_is_rejected(tmp_path):
    first = _write(tmp_path / "first")
    os.link(first, tmp_path / "second")
    with pytest.raises(SecretFileError, match="single-link"):
        read_secret_file(first)


def test_missing_configured_file_fails_closed(tmp_path):
    with pytest.raises(ValueError, match="does not exist"):
        Settings(_env_file=None, ai_api_key_file=tmp_path / "absent")


def test_directory_and_fifo_are_rejected(tmp_path):
    directory = tmp_path / "directory"
    directory.mkdir(mode=0o700)
    with pytest.raises(SecretFileError, match="regular"):
        read_secret_file(directory)
    fifo = tmp_path / "fifo"
    os.mkfifo(fifo, 0o600)
    with pytest.raises(SecretFileError, match="regular"):
        read_secret_file(fifo)


@pytest.mark.parametrize(
    "content",
    [b"", b"\n", b"two tokens", b"line1\nline2\n", b"\xff\xfe", b"tab\tinside", b"ctrl\x07char"],
)
def test_malformed_content_is_rejected(tmp_path, content):
    path = _write(tmp_path / "key", content)
    with pytest.raises(SecretFileError):
        read_secret_file(path)


def test_oversized_file_is_rejected(tmp_path):
    path = _write(tmp_path / "key", b"a" * (MAX_SECRET_FILE_BYTES + 1))
    with pytest.raises(SecretFileError, match="bytes"):
        read_secret_file(path)


def test_explicit_key_wins_and_file_is_not_opened(tmp_path):
    # A broken file path is ignored when an explicit key exists; it is never opened.
    settings = Settings(_env_file=None, ai_api_key=MARKER, ai_api_key_file=tmp_path / "absent")
    assert settings.ai_api_key is not None
    assert settings.ai_api_key.get_secret_value() == MARKER


def test_no_key_flag_or_argument_accepts_a_credential():
    # The credential path is a settings file, never a command-line option.
    import inspect

    from chemdft_api import config

    assert "argparse" not in inspect.getsource(config)
