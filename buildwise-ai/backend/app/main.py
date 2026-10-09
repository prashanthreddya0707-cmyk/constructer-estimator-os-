from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, dashboard, floorplans, materials, projects, reports
from app.core.config import get_settings
from app.core.db import SessionLocal, init_db
from app.core.errors import install_error_handlers
from app.services.pricing.seed import seed_sample_catalogue


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    if get_settings().seed_sample_data:
        with SessionLocal() as db:
            seed_sample_catalogue(db)
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="BuildWise AI API", version="1.0.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware, allow_origins=get_settings().cors_origins, allow_credentials=False,
        allow_methods=["*"], allow_headers=["*"],
    )
    install_error_handlers(app)

    @app.get("/api/health", tags=["system"])
    def health():
        return {"status": "ok", "service": "buildwise-ai"}

    for r in (auth.router, projects.router, floorplans.router, materials.router, reports.router, dashboard.router):
        app.include_router(r, prefix="/api")
    return app


app = create_app()
