import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { audit } from "@/lib/db";
import { assertSameOrigin, clientIp, errorResponse, HttpError, readJson } from "@/lib/http";
import { deleteIpRule, listIpRules, saveIpRule } from "@/lib/ip-rules";

export const runtime = "nodejs";

async function admin() {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "unauthorized", "请先登录");
  if (!hasPermission(user, "risk.manage")) {
    throw new HttpError(403, "forbidden", "没有 IP 规则管理权限");
  }
  return user;
}

export async function GET() {
  try {
    await admin();
    return NextResponse.json({ rules: listIpRules() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await admin();
    const body = await readJson<{
      ip?: string; action?: string; reason?: string; expiresAt?: string;
    }>(req);
    const ip = String(body.ip || "").trim();
    const action = body.action === "block" ? "block" : "watch";
    if (!ip) throw new HttpError(400, "invalid_request", "请输入 IP");
    let rule;
    try {
      rule = saveIpRule({
        ip, action, reason: body.reason, createdBy: user.id,
        expiresAt: body.expiresAt || null,
      });
    } catch {
      throw new HttpError(400, "invalid_ip", "IP 格式不合法");
    }
    audit("ip_rule_update", {
      userId: user.id, ip: clientIp(req), detail: `${action}:${rule.ip}`,
    });
    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await admin();
    const id = Number(new URL(req.url).searchParams.get("id") || 0);
    if (!id) throw new HttpError(400, "invalid_request", "缺少规则 ID");
    if (!deleteIpRule(id)) throw new HttpError(404, "not_found", "规则不存在");
    audit("ip_rule_delete", {
      userId: user.id, ip: clientIp(req), detail: `rule=${id}`,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
