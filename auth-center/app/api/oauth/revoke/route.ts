import { NextRequest, NextResponse } from "next/server";
import { sha256 } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { authenticateClient } from "@/lib/oidc";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const form = new URLSearchParams(await req.text());
    const client = authenticateClient(req, form);
    const token = form.get("token") || "";
    if (token) {
      const hash = sha256(token);
      getDb().prepare(
        "UPDATE tokens SET revoked = 1 WHERE token_hash = ? AND client_id = ?"
      ).run(hash, client.client_id);
    }
    return NextResponse.json({}, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // RFC 7009：无效 token 也返回 200，避免探测
    return NextResponse.json({}, { headers: { "Cache-Control": "no-store" } });
  }
}
