import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_URL } from "@/lib/config";
import { audit, getDb } from "@/lib/db";
import { consumeEmailVerification } from "@/lib/email-verification";

export const runtime = "nodejs";

function redirect(path: string, error?: string): NextResponse {
  const url = new URL(path, PUBLIC_URL);
  if (error) url.searchParams.set("error", error);
  return NextResponse.redirect(url, 303);
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") || "";
  const userId = consumeEmailVerification(token);
  if (!userId) {
    return redirect("/login", "验证链接无效或已过期，请重新发送验证邮件");
  }
  const result = getDb().prepare(
    `UPDATE users SET status = 'active', email_verified = 1
     WHERE id = ? AND status = 'pending'`
  ).run(userId);
  if (Number(result.changes) === 0) {
    return redirect("/login", "账号状态异常，请联系管理员");
  }
  audit("email_verified", { userId });
  return redirect("/login?verified=1");
}
