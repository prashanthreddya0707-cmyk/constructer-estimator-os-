#!/usr/bin/env bash
# Backend tests, then frontend typecheck + lint + unit tests + production build.
set -euo pipefail
cd "$(dirname "$0")/.."
(cd backend && .venv/bin/python -m pytest -q)
(cd frontend && npm run typecheck && npm run lint && npm test && npm run build)
