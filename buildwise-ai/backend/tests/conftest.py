"""Test setup.

Default: the existing app (AUTH_PROVIDER=local) on temporary SQLite files.
Other modes, selected by environment variables:

  TEST_DATABASE_URL=postgresql://...                       same app on a real PostgreSQL server
  TEST_DATABASE_URL=postgresql://... TEST_AUTH_PROVIDER=supabase
      the Supabase integration: the real supabase/migrations/*.sql is applied to that (disposable!) database on top of small
      stand-ins for Supabase's auth/storage schemas, requests carry RS256 "Supabase" tokens verified against a test JWKS,
      every route runs under Row Level Security, and Supabase Storage is replaced by an in-memory fake that enforces the
      same per-user folder rule as the real storage policy.
"""
import os
import tempfile
import time
import uuid
from pathlib import Path

_tmp = tempfile.mkdtemp(prefix="buildwise-test-")
os.environ["DATA_DIR"] = _tmp
os.environ["AUTH_ENCRYPTION_KEY"] = "test-auth-key-not-for-production"
os.environ["JWT_SECRET"] = "test-secret-not-for-production-0123456789abcdef"
os.environ["RATE_LIMIT_ENABLED"] = "false"          # individual tests switch it on
SUPABASE_MODE = os.environ.get("TEST_AUTH_PROVIDER") == "supabase"
TEST_URL = "https://testproject.supabase.invalid"

_key = None
if os.environ.get("TEST_DATABASE_URL"):
    os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]
    os.environ.pop("AUTH_DATABASE_URL", None)
else:
    os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
    os.environ["AUTH_DATABASE_URL"] = f"sqlite:///{_tmp}/auth.db"

if os.environ.get("TEST_DATABASE_URL") and os.environ.get("TEST_AUTH_PROVIDER") != "supabase":
    import psycopg as _pg

    with _pg.connect(os.environ["TEST_DATABASE_URL"], autocommit=True) as _c:      # every run starts from an empty schema
        _c.execute("drop schema if exists public cascade")
        _c.execute("create schema public")

if SUPABASE_MODE:
    import json

    import jwt
    from cryptography.hazmat.primitives.asymmetric import rsa
    from jwt.algorithms import RSAAlgorithm

    assert os.environ.get("TEST_DATABASE_URL"), "TEST_AUTH_PROVIDER=supabase needs TEST_DATABASE_URL (a disposable PostgreSQL database)"
    _key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    _jwk = json.loads(RSAAlgorithm.to_jwk(_key.public_key()))
    _jwk.update(kid="test-key-1", alg="RS256", use="sig")
    os.environ.update(AUTH_PROVIDER="supabase", SUPABASE_URL=TEST_URL, SUPABASE_PUBLISHABLE_KEY="sb_publishable_test",
                      SUPABASE_JWKS_JSON=json.dumps({"keys": [_jwk]}))

    import psycopg

    _here = Path(__file__).resolve().parent
    with psycopg.connect(os.environ["TEST_DATABASE_URL"], autocommit=True) as c:      # fresh Supabase-like database
        for schema in ("public", "auth", "storage"):
            c.execute(f"drop schema if exists {schema} cascade")
        c.execute("create schema public")
        c.execute((_here / "supabase" / "stubs.sql").read_text())
        for sql in sorted((_here.parents[1] / "supabase" / "migrations").glob("*.sql")):      # the real migrations, in order
            c.execute(sql.read_text())
        for role in ("authenticated", "anon"):
            c.execute(f"grant usage on schema public to {role}")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def pytest_configure(config):
    config.addinivalue_line("markers", "local_auth: exercises the built-in login system (skipped when Supabase Auth is the provider)")


def pytest_collection_modifyitems(config, items):
    """Tests of the built-in login system do not apply when Supabase Auth does the logins."""
    if SUPABASE_MODE:
        skip = pytest.mark.skip(reason="local-auth test (Supabase Auth handles accounts in this mode)")
        for item in items:
            if "local_auth" in item.keywords:
                item.add_marker(skip)


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


_counter = {"n": 0}


def supabase_token(user_id: str, email: str, name: str = "Test User", ttl: int = 3600, role: str = "authenticated") -> str:
    now = int(time.time())
    return jwt.encode({"sub": user_id, "email": email, "role": role, "aud": "authenticated", "iss": f"{TEST_URL}/auth/v1", "iat": now,
                       "exp": now + ttl, "user_metadata": {"full_name": name}}, _key, algorithm="RS256", headers={"kid": "test-key-1"})


def make_supabase_user(email: str, name: str = "Test User") -> dict:
    """What Supabase Auth does on sign-up: a row in auth.users (the trigger creates the profile). Returns auth headers."""
    import psycopg

    uid = str(uuid.uuid4())
    with psycopg.connect(os.environ["TEST_DATABASE_URL"], autocommit=True) as c:
        c.execute("insert into auth.users (id, email, raw_user_meta_data) values (%s, %s, %s::jsonb)", (uid, email, json.dumps({"full_name": name})))
    return {"Authorization": f"Bearer {supabase_token(uid, email, name)}"}


def make_user(client):
    _counter["n"] += 1
    email = f"user{_counter['n']}@example.com"
    if SUPABASE_MODE:
        return make_supabase_user(email)
    r = client.post("/api/auth/signup", json={"email": email, "full_name": "Test User", "password": "password123"})
    assert r.status_code == 201, r.text
    client.cookies.clear()  # tests authenticate with explicit headers
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture()
def auth(client):
    return make_user(client)


@pytest.fixture(autouse=True)
def fake_supabase_storage(monkeypatch):
    """In-memory stand-in for Supabase Storage with the real rule: a token may only touch '<its own user id>/...'."""
    if not SUPABASE_MODE:
        return
    import httpx

    from app.core import supa

    files: dict[str, bytes] = {}

    class Resp:
        def __init__(self, status, content=b""):
            self.status_code, self.content = status, content

        def raise_for_status(self):
            if self.status_code >= 400:
                raise httpx.HTTPStatusError("storage error", request=None, response=None)

    def handle(method, url, headers, content=b""):
        ident = supa.verify_access_token(headers["Authorization"].split(" ", 1)[1])
        assert headers.get("apikey") == "sb_publishable_test" and ident, "storage call must carry the public key and a valid user token"
        path = url.split("/storage/v1/object/", 1)[1].replace("authenticated/", "", 1)
        bucket, rest = path.split("/", 1)
        if rest.split("/", 1)[0] != ident.id:
            return Resp(403)                                   # storage policy: only your own folder
        if method == "POST":
            files[f"{bucket}/{rest}"] = content
            return Resp(200)
        if method == "DELETE":
            files.pop(f"{bucket}/{rest}", None)
            return Resp(200)
        return Resp(200, files[f"{bucket}/{rest}"]) if f"{bucket}/{rest}" in files else Resp(404)

    monkeypatch.setattr(supa.httpx, "post", lambda url, content=b"", headers=None, **k: handle("POST", url, headers, content))
    monkeypatch.setattr(supa.httpx, "get", lambda url, headers=None, **k: handle("GET", url, headers))
    monkeypatch.setattr(supa.httpx, "head", lambda url, headers=None, **k: handle("HEAD", url, headers))
    monkeypatch.setattr(supa.httpx, "delete", lambda url, headers=None, **k: handle("DELETE", url, headers))
    app.state.fake_storage = files


PROJECT = {
    "name": "Test House", "description": "d", "owner_name": "Owner", "building_type": "residential", "location": "Pune",
    "floors": 2, "currency": "INR", "budget": 3000000, "length": 10, "width": 8, "height": 3,
    "wall_thickness": 0.23, "slab_thickness": 0.15,
    "rooms": [
        {"name": "Living", "room_type": "living", "length": 5, "width": 4, "height": 3, "floor_number": 1, "doors": 2, "windows": 2},
        {"name": "Bedroom", "room_type": "bedroom", "length": 4, "width": 3.5, "height": 3, "floor_number": 1, "doors": 1, "windows": 1},
        {"name": "Bath", "room_type": "bathroom", "length": 2, "width": 1.5, "height": 3, "floor_number": 2, "doors": 1, "windows": 1},
    ],
}
