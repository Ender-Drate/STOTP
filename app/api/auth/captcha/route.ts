import { NextRequest, NextResponse } from "next/server";
import { clientIp, errorResponse, HttpError, rateLimit } from "@/lib/http";
import { generateCaptcha, isCaptchaPurpose } from "@/lib/captcha";

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
    const { ticket, image, prompt, testAnswer } = await generateCaptcha(ip, purpose);
    return NextResponse.json(
      {
        ticket, image, prompt,
        ...(testAnswer ? { testAnswer } : {}),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
