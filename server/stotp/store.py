"""SQLite 存储层。

- 每线程一个连接（ThreadingHTTPServer），WAL 模式。
- seed 以 AES-256-GCM 信封加密落库；client_secret 只存 SHA-256。
- 所有时间以 Unix 秒存储，对外再转 RFC 3339。
"""

from __future__ import annotations

import os
import sqlite3
import threading
import time
from datetime import datetime, timezone

from . import crypto


def utcnow() -> int:
    return int(time.time())


def iso(ts: int | None = None) -> str:
    return datetime.fromtimestamp(ts or utcnow(), tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
    id            TEXT PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id       TEXT PRIMARY KEY,
    secret_hash     TEXT,
    name            TEXT NOT NULL,
    redirect_uris   TEXT NOT NULL,
    grant_types     TEXT NOT NULL,
    scope           TEXT NOT NULL,
    assert_key_enc  BLOB,
    created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_codes (
    code_hash     TEXT PRIMARY KEY,
    client_id     TEXT NOT NULL,
    account_id    TEXT NOT NULL,
    redirect_uri  TEXT NOT NULL,
    code_challenge TEXT,
    scope         TEXT NOT NULL,
    expires_at    INTEGER NOT NULL,
    used          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    token_hash  TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL,
    client_id   TEXT NOT NULL,
    scope       TEXT NOT NULL,
    expires_at  INTEGER NOT NULL,
    revoked     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stotp_clients (
    id            TEXT PRIMARY KEY,
    account_id    TEXT NOT NULL,
    name          TEXT NOT NULL,
    platform      TEXT NOT NULL,
    seed_enc      BLOB NOT NULL,
    cri_fp        TEXT NOT NULL,
    desc_digest   TEXT NOT NULL,
    min_epoch     INTEGER NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    INTEGER NOT NULL,
    last_verify_at INTEGER
);

CREATE TABLE IF NOT EXISTS audit (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        INTEGER NOT NULL,
    event     TEXT NOT NULL,
    client_id TEXT,
    ip_hash   TEXT,
    detail    TEXT
);

CREATE INDEX IF NOT EXISTS idx_stotp_account ON stotp_clients(account_id);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts);
"""


class Store:
    def __init__(self, path: str, master_key: bytes):
        self.path = path
        self.master_key = master_key
        self._local = threading.local()
        if path != ":memory:":
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self.conn().executescript(SCHEMA)

    def conn(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(self.path, timeout=15, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA foreign_keys=ON")
            self._local.conn = conn
        return conn

    # ---- accounts ------------------------------------------------------

    def create_account(self, username: str, password: str) -> dict:
        account_id = "acc_" + crypto.b64e(os.urandom(12))
        self.conn().execute(
            "INSERT INTO accounts(id, username, password_hash, created_at) VALUES (?,?,?,?)",
            (account_id, username, crypto.hash_password(password), utcnow()),
        )
        self.conn().commit()
        return {"id": account_id, "username": username}

    def find_account(self, username: str) -> sqlite3.Row | None:
        return self.conn().execute(
            "SELECT * FROM accounts WHERE username = ?", (username,)
        ).fetchone()

    def get_account(self, account_id: str) -> sqlite3.Row | None:
        return self.conn().execute(
            "SELECT * FROM accounts WHERE id = ?", (account_id,)
        ).fetchone()

    # ---- oauth clients -------------------------------------------------

    def create_oauth_client(self, client_id: str, secret_hash: str | None, name: str,
                            redirect_uris: list[str], grant_types: list[str],
                            scope: str, assert_key_enc: bytes | None) -> None:
        self.conn().execute(
            "INSERT INTO oauth_clients(client_id, secret_hash, name, redirect_uris,"
            " grant_types, scope, assert_key_enc, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (client_id, secret_hash, name, "\n".join(redirect_uris),
             "\n".join(grant_types), scope, assert_key_enc, utcnow()),
        )
        self.conn().commit()

    def get_oauth_client(self, client_id: str) -> sqlite3.Row | None:
        return self.conn().execute(
            "SELECT * FROM oauth_clients WHERE client_id = ?", (client_id,)
        ).fetchone()

    # ---- auth codes ----------------------------------------------------

    def create_auth_code(self, code_hash: str, client_id: str, account_id: str,
                         redirect_uri: str, code_challenge: str, scope: str,
                         ttl: int = 600) -> None:
        self.conn().execute(
            "INSERT INTO auth_codes(code_hash, client_id, account_id, redirect_uri,"
            " code_challenge, scope, expires_at) VALUES (?,?,?,?,?,?,?)",
            (code_hash, client_id, account_id, redirect_uri, code_challenge,
             scope, utcnow() + ttl),
        )
        self.conn().commit()

    def consume_auth_code(self, code_hash: str) -> sqlite3.Row | None:
        row = self.conn().execute(
            "SELECT * FROM auth_codes WHERE code_hash = ?", (code_hash,)
        ).fetchone()
        if row is None or row["used"] or row["expires_at"] < utcnow():
            return None
        self.conn().execute(
            "UPDATE auth_codes SET used = 1 WHERE code_hash = ?", (code_hash,)
        )
        self.conn().commit()
        return row

    # ---- refresh tokens ------------------------------------------------

    def create_refresh_token(self, token_hash: str, account_id: str, client_id: str,
                             scope: str, ttl: int = 30 * 86400) -> None:
        self.conn().execute(
            "INSERT INTO refresh_tokens(token_hash, account_id, client_id, scope, expires_at)"
            " VALUES (?,?,?,?,?)",
            (token_hash, account_id, client_id, scope, utcnow() + ttl),
        )
        self.conn().commit()

    def get_refresh_token(self, token_hash: str) -> sqlite3.Row | None:
        row = self.conn().execute(
            "SELECT * FROM refresh_tokens WHERE token_hash = ?", (token_hash,)
        ).fetchone()
        if row is None or row["revoked"] or row["expires_at"] < utcnow():
            return None
        return row

    def revoke_refresh_token(self, token_hash: str) -> None:
        self.conn().execute(
            "UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?", (token_hash,)
        )
        self.conn().commit()

    # ---- stotp clients -------------------------------------------------

    def create_stotp_client(self, client_id: str, account_id: str, name: str,
                            platform: str, seed: bytes, cri_fp: str, desc_digest: str,
                            epoch: int) -> dict:
        seed_enc = crypto.seal(self.master_key, seed, b"seed:" + client_id.encode())
        self.conn().execute(
            "INSERT INTO stotp_clients(id, account_id, name, platform, seed_enc, cri_fp,"
            " desc_digest, min_epoch, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (client_id, account_id, name, platform, seed_enc, cri_fp, desc_digest,
             epoch, "active", utcnow()),
        )
        self.conn().commit()
        return self.get_stotp_client(client_id)  # type: ignore[return-value]

    def get_stotp_client(self, client_id: str) -> dict | None:
        row = self.conn().execute(
            "SELECT * FROM stotp_clients WHERE id = ?", (client_id,)
        ).fetchone()
        return dict(row) if row else None

    def list_stotp_clients(self, account_id: str) -> list[dict]:
        rows = self.conn().execute(
            "SELECT * FROM stotp_clients WHERE account_id = ? ORDER BY created_at DESC",
            (account_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_seed(self, client: dict) -> bytes:
        return crypto.unseal(
            self.master_key, client["seed_enc"], b"seed:" + client["id"].encode()
        )

    def set_client_status(self, client_id: str, status: str) -> None:
        self.conn().execute(
            "UPDATE stotp_clients SET status = ? WHERE id = ?", (status, client_id)
        )
        self.conn().commit()

    def set_min_epoch(self, client_id: str, epoch: int) -> None:
        self.conn().execute(
            "UPDATE stotp_clients SET min_epoch = ? WHERE id = ?", (epoch, client_id)
        )
        self.conn().commit()

    def set_desc_digest(self, client_id: str, digest: str) -> None:
        self.conn().execute(
            "UPDATE stotp_clients SET desc_digest = ? WHERE id = ?", (digest, client_id)
        )
        self.conn().commit()

    def touch_verify(self, client_id: str) -> None:
        self.conn().execute(
            "UPDATE stotp_clients SET last_verify_at = ? WHERE id = ?",
            (utcnow(), client_id),
        )
        self.conn().commit()

    # ---- audit ---------------------------------------------------------

    def audit(self, event: str, client_id: str | None = None,
              ip_hash: str | None = None, detail: str | None = None) -> None:
        self.conn().execute(
            "INSERT INTO audit(ts, event, client_id, ip_hash, detail) VALUES (?,?,?,?,?)",
            (utcnow(), event, client_id, ip_hash, detail),
        )
        self.conn().commit()

    def audit_tail(self, limit: int = 20) -> list[dict]:
        rows = self.conn().execute(
            "SELECT * FROM audit ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]
