"""HTTP 基础设施：请求/响应对象、路由、统一错误与安全响应头。"""

from __future__ import annotations

import json
import logging
import re
import urllib.parse
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

log = logging.getLogger("stotp.http")

MAX_BODY = 1 << 20  # 1 MiB


class HttpError(Exception):
    def __init__(self, status: int, code: str, message: str,
                 headers: dict[str, str] | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.headers = headers or {}


class OAuthFailure(Exception):
    """令牌端点使用 OAuth2 规范错误结构，绕过统一错误信封。"""

    def __init__(self, response: "Response"):
        super().__init__("oauth failure")
        self.response = response


@dataclass
class Request:
    method: str
    path: str
    query: dict[str, str]
    headers: dict[str, str]
    body: bytes
    client_ip: str

    def header(self, name: str, default: str | None = None) -> str | None:
        return self.headers.get(name.lower(), default)

    def json(self, required: bool = True) -> dict:
        if not self.body:
            if required:
                raise HttpError(400, "invalid_request", "请求体必须是 JSON")
            return {}
        try:
            value = json.loads(self.body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise HttpError(400, "invalid_request", "JSON 解析失败") from exc
        if not isinstance(value, dict):
            raise HttpError(400, "invalid_request", "JSON 顶层必须是对象")
        return value

    def form(self) -> dict[str, str]:
        try:
            text = self.body.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise HttpError(400, "invalid_request", "表单编码错误") from exc
        parsed = urllib.parse.parse_qs(text, keep_blank_values=True)
        return {k: v[0] for k, v in parsed.items()}


@dataclass
class Response:
    status: int = 200
    body: bytes = b""
    content_type: str = "application/json; charset=utf-8"
    headers: dict[str, str] = field(default_factory=dict)
    cookies: list[str] = field(default_factory=list)

    @classmethod
    def json(cls, payload: dict, status: int = 200,
             headers: dict[str, str] | None = None,
             cookies: list[str] | None = None) -> "Response":
        return cls(
            status=status,
            body=json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
            headers=headers or {},
            cookies=cookies or [],
        )

    @classmethod
    def html(cls, text: str, status: int = 200) -> "Response":
        return cls(status=status, body=text.encode("utf-8"),
                   content_type="text/html; charset=utf-8")


class Router:
    def __init__(self) -> None:
        self._routes: list[tuple[str, re.Pattern, object]] = []

    def add(self, method: str, pattern: str, handler) -> None:
        self._routes.append((method.upper(), re.compile("^" + pattern + "$"), handler))

    def match(self, method: str, path: str):
        for route_method, regex, handler in self._routes:
            if route_method != method:
                continue
            m = regex.match(path)
            if m:
                return handler, m.groupdict()
        return None, None


class StotpHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, addr, handler_cls, app, trust_proxy: bool = False):
        self.app = app
        self.trust_proxy = trust_proxy
        super().__init__(addr, handler_cls)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "STOTP/1.0"
    sys_version = ""

    # ---- 入口 ----------------------------------------------------------

    def do_GET(self):        # noqa: N802
        self._dispatch("GET")

    def do_POST(self):       # noqa: N802
        self._dispatch("POST")

    def do_DELETE(self):     # noqa: N802
        self._dispatch("DELETE")

    def do_OPTIONS(self):    # noqa: N802
        self._respond(Response(status=204))

    def do_PUT(self):        # noqa: N802
        self._dispatch("PUT")

    # ---- 分发 ----------------------------------------------------------

    def _dispatch(self, method: str) -> None:
        parsed = urllib.parse.urlsplit(self.path)
        query = {k: v[0] for k, v in urllib.parse.parse_qs(
            parsed.query, keep_blank_values=True).items()}
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            self._respond(Response.json(
                {"ok": False, "error": {"code": "payload_too_large",
                                        "message": "请求体过大"}}, 413))
            return
        body = self.rfile.read(length) if length else b""
        headers = {k.lower(): v for k, v in self.headers.items()}
        req = Request(method, parsed.path, query, headers, body, self._client_ip())

        app = self.server.app  # type: ignore[attr-defined]
        if app.cfg.require_tls and req.headers.get("x-forwarded-proto", "").lower() != "https":
            self._respond(Response.json(
                {"ok": False, "error": {"code": "tls_required",
                                        "message": "必须通过 HTTPS 访问"}}, 400))
            return
        handler, params = app.router.match(method, parsed.path)
        if handler is None:
            self._respond(Response.json(
                {"ok": False, "error": {"code": "not_found", "message": "接口不存在"}}, 404))
            return
        try:
            resp = handler(app, req, **(params or {}))
        except OAuthFailure as exc:
            resp = exc.response
        except HttpError as exc:
            payload = {"ok": False, "error": {"code": exc.code, "message": exc.message}}
            resp = Response.json(payload, exc.status, headers=exc.headers)
        except Exception:  # pragma: no cover - 防御性兜底
            log.exception("handler failed: %s %s", method, parsed.path)
            resp = Response.json(
                {"ok": False, "error": {"code": "server_error", "message": "服务端错误"}}, 500)
        self._respond(resp)

    def _client_ip(self) -> str:
        if getattr(self.server, "trust_proxy", False):
            forwarded = self.headers.get("X-Forwarded-For")
            if forwarded:
                return forwarded.split(",")[0].strip()
        return self.client_address[0]

    def _respond(self, resp: Response) -> None:
        self.send_response(resp.status)
        self.send_header("Content-Type", resp.content_type)
        self.send_header("Content-Length", str(len(resp.body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        if getattr(self.server, "app", None) and self.server.app.cfg.require_tls:
            self.send_header("Strict-Transport-Security",
                             "max-age=31536000; includeSubDomains")
        self.send_header("Cache-Control", "no-store")
        for key, value in resp.headers.items():
            self.send_header(key, value)
        for cookie in resp.cookies:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        if resp.body:
            self.wfile.write(resp.body)

    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        log.info("%s - %s", self.address_string(), fmt % args)
