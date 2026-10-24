#!/usr/bin/env python3
"""Repeatable load test runner.

Starts a LOCAL BuildWise backend on its own temporary database, creates test accounts (each with a demo project),
runs Locust at several virtual-user levels and records throughput, latency percentiles, errors, server CPU/memory
and database connections. Never point it at production.

    python run_load_tests.py --tag sqlite-1w  --db sqlite   --workers 1
    python run_load_tests.py --tag pg-2w      --db postgres --workers 2 --pg-url postgresql://user@/dbname?host=/tmp&port=5433
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import psutil

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent / "backend"
RESULTS = HERE / "results"
PORT = 8010
FAKE_STORAGE_PORT = 8011
SB_URL = f"http://127.0.0.1:{FAKE_STORAGE_PORT}"   # stand-in Supabase project URL (storage only) for LOCAL Supabase-mode runs
TARGET_ERROR_RATE = 1.0     # percent
TARGET_P95_MS = 1500        # ms, aggregate of all requests


def http(method, path, body=None, headers=None):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read() or b"null")



_SB = {}


def prepare_supabase_db(pg_url: str, n_users: int):
    """LOCAL Supabase-like database: stand-ins for auth/storage + the real migration files, test users, long-lived test tokens."""
    import jwt
    import psycopg
    from cryptography.hazmat.primitives.asymmetric import rsa
    from jwt.algorithms import RSAAlgorithm

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = json.loads(RSAAlgorithm.to_jwk(key.public_key()))
    jwk.update(kid="lt-key", alg="RS256", use="sig")
    with psycopg.connect(pg_url, autocommit=True) as c:
        for schema in ("public", "auth", "storage"):
            c.execute(f"drop schema if exists {schema} cascade")
        c.execute("create schema public")
        c.execute((BACKEND / "tests" / "supabase" / "stubs.sql").read_text())
        for f in sorted((HERE.parent / "supabase" / "migrations").glob("*.sql")):
            c.execute(f.read_text())
        users = []
        now = int(time.time())
        for i in range(n_users):
            uid, email = str(uuid.uuid4()), f"lt{i}@example.com"
            c.execute("insert into auth.users (id, email, raw_user_meta_data) values (%s, %s, %s::jsonb)", (uid, email, json.dumps({"full_name": f"Load Tester {i}"})))
            tok = jwt.encode({"sub": uid, "email": email, "role": "authenticated", "aud": "authenticated", "iss": f"{SB_URL}/auth/v1", "iat": now,
                              "exp": now + 4 * 3600, "user_metadata": {"full_name": f"Load Tester {i}"}}, key, algorithm="RS256", headers={"kid": "lt-key"})
            users.append({"email": email, "token": tok})
    _SB["jwks"] = json.dumps({"keys": [jwk]})
    (RESULTS / "users.json").write_text(json.dumps(users))
    return users


class _FakeStorage(BaseHTTPRequestHandler):
    """In-memory stand-in for Supabase Storage so PDF/report requests can run locally (measures our client, NOT real Supabase latency)."""
    files: dict = {}

    def log_message(self, *a):
        pass

    def _go(self, method):
        n = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(n) if n else b""
        path = self.path.split("/storage/v1/object/", 1)[-1].replace("authenticated/", "", 1)
        ok = self.headers.get("Authorization", "").startswith("Bearer ") and self.headers.get("apikey")
        code, out = (401, b"") if not ok else (200, b"")
        if ok and method == "POST":
            self.files[path] = body
        elif ok and method == "DELETE":
            self.files.pop(path, None)
        elif ok and method in ("GET", "HEAD"):
            code, out = (200, self.files[path]) if path in self.files else (404, b"")
        self.send_response(code)
        self.send_header("content-length", str(len(out) if method != "HEAD" else 0))
        self.end_headers()
        if method != "HEAD":
            self.wfile.write(out)

    do_POST = lambda s: s._go("POST")  # noqa: E731
    do_GET = lambda s: s._go("GET")  # noqa: E731
    do_HEAD = lambda s: s._go("HEAD")  # noqa: E731
    do_DELETE = lambda s: s._go("DELETE")  # noqa: E731


def start_server(args, data_dir):
    env = {**os.environ, "DATA_DIR": data_dir, "JWT_SECRET": "loadtest-secret-not-for-production-0123456789",
           "AUTH_ENCRYPTION_KEY": "loadtest-auth-key", "RATE_LIMIT_ENABLED": "false", "SEED_SAMPLE_DATA": "true"}
    if args.auth == "supabase":
        env.update(AUTH_PROVIDER="supabase", SUPABASE_URL=SB_URL, SUPABASE_PUBLISHABLE_KEY="sb_publishable_loadtest", SUPABASE_JWKS_JSON=_SB["jwks"], SEED_SAMPLE_DATA="true")
    if args.db == "postgres":
        env["DATABASE_URL"] = args.pg_url
    else:
        env.pop("DATABASE_URL", None)
    env.update(DB_POOL_SIZE=str(args.pool_size), DB_MAX_OVERFLOW=str(args.pool_overflow))
    cmd = [str(BACKEND / ".venv/bin/uvicorn"), "app.main:app", "--port", str(PORT), "--workers", str(args.workers), "--log-level", "warning"]
    proc = subprocess.Popen(cmd, cwd=BACKEND, env=env, stdout=open(RESULTS / f"{args.tag}.server.log", "w"), stderr=subprocess.STDOUT)
    for _ in range(120):
        try:
            if http("GET", "/api/health")["status"] == "ok":
                return proc
        except Exception:
            time.sleep(0.5)
    proc.kill()
    raise SystemExit("server did not start")


def seed_users(n, supabase=False):
    if supabase:
        users = json.loads((RESULTS / "users.json").read_text())
        for u in users:
            http("POST", "/api/demo/seed", headers={"Authorization": f"Bearer {u['token']}"})
        return
    users = []
    for i in range(n):
        cred = {"email": f"lt{i}@example.com", "password": "LoadTest-pass-1"}
        r = http("POST", "/api/auth/signup", {**cred, "full_name": f"Load Tester {i}"})
        http("POST", "/api/demo/seed", headers={"Authorization": f"Bearer {r['access_token']}"})
        users.append(cred)
    (RESULTS / "users.json").write_text(json.dumps(users))


class Sampler(threading.Thread):
    """Samples CPU% and RSS of the server process tree, and open database connections (PostgreSQL only)."""

    def __init__(self, pid, pg_url):
        super().__init__(daemon=True)
        self.pid, self.pg_url, self.stop, self.cpu, self.rss, self.conns = pid, pg_url, threading.Event(), [], [], []

    def run(self):
        root = psutil.Process(self.pid)
        procs = {p.pid: p for p in [root, *root.children(recursive=True)]}
        for p in procs.values():
            p.cpu_percent(None)
        pg = None
        if self.pg_url:
            import psycopg
            pg = psycopg.connect(self.pg_url, autocommit=True)
        while not self.stop.wait(1.0):
            for c in root.children(recursive=True):
                procs.setdefault(c.pid, c)
            cpu = rss = 0.0
            for p in list(procs.values()):
                try:
                    cpu += p.cpu_percent(None)
                    rss += p.memory_info().rss
                except psutil.Error:
                    pass
            self.cpu.append(cpu)
            self.rss.append(rss / 1048576)
            if pg:
                self.conns.append(pg.execute("select count(*) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()").fetchone()[0])


def run_level(args, users, outdir):
    csv_prefix = outdir / f"{args.tag}_u{users}"
    cmd = [str(BACKEND / ".venv/bin/locust"), "-f", str(HERE / "locustfile.py"), "--headless", "-u", str(users), "-r", str(min(users, args.spawn_rate)),
           "-t", f"{args.duration}s", "--host", f"http://127.0.0.1:{PORT}", "--csv", str(csv_prefix), "--only-summary"]
    env = {**os.environ, "THINK_MIN": str(args.think_min), "THINK_MAX": str(args.think_max)}
    subprocess.run(cmd, env=env, cwd=HERE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    rows = list(csv.DictReader(open(f"{csv_prefix}_stats.csv")))
    return rows


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def summarize(rows, sampler, users, duration):
    agg = next(r for r in rows if r["Name"] == "Aggregated")
    total, fails = num(agg["Request Count"]), num(agg["Failure Count"])
    out = {
        "users": users, "duration_s": duration, "requests": int(total), "failures": int(fails),
        "error_rate_pct": round(100 * fails / total, 2) if total else 100.0, "rps": round(num(agg["Requests/s"]), 1),
        "avg_ms": round(num(agg["Average Response Time"])), "median_ms": round(num(agg["Median Response Time"])),
        "p95_ms": round(num(agg["95%"])), "p99_ms": round(num(agg["99%"])), "max_ms": round(num(agg["Max Response Time"])),
        "cpu_avg_pct": round(sum(sampler.cpu) / len(sampler.cpu), 1) if sampler.cpu else None, "cpu_max_pct": round(max(sampler.cpu), 1) if sampler.cpu else None,
        "rss_max_mb": round(max(sampler.rss)) if sampler.rss else None,
        "db_conns_max": max(sampler.conns) if sampler.conns else None,
        "endpoints": {r["Name"]: {"n": int(num(r["Request Count"])), "fail": int(num(r["Failure Count"])), "median": round(num(r["Median Response Time"])),
                                  "p95": round(num(r["95%"])), "p99": round(num(r["99%"]))} for r in rows if r["Name"] != "Aggregated"},
    }
    out["meets_targets"] = out["error_rate_pct"] <= TARGET_ERROR_RATE and out["p95_ms"] <= TARGET_P95_MS
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", required=True)
    ap.add_argument("--db", choices=["sqlite", "postgres"], default="sqlite")
    ap.add_argument("--pg-url", default="")
    ap.add_argument("--auth", choices=["local", "supabase"], default="local", help="supabase = LOCAL Supabase-like database with RLS + JWT verification (needs --db postgres)")
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--pool-size", type=int, default=10)
    ap.add_argument("--pool-overflow", type=int, default=20)
    ap.add_argument("--levels", type=int, nargs="+", default=[10, 25, 50, 100])
    ap.add_argument("--duration", type=int, default=60)
    ap.add_argument("--spawn-rate", type=int, default=10)
    ap.add_argument("--think-min", type=float, default=1.0)
    ap.add_argument("--think-max", type=float, default=3.0)
    args = ap.parse_args()
    RESULTS.mkdir(exist_ok=True)
    data_dir = tempfile.mkdtemp(prefix="bw-load-")
    fake = None
    if args.auth == "supabase":
        assert args.db == "postgres", "--auth supabase needs --db postgres"
        prepare_supabase_db(args.pg_url, max(args.levels))
        fake = ThreadingHTTPServer(("127.0.0.1", FAKE_STORAGE_PORT), _FakeStorage)
        threading.Thread(target=fake.serve_forever, daemon=True).start()
    elif args.db == "postgres":
        import psycopg
        with psycopg.connect(args.pg_url, autocommit=True) as c:  # fresh, empty schema for every run
            c.execute("drop schema public cascade")
            c.execute("create schema public")
    proc = start_server(args, data_dir)
    results = []
    try:
        seed_users(max(args.levels), supabase=args.auth == "supabase")
        for users in args.levels:
            sampler = Sampler(proc.pid, args.pg_url if args.db == "postgres" else None)
            sampler.start()
            rows = run_level(args, users, RESULTS)
            sampler.stop.set()
            sampler.join()
            res = summarize(rows, sampler, users, args.duration)
            results.append(res)
            print(f"{args.tag} users={users}: {res['requests']} req, {res['rps']} rps, median {res['median_ms']} ms, p95 {res['p95_ms']} ms, "
                  f"p99 {res['p99_ms']} ms, errors {res['error_rate_pct']}%, cpu max {res['cpu_max_pct']}%, rss {res['rss_max_mb']} MB, db conns {res['db_conns_max']}, "
                  f"targets {'MET' if res['meets_targets'] else 'MISSED'}", flush=True)
    finally:
        proc.terminate()
        proc.wait(timeout=30)
        if fake:
            fake.shutdown()
        shutil.rmtree(data_dir, ignore_errors=True)
    meta = {"tag": args.tag, "db": args.db, "auth": args.auth, "workers": args.workers, "pool": [args.pool_size, args.pool_overflow], "duration_s": args.duration, "think_time_s": [args.think_min, args.think_max], "targets": {"error_rate_pct": TARGET_ERROR_RATE, "p95_ms": TARGET_P95_MS},
            "machine": {"cpus": psutil.cpu_count(), "ram_gb": round(psutil.virtual_memory().total / 2**30)}, "results": results}
    (RESULTS / f"{args.tag}.json").write_text(json.dumps(meta, indent=1))
    ok = [r["users"] for r in results if r["meets_targets"]]
    print(f"highest level meeting targets: {max(ok) if ok else 'none'}")


if __name__ == "__main__":
    sys.exit(main())
