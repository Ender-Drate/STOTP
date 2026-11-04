"""应用装配：配置、存储、路由、限速与辅助方法。"""

from __future__ import annotations

import hmac
import time

from . import api, crypto, oauth
from .config import Config
from .http import Handler, Router, StotpHTTPServer
from .ratelimit import FailureLock, RateLimiter
from .store import Store


class App:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.store = Store(cfg.db_path, cfg.master_key)
        self.router = Router()
        self.limiter = RateLimiter()
        self.failures = FailureLock(max_failures=5, window=900, lock_for=900)
        self.replay = api._ReplayCache()
        self.started_at = time.time()
        self.dummy_seed = crypto.hkdf(cfg.master_key, b"stotp/dummy", b"stotp/dummy/v1", 32)

        oauth.register(self.router)
        api.register(self.router)

        if cfg.create_account:
            self._ensure_account(cfg.create_account)

    # ---- 辅助 ----------------------------------------------------------

    def _ensure_account(self, spec: str) -> None:
        username, _, password = spec.partition(":")
        if not username or not password:
            raise SystemExit("--create-account 需要 user:password 格式")
        if self.store.find_account(username) is None:
            self.store.create_account(username, password)

    @staticmethod
    def mode_is_sealed(claims: dict) -> bool:
        return not str(claims.get("sub", "")).startswith("client:")

    def ip_hash(self, ip: str) -> str:
        digest = hmac.new(self.cfg.master_key, b"ip:" + ip.encode("utf-8"),
                          "sha256").hexdigest()
        return digest[:16]

    def assertion_key(self, oauth_client_id: str) -> bytes:
        row = self.store.get_oauth_client(oauth_client_id)
        if row is not None and row["assert_key_enc"]:
            return crypto.unseal(self.cfg.master_key, row["assert_key_enc"],
                                 b"assert:" + oauth_client_id.encode("utf-8"))
        return crypto.hkdf(self.cfg.master_key, b"stotp/assertion",
                           crypto.ASSERT_LABEL.encode("ascii"), 32)

    # ---- 服务器 --------------------------------------------------------

    def serve(self) -> None:
        server = StotpHTTPServer((self.cfg.host, self.cfg.port), Handler, self,
                                 trust_proxy=self.cfg.trust_proxy)
        print(f"STOTP 服务端已启动：http://{self.cfg.host}:{server.server_address[1]}"
              f"  (dev-login={self.cfg.dev_login})")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\n正在关闭…")
        finally:
            server.server_close()
