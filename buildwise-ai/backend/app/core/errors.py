"""Consistent error envelope: {"error": {"code", "message", "details"}}."""
from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DataError, DBAPIError, IntegrityError, InterfaceError, OperationalError
from sqlalchemy.exc import TimeoutError as PoolTimeout

import logging

log = logging.getLogger("buildwise.errors")


def _env(status: int, code: str, message: str, details=None, headers: dict | None = None) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "details": details}}, headers=headers)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def _http(_: Request, exc: HTTPException):
        return _env(exc.status_code, f"http_{exc.status_code}", str(exc.detail), None, dict(exc.headers) if exc.headers else None)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        details = [
            {"field": ".".join(str(p) for p in e["loc"] if p != "body"), "message": e["msg"]}
            for e in exc.errors()
        ]
        first = details[0] if details else {"field": "", "message": "Invalid input"}
        msg = f"Invalid input: {first['field']}: {first['message']}" if first["field"] else "Invalid input"
        return _env(422, "validation_error", msg, details)

    def _unavailable() -> JSONResponse:
        r = _env(503, "database_unavailable", "The database is temporarily unavailable. Please try again in a moment.", None)
        r.headers["Retry-After"] = "5"
        return r

    @app.exception_handler(OperationalError)
    @app.exception_handler(InterfaceError)
    @app.exception_handler(PoolTimeout)
    async def _db_down(_: Request, exc: Exception):
        log.error("database unavailable: %s", type(exc).__name__)
        return _unavailable()

    @app.exception_handler(DBAPIError)
    async def _dbapi(_: Request, exc: DBAPIError):
        if getattr(exc, "connection_invalidated", False):
            return _unavailable()
        log.exception("database error")
        return _env(500, "internal_error", "An unexpected server error occurred.", None)

    @app.exception_handler(DataError)
    async def _bad_data(_: Request, exc: DataError):
        if "uuid" in str(exc.orig).lower():          # a malformed id in the URL can only refer to something that does not exist
            return _env(404, "http_404", "Not found.", None)
        return _env(422, "validation_error", "Invalid input.", None)

    @app.exception_handler(IntegrityError)
    async def _integrity(_: Request, exc: IntegrityError):
        return _env(409, "conflict", "The change conflicts with data that already exists.", None)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception):
        log.exception("unhandled error")
        return _env(500, "internal_error", "An unexpected server error occurred.", None)
