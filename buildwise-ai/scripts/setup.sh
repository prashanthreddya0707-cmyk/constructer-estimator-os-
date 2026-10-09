#!/usr/bin/env bash
# One-time setup: Python venv + backend deps + frontend deps.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
(cd frontend && npm install)
[ -f backend/.env ] || cp .env.example backend/.env
echo "Setup complete. Run scripts/dev-backend.sh and scripts/dev-frontend.sh in two terminals."
