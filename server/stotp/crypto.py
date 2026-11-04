"""STOTP v1 密码学原语。

只依赖 `cryptography` 与标准库；所有派生标签集中在本文件，避免各处硬编码。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import struct
import time
import uuid as uuidlib

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# ---- 编码 ---------------------------------------------------------------


def b64e(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64d(text: str) -> bytes:
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + pad)


def hexs(data: bytes) -> str:
    return data.hex()


# ---- KDF ----------------------------------------------------------------


def hkdf(ikm: bytes, salt: bytes, info: bytes, length: int) -> bytes:
    """RFC 5869 HKDF-SHA256（单块输出，长度 ≤ 255*32）。"""
    prk = hmac.new(salt or b"\x00" * 32, ikm, hashlib.sha256).digest()
    okm = b""
    block = b""
    counter = 1
    while len(okm) < length:
        block = hmac.new(prk, block + info + bytes([counter]), hashlib.sha256).digest()
        okm += block
        counter += 1
    return okm[:length]


def derive_key(seed: bytes, client_id: str, label: str, length: int = 32) -> bytes:
    return hkdf(seed, client_id.encode("utf-8"), label.encode("utf-8"), length)


TOTP_LABEL = "stotp/totp/v1"
DESC_LABEL = "stotp/descriptor/v1"
UUID_LABEL = "stotp/uuid/v1"
RESPONSE_LABEL = "stotp/response/v1"
CRI_LABEL = "stotp/cri/v1"
DESC_PROOF_LABEL = "stotp/desc/v1"
ASSERT_LABEL = "stotp/assertion/v1"


# ---- AEAD ---------------------------------------------------------------


def seal(key: bytes, plaintext: bytes, aad: bytes = b"") -> bytes:
    """返回 nonce(12B) ‖ ciphertext+tag。"""
    nonce = os.urandom(12)
    return nonce + AESGCM(key).encrypt(nonce, plaintext, aad)


def unseal(key: bytes, blob: bytes, aad: bytes = b"") -> bytes:
    if len(blob) < 12 + 16:
        raise ValueError("sealed blob too short")
    return AESGCM(key).decrypt(blob[:12], blob[12:], aad)


# ---- TOTP (RFC 6238) -----------------------------------------------------


def hotp(secret: bytes, counter: int, digits: int = 6) -> str:
    msg = struct.pack(">Q", counter)
    digest = hmac.new(secret, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(value % (10 ** digits)).zfill(digits)


def totp(secret: bytes, at: float | None = None, step: int = 30, digits: int = 6) -> str:
    now = time.time() if at is None else at
    return hotp(secret, int(now // step), digits)


def totp_verify(secret: bytes, code: str, at: float | None = None, step: int = 30,
                digits: int = 6, skew: int = 1) -> bool:
    """常量时间比较 ±skew 步内的验证码。"""
    if not isinstance(code, str) or len(code) != digits or not code.isdigit():
        return False
    now = time.time() if at is None else at
    counter = int(now // step)
    candidate = bytearray(code.encode("ascii"))
    matched = False
    for delta in range(-skew, skew + 1):
        expected = hotp(secret, counter + delta, digits).encode("ascii")
        matched |= hmac.compare_digest(candidate, expected)
    return matched


# ---- UUID ---------------------------------------------------------------


def current_epoch(now: float | None = None, epoch_seconds: int = 3600) -> int:
    return int((time.time() if now is None else now) // epoch_seconds)


def derive_uuid(k_uuid: bytes, client_id: str, epoch: int) -> str:
    raw = hmac.new(
        k_uuid,
        b"stotp/uuid/v1" + client_id.encode("utf-8") + struct.pack(">Q", epoch),
        hashlib.sha256,
    ).digest()
    return str(uuidlib.UUID(bytes=raw[:16], version=8))


# ---- 注册指纹 ------------------------------------------------------------


def cri_fingerprint(seed: bytes, client_id: str) -> str:
    return hmac.new(
        seed, CRI_LABEL.encode("ascii") + client_id.encode("utf-8"), hashlib.sha256
    ).hexdigest()


def descriptor_proof(seed: bytes, client_id: str, desc_digest_hex: str) -> str:
    digest = bytes.fromhex(desc_digest_hex)
    return hmac.new(
        seed,
        DESC_PROOF_LABEL.encode("ascii") + client_id.encode("utf-8") + digest,
        hashlib.sha256,
    ).hexdigest()


def descriptor_digest(token: bytes) -> str:
    return hashlib.sha256(token).hexdigest()


def hmac_sha256(key: bytes, msg: bytes) -> bytes:
    return hmac.new(key, msg, hashlib.sha256).digest()


# ---- 口令 ---------------------------------------------------------------


PBKDF2_ROUNDS = 600_000


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${PBKDF2_ROUNDS}${b64e(salt)}${b64e(digest)}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algo, rounds, salt_b64, hash_b64 = encoded.split("$")
        if algo != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), b64d(salt_b64), int(rounds)
        )
        return hmac.compare_digest(digest, b64d(hash_b64))
    except (ValueError, TypeError):
        return False


# ---- JWT (HS256) -------------------------------------------------------


class JWTError(ValueError):
    pass


def _signing_input(header: dict, claims: dict) -> bytes:
    head = b64e(json.dumps(header, separators=(",", ":")).encode())
    body = b64e(json.dumps(claims, separators=(",", ":")).encode())
    return f"{head}.{body}".encode("ascii")


def jwt_encode(claims: dict, key: bytes, typ: str = "JWT") -> str:
    header = {"alg": "HS256", "typ": typ}
    signing_input = _signing_input(header, claims)
    signature = hmac.new(key, signing_input, hashlib.sha256).digest()
    return signing_input.decode("ascii") + "." + b64e(signature)


def jwt_decode(token: str, key: bytes, leeway: int = 30) -> dict:
    try:
        head_b64, body_b64, sig_b64 = token.split(".")
    except ValueError as exc:
        raise JWTError("malformed token") from exc
    signing_input = f"{head_b64}.{body_b64}".encode("ascii")
    expected = hmac.new(key, signing_input, hashlib.sha256).digest()
    if not hmac.compare_digest(expected, b64d(sig_b64)):
        raise JWTError("bad signature")
    header = json.loads(b64d(head_b64))
    if header.get("alg") != "HS256":
        raise JWTError("unsupported alg")
    claims = json.loads(b64d(body_b64))
    now = int(time.time())
    if "exp" in claims and now > int(claims["exp"]) + leeway:
        raise JWTError("expired")
    if "nbf" in claims and now < int(claims["nbf"]) - leeway:
        raise JWTError("not yet valid")
    return claims


# ---- 杂项 ---------------------------------------------------------------


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
