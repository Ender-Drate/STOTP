import { NextRequest, NextResponse } from "next/server";
import { clientIp, errorResponse, HttpError, rateLimit } from "@/lib/http";
import {
  CAPTCHA_COOKIE, CAPTCHA_TTL, generateCaptcha, isCaptchaPurpose,
  type CaptchaLang,
} from "@/lib/captcha";
import { PUBLIC_URL } from "@/lib/config";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const ip = clientIp(req);
    if (!rateLimit(`captcha:${ip}`, 10, 60)
      || !rateLimit("captcha:global", 120, 60)) {
      throw new HttpError(429, "rate_limited", "请求过于频繁");
    }
    const purpose = req.nextUrl.searchParams.get("purpose") || "login";
    if (!isCaptchaPurpose(purpose)) {
      throw new HttpError(400, "invalid_request", "验证码用途不合法");
    }
    const lang: CaptchaLang = req.nextUrl.searchParams.get("lang") === "en" ? "en" : "zh";
    const { token, image } = await generateCaptcha(ip, purpose, lang);

    // The challenge token never reaches JavaScript: it lives in an HttpOnly
    // cookie, and the browser only receives the rendered image.
    const response = NextResponse.json(
      { image },
      { headers: { "Cache-Control": "no-store" } }
    );
    response.cookies.set(CAPTCHA_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: CAPTCHA_TTL,
      secure: PUBLIC_URL.startsWith("https://"),
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
