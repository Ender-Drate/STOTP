import { NextRequest, NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { requireUser } from "@/lib/admin";
import { assertSameOrigin, clientIp, errorResponse, HttpError, readJson } from "@/lib/http";
import { decryptPasswordField } from "@/lib/password-crypto";
import { requireCurrentPassword, requireSecondFactor } from "@/lib/reauth";
import { listPasskeys } from "@/lib/passkeys";
import {
  createWebauthnChallenge, RP_ID, RP_NAME, WEBAUTHN_COOKIE, webauthnCookieOptions,
} from "@/lib/webauthn";

export const runtime = "nodejs";

interface Body {
  code?: string;
  password?: string;
  password_enc?: string;
  password_key?: string;
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const body = await readJson<Body>(req);
    const password = decryptPasswordField(
      body.password, body.password_enc, body.password_key,
    );
    await requireCurrentPassword(user, password, "passkey_add");
    await requireSecondFactor(user, body.code || "", "passkey_add");
    const existing = listPasskeys(user.id);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userID: Buffer.from(String(user.id), "utf8"),
      userName: user.username,
      userDisplayName: user.display_name || user.username,
      attestationType: "none",
      excludeCredentials: existing.map((item) => ({
        id: item.credential_id,
        transports: item.transports ? JSON.parse(item.transports) : undefined,
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });
    const { ticket } = createWebauthnChallenge(
      options.challenge, "register", user.id, clientIp(req)
    );
    const res = NextResponse.json(options);
    res.cookies.set(WEBAUTHN_COOKIE, ticket, webauthnCookieOptions());
    return res;
  } catch (error) {
    if (error instanceof Error && error.message.includes("RP ID")) {
      return NextResponse.json({
        ok: false,
        error: { code: "webauthn_unavailable", message: "当前域名不支持 Passkey（需要 HTTPS 域名）" },
      }, { status: 400 });
    }
    return errorResponse(error);
  }
}
