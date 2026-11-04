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


# ---- 健康检查 ------------------------------------------------------------


def healthz(app, req: Request) -> Response:
    return Response.json({
        "ok": True,
        "version": "1.0.0",
        "uptime_s": int(time.time() - app.started_at),
    })


# ---- 路由 ---------------------------------------------------------------


def register(router) -> None:
    router.add("POST", r"/v1/clients", register_stotp_client)
    router.add("GET", r"/v1/clients", list_clients)
    router.add("GET", r"/v1/clients/(?P<client_id>[0-9a-fA-F-]{36})", get_client)
    router.add("DELETE", r"/v1/clients/(?P<client_id>[0-9a-fA-F-]{36})", delete_client)
    router.add("POST", r"/v1/clients/(?P<client_id>[0-9a-fA-F-]{36})/rotate", rotate_client)
    router.add("GET", r"/v1/clients/(?P<client_id>[0-9a-fA-F-]{36})/epoch", client_epoch)
    router.add("POST", r"/v1/clients/(?P<client_id>[0-9a-fA-F-]{36})/descriptor",
               update_descriptor)
    router.add("POST", r"/v1/verify", verify)
    router.add("GET", r"/healthz", healthz)
