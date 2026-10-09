#!/usr/bin/env bash
cd "$(dirname "$0")/../backend"
exec .venv/bin/uvicorn app.main:app --reload --port "${PORT:-8000}"
