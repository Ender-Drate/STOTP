import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/config";
import { destroySession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) destroySession(token);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
