import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_URL } from "@/lib/config";
import { sha256 } from "@/lib/crypto";
import { findUserById, getDb } from "@/lib/db";
import { verifyJwt } from "@/lib/jwt";

export const runtime = "nodejs";

function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: "invalid_token", error_description: "Access Token 无效或已过期" },
    {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer", "Cache-Control": "no-store" },
    }
  );
}

export async function GET(req: NextRequest) {
  const header = req.headers.get("authorization") || "";
  if (!header.toLowerCase().startsWith("bearer ")) return unauthorized();
  const token = header.slice(7).trim();
  let claims: Record<string, unknown>;
  try {
    claims = verifyJwt(token);
  } catch {
    return unauthorized();
  }
  if (claims.typ !== "access") return unauthorized();
  const row = getDb().prepare(
    "SELECT revoked FROM tokens WHERE token_hash = ?"
  ).get(sha256(token)) as { revoked: number } | undefined;
  if (!row || row.revoked) return unauthorized();
  const user = findUserById(Number(claims.sub));
  if (!user || user.status !== "active") return unauthorized();

  const scope = typeof claims.scope === "string" ? claims.scope.split(/\s+/) : [];
  const permissions = (() => {
    try {
      return JSON.parse(user.permissions) as string[];
    } catch {
      return [];
    }
  })();
  const data: Record<string, unknown> = {
    sub: String(user.id),
    id: user.id,
  };
  if (scope.includes("profile")) {
    data.username = user.username;
    data.preferred_username = user.username;
    data.display_name = user.display_name || user.username;
    data.name = user.display_name || user.username;
  }
  if (scope.includes("email")) {
    data.email = user.email;
    data.email_verified = true;
  }
  if (scope.includes("head")) {
    data.picture = user.avatar_url || `${PUBLIC_URL}/api/oauth/head?uid=${user.id}`;
    data.avatar_url = data.picture;
  }
  if (scope.includes("permission")) {
    data.permissions = permissions;
  }
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}
