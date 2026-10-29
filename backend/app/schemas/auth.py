from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator


class SignupIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    accept_terms: bool

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("Name is required")
        return v


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    remember: bool = False


class TokenIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)


class ForgotIn(BaseModel):
    email: EmailStr


class ResetIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    password: str = Field(min_length=1, max_length=128)


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=1, max_length=128)


class DeleteAccountIn(BaseModel):
    password: str = Field(min_length=1, max_length=128)


class ProfileUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    theme: Literal["system", "light", "dark"] | None = None


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    plan: str
    theme: str
    email_verified: bool
    created_at: str


class AuthOut(BaseModel):
    user: UserOut
    csrf_token: str
    email_delivery: Literal["sent", "logged", "failed", "none"] = "none"
    dev_verification_url: str | None = None  # only in development when no email provider is configured
