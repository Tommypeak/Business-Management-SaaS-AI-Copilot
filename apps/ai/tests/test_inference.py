import json
from typing import Any

import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.core.config import Settings
from app.main import create_app
from app.services.inference import OpenAICompatibleProvider

SERVICE = "test-internal-credential-" + "x" * 32
KEY = "test-provider-credential-never-real"
BODY: dict[str, Any] = {
    "messages": [{"role": "user", "content": "How are sales?"}],
    "tools": [
        {
            "type": "function",
            "function": {
                "name": "get_sales_summary",
                "description": "Read sales",
                "strict": True,
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "required": [],
                    "additionalProperties": False,
                },
            },
        }
    ],
    "context": {
        "today": "2026-10-10",
        "timezone": "Asia/Qyzylorda",
        "defaultFrom": "2026-09-11",
        "defaultTo": "2026-10-10",
        "currency": "KZT",
    },
}


def completion(
    content: str | None = "No current metrics without a business tool.",
    calls: list[dict[str, Any]] | None = None,
    reason: str = "stop",
) -> dict[str, Any]:
    return {
        "choices": [
            {"message": {"content": content, "tool_calls": calls or []}, "finish_reason": reason}
        ],
        "usage": {"prompt_tokens": 100, "completion_tokens": 30},
    }


def tool(identifier: str = "call_1") -> dict[str, Any]:
    return {
        "id": identifier,
        "type": "function",
        "function": {"name": "get_sales_summary", "arguments": "{}"},
    }


def test_internal_auth_validation_and_disabled_provider() -> None:
    settings = Settings(environment="test", service_secret=SecretStr(SERVICE))
    with TestClient(create_app(settings)) as client:
        assert client.get("/internal/status").status_code == 401
        assert client.post("/internal/infer", json=BODY).status_code == 401
        headers = {"X-AI-Service-Secret": SERVICE}
        status = client.get("/internal/status", headers=headers)
        assert status.json()["configured"] is False
        response = client.post("/internal/infer", json=BODY, headers=headers)
        assert response.json() == {"code": "AI_PROVIDER_NOT_CONFIGURED"}
        bad = client.post(
            "/internal/infer", json={**BODY, "providerUrl": "http://private"}, headers=headers
        )
        assert bad.status_code == 400
        assert "private" not in bad.text
        large = client.post("/internal/infer", content=b" " * 110001, headers=headers)
        assert large.status_code == 413
        assert client.get("/docs").status_code == 404


@pytest.mark.parametrize(
    "result,expected",
    [
        (completion(), None),
        ({"choices": completion()["choices"]}, None),
        (completion(None, [tool()], "tool_calls"), None),
        (completion(None, [tool("one"), tool("two")], "tool_calls"), None),
        ({"invalid": True}, "AI_MALFORMED_RESPONSE"),
        (completion("", []), "AI_MALFORMED_RESPONSE"),
        (completion(None, [tool(), tool()], "tool_calls"), "AI_MALFORMED_RESPONSE"),
        (completion("x" * 12001), "AI_MALFORMED_RESPONSE"),
        (completion(KEY), "AI_MALFORMED_RESPONSE"),
        (completion(SERVICE), "AI_MALFORMED_RESPONSE"),
        (completion(reason="length"), "AI_OUTPUT_LIMIT"),
        (completion(reason="function_call"), "AI_PROVIDER_INCOMPATIBLE"),
        (completion(reason="content_filter"), "AI_MODEL_REFUSAL"),
        (
            {"choices": [{"message": {"refusal": "Cannot answer"}, "finish_reason": "stop"}]},
            "AI_MODEL_REFUSAL",
        ),
        (completion(None, [tool(str(n)) for n in range(7)], "tool_calls"), "AI_OUTPUT_LIMIT"),
    ],
)
def test_provider_structured_responses(
    result: dict[str, Any], expected: str | None, caplog: pytest.LogCaptureFixture
) -> None:
    seen: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "https://api.openai.com/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer " + KEY
        payload = json.loads(request.content)
        seen.append(payload)
        assert KEY not in json.dumps(payload)
        assert SERVICE not in json.dumps(payload)
        assert payload["store"] is False
        assert payload["max_completion_tokens"] == 1500
        assert "untrusted data" in payload["messages"][0]["content"]
        assert payload["tools"][0]["function"]["strict"] is True
        return httpx.Response(200, json=result)

    settings = Settings(
        environment="test", service_secret=SecretStr(SERVICE), provider_api_key=SecretStr(KEY)
    )
    provider = OpenAICompatibleProvider(settings, httpx.MockTransport(handler))
    with TestClient(create_app(settings, provider)) as client:
        response = client.post(
            "/internal/infer", json=BODY, headers={"X-AI-Service-Secret": SERVICE}
        )
    assert len(seen) == 1
    if expected:
        assert response.json() == {"code": expected}
    else:
        assert response.status_code == 200
        assert response.json()["usage"] == (
            {"inputTokens": 100, "outputTokens": 30} if "usage" in result else None
        )
    assert KEY not in response.text + caplog.text
    assert SERVICE not in response.text + caplog.text


@pytest.mark.parametrize(
    "status,code",
    [
        (429, "AI_PROVIDER_RATE_LIMIT"),
        (500, "AI_PROVIDER_UNAVAILABLE"),
        (401, "AI_PROVIDER_UNAVAILABLE"),
        (302, "AI_PROVIDER_UNAVAILABLE"),
        (400, "AI_PROVIDER_INCOMPATIBLE"),
    ],
)
def test_provider_http_failures(status: int, code: str) -> None:
    settings = Settings(service_secret=SecretStr(SERVICE), provider_api_key=SecretStr(KEY))
    transport = httpx.MockTransport(lambda _: httpx.Response(status, text=KEY + SERVICE))
    with TestClient(create_app(settings, OpenAICompatibleProvider(settings, transport))) as client:
        response = client.post(
            "/internal/infer", json=BODY, headers={"X-AI-Service-Secret": SERVICE}
        )
    assert response.json() == {"code": code}


@pytest.mark.parametrize("timeout", [True, False])
def test_provider_network_failure(timeout: bool) -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        if timeout:
            raise httpx.ReadTimeout(KEY)
        raise httpx.ConnectError(KEY)

    settings = Settings(service_secret=SecretStr(SERVICE), provider_api_key=SecretStr(KEY))
    with TestClient(
        create_app(settings, OpenAICompatibleProvider(settings, httpx.MockTransport(handler)))
    ) as client:
        response = client.post(
            "/internal/infer", json=BODY, headers={"X-AI-Service-Secret": SERVICE}
        )
    assert response.json() == {
        "code": "AI_PROVIDER_TIMEOUT" if timeout else "AI_PROVIDER_UNAVAILABLE"
    }


def test_context_limit_before_provider_and_untrusted_records() -> None:
    settings = Settings(
        service_secret=SecretStr(SERVICE),
        provider_api_key=SecretStr(KEY),
        max_context_characters=4000,
    )
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200)

    transport = httpx.MockTransport(handler)
    body = {**BODY, "messages": [{"role": "user", "content": "x" * 5000}]}
    with TestClient(create_app(settings, OpenAICompatibleProvider(settings, transport))) as client:
        response = client.post(
            "/internal/infer", json=body, headers={"X-AI-Service-Secret": SERVICE}
        )
    assert response.json() == {"code": "AI_CONTEXT_TOO_LARGE"}
    assert not calls


def test_configuration_rejects_unsafe_url_and_weak_internal_secret() -> None:
    for url in [
        "http://api.openai.com/v1",
        "https://key:secret@example.com/v1",
        "https://api.openai.com/v1?token=abc",
    ]:
        with pytest.raises(ValueError):
            Settings(provider_base_url=url)
    with pytest.raises(ValueError):
        Settings(service_secret=SecretStr("short"))
