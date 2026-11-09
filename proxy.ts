import { NextRequest, NextResponse } from "next/server";
import { buildCsp, cloneDefaultCsp, readCspConfig } from "@/lib/csp";

/**
 * 每个文档请求生成 nonce；同时写入 request/response CSP。
 * Next 会从 request 的 Content-Security-Policy 提取 nonce 并注入其内联脚本。
 */
export function proxy(req: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const dev = process.env.NODE_ENV !== "production";
  let directives = cloneDefaultCsp();
  try {
    directives = readCspConfig();
  } catch {
    // DB 不可用时仍使用安全默认值
  }
  const csp = buildCsp(directives, nonce, dev);

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
