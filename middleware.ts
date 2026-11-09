import { NextRequest, NextResponse } from "next/server";

/**
 * 每个文档请求生成 nonce；同时写入 request/response CSP。
 * Next 会从 request 的 Content-Security-Policy 提取 nonce 并注入其内联脚本。
 */
export function middleware(req: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const dev = process.env.NODE_ENV !== "production";
  const connect = dev ? "'self' ws: wss:" : "'self'";
  const script = dev ? `'self' 'nonce-${nonce}' 'unsafe-eval'` : `'self' 'nonce-${nonce}'`;
  const csp = [
    "default-src 'self'",
    `script-src ${script}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://auth.builddreams.cn https:",
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self' https:",
    "frame-ancestors 'none'",
  ].join("; ");

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png).*)"],
};
