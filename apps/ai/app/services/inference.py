import asyncio
import json
from typing import Annotated, Any, Literal

import httpx2 as httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.core.config import Settings
from app.services.prompt import SYSTEM_PROMPT, SYSTEM_PROMPT_VERSION


class AiFailure(Exception):
    def __init__(self, code: str, status: int = 503):
        self.code = code
        self.status = status


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class FunctionCall(StrictModel):
    name: str = Field(pattern=r"^[a-z_]{1,64}$")
    arguments: str = Field(max_length=4000)


class ToolCall(StrictModel):
    id: str = Field(pattern=r"^[\w-]{1,100}$")
    type: Literal["function"]
    function: FunctionCall


class Message(StrictModel):
    role: Literal["user", "assistant", "tool"]
    content: str | None = Field(max_length=30000)
    tool_call_id: str | None = Field(default=None, max_length=100)
    tool_calls: list[ToolCall] | None = Field(default=None, max_length=12)


class FunctionDefinition(StrictModel):
    name: str = Field(pattern=r"^[a-z_]{1,64}$")
    description: str = Field(max_length=1000)
    strict: Literal[True]
    parameters: dict[str, Any]


class ToolDefinition(StrictModel):
    type: Literal["function"]
    function: FunctionDefinition


class BusinessContext(StrictModel):
    today: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    timezone: str = Field(max_length=100)
    defaultFrom: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    defaultTo: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    currency: str = Field(pattern=r"^[A-Z]{3}$")


class InferenceRequest(StrictModel):
    messages: list[Message] = Field(min_length=1, max_length=50)
    tools: list[ToolDefinition] = Field(max_length=20)
    context: BusinessContext


class OutputMessage(BaseModel):
    # Only these validated fields leave the adapter; discard reasoning and extra metadata.
    content: str | None = Field(default=None, max_length=12000)
    refusal: str | None = Field(default=None, max_length=12000)
    tool_calls: list[ToolCall] = Field(default_factory=list, max_length=12)


class Choice(BaseModel):
    message: OutputMessage
    finish_reason: str


class Usage(BaseModel):
    prompt_tokens: Annotated[int, Field(strict=True, ge=0, le=10000000)]
    completion_tokens: Annotated[int, Field(strict=True, ge=0, le=10000000)]


class Completion(BaseModel):
    choices: list[Choice] = Field(min_length=1, max_length=1)
    usage: Usage | None = None


class OpenAICompatibleProvider:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.settings = settings
        self.transport = transport

    async def infer(self, request: InferenceRequest) -> dict[str, Any]:
        settings = self.settings
        key = settings.provider_api_key.get_secret_value()
        if not key:
            raise AiFailure("AI_PROVIDER_NOT_CONFIGURED")
        if len(request.model_dump_json()) > settings.max_context_characters:
            raise AiFailure("AI_CONTEXT_TOO_LARGE", 400)
        payload: dict[str, Any] = {
            "model": settings.model,
            "store": False,
            "stream": False,
            "max_completion_tokens": settings.max_output_tokens,
            "messages": [
                {
                    "role": "system",
                    "content": SYSTEM_PROMPT
                    + "\nContext: "
                    + request.context.model_dump_json()
                    + "\nVersion: "
                    + SYSTEM_PROMPT_VERSION,
                },
                *[m.model_dump(exclude_none=True) for m in request.messages],
            ],
        }
        if request.tools:
            payload["tools"] = [t.model_dump() for t in request.tools]
            payload["tool_choice"] = "auto"
        try:
            # No automatic retries: billing cannot be made exactly-once across network failures.
            async with asyncio.timeout(settings.request_timeout_ms / 1000):
                async with httpx.AsyncClient(
                    timeout=settings.request_timeout_ms / 1000,
                    follow_redirects=False,
                    trust_env=False,
                    transport=self.transport,
                ) as client:
                    async with client.stream(
                        "POST",
                        settings.provider_base_url.rstrip("/") + "/chat/completions",
                        headers={"Authorization": "Bearer " + key},
                        json=payload,
                    ) as response:
                        if response.status_code == 429:
                            raise AiFailure("AI_PROVIDER_RATE_LIMIT", 429)
                        if response.status_code in (400, 404, 422):
                            raise AiFailure("AI_PROVIDER_INCOMPATIBLE")
                        if response.status_code != 200:
                            raise AiFailure("AI_PROVIDER_UNAVAILABLE")
                        body = bytearray()
                        async for chunk in response.aiter_bytes():
                            body.extend(chunk)
                            if len(body) > 64000:
                                raise AiFailure("AI_OUTPUT_LIMIT")
            # Reject reflected credentials before persisting, returning or logging any model output.
            if key in body.decode("utf-8") or (
                settings.service_secret.get_secret_value()
                and settings.service_secret.get_secret_value() in body.decode("utf-8")
            ):
                raise AiFailure("AI_MALFORMED_RESPONSE")
            result = Completion.model_validate_json(body)
            choice = result.choices[0]
            message = choice.message
            if message.refusal or choice.finish_reason == "content_filter":
                raise AiFailure("AI_MODEL_REFUSAL")
            if choice.finish_reason == "length":
                raise AiFailure("AI_OUTPUT_LIMIT")
            if choice.finish_reason not in ("stop", "tool_calls"):
                raise AiFailure("AI_PROVIDER_INCOMPATIBLE")
            if len(message.tool_calls) > settings.max_tool_calls:
                raise AiFailure("AI_OUTPUT_LIMIT")
            if not message.tool_calls and not (message.content and message.content.strip()):
                raise AiFailure("AI_MALFORMED_RESPONSE")
            if len({c.id for c in message.tool_calls}) != len(message.tool_calls):
                raise AiFailure("AI_MALFORMED_RESPONSE")
            return {
                "content": message.content,
                "calls": [
                    {"id": c.id, "name": c.function.name, "arguments": c.function.arguments}
                    for c in message.tool_calls
                ],
                "usage": None
                if result.usage is None
                else {
                    "inputTokens": result.usage.prompt_tokens,
                    "outputTokens": result.usage.completion_tokens,
                },
                "provider": settings.provider,
                "model": settings.model,
            }
        except (httpx.TimeoutException, TimeoutError) as exc:
            raise AiFailure("AI_PROVIDER_TIMEOUT") from exc
        except httpx.HTTPError as exc:
            raise AiFailure("AI_PROVIDER_UNAVAILABLE") from exc
        except (ValidationError, ValueError, UnicodeError, json.JSONDecodeError) as exc:
            raise AiFailure("AI_MALFORMED_RESPONSE") from exc
