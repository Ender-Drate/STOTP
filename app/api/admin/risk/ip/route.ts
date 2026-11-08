import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { clientIp, errorResponse, HttpError, rateLimit } from "@/lib/http";
import { normalizeIp } from "@/lib/ip";
import { lookupIpLocation } from "@/lib/geolocation";
import { getRiskSettings, riskLevel } from "@/lib/risk";
import { ipRiskClears } from "@/lib/ip-risk-clear";

export const runtime = "nodejs";

function reasons(value: string | null): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string").slice(0, 20) : [];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, "unauthorized", "请先登录");
    if (!hasPermission(user, "audit.view")) {
      throw new HttpError(403, "forbidden", "没有查看风险详情的权限");
    }
    if (!rateLimit(`risk-ip-detail:${clientIp(req)}`, 120, 60)) {
      throw new HttpError(429, "rate_limited", "请求过于频繁");
    }
    const ip = normalizeIp(req.nextUrl.searchParams.get("ip"));
    if (!ip) throw new HttpError(400, "invalid_request", "IP 不合法");
    const settings = getRiskSettings();
    const since = new Date(Date.now() - settings.visitWindowHours * 3600 * 1000).toISOString();
    const rows = getDb().prepare(
      `SELECT id, ts, path, user_agent, tls_fingerprint, signals, score, reasons
       FROM risk_observations WHERE ip = ? AND ts >= ? ORDER BY id DESC LIMIT 100`
    ).all(ip, since) as unknown as Array<{
      id: number; ts: string; path: string | null; user_agent: string | null;
      tls_fingerprint: string | null; signals: string; score: number; reasons: string | null;
    }>;
    const clearedAt = ipRiskClears().get(ip) || null;
    const observations = rows.map((row) => {
      let signals: Record<string, unknown> = {};
      try { signals = JSON.parse(row.signals); } catch { /* ignore */ }
      const cleared = Boolean(clearedAt && row.ts <= clearedAt);
      const score = cleared ? 0 : Number(row.score) || 0;
      return {
        id: row.id,
        ts: row.ts,
        path: row.path,
        userAgent: row.user_agent,
        tlsFingerprint: row.tls_fingerprint,
        score,
        level: riskLevel(score, settings),
        reasons: cleared ? [] : reasons(row.reasons),
        signals,
      };
    });
    return NextResponse.json({
      ip,
      location: lookupIpLocation(ip),
      windowHours: settings.visitWindowHours,
      count: observations.length,
      clearedAt,
      observations,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
