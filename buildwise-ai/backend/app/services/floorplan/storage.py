"""File storage abstraction. Only local disk is implemented; swap in S3/GCS by implementing the same interface."""
from __future__ import annotations

from pathlib import Path
from typing import Protocol

from app.core.config import get_settings


class Storage(Protocol):
    def save(self, key: str, data: bytes) -> None: ...
    def read(self, key: str) -> bytes: ...
    def exists(self, key: str) -> bool: ...
    def delete(self, key: str) -> None: ...


class LocalStorage:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _p(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if self.root.resolve() not in p.parents:
            raise ValueError("invalid storage key")
        return p

    def save(self, key: str, data: bytes) -> None:
        self._p(key).write_bytes(data)

    def read(self, key: str) -> bytes:
        return self._p(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self._p(key).is_file()

    def delete(self, key: str) -> None:
        self._p(key).unlink(missing_ok=True)


def upload_storage() -> LocalStorage:
    return LocalStorage(get_settings().upload_dir)


def report_storage() -> LocalStorage:
    return LocalStorage(get_settings().report_dir)
