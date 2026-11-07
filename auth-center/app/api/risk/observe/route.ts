import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getDb, nowIso } from "@/lib/db";
import { clientIp, errorResponse, HttpError, rateLimit, readJson } from "@/lib/http";
import { evaluateSignals, readTlsFingerprint, type ClientSignals } from "@/lib/risk-signals";
import { getRiskSettings, riskLevel } from "@/lib/risk";

export const runtime = "nodejs";

interface Body {
  path?: string;
  signals?: ClientSignals;
}

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    if (!rateLimit(`risk-observe:${ip}`, 120, 60)) {
      throw new HttpError(429, "rate_limited", "请求过于频繁");
    }
    const body = await readJson<Body>(req);
    const signals = (body.signals && typeof body.signals === "object") ? body.signals : {};
    const serialized = JSON.stringify(signals);
    if (serialized.length > 8000) throw new HttpError(400, "invalid_request", "信号过大");
    const userAgent = (req.headers.get("user-agent") || "").slice(0, 500);
    const tlsFingerprint = readTlsFingerprint(req.headers);
    const evaluation = evaluateSignals(signals, userAgent, tlsFingerprint);
    const user = await currentUser();
    const path = typeof body.path === "string" ? body.path.slice(0, 200) : "";
    const db = getDb();
    db.prepare(
      `INSERT INTO risk_observations(ts, ip, user_id, path, user_agent, tls_fingerprint,
         signals, score, reasons)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(nowIso(), ip, user?.id ?? null, path, userAgent, tlsFingerprint,
      serialized, evaluation.score, JSON.stringify(evaluation.reasons));

    // 避免观测表无限增长
    const cutoff = new Date(Date.now() - getRiskSettings().auditRetentionDays * 86400_000).toISOString();
    db.prepare("DELETE FROM risk_observations WHERE ts < ?").run(cutoff);

    return NextResponse.json({
      ok: true,
      score: evaluation.score,
      level: riskLevel(evaluation.score),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
