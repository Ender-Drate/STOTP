import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { requireUser } from "@/lib/admin";
import { assertSameOrigin, errorResponse, HttpError, rateLimit } from "@/lib/http";
import { generateTotpSecret, otpauthUri } from "@/lib/totp";

export const runtime = "nodejs";

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
    const secret = generateTotpSecret();
    const uri = otpauthUri(secret, user.username);
    const qr = await QRCode.toDataURL(uri, {
      width: 220, margin: 1, color: { dark: "#1d1d1f", light: "#ffffff" },
    });
    return NextResponse.json({ secret, otpauth: uri, qr });
  } catch (error) {
    return errorResponse(error);
  }
}
