import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.routers import chat, system
from app.services.providers import CloudProvider, OllamaProvider
from app.services.router_service import RouterService


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    ollama_client = httpx.AsyncClient(
        base_url=settings.ollama_base_url,
        timeout=httpx.Timeout(settings.ollama_read_timeout_seconds, connect=settings.ollama_connect_timeout_seconds),
    )
    cloud_client = httpx.AsyncClient(
        base_url=settings.cloud_base_url,
        timeout=httpx.Timeout(settings.cloud_read_timeout_seconds, connect=settings.cloud_connect_timeout_seconds),
    )
    app.state.router_service = RouterService(
        settings,
        OllamaProvider(ollama_client, settings),
        CloudProvider(cloud_client, settings),
    )
    logging.getLogger(__name__).info(
        "%s %s started (ollama=%s, cloud=%s)",
        settings.app_name,
        settings.app_version,
        settings.ollama_base_url,
        "disabled" if not settings.cloud_enabled else ("mock" if settings.cloud_mock_mode else settings.cloud_base_url),
    )
    try:
        yield
    finally:
        await asyncio.gather(ollama_client.aclose(), cloud_client.aclose())


def create_app() -> FastAPI:
    settings = get_settings()
    logging.basicConfig(
        level=settings.log_level.upper(),
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        lifespan=lifespan,
        docs_url=f"{settings.api_v1_prefix}/docs",
        openapi_url=f"{settings.api_v1_prefix}/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=list(chat.TELEMETRY_HEADERS),
    )
    app.include_router(chat.router, prefix=settings.api_v1_prefix)
    app.include_router(system.router, prefix=settings.api_v1_prefix)
    return app


app = create_app()
