import os
import tempfile
import unittest
from unittest.mock import patch

from stotp.__main__ import build_config, build_parser


class CliEnvTest(unittest.TestCase):
    def parse(self, argv):
        return build_parser().parse_args(argv)

    def test_env_used_when_no_cli_flags(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {
                "STOTP_HOST": "0.0.0.0",
                "STOTP_PORT": "8799",
                "STOTP_DB": os.path.join(tmp, "env.db"),
                "STOTP_PUBLIC_URL": "https://env.example.com",
                "STOTP_REQUIRE_TLS": "1",
                "STOTP_TRUST_PROXY": "1",
                "STOTP_DEV_LOGIN": "1",
            }
            with patch.dict(os.environ, env, clear=False):
                cfg = build_config(self.parse([]))
            self.assertEqual(cfg.host, "0.0.0.0")
            self.assertEqual(cfg.port, 8799)
            self.assertEqual(cfg.db_path, os.path.join(tmp, "env.db"))
            self.assertEqual(cfg.public_url, "https://env.example.com")
            self.assertTrue(cfg.require_tls)
            self.assertTrue(cfg.trust_proxy)
            self.assertTrue(cfg.dev_login)

    def test_cli_overrides_env(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {
                "STOTP_HOST": "0.0.0.0",
                "STOTP_PORT": "8799",
                "STOTP_DB": os.path.join(tmp, "env.db"),
                "STOTP_PUBLIC_URL": "https://env.example.com",
            }
            with patch.dict(os.environ, env, clear=False):
                cfg = build_config(self.parse([
                    "--host", "127.0.0.1",
                    "--port", "8800",
                    "--public-url", "https://cli.example.com",
                ]))
            self.assertEqual(cfg.host, "127.0.0.1")
            self.assertEqual(cfg.port, 8800)
            self.assertEqual(cfg.public_url, "https://cli.example.com")
            # 未显式覆盖的仍来自环境
            self.assertEqual(cfg.db_path, os.path.join(tmp, "env.db"))

    def test_defaults_without_env(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.dict(os.environ, {"STOTP_DB": os.path.join(tmp, "x.db")}, clear=False):
                for key in ("STOTP_HOST", "STOTP_PORT", "STOTP_PUBLIC_URL",
                            "STOTP_REQUIRE_TLS", "STOTP_TRUST_PROXY", "STOTP_DEV_LOGIN"):
                    os.environ.pop(key, None)
                cfg = build_config(self.parse([]))
            self.assertEqual(cfg.port, 8787)
            self.assertFalse(cfg.dev_login)
            self.assertFalse(cfg.require_tls)


if __name__ == "__main__":
    unittest.main()
