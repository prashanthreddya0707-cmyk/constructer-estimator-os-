# Using Supabase with BuildWise AI

Supabase provides three things here: the **PostgreSQL database**, **Supabase Auth** (accounts and sessions) and private **Storage**
buckets for floor plans and PDF reports. It is **optional and off by default**: the app keeps working exactly as before until you switch it on.

## 1. Architecture

```
 Browser (React, Three.js)
   │  sign up / log in / log out  ───────────────►  Supabase Auth  (passwords, sessions, e-mail confirmation)
   │  Authorization: Bearer <Supabase access token>
   ▼
 Netlify  ──/api/*──►  FastAPI backend (Render)
                          1. verifies the token (signature, expiry, audience, issuer) against Supabase's public signing keys
                          2. opens a database transaction as the `authenticated` role with the user's id  ──►  Supabase PostgreSQL
                             (Row Level Security applies to every query)                                    (RLS on every table)
                          3. estimates, 3D layout summary, PDFs, room detection: the existing Python code (unchanged)
                          4. floor plans / PDFs  ──(user's own token)──►  Supabase Storage (private buckets, one folder per user)
```

* The browser never reads or writes database tables directly, so Supabase's *Data API can stay switched off*.
* Only the **public** project URL and **publishable** key are used in the browser. The **service-role key is never used anywhere** in this project.
* The backend's database password (inside `DATABASE_URL`) is a secret held only in Render's environment variables.

## 2. Switches

| Where | Variable | Default | Switches on Supabase |
|---|---|---|---|
| Backend | `AUTH_PROVIDER` | `local` | `supabase` |
| Backend | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | empty | the public values of your project |
| Backend | `DATABASE_URL` | SQLite file | the Supabase **Session pooler** connection string (secret) |
| Frontend (build time) | `VITE_AUTH_PROVIDER` | `local` | `supabase` |
| Frontend (build time) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | empty | the same public values |

With the defaults nothing in the Supabase code runs, and the production frontend bundle does not even contain the Supabase library.
Both switches must be changed together (they are separate because the website and the API are deployed separately).

## 3. Database (already applied to the BuildWise-AI project)

SQL files in `supabase/migrations/` (apply in order; each is safe to run twice):

| File | Content |
|---|---|
| `20261023000000_buildwise_tables.sql` | tables, constraints (CHECKs), composite indexes, `updated_at` triggers |
| `20261023000100_buildwise_rls.sql` | Row Level Security, privileges, policies |
| `20261023000200_buildwise_storage.sql` | private buckets `floorplans`, `reports` and their policy |
| `20261024000000_reports_estimate_index.sql` | index flagged by Supabase's performance advisor |
| `20261024000100_split_catalogue_write_policies.sql` | one policy per action on the catalogue (advisor warning) |

Tables: `profiles`, `projects`, `project_rooms`, `floor_plan_files`, `materials`, `material_price_records`, `project_estimates`,
`estimate_items`, `optimization_recommendations`, `reports`. Every user-owned row has `owner_id → auth.users(id) ON DELETE CASCADE`.

### Row Level Security in one table

| Table | Who can read | Who can write |
|---|---|---|
| `projects`, `project_rooms`, `floor_plan_files`, `project_estimates`, `estimate_items`, `optimization_recommendations`, `reports` | the owner only | the owner only, and a child row must hang under one of the owner's own projects/estimates |
| `materials`, `material_price_records` | shared samples (`owner_id` null) + the owner's own | the owner's own rows only (samples are read-only) |
| `profiles` | own row | own row |
| Storage `floorplans`, `reports` | own folder `<user id>/…` | own folder |
| everyone not signed in (`anon`) | nothing | nothing |

The profile row is created on a user's first request (a trigger on `auth.users` is not used because that table belongs to Supabase's auth service).

## 4. Setup (when you decide to switch it on)

1. **Back up** what you have: `python scripts/backup_data.py` (read-only; also `--pg-url` for a PostgreSQL dump). Backups are git-ignored.
2. Supabase dashboard → project **BuildWise-AI** → *Authentication → Providers → Email*. For a demo you may turn **Confirm email** off; otherwise
   users must click the e-mail link before their first login (the sign-up page tells them so).
3. *Connect → Session pooler → URI*: copy it and put your database password in. This is `DATABASE_URL`. **Never commit it or paste it into chat.**
4. *Project Settings → API*: copy the **Project URL** and the **publishable** key (not the service-role key).
5. **Render** → Environment: `AUTH_PROVIDER=supabase`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`, `TRUST_PROXY_HEADERS=true`,
   keep `CORS_ORIGINS`. Redeploy. Check `/api/health/ready` shows `"auth_provider":"supabase","database":"ok"`.
6. **Netlify** → Environment variables: `VITE_AUTH_PROVIDER=supabase`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. Redeploy (clear cache).
7. Create an account on the site, log in, **Load demo & open 3D**, download a PDF. In Supabase *Table Editor* you will see the rows.

**Rollback:** set `AUTH_PROVIDER=local` and `VITE_AUTH_PROVIDER=local` and redeploy. The old SQLite data and login system are untouched by any of this.

## 5. What happens to existing accounts and data

* Existing accounts are **not migrated**: users register again through Supabase Auth (decision recorded with the project owner).
  Old passwords are scrypt hashes, which Supabase Auth cannot import.
* The Supabase database starts **clean**; demo data comes from the *Load demo* button, shared sample materials from the backend's start-up seeding.
* The local/Render SQLite databases are never modified or deleted by the Supabase work. `scripts/backup_data.py` makes a verified copy first.
  The live Render database cannot be read from the development environment, so for it: use *Render → service → Shell* (paid) or simply leave
  it in place: it is still there when `AUTH_PROVIDER=local`.

## 6. Tests

```
# the built-in login system (default): SQLite
cd backend && pytest
# the same on a real PostgreSQL server (database is wiped on every run: use a throw-away one)
TEST_DATABASE_URL=postgresql://user@/db?host=/tmp&port=5433 pytest
# Supabase mode: applies the real supabase/migrations/*.sql to a throw-away PostgreSQL, issues Supabase-style tokens
TEST_DATABASE_URL=postgresql://user@/db?host=/tmp&port=5433 TEST_AUTH_PROVIDER=supabase pytest
```

The Supabase-mode run executes the whole API test-suite under Row Level Security, plus `tests/test_supabase_rls.py`
(cross-user reads/writes/deletes, `anon` has no access, storage folder rule, forged/expired/wrong-audience/wrong-key tokens).
A deliberately weakened policy makes these tests fail (checked), so they are not vacuous.

## 7. Load testing

`loadtest/` holds a Locust setup with realistic journeys (dashboard, projects, estimates, catalogue, recalculation, create/delete project, PDF).
`run_load_tests.py` starts a **local** backend, creates test accounts, runs 10/25/50/100 virtual users and records requests per second,
median/p95/p99 latency, error rate, server CPU/memory and database connections.

```
python loadtest/run_load_tests.py --tag sqlite-1w --db sqlite --workers 1
python loadtest/run_load_tests.py --tag pg-1w     --db postgres --pg-url "postgresql://user@/db" --workers 1
python loadtest/run_load_tests.py --tag sb-1w     --db postgres --auth supabase --pg-url "postgresql://user@/db" --workers 1
```

Results of the runs done so far are in `docs/TECHNICAL_REPORT.md`. **A run against a real Supabase project has not been done yet**:
it needs a separate *staging* Supabase project and a backend that can reach it (never the production project). Steps and the
limits of the numbers are in the report.
