import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin";
import { audit, getDb } from "@/lib/db";
import { assertSameOrigin, clientIp, errorResponse, HttpError, readJson } from "@/lib/http";
import { decryptPasswordField } from "@/lib/password-crypto";
import { requireCurrentPassword, requireSecondFactor } from "@/lib/reauth";
import { clearPendingTotp } from "@/lib/totp-pending";

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
    if (!user.totp_secret) {
      throw new HttpError(400, "not_enabled", "TOTP 未启用");
    }
    const body = await readJson<Body>(req);
    const password = decryptPasswordField(
      body.password, body.password_enc, body.password_key,
    );
    requireCurrentPassword(user, password, "totp_disable");
    requireSecondFactor(user, body.code || "", "totp_disable");
    getDb().prepare("UPDATE users SET totp_secret = NULL WHERE id = ?").run(user.id);
    clearPendingTotp(user.id);
    audit("totp_disable", { userId: user.id, ip: clientIp(req) });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
