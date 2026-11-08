import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin";
import { hasPermission } from "@/lib/permissions";
import { audit, findUserById } from "@/lib/db";
import { assertSameOrigin, clientIp, errorResponse, HttpError, rateLimit } from "@/lib/http";
import { clearAccountRisk } from "@/lib/account-risk";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(req);
    const actor = await requireUser();
    if (!hasPermission(actor, "risk.manage")) {
      throw new HttpError(403, "forbidden", "没有清除账号风险的权限");
    }
    if (!rateLimit(`clear-risk:${actor.id}`, 20, 300)) {
      throw new HttpError(429, "rate_limited", "操作过于频繁，请稍后再试");
    }
    const { id } = await context.params;
    const target = findUserById(Number(id));
    if (!target) throw new HttpError(404, "not_found", "用户不存在");
    clearAccountRisk(target.id);
    audit("account_risk_clear", {
      userId: actor.id,
      ip: clientIp(req),
      detail: `target=${target.id} username=${target.username}`,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
