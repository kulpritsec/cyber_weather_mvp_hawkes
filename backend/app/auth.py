"""
API Key authentication middleware.

Set CYBER_WEATHER_API_KEY to require an X-API-Key header on all
non-health endpoints.  When the env var is empty authentication is
disabled (development mode).
"""

import os
from fastapi import Request, HTTPException, Security
from fastapi.security import APIKeyHeader
from starlette.middleware.base import BaseHTTPMiddleware

API_KEY = os.getenv("CYBER_WEATHER_API_KEY", "")

# Paths that never require authentication
PUBLIC_PATHS = {"/healthz", "/", "/docs", "/openapi.json", "/redoc"}

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


class APIKeyMiddleware(BaseHTTPMiddleware):
    """Reject requests without a valid API key (when one is configured)."""

    async def dispatch(self, request: Request, call_next):
        if not API_KEY:
            # No key configured → auth disabled (dev mode)
            return await call_next(request)

        if request.url.path in PUBLIC_PATHS:
            return await call_next(request)

        # Allow CORS preflight through
        if request.method == "OPTIONS":
            return await call_next(request)

        supplied = request.headers.get("X-API-Key", "")
        if supplied != API_KEY:
            raise HTTPException(status_code=401, detail="Invalid or missing API key")

        return await call_next(request)
