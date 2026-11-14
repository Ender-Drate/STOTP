import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getDb, nowIso } from "@/lib/db";
import {
  assertSameOrigin, clientIp, errorResponse, HttpError, rateLimit, readJsonLimited,
} from "@/lib/http";
import { evaluateSignals, readTlsFingerprint, type ClientSignals } from "@/lib/risk-signals";
import { riskLevel } from "@/lib/risk";
import { applyAutoDefense } from "@/lib/active-defense";

export const runtime = "nodejs";

interface Body {
  path?: string;
  signals?: ClientSignals;
}

const MAX_BODY = 4096;

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const ip = clientIp(req);
    const declared = Number(req.headers.get("content-length") || 0);
    if (declared > MAX_BODY) {
      throw new HttpError(413, "payload_too_large", "信号数据过大");
    }
    const user = await currentUser();
    if (!rateLimit(`risk-observe:${ip}`, user ? 20 : 5, 60)
      || !rateLimit("risk-observe:global", user ? 300 : 120, 60)) {
      throw new HttpError(429, "rate_limited", "请求过于频繁");
    }
    const body = await readJsonLimited<Body>(req, MAX_BODY);
    const signals = (body.signals && typeof body.signals === "object") ? body.signals : {};
    const serialized = JSON.stringify(signals);
    if (Buffer.byteLength(serialized, "utf8") > MAX_BODY) {
      throw new HttpError(413, "payload_too_large", "信号数据过大");
    }
    const userAgent = (req.headers.get("user-agent") || "").slice(0, 500);
    const tlsFingerprint = readTlsFingerprint(req.headers);
    const evaluation = evaluateSignals(signals, userAgent, tlsFingerprint, req.headers);
    // 未登录时客户端信号不可信，最多到 medium，不能把任意 IP 刷成 critical。
    const score = user ? evaluation.score : Math.min(evaluation.score, 55);
    const rawPath = typeof body.path === "string" ? body.path.slice(0, 200) : "";
    const path = rawPath.startsWith("/") && !rawPath.includes("\\") ? rawPath : "";
    getDb().prepare(
      `INSERT INTO risk_observations(ts, ip, user_id, path, user_agent, tls_fingerprint,
         signals, score, reasons)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(nowIso(), ip, user?.id ?? null, path, userAgent, tlsFingerprint,
      serialized, score, JSON.stringify(evaluation.reasons));

    applyAutoDefense(ip, score, evaluation.reasons);

    return NextResponse.json({
      ok: true,
      score,
      level: riskLevel(score),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
