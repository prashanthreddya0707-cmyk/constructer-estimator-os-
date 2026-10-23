"""Repeatable schema management with Alembic.

Two independent migration histories, each with its own version table, so they work both when the credential store is
its own database file (SQLite default) and when everything lives in one PostgreSQL database:

  * ``migrations/main`` : projects, rooms, estimates, materials, reports, ... (version table ``alembic_version_main``)
  * ``migrations/auth`` : the encrypted credential store            (version table ``alembic_version_auth``)

``upgrade_all()`` runs at application start. It is safe to run on an empty database, on a database created by an older
release (the baseline migration only creates what is missing and never drops or rewrites data), and from several server
processes at once (file lock for SQLite, advisory lock for PostgreSQL).

CLI:  python -m app.core.migrate upgrade | current | check
"""
from __future__ import annotations

import fcntl
import sys
from contextlib import contextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text

from app.core.config import get_settings

ROOT = Path(__file__).resolve().parents[2] / "migrations"


def _config(kind: str, url: str, metadata=None, connection=None) -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(ROOT / kind))
    cfg.attributes.update(url=url, version_table=f"alembic_version_{kind}", metadata=metadata)
    if connection is not None:
        cfg.attributes["connection"] = connection
    return cfg


def _targets():
    from app.core.authstore import AuthBase
    from app.core.db import Base
    from app import models  # noqa: F401

    s = get_settings()
    return [("main", s.database_url, Base.metadata), ("auth", s.auth_database_url, AuthBase.metadata)]


@contextmanager
def _lock(url: str):
    """One migrator at a time: advisory lock on PostgreSQL, a lock file next to the data for SQLite."""
    if url.startswith("sqlite"):
        path = get_settings().data_dir / ".migrate.lock"
        with open(path, "w") as fh:
            fcntl.flock(fh, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(fh, fcntl.LOCK_UN)
    else:
        eng = create_engine(url)
        with eng.connect() as conn:
            conn.execute(text("select pg_advisory_lock(727001)"))
            try:
                yield
            finally:
                conn.execute(text("select pg_advisory_unlock(727001)"))
        eng.dispose()


def upgrade_all() -> None:
    for kind, url, md in _targets():
        with _lock(url):
            command.upgrade(_config(kind, url, md), "head")


def current_revisions() -> dict[str, str | None]:
    out = {}
    for kind, url, _ in _targets():
        eng = create_engine(url)
        with eng.connect() as conn:
            ctx = MigrationContext.configure(conn, opts={"version_table": f"alembic_version_{kind}"})
            out[kind] = ctx.get_current_revision()
        eng.dispose()
    return out


def heads() -> dict[str, str]:
    return {kind: ScriptDirectory(str(ROOT / kind)).get_current_head() for kind, _, _ in _targets()}


def drift() -> dict[str, list]:
    """Differences between the migrated schema and the SQLAlchemy models (empty = in sync). Used by tests and `check`."""
    from alembic.autogenerate import compare_metadata

    out = {}
    for kind, url, md in _targets():
        eng = create_engine(url)
        with eng.connect() as conn:
            ctx = MigrationContext.configure(conn, opts={"version_table": f"alembic_version_{kind}", "compare_type": True})
            out[kind] = [d for d in compare_metadata(ctx, md)]
        eng.dispose()
    return out


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "upgrade"
    if cmd == "upgrade":
        upgrade_all()
        print("schema is up to date:", current_revisions())
    elif cmd == "current":
        print(current_revisions(), "heads:", heads())
    elif cmd == "check":
        d = drift()
        print("schema drift:", {k: len(v) for k, v in d.items()})
        sys.exit(1 if any(d.values()) else 0)
    else:
        sys.exit("usage: python -m app.core.migrate upgrade|current|check")
