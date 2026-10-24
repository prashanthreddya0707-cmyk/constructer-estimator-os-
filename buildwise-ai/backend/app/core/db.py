from __future__ import annotations

import json

from sqlalchemy import JSON, String, TypeDecorator, create_engine, event
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


class UUIDStr(TypeDecorator):
    """UUID kept as a plain ``str`` in Python. Native ``uuid`` on PostgreSQL (needed to match Supabase's auth.users ids),
    ``VARCHAR(36)`` elsewhere, so existing SQLite databases keep working unchanged."""

    impl = String(36)
    cache_ok = True

    def load_dialect_impl(self, dialect):
        return dialect.type_descriptor(postgresql.UUID(as_uuid=False)) if dialect.name == "postgresql" else dialect.type_descriptor(String(36))


# JSON on SQLite, binary JSON (jsonb) on PostgreSQL
JSONType = JSON().with_variant(postgresql.JSONB(), "postgresql")


def _make_engine(url: str):
    st = get_settings()
    kwargs: dict = {}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False, "timeout": 20}
        # the request threadpool is larger than SQLite's default connection pool
        kwargs.update(pool_size=st.db_pool_size, max_overflow=st.db_max_overflow, pool_timeout=st.db_pool_timeout)
    else:  # server database: bounded pool, dead connections are replaced instead of failing a request
        kwargs.update(pool_pre_ping=True, pool_recycle=300, pool_size=st.db_pool_size, max_overflow=st.db_max_overflow,
                      pool_timeout=st.db_pool_timeout)
    engine = create_engine(url, **kwargs)
    if url.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def _sqlite_setup(dbapi_conn, _):  # enforce FKs / cascades; WAL lets readers and one writer work together
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA synchronous=NORMAL")
            cur.close()

    else:

        @event.listens_for(engine, "connect")
        def _pg_setup(dbapi_conn, _):  # a runaway query must not hold a pooled connection forever
            dbapi_conn.autocommit = True
            cur = dbapi_conn.cursor()
            cur.execute(f"SET statement_timeout = {int(st.db_statement_timeout_ms)}")
            cur.close()
            dbapi_conn.autocommit = False

    return engine


engine = _make_engine(get_settings().database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@event.listens_for(SessionLocal, "after_begin")
def _apply_row_level_security(session, transaction, connection):
    """Supabase mode: run every transaction of an authenticated request as the `authenticated` role with that user's JWT
    claims, so Postgres Row Level Security applies to the backend's own queries too. SET LOCAL ends with the transaction."""
    claims = session.info.get("rls_claims")
    if claims and connection.dialect.name == "postgresql":
        connection.exec_driver_sql("SET LOCAL ROLE authenticated")
        connection.exec_driver_sql(
            "SELECT set_config('request.jwt.claims', %s, true), set_config('request.jwt.claim.sub', %s, true), "
            "set_config('request.jwt.claim.role', 'authenticated', true)",
            (json.dumps(claims), str(claims["sub"])),
        )


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Columns added after the first release. create_all() never alters existing tables, so older local databases
# get these added here (idempotent). With AUTH_PROVIDER=supabase the schema is owned by supabase/migrations/*.sql instead.
_ADDED_COLUMNS = [("projects", "layout", "JSON")]


def _ensure_columns() -> None:
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    for table, column, ddl in _ADDED_COLUMNS:
        if table in insp.get_table_names() and column not in {c["name"] for c in insp.get_columns(table)}:
            with engine.begin() as conn:
                conn.execute(text(f'ALTER TABLE {table} ADD COLUMN {column} {ddl}'))


def enable_rls(eng, metadata) -> None:
    """Server database without Supabase: switch row level security on for every table (no policy = nobody but the owner
    role, i.e. this backend, can read them), so a leaked read-only role or a public API cannot expose the data."""
    if eng.dialect.name != "postgresql":
        return
    from sqlalchemy import text

    with eng.begin() as conn:
        for table in metadata.sorted_tables:
            conn.execute(text(f'ALTER TABLE "{table.name}" ENABLE ROW LEVEL SECURITY'))


def init_db() -> None:
    if get_settings().auth_provider == "supabase":
        return  # schema, RLS and storage come from supabase/migrations; the app never creates or alters tables there
    from app import models  # noqa: F401  (register tables)

    Base.metadata.create_all(bind=engine)
    _ensure_columns()
    enable_rls(engine, Base.metadata)
