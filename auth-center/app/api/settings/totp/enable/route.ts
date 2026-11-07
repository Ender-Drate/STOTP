import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin";
import { audit } from "@/lib/db";
import { assertSameOrigin, clientIp, errorResponse, HttpError, readJson } from "@/lib/http";
import { getDb } from "@/lib/db";
import { verifyTotp } from "@/lib/totp";

export const runtime = "nodejs";

interface Body {
  secret?: string;
  code?: string;
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    if (user.totp_secret) {
      throw new HttpError(400, "already_enabled", "TOTP 已启用");
    }
    const body = await readJson<Body>(req);
    const secret = (body.secret || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
    const code = (body.code || "").trim();
    if (secret.length < 16 || secret.length > 64) {
      throw new HttpError(400, "invalid_request", "TOTP secret 不合法");
    }
    if (!verifyTotp(secret, code)) {
      throw new HttpError(400, "otp_invalid", "验证码不正确，请确认手机时间");
    }
    getDb().prepare("UPDATE users SET totp_secret = ? WHERE id = ?").run(secret, user.id);
    audit("totp_enable", { userId: user.id, ip: clientIp(req) });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
