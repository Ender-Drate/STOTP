import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/config";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { destroySession, sessionCookieOptions } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    if (token) destroySession(token);
    const res = NextResponse.json({ ok: true });
    res.cookies.set({ ...sessionCookieOptions(0), value: "" });
    return res;
  } catch (error) {
    return errorResponse(error);
  }
}
