# BuildWise AI: architecture audit (before the hardening work)

Method: read the code in `backend/app`, `frontend/src`, the deploy files and the tests. Nothing here is guessed; each finding names the file where it was seen.

## 1. What the application is today

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind, React Three Fiber, Recharts | Single-page app, hosted on Netlify. Calls `/api/...`. |
| Backend | Python, FastAPI, Uvicorn, SQLAlchemy 2, Pydantic 2 | All route handlers are plain `def`, so FastAPI runs them in a thread pool (about 40 threads). One process on Render. |
| Database | SQLite (two files: `buildwise.db`, `auth.db`) by default; PostgreSQL if `DATABASE_URL` is set (added in PR #9, not merged when this audit started) | IDs are UUID strings. |
| Files | Floor plans and PDF reports saved on the server's local disk | Not in the database. |
| Auth | scrypt password hashes, signed JWT (HS256, 12 h), httpOnly cookie, encrypted credential store (`auth.db`) | Added earlier in this project. |
| Deployment | Netlify (static site + `/api` proxy) -> Render free web service (0.1 CPU, 512 MB) | |

Data is permanent on the server (database + disk), not in browser state. The browser keeps only UI preferences (collapsed sidebar, units, active project id) in localStorage.

## 2. Findings

Severity: **High** = can break the app or be abused now; **Medium** = weakens correctness or scale; **Low** = polish.

| # | Sev | Finding | Where | Fix |
|---|---|---|---|---|
| A1 | High | **No rate limiting.** Login and signup can be hammered. Each attempt costs one scrypt hash (about 50-100 ms of CPU), so a small flood can starve the single free CPU. | `api/auth.py` | Per-IP and per-account rate limit on login/signup and a global limit on other routes. |
| A2 | High | **Logout does not invalidate the token.** Logout only deletes the cookie. The signed token stays valid for 12 hours. | `core/security.py`, `api/auth.py` | Per-user `token_version` stored with the credential; logout and password/profile security changes bump it; tokens carry it and are rejected when stale. |
| A3 | High | **Login accepts unlimited password length.** `LoginIn.password` has no maximum, so a multi-megabyte password is hashed with scrypt. | `schemas/__init__.py` | Maximum length matching signup. |
| A4 | High | **N+1 queries.** `project_out()` touches `p.rooms` and `p.estimates` lazily for every project, and the dashboard also lazily loads every estimate item row. Query count grows with the number of projects. | `api/projects.py`, `api/dashboard.py` | Eager loading and a summary query that does not load item rows. |
| A5 | High | **Production database is not durable.** On Render's free plan SQLite lives on an ephemeral disk and can reset. | deployment | PostgreSQL (PR #9). Needs the owner to supply a connection string. |
| A6 | Medium | **No migrations.** Schema is created with `create_all()` plus a hand-written `ALTER TABLE` helper. | `core/db.py` | Alembic with a baseline migration. |
| A7 | Medium | **No database-level constraints** beyond keys and uniqueness. Rules such as `floors >= 1` or `length > 0` exist only in Pydantic. | `models/__init__.py` | CHECK constraints. |
| A8 | Medium | **Missing composite indexes** for the real queries (`projects` by owner ordered by update time, `reports` by owner ordered by date). Single-column indexes exist on every foreign key. | `models/__init__.py` | Add composite indexes. |
| A9 | Medium | **Database failures return a generic 500.** There is no 503 for "database unavailable", no logging at all, and no statement timeout. | `core/errors.py` | Handle `OperationalError`/`TimeoutError` as 503 with `Retry-After`; log; timeouts. |
| A10 | Medium | **No security headers** (nosniff, frame-ancestors, referrer policy, HSTS, CSP for the API). | `main.py` | Middleware. |
| A11 | Medium | **No request-size limit** on JSON bodies (uploads are capped, JSON is not). | `main.py` | Body size limit. |
| A12 | Medium | **Files on local disk** (floor plans, PDFs) cannot be shared by several backend instances. | `services/floorplan`, `services/reports` | Documented limitation; object storage is the scaling step. |
| A13 | Low | Password policy is length only (8 to 128). | `schemas` | Kept; documented. |
| A14 | Low | No `.env.example` for the backend. | repo | Added. |

## 3. What is already correct (kept, not rebuilt)

- Every project, floor plan, estimate and report route checks ownership on the server and answers 404 for other users' ids (`api/deps.py`).
- Passwords are salted scrypt hashes; the login timing for unknown emails is equalised.
- Credentials live in a separate store with the email and name encrypted; the project database holds only an opaque user id.
- Session cookie is httpOnly, SameSite=Lax, Secure over HTTPS; nothing secret in localStorage.
- Database access goes through SQLAlchemy with bound parameters (no string-built SQL).
- Foreign keys use `ON DELETE CASCADE`; the estimate for a project is replaced inside one transaction.
- Input is validated with Pydantic on every write route.

## 4. Order of work

1. Database: Alembic baseline, constraints, indexes, error handling, pooling, `.env.example`.
2. Auth: rate limiting, token revocation, password max length, headers, body limit.
3. Performance: remove the N+1 queries, add timing/metrics, then measure with Locust at 10/25/50/100 virtual users.
4. Tests for each item, and a final report with measured numbers only.
