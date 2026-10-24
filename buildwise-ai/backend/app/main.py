from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api import auth, dashboard, floorplans, materials, projects, reports
from app.core.authstore import init_auth_db, migrate_legacy_users
from app.core.config import get_settings
from app.core.db import SessionLocal, get_db, init_db
from app.core.errors import install_error_handlers
from app.core.middleware import HardeningMiddleware
from app.services.pricing.seed import seed_sample_catalogue


@asynccontextmanager
async def lifespan(_: FastAPI):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    init_db()
    if get_settings().auth_provider == "local":   # in Supabase mode credentials live in Supabase Auth
        init_auth_db()
        migrate_legacy_users()
    if get_settings().seed_sample_data:
        with SessionLocal() as db:
            seed_sample_catalogue(db)
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="BuildWise AI API", version="1.0.0", lifespan=lifespan)
    app.add_middleware(HardeningMiddleware)
    app.add_middleware(
        CORSMiddleware, allow_origins=get_settings().cors_origins, allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"], allow_headers=["Authorization", "Content-Type"],
        max_age=600,
    )
    install_error_handlers(app)

    @app.get("/api/health", tags=["system"])
    def health():
        return {"status": "ok", "service": "buildwise-ai"}

    @app.get("/api/health/ready", tags=["system"])
    def ready(db: Session = Depends(get_db)):
        """Readiness: also checks the database (503 when it is unreachable)."""
        db.execute(text("select 1"))
        return {"status": "ok", "database": "ok", "auth_provider": get_settings().auth_provider}

    for r in (auth.router, projects.router, floorplans.router, materials.router, reports.router, dashboard.router):
        app.include_router(r, prefix="/api")
    return app


app = create_app()
