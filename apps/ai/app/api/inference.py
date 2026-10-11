import hmac
from urllib.parse import urlsplit

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.core.config import Settings
from app.services.inference import AiFailure, InferenceRequest, OpenAICompatibleProvider


def create_inference_router(settings: Settings, provider: OpenAICompatibleProvider) -> APIRouter:
    router = APIRouter(prefix="/internal", include_in_schema=False)

    def authorized(request: Request) -> bool:
        secret = settings.service_secret.get_secret_value()
        provided = request.headers.get("x-ai-service-secret", "")
        return bool(secret) and hmac.compare_digest(secret.encode(), provided.encode())

    @router.get("/status")
    async def status(request: Request) -> JSONResponse:
        if not authorized(request):
            return JSONResponse({"code": "AI_SERVICE_UNAUTHORIZED"}, status_code=401)
        return JSONResponse(
            {
                "configured": bool(settings.provider_api_key.get_secret_value()),
                "provider": settings.provider,
                "model": settings.model,
                "providerHost": urlsplit(settings.provider_base_url).hostname,
            },
            headers={"Cache-Control": "no-store"},
        )

    @router.post("/infer")
    async def infer(request: Request) -> JSONResponse:
        if not authorized(request):
            return JSONResponse({"code": "AI_SERVICE_UNAUTHORIZED"}, status_code=401)
        body = bytearray()
        try:
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 110000:
                    raise AiFailure("AI_CONTEXT_TOO_LARGE", 413)
            data = InferenceRequest.model_validate_json(body)
            result = await provider.infer(data)
            return JSONResponse(result, headers={"Cache-Control": "no-store"})
        except ValidationError:
            return JSONResponse({"code": "AI_INVALID_REQUEST"}, status_code=400)
        except AiFailure as exc:
            return JSONResponse({"code": exc.code}, status_code=exc.status)

    return router
