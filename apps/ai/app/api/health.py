from typing import Literal

from fastapi import APIRouter, Response
from pydantic import BaseModel

router = APIRouter()


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: Literal["ai"] = "ai"


@router.get("/health", response_model=HealthResponse)
def health(response: Response) -> HealthResponse:
    response.headers["Cache-Control"] = "no-store"
    return HealthResponse()
