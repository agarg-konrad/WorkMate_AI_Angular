from typing import Annotated

from fastapi import Depends, Request

from app.core.config import Settings, get_settings
from app.services.router_service import RouterService


def get_router_service(request: Request) -> RouterService:
    return request.app.state.router_service


RouterServiceDep = Annotated[RouterService, Depends(get_router_service)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
