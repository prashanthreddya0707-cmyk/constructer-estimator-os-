# BuildWise AI — *Plan Smarter. Build Better.*

A full-stack construction-planning application (college field project):

`BUILDING INPUT → 3D VISUALIZATION → MATERIAL ESTIMATION → COST ANALYSIS → WASTE OPTIMIZATION → PDF REPORT`

It runs entirely locally: no paid services, no external AI APIs, no cloud credentials.

> **Honest scope notes**
> * Quantity estimates and recommendations are **rule-based calculations**, not machine-learning predictions.
> * All figures are **preliminary planning estimates** and must be verified by a qualified engineer before procurement or construction.
> * Built-in material prices are **SAMPLE placeholders**, clearly labelled in the UI and PDF. Enter locally verified rates in *Material Prices*.
> * Floor-plan upload supports scale calibration and an optional OpenCV edge/contour **visual aid**. It does **not** automatically detect rooms or exact dimensions; you confirm/enter dimensions manually. The 3D model is generated from those confirmed dimensions, not reconstructed from the image.

## Features

| Area | What is implemented |
|---|---|
| Auth & ownership | Sign-up / login, scrypt password hashing, signed expiring JWTs, protected routes, server-side ownership checks on every project, room, estimate, floor plan, price and report (other users' IDs return 404) |
| Projects | 5-step wizard (details → dimensions → rooms → floor plan → review), validation, multi-room/multi-floor, manual area override, edit/delete, project history |
| Floor plans | JPG/JPEG/PNG/PDF upload with type, size and content-signature validation; preview; replace/remove; files stored on disk (not in DB); click-two-points **scale calibration** and distance measuring; optional OpenCV edges/contours overlay |
| 3D Studio | React Three Fiber model from saved data: slabs, exterior walls, interior partitions, rooms, multiple floors, door/window markers, room labels, dimension labels; orbit/zoom/pan, reset, exterior and top-down plan views, floor selection, room selection + info/edit panel, labels/roof/wireframe toggles; live regeneration after edits; schematic layout is explicitly labelled |
| Estimation | Cement, steel, concrete, bricks, blocks, mortar, sand, aggregates, tiles, paint, plaster. Each line shows net qty, wastage %, qty incl. wastage, unit, unit price, cost, formula and assumptions. Editable assumptions and per-material wastage |
| Pricing & catalogue | Catalogue with brand/grade/spec/supplier/location/date; CRUD for custom materials and price records; CSV import; per-user price overrides of sample data; material selection per project |
| Cost analysis | Totals, category pie + material bar charts (Recharts), cost per m² and per sq ft, budget variance, optional labour/transport/contingency/other (counted only when enabled **and** populated), alternative-material scenarios |
| Comparison | Side-by-side brand/grade/spec/durability/price/supplier and total project cost; lowest price highlighted without claiming it is "best" |
| Optimization | Transparent rules: high wastage, missing rooms/openings, input inconsistencies, missing/sample prices, lower-priced alternatives, purchase-plan mismatches, budget overrun, inventory review. Savings only when quantities and prices exist |
| Reports | ReportLab PDF with branding, project/building/room data, quantities, prices, costs, breakdown, extras, recommendations, assumptions, date, disclaimer; repeated table headers and page numbers; generated from live saved data |
| Dashboard | Metrics, charts, recent projects/reports, quick actions; demo data is labelled |

## Project structure

```
buildwise-ai/
  backend/
    app/
      api/            REST routers (auth, projects, rooms, estimate, floorplans, materials, prices, reports, dashboard)
      core/           config (env), database, security (scrypt + JWT), error envelope
      models/         SQLAlchemy models (UUID string ids)
      schemas/        Pydantic request/response schemas + validation
      services/
        estimation/   PURE calculation engine (calculators, engine, units) — no DB/HTTP
        pricing/      cost application/summary (pure) + DB price lookup + sample catalogue seed
        optimization/ rule-based recommendation engine (extension point for ML later)
        floorplan/    storage abstraction (local disk) + upload validation, calibration, OpenCV analysis
        reports/      ReportLab PDF builder
      main.py
    tests/            pytest suite (calculators, engine, API workflows, ownership, PDF)
  frontend/
    src/
      components/ui   Buttons, cards, forms, tables, dialogs, feedback (shadcn-style, Tailwind + CVA)
      features/       projects, estimation, building-3d (model generator + viewer), materials, pricing, reports
      pages/ layouts/ hooks/ lib/ types/
  docs/ scripts/ .env.example README.md
```

## Prerequisites

* Python 3.10+ (developed on 3.13)
* Node.js 20+ (developed on 22) and npm
* A browser with WebGL (any current Chrome/Edge/Firefox/Safari)

## Quick start

```bash
./scripts/setup.sh            # creates backend/.venv, installs backend + frontend deps, creates backend/.env
./scripts/dev-backend.sh      # terminal 1 -> http://localhost:8000  (API docs: /docs)
./scripts/dev-frontend.sh     # terminal 2 -> http://localhost:5173
```

Open <http://localhost:5173>, sign up, then either create a project or use **Settings → Create demo project** (clearly labelled DEMO) to explore the whole workflow.

### Manual steps (what the scripts do)

```bash
# Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp ../.env.example .env                                  # optional; defaults work locally
uvicorn app.main:app --reload --port 8000                # tables are created automatically on startup

# Frontend (second terminal)
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` to `http://localhost:8000`, so no CORS setup is needed locally. Set `BACKEND_URL` to proxy elsewhere, or `VITE_API_BASE_URL` for a separately hosted API (then add the frontend origin to `CORS_ORIGINS`).

## Configuration (`.env.example`)

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | SQLAlchemy URL. SQLite locally; PostgreSQL e.g. `postgresql+psycopg://user:pass@host/db` (install `psycopg`) | `sqlite:///./data/buildwise.db` |
| `JWT_SECRET` | Token signing key. **Set a strong value for any shared deployment.** If empty, a random dev secret is generated into `backend/data/.dev_jwt_secret` | generated |
| `ACCESS_TOKEN_MINUTES` | Token lifetime | 720 |
| `CORS_ORIGINS` | Comma-separated allowed origins | `http://localhost:5173,http://127.0.0.1:5173` |
| `UPLOAD_DIR`, `REPORT_DIR` | File storage locations | `backend/data/uploads`, `backend/data/reports` |
| `MAX_UPLOAD_MB` | Floor-plan size limit | 10 |
| `SEED_SAMPLE_DATA` | Seed the labelled sample catalogue on startup | true |

`.env` files and `backend/data/` are git-ignored. Nothing secret is exposed to the frontend.

## Authentication: what is active

Active locally (no extra setup): password hashing (scrypt, per-password salt), signed expiring bearer tokens, protected API routes and frontend routes, server-side ownership checks for all user data, timing-safe login for unknown e-mails, generic 404 for other users' resources.

Needs deployment configuration: a strong `JWT_SECRET`, HTTPS, restricted `CORS_ORIGINS`, a production database, and (not implemented) e-mail verification, password reset, rate limiting / lockout, and token refresh/revocation. Tokens live in `localStorage` for simplicity; a hardened deployment should prefer httpOnly cookies.

## Database

SQLAlchemy 2.x models for users, projects, rooms, floor-plan files, materials, price records, estimates, estimate items, recommendations and reports. Tables are created with `create_all` on startup (adequate for local/dev). For a PostgreSQL deployment, add Alembic migrations — the models use portable types (string UUIDs, JSON) to keep that straightforward. Calculation logic does not touch the database, so it is unit-tested in isolation.

## How the estimate is calculated

See [`docs/ESTIMATION.md`](docs/ESTIMATION.md) for every formula and assumption. Key points: net vs. wastage-inclusive quantities are separate; shared interior walls are counted once; openings are deducted; concrete/mortar/plaster are quantity-only lines (costed through cement, sand and aggregate, or as ready-mix) so nothing is double-counted; wastage and assumptions are user-configurable.

## Tests and checks

```bash
./scripts/test-all.sh          # everything below
# or individually:
cd backend  && .venv/bin/python -m pytest -q
cd frontend && npm run typecheck && npm run lint && npm test && npm run build
```

Backend tests cover floor area, concrete volume, tile/paint/brick quantities, cost, wastage, invalid/zero/negative inputs, unit conversions, multi-floor areas, project create/retrieve/update/delete, ownership isolation, estimate persistence and re-pricing, material/price CRUD and CSV import, floor-plan upload/calibration/analysis, dashboard, and PDF generation (including a 120-room paginated report). Frontend unit tests cover the 3D model generator.

## API overview

`GET /api/health` · `POST /api/auth/signup|login` · `GET|PUT /api/auth/me` · `GET|POST /api/projects` · `GET|PUT|DELETE /api/projects/{id}` · `PUT /api/projects/{id}/config` · `GET|POST /api/projects/{id}/rooms` · `PUT|DELETE …/rooms/{room_id}` · `POST|GET /api/projects/{id}/estimate` · `GET /api/projects/{id}/recommendations` · `POST|GET /api/projects/{id}/floorplans` · `GET /api/floorplans/{id}/file` · `PUT …/calibration` · `POST …/analyze` · `POST /api/projects/{id}/report` · `GET /api/reports`, `GET /api/reports/{id}/download` · `GET|POST /api/materials`, `PUT|DELETE /api/materials/{id}` · `GET|POST /api/prices`, `PUT|DELETE /api/prices/{id}`, `POST /api/prices/import` · `GET /api/dashboard` · `POST /api/demo/seed`. Interactive docs at <http://localhost:8000/docs>. Errors use `{"error": {"code", "message", "details"}}`.

## Production build

```bash
cd frontend && npm run build        # outputs frontend/dist (serve with any static host / reverse proxy to /api)
cd backend  && uvicorn app.main:app --host 0.0.0.0 --port 8000   # behind a reverse proxy, with JWT_SECRET set
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Cannot reach the BuildWise AI server" | Backend not running or wrong port. Start `scripts/dev-backend.sh`; check `curl localhost:8000/api/health` |
| `ModuleNotFoundError` when starting the backend | Activate the venv and `pip install -r requirements.txt` |
| 401 / redirected to login | Token expired or `JWT_SECRET` changed; log in again |
| Blank 3D area | WebGL disabled/unsupported; enable hardware acceleration. The rest of the app still works |
| Port 5173/8000 in use | `PORT=8001 scripts/dev-backend.sh` and `BACKEND_URL=http://localhost:8001 npm run dev` |
| CORS error with a separately hosted API | Add the frontend origin to `CORS_ORIGINS` |
| "OpenCV is not installed" on *Detect edges* | `pip install opencv-python-headless` (optional module) |
| Reset local data | Stop the backend and delete `backend/data/` |

## Known limitations

* Floor-plan scale calibration works on images only (PDFs can be previewed but not calibrated); no automatic room/dimension extraction.
* Rooms without stored positions use a schematic shelf-packing layout; positions can be saved from the Studio or set per room.
* Doors/windows in 3D are visual markers over the wall, not boolean cut-outs.
* Columns, beams and footings are not detailed; use the *frame concrete allowance* assumption and have an engineer design them.
* No Alembic migrations, e-mail verification, password reset or rate limiting (see Authentication).
* Dashboard "material quantities" combine different units on one chart (tooltips show units).
