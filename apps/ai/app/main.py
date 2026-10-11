from fastapi import FastAPI

from app.api.health import router as health_router
from app.api.inference import create_inference_router
from app.core.config import Settings
from app.services.inference import OpenAICompatibleProvider


def create_app(
    settings: Settings | None = None, provider: OpenAICompatibleProvider | None = None
) -> FastAPI:
    settings = settings or Settings()
    application = FastAPI(
        title="Business Management AI Service",
        version="0.1.0",
        docs_url="/docs" if settings.environment == "development" else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.environment == "development" else None,
    )
    application.include_router(health_router)
    application.include_router(
        create_inference_router(settings, provider or OpenAICompatibleProvider(settings))
    )
    return application


app = create_app()
