import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.api.routes import router
from app.api.auth_routes import router as auth_router
from app.api.billing_routes import router as billing_router
from app.core.config import get_settings

# Allow local vendor/ installs (e.g. firecrawl-anydoc) when site-packages is locked.
_vendor = Path(__file__).resolve().parents[1] / "vendor"
if _vendor.is_dir() and str(_vendor) not in sys.path:
    sys.path.insert(0, str(_vendor))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    if settings.storage_backend.lower() == "local":
        settings.storage_local_root.mkdir(parents=True, exist_ok=True)
    # Touch store so local index exists at boot.
    from app.storage import get_document_store

    get_document_store()
    from app.db.session import init_db

    init_db()
    logger.info(
        "%s starting (upload_dir=%s, storage=%s)",
        settings.app_name,
        settings.upload_dir,
        settings.storage_backend,
    )
    yield
    logger.info("%s shutting down", settings.app_name)


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
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(PrivateNetworkMiddleware)
    app.include_router(router, prefix=settings.api_prefix)
    app.include_router(auth_router, prefix=settings.api_prefix)
    app.include_router(billing_router, prefix=settings.api_prefix)
    return app


app = create_app()
