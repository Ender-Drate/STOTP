import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_URL, TRUST_PROXY } from "./config";
import { getDb, nowSec } from "./db";
import { firstValidIp } from "./ip";

export class HttpError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof HttpError) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: error.code, message: error.message },
        ...(error.details || {}),
      },
      { status: error.status, headers: { "Cache-Control": "no-store" } }
    );
  }
  console.error("[auth-center]", error);
  return NextResponse.json(
    { ok: false, error: { code: "server_error", message: "服务端错误" } },
    { status: 500, headers: { "Cache-Control": "no-store" } }
  );
}

export async function readJson<T>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "invalid_request", "请求体必须是 JSON");
  }
}

export function isFormRequest(req: NextRequest): boolean {
  return (req.headers.get("content-type") || "")
    .toLowerCase()
    .includes("application/x-www-form-urlencoded");
}

export async function readForm(req: NextRequest): Promise<Record<string, string>> {
  try {
    const data = await req.formData();
    const result: Record<string, string> = {};
    data.forEach((value, key) => {
      result[key] = typeof value === "string" ? value : "";
    });
    return result;
  } catch {
    throw new HttpError(400, "invalid_request", "表单数据无法解析");
  }
}

/** 仅允许站内绝对路径，防止 open redirect。 */
export function safeNextPath(value: unknown, fallback = "/dashboard"): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (
    typeof raw !== "string" ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(raw)
  ) {
    return fallback;
  }
  try {
    const base = new URL(PUBLIC_URL);
    const target = new URL(raw, base);
    if (target.origin !== base.origin) return fallback;
    // 只对 pathname 做编码解码检查；query 中的 %2F（例如 OAuth redirect_uri）必须保留。
    let pathname: string;
    try {
      pathname = decodeURIComponent(target.pathname);
    } catch {
      return fallback;
    }
    if (!pathname.startsWith("/") || pathname.startsWith("//") || pathname.includes("\\")) {
      return fallback;
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}

/**
 * 只信任反向代理自己覆盖的 X-Real-IP。
 *
 * 绝不读取 CF-Connecting-IP / Forwarded / X-Forwarded-For：
 * 这些头客户端可以直接伪造，会绕过 IP 限速、验证码和 IP 封禁。
 */
export function clientIp(req: NextRequest): string {
  if (!TRUST_PROXY) return "127.0.0.1";
  // 只解析 nginx 覆盖后的 X-Real-IP；兼容多层代理重复追加的逗号列表。
  return firstValidIp([req.headers.get("x-real-ip")]) || "127.0.0.1";
}

export function rateLimit(key: string, max: number, windowSeconds: number): boolean {
  if (process.env.AUTH_E2E === "1") return true;
  const db = getDb();
  const now = nowSec();
  const resetAt = now + windowSeconds;
  db.prepare(
    `INSERT INTO rate_limits(key, count, reset_at) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.count + 1 END,
       reset_at = CASE WHEN rate_limits.reset_at <= ? THEN excluded.reset_at ELSE rate_limits.reset_at END`
  ).run(key, resetAt, now, now);
  const row = db.prepare("SELECT count FROM rate_limits WHERE key = ?")
    .get(key) as { count: number } | undefined;
  if (Math.random() < 0.02) {
    db.prepare("DELETE FROM rate_limits WHERE reset_at < ?").run(now - 3600);
  }
  return (row?.count ?? 1) <= max;
}

/** 浏览器同源校验，防止跨站表单提交；无 Origin 的服务器调用放行。 */
export function assertSameOrigin(req: NextRequest) {
  const method = req.method.toUpperCase();
  const unsafe = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  const origin = req.headers.get("origin");
  if (!origin) {
    // 浏览器写请求必须带 Origin；同源 fetch 可用 Sec-Fetch-Site 兜底。
    const sameSite = req.headers.get("sec-fetch-site") === "same-origin";
    if (unsafe && !sameSite
      && process.env.AUTH_E2E !== "1"
      && process.env.AUTH_ALLOW_NO_ORIGIN !== "1") {
      throw new HttpError(403, "bad_origin", "缺少 Origin，跨站请求被拒绝");
    }
    return;
  }
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "bad_origin", "Origin 不合法");
  }
  const allowed = new Set<string>();
  const host = req.headers.get("host");
  if (host) allowed.add(host);
  // 不信任客户端可伪造的 X-Forwarded-Host；nginx 已把 Host 设为对外域名。
  try {
    allowed.add(new URL(PUBLIC_URL).host);
  } catch {
    // AUTH_PUBLIC_URL 非法时交给启动/请求逻辑暴露，不在这里放大
  }
  if (!allowed.has(originHost)) {
    throw new HttpError(403, "bad_origin", "跨站请求被拒绝");
  }
}

export function redirectTo(url: string): NextResponse {
  return NextResponse.redirect(url, 303);
}

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
