from typing import Annotated

from fastapi import Depends

from .config import Settings, get_settings
from .storage import LocalObjectStore, ObjectStore


def get_object_store(settings: Annotated[Settings, Depends(get_settings)]) -> ObjectStore:
    return get_object_store_for_settings(settings)


def get_object_store_for_settings(settings: Settings) -> ObjectStore:
    return LocalObjectStore(settings.object_root)
