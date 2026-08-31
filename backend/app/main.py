import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.api.routes import router
from app.api.auth_routes import router as auth_router
from app.api.admin_routes import router as admin_router
from app.api.billing_routes import router as billing_router
from app.api.key_routes import router as key_router
from app.api.template_routes import router as template_router
from app.api.v1 import router as v1_router
from app.core.config import get_settings
from app.core.logsetup import configure_app_logging

# Allow local vendor/ installs (e.g. firecrawl-anydoc) when site-packages is locked.
_vendor = Path(__file__).resolve().parents[1] / "vendor"
if _vendor.is_dir() and str(_vendor) not in sys.path:
    sys.path.insert(0, str(_vendor))

configure_app_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    configure_app_logging()
    settings = get_settings()
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    if settings.storage_backend.lower() == "local":
        settings.storage_local_root.mkdir(parents=True, exist_ok=True)
    # Touch store so local index exists at boot.
    from app.storage import get_document_store

    get_document_store()
    from app.db.session import init_db

    init_db()
    # Alembic's fileConfig ran inside init_db; restore app.* logging.
    configure_app_logging()
    logger.info(
        "%s starting (upload_dir=%s, storage=%s)",
        settings.app_name,
        settings.upload_dir,
        settings.storage_backend,
    )
    yield
    logger.info("%s shutting down", settings.app_name)
    from app.services.worker import shutdown_worker_pool

    shutdown_worker_pool()


class UnhandledErrorMiddleware(BaseHTTPMiddleware):
    """Turn unhandled errors into JSON *inside* the CORS layer.

    Starlette's outermost handler answers a crash with a bare 500 that carries no
    Access-Control-Allow-Origin, so the browser reports a server bug as a CORS
    failure and the UI blames the network. Answering here keeps the response
    inside CORSMiddleware, so callers see the real status instead.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        try:
            return await call_next(request)
        except Exception:  # noqa: BLE001 - re-raised as a 500 below
            logger.exception("Unhandled error on %s %s", request.method, request.url.path)
            return JSONResponse(status_code=500, content={"detail": "Internal server error"})


class PrivateNetworkMiddleware(BaseHTTPMiddleware):
    """Chrome blocks localhost → 127.0.0.1 unless the preflight allows private/local network."""

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        if request.headers.get("access-control-request-private-network") == "true":
            response.headers["Access-Control-Allow-Private-Network"] = "true"
        if request.headers.get("access-control-request-local-network") == "true":
            response.headers["Access-Control-Allow-Local-Network"] = "true"
        return response


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        description="Convert and transform files between formats — office, PDF, image, and more.",
        version="0.1.0",
        lifespan=lifespan,
    )
    cors_kwargs: dict = {
        "allow_origins": settings.cors_origins,
        "allow_credentials": True,
        "allow_methods": ["*"],
        "allow_headers": ["*"],
    }
    if settings.cors_origin_regex.strip():
        cors_kwargs["allow_origin_regex"] = settings.cors_origin_regex.strip()
    # Order matters: the last add_middleware call ends up outermost. Registering
    # the error envelope first keeps it inside CORSMiddleware, so its 500 still
    # gets Access-Control-Allow-Origin on the way out.
    app.add_middleware(UnhandledErrorMiddleware)
    app.add_middleware(CORSMiddleware, **cors_kwargs)
    app.add_middleware(PrivateNetworkMiddleware)
    app.include_router(router, prefix=settings.api_prefix)
    app.include_router(auth_router, prefix=settings.api_prefix)
    app.include_router(admin_router, prefix=settings.api_prefix)
    app.include_router(billing_router, prefix=settings.api_prefix)
    app.include_router(key_router, prefix=settings.api_prefix)
    app.include_router(template_router, prefix=settings.api_prefix)
    app.include_router(v1_router, prefix=settings.api_prefix)
    return app


app = create_app()
