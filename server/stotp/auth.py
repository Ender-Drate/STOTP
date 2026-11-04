"""OAuth2 令牌与会话。"""

from __future__ import annotations

import time
import uuid as uuidlib

from . import crypto
from .http import HttpError, Request

SCOPE_ALLOWED = {"openid", "profile", "stotp.verify", "stotp.clients"}
ACCESS_TTL = 900
SESSION_COOKIE = "stotp_session"


def issue_access_token(app, account_id: str, scope: str, client_id: str) -> str:
    now = int(time.time())
    claims = {
        "iss": app.cfg.issuer,
        "sub": account_id,
        "aud": client_id,
        "scope": scope,
        "client_id": client_id,
        "iat": now,
        "exp": now + ACCESS_TTL,
        "jti": uuidlib.uuid4().hex,
        "typ": "access",
    }
    return crypto.jwt_encode(claims, app.cfg.token_key)


def issue_id_token(app, account_id: str, username: str, client_id: str,
                   nonce: str | None = None) -> str:
    now = int(time.time())
    claims = {
        "iss": app.cfg.issuer,
        "sub": account_id,
        "aud": client_id,
        "iat": now,
        "exp": now + ACCESS_TTL,
        "auth_time": now,
        "preferred_username": username,
    }
    if nonce:
        claims["nonce"] = nonce
    return crypto.jwt_encode(claims, app.cfg.token_key)


def bearer_claims(app, req: Request, required_scope: str | None = None) -> dict:
    header = req.header("authorization", "")
    if not header or not header.lower().startswith("bearer "):
        raise HttpError(401, "invalid_token", "缺少 Bearer 令牌",
                        {"WWW-Authenticate": "Bearer"})
    token = header[7:].strip()
    try:
        claims = crypto.jwt_decode(token, app.cfg.token_key)
    except crypto.JWTError as exc:
        raise HttpError(401, "invalid_token", "令牌无效或已过期",
                        {"WWW-Authenticate": "Bearer error=\"invalid_token\""}) from exc
    if claims.get("typ") != "access":
        raise HttpError(401, "invalid_token", "令牌类型错误")
    if required_scope:
        scopes = set(str(claims.get("scope", "")).split())
        if required_scope not in scopes:
            raise HttpError(403, "insufficient_scope", f"缺少作用域 {required_scope}")
    return claims


def issue_session_cookie(app, account_id: str, username: str) -> str:
    now = int(time.time())
    claims = {
        "sub": account_id,
        "username": username,
        "iat": now,
        "exp": now + 8 * 3600,
        "jti": uuidlib.uuid4().hex,
    }
    token = crypto.jwt_encode(claims, app.cfg.session_key)
    secure = "; Secure" if app.cfg.require_tls else ""
    return (f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; "
            f"Max-Age=28800{secure}")


def session_account(app, req: Request):
    cookie_header = req.header("cookie", "")
    token = None
    for part in cookie_header.split(";"):
        name, _, value = part.strip().partition("=")
        if name == SESSION_COOKIE:
            token = value
            break
    if not token:
        return None
    try:
        claims = crypto.jwt_decode(token, app.cfg.session_key)
    except crypto.JWTError:
        return None
    return app.store.get_account(claims.get("sub", ""))
