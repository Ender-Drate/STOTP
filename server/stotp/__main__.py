"""STOTP 服务端入口：`python -m stotp --dev-login`。"""

from __future__ import annotations

import argparse
import logging
import sys

from .app import App
from .config import Config


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="stotp",
        description="STOTP 服务端：OAuth2 用户中心 + 增强 TOTP 验证",
    )
    parser.add_argument("--host", default=None, help="监听地址（默认 127.0.0.1）")
    parser.add_argument("--port", type=int, default=None, help="监听端口（默认 8787）")
    parser.add_argument("--db", default=None, help="SQLite 路径（默认 data/stotp.db）")
    parser.add_argument("--public-url", default=None, help="对外基础 URL（发现文档使用）")
    parser.add_argument("--dev-login", action="store_true", default=None,
                        help="启用内置联调登录页")
    parser.add_argument("--require-tls", action="store_true", default=None,
                        help="拒绝非 HTTPS 请求（反向代理后开启）")
    parser.add_argument("--trust-proxy", action="store_true", default=None,
                        help="信任 X-Forwarded-* 头")
    parser.add_argument("--epoch-seconds", type=int, default=None, help="UUID 轮换周期（默认 3600）")
    parser.add_argument("--verify-budget-ms", type=float, default=None, help="验证接口耗时预算")
    parser.add_argument("--create-account", default=None, metavar="USER:PASS",
                        help="启动时确保账户存在（仅用于联调/初始化）")
    parser.add_argument("--log-level", default=None, help="日志级别（默认 INFO）")
    return parser


def build_config(args: argparse.Namespace) -> Config:
    """仅把显式出现的 CLI 参数交给 Config.from_env，其余交给环境变量。"""
    overrides = {
        "host": args.host,
        "port": args.port,
        "db_path": args.db,
        "public_url": args.public_url,
        "dev_login": args.dev_login,
        "require_tls": args.require_tls,
        "trust_proxy": args.trust_proxy,
        "epoch_seconds": args.epoch_seconds,
        "verify_budget_ms": args.verify_budget_ms,
        "create_account": args.create_account,
        "log_level": args.log_level,
    }
    return Config.from_env(**{key: value for key, value in overrides.items()
                              if value is not None})


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    cfg = build_config(args)
    logging.basicConfig(
        level=getattr(logging, cfg.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    cfg.validate()
    app = App(cfg)
    try:
        app.serve()
    except OSError as exc:
        print(f"无法启动：{exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
