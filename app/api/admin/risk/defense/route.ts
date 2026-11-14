import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin";
import { audit } from "@/lib/db";
import { assertSameOrigin, clientIp, errorResponse, HttpError, readJson } from "@/lib/http";
import {
  activeDefenseEnabled, clearDefense, defenseRemaining, listDefenses,
  setActiveDefenseEnabled, type IpDefense,
} from "@/lib/active-defense";

export const runtime = "nodejs";

function view(defense: IpDefense) {
  return {
    ip: defense.ip,
    action: defense.action,
    reason: defense.reason,
    level: defense.level,
    score: defense.score,
    until: defense.until,
    remaining: defenseRemaining(defense),
    created_at: defense.created_at,
    source: defense.source,
  };
}

export async function GET() {
  try {
    await requirePermission("risk.manage");
    return NextResponse.json({
      enabled: activeDefenseEnabled(),
      defenses: listDefenses().map(view),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requirePermission("risk.manage");
    const body = await readJson<{ enabled?: unknown }>(req);
    if (typeof body.enabled !== "boolean") {
      throw new HttpError(400, "invalid_request", "主动防护开关参数不合法");
    }
    setActiveDefenseEnabled(body.enabled);
    audit("active_defense_update", {
      userId: user.id,
      ip: clientIp(req),
      detail: body.enabled ? "enabled" : "disabled",
    });
    return NextResponse.json({
      ok: true,
      enabled: activeDefenseEnabled(),
      defenses: listDefenses().map(view),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requirePermission("risk.manage");
    const ip = req.nextUrl.searchParams.get("ip") || "";
    if (!ip) throw new HttpError(400, "invalid_request", "缺少 IP");
    const cleared = clearDefense(ip);
    audit("ip_defense_clear", {
      userId: user.id,
      ip: clientIp(req),
      detail: `${ip}:${cleared ? "cleared" : "missing"}`,
    });
    return NextResponse.json({ ok: true, cleared });
  } catch (error) {
    return errorResponse(error);
  }
}
