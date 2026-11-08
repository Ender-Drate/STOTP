import { NextRequest, NextResponse } from "next/server";
import { sha256 } from "@/lib/crypto";
import { audit, findUserById, getDb, nowSec } from "@/lib/db";
import { HttpError, clientIp, rateLimit } from "@/lib/http";
import {
  authenticateClient,
  issueTokens,
  parseScopes,
  verifyPkce,
} from "@/lib/oidc";

export const runtime = "nodejs";

function oauthError(status: number, error: string, description: string): NextResponse {
  return NextResponse.json(
    { error, error_description: description },
    { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } }
  );
}

function revokeTokenFamily(userId: number, clientId: string, detail: string): void {
  getDb().prepare("UPDATE tokens SET revoked = 1 WHERE user_id = ? AND client_id = ?")
    .run(userId, clientId);
  audit("refresh_reuse", { userId, clientId, detail });
}

export async function POST(req: NextRequest) {
  try {
    if (!rateLimit(`oauth-token:${clientIp(req)}`, 120, 60)) {
      return oauthError(429, "rate_limited", "请求过于频繁");
    }
    const form = new URLSearchParams(await req.text());
    const client = authenticateClient(req, form);
    const grantType = form.get("grant_type");

    if (grantType === "authorization_code") {
      const code = form.get("code") || "";
      const redirectUri = form.get("redirect_uri") || "";
      const verifier = form.get("code_verifier");
      const row = getDb().prepare(
        "SELECT * FROM auth_codes WHERE code_hash = ?"
      ).get(sha256(code)) as {
        client_id: string; user_id: number; redirect_uri: string; scope: string;
        code_challenge: string | null; nonce: string | null;
        expires_at: number; used: number;
      } | undefined;
      if (!row || row.used || row.expires_at < nowSec()) {
        return oauthError(400, "invalid_grant", "授权码无效或已过期");
      }
      if (row.client_id !== client.client_id || row.redirect_uri !== redirectUri) {
        return oauthError(400, "invalid_grant", "授权码与应用/回调不匹配");
      }
      if (row.code_challenge) {
        if (!verifyPkce(verifier, row.code_challenge)) {
          return oauthError(400, "invalid_grant", "PKCE 校验失败");
        }
      } else if (client.is_public) {
        return oauthError(400, "invalid_grant", "公共客户端必须使用 PKCE");
      }
      const user = findUserById(row.user_id);
      if (!user || user.status !== "active") {
        return oauthError(400, "invalid_grant", "用户不存在或已被禁用");
      }
      const consumed = getDb().prepare(
        "UPDATE auth_codes SET used = 1 WHERE code_hash = ? AND used = 0"
      ).run(sha256(code));
      if (Number(consumed.changes) !== 1) {
        return oauthError(400, "invalid_grant", "授权码无效或已过期");
      }
      getDb().prepare("UPDATE oauth_clients SET last_used_at = ? WHERE client_id = ?")
        .run(new Date().toISOString(), client.client_id);
      return NextResponse.json(issueTokens(user, client, row.scope, row.nonce), {
        headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
      });
    }

    if (grantType === "refresh_token") {
      const refreshToken = form.get("refresh_token") || "";
      const row = getDb().prepare(
        "SELECT * FROM tokens WHERE token_hash = ? AND kind = 'refresh'"
      ).get(sha256(refreshToken)) as {
        client_id: string; user_id: number; scope: string; expires_at: number; revoked: number;
      } | undefined;
      if (!row) {
        return oauthError(400, "invalid_grant", "refresh_token 无效或已过期");
      }
      if (row.revoked) {
        revokeTokenFamily(row.user_id, row.client_id, "reuse_revoked");
        return oauthError(400, "invalid_grant", "refresh_token 已被撤销");
      }
      if (row.expires_at < nowSec()) {
        return oauthError(400, "invalid_grant", "refresh_token 无效或已过期");
      }
      if (row.client_id !== client.client_id) {
        return oauthError(400, "invalid_grant", "refresh_token 不属于该应用");
      }
      const user = findUserById(row.user_id);
      if (!user || user.status !== "active") {
        return oauthError(400, "invalid_grant", "用户不存在或已被禁用");
      }
      const requested = form.get("scope");
      let scope = row.scope;
      if (requested) {
        const scopes = parseScopes(requested);
        const allowed = parseScopes(row.scope);
        if (!scopes.every((item) => allowed.includes(item))) {
          return oauthError(400, "invalid_scope", "请求的 scope 超出原授权");
        }
        scope = scopes.join(" ");
      }
      const rotated = getDb().prepare(
        "UPDATE tokens SET revoked = 1 WHERE token_hash = ? AND revoked = 0"
      ).run(sha256(refreshToken));
      if (Number(rotated.changes) !== 1) {
        revokeTokenFamily(row.user_id, row.client_id, "reuse_race");
        return oauthError(400, "invalid_grant", "refresh_token 已被撤销");
      }
      return NextResponse.json(issueTokens(user, client, scope, null), {
        headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
      });
    }

    return oauthError(400, "unsupported_grant_type", "仅支持 authorization_code / refresh_token");
  } catch (error) {
    if (error instanceof HttpError) {
      return oauthError(error.status, error.code, error.message);
    }
    console.error("[auth-center] token error", error);
    return oauthError(500, "server_error", "服务端错误");
  }
}
