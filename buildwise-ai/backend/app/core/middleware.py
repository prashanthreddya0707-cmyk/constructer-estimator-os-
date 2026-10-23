"""One pure-ASGI middleware: security headers, request-size limit, timing and slow/failed request logging."""
from __future__ import annotations

import json
import logging
import time

from app.core.config import get_settings

log = logging.getLogger("buildwise.request")
JSON_LIMIT = 2 * 1024 * 1024  # JSON bodies are small; uploads have their own, larger limit


class HardeningMiddleware:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope["path"]
        headers = {k.decode().lower(): v.decode() for k, v in scope["headers"]}
        is_upload = path.endswith("/floorplans") and scope["method"] == "POST"
        limit = get_settings().max_upload_mb * 1024 * 1024 + 64 * 1024 if is_upload else JSON_LIMIT
        try:
            too_big = int(headers.get("content-length", "0")) > limit
        except ValueError:
            too_big = True
        if too_big:
            body = json.dumps({"error": {"code": "payload_too_large", "message": "The request is too large.", "details": None}}).encode()
            await send({"type": "http.response.start", "status": 413, "headers": self._headers([(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())], headers)})
            return await send({"type": "http.response.body", "body": body})

        start = time.perf_counter()
        status = {"code": 0}

        async def send_wrapped(message):
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
                elapsed = (time.perf_counter() - start) * 1000
                message = {**message, "headers": self._headers(list(message.get("headers", [])), headers, f"{elapsed:.0f}")}
            await send(message)

        try:
            await self.app(scope, receive, send_wrapped)
        finally:
            ms = (time.perf_counter() - start) * 1000
            if status["code"] >= 500 or ms > get_settings().slow_request_ms:
                log.warning("%s %s -> %s in %.0f ms", scope["method"], path, status["code"], ms)

    @staticmethod
    def _headers(existing: list, req_headers: dict, elapsed_ms: str | None = None) -> list:
        names = {k.lower() for k, _ in existing}
        add = {
            b"x-content-type-options": b"nosniff",
            b"x-frame-options": b"DENY",
            b"referrer-policy": b"no-referrer",
            b"permissions-policy": b"camera=(), microphone=(), geolocation=()",
            b"cross-origin-resource-policy": b"same-site",
            b"content-security-policy": b"default-src 'none'; frame-ancestors 'none'",
        }
        if get_settings().hsts or req_headers.get("x-forwarded-proto", "").split(",")[0].strip() == "https":
            add[b"strict-transport-security"] = b"max-age=31536000; includeSubDomains"
        if not any(n == b"cache-control" for n in names):
            add[b"cache-control"] = b"no-store"  # API responses hold private data; never cache them in shared caches
        if elapsed_ms is not None:
            add[b"x-response-time-ms"] = elapsed_ms.encode()
        return existing + [(k, v) for k, v in add.items() if k not in names]
