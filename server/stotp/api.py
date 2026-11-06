"""STOTP 业务 API：注册、UUID 轮换、描述文件、验证。"""

from __future__ import annotations

import hmac
import json
import secrets
import struct
import time
import uuid as uuidlib

from . import crypto
from .auth import bearer_claims
from .http import HttpError, Request, Response
from .store import iso

SEALED_PLAINTEXT_LEN = 192
ASSERTION_BODY_LEN = 900


# ---- 通用 ---------------------------------------------------------------


def _now_epoch(app) -> int:
    return crypto.current_epoch(time.time(), app.cfg.epoch_seconds)


def _client_view(app, client: dict) -> dict:
    current = _now_epoch(app)
    epoch = max(current, client["min_epoch"])
    return {
        "client_id": client["id"],
        "account_id": client["account_id"],
        "name": client["name"],
        "platform": client["platform"],
        "status": client["status"],
        "created_at": iso(client["created_at"]),
        "epoch": epoch,
        "min_epoch": client["min_epoch"],
        "last_verify_at": iso(client["last_verify_at"]) if client["last_verify_at"] else None,
        "uuid_epoch_seconds": app.cfg.epoch_seconds,
    }


def _require_user(app, req: Request, scope: str) -> dict:
    claims = bearer_claims(app, req, scope)
    if str(claims.get("sub", "")).startswith("client:"):
        raise HttpError(403, "insufficient_scope", "需要用户令牌")
    return claims


def _owned_client(app, account_id: str, client_id: str) -> dict:
    client = app.store.get_stotp_client(client_id)
    if client is None or client["account_id"] != account_id:
        raise HttpError(404, "not_found", "客户端不存在")
    return client


def _valid_uuid4(value: str) -> bool:
    try:
        parsed = uuidlib.UUID(value)
    except (ValueError, AttributeError):
        return False
    return parsed.version == 4 and str(parsed) == value.lower()


def _hex64(value: object) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(
        c in "0123456789abcdef" for c in value.lower())


# ---- 客户端注册 ----------------------------------------------------------


def register_stotp_client(app, req: Request) -> Response:
    claims = _require_user(app, req, "stotp.clients")
    if not app.limiter.allow("clients:" + claims["sub"], 30, 30 / 3600):
        raise HttpError(429, "rate_limited", "注册过于频繁", {"Retry-After": "3600"})

    body = req.json()
    client_id = str(body.get("client_id") or "")
    if not _valid_uuid4(client_id):
        raise HttpError(400, "invalid_request", "client_id 必须是 UUIDv4")
    try:
        seed = crypto.b64d(str(body.get("seed") or ""))
    except Exception:  # noqa: BLE001
        seed = b""
    if len(seed) != 32:
        raise HttpError(400, "invalid_request", "seed 必须是 32 字节")
    name = str(body.get("name") or "").strip()
    if not name or len(name) > 64:
        raise HttpError(400, "invalid_request", "name 必填且不超过 64 字符")
    platform = str(body.get("platform") or "android").strip()[:32]
    cri_fp = str(body.get("cri_fp") or "")
    desc_digest = str(body.get("desc_digest") or "")
    desc_proof = str(body.get("desc_proof") or "")
    if not (_hex64(cri_fp) and _hex64(desc_digest) and _hex64(desc_proof)):
        raise HttpError(400, "invalid_request", "cri_fp / desc_digest / desc_proof 必须是 64 位 hex")

    if not hmac.compare_digest(cri_fp, crypto.cri_fingerprint(seed, client_id)):
        raise HttpError(400, "invalid_request", "cri_fp 与种子不匹配")
    if not hmac.compare_digest(desc_proof, crypto.descriptor_proof(seed, client_id, desc_digest)):
        raise HttpError(400, "invalid_request", "desc_proof 与种子不匹配")
    if app.store.get_stotp_client(client_id) is not None:
        raise HttpError(409, "already_exists", "client_id 已存在")

    epoch = _now_epoch(app)
    client = app.store.create_stotp_client(
        client_id, claims["sub"], name, platform, seed, cri_fp.lower(),
        desc_digest.lower(), epoch,
    )
    app.store.audit("client_register", client_id, app.ip_hash(req.client_ip))
    return Response.json(_client_view(app, client), 201)


def list_clients(app, req: Request) -> Response:
    claims = _require_user(app, req, "stotp.clients")
    clients = app.store.list_stotp_clients(claims["sub"])
    return Response.json({"clients": [_client_view(app, c) for c in clients]})


def get_client(app, req: Request, client_id: str) -> Response:
    claims = _require_user(app, req, "stotp.clients")
    return Response.json(_client_view(app, _owned_client(app, claims["sub"], client_id)))


def delete_client(app, req: Request, client_id: str) -> Response:
    claims = _require_user(app, req, "stotp.clients")
    client = _owned_client(app, claims["sub"], client_id)
    app.store.set_client_status(client["id"], "revoked")
    app.store.audit("client_revoke", client_id, app.ip_hash(req.client_ip))
    return Response.json({"ok": True, "client_id": client_id, "status": "revoked"})


def rotate_client(app, req: Request, client_id: str) -> Response:
    claims = _require_user(app, req, "stotp.clients")
    client = _owned_client(app, claims["sub"], client_id)
    floor = max(_now_epoch(app), client["min_epoch"]) + 1
    app.store.set_min_epoch(client_id, floor)
    app.store.audit("client_rotate", client_id, app.ip_hash(req.client_ip),
                    f"min_epoch={floor}")
    return Response.json({"ok": True, "client_id": client_id, "min_epoch": floor,
                          "epoch": floor})


def client_epoch(app, req: Request, client_id: str) -> Response:
    claims = _require_user(app, req, "stotp.clients")
    client = _owned_client(app, claims["sub"], client_id)
    current = _now_epoch(app)
    epoch = max(current, client["min_epoch"])
    next_at = (epoch + 1) * app.cfg.epoch_seconds
    return Response.json({
        "epoch": epoch,
        "min_epoch": client["min_epoch"],
        "server_time": iso(int(time.time())),
        "next_epoch_at": iso(next_at),
    })


def update_descriptor(app, req: Request, client_id: str) -> Response:
    claims = _require_user(app, req, "stotp.clients")
    client = _owned_client(app, claims["sub"], client_id)
    body = req.json()
    digest = str(body.get("desc_digest") or "")
    proof = str(body.get("desc_proof") or "")
    try:
        epoch = int(body.get("epoch"))
    except (TypeError, ValueError):
        raise HttpError(400, "invalid_request", "epoch 必须是整数") from None
    if not (_hex64(digest) and _hex64(proof)):
        raise HttpError(400, "invalid_request", "desc_digest / desc_proof 必须是 64 位 hex")
    seed = app.store.get_seed(client)
    if not hmac.compare_digest(proof, crypto.descriptor_proof(seed, client_id, digest)):
        app.store.set_client_status(client_id, "revoked")
        app.store.audit("descriptor_invalid", client_id, app.ip_hash(req.client_ip))
        raise HttpError(403, "client_revoked", "描述文件与注册信息不符，客户端已作废")
    app.store.set_desc_digest(client_id, digest.lower())
    app.store.audit("descriptor_update", client_id, app.ip_hash(req.client_ip))
    return Response.json({"ok": True, "client_id": client_id, "epoch": epoch})


# ---- 验证 ---------------------------------------------------------------


class _ReplayCache:
    def __init__(self) -> None:
        self._items: dict[str, float] = {}

    def seen(self, key: str, now: float) -> bool:
        if len(self._items) > 10000:
            self._items = {k: v for k, v in self._items.items() if v > now}
        return self._items.get(key, 0.0) > now

    def add(self, key: str, now: float, ttl: float = 90.0) -> None:
        self._items[key] = now + ttl


def _evaluate(app, client: dict | None, claims: dict, client_id: str,
              epoch_value, uuid_value: str, code: str) -> tuple[bool, str, bytes]:
    """执行与结果无关的同等工作量，返回 (allow, reason, seed)。"""
    seed = app.store.get_seed(client) if client else app.dummy_seed
    now = time.time()
    current = crypto.current_epoch(now, app.cfg.epoch_seconds)
    expected_epoch = max(current, client["min_epoch"]) if client else current

    # 与分支无关：至少做一次 UUID 派生与三次 TOTP 计算
    k_uuid = crypto.derive_key(seed, client_id, crypto.UUID_LABEL)
    expected_uuid = crypto.derive_uuid(k_uuid, client_id, expected_epoch)
    uuid_ok = hmac.compare_digest(expected_uuid.encode(), str(uuid_value).encode())

    k_totp = crypto.derive_key(seed, client_id, crypto.TOTP_LABEL, 20)
    code_ok = crypto.totp_verify(k_totp, code, at=now)

    if client is None:
        return False, "unknown_client", seed
    if client["status"] != "active":
        return False, "revoked", seed
    if app.mode_is_sealed(claims) and client["account_id"] != claims.get("sub"):
        return False, "unknown_client", seed
    try:
        presented_epoch = int(epoch_value)
    except (TypeError, ValueError):
        return False, "stale_epoch", seed
    if presented_epoch != expected_epoch:
        return False, "stale_epoch", seed
    if not uuid_ok:
        return False, "uuid_mismatch", seed
    if not client["desc_digest"]:
        return False, "descriptor_missing", seed
    if not code_ok:
        return False, "code_invalid", seed
    replay_key = f"{client_id}:{expected_epoch}:{code}"
    if app.replay.seen(replay_key, now):
        return False, "replay", seed
    return True, "ok", seed


def verify(app, req: Request) -> Response:
    started = time.monotonic()
    claims = bearer_claims(app, req, "stotp.verify")
    try:
        body = req.json(required=False)
    except HttpError:
        body = {}

    client_id = str(body.get("client_id") or "")
    epoch_value = body.get("epoch")
    uuid_value = str(body.get("uuid") or "")
    code = str(body.get("code") or "")
    sealed = app.mode_is_sealed(claims)

    client = app.store.get_stotp_client(client_id) if _valid_uuid4(client_id) else None

    ip_limited = not app.limiter.allow("verify-ip:" + req.client_ip, 60, 1.0)
    cid_limited = not app.limiter.allow("verify-cid:" + client_id, 10, 10 / 60)
    locked = app.failures.is_locked(client_id)

    allow, reason, seed = _evaluate(app, client, claims, client_id, epoch_value,
                                    uuid_value, code)
    if ip_limited or cid_limited or locked:
        allow, reason = False, "rate_limited" if (ip_limited or cid_limited) else "locked"

    now = time.time()
    epoch_out = max(crypto.current_epoch(now, app.cfg.epoch_seconds),
                    client["min_epoch"] if client else 0)
    if allow:
        app.replay.add(f"{client_id}:{epoch_out}:{code}", now)
        app.failures.reset(client_id)
        app.store.touch_verify(client_id)
    elif reason not in {"rate_limited", "locked"}:
        app.failures.fail(client_id)
    app.store.audit("verify_allow" if allow else "verify_deny", client_id,
                    app.ip_hash(req.client_ip), reason)

    if sealed:
        response = _sealed_response(app, seed, client_id, epoch_out, allow, reason)
    else:
        response = _assertion_response(app, claims, client, client_id, epoch_out,
                                       allow, reason)

    elapsed = time.monotonic() - started
    budget = app.cfg.verify_budget_ms / 1000.0
    if budget > elapsed:
        time.sleep(budget - elapsed)
    return response


def _sealed_response(app, seed: bytes, client_id: str, epoch: int,
                     allow: bool, reason: str) -> Response:
    key = crypto.derive_key(seed, client_id, crypto.RESPONSE_LABEL)
    payload = json.dumps({
        "ok": allow,
        "reason": reason,
        "client_id": client_id,
        "epoch": epoch,
        "ts": int(time.time()),
        "jti": secrets.token_hex(8),
    }, separators=(",", ":")).encode("utf-8")
    if len(payload) > SEALED_PLAINTEXT_LEN:
        payload = payload[:SEALED_PLAINTEXT_LEN]
    payload = payload.ljust(SEALED_PLAINTEXT_LEN, b" ")
    aad = client_id.encode("utf-8") + struct.pack(">Q", epoch)
    blob = crypto.seal(key, payload, aad)
    return Response.json({
        "v": 1,
        "mode": "sealed",
        "nonce": crypto.b64e(blob[:12]),
        "payload": crypto.b64e(blob[12:]),
    })


def _assertion_response(app, claims: dict, client: dict | None, client_id: str,
                        epoch: int, allow: bool, reason: str) -> Response:
    aud = claims.get("client_id", "")
    if client is not None and client["account_id"]:
        subject = client["account_id"]
    else:
        subject = "acc_" + "0" * 16
    now = int(time.time())
    assert_claims = {
        "iss": "stotp",
        "aud": aud,
        "sub": subject,
        "result": "allow" if allow else "deny",
        "reason": reason,
        "client_id": client_id,
        "epoch": epoch,
        "iat": now,
        "exp": now + 120,
        "jti": secrets.token_hex(8),
    }
    token = crypto.jwt_encode(assert_claims, app.assertion_key(aud))
    payload = {"v": 1, "mode": "assertion", "assertion": token, "pad": ""}
    raw = json.dumps(payload, separators=(",", ":"))
    padding = max(0, ASSERTION_BODY_LEN - len(raw))
    payload["pad"] = "0" * padding
    raw = json.dumps(payload, separators=(",", ":"))
    return Response.json(payload)


# ---- 登录站代算验证 ------------------------------------------------------


def login_verify(app, req: Request) -> Response:
    """登录站只提交 client_id + code；服务端自行代算 epoch/uuid。

    仅对 client_credentials 令牌开放，返回与 /v1/verify 相同的 assertion 结构。
    开关默认关闭，关闭时不影响现有 /v1/verify。
    """
    if not app.cfg.login_verify:
        raise HttpError(404, "not_found", "登录站验证接口未启用")

    started = time.monotonic()
    claims = bearer_claims(app, req, "stotp.verify")
    if not str(claims.get("sub", "")).startswith("client:"):
        raise HttpError(403, "insufficient_scope", "需要登录站客户端令牌")
    oauth_client_id = str(claims.get("client_id") or "")
    oauth_row = app.store.get_oauth_client(oauth_client_id)
    if oauth_row is None or not oauth_row["secret_hash"]:
        raise HttpError(403, "insufficient_scope", "登录站必须是机密客户端")

    try:
        body = req.json(required=False)
    except HttpError:
        body = {}
    if not isinstance(body, dict):
        body = {}

    raw_client_id = str(body.get("client_id") or "")
    # 非法/超长输入统一替换为固定 UUID，保证 assertion 长度不泄露输入差异
    if _valid_uuid4(raw_client_id):
        client_id = raw_client_id
        client = app.store.get_stotp_client(client_id)
    else:
        client_id = "00000000-0000-4000-8000-000000000000"
        client = None
    code = str(body.get("code") or "")[:16]

    current = _now_epoch(app)
    epoch = max(current, client["min_epoch"]) if client else current
    seed = app.store.get_seed(client) if client else app.dummy_seed
    uuid_value = crypto.derive_uuid(
        crypto.derive_key(seed, client_id, crypto.UUID_LABEL), client_id, epoch)

    ip_limited = not app.limiter.allow("login-verify-ip:" + req.client_ip, 60, 1.0)
    cid_limited = not app.limiter.allow("login-verify-cid:" + client_id, 10, 10 / 60)
    # 与 /v1/verify 的失败锁定分开，登录站的错误不会锁死客户端自检
    fail_key = "login:" + client_id
    locked = app.failures.is_locked(fail_key)

    allow, reason, _ = _evaluate(app, client, claims, client_id, epoch,
                                 uuid_value, code)
    if ip_limited or cid_limited or locked:
        allow, reason = False, "rate_limited" if (ip_limited or cid_limited) else "locked"

    now = time.time()
    if allow:
        app.replay.add(f"{client_id}:{epoch}:{code}", now)
        app.failures.reset(fail_key)
        app.store.touch_verify(client_id)
    elif reason not in {"rate_limited", "locked"}:
        app.failures.fail(fail_key)
    app.store.audit(
        "login_verify_allow" if allow else "login_verify_deny",
        client_id,
        app.ip_hash(req.client_ip),
        f"{reason};station={oauth_client_id}",
    )

    response = _assertion_response(app, claims, client, client_id, epoch,
                                   allow, reason)
    elapsed = time.monotonic() - started
    budget = app.cfg.verify_budget_ms / 1000.0
    if budget > elapsed:
        time.sleep(budget - elapsed)
    return response


# ---- 健康检查 ------------------------------------------------------------


def healthz(app, req: Request) -> Response:
    return Response.json({
        "ok": True,
        "version": "1.0.0",
        "uptime_s": int(time.time() - app.started_at),
    })


LANDING_HTML = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>STOTP 服务端</title>
<style>
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f5f7;
font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;
color:#1d1d1f;-webkit-font-smoothing:antialiased;padding:24px}
.card{width:min(560px,100%);background:#fff;border-radius:22px;padding:30px 28px;
box-shadow:0 1px 3px rgba(0,0,0,.05),0 14px 40px rgba(0,0,0,.05)}
.head{display:flex;align-items:center;gap:14px;margin-bottom:6px}
.mark{width:44px;height:44px;border-radius:14px;background:#0071e3;color:#fff;display:grid;
place-items:center;font-weight:700;font-size:22px}
h1{font-size:24px;letter-spacing:-.02em;margin:0}
.sub{color:#6e6e73;font-size:13px;margin:2px 0 0}
.dot{width:7px;height:7px;border-radius:50%;background:#30d158;display:inline-block;margin-right:6px}
.meta{display:flex;gap:16px;flex-wrap:wrap;color:#6e6e73;font-size:13px;margin:18px 0 4px}
.warn{margin:18px 0;background:rgba(255,107,0,.08);color:#8a4b00;border-radius:12px;
padding:12px 14px;font-size:13px;line-height:1.6}
ul{list-style:none;padding:0;margin:8px 0 0}
li{padding:11px 0;border-top:1px solid rgba(0,0,0,.07);font-size:14px;display:flex;
justify-content:space-between;gap:12px}
code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:13px;color:#1d1d1f}
a{color:#0071e3;text-decoration:none}
.foot{margin-top:18px;color:#86868b;font-size:11px}
</style></head><body>
<div class="card">
  <div class="head"><div class="mark">S</div><div><h1>STOTP 服务端</h1>
  <p class="sub"><span class="dot"></span>运行中 · Super-Enhanced TOTP</p></div></div>
  <div class="meta"><span>版本 __VERSION__</span><span>已运行 __UPTIME__ 秒</span></div>
  <div class="warn">当前是<b>明文 HTTP</b>。若浏览器自动跳转到 <code>https://</code>，会看到
  “Bad request version”——请手动改回 <code>http://</code>，或在前置反向代理（Caddy/Nginx）启用 TLS。</div>
  <ul>
    <li><span>健康检查</span><a href="/healthz">/healthz</a></li>
    <li><span>STOTP 配置</span><a href="/.well-known/stotp-configuration">/.well-known/stotp-configuration</a></li>
    <li><span>OIDC 发现</span><a href="/.well-known/openid-configuration">/.well-known/openid-configuration</a></li>
    <li><span>联调登录页</span><a href="/login">/login</a></li>
  </ul>
  <div class="foot">Android 客户端会通过 OAuth2 动态注册并完成 PKCE 登录与设备注册。</div>
</div></body></html>"""


def landing(app, req: Request) -> Response:
    html = (LANDING_HTML
            .replace("__VERSION__", "1.0.0")
            .replace("__UPTIME__", str(int(time.time() - app.started_at))))
    return Response(
        status=200,
        body=html.encode("utf-8"),
        content_type="text/html; charset=utf-8",
        headers={"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'"},
    )


def favicon(app, req: Request) -> Response:
    return Response(status=204)


# ---- 路由 ---------------------------------------------------------------


def register(router) -> None:
    router.add("GET", r"/", landing)
    router.add("GET", r"/favicon\.ico", favicon)
    router.add("POST", r"/v1/clients", register_stotp_client)
    router.add("GET", r"/v1/clients", list_clients)
    router.add("GET", r"/v1/clients/(?P<client_id>[0-9a-fA-F-]{36})", get_client)
    router.add("DELETE", r"/v1/clients/(?P<client_id>[0-9a-fA-F-]{36})", delete_client)
    router.add("POST", r"/v1/clients/(?P<client_id>[0-9a-fA-F-]{36})/rotate", rotate_client)
    router.add("GET", r"/v1/clients/(?P<client_id>[0-9a-fA-F-]{36})/epoch", client_epoch)
    router.add("POST", r"/v1/clients/(?P<client_id>[0-9a-fA-F-]{36})/descriptor",
               update_descriptor)
    router.add("POST", r"/v1/verify", verify)
    router.add("POST", r"/v1/login/verify", login_verify)
    router.add("GET", r"/healthz", healthz)
