"""Cookie sessions and the separate encrypted credential store."""
import sqlite3
from pathlib import Path

from app.core.authstore import migrate_legacy_users
from app.core.config import get_settings
from app.core.db import SessionLocal
from app.models import User

import pytest

pytestmark = pytest.mark.local_auth   # these test the built-in credential store

EMAIL, NAME, PW = "secret.person@example.com", "Secret Person", "correct-horse-1"


def _signup(client):
    r = client.post("/api/auth/signup", json={"email": EMAIL, "full_name": NAME, "password": PW})
    assert r.status_code == 201, r.text
    return r


def test_session_cookie_is_httponly_and_authenticates(client):
    client.cookies.clear()
    r = _signup(client)
    set_cookie = r.headers["set-cookie"].lower()
    assert "bw_session=" in set_cookie and "httponly" in set_cookie and "samesite=lax" in set_cookie
    assert client.get("/api/auth/me").json()["email"] == EMAIL        # cookie only, no header
    assert client.post("/api/auth/logout").status_code == 204
    client.cookies.clear()
    assert client.get("/api/auth/me").status_code == 401


def test_https_requests_get_secure_cookie(client):
    client.cookies.clear()
    r = client.post("/api/auth/login", json={"email": EMAIL, "password": PW}, headers={"x-forwarded-proto": "https"})
    assert "secure" in r.headers["set-cookie"].lower()
    client.cookies.clear()


def test_credentials_are_encrypted_in_their_own_file(client):
    if not get_settings().auth_database_url.startswith("sqlite"):
        return _check_encrypted_in_server_db()
    path = Path(get_settings().data_dir) / "auth.db"
    assert path.is_file()
    raw = path.read_bytes()
    assert EMAIL.encode() not in raw and NAME.encode() not in raw and PW.encode() not in raw
    rows = sqlite3.connect(path).execute("select email_enc, name_enc, password_hash from credentials").fetchall()
    assert rows and all(r[2].startswith("scrypt$") for r in rows)
    # the project database holds no e-mail, name or password hash
    with SessionLocal() as db:
        users = db.query(User).all()
        assert users and all(u.password_hash == "" and u.full_name == "" and u.email.endswith("@auth.invalid") for u in users)


def _check_encrypted_in_server_db():
    from sqlalchemy import text

    from app.core.authstore import engine

    with engine.connect() as c:
        rows = c.execute(text("select email_enc, name_enc, password_hash from credentials")).fetchall()
    assert rows and all(EMAIL not in r[0] and NAME not in r[1] and r[2].startswith("scrypt$") for r in rows)
    with SessionLocal() as db:
        assert all(u.password_hash == "" and u.full_name == "" for u in db.query(User).all())


def test_server_database_blocks_public_api_with_rls(client):
    from sqlalchemy import text

    from app.core.db import engine as main_engine

    if main_engine.dialect.name != "postgresql":
        return
    with main_engine.connect() as c:
        off = c.execute(text("select relname from pg_class where relkind='r' and relnamespace='public'::regnamespace and not relrowsecurity")).fetchall()
    assert off == []   # every table has row level security enabled


def test_profile_update_stays_in_auth_store(client):
    client.cookies.clear()
    tok = client.post("/api/auth/login", json={"email": EMAIL, "password": PW}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    assert client.put("/api/auth/me", json={"full_name": "New Name"}, headers=h).json()["full_name"] == "New Name"
    assert client.get("/api/auth/me", headers=h).json()["full_name"] == "New Name"
    with SessionLocal() as db:
        assert all(u.full_name == "" for u in db.query(User).all())
    client.cookies.clear()


def test_legacy_users_are_migrated_and_can_still_log_in(client):
    import uuid

    from app.core.security import hash_password

    legacy_id = str(uuid.uuid4())
    with SessionLocal() as db:
        db.add(User(id=legacy_id, email="old.user@example.com", full_name="Old User", password_hash=hash_password("oldpassword1")))
        db.commit()
    assert migrate_legacy_users() >= 1
    with SessionLocal() as db:
        u = db.get(User, legacy_id)
        assert u.email.endswith("@auth.invalid") and u.password_hash == ""
    r = client.post("/api/auth/login", json={"email": "old.user@example.com", "password": "oldpassword1"})
    assert r.status_code == 200 and r.json()["user"]["full_name"] == "Old User"
    client.cookies.clear()
    assert migrate_legacy_users() == 0  # idempotent
