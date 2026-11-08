import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { clientIp, assertSameOrigin, errorResponse, HttpError, rateLimit } from "@/lib/http";
import { isIpBlocked } from "@/lib/ip-rules";
import {
  createWebauthnChallenge, RP_ID, WEBAUTHN_COOKIE, webauthnCookieOptions,
} from "@/lib/webauthn";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const ip = clientIp(req);
    if (isIpBlocked(ip)) throw new HttpError(403, "ip_blocked", "当前 IP 已被限制");
    if (!rateLimit(`passkey-options:${clientIp(req)}`, 30, 60)) {
      throw new HttpError(429, "rate_limited", "尝试过于频繁，请稍后再试");
    }
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials: [],
      userVerification: "preferred",
    });
    const { ticket } = createWebauthnChallenge(
      options.challenge, "authenticate", null, clientIp(req)
    );
    const res = NextResponse.json(options);
    res.cookies.set(WEBAUTHN_COOKIE, ticket, webauthnCookieOptions());
    return res;
  } catch (error) {
    return errorResponse(error);
  }
}
