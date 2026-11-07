import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_URL, TRUST_PROXY } from "./config";
import { firstPublicIp } from "./ip";

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
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) {
    return fallback;
  }
  return raw;
}

export function clientIp(req: NextRequest): string {
  if (!TRUST_PROXY) return "127.0.0.1";
  const forwarded = req.headers.get("x-forwarded-for");
  const forwardedEntries = forwarded ? forwarded.split(",") : [];
  const forwardedHeader = req.headers.get("forwarded") || "";
  const forwardedFor = Array.from(forwardedHeader.matchAll(/for=([^;]+)/gi))
    .map((match) => match[1]);
  return firstPublicIp([
    req.headers.get("cf-connecting-ip"),
    req.headers.get("x-real-ip"),
    ...forwardedEntries,
    ...forwardedFor,
  ]);
}

const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, max: number, windowSeconds: number): boolean {
  if (process.env.AUTH_E2E === "1") return true;
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return true;
  }
  if (bucket.count >= max) return false;
  bucket.count += 1;
  return true;
}

/** 浏览器同源校验，防止跨站表单提交；无 Origin 的服务器调用放行。 */
export function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "bad_origin", "Origin 不合法");
  }
  const allowed = new Set<string>();
  const host = req.headers.get("host");
  if (host) allowed.add(host);
  // nginx 可能没把 Host 改成对外域名；X-Forwarded-Host 和 AUTH_PUBLIC_URL 都可作为可信来源
  const forwardedHost = req.headers.get("x-forwarded-host");
  if (forwardedHost) allowed.add(forwardedHost.split(",")[0].trim());
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
