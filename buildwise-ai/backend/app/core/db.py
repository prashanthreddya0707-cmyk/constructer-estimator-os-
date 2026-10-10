from __future__ import annotations

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


def _make_engine(url: str):
    kwargs = {}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    engine = create_engine(url, **kwargs)
    if url.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def _fk_on(dbapi_conn, _):  # enforce FKs / cascades in SQLite
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()

    return engine


engine = _make_engine(get_settings().database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Columns added after the first release. create_all() never alters existing tables, so older local databases
# get these added here (idempotent). A real deployment should use Alembic migrations instead.
_ADDED_COLUMNS = [("projects", "layout", "JSON")]


def _ensure_columns() -> None:
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    for table, column, ddl in _ADDED_COLUMNS:
        if table in insp.get_table_names() and column not in {c["name"] for c in insp.get_columns(table)}:
            with engine.begin() as conn:
                conn.execute(text(f'ALTER TABLE {table} ADD COLUMN {column} {ddl}'))


def init_db() -> None:
    from app import models  # noqa: F401  (register tables)

    Base.metadata.create_all(bind=engine)
    _ensure_columns()
