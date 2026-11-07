import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin";
import { audit } from "@/lib/db";
import { assertSameOrigin, clientIp, errorResponse, HttpError, readJson } from "@/lib/http";
import { getDb } from "@/lib/db";
import { decryptPasswordField } from "@/lib/password-crypto";
import { requireCurrentPassword } from "@/lib/reauth";
import { verifyTotp } from "@/lib/totp";
import { clearPendingTotp, getPendingTotp } from "@/lib/totp-pending";

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
    if (user.totp_secret) {
      throw new HttpError(400, "already_enabled", "TOTP 已启用");
    }
    const body = await readJson<Body>(req);
    const password = decryptPasswordField(
      body.password, body.password_enc, body.password_key,
    );
    requireCurrentPassword(user, password, "totp_enable");
    const secret = getPendingTotp(user.id);
    if (!secret) {
      throw new HttpError(400, "totp_setup_expired", "TOTP 初始化已过期，请重新生成二维码");
    }
    const code = (body.code || "").trim();
    if (!verifyTotp(secret, code)) {
      throw new HttpError(400, "otp_invalid", "验证码不正确，请确认手机时间");
    }
    getDb().prepare("UPDATE users SET totp_secret = ? WHERE id = ?").run(secret, user.id);
    clearPendingTotp(user.id);
    audit("totp_enable", { userId: user.id, ip: clientIp(req) });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
