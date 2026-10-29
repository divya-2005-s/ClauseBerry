"""Argon2id password hashing and a basic strength policy."""
from __future__ import annotations

import re

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_hasher = PasswordHasher()  # argon2id with library-recommended parameters

_COMMON = {"password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123",
           "iloveyou", "letmein123", "welcome123", "admin12345", "clauseberry", "passw0rd"}

# A valid hash used to equalise timing when the user does not exist.
_DUMMY_HASH = _hasher.hash("timing-equaliser-not-a-real-password")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def password_problems(password: str, email: str | None = None, name: str | None = None) -> list[str]:
    problems = []
    if len(password) < 10:
        problems.append("Use at least 10 characters.")
    if len(password) > 128:
        problems.append("Use at most 128 characters.")
    if not re.search(r"[A-Za-z]", password) or not re.search(r"[\d\W_]", password):
        problems.append("Mix letters with numbers or symbols.")
    lowered = password.lower()
    if lowered in _COMMON:
        problems.append("This password is too common.")
    if email and email.split("@")[0].lower() in lowered and len(email.split("@")[0]) >= 4:
        problems.append("Don't include your email address.")
    return problems
