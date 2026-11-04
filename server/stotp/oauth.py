"""OAuth2 授权服务器（授权码 + PKCE、刷新令牌、客户端凭证）与 OIDC 发现文档。"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import time
import urllib.parse
from html import escape

from . import crypto
from .auth import (SCOPE_ALLOWED, issue_access_token, issue_id_token,
                   issue_session_cookie, session_account)
from .http import HttpError, OAuthFailure, Request, Response

APP_SCHEME_REDIRECT = "stotp://oauth/callback"


# ---- 工具 ---------------------------------------------------------------


def _oauth_error(status: int, code: str, description: str) -> Response:
    """构造 OAuth2 规范错误并立即抛出（调用处可写 return/raise，均会中断）。"""
    raise OAuthFailure(Response.json(
        {"error": code, "error_description": description}, status))


def _split_scopes(scope: str) -> list[str]:
    return [s for s in scope.replace(",", " ").split() if s]


def _valid_redirect(uri: str, allow_app_scheme: bool) -> bool:
    try:
        parts = urllib.parse.urlsplit(uri)
    except ValueError:
        return False
    if parts.fragment:
        return False
    if parts.scheme == "https" and parts.netloc:
        return True
    if parts.scheme == "http" and parts.hostname in {"localhost", "127.0.0.1", "::1"}:
        return True
    if allow_app_scheme and uri == APP_SCHEME_REDIRECT:
        return True
    return False


def _client_auth(app, req: Request, form: dict) -> tuple[dict, str | None]:
    """返回 (client row, presented secret)。支持 Basic 与 form 两种方式。"""
    header = req.header("authorization", "")
    client_id = form.get("client_id")
    secret = form.get("client_secret")
    if header.lower().startswith("basic "):
        try:
            raw = base64.b64decode(header[6:].strip()).decode("utf-8")
            client_id, _, secret = raw.partition(":")
            client_id = urllib.parse.unquote(client_id)
            secret = urllib.parse.unquote(secret)
        except Exception:  # noqa: BLE001
            raise _oauth_error(401, "invalid_client", "Basic 认证格式错误")
    if not client_id:
        raise _oauth_error(401, "invalid_client", "缺少 client_id")
    row = app.store.get_oauth_client(client_id)
    if row is None:
        raise _oauth_error(401, "invalid_client", "客户端不存在")
    if row["secret_hash"] and not secret:
        raise _oauth_error(401, "invalid_client", "缺少 client_secret")
    return dict(row), secret


def _check_secret(row: dict, secret: str | None) -> None:
    if not row["secret_hash"]:
        return  # public client（PKCE）
    if not secret or not hmac.compare_digest(crypto.sha256_hex(secret), row["secret_hash"]):
        raise _oauth_error(401, "invalid_client", "client_secret 错误")


def _pkce_ok(verifier: str, challenge: str) -> bool:
    if not verifier or not challenge:
        return False
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return hmac.compare_digest(crypto.b64e(digest), challenge)


# ---- 发现文档 ------------------------------------------------------------


def openid_configuration(app, req: Request) -> Response:
    base = app.cfg.issuer
    return Response.json({
        "issuer": base,
        "authorization_endpoint": base + "/oauth/authorize",
        "token_endpoint": base + "/oauth/token",
        "userinfo_endpoint": base + "/oauth/userinfo",
        "registration_endpoint": base + "/oauth/register",
        "scopes_supported": sorted(SCOPE_ALLOWED),
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token", "client_credentials"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post", "none"],
        "id_token_signing_alg_values_supported": ["HS256"],
    })


def stotp_configuration(app, req: Request) -> Response:
    return Response.json({
        "protocol": "stotp",
        "version": 1,
        "epoch_seconds": app.cfg.epoch_seconds,
        "totp": {"alg": "SHA1", "digits": 6, "period": 30, "skew_steps": 1},
        "algorithms": ["AES-256-REG"],
        "min_client_version": "0.1.0",
        "verify_modes": ["sealed", "assertion"],
    })


# ---- 动态客户端注册 ------------------------------------------------------


def register_client(app, req: Request) -> Response:
    if not app.limiter.allow("register:" + req.client_ip, 10, 10 / 3600):
        raise HttpError(429, "rate_limited", "注册过于频繁", {"Retry-After": "3600"})
    body = req.json()
    name = str(body.get("client_name") or "").strip()
    if not name or len(name) > 80:
        raise HttpError(400, "invalid_request", "client_name 必填且不超过 80 字符")
    uris = body.get("redirect_uris") or []
    if not isinstance(uris, list) or not uris:
        raise HttpError(400, "invalid_request", "redirect_uris 必填")
    for uri in uris:
        if not isinstance(uri, str) or not _valid_redirect(uri, app.cfg.allow_app_scheme):
            raise HttpError(400, "invalid_request", f"redirect_uri 不合法：{uri}")
    grants = body.get("grant_types") or ["authorization_code", "refresh_token"]
    allowed_grants = {"authorization_code", "refresh_token", "client_credentials"}
    if not set(grants) <= allowed_grants:
        raise HttpError(400, "invalid_request", "grant_types 含不支持的授权类型")
    scope = " ".join(_split_scopes(str(body.get("scope") or "openid profile stotp.verify")))
    if not set(_split_scopes(scope)) <= SCOPE_ALLOWED:
        raise HttpError(400, "invalid_request", "scope 含未定义作用域")
    auth_method = str(body.get("token_endpoint_auth_method") or "client_secret_basic")
    if auth_method not in {"client_secret_basic", "client_secret_post", "none"}:
        raise HttpError(400, "invalid_request", "不支持的 token_endpoint_auth_method")

    client_id = "srv_" + secrets.token_hex(8)
    secret = None if auth_method == "none" else "cs_" + secrets.token_urlsafe(32)
    secret_hash = crypto.sha256_hex(secret) if secret else None
    assert_key_enc = None
    if secret:
        assert_key = crypto.hkdf(secret.encode("utf-8"), client_id.encode("utf-8"),
                                 crypto.ASSERT_LABEL.encode("ascii"), 32)
        assert_key_enc = crypto.seal(app.cfg.master_key, assert_key,
                                     b"assert:" + client_id.encode())
    app.store.create_oauth_client(client_id, secret_hash, name, uris, grants, scope,
                                  assert_key_enc)
    payload = {
        "client_id": client_id,
        "client_name": name,
        "redirect_uris": uris,
        "grant_types": grants,
        "scope": scope,
        "token_endpoint_auth_method": auth_method,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    if secret:
        payload["client_secret"] = secret
        payload["client_secret_expires_at"] = 0
    return Response.json(payload, 201)


# ---- 授权端点 ------------------------------------------------------------


def authorize(app, req: Request) -> Response:
    q = req.query
    response_type = q.get("response_type")
    client_id = q.get("client_id", "")
    redirect_uri = q.get("redirect_uri", "")
    state = q.get("state")
    scope = " ".join(_split_scopes(q.get("scope", "openid profile")))
    challenge = q.get("code_challenge", "")
    method = q.get("code_challenge_method", "")

    row = app.store.get_oauth_client(client_id)
    if row is None:
        raise HttpError(400, "invalid_request", "未知的 client_id")
    if redirect_uri not in (row["redirect_uris"] or "").split("\n"):
        raise HttpError(400, "invalid_request", "redirect_uri 不在白名单")
    if response_type != "code":
        return _redirect_error(redirect_uri, "unsupported_response_type", state)
    if method != "S256" or not challenge:
        return _redirect_error(redirect_uri, "invalid_request", state)
    requested = set(_split_scopes(scope))
    if not requested <= set(_split_scopes(row["scope"])):
        return _redirect_error(redirect_uri, "invalid_scope", state)

    account = session_account(app, req)
    if account is None:
        if app.cfg.dev_login:
            ret = req.path + ("?" + urllib.parse.urlencode(q) if q else "")
            return Response(status=302, headers={
                "Location": "/login?return=" + urllib.parse.quote(ret, safe="")})
        return _oauth_error(401, "login_required", "需要先登录（生产环境由本地登录站签发会话）")

    code = secrets.token_urlsafe(32)
    app.store.create_auth_code(
        crypto.sha256_hex(code), client_id, account["id"], redirect_uri,
        challenge, scope,
    )
    params = {"code": code}
    if state:
        params["state"] = state
    location = redirect_uri + ("&" if "?" in redirect_uri else "?") + urllib.parse.urlencode(params)
    return Response(status=302, headers={"Location": location})


def _redirect_error(redirect_uri: str, code: str, state: str | None) -> Response:
    params = {"error": code}
    if state:
        params["state"] = state
    location = redirect_uri + ("&" if "?" in redirect_uri else "?") + urllib.parse.urlencode(params)
    return Response(status=302, headers={"Location": location})


# ---- 令牌端点 ------------------------------------------------------------


def token(app, req: Request) -> Response:
    if not app.limiter.allow("token:" + req.client_ip, 30, 30 / 60):
        raise HttpError(429, "rate_limited", "令牌请求过于频繁", {"Retry-After": "60"})
    form = req.form()
    grant_type = form.get("grant_type", "")
    row, secret = _client_auth(app, req, form)
    client_id = row["client_id"]

    if grant_type == "authorization_code":
        _check_secret(row, secret)
        code = form.get("code", "")
        redirect_uri = form.get("redirect_uri", "")
        verifier = form.get("code_verifier", "")
        stored = app.store.consume_auth_code(crypto.sha256_hex(code))
        if stored is None:
            return _oauth_error(400, "invalid_grant", "授权码无效或已使用")
        if stored["client_id"] != client_id or stored["redirect_uri"] != redirect_uri:
            return _oauth_error(400, "invalid_grant", "授权码与客户端/回调不匹配")
        if not _pkce_ok(verifier, stored["code_challenge"] or ""):
            return _oauth_error(400, "invalid_grant", "PKCE 校验失败")
        account = app.store.get_account(stored["account_id"])
        if account is None:
            return _oauth_error(400, "invalid_grant", "账户不存在")
        return _issue_tokens(app, account, client_id, stored["scope"])

    if grant_type == "refresh_token":
        _check_secret(row, secret)
        token_value = form.get("refresh_token", "")
        stored = app.store.get_refresh_token(crypto.sha256_hex(token_value))
        if stored is None or stored["client_id"] != client_id:
            return _oauth_error(400, "invalid_grant", "刷新令牌无效")
        app.store.revoke_refresh_token(stored["token_hash"])
        account = app.store.get_account(stored["account_id"])
        if account is None:
            return _oauth_error(400, "invalid_grant", "账户不存在")
        return _issue_tokens(app, account, client_id, stored["scope"])

    if grant_type == "client_credentials":
        if not row["secret_hash"]:
            return _oauth_error(401, "invalid_client", "公共客户端不支持 client_credentials")
        _check_secret(row, secret)
        requested = set(_split_scopes(form.get("scope", row["scope"])))
        if not requested <= set(_split_scopes(row["scope"])):
            return _oauth_error(400, "invalid_scope", "作用域超出客户端授权范围")
        scope = " ".join(sorted(requested))
        access = issue_access_token(app, "client:" + client_id, scope, client_id)
        return Response.json({
            "access_token": access,
            "token_type": "Bearer",
            "expires_in": 900,
            "scope": scope,
        })

    return _oauth_error(400, "unsupported_grant_type", "不支持的 grant_type")


def _issue_tokens(app, account, client_id: str, scope: str) -> Response:
    access = issue_access_token(app, account["id"], scope, client_id)
    refresh = "rt_" + secrets.token_urlsafe(48)
    app.store.create_refresh_token(crypto.sha256_hex(refresh), account["id"],
                                   client_id, scope)
    payload = {
        "access_token": access,
        "token_type": "Bearer",
        "expires_in": 900,
        "refresh_token": refresh,
        "scope": scope,
    }
    if "openid" in _split_scopes(scope):
        payload["id_token"] = issue_id_token(app, account["id"], account["username"],
                                             client_id)
    return Response.json(payload)


# ---- userinfo ------------------------------------------------------------


def userinfo(app, req: Request) -> Response:
    from .auth import bearer_claims
    claims = bearer_claims(app, req)
    if str(claims.get("sub", "")).startswith("client:"):
        raise HttpError(403, "insufficient_scope", "客户端令牌没有用户信息")
    account = app.store.get_account(claims["sub"])
    if account is None:
        raise HttpError(401, "invalid_token", "账户不存在")
    return Response.json({
        "sub": account["id"],
        "preferred_username": account["username"],
        "name": account["username"],
        "email": None,
    })


# ---- 内置 dev 登录页（仅联调） -------------------------------------------

LOGIN_HTML = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>STOTP · 登录</title>
<style>
:root{{color-scheme:light}}
*{{box-sizing:border-box}}
body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f5f7;
font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','PingFang SC','Microsoft YaHei',sans-serif;
color:#1d1d1f;-webkit-font-smoothing:antialiased}}
.card{{width:min(380px,calc(100vw - 40px));background:#fff;border-radius:22px;padding:34px 30px 28px;
box-shadow:0 1px 3px rgba(0,0,0,.05),0 14px 40px rgba(0,0,0,.05)}}
.mark{{width:44px;height:44px;border-radius:14px;background:#0071e3;color:#fff;display:grid;
place-items:center;font-weight:700;font-size:22px;margin-bottom:20px}}
h1{{font-size:26px;letter-spacing:-.02em;margin:0 0 6px}}
p.sub{{margin:0 0 24px;color:#6e6e73;font-size:14px;line-height:1.6}}
label{{display:block;font-size:12px;color:#6e6e73;margin:0 0 6px}}
input{{width:100%;height:44px;border:1px solid rgba(0,0,0,.12);border-radius:12px;padding:0 14px;
font-size:16px;background:#fbfbfd;outline:none}}
input:focus{{border-color:#0071e3;background:#fff}}
button{{width:100%;height:44px;margin-top:22px;border:0;border-radius:999px;background:#0071e3;
color:#fff;font-size:15px;font-weight:600;cursor:pointer}}
button:active{{transform:scale(.98);background:#0066cc}}
.err{{background:rgba(255,59,48,.1);color:#c00;border-radius:10px;padding:10px 12px;
font-size:13px;margin-bottom:16px}}
.foot{{margin-top:18px;font-size:11px;color:#86868b;text-align:center}}
</style></head><body>
<form class="card" method="post" action="/dev/login">
<div class="mark">S</div>
<h1>登录 STOTP</h1>
<p class="sub">这是仅用于本地联调的登录页。生产环境请由本地登录站签发会话。</p>
{error}
<input type="hidden" name="return" value="{return_to}">
<label for="u">用户名</label>
<input id="u" name="username" autocomplete="username" required>
<div style="height:14px"></div>
<label for="p">密码</label>
<input id="p" name="password" type="password" autocomplete="current-password" required>
<button type="submit">继续</button>
<div class="foot">STOTP · Super-Enhanced TOTP</div>
</form></body></html>"""


def login_page(app, req: Request) -> Response:
    if not app.cfg.dev_login:
        raise HttpError(404, "not_found", "登录页已禁用")
    return_to = req.query.get("return", "/")
    return Response.html(LOGIN_HTML.format(error="", return_to=escape(return_to)))


def login_submit(app, req: Request) -> Response:
    if not app.cfg.dev_login:
        raise HttpError(404, "not_found", "登录页已禁用")
    form = req.form()
    username = form.get("username", "")
    password = form.get("password", "")
    return_to = form.get("return", "/")
    if not app.limiter.allow("login:" + req.client_ip, 20, 20 / 300):
        raise HttpError(429, "rate_limited", "登录尝试过于频繁")
    account = app.store.find_account(username)
    if account is None or not crypto.verify_password(password, account["password_hash"]):
        error = '<div class="err">用户名或密码不正确</div>'
        return Response.html(LOGIN_HTML.format(error=error, return_to=escape(return_to)), 401)
    if not return_to.startswith("/") or return_to.startswith("//"):
        return_to = "/"
    return Response(status=302, headers={"Location": return_to},
                    cookies=[issue_session_cookie(app, account["id"], account["username"])])


# ---- 路由 ---------------------------------------------------------------


def register(router) -> None:
    router.add("GET", r"/\.well-known/openid-configuration", openid_configuration)
    router.add("GET", r"/\.well-known/stotp-configuration", stotp_configuration)
    router.add("POST", r"/oauth/register", register_client)
    router.add("GET", r"/oauth/authorize", authorize)
    router.add("POST", r"/oauth/token", token)
    router.add("GET", r"/oauth/userinfo", userinfo)
    router.add("GET", r"/login", login_page)
    router.add("POST", r"/dev/login", login_submit)
