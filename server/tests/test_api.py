"""端到端 API 测试：真实 HTTP 服务器 + 临时数据库。"""

import http.client
import json
import os
import shutil
import struct
import tempfile
import threading
import unittest
import uuid

from stotp import api, crypto
from stotp.app import App
from stotp.auth import issue_access_token
from stotp.config import Config
from stotp.http import Handler, StotpHTTPServer
from stotp.ratelimit import FailureLock


def make_descriptor(seed: bytes, client_id: str, epoch: int) -> bytes:
    key = crypto.derive_key(seed, client_id, crypto.DESC_LABEL)
    payload = json.dumps({
        "v": 1, "client_id": client_id, "epoch": epoch, "alg": "SHA1",
        "digits": 6, "period": 30, "secret": crypto.b64e(
            crypto.derive_key(seed, client_id, crypto.TOTP_LABEL, 20)),
    }).encode()
    aad = b"stotp/descriptor/v1" + client_id.encode() + struct.pack(">Q", epoch)
    blob = crypto.seal(key, payload, aad)
    return b"STOTPCD" + bytes([1]) + struct.pack(">Q", epoch) + blob


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="stotp-test-")
        cfg = Config.from_env(
            host="127.0.0.1", port=0,
            db_path=os.path.join(cls.tmp, "test.db"),
            key_dir=os.path.join(cls.tmp, "keys"),
            dev_login=True, verify_budget_ms=0,
        )
        cfg.validate()
        cls.app = App(cfg)
        cls.app.failures = FailureLock(max_failures=1000)
        cls.server = StotpHTTPServer(("127.0.0.1", 0), Handler, cls.app)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.account = cls.app.store.create_account("demo", "demo-pass-1234")
        cls.token = issue_access_token(cls.app, cls.account["id"],
                                       "stotp.clients stotp.verify", "test-client")

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    # ---- helpers -------------------------------------------------------

    def request(self, method, path, body=None, token=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        hdrs = {"Content-Type": "application/json"}
        if token:
            hdrs["Authorization"] = "Bearer " + token
        if headers:
            hdrs.update(headers)
        data = json.dumps(body).encode() if body is not None else None
        conn.request(method, path, body=data, headers=hdrs)
        resp = conn.getresponse()
        raw = resp.read()
        conn.close()
        return resp.status, raw

    def register(self):
        seed = os.urandom(32)
        client_id = str(uuid.uuid4())
        epoch = crypto.current_epoch()
        digest = crypto.descriptor_digest(make_descriptor(seed, client_id, epoch))
        body = {
            "client_id": client_id,
            "seed": crypto.b64e(seed),
            "name": "Pixel 7",
            "platform": "android",
            "cri_fp": crypto.cri_fingerprint(seed, client_id),
            "desc_digest": digest,
            "desc_proof": crypto.descriptor_proof(seed, client_id, digest),
        }
        status, raw = self.request("POST", "/v1/clients", body, self.token)
        self.assertEqual(status, 201, raw)
        return client_id, seed, epoch

    # ---- tests ---------------------------------------------------------

    def test_register_and_epoch(self):
        client_id, _, epoch = self.register()
        status, raw = self.request("GET", f"/v1/clients/{client_id}/epoch", token=self.token)
        self.assertEqual(status, 200)
        data = json.loads(raw)
        self.assertEqual(data["epoch"], epoch)

    def test_verify_sealed_allow_and_deny_are_uniform(self):
        client_id, seed, epoch = self.register()
        k_totp = crypto.derive_key(seed, client_id, crypto.TOTP_LABEL, 20)
        code = crypto.totp(k_totp)
        body = {"client_id": client_id, "epoch": epoch,
                "uuid": crypto.derive_uuid(crypto.derive_key(
                    seed, client_id, crypto.UUID_LABEL), client_id, epoch),
                "code": code}
        status, raw = self.request("POST", "/v1/verify", body, self.token)
        self.assertEqual(status, 200)
        payload = json.loads(raw)
        self.assertEqual(payload["mode"], "sealed")

        k_resp = crypto.derive_key(seed, client_id, crypto.RESPONSE_LABEL)
        aad = client_id.encode() + struct.pack(">Q", epoch)
        result = json.loads(crypto.unseal(
            k_resp, crypto.b64d(payload["nonce"]) + crypto.b64d(payload["payload"]), aad))
        self.assertTrue(result["ok"], result)

        # 错误验证码：仍然 200，长度一致，不可区分
        body["code"] = "000000" if code != "000000" else "111111"
        status2, raw2 = self.request("POST", "/v1/verify", body, self.token)
        self.assertEqual(status2, 200)
        self.assertEqual(len(raw2), len(raw))

        # 未知客户端：仍然 200，长度一致
        body["client_id"] = str(uuid.uuid4())
        status3, raw3 = self.request("POST", "/v1/verify", body, self.token)
        self.assertEqual(status3, 200)
        self.assertEqual(len(raw3), len(raw))

    def test_replay_rejected(self):
        client_id, seed, epoch = self.register()
        code = crypto.totp(crypto.derive_key(seed, client_id, crypto.TOTP_LABEL, 20))
        body = {"client_id": client_id, "epoch": epoch,
                "uuid": crypto.derive_uuid(crypto.derive_key(
                    seed, client_id, crypto.UUID_LABEL), client_id, epoch),
                "code": code}
        self.request("POST", "/v1/verify", body, self.token)
        status, raw = self.request("POST", "/v1/verify", body, self.token)
        self.assertEqual(status, 200)
        # 第二次使用同一验证码必须拒绝（密文不可读，靠审计判断）
        rows = [r for r in self.app.store.audit_tail(5)
                if r["event"] == "verify_deny" and r["client_id"] == client_id]
        self.assertTrue(any(r["detail"] == "replay" for r in rows), rows)

    def test_rotate_invalidates_old_epoch(self):
        client_id, seed, epoch = self.register()
        status, raw = self.request("POST", f"/v1/clients/{client_id}/rotate",
                                   token=self.token)
        self.assertEqual(status, 200)
        new_epoch = json.loads(raw)["min_epoch"]
        self.assertGreater(new_epoch, epoch)
        code = crypto.totp(crypto.derive_key(seed, client_id, crypto.TOTP_LABEL, 20))
        body = {"client_id": client_id, "epoch": epoch,
                "uuid": crypto.derive_uuid(crypto.derive_key(
                    seed, client_id, crypto.UUID_LABEL), client_id, epoch),
                "code": code}
        self.request("POST", "/v1/verify", body, self.token)
        rows = [r for r in self.app.store.audit_tail(5)
                if r["client_id"] == client_id and r["event"] == "verify_deny"]
        self.assertTrue(any(r["detail"] == "stale_epoch" for r in rows), rows)

    def test_descriptor_mismatch_revokes(self):
        client_id, seed, epoch = self.register()
        body = {"epoch": epoch, "desc_digest": "0" * 64, "desc_proof": "0" * 64}
        status, _ = self.request("POST", f"/v1/clients/{client_id}/descriptor",
                                 body, self.token)
        self.assertEqual(status, 403)
        row = self.app.store.get_stotp_client(client_id)
        self.assertEqual(row["status"], "revoked")

    def test_client_credentials_assertion(self):
        status, raw = self.request("POST", "/oauth/register", {
            "client_name": "Login Site",
            "redirect_uris": ["https://login.example.com/callback"],
            "grant_types": ["authorization_code", "refresh_token", "client_credentials"],
            "scope": "openid profile stotp.verify",
        })
        self.assertEqual(status, 201, raw)
        oauth_client = json.loads(raw)
        form = (f"grant_type=client_credentials&client_id={oauth_client['client_id']}"
                f"&client_secret={oauth_client['client_secret']}&scope=stotp.verify")
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.request("POST", "/oauth/token", body=form,
                     headers={"Content-Type": "application/x-www-form-urlencoded"})
        resp = conn.getresponse()
        token_data = json.loads(resp.read())
        conn.close()
        self.assertIn("access_token", token_data)

        client_id, seed, epoch = self.register()
        code = crypto.totp(crypto.derive_key(seed, client_id, crypto.TOTP_LABEL, 20))
        body = {"client_id": client_id, "epoch": epoch,
                "uuid": crypto.derive_uuid(crypto.derive_key(
                    seed, client_id, crypto.UUID_LABEL), client_id, epoch),
                "code": code}
        status, raw = self.request("POST", "/v1/verify", body,
                                   token_data["access_token"])
        self.assertEqual(status, 200)
        payload = json.loads(raw)
        self.assertEqual(payload["mode"], "assertion")
        assert_key = crypto.hkdf(oauth_client["client_secret"].encode(),
                                 oauth_client["client_id"].encode(),
                                 crypto.ASSERT_LABEL.encode(), 32)
        claims = crypto.jwt_decode(payload["assertion"], assert_key)
        self.assertEqual(claims["result"], "allow")
        self.assertEqual(claims["aud"], oauth_client["client_id"])

    def test_dev_login_page_renders(self):
        status, raw = self.request("GET", "/login")
        self.assertEqual(status, 200)
        self.assertIn(b"STOTP", raw)
        # CSS 花括号不能被 str.format 破坏
        self.assertNotIn(b"{{", raw)

    def test_landing_page(self):
        status, raw = self.request("GET", "/")
        self.assertEqual(status, 200)
        body = raw.decode("utf-8")
        self.assertIn("STOTP 服务端", body)
        self.assertIn("/healthz", body)
        self.assertIn("http://", body)

    def test_favicon_no_content(self):
        status, raw = self.request("GET", "/favicon.ico")
        self.assertEqual(status, 204)
        self.assertEqual(raw, b"")


class RequireTlsTest(unittest.TestCase):
    """require_tls=1 时必须带 X-Forwarded-Proto: https。"""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="stotp-tls-")
        cfg = Config.from_env(
            host="127.0.0.1", port=0,
            db_path=os.path.join(cls.tmp, "tls.db"),
            key_dir=os.path.join(cls.tmp, "keys"),
            dev_login=False, verify_budget_ms=0, require_tls=True,
        )
        cls.app = App(cfg)
        cls.server = StotpHTTPServer(("127.0.0.1", 0), Handler, cls.app)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def get(self, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.request("GET", "/healthz", headers=headers or {})
        resp = conn.getresponse()
        body = resp.read()
        conn.close()
        return resp.status, resp.getheader("Strict-Transport-Security"), body

    def test_rejects_plaintext(self):
        status, _, body = self.get()
        self.assertEqual(status, 400)
        self.assertIn(b"tls_required", body)

    def test_accepts_forwarded_https(self):
        status, hsts, _ = self.get({"X-Forwarded-Proto": "https"})
        self.assertEqual(status, 200)
        self.assertIn("max-age=31536000", hsts or "")


if __name__ == "__main__":
    unittest.main()
