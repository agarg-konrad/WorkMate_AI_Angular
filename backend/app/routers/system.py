import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter

from app.core.dependencies import RouterServiceDep, SettingsDep
from app.schemas.system import ComponentHealth, HealthComponents, HealthResponse, ModelsResponse

router = APIRouter(tags=["system"])


@router.get("/models", summary="List available local and cloud models")
async def list_models(service: RouterServiceDep) -> ModelsResponse:
    return await service.list_models()


@router.get("/health", summary="System, Ollama and cloud connectivity check")
async def health(service: RouterServiceDep, settings: SettingsDep) -> HealthResponse:
    ollama, cloud = await asyncio.gather(service.ollama.health(), service.cloud.health())
    healthy = ollama.status == "ok" and cloud.status in ("ok", "mock", "disabled")
    return HealthResponse(
        status="ok" if healthy else "degraded",
        version=settings.app_version,
        environment=settings.environment,
        timestamp=datetime.now(timezone.utc),
        components=HealthComponents(api=ComponentHealth(status="ok"), ollama=ollama, cloud=cloud),
    )


@router.get("/health/live", summary="Liveness probe (no dependency checks)")
async def liveness() -> dict[str, str]:
    return {"status": "ok"}
