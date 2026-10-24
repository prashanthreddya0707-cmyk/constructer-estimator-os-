"""Supabase integration: verify Supabase Auth access tokens and talk to Supabase Storage as the signed-in user.

Only the PUBLIC project URL and publishable key are used. The service-role key is never needed and never read.
"""
from __future__ import annotations

import contextvars
import json
from dataclasses import dataclass
from functools import lru_cache

import httpx
import jwt
from jwt import PyJWKClient, PyJWKSet

from app.core.config import get_settings

# The caller's access token, set per request by the middleware so storage calls can act as that user (Storage RLS).
request_token: contextvars.ContextVar[str | None] = contextvars.ContextVar("request_token", default=None)


@dataclass
class Identity:
    """The signed-in user as seen by the API (same attribute names as the local User model)."""

    id: str
    email: str
    full_name: str
    token: str

    @property
    def claims(self) -> dict:
        return {"sub": self.id, "role": "authenticated", "email": self.email}


@lru_cache
def _jwks_client() -> PyJWKClient:
    return PyJWKClient(f"{get_settings().supabase_url}/auth/v1/.well-known/jwks.json", cache_keys=True, lifespan=3600, timeout=5)


@lru_cache
def _pinned_keys() -> PyJWKSet | None:
    raw = get_settings().supabase_jwks_json
    return PyJWKSet.from_dict(json.loads(raw)) if raw else None


def _signing_key(token: str):
    pinned = _pinned_keys()
    if pinned is not None:
        kid = jwt.get_unverified_header(token).get("kid")
        for k in pinned.keys:
            if k.key_id == kid or kid is None:
                return k.key
        raise jwt.InvalidTokenError("unknown signing key")
    return _jwks_client().get_signing_key_from_jwt(token).key


def verify_access_token(token: str) -> Identity | None:
    """Validate signature, expiry, audience and issuer of a Supabase access token. Returns None if anything is wrong."""
    s = get_settings()
    try:
        alg = jwt.get_unverified_header(token).get("alg", "")
        opts = {"require": ["exp", "sub"]}
        issuer = f"{s.supabase_url}/auth/v1" if s.supabase_url else None
        if alg == "HS256":                      # legacy projects sign with a shared secret
            if not s.supabase_jwt_secret:
                return None
            data = jwt.decode(token, s.supabase_jwt_secret, algorithms=["HS256"], audience="authenticated", options=opts, issuer=issuer)
        else:
            data = jwt.decode(token, _signing_key(token), algorithms=["RS256", "ES256", "EdDSA"], audience="authenticated", options=opts, issuer=issuer)
    except Exception:
        return None
    if data.get("role") != "authenticated":      # the anon key is a valid JWT too; it must not count as a signed-in user
        return None
    meta = data.get("user_metadata") or {}
    return Identity(id=str(data["sub"]), email=str(data.get("email", "")), full_name=str(meta.get("full_name", "")), token=token)


# ---------------------------------------------------------------------------------------------------- Storage
class SupabaseStorage:
    """Private Supabase Storage bucket, accessed with the user's own token. Files live under ``<user id>/<key>``, which is
    exactly what the storage policy checks, so one user can never read or overwrite another user's files."""

    def __init__(self, bucket: str, token: str, user_id: str):
        s = get_settings()
        self.base = f"{s.supabase_url}/storage/v1/object"
        self.bucket, self.user_id = bucket, user_id
        self.headers = {"Authorization": f"Bearer {token}", "apikey": s.supabase_publishable_key}

    def _path(self, key: str) -> str:
        if "/" in key or ".." in key or not key:
            raise ValueError("invalid storage key")
        return f"{self.user_id}/{key}"

    def save(self, key: str, data: bytes) -> None:
        mime = "application/pdf" if self.bucket == "reports" else _guess_mime(data)
        r = httpx.post(f"{self.base}/{self.bucket}/{self._path(key)}", content=data, timeout=60,
                       headers={**self.headers, "Content-Type": mime, "x-upsert": "true"})
        r.raise_for_status()

    def read(self, key: str) -> bytes:
        r = httpx.get(f"{self.base}/authenticated/{self.bucket}/{self._path(key)}", headers=self.headers, timeout=60)
        r.raise_for_status()
        return r.content

    def exists(self, key: str) -> bool:
        r = httpx.head(f"{self.base}/authenticated/{self.bucket}/{self._path(key)}", headers=self.headers, timeout=30)
        return r.status_code == 200

    def delete(self, key: str) -> None:
        r = httpx.delete(f"{self.base}/{self.bucket}/{self._path(key)}", headers=self.headers, timeout=30)
        if r.status_code not in (200, 204, 404):
            r.raise_for_status()


def _guess_mime(data: bytes) -> str:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    return "application/pdf" if data[:4] == b"%PDF" else "application/octet-stream"


def storage_for(bucket: str) -> SupabaseStorage:
    token = request_token.get()
    ident = verify_access_token(token) if token else None
    if not ident:
        raise PermissionError("storage needs a signed-in Supabase user")
    return SupabaseStorage(bucket, token, ident.id)
