"""配置与启动密钥管理。"""

from __future__ import annotations

import base64
import os
import secrets
import sys
from dataclasses import dataclass, field

MASTER_KEY_ENV = "STOTP_MASTER_KEY"
SESSION_KEY_ENV = "STOTP_SESSION_KEY"
TOKEN_KEY_ENV = "STOTP_TOKEN_KEY"


def _decode_key(text: str) -> bytes:
    text = text.strip()
    for decoder in (base64.b64decode, bytes.fromhex):
        try:
            raw = decoder(text)
            if len(raw) == 32:
                return raw
        except Exception:  # noqa: BLE001 - 依次尝试两种编码
            continue
    raise SystemExit("密钥必须是 32 字节（base64 或 hex）")


def load_key(env_name: str, path: str) -> bytes:
    """环境变量优先；否则读取/生成 key 文件（base64 单行，权限 0600）。"""
    if os.environ.get(env_name):
        return _decode_key(os.environ[env_name])
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as fh:
            return _decode_key(fh.read())
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    key = secrets.token_bytes(32)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(base64.b64encode(key).decode() + "\n")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return key


@dataclass
class Config:
    host: str = "127.0.0.1"
    port: int = 8787
    db_path: str = "data/stotp.db"
    public_url: str | None = None
    dev_login: bool = False
    login_verify: bool = False
    require_tls: bool = False
    trust_proxy: bool = False
    epoch_seconds: int = 3600
    verify_budget_ms: float = 40.0
    allow_app_scheme: bool = True
    create_account: str | None = None
    log_level: str = "INFO"
    master_key: bytes = b""
    session_key: bytes = b""
    token_key: bytes = b""
    issuer: str = field(default="")

    @classmethod
    def from_env(cls, **overrides) -> "Config":
        cfg = cls(
            host=overrides.get("host", os.environ.get("STOTP_HOST", "127.0.0.1")),
            port=int(overrides.get("port", os.environ.get("STOTP_PORT", 8787))),
            db_path=overrides.get("db_path", os.environ.get("STOTP_DB", "data/stotp.db")),
            public_url=overrides.get("public_url", os.environ.get("STOTP_PUBLIC_URL")),
            dev_login=bool(overrides.get("dev_login", os.environ.get("STOTP_DEV_LOGIN") == "1")),
            login_verify=bool(overrides.get(
                "login_verify", os.environ.get("STOTP_LOGIN_VERIFY") == "1")),
            require_tls=bool(overrides.get("require_tls", os.environ.get("STOTP_REQUIRE_TLS") == "1")),
            trust_proxy=bool(overrides.get("trust_proxy", os.environ.get("STOTP_TRUST_PROXY") == "1")),
            epoch_seconds=int(overrides.get("epoch_seconds", os.environ.get("STOTP_EPOCH_SECONDS", 3600))),
            verify_budget_ms=float(overrides.get(
                "verify_budget_ms", os.environ.get("STOTP_VERIFY_BUDGET_MS", 40))),
            allow_app_scheme=bool(overrides.get(
                "allow_app_scheme", os.environ.get("STOTP_ALLOW_APP_SCHEME", "1") != "0")),
            create_account=overrides.get("create_account"),
            log_level=str(overrides.get("log_level", os.environ.get("STOTP_LOG_LEVEL", "INFO"))),
        )
        if not cfg.public_url:
            cfg.public_url = f"http://{cfg.host}:{cfg.port}"
        cfg.issuer = cfg.public_url.rstrip("/")

        key_dir = overrides.get("key_dir") or os.path.join(os.path.dirname(
            os.path.abspath(cfg.db_path)) or ".", "keys")
        cfg.master_key = load_key(MASTER_KEY_ENV, os.path.join(key_dir, "master.key"))
        cfg.session_key = load_key(SESSION_KEY_ENV, os.path.join(key_dir, "session.key"))
        cfg.token_key = load_key(TOKEN_KEY_ENV, os.path.join(key_dir, "token.key"))
        return cfg

    def validate(self) -> None:
        if self.epoch_seconds < 60:
            raise SystemExit("STOTP_EPOCH_SECONDS 不能小于 60")
        if self.verify_budget_ms < 0:
            raise SystemExit("STOTP_VERIFY_BUDGET_MS 不能为负")
        if self.dev_login and self.require_tls:
            print("注意：dev-login 仅用于本地联调，生产模式请关闭。", file=sys.stderr)
