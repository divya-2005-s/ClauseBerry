"""Consistent JSON error responses: {"error": {"code", "message", "request_id", "details"?}}."""
from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

log = logging.getLogger("clauseberry.errors")


class AppError(HTTPException):
    def __init__(self, status_code: int, code: str, message: str, details: dict | None = None):
        super().__init__(status_code=status_code, detail=message)
        self.code = code
        self.details = details


def _body(request: Request, code: str, message: str, details=None) -> dict:
    err = {"code": code, "message": message, "request_id": getattr(request.state, "request_id", None)}
    if details:
        err["details"] = details
    return {"error": err}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError):
        return JSONResponse(_body(request, exc.code, exc.detail, exc.details), status_code=exc.status_code,
                            headers=getattr(exc, "headers", None))

    @app.exception_handler(HTTPException)
    async def _http_error(request: Request, exc: HTTPException):
        code = {401: "unauthorized", 403: "forbidden", 404: "not_found", 405: "method_not_allowed",
                429: "rate_limited"}.get(exc.status_code, "http_error")
        return JSONResponse(_body(request, code, str(exc.detail)), status_code=exc.status_code,
                            headers=getattr(exc, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError):
        fields = [{"field": ".".join(str(p) for p in e["loc"][1:]), "message": e["msg"]} for e in exc.errors()]
        return JSONResponse(_body(request, "validation_error", "Some fields are invalid.", {"fields": fields}),
                            status_code=422)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        log.exception("Unhandled error (request_id=%s)", getattr(request.state, "request_id", None))
        return JSONResponse(_body(request, "internal_error", "Something went wrong on our side."), status_code=500)
