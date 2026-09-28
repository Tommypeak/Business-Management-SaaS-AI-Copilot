from fastapi import FastAPI

from app.api.health import router as health_router
from app.core.config import Settings


def create_app() -> FastAPI:
    settings = Settings()
    application = FastAPI(
        title="Business Management AI Service",
        version="0.1.0",
        docs_url="/docs" if settings.environment == "development" else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.environment == "development" else None,
    )
    application.include_router(health_router)
    return application


app = create_app()
