import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { randomToken } from "@/lib/crypto";
import { PUBLIC_URL } from "@/lib/config";
import { clientIp, safeNextPath } from "@/lib/http";
import { isIpBlocked } from "@/lib/ip-rules";
import { consumeOAuthState, createOAuthState, getProviderByKey, OAUTH_STATE_COOKIE } from "@/lib/login-providers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (isIpBlocked(clientIp(req))) {
    return NextResponse.redirect(new URL(
      `/login?error=${encodeURIComponent("当前 IP 已被限制")}`, PUBLIC_URL
    ));
  }
  const providerKey = req.nextUrl.searchParams.get("provider") || "";
  const next = safeNextPath(req.nextUrl.searchParams.get("next"));
  const provider = getProviderByKey(providerKey);
  if (!provider || !provider.enabled) {
    return NextResponse.redirect(new URL(
      `/login?error=${encodeURIComponent("登录服务不存在或已停用")}`, PUBLIC_URL
    ));
  }
  const verifier = randomToken(32);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = createOAuthState(provider.id, verifier, next, clientIp(req));
  const url = new URL(provider.authorization_url);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", provider.client_id);
  url.searchParams.set("redirect_uri", `${PUBLIC_URL}/api/oauth/callback`);
  url.searchParams.set("scope", provider.scopes);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  const res = NextResponse.redirect(url, 302);
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: PUBLIC_URL.startsWith("https://"),
    path: "/",
    maxAge: 600,
  });
  return res;
}
