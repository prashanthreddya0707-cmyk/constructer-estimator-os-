"""Application settings, read from environment variables (see .env.example)."""
from __future__ import annotations

import os
import secrets
from functools import lru_cache
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[2]


def _load_dotenv() -> None:
    """Minimal .env loader (no extra dependency). Real env vars win."""
    for candidate in (BACKEND_DIR / ".env", BACKEND_DIR.parent / ".env"):
        if candidate.is_file():
            for line in candidate.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv()


class Settings:
    def __init__(self) -> None:
        self.data_dir = Path(os.environ.get("DATA_DIR", BACKEND_DIR / "data"))
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.database_url = os.environ.get(
            "DATABASE_URL", f"sqlite:///{self.data_dir / 'buildwise.db'}"
        )
        self.upload_dir = Path(os.environ.get("UPLOAD_DIR", self.data_dir / "uploads"))
        self.report_dir = Path(os.environ.get("REPORT_DIR", self.data_dir / "reports"))
        self.upload_dir.mkdir(parents=True, exist_ok=True)
        self.report_dir.mkdir(parents=True, exist_ok=True)
        self.max_upload_mb = int(os.environ.get("MAX_UPLOAD_MB", "10"))
        self.access_token_minutes = int(os.environ.get("ACCESS_TOKEN_MINUTES", "720"))
        origins = os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
        self.cors_origins = [o.strip() for o in origins.split(",") if o.strip()]
        self.seed_sample_data = os.environ.get("SEED_SAMPLE_DATA", "true").lower() == "true"
        self.jwt_secret = os.environ.get("JWT_SECRET") or self._dev_secret()
        self.jwt_algorithm = "HS256"

    def _dev_secret(self) -> str:
        """No JWT_SECRET configured: generate one and keep it in the (git-ignored) data dir."""
        path = self.data_dir / ".dev_jwt_secret"
        if path.is_file():
            return path.read_text().strip()
        secret = secrets.token_urlsafe(48)
        path.write_text(secret)
        return secret


@lru_cache
def get_settings() -> Settings:
    return Settings()
