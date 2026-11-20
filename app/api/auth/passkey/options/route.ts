import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { findUserByUsername } from "@/lib/db";
import { assertSameOrigin, clientIp, errorResponse, HttpError, rateLimit, readJson } from "@/lib/http";
import { isIpBlocked } from "@/lib/ip-rules";
import { listPasskeys } from "@/lib/passkeys";
import {
  createWebauthnChallenge, RP_ID, WEBAUTHN_COOKIE, webauthnCookieOptions,
} from "@/lib/webauthn";

export const runtime = "nodejs";

interface Body {
  username?: string;
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const ip = clientIp(req);
    if (isIpBlocked(ip)) throw new HttpError(403, "ip_blocked", "当前 IP 已被限制");
    if (!rateLimit(`passkey-options:${ip}`, 30, 60)) {
      throw new HttpError(429, "rate_limited", "尝试过于频繁，请稍后再试");
    }
    const body = await readJson<Body>(req).catch(() => ({} as Body));
    const identifier = typeof body.username === "string" ? body.username.trim() : "";
    const user = identifier ? findUserByUsername(identifier) : undefined;
    const allowCredentials = user
      ? listPasskeys(user.id).map((item) => ({
        id: item.credential_id,
        transports: item.transports ? JSON.parse(item.transports) : undefined,
      }))
      : [];
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials,
      userVerification: "preferred",
    });
    const { ticket } = createWebauthnChallenge(
      options.challenge, "authenticate", user?.id ?? null, ip
    );
    const res = NextResponse.json(options);
    res.cookies.set(WEBAUTHN_COOKIE, ticket, webauthnCookieOptions());
    return res;
  } catch (error) {
    return errorResponse(error);
  }
}
