"""Consistent error envelope: {"error": {"code", "message", "details"}}."""
from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


def _env(status: int, code: str, message: str, details=None) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "details": details}})


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def _http(_: Request, exc: HTTPException):
        return _env(exc.status_code, f"http_{exc.status_code}", str(exc.detail), None)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        details = [
            {"field": ".".join(str(p) for p in e["loc"] if p != "body"), "message": e["msg"]}
            for e in exc.errors()
        ]
        first = details[0] if details else {"field": "", "message": "Invalid input"}
        msg = f"Invalid input: {first['field']}: {first['message']}" if first["field"] else "Invalid input"
        return _env(422, "validation_error", msg, details)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception):
        return _env(500, "internal_error", "An unexpected server error occurred.", None)
