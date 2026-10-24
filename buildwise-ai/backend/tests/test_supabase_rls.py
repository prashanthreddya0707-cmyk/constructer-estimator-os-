"""Supabase mode: Row Level Security, token verification and storage rules, tested against the real migration SQL."""
import copy
import os
import time
import uuid
from contextlib import contextmanager

import jwt
import pytest

from .conftest import PROJECT, SUPABASE_MODE, TEST_URL, make_supabase_user, supabase_token

pytestmark = pytest.mark.skipif(not SUPABASE_MODE, reason="needs TEST_AUTH_PROVIDER=supabase and a disposable PostgreSQL database")

if SUPABASE_MODE:
    import psycopg
    from psycopg.errors import InsufficientPrivilege, RaiseException  # noqa: F401


def _uid(headers):
    return jwt.decode(headers["Authorization"].split(" ", 1)[1], options={"verify_signature": False})["sub"]


@contextmanager
def as_user(user_id, role="authenticated"):
    """A transaction that behaves exactly like one of the backend's: role switched, JWT claims set, rolled back at the end."""
    with psycopg.connect(os.environ["TEST_DATABASE_URL"], autocommit=False) as c:
        c.execute(f"set local role {role}")
        if user_id:
            c.execute("select set_config('request.jwt.claim.sub', %s, true), set_config('request.jwt.claims', %s, true)",
                      (user_id, '{"sub": "%s", "role": "%s"}' % (user_id, role)))
        try:
            yield c
        finally:
            c.rollback()


def _project(client, headers, name="P"):
    r = client.post("/api/projects", json=copy.deepcopy(PROJECT) | {"name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_each_user_sees_only_their_own_rows(client):
    a, b = make_supabase_user("rls-a@example.com"), make_supabase_user("rls-b@example.com")
    pa, pb = _project(client, a, "A house"), _project(client, b, "B house")
    with as_user(_uid(a)) as c:
        assert {r[0] for r in c.execute("select name from projects")} == {"A house"}
        assert c.execute("select count(*) from project_rooms").fetchone()[0] == 3          # only A's 3 rooms
        assert c.execute("select count(*) from projects where id = %s", (pb,)).fetchone()[0] == 0
    with as_user(_uid(b)) as c:
        assert {r[0] for r in c.execute("select name from projects")} == {"B house"}


def test_user_cannot_modify_or_delete_someone_elses_rows(client):
    a, b = make_supabase_user("rls-c@example.com"), make_supabase_user("rls-d@example.com")
    pb = _project(client, b, "B only")
    with as_user(_uid(a)) as c:
        assert c.execute("update projects set name = 'hacked' where id = %s", (pb,)).rowcount == 0
        assert c.execute("delete from projects where id = %s", (pb,)).rowcount == 0
    assert client.get(f"/api/projects/{pb}", headers=b).json()["name"] == "B only"


def test_user_cannot_attach_rows_to_someone_elses_project_or_impersonate(client):
    a, b = make_supabase_user("rls-e@example.com"), make_supabase_user("rls-f@example.com")
    pb = _project(client, b)
    with as_user(_uid(a)) as c:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):       # WITH CHECK: the parent project must be the user's own
            c.execute("insert into project_rooms (project_id, name, length, width) values (%s, 'sneaky', 3, 3)", (pb,))
    with as_user(_uid(a)) as c:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):       # cannot create rows owned by another user
            c.execute("insert into projects (owner_id, name, length, width) values (%s, 'forged', 5, 5)", (_uid(b),))


@pytest.mark.parametrize("table", ["projects", "project_rooms", "materials", "reports", "profiles", "project_estimates", "floor_plan_files"])
def test_anonymous_role_has_no_access_at_all(client, table):
    with as_user(None, role="anon") as c:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            c.execute(f"select * from {table}")


def test_shared_catalogue_is_readable_but_not_writable_and_private_materials_stay_private(client):
    a, b = make_supabase_user("rls-g@example.com"), make_supabase_user("rls-h@example.com")
    mat = client.post("/api/materials", json={"estimate_key": "cement", "name": "A private cement", "category": "Cement", "unit": "bag"}, headers=a)
    assert mat.status_code == 201, mat.text
    with as_user(_uid(b)) as c:
        names = {r[0] for r in c.execute("select name from materials")}
        assert "A private cement" not in names and len(names) > 5                    # shared samples visible, A's private one not
        assert c.execute("update materials set name = 'x' where owner_id is null").rowcount == 0     # samples are read-only
        assert c.execute("delete from materials where owner_id is null").rowcount == 0
    # B cannot hang a price on A's private material, but can override a shared sample's price for themselves
    with as_user(_uid(b)) as c:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            c.execute("insert into material_price_records (material_id, owner_id, unit_price) values (%s, %s, 1)", (mat.json()["id"], _uid(b)))
    with as_user(_uid(b)) as c:
        sample = c.execute("select id from materials where owner_id is null limit 1").fetchone()[0]
        c.execute("insert into material_price_records (material_id, owner_id, unit_price) values (%s, %s, 99)", (sample, _uid(b)))


def test_profile_is_created_on_first_sign_in_and_is_private(client):
    h = make_supabase_user("rls-i@example.com", "Priya Allam")
    other = make_supabase_user("rls-i2@example.com", "Someone Else")
    with as_user(_uid(h)) as c:
        assert c.execute("select count(*) from profiles").fetchone()[0] == 0           # nothing until the first request
    assert client.get("/api/auth/me", headers=h).json() == {"id": _uid(h), "email": "rls-i@example.com", "full_name": "Priya Allam"}
    assert client.put("/api/auth/me", json={"full_name": "New Name"}, headers=h).json()["full_name"] == "New Name"
    assert client.get("/api/auth/me", headers=h).json()["full_name"] == "New Name"
    with as_user(_uid(h)) as c:
        assert c.execute("select full_name from profiles").fetchall() == [("New Name",)]    # sees only their own profile
        with pytest.raises(psycopg.errors.InsufficientPrivilege):                           # cannot create someone else's
            c.execute("insert into profiles (id, full_name) values (%s, 'forged')", (_uid(other),))


def test_backend_queries_really_run_as_the_signed_in_user(client):
    """Python's ownership check is not the only guard: even without it, the database hides other users' rows."""
    from sqlalchemy import text

    from app.core.db import SessionLocal
    from app.models import Project

    a, b = make_supabase_user("rls-j@example.com"), make_supabase_user("rls-k@example.com")
    pa, pb = _project(client, a), _project(client, b)
    with SessionLocal() as db:
        db.info["rls_claims"] = {"sub": _uid(a), "role": "authenticated"}
        assert db.execute(text("select current_user")).scalar() == "authenticated"
        assert db.get(Project, pb) is None and db.get(Project, pa) is not None
        db.commit()                                                                   # a new transaction must be bound again
        assert db.execute(text("select current_user")).scalar() == "authenticated"
        assert db.execute(text("select count(*) from projects")).scalar() == 1
    with SessionLocal() as db:                                                        # no claims: the backend's own maintenance role
        assert db.execute(text("select current_user")).scalar() != "authenticated"


def test_storage_policy_confines_users_to_their_own_folder(client):
    a, b = make_supabase_user("rls-l@example.com"), make_supabase_user("rls-m@example.com")
    with as_user(_uid(a)) as c:
        c.execute("insert into storage.objects (bucket_id, name) values ('floorplans', %s)", (f"{_uid(a)}/plan.png",))
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            c.execute("insert into storage.objects (bucket_id, name) values ('floorplans', %s)", (f"{_uid(b)}/plan.png",))
    with as_user(_uid(b)) as c:
        assert c.execute("select count(*) from storage.objects").fetchone()[0] == 0
    with psycopg.connect(os.environ["TEST_DATABASE_URL"]) as c:
        assert {r[0] for r in c.execute("select id from storage.buckets where public is false")} >= {"floorplans", "reports"}


def test_floor_plan_and_report_files_go_to_the_users_own_storage_folder(client):
    from .test_api import png_bytes  # noqa: F401  (helper defined there)
    a = make_supabase_user("rls-n@example.com")
    pid = _project(client, a)
    rep = client.post(f"/api/projects/{pid}/report", headers=a)
    assert rep.status_code == 201
    from app.main import app
    files = app.state.fake_storage
    assert any(k.startswith(f"reports/{_uid(a)}/") for k in files)
    assert client.get(f"/api/reports/{rep.json()['id']}/download", headers=a).content[:4] == b"%PDF"


# ---------------------------------------------------------------------------------------------------- token verification
def test_bad_tokens_are_rejected(client):
    a = make_supabase_user("rls-o@example.com")
    uid = _uid(a)
    ok = supabase_token(uid, "rls-o@example.com")
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {ok}"}).status_code == 200
    from cryptography.hazmat.primitives.asymmetric import rsa
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = int(time.time())
    claims = {"sub": uid, "role": "authenticated", "aud": "authenticated", "iss": f"{TEST_URL}/auth/v1", "iat": now, "exp": now + 600}
    bad = {
        "expired": supabase_token(uid, "x@example.com", ttl=-10),
        "anon role": supabase_token(uid, "x@example.com", role="anon"),
        "wrong audience": jwt.encode(claims | {"aud": "other"}, __import__("tests.conftest", fromlist=["_key"])._key, algorithm="RS256", headers={"kid": "test-key-1"}),
        "wrong issuer": jwt.encode(claims | {"iss": "https://evil.example/auth/v1"}, __import__("tests.conftest", fromlist=["_key"])._key, algorithm="RS256", headers={"kid": "test-key-1"}),
        "signed by another key": jwt.encode(claims, other, algorithm="RS256", headers={"kid": "test-key-1"}),
        "unknown key id": jwt.encode(claims, __import__("tests.conftest", fromlist=["_key"])._key, algorithm="RS256", headers={"kid": "nope"}),
        "no subject": jwt.encode({k: v for k, v in claims.items() if k != "sub"}, __import__("tests.conftest", fromlist=["_key"])._key, algorithm="RS256", headers={"kid": "test-key-1"}),
        "alg none": jwt.encode(claims, key=None, algorithm="none"),
        "hs256 with a guessed secret": jwt.encode(claims, "secret-secret-secret-secret-secret-0000", algorithm="HS256"),
        "garbage": "not.a.token",
    }
    for label, tok in bad.items():
        assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {tok}"}).status_code == 401, label
    assert client.get("/api/auth/me").status_code == 401


def test_builtin_signup_and_login_are_switched_off_in_supabase_mode(client):
    assert client.post("/api/auth/signup", json={"email": "z@example.com", "full_name": "Z", "password": "password123"}).status_code == 410
    assert client.post("/api/auth/login", json={"email": "z@example.com", "password": "password123"}).status_code == 410
    assert client.get("/api/health/ready").json() == {"status": "ok", "database": "ok", "auth_provider": "supabase"}
