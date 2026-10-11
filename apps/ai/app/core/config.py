from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AI_", extra="ignore")

    environment: Literal["development", "test", "production"] = "production"
    provider: Literal["openai-compatible"] = "openai-compatible"
    model: str = Field(default="gpt-4.1-mini", min_length=1, max_length=120)
    provider_api_key: SecretStr = SecretStr("")
    service_secret: SecretStr = SecretStr("")
    provider_base_url: str = "https://api.openai.com/v1"
    request_timeout_ms: int = Field(default=20000, ge=1000, le=30000)
    max_output_tokens: int = Field(default=1500, ge=128, le=8000)
    max_context_characters: int = Field(default=48000, ge=4000, le=100000)
    max_tool_calls: int = Field(default=6, ge=1, le=12)

    @model_validator(mode="after")
    def trusted_configuration(self) -> "Settings":
        url = urlsplit(self.provider_base_url)
        if (
            url.scheme != "https"
            or not url.hostname
            or url.username
            or url.password
            or url.query
            or url.fragment
        ):
            raise ValueError("AI_PROVIDER_BASE_URL must be an HTTPS URL without credentials/query")
        secret = self.service_secret.get_secret_value()
        if secret and len(secret) < 32:
            raise ValueError("AI_SERVICE_SECRET must contain at least 32 characters")
        return self
