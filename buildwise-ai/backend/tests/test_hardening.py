"""Security hardening, database robustness, persistence and concurrency."""
import concurrent.futures as cf
import copy
import os
import subprocess
import sys
import time
import urllib.request
import json
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, OperationalError

from app.core.config import get_settings
from app.core.db import SessionLocal, get_db
from app.core.ratelimit import limiter
from app.main import app

from .conftest import PROJECT, make_user

BACKEND = Path(__file__).resolve().parents[1]


@pytest.fixture()
def limits():
    """Turn rate limiting on with small limits for one test."""
    s = get_settings()
    saved = {k: getattr(s, k) for k in ("rate_limit_enabled", "login_ip_limit", "login_fail_limit", "signup_ip_limit", "expensive_user_limit")}
    s.rate_limit_enabled, s.login_ip_limit, s.login_fail_limit, s.signup_ip_limit, s.expensive_user_limit = True, 50, 3, 3, 4
    limiter.clear()
    yield s
    for k, v in saved.items():
        setattr(s, k, v)
    limiter.clear()


def _signup(client, email, pw="password123"):
    return client.post("/api/auth/signup", json={"email": email, "full_name": "T", "password": pw})


# ---- authentication -------------------------------------------------------------------------------------------------
@pytest.mark.local_auth
def test_wrong_password_is_rejected_and_message_does_not_leak(client):
    _signup(client, "leak@example.com")
    client.cookies.clear()
    a = client.post("/api/auth/login", json={"email": "leak@example.com", "password": "wrong-password"})
    b = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "wrong-password"})
    assert a.status_code == b.status_code == 401 and a.json()["error"]["message"] == b.json()["error"]["message"]


@pytest.mark.local_auth
def test_login_rejects_giant_passwords_before_hashing(client):
    r = client.post("/api/auth/login", json={"email": "a@example.com", "password": "x" * 100_000})
    assert r.status_code == 422


@pytest.mark.local_auth
def test_logout_invalidates_the_token_on_the_server(client):
    _signup(client, "logout@example.com")
    client.cookies.clear()
    tok = client.post("/api/auth/login", json={"email": "logout@example.com", "password": "password123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    assert client.get("/api/auth/me", headers=h).status_code == 200
    assert client.post("/api/auth/logout", headers=h).status_code == 204
    assert client.get("/api/auth/me", headers=h).status_code == 401          # the same, still unexpired token is dead now
    assert client.get("/api/projects", headers=h).status_code == 401
    client.cookies.clear()
    new = client.post("/api/auth/login", json={"email": "logout@example.com", "password": "password123"}).json()["access_token"]
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {new}"}).status_code == 200  # a fresh login works
    client.cookies.clear()


def test_tampered_or_foreign_tokens_are_rejected(client):
    import jwt
    forged = jwt.encode({"sub": "someone", "ver": 0, "exp": time.time() + 600}, "not-the-real-secret", algorithm="HS256")
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401
    client.cookies.clear()


# ---- rate limiting -------------------------------------------------------------------------------------------------
@pytest.mark.local_auth
def test_failed_logins_are_throttled_per_account(client, limits):
    _signup(client, "brute@example.com")
    client.cookies.clear()
    codes = [client.post("/api/auth/login", json={"email": "brute@example.com", "password": "bad-password"}).status_code for _ in range(5)]
    assert codes[:3] == [401, 401, 401] and codes[3:] == [429, 429]
    r = client.post("/api/auth/login", json={"email": "brute@example.com", "password": "password123"})
    assert r.status_code == 429 and int(r.headers["retry-after"]) >= 1          # even the right password waits
    # a different account from the same address is not blocked by this account's failures
    _signup(client, "other@example.com")
    client.cookies.clear()
    assert client.post("/api/auth/login", json={"email": "other@example.com", "password": "password123"}).status_code == 200
    client.cookies.clear()


@pytest.mark.local_auth
def test_signup_is_throttled_per_ip(client, limits):
    codes = [_signup(client, f"flood{i}@example.com").status_code for i in range(5)]
    assert codes[:3] == [201, 201, 201] and set(codes[3:]) == {429}
    client.cookies.clear()


def test_expensive_endpoints_are_throttled_per_user_not_per_ip(client, limits):
    a, b = make_user(client), make_user(client)
    p = client.post("/api/projects", json=copy.deepcopy(PROJECT), headers=a).json()
    codes = [client.post(f"/api/projects/{p['id']}/estimate", json={}, headers=a).status_code for _ in range(6)]
    assert codes[:4] == [200] * 4 and codes[4:] == [429, 429]
    q = client.post("/api/projects", json=copy.deepcopy(PROJECT), headers=b).json()
    assert client.post(f"/api/projects/{q['id']}/estimate", json={}, headers=b).status_code == 200   # other user unaffected


@pytest.mark.local_auth
def test_forwarded_ip_is_only_trusted_when_configured(client, limits):
    limits.trust_proxy_headers = False                      # spoofed header is ignored: same caller, so the 4th sign-up is refused
    codes = [client.post("/api/auth/signup", json={"email": f"sp{i}@example.com", "full_name": "T", "password": "password123"},
                         headers={"X-Forwarded-For": f"9.9.9.{i}"}).status_code for i in range(4)]
    assert codes == [201, 201, 201, 429]
    limiter.clear()
    limits.trust_proxy_headers = True                       # behind a trusted proxy each real client address counts separately
    codes = [client.post("/api/auth/signup", json={"email": f"fw{i}@example.com", "full_name": "T", "password": "password123"},
                         headers={"X-Forwarded-For": f"8.8.8.{i}, 10.0.0.1"}).status_code for i in range(4)]
    assert codes == [201] * 4
    limits.trust_proxy_headers = False
    client.cookies.clear()


# ---- authorization ---------------------------------------------------------------------------------------------------
def test_protected_routes_need_authentication(client):
    client.cookies.clear()
    for method, path in [("get", "/api/projects"), ("post", "/api/projects"), ("get", "/api/dashboard"), ("get", "/api/materials"),
                         ("get", "/api/prices"), ("get", "/api/reports"), ("get", "/api/auth/me"), ("post", "/api/demo/seed"),
                         ("get", "/api/projects/x/estimate"), ("put", "/api/projects/x/layout")]:
        assert getattr(client, method)(path).status_code == 401, (method, path)


def test_other_users_private_data_is_not_reachable(client):
    a, b = make_user(client), make_user(client)
    pid = client.post("/api/projects", json=copy.deepcopy(PROJECT), headers=a).json()["id"]
    client.post(f"/api/projects/{pid}/estimate", json={}, headers=a)
    rep = client.post(f"/api/projects/{pid}/report", headers=a).json()["id"]
    upd = {k: v for k, v in PROJECT.items() if k != "rooms"}
    attempts = [
        ("get", f"/api/projects/{pid}", None), ("put", f"/api/projects/{pid}", upd), ("delete", f"/api/projects/{pid}", None),
        ("get", f"/api/projects/{pid}/estimate", None), ("post", f"/api/projects/{pid}/estimate", {}),
        ("get", f"/api/projects/{pid}/rooms", None), ("put", f"/api/projects/{pid}/rooms", {"rooms": []}),
        ("put", f"/api/projects/{pid}/layout", {}), ("delete", f"/api/projects/{pid}/layout", None),
        ("get", f"/api/projects/{pid}/recommendations", None), ("post", f"/api/projects/{pid}/report", None),
        ("get", f"/api/reports/{rep}/download", None), ("delete", f"/api/reports/{rep}", None),
        ("get", f"/api/projects/{pid}/floorplans", None),
    ]
    for method, path, body in attempts:
        r = getattr(client, method)(path, headers=b, **({"json": body} if body is not None else {}))
        assert r.status_code in (404, 422), (method, path, r.status_code)       # never 200/204/403 (does not reveal existence)
    assert client.get(f"/api/projects/{pid}", headers=a).status_code == 200      # and the owner is unaffected
    assert all(p["id"] != pid for p in client.get("/api/projects", headers=b).json())


# ---- headers, size limits, errors ---------------------------------------------------------------------------------------
def test_security_headers_and_no_store(client):
    r = client.get("/api/health")
    assert r.headers["x-content-type-options"] == "nosniff" and r.headers["x-frame-options"] == "DENY"
    assert r.headers["referrer-policy"] == "no-referrer" and "frame-ancestors 'none'" in r.headers["content-security-policy"]
    assert r.headers["cache-control"] == "no-store" and "x-response-time-ms" in r.headers
    assert "strict-transport-security" in client.get("/api/health", headers={"x-forwarded-proto": "https"}).headers


def test_oversized_json_body_is_refused(client):
    r = client.post("/api/auth/login", content=b"x" * (3 * 1024 * 1024), headers={"content-type": "application/json"})
    assert r.status_code == 413 and r.json()["error"]["code"] == "payload_too_large"


def test_cors_does_not_allow_unknown_origins(client):
    r = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in r.headers
    r = client.options("/api/projects", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_database_outage_returns_503_not_a_crash(client):
    def broken():
        raise OperationalError("select 1", {}, Exception("connection refused"))
        yield  # pragma: no cover

    app.dependency_overrides[get_db] = broken
    try:
        r = client.get("/api/health/ready")
        assert r.status_code == 503 and r.json()["error"]["code"] == "database_unavailable" and "retry-after" in r.headers
    finally:
        app.dependency_overrides.pop(get_db, None)
    assert client.get("/api/health/ready").json()["database"] == "ok"


def test_input_validation_and_integrity_errors_are_clean(client):
    h = make_user(client)
    bad = copy.deepcopy(PROJECT) | {"floors": 0}
    assert client.post("/api/projects", json=bad, headers=h).status_code == 422
    assert client.post("/api/projects", json={"name": "x"}, headers=h).status_code == 422
    assert client.post("/api/projects", content=b"{not json", headers={**h, "content-type": "application/json"}).status_code == 422
    # the database itself refuses rows that break the rules, even if the API were bypassed
    users = "auth.users" if os.environ.get("TEST_AUTH_PROVIDER") == "supabase" else "users"
    uid = make_user(client) and None  # make sure at least one account exists
    with SessionLocal() as db:
        owner = db.execute(text(f"select id from {users} limit 1")).scalar()
        with pytest.raises(IntegrityError):
            db.execute(text("insert into projects (id, owner_id, name, floors, length, width, height, wall_thickness, slab_thickness, description, owner_name, building_type, location, currency, assumptions, wastage, material_selections, extra_costs, purchase_quantities, is_demo, created_at, updated_at) "
                            "values (:id, :o, 'bad', 0, 10, 8, 3, 0.23, 0.15, '', '', 'residential', '', 'INR', '{}', '{}', '{}', '{}', '{}', false, current_timestamp, current_timestamp)"),
                       {"id": str(__import__("uuid").uuid4()), "o": owner})
            db.commit()


# ---- concurrency ----------------------------------------------------------------------------------------------------------
@pytest.mark.local_auth
def test_simultaneous_signups_for_one_email_create_exactly_one_account(client):
    def go(_):
        return client.post("/api/auth/signup", json={"email": "race@example.com", "full_name": "R", "password": "password123"}).status_code

    with cf.ThreadPoolExecutor(8) as ex:
        codes = list(ex.map(go, range(8)))
    assert codes.count(201) == 1 and codes.count(409) == 7
    client.cookies.clear()


def test_simultaneous_writes_by_one_user_all_succeed_and_stay_consistent(client):
    h = make_user(client)
    with cf.ThreadPoolExecutor(10) as ex:
        res = list(ex.map(lambda i: client.post("/api/projects", json=copy.deepcopy(PROJECT) | {"name": f"P{i}"}, headers=h), range(10)))
    assert [r.status_code for r in res] == [201] * 10
    assert len(client.get("/api/projects", headers=h).json()) == 10


def test_simultaneous_estimate_recalculations_leave_one_current_estimate(client):
    h = make_user(client)
    pid = client.post("/api/projects", json=copy.deepcopy(PROJECT), headers=h).json()["id"]
    with cf.ThreadPoolExecutor(6) as ex:
        codes = list(ex.map(lambda _: client.post(f"/api/projects/{pid}/estimate", json={}, headers=h).status_code, range(6)))
    assert set(codes) <= {200, 409} and codes.count(200) >= 1
    with SessionLocal() as db:
        assert db.execute(text("select count(*) from project_estimates where project_id = :p"), {"p": pid}).scalar() == 1
    assert client.get(f"/api/projects/{pid}/estimate", headers=h).status_code == 200


# ---- persistence across a real backend restart ---------------------------------------------------------------------------
def _start(data_dir, port):
    env = {**os.environ, "DATA_DIR": data_dir, "JWT_SECRET": "restart-test-secret-0123456789abcdef", "AUTH_ENCRYPTION_KEY": "restart-test-key",
           "RATE_LIMIT_ENABLED": "false", "SEED_SAMPLE_DATA": "false"}
    env.pop("DATABASE_URL", None)
    env.pop("AUTH_DATABASE_URL", None)
    p = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(port), "--log-level", "warning"], cwd=BACKEND, env=env,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(80):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1).read()
            return p
        except Exception:
            time.sleep(0.25)
    p.kill()
    raise AssertionError("server did not start")


def _call(port, method, path, body=None, token=None):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read() or b"null")


@pytest.mark.skipif(bool(os.environ.get("TEST_DATABASE_URL")), reason="restart test uses its own SQLite files")
@pytest.mark.local_auth
def test_accounts_and_projects_survive_a_backend_restart(tmp_path):
    port = 8765
    proc = _start(str(tmp_path), port)
    try:
        r = _call(port, "POST", "/api/auth/signup", {"email": "persist@example.com", "full_name": "Persist", "password": "password123"})
        pid = _call(port, "POST", "/api/projects", copy.deepcopy(PROJECT), r["access_token"])["id"]
    finally:
        proc.terminate(); proc.wait(timeout=20)
    proc = _start(str(tmp_path), port)               # brand-new process, same data directory
    try:
        tok = _call(port, "POST", "/api/auth/login", {"email": "persist@example.com", "password": "password123"})["access_token"]
        assert _call(port, "GET", f"/api/projects/{pid}", token=tok)["name"] == PROJECT["name"]
        assert _call(port, "GET", "/api/auth/me", token=tok)["full_name"] == "Persist"
    finally:
        proc.terminate(); proc.wait(timeout=20)
    raw = (tmp_path / "auth.db").read_bytes()
    assert b"persist@example.com" not in raw and b"password123" not in raw
