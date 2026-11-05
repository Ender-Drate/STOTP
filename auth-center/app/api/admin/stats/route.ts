import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdmin();
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    const one = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
    return NextResponse.json({
      users: one("SELECT COUNT(*) AS c FROM users"),
      activeUsers: one("SELECT COUNT(*) AS c FROM users WHERE status = 'active'"),
      clients: one("SELECT COUNT(*) AS c FROM oauth_clients WHERE status = 'active'"),
      consents: one("SELECT COUNT(*) AS c FROM consents"),
      todayLogins: one(`SELECT COUNT(*) AS c FROM audit WHERE event = 'login' AND ts LIKE '${today}%'`),
      activeTokens: one("SELECT COUNT(*) AS c FROM tokens WHERE kind = 'access' AND revoked = 0"),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
