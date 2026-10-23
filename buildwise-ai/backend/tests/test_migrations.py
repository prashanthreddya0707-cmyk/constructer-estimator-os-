"""Repeatable schema management."""
import sqlite3
import subprocess
import sys
import os
from pathlib import Path

from app.core import migrate

BACKEND = Path(__file__).resolve().parents[1]


def test_schema_is_at_head_and_matches_the_models():
    assert migrate.current_revisions() == migrate.heads()
    assert migrate.drift() == {"main": [], "auth": []}          # no model/table differences (columns, types, indexes)


def _run(code, data_dir, extra_env=None):
    env = {**os.environ, "DATA_DIR": str(data_dir), "JWT_SECRET": "x" * 40, "AUTH_ENCRYPTION_KEY": "k", **(extra_env or {})}
    env.pop("DATABASE_URL", None)
    env.pop("AUTH_DATABASE_URL", None)
    return subprocess.run([sys.executable, "-c", code], cwd=BACKEND, env=env, capture_output=True, text=True, timeout=120)


def test_database_from_an_older_release_is_adopted_without_losing_data(tmp_path):
    """Simulate a database made before migrations existed (no layout column, no token_version) and upgrade it."""
    from sqlalchemy import create_engine
    from app.core.db import Base
    from app import models  # noqa: F401

    main = tmp_path / "buildwise.db"
    eng = create_engine(f"sqlite:///{main}")
    Base.metadata.create_all(eng)
    with eng.begin() as c:
        c.exec_driver_sql("alter table projects drop column layout")
        c.exec_driver_sql("insert into users (id, email, full_name, password_hash, created_at) values ('u1','old@example.com','Old','scrypt$x',current_timestamp)")
        c.exec_driver_sql("insert into projects (id, owner_id, name, description, owner_name, building_type, location, floors, currency, length, width, height, wall_thickness, slab_thickness, assumptions, wastage, material_selections, extra_costs, purchase_quantities, is_demo, created_at, updated_at) "
                          "values ('p1','u1','Old house','','','residential','',2,'INR',10,8,3,0.23,0.15,'{}','{}','{}','{}','{}',0,current_timestamp,current_timestamp)")
    eng.dispose()
    r = _run("from app.core.migrate import upgrade_all; upgrade_all(); upgrade_all()", tmp_path)   # twice: must be repeatable
    assert r.returncode == 0, r.stderr
    db = sqlite3.connect(main)
    assert db.execute("select name, floors from projects").fetchall() == [("Old house", 2)]       # data untouched
    assert "layout" in {row[1] for row in db.execute("pragma table_info(projects)")}              # new column added
    assert db.execute("select count(*) from users").fetchone()[0] == 1
    assert db.execute("select version_num from alembic_version_main").fetchone()[0] == "0002"
    try:
        db.execute("update projects set floors = 0")
        raise AssertionError("constraint missing")
    except sqlite3.IntegrityError:
        pass
    auth = sqlite3.connect(tmp_path / "auth.db")
    assert "token_version" in {row[1] for row in auth.execute("pragma table_info(credentials)")}


def test_constraint_is_skipped_not_fatal_when_old_data_breaks_it(tmp_path):
    from sqlalchemy import create_engine
    from app.core.db import Base
    from app import models  # noqa: F401

    eng = create_engine(f"sqlite:///{tmp_path / 'buildwise.db'}")
    Base.metadata.create_all(eng)
    with eng.begin() as c:
        c.exec_driver_sql("insert into users (id, email, full_name, password_hash, created_at) values ('u1','a@example.com','A','h',current_timestamp)")
        c.exec_driver_sql("insert into projects (id, owner_id, name, description, owner_name, building_type, location, floors, currency, length, width, height, wall_thickness, slab_thickness, assumptions, wastage, material_selections, extra_costs, purchase_quantities, is_demo, created_at, updated_at, layout) "
                          "values ('p1','u1','Weird','','','residential','',0,'INR',10,8,3,0.23,0.15,'{}','{}','{}','{}','{}',0,current_timestamp,current_timestamp,null)")
    eng.dispose()
    r = _run("from app.core.migrate import upgrade_all; upgrade_all()", tmp_path)
    assert r.returncode == 0, r.stderr                                    # upgrade still succeeds, row is kept
    assert "violate ck_projects_floors" in (r.stdout + r.stderr)
    assert sqlite3.connect(tmp_path / "buildwise.db").execute("select floors from projects").fetchall() == [(0,)]
