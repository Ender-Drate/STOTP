import { NextRequest, NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { requireUser } from "@/lib/admin";
import { audit } from "@/lib/db";
import { assertSameOrigin, clientIp, errorResponse, HttpError, readJson } from "@/lib/http";
import { createPasskey, listPasskeys } from "@/lib/passkeys";
import {
  consumeWebauthnChallenge, RP_ID, RP_ORIGIN, WEBAUTHN_COOKIE, webauthnCookieOptions,
} from "@/lib/webauthn";

export const runtime = "nodejs";

interface Body {
  response?: unknown;
  name?: string;
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const body = await readJson<Body>(req);
    const ticket = req.cookies.get(WEBAUTHN_COOKIE)?.value || "";
    const challenge = consumeWebauthnChallenge(ticket, "register", clientIp(req));
    if (!challenge || challenge.user_id !== user.id) {
      throw new HttpError(400, "challenge_expired", "Passkey 注册会话已过期，请重试");
    }
    const verification = await verifyRegistrationResponse({
      response: body.response as never,
      expectedChallenge: challenge.challenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) {
      throw new HttpError(400, "passkey_invalid", "Passkey 验证失败");
    }
    const credential = verification.registrationInfo.credential;
    if (listPasskeys(user.id).some((item) => item.credential_id === credential.id)) {
      throw new HttpError(409, "already_exists", "该 Passkey 已绑定");
    }
    createPasskey({
      userId: user.id,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: credential.transports || [],
      name: (body.name || "").trim().slice(0, 40) || "Passkey",
    });
    audit("passkey_register", { userId: user.id, ip: clientIp(req) });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(WEBAUTHN_COOKIE, "", webauthnCookieOptions(0));
    return res;
  } catch (error) {
    return errorResponse(error);
  }
}
