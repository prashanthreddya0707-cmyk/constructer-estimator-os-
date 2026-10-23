"""Alembic environment. The database URL, version table and (for autogenerate) metadata are passed in by app.core.migrate."""
from alembic import context
from sqlalchemy import create_engine

config = context.config
url = config.attributes["url"]
version_table = config.attributes["version_table"]
metadata = config.attributes.get("metadata")


def run() -> None:
    engine = config.attributes.get("connection")
    own = engine is None
    kwargs = {"connect_args": {"check_same_thread": False}} if url.startswith("sqlite") else {}
    conn_ctx = create_engine(url, **kwargs).connect() if own else None
    connection = conn_ctx if own else engine
    try:
        context.configure(connection=connection, target_metadata=metadata, version_table=version_table, render_as_batch=True,
                          compare_type=True)
        with context.begin_transaction():
            context.run_migrations()
        if own:
            connection.commit()
    finally:
        if own:
            connection.close()


run()
