"""Authentication: sign-up, sign-in, sign-out, email verification and password reset."""
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, Request, Response

from ..core.config import get_settings
from ..core.errors import AppError
from ..core.ratelimit import limiter
from ..db.database import get_db, one
from ..schemas.auth import (AuthOut, ChangePasswordIn, ForgotIn, LoginIn, ResetIn, SignupIn, TokenIn, UserOut)
from ..security.deps import CurrentUser, auth_rate_limit, current_user, optional_user
from ..security.passwords import hash_password, needs_rehash, password_problems, verify_password
from ..security.sessions import (consume_email_token, create_session, destroy_all_sessions, destroy_session,
                                 new_email_token)
from ..services.email import send_email

router = APIRouter(prefix="/api/auth", tags=["auth"])


def user_out(u: CurrentUser | dict) -> UserOut:
    if isinstance(u, CurrentUser):
        return UserOut(id=u.id, email=u.email, name=u.name, plan=u.plan, theme=u.theme,
                       email_verified=u.email_verified, created_at=u.created_at)
    return UserOut(id=u["id"], email=u["email"], name=u["name"], plan=u["plan"], theme=u["theme"],
                   email_verified=u["email_verified_at"] is not None, created_at=u["created_at"])


def _csrf_from(response: Response) -> str:
    for header in response.headers.getlist("set-cookie"):
        if header.startswith(get_settings().csrf_cookie_name + "="):
            return header.split("=", 1)[1].split(";", 1)[0]
    return ""


def _send_verification(conn: sqlite3.Connection, user_id: int, email: str, name: str) -> tuple[str, str | None]:
    s = get_settings()
    token = new_email_token(conn, user_id, "verify_email", hours=48)
    url = f"{s.frontend_url}/verify-email?token={token}"
    status = send_email(conn, email, "Confirm your ClauseBerry email",
                        f"Hi {name},\n\nConfirm your email address to finish setting up ClauseBerry:\n{url}\n\n"
                        "This link expires in 48 hours. If you didn't create an account, ignore this email.", user_id)
    dev_url = url if (s.is_dev and status == "logged") else None
    return status, dev_url


@router.post("/signup", response_model=AuthOut, status_code=201, dependencies=[Depends(auth_rate_limit)])
def signup(body: SignupIn, request: Request, response: Response, conn: sqlite3.Connection = Depends(get_db)):
    if not body.accept_terms:
        raise AppError(422, "validation_error", "Please accept the Terms and Privacy Notice.",
                       {"fields": [{"field": "accept_terms", "message": "Required"}]})
    problems = password_problems(body.password, body.email, body.name)
    if problems:
        raise AppError(422, "weak_password", problems[0], {"fields": [{"field": "password", "message": p} for p in problems]})
    if one(conn, "SELECT id FROM users WHERE email = ?", (body.email,)):
        raise AppError(409, "email_taken", "An account with this email already exists. Try signing in instead.")
    cur = conn.execute("INSERT INTO users(email, name, password_hash) VALUES (?,?,?)",
                       (body.email.lower(), body.name, hash_password(body.password)))
    user_id = cur.lastrowid
    conn.execute("INSERT INTO notification_preferences(user_id) VALUES (?)", (user_id,))
    conn.commit()
    status, dev_url = _send_verification(conn, user_id, body.email, body.name)
    create_session(conn, response, user_id, remember=True, user_agent=request.headers.get("user-agent"))
    user = one(conn, "SELECT * FROM users WHERE id = ?", (user_id,))
    return AuthOut(user=user_out(user), csrf_token=_csrf_from(response), email_delivery=status,
                   dev_verification_url=dev_url)


@router.post("/login", response_model=AuthOut, dependencies=[Depends(auth_rate_limit)])
def login(body: LoginIn, request: Request, response: Response, conn: sqlite3.Connection = Depends(get_db)):
    # Per-account limit as well as per-IP: slows credential stuffing even when attempts come from many IPs.
    limiter.check(f"login:{body.email.lower()}", get_settings().rate_limit_login_per_account_15min, 900)
    user = one(conn, "SELECT * FROM users WHERE email = ?", (body.email,))
    if not verify_password(user["password_hash"] if user else None, body.password):
        raise AppError(401, "invalid_credentials", "That email and password combination didn't work.")
    if needs_rehash(user["password_hash"]):
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(body.password), user["id"]))
    create_session(conn, response, user["id"], remember=body.remember, user_agent=request.headers.get("user-agent"))
    return AuthOut(user=user_out(user), csrf_token=_csrf_from(response))


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, conn: sqlite3.Connection = Depends(get_db),
           _: CurrentUser | None = Depends(optional_user)):
    destroy_session(conn, response, request.cookies.get(get_settings().session_cookie_name))
    response.status_code = 204
    return response


@router.get("/me", response_model=AuthOut)
def me(user: CurrentUser = Depends(current_user)):
    return AuthOut(user=user_out(user), csrf_token=user.csrf_token)


@router.post("/verify-email", response_model=UserOut, dependencies=[Depends(auth_rate_limit)])
def verify_email(body: TokenIn, conn: sqlite3.Connection = Depends(get_db)):
    user_id = consume_email_token(conn, body.token, "verify_email")
    if not user_id:
        raise AppError(400, "invalid_token", "This verification link is invalid or has expired.")
    conn.execute("UPDATE users SET email_verified_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?", (user_id,))
    conn.commit()
    return user_out(one(conn, "SELECT * FROM users WHERE id = ?", (user_id,)))


@router.post("/resend-verification", dependencies=[Depends(auth_rate_limit)])
def resend_verification(user: CurrentUser = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    if user.email_verified:
        return {"email_delivery": "none", "already_verified": True}
    limiter.check(f"mail:{user.email.lower()}", get_settings().rate_limit_email_per_hour, 3600)
    status, dev_url = _send_verification(conn, user.id, user.email, user.name)
    return {"email_delivery": status, "dev_verification_url": dev_url}


@router.post("/forgot-password", dependencies=[Depends(auth_rate_limit)])
def forgot_password(body: ForgotIn, conn: sqlite3.Connection = Depends(get_db)):
    """Always answers the same way so the endpoint cannot be used to discover accounts."""
    s = get_settings()
    # Same limit whether or not the account exists, so a 429 reveals nothing; stops mail-bombing an address.
    limiter.check(f"mail:{body.email.lower()}", s.rate_limit_email_per_hour, 3600)
    user = one(conn, "SELECT id, name, email FROM users WHERE email = ?", (body.email,))
    dev_url = None
    if user:
        token = new_email_token(conn, user["id"], "reset_password", hours=1)
        url = f"{s.frontend_url}/reset-password?token={token}"
        status = send_email(conn, user["email"], "Reset your ClauseBerry password",
                            f"Hi {user['name']},\n\nReset your password with this link (valid for 1 hour):\n{url}\n\n"
                            "If you didn't ask for this, you can ignore this email.", user["id"])
        if s.is_dev and status == "logged":
            dev_url = url
    return {"message": "If an account exists for that email, a reset link is on its way.",
            "email_configured": s.email_configured, "dev_reset_url": dev_url}


@router.post("/reset-password", dependencies=[Depends(auth_rate_limit)])
def reset_password(body: ResetIn, conn: sqlite3.Connection = Depends(get_db)):
    user_id = consume_email_token(conn, body.token, "reset_password")
    if not user_id:
        raise AppError(400, "invalid_token", "This reset link is invalid or has expired. Request a new one.")
    user = one(conn, "SELECT email, name FROM users WHERE id = ?", (user_id,))
    problems = password_problems(body.password, user["email"], user["name"])
    if problems:
        conn.rollback()
        raise AppError(422, "weak_password", problems[0])
    conn.execute("UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), "
                 "email_verified_at = COALESCE(email_verified_at, strftime('%Y-%m-%dT%H:%M:%SZ','now')) WHERE id = ?",
                 (hash_password(body.password), user_id))
    conn.commit()
    destroy_all_sessions(conn, user_id)
    return {"message": "Password updated. Sign in with your new password."}


@router.post("/change-password")
def change_password(body: ChangePasswordIn, user: CurrentUser = Depends(current_user),
                    conn: sqlite3.Connection = Depends(get_db)):
    row = one(conn, "SELECT password_hash FROM users WHERE id = ?", (user.id,))
    if not verify_password(row["password_hash"], body.current_password):
        raise AppError(400, "invalid_password", "Your current password is incorrect.")
    problems = password_problems(body.new_password, user.email, user.name)
    if problems:
        raise AppError(422, "weak_password", problems[0])
    conn.execute("UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?",
                 (hash_password(body.new_password), user.id))
    conn.commit()
    destroy_all_sessions(conn, user.id, except_session_id=user.session_id)
    return {"message": "Password changed. Other sessions were signed out."}
