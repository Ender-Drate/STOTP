import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { clientIp, errorResponse, HttpError, rateLimit } from "@/lib/http";
import {
  createWebauthnChallenge, RP_ID, WEBAUTHN_COOKIE, webauthnCookieOptions,
} from "@/lib/webauthn";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
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
