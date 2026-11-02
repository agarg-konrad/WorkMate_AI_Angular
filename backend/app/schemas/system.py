from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.schemas.chat import RouteTarget

ComponentStatus = Literal["ok", "degraded", "down", "mock", "disabled"]


class ModelInfo(BaseModel):
    id: str
    name: str
    provider: RouteTarget
    available: bool
    is_default: bool = False
    details: str | None = None


class ModelsResponse(BaseModel):
    models: list[ModelInfo]
    default_local: str
    default_cloud: str | None


class ComponentHealth(BaseModel):
    status: ComponentStatus
    latency_ms: float | None = None
    detail: str | None = None


class HealthComponents(BaseModel):
    api: ComponentHealth
    ollama: ComponentHealth
    cloud: ComponentHealth


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    version: str
    environment: str
    timestamp: datetime
    components: HealthComponents
