import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Protocol
from uuid import uuid4

from .errors import UploadTooLarge


@dataclass(frozen=True)
class StoredObject:
    key: str
    size_bytes: int
    sha256: str


class ObjectStore(Protocol):
    def put_raw(self, project_id: str, stream: BinaryIO, max_bytes: int) -> StoredObject: ...
    def get_bytes(self, key: str, max_bytes: int) -> bytes: ...
    def delete(self, key: str) -> None: ...


class LocalObjectStore:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def put_raw(self, project_id: str, stream: BinaryIO, max_bytes: int) -> StoredObject:
        key = f"projects/{project_id}/raw/{uuid4()}"
        destination = self.root / key
        destination.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        size = 0
        try:
            with destination.open("xb") as target:
                while chunk := stream.read(1024 * 1024):
                    size += len(chunk)
                    if size > max_bytes:
                        raise UploadTooLarge()
                    digest.update(chunk)
                    target.write(chunk)
        except Exception:
            destination.unlink(missing_ok=True)
            raise
        return StoredObject(key=key, size_bytes=size, sha256=digest.hexdigest())

    def delete(self, key: str) -> None:
        candidate = (self.root / key).resolve()
        if not candidate.is_relative_to(self.root):
            raise ValueError("Object key escaped the configured storage root")
        candidate.unlink(missing_ok=True)

    def get_bytes(self, key: str, max_bytes: int) -> bytes:
        candidate = (self.root / key).resolve()
        if not candidate.is_relative_to(self.root):
            raise ValueError("Object key escaped the configured storage root")
        with candidate.open("rb") as source:
            data = source.read(max_bytes + 1)
        if len(data) > max_bytes:
            raise UploadTooLarge()
        return data
