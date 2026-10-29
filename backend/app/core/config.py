"""Application settings, read from environment variables (and .env via pipeline.common)."""
from __future__ import annotations

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from pipeline.common import DEFAULT_GEMINI_MODEL  # also loads .env and the OS trust store


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    app_env: str = "development"                      # development | production | test
    frontend_url: str = "http://localhost:3000"       # used in email links
    cors_origins: str = "http://localhost:3000"       # comma separated
    session_cookie_name: str = "cb_session"
    csrf_cookie_name: str = "cb_csrf"
    session_days_remember: int = 30
    session_hours_default: int = 24
    cookie_secure: bool | None = None                 # defaults to True outside development

    gemini_api_key: str | None = None
    gemini_model: str = DEFAULT_GEMINI_MODEL

    resend_api_key: str | None = None
    email_from: str = "ClauseBerry <alerts@example.com>"

    # Per client address. Behind the Next.js same-origin proxy every request arrives from one address, so this
    # acts as a site-wide flood ceiling; per-account (login) and per-email (mail) limits do the targeted work.
    rate_limit_auth_per_minute: int = 30
    rate_limit_email_per_hour: int = 5                # reset/verification emails per address
    rate_limit_login_per_account_15min: int = 20      # per email address, independent of IP
    trusted_proxy_hops: int = 0                       # proxies whose X-Forwarded-For entries are trusted
    rate_limit_ask_per_10min: int = 20
    free_plan_follow_limit: int = 3
    policy_monitoring_enabled: bool = True
    policy_check_interval_hours: int = 24

    @field_validator("gemini_model", mode="before")
    @classmethod
    def _default_model(cls, v):
        return (v or "").strip() or DEFAULT_GEMINI_MODEL

    @field_validator("gemini_api_key", "resend_api_key", mode="before")
    @classmethod
    def _blank_is_none(cls, v):
        return (v or "").strip() or None

    @field_validator("policy_check_interval_hours")
    @classmethod
    def _valid_policy_check_interval(cls, value: int) -> int:
        if not 1 <= value <= 720:
            raise ValueError("policy_check_interval_hours must be between 1 and 720")
        return value

    @property
    def is_dev(self) -> bool:
        return self.app_env == "development"

    @property
    def secure_cookies(self) -> bool:
        return self.cookie_secure if self.cookie_secure is not None else self.app_env == "production"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def llm_configured(self) -> bool:
        return bool(self.gemini_api_key)

    @property
    def email_configured(self) -> bool:
        return bool(self.resend_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
