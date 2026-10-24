"""Small in-process sliding-window rate limiter.

Good for one backend process (the current deployment). With several backend instances each one counts on its own;
the scaling step is a shared store such as Redis (documented in docs/TECHNICAL_REPORT.md).
Memory is bounded: keys with no recent hits are dropped.
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

from app.core.config import get_settings


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _trim(self, q: deque, window: float, now: float) -> None:
        while q and q[0] <= now - window:
            q.popleft()

    def count(self, key: str, window: float) -> int:
        now = time.monotonic()
        with self._lock:
            q = self._hits.get(key)
            if not q:
                return 0
            self._trim(q, window, now)
            if not q:
                del self._hits[key]
            return len(q)

    def retry_after(self, key: str, window: float) -> int:
        now = time.monotonic()
        with self._lock:
            q = self._hits.get(key)
            return max(1, int(q[0] + window - now) + 1) if q else 1

    def add(self, key: str) -> None:
        with self._lock:
            self._hits[key].append(time.monotonic())
            if len(self._hits) > 50_000:  # hard cap against key flooding
                for k in list(self._hits)[:10_000]:
                    self._hits.pop(k, None)

    def clear(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = SlidingWindowLimiter()


def client_ip(request: Request) -> str:
    """Caller address. Behind a trusted reverse proxy (Render / Netlify) the first X-Forwarded-For entry is the client."""
    if get_settings().trust_proxy_headers:
        fwd = request.headers.get("x-forwarded-for", "")
        if fwd:
            return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _too_many(window: float, key: str) -> HTTPException:
    return HTTPException(429, "Too many attempts. Please wait a little and try again.", headers={"Retry-After": str(limiter.retry_after(key, window))})


def hit(bucket: str, ident: str, limit: int, window: float) -> None:
    """Count one request for (bucket, ident); raise 429 when over the limit. No-op when rate limiting is disabled."""
    if not get_settings().rate_limit_enabled:
        return
    key = f"{bucket}|{ident}"
    if limiter.count(key, window) >= limit:
        raise _too_many(window, key)
    limiter.add(key)


def blocked(bucket: str, ident: str, limit: int, window: float) -> None:
    """Raise 429 if (bucket, ident) already has `limit` recorded events (used for failed logins); does not count."""
    if get_settings().rate_limit_enabled and limiter.count(f"{bucket}|{ident}", window) >= limit:
        raise _too_many(window, f"{bucket}|{ident}")


def record(bucket: str, ident: str) -> None:
    limiter.add(f"{bucket}|{ident}")


def forget(bucket: str, ident: str) -> None:
    with limiter._lock:
        limiter._hits.pop(f"{bucket}|{ident}", None)
