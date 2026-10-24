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


def normalize_db_url(url: str) -> str:
    """Accept the plain postgres:// URLs that Supabase/Render hand out and use the psycopg 3 driver."""
    for old in ("postgres://", "postgresql://"):
        if url.startswith(old):
            return "postgresql+psycopg://" + url[len(old):]
    return url


class Settings:
    def __init__(self) -> None:
        self.data_dir = Path(os.environ.get("DATA_DIR", BACKEND_DIR / "data"))
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.database_url = normalize_db_url(os.environ.get("DATABASE_URL") or f"sqlite:///{self.data_dir / 'buildwise.db'}")
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
        # Credentials live in their own database file, encrypted with a key kept outside that file.
        # With a server database (PostgreSQL / Supabase) the credentials go into the same database server (own table);
        # with the default SQLite setup they stay in their own file.
        default_auth = f"sqlite:///{self.data_dir / 'auth.db'}" if self.database_url.startswith("sqlite") else self.database_url
        self.auth_database_url = normalize_db_url(os.environ.get("AUTH_DATABASE_URL") or default_auth)
        self.auth_secret = os.environ.get("AUTH_ENCRYPTION_KEY") or self._dev_key(".auth_key")
        self.cookie_name = "bw_session"

        # ---- authentication provider switch: "local" (default, the existing app) or "supabase" -------------------------
        self.auth_provider = os.environ.get("AUTH_PROVIDER", "local").strip().lower()
        if self.auth_provider not in ("local", "supabase"):
            raise RuntimeError("AUTH_PROVIDER must be 'local' or 'supabase'")
        self.supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
        self.supabase_publishable_key = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")   # public key; never the service-role key
        self.supabase_jwks_json = os.environ.get("SUPABASE_JWKS_JSON", "")               # optional: pinned signing keys (tests/offline)
        self.supabase_jwt_secret = os.environ.get("SUPABASE_JWT_SECRET", "")             # only for legacy HS256 projects
        if self.auth_provider == "supabase" and not (self.supabase_url or self.supabase_jwks_json):
            raise RuntimeError("AUTH_PROVIDER=supabase needs SUPABASE_URL (and DATABASE_URL pointing at the Supabase database)")

        # ---- abuse protection and robustness ---------------------------------------------------------------------------
        flag = lambda name, default: os.environ.get(name, default).lower() in ("1", "true", "yes", "on")  # noqa: E731
        self.rate_limit_enabled = flag("RATE_LIMIT_ENABLED", "true")
        self.login_ip_limit = int(os.environ.get("LOGIN_IP_LIMIT", "30"))          # login attempts / IP / 5 min
        self.login_fail_limit = int(os.environ.get("LOGIN_FAIL_LIMIT", "8"))       # failed logins / (account, IP) / 15 min
        self.signup_ip_limit = int(os.environ.get("SIGNUP_IP_LIMIT", "20"))        # sign-ups / IP / hour
        self.expensive_user_limit = int(os.environ.get("EXPENSIVE_USER_LIMIT", "40"))  # PDFs, recalculations, plan analysis / user / min
        self.trust_proxy_headers = flag("TRUST_PROXY_HEADERS", "false")
        self.hsts = flag("HSTS", "false")
        self.slow_request_ms = int(os.environ.get("SLOW_REQUEST_MS", "1000"))
        self.db_pool_size = int(os.environ.get("DB_POOL_SIZE", "10"))
        self.db_max_overflow = int(os.environ.get("DB_MAX_OVERFLOW", "20"))
        self.db_pool_timeout = int(os.environ.get("DB_POOL_TIMEOUT", "10"))
        self.db_statement_timeout_ms = int(os.environ.get("DB_STATEMENT_TIMEOUT_MS", "15000"))

    def _dev_secret(self) -> str:
        """No JWT_SECRET configured: generate one and keep it in the (git-ignored) data dir."""
        return self._dev_key(".dev_jwt_secret")

    def _dev_key(self, filename: str) -> str:
        path = self.data_dir / filename
        if path.is_file():
            return path.read_text().strip()
        secret = secrets.token_urlsafe(48)
        path.write_text(secret)
        return secret


@lru_cache
def get_settings() -> Settings:
    return Settings()
