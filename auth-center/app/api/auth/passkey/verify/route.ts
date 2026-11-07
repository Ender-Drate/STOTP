import { NextRequest, NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { SESSION_TTL_SECONDS } from "@/lib/config";
import { audit, findUserById, getDb, nowIso } from "@/lib/db";
import {
  assertSameOrigin, clientIp, errorResponse, HttpError, readJson, safeNextPath,
} from "@/lib/http";
import { findPasskeyByCredential, touchPasskey } from "@/lib/passkeys";
import { createSession, sessionCookieOptions } from "@/lib/session";
import {
  consumeWebauthnChallenge, RP_ID, RP_ORIGIN, WEBAUTHN_COOKIE, webauthnCookieOptions,
} from "@/lib/webauthn";
import { publicUser } from "@/lib/users";

export const runtime = "nodejs";

interface Body {
  response?: { id?: string } & Record<string, unknown>;
  next?: string;
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const body = await readJson<Body>(req);
    const next = safeNextPath(body.next);
    const ticket = req.cookies.get(WEBAUTHN_COOKIE)?.value || "";
    const challenge = consumeWebauthnChallenge(ticket, "authenticate", clientIp(req));
    if (!challenge) throw new HttpError(401, "challenge_expired", "Passkey 登录会话已过期，请重试");

    const credentialId = String(body.response?.id || "");
    const passkey = findPasskeyByCredential(credentialId);
    if (!passkey) throw new HttpError(401, "passkey_invalid", "Passkey 未注册");
    const user = findUserById(passkey.user_id);
    if (!user || user.status !== "active") {
      throw new HttpError(401, "invalid_credentials", "账号不可用");
    }

    const verification = await verifyAuthenticationResponse({
      response: body.response as never,
      expectedChallenge: challenge.challenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: passkey.credential_id,
        publicKey: Buffer.from(passkey.public_key, "base64url"),
        counter: passkey.counter,
        transports: passkey.transports ? JSON.parse(passkey.transports) : undefined,
      },
      requireUserVerification: true,
    });
    if (!verification.verified) {
      throw new HttpError(401, "passkey_invalid", "Passkey 验证失败");
    }
    touchPasskey(passkey.credential_id, verification.authenticationInfo.newCounter);
    getDb().prepare("UPDATE users SET last_login_at = ? WHERE id = ?")
      .run(nowIso(), user.id);
    audit("passkey_login", { userId: user.id, ip: clientIp(req) });
    const token = createSession(user.id, SESSION_TTL_SECONDS);
    const options = sessionCookieOptions(SESSION_TTL_SECONDS);
    const res = NextResponse.json({ ok: true, user: publicUser(user), next });
    res.cookies.set(options.name, token, options);
    res.cookies.set(WEBAUTHN_COOKIE, "", webauthnCookieOptions(0));
    return res;
  } catch (error) {
    return errorResponse(error);
  }
}
