# BuildWise AI: technical report (database, authentication, capacity)

Written for the project mentor. Every number below was **measured** unless it is explicitly marked *estimate* or *not tested*.

## 1. The three concerns and what was done

| Mentor's concern | Finding (before) | What was done (now) |
|---|---|---|
| Database architecture | 11 normalized tables with keys, foreign keys and single-column indexes, but no database-level rules, no migrations, files on the server disk, SQLite on a free host that can reset | Supabase PostgreSQL schema with CHECK constraints, composite indexes, Row Level Security, private Storage (applied to the project); the same schema rules in the app's own models; PostgreSQL support; repeatable SQL migrations; read-only backup tool |
| Authentication and authorization | Custom login existed (scrypt, JWT, ownership checks) but: no rate limiting, logout did not invalidate the token, unbounded login password length, no security headers | Hardened the existing login (rate limits, server-side logout, headers, size limits) **and** added Supabase Auth as an optional switch with database-level Row Level Security |
| How many users at once? | Unknown | Measured with Locust at 10/25/50/100 (and 150/200/300 where stated) virtual users; results in section 6 |

The full list of findings with severities is in [`AUDIT.md`](AUDIT.md).

## 2. Architecture

```
 Browser (React + Three.js)
   │  login / logout ───────────────────────────►  Authentication
   │     default: the app's own login (scrypt hashes, httpOnly cookie, encrypted credential store)
   │     optional: Supabase Auth (bearer access token)
   ▼
 Netlify (static site, /api forwarded) ──► FastAPI backend (Render) ──►  AuthN: verify token / session
                                              │                          AuthZ: ownership check + Row Level Security
                                              │ per-request role switch
                                              ▼
                                       PostgreSQL (Supabase)  or  SQLite (default)
                                       Storage: Supabase buckets  or  server disk (default)

 Load testing:  Locust ──► backend (local)      Monitoring during tests: psutil (CPU, memory), pg_stat_activity (DB connections)
```

## 3. Database design

Ten tables (`supabase/migrations/`): `profiles`, `projects`, `project_rooms`, `floor_plan_files`, `materials`, `material_price_records`,
`project_estimates`, `estimate_items`, `optimization_recommendations`, `reports`.

Relationships: a user owns projects; a project has rooms, floor plans, one current estimate (with items and recommendations) and reports;
materials are either shared samples (`owner_id` null) or a user's own; price records belong to a material (and optionally a user).
All user-owned rows carry `owner_id → auth.users(id) ON DELETE CASCADE`, so deleting a user removes their data.

Constraints (enforced by the database, not only by the API): floors 1–50, positive dimensions, non-negative prices and counts, name lengths.
Indexes follow the real queries (for example `projects(owner_id, updated_at desc)`, `project_rooms(project_id, floor_number, created_at)`).
Supabase's own advisors report **no security findings**; the performance advisor's only remaining items are "index not used yet", which is expected for a database without traffic.

Transactions: the estimate for a project is replaced in one transaction, and the project row is locked first so two simultaneous recalculations queue instead of both inserting (tested with concurrent requests).

## 4. Authentication and authorization

* **Default login:** passwords are salted scrypt hashes; the e-mail and name are encrypted (Fernet) in a separate store; the session is an httpOnly, SameSite cookie; nothing secret is kept in localStorage.
* **Added in this work:** rate limit on login (per IP and per account+IP), on sign-up, and on expensive endpoints (per user); logout invalidates the token on the server (token version);
  login password length is bounded before hashing; security headers; JSON body size limit; CORS limited to the configured origins.
* **Supabase option:** the backend verifies the Supabase access token (signature against the project's public signing keys, expiry, audience `authenticated`, issuer; the anonymous key does not count as a user),
  then runs the request's SQL as the `authenticated` role with that user's id. Row Level Security therefore applies to the backend's own queries as well as to any other access path.
* **Authorization:** every project/estimate/report/file route checks ownership on the server (404 for other users' ids), and in Supabase mode the database refuses cross-user access independently.

Tested (backend suite, all passing): wrong password and unknown user give the same answer; throttling; logout kills the token; forged, expired, wrong-audience, wrong-issuer, wrong-key, `alg: none` and anonymous-role tokens are rejected;
a second user can neither read, update, delete nor attach rows to the first user's data; the anonymous role cannot read any table; storage is confined to the user's own folder.
A deliberately weakened policy made the Row Level Security tests fail, so the tests do detect problems.

## 5. What was **not** verified

* **Nothing was run against the real Supabase project's auth or database from the test environment:** its network policy blocks `*.supabase.co`. Real sign-up, the live database connection and live Storage are therefore untested.
  The schema was applied with Supabase's own tooling and checked afterwards (tables, Row Level Security on, policies, buckets, advisors); the policy and token logic was tested on a local PostgreSQL that runs the **same migration files**.
* **Live Row Level Security check on the real BuildWise-AI project: done** (run by the project owner in the Supabase SQL editor; temporary users and rows, rolled back, afterwards the project again had 0 users/projects/rooms/profiles).
  Result: a second user saw 0 rows of the first user's project, updated 0, deleted 0; attaching a room to it and creating a project in the other user's name were refused; the anonymous role was denied.
  Not covered by it: the shared sample catalogue (the table was still empty, so that check was vacuous), real sign-up/login through Supabase Auth, and Storage.
* **No load test against real Supabase or the deployed Render service** has been run (no staging project exists; the deployed host is a free 0.1-CPU instance and must not be stress-tested).

## 6. Load testing

### Method
Locust, 1 virtual user = 1 signed-in person doing realistic things with 1–3 s think time: dashboard, project list, open project, view estimate, catalogue (materials + prices),
recalculate estimate, reports list, create + delete a project, generate a PDF report. About 85 % of the actions are reads; the rest are recalculations, project create/delete and PDF generation (by task weight in `loadtest/locustfile.py`).
Test accounts are created beforehand (no repeated sign-up or login against an auth service; in the built-in-login runs each user logs in once, which includes a password hash each).
Each level runs 60 seconds with a ramp of 10 users/second. The runner records server CPU and memory (psutil) and database connections (`pg_stat_activity`).
**Targets used:** error rate ≤ 1 % and p95 of all requests ≤ 1500 ms.

### Environment (important for reading the numbers)
Everything ran on **one 4-CPU / 16 GB test machine** that also ran Locust and PostgreSQL; the database was a local PostgreSQL 16 (round trips of microseconds, not a remote Supabase region).
The deployed Render free plan has about 0.1 CPU, so absolute numbers do **not** transfer to it. They show how the application code behaves and where it saturates.

### Results (measured)

Single backend process unless stated. "Before" = the code before this work, "after" = the code in this pull request.

| Setup | Users | Req/s | Median | p95 | p99 | Errors | Server CPU max | Memory | DB conns |
|---|---|---|---|---|---|---|---|---|---|
| Before, SQLite | 10 | 6.1 | 11 ms | 120 ms | 420 ms | 0 % | 98 % | 273 MB | n/a |
| | 25 | 14.9 | 11 ms | 100 ms | 200 ms | 0 % | 103 % | 294 MB | |
| | 50 | 28.8 | 13 ms | 150 ms | 240 ms | 0 % | 128 % | 329 MB | |
| | 100 | 43.1 | 440 ms | 1400 ms | 2100 ms | 0 % | 211 % | 587 MB | |
| After, SQLite | 10 | 5.9 | 11 ms | 110 ms | 230 ms | 0 % | 102 % | 277 MB | n/a |
| | 25 | 14.8 | 12 ms | 120 ms | 260 ms | 0 % | 115 % | 345 MB | |
| | 50 | 28.4 | 15 ms | 170 ms | 250 ms | 0 % | 138 % | 416 MB | |
| | 100 | 44.3 | 390 ms | 1300 ms | 2200 ms | 0 % | 199 % | 627 MB | |
| Before, PostgreSQL | 10 | 6.3 | 15 ms | 120 ms | 300 ms | 0 % | 113 % | 297 MB | 16 |
| | 25 | 15.3 | 16 ms | 120 ms | 210 ms | 0 % | 101 % | 347 MB | 14 |
| | 50 | 28.7 | 21 ms | 150 ms | 250 ms | 0 % | 142 % | 381 MB | 22 |
| | 100 | 46.6 | 270 ms | 1000 ms | 1500 ms | 0 % | 195 % | 618 MB | 30 |
| After, PostgreSQL | 10 | 6.0 | 16 ms | 130 ms | 210 ms | 0 % | 95 % | 300 MB | 20 |
| | 25 | 14.7 | 16 ms | 110 ms | 190 ms | 0 % | 94 % | 366 MB | 20 |
| | 50 | 28.5 | 24 ms | 200 ms | 360 ms | 0 % | 127 % | 419 MB | 32 |
| | 100 | 49.3 | 200 ms | 670 ms | 1100 ms | 0 % | 193 % | 634 MB | 60 |
| Supabase mode (local PostgreSQL, RLS + token check), 1 process | 10 | 6.1 | 15 ms | 100 ms | 150 ms | 0 % | 35 % | 113 MB | 10 |
| | 25 | 14.6 | 16 ms | 110 ms | 210 ms | 0 % | 47 % | 120 MB | 11 |
| | 50 | 28.5 | 19 ms | 140 ms | 260 ms | 0 % | 108 % | 133 MB | 11 |
| | 100 | 51.8 | 98 ms | 510 ms | 920 ms | 0 % | 126 % | 164 MB | 30 |
| Supabase mode, 2 processes | 10 | 6.0 | 15 ms | 98 ms | 230 ms | 0 % | 41 % | 262 MB | 12 |
| | 25 | 14.9 | 15 ms | 81 ms | 220 ms | 0 % | 67 % | 272 MB | 17 |
| | 50 | 29.1 | 15 ms | 110 ms | 230 ms | 0 % | 112 % | 290 MB | 20 |
| | 100 | 55.0 | 21 ms | 170 ms | 300 ms | 0 % | 169 % | 315 MB | 22 |

### Higher load: where it stops meeting the targets (Supabase mode, local PostgreSQL)

| Processes | Users | Req/s | Median | p95 | p99 | Errors | Server CPU max | Meets targets? |
|---|---|---|---|---|---|---|---|---|
| 1 | 100 (above) | 51.8 | 98 ms | 510 ms | 920 ms | 0 % | 126 % | yes |
| 1 | 150 | 57.6 | 640 ms | 1700 ms | 2200 ms | 0 % | 136 % | **no** (p95 above 1500 ms) |
| 1 | 200 | 55.0 | 1600 ms | 3000 ms | 3600 ms | 0 % | 131 % | no |
| 1 | 300 | 28.3 | 920 ms | 13000 ms | 30000 ms | **5.1 %** | 130 % | no (requests time out) |
| 2 | 100 (above) | 55.0 | 21 ms | 170 ms | 300 ms | 0 % | 169 % | yes |
| 2 | 150 | 77.8 | 33 ms | 240 ms | 480 ms | 0 % | 191 % | yes |
| 2 | 200 | 94.2 | 110 ms | 570 ms | 970 ms | 0.05 % | 205 % | yes |
| 2 | 300 | 89.2 | 890 ms | 2500 ms | 3400 ms | 0.04 % | 218 % | **no** (p95 above 1500 ms) |

* **One process:** throughput stops growing at about 55–58 requests/s (the process is saturated: the extra users only wait longer). Beyond about 200 users requests start to time out (5 % errors at 300). The slowest calls under overload are the PDF report, the estimate recalculation and the catalogue list.
* **Two processes:** throughput rises to about 90 requests/s and the targets are still met at 200 users; at 300 users latency grows (p95 2.5 s) but almost nothing fails.
* **Highest tested level that met the targets (error rate ≤ 1 %, p95 ≤ 1.5 s): 100 users with one process, 200 users with two processes** on the test machine. These are *tested* levels, **not the maximum capacity**: the limit lies between 100 and 150 (one process) and between 200 and 300 (two processes), at the 50/100-user resolution of these runs.
* Caveat: Locust, the backend processes and PostgreSQL shared the same 4 CPUs, so the machine itself was close to saturation at the top levels; with the load generator on another machine the limits could be higher. The figures were measured once per level.


### How to read this
* **Up to 50 users** every setup answers in about 10–25 ms (median) with 0 % errors. Throughput grows in step with the number of users because users pause between actions: the server is not the limit.
* **At 100 users with one process** the server uses almost two CPU cores (Python threads plus the CPU-heavy parts) and latency rises sharply (median 200–440 ms, p95 0.7–1.4 s, in the built-in-login runs). With **two processes** it stays flat (median 21 ms, p95 170 ms). So the practical limit of one process is **CPU, not the database**.
* **Slowest operations at 100 users (PostgreSQL, after):** PDF report generation (median 740 ms), estimate recalculation (median 660 ms), the catalogue list (median 390 ms): these are computation and serialization in Python.
* **Effect of the changes:** the PostgreSQL run improved (p95 1000 → 670 ms, p99 1500 → 1100 ms at 100 users); the SQLite run did not change beyond run-to-run noise (p95 1400 → 1300 ms). Each configuration was measured once, so differences of this size are *indicative, not proven*.
* The Supabase-mode runs look faster than the built-in-login runs at 100 users **partly because of the test set-up**: they use pre-made tokens, whereas each built-in-login user starts with a password hash (a deliberately slow, CPU-heavy operation). That comparison shows the cost of password hashing, not an advantage of Supabase.
* "DB conns" of 60 in the PostgreSQL "after" run equals two pools of 30 (10 + 20 overflow each: application data and the built-in credential store, which uses its own pool), i.e. both at their maximum. This is an inference from the configuration, not a separate measurement. Supabase mode needs only the first pool.

### Answer to "how many users can use BuildWise at the same time?"
* **Measured, on the test machine** (active users who act every 1–3 s): one backend process met the targets up to **100 simultaneous users** and failed them at 150; two backend processes met them up to **200 simultaneous users** and failed them at 300.
  These are the highest *tested* levels that met the targets (not the absolute maximum; see the higher-load table for what happens beyond).
* **Not measured:** the capacity of the deployed Render free instance, of real Supabase over the internet, or of any setup with more than two processes. Do not quote the numbers above as the capacity of the deployed site.
* *Estimate (not a measurement):* because the limit is CPU in the Python process, more processes or a bigger instance should raise it roughly in proportion until the database becomes the limit. This should be verified with the same scripts.

## 7. Known limitations and remaining risks

* Free hosting: Render's free instance sleeps after inactivity (first request is slow) and its disk is not durable; Supabase's free projects pause after a period without activity (as happened to this project once).
* Rate limiting is in-process: with several backend instances each counts separately (a shared store such as Redis is the next step).
* Floor plans and PDFs are stored in Supabase Storage only in Supabase mode; in the default setup they are files on the server's disk.
* Row Level Security protects every table, but the backend connects with a powerful database role (it needs to run the seeding of the shared catalogue); that role's connection string is a secret and must live only in Render's environment.
* Password policy is length-based (8–128 characters); there is no e-mail verification or password reset in the default login (Supabase Auth provides both when enabled).
* Load tests used one machine for the load generator, the application and the database, which makes them conservative for the application but unrealistic for network latency.

## 8. Running things

See [`SUPABASE.md`](SUPABASE.md) for set-up, switching Supabase on and off, backups and rollback.

```
# backend tests (three modes)
cd backend && pytest
TEST_DATABASE_URL=postgresql://user@/db pytest
TEST_DATABASE_URL=postgresql://user@/db TEST_AUTH_PROVIDER=supabase pytest
# frontend
cd frontend && npx tsc -b && npm run lint && npx vitest run && npm run build
# load tests (local only, never against production)
python loadtest/run_load_tests.py --tag my-run --db sqlite --workers 1
python loadtest/run_load_tests.py --tag my-run --db postgres --auth supabase --workers 2 --pg-url postgresql://user@/db
```

## 9. Future scaling options
Several backend processes or instances behind a load balancer; a shared rate-limit store; Supabase connection pooler sized for the number of instances; caching of the shared catalogue; moving PDF generation to a background worker;
a paid database tier; a staging Supabase project for realistic end-to-end load tests; monitoring with Supabase reports and `pg_stat_statements`.
