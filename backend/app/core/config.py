"""Application settings loaded from environment variables (and an optional .env file).

List-valued settings are read from the environment as JSON arrays, e.g.
    CORS_ORIGINS='["http://localhost:4200","http://localhost:8080"]'
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Application -------------------------------------------------------
    app_name: str = "WorkMate AI"
    app_version: str = "0.1.0"
    environment: Literal["development", "production"] = "development"
    api_v1_prefix: str = "/api/v1"
    log_level: str = "INFO"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:4200"])

    # --- Local inference (Ollama) -----------------------------------------
    ollama_base_url: str = "http://localhost:11434"
    ollama_default_model: str = "llama3.2"
    ollama_connect_timeout_seconds: float = 3.0
    ollama_read_timeout_seconds: float = 120.0

    # --- Cloud inference (OpenAI-compatible Chat Completions API) ----------
    cloud_enabled: bool = True
    cloud_provider_name: str = "Approved Cloud LLM"
    cloud_base_url: str = "https://api.openai.com/v1"
    cloud_api_key: SecretStr | None = None
    cloud_default_model: str = "gpt-4o-mini"
    cloud_models: list[str] = Field(default_factory=lambda: ["gpt-4o-mini", "gpt-4o"])
    cloud_connect_timeout_seconds: float = 5.0
    cloud_read_timeout_seconds: float = 120.0

    # --- Routing rules -----------------------------------------------------
    # Any match in the conversation pins the request to local inference; it never leaves the network.
    routing_sensitive_phrases: list[str] = Field(
        default_factory=lambda: [
            "confidential",
            "internal only",
            "salary",
            "salaries",
            "payroll",
            "compensation",
            "ssn",
            "social security",
            "passport number",
            "bank account",
            "credit card",
            "password",
            "api key",
            "secret key",
            "medical",
            "diagnosis",
            "performance review",
            "disciplinary",
            "termination",
            "customer data",
            "pii",
            "nda",
        ]
    )
    # A match in the latest user message marks it as complex multi-step work for the cloud model.
    routing_complex_phrases: list[str] = Field(
        default_factory=lambda: [
            "analyze",
            "analyse",
            "analysis",
            "step by step",
            "step-by-step",
            "multi-step",
            "compare",
            "comparison",
            "trade-offs",
            "tradeoffs",
            "evaluate",
            "in-depth",
            "comprehensive",
            "strategy",
            "architecture",
            "root cause",
            "detailed report",
            "business case",
        ]
    )
    # Prompts at least this long are treated as complex even without a keyword match.
    routing_complex_min_chars: int = 600
    # Retry on the other provider when the first one fails before emitting any tokens.
    # Sensitive requests are never retried on the cloud provider regardless of this flag.
    routing_allow_fallback: bool = True

    @property
    def cloud_mock_mode(self) -> bool:
        """Cloud calls are simulated when no API key is configured."""
        return self.cloud_api_key is None or not self.cloud_api_key.get_secret_value().strip()


@lru_cache
def get_settings() -> Settings:
    return Settings()
