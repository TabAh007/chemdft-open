"""Opaque credential references. The encrypted implementation is explicitly local-only."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Protocol
from uuid import UUID, uuid4

from cryptography.fernet import Fernet, InvalidToken

from ..auth import dev_identity_permitted
from ..config import Settings
from ..errors import BillingSecretUnavailable


class SecretProvider(Protocol):
    production_safe: bool

    def put_secret(self, value: str) -> str: ...
    def get_secret(self, reference: str) -> str: ...
    def delete_secret(self, reference: str) -> None: ...
    def exists(self, reference: str) -> bool: ...


class LocalEncryptedSecretProvider:
    """Fernet encrypted files, 0700 directory / 0600 files, external master key.

    Development convenience, not a production KMS: key rotation/recovery and deployment
    lifecycle are the operator's responsibility. Hosted use is always refused.
    """

    production_safe = False

    def __init__(self, settings: Settings) -> None:
        if not dev_identity_permitted(settings) or not settings.byok_local_master_key:
            raise BillingSecretUnavailable()
        try:
            self._cipher = Fernet(settings.byok_local_master_key.get_secret_value().encode())
        except (ValueError, TypeError) as error:
            raise BillingSecretUnavailable() from error
        self._root = settings.byok_local_root.absolute()
        # No symlink component may redirect private material to an unexpected store.
        if any(p.is_symlink() for p in (self._root, *self._root.parents)):
            raise BillingSecretUnavailable()
        self._root.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self._root, 0o700)

    def _path(self, reference: str) -> Path:
        try:
            prefix, identifier = reference.split(":", 1)
            if prefix != "local-encrypted":
                raise ValueError
            name = str(UUID(identifier))
        except (ValueError, AttributeError) as error:
            raise BillingSecretUnavailable() from error
        return self._root / name

    def put_secret(self, value: str) -> str:
        reference = f"local-encrypted:{uuid4()}"
        path = self._path(reference)
        ciphertext = self._cipher.encrypt(value.encode())
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(ciphertext)
        return reference

    def get_secret(self, reference: str) -> str:
        try:
            descriptor = os.open(self._path(reference), os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(descriptor, "rb") as stream:
                encrypted = stream.read(8192)
            return self._cipher.decrypt(encrypted).decode()
        except (OSError, ValueError, InvalidToken, UnicodeError) as error:
            raise BillingSecretUnavailable() from error

    def delete_secret(self, reference: str) -> None:
        try:
            self._path(reference).unlink(missing_ok=True)
        except OSError as error:
            raise BillingSecretUnavailable() from error

    def exists(self, reference: str) -> bool:
        try:
            path = self._path(reference)
            return path.is_file() and not path.is_symlink()
        except BillingSecretUnavailable:
            return False


def build_secret_provider(settings: Settings) -> SecretProvider:
    if settings.billing_byok_secret_provider == "local-encrypted" and dev_identity_permitted(
        settings
    ):
        return LocalEncryptedSecretProvider(settings)
    # Hosted implementations must be injected by an approved deployment adapter. Names
    # such as 'vault' do not magically confer security or fall back to a local store.
    raise BillingSecretUnavailable()
