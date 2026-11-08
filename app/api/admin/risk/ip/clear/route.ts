import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { audit } from "@/lib/db";
import { assertSameOrigin, clientIp, errorResponse, HttpError, rateLimit, readJson } from "@/lib/http";
import { normalizeIp } from "@/lib/ip";
import { clearIpRisk } from "@/lib/ip-risk-clear";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await currentUser();
    if (!user) throw new HttpError(401, "unauthorized", "请先登录");
    if (!hasPermission(user, "risk.manage")) {
      throw new HttpError(403, "forbidden", "没有清除 IP 风险的权限");
    }
    if (!rateLimit(`ip-risk-clear:${user.id}`, 30, 300)) {
      throw new HttpError(429, "rate_limited", "操作过于频繁，请稍后再试");
    }
    const body = await readJson<{ ip?: string }>(req);
    const ip = normalizeIp(body.ip);
    if (!ip) throw new HttpError(400, "invalid_request", "IP 不合法");
    clearIpRisk(ip, user.id);
    audit("ip_risk_clear", { userId: user.id, ip: clientIp(req), detail: ip });
    return NextResponse.json({ ok: true, ip });
  } catch (error) {
    return errorResponse(error);
  }
}
