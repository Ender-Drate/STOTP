import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { requireUser } from "@/lib/admin";
import { assertSameOrigin, errorResponse, HttpError, rateLimit } from "@/lib/http";
import { decryptPasswordField } from "@/lib/password-crypto";
import { requireCurrentPassword } from "@/lib/reauth";
import { generateTotpSecret, otpauthUri } from "@/lib/totp";
import { savePendingTotp } from "@/lib/totp-pending";

export const runtime = "nodejs";

interface Body {
  password?: string;
  password_enc?: string;
  password_key?: string;
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    if (user.totp_secret) {
      throw new HttpError(400, "already_enabled", "TOTP 已启用，请先关闭");
    }
    if (!rateLimit(`totp-setup:${user.id}`, 5, 300)) {
      throw new HttpError(429, "rate_limited", "操作过于频繁，请稍后再试");
    }
    const body = await req.json().catch(() => ({})) as Body;
    const password = decryptPasswordField(
      body.password, body.password_enc, body.password_key,
    );
    await requireCurrentPassword(user, password, "totp_setup");
    const secret = generateTotpSecret();
    savePendingTotp(user.id, secret);
    const uri = otpauthUri(secret, user.username);
    const qr = await QRCode.toDataURL(uri, {
      width: 220, margin: 1, color: { dark: "#1d1d1f", light: "#ffffff" },
    });
    return NextResponse.json({ secret, otpauth: uri, qr });
  } catch (error) {
    return errorResponse(error);
  }
}
