import { NextRequest, NextResponse } from "next/server";
import { clientIp, errorResponse, HttpError, rateLimit } from "@/lib/http";
import { generateCaptcha } from "@/lib/captcha";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const ip = clientIp(req);
    if (!rateLimit(`captcha:${ip}`, 30, 60)) {
      throw new HttpError(429, "rate_limited", "请求过于频繁");
    }
    const { ticket, image, testCode } = await generateCaptcha(ip);
    return NextResponse.json(
      { ticket, image, ...(testCode ? { testCode } : {}) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
