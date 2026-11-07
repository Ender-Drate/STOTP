import { NextRequest, NextResponse } from "next/server";
import { audit, findUserById, getDb } from "@/lib/db";
import { requireUser } from "@/lib/admin";
import { hashPassword } from "@/lib/crypto";
import { assertSameOrigin, clientIp, errorResponse, HttpError, readJson } from "@/lib/http";
import { decryptPasswordField } from "@/lib/password-crypto";
import { requireCurrentPassword, requireSecondFactor } from "@/lib/reauth";
import { sessionCookieOptions } from "@/lib/session";

export const runtime = "nodejs";

interface Body {
  currentPassword?: string;
  newPassword?: string;
  currentPassword_enc?: string;
  newPassword_enc?: string;
  password_key?: string;
  code?: string;
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const body = await readJson<Body>(req);
    const current = decryptPasswordField(
      body.currentPassword, body.currentPassword_enc, body.password_key, "当前密码",
    );
    const next = decryptPasswordField(
      body.newPassword, body.newPassword_enc, body.password_key, "新密码",
    );
    requireCurrentPassword(user, current, "password_change");
    requireSecondFactor(user, body.code || "", "password_change");
    if (next.length < 10) {
      throw new HttpError(400, "invalid_request", "新密码至少 10 位");
    }

    const db = getDb();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
        .run(hashPassword(next), user.id);
      // 密码轮换后，所有旧凭据都必须失效，不能只删 session。
      db.prepare("UPDATE tokens SET revoked = 1 WHERE user_id = ?").run(user.id);
      db.prepare("DELETE FROM passkeys WHERE user_id = ?").run(user.id);
      db.prepare("DELETE FROM provider_links WHERE user_id = ?").run(user.id);
      db.prepare("DELETE FROM login_challenges WHERE user_id = ?").run(user.id);
      db.prepare("DELETE FROM webauthn_challenges WHERE user_id = ?").run(user.id);
      db.prepare("DELETE FROM totp_pending WHERE user_id = ?").run(user.id);
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    audit("password_change", { userId: user.id, ip: clientIp(req) });
    const updated = findUserById(user.id)!;
    const res = NextResponse.json({ ok: true, logout: true, user: updated.id });
    res.cookies.set({ ...sessionCookieOptions(0), value: "" });
    return res;
  } catch (error) {
    return errorResponse(error);
  }
}
