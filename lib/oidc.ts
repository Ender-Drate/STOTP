import { NextRequest } from "next/server";
import {
  ACCESS_TOKEN_TTL,
  PUBLIC_URL,
  REFRESH_TOKEN_TTL,
} from "./config";
import { randomToken, safeEqual, sha256, sha256Base64url } from "./crypto";
import { getDb, nowSec, type OAuthClient, type User } from "./db";
import { HttpError } from "./http";
import { signJwt } from "./jwt";
import { avatarUrl } from "./avatar";

export const SUPPORTED_SCOPES = [
  "openid",
  "profile",
  "email",
  "head",
  "permission",
  "offline_access",
] as const;

export const SCOPE_LABELS: Record<string, string> = {
  openid: "获取你的唯一标识（sub）",
  profile: "读取用户名、昵称",
  email: "读取邮箱地址",
  head: "读取头像",
  permission: "读取权限节点列表",
  offline_access: "允许应用在你离线时继续访问（refresh token）",
};

export function parseScopes(input: string | null | undefined): string[] {
  if (!input) return [];
  return Array.from(new Set(input.split(/[\s+]+/).filter(Boolean)));
}

export function normalizeScopes(scopes: string[]): string[] {
  return scopes.filter((s, i) => scopes.indexOf(s) === i);
}

export function scopeAllowed(requested: string[], allowed: string[]): boolean {
  return requested.every((scope) => allowed.includes(scope));
}

export function getClient(clientId: string): OAuthClient | undefined {
  return getDb()
    .prepare("SELECT * FROM oauth_clients WHERE client_id = ?")
    .get(clientId) as unknown as OAuthClient | undefined;
}

export function clientRedirects(client: OAuthClient): string[] {
  try {
    return JSON.parse(client.redirect_uris) as string[];
  } catch {
    return [];
  }
}

export function clientScopes(client: OAuthClient): string[] {
  return parseScopes(client.scopes);
}

export function verifyPkce(verifier: string | null, challenge: string | null): boolean {
  if (!verifier || !challenge) return false;
  return safeEqual(sha256Base64url(verifier), challenge);
}

export interface AuthorizeInput {
  client: OAuthClient;
  redirectUri: string;
  scopes: string[];
  state: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
  nonce: string | null;
  prompt: string | null;
}

export function validateAuthorize(params: URLSearchParams): AuthorizeInput {
  if (params.get("response_type") !== "code") {
    throw new HttpError(400, "unsupported_response_type", "仅支持 response_type=code");
  }
  const clientId = params.get("client_id") || "";
  const client = getClient(clientId);
  if (!client || client.status !== "active") {
    throw new HttpError(400, "invalid_client", "应用不存在或已被禁用");
  }
  const redirectUri = params.get("redirect_uri") || "";
  if (!clientRedirects(client).includes(redirectUri)) {
    throw new HttpError(400, "invalid_request", "redirect_uri 不在应用白名单");
  }
  const requested = normalizeScopes(parseScopes(params.get("scope")));
  const scopes = requested.length ? requested : ["openid", "profile"];
  if (!scopeAllowed(scopes, clientScopes(client))) {
    throw new HttpError(400, "invalid_scope", "请求的 scope 超出应用授权范围");
  }
  const method = params.get("code_challenge_method") || null;
  const challenge = params.get("code_challenge") || null;
  if (method && method !== "S256") {
    throw new HttpError(400, "invalid_request", "仅支持 code_challenge_method=S256");
  }
  if (client.is_public && (!challenge || method !== "S256")) {
    throw new HttpError(400, "invalid_request", "公共客户端必须使用 PKCE(S256)");
  }
  const state = params.get("state");
  if (client.is_public && !state) {
    throw new HttpError(400, "invalid_request", "公共客户端必须提供 state");
  }
  return {
    client,
    redirectUri,
    scopes,
    state,
    codeChallenge: challenge,
    codeChallengeMethod: method,
    nonce: params.get("nonce"),
    prompt: params.get("prompt"),
  };
}

export function errorRedirect(
  redirectUri: string,
  error: string,
  state: string | null,
  description?: string
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (description) url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

export function consentScope(userId: number, clientId: string): string | null {
  const row = getDb()
    .prepare("SELECT scope FROM consents WHERE user_id = ? AND client_id = ?")
    .get(userId, clientId) as { scope: string } | undefined;
  return row?.scope ?? null;
}

export function saveConsent(userId: number, clientId: string, scopes: string[]) {
  const existing = consentScope(userId, clientId);
  const merged = normalizeScopes([...(existing ? parseScopes(existing) : []), ...scopes]);
  getDb().prepare(
    `INSERT INTO consents(user_id, client_id, scope, created_at) VALUES (?,?,?,?)
     ON CONFLICT(user_id, client_id) DO UPDATE SET scope = excluded.scope`
  ).run(userId, clientId, merged.join(" "), new Date().toISOString());
}

export function revokeConsent(userId: number, clientId: string) {
  getDb().prepare("DELETE FROM consents WHERE user_id = ? AND client_id = ?").run(userId, clientId);
}

function profileClaims(user: User, scopes: string[]): Record<string, unknown> {
  const claims: Record<string, unknown> = {};
  if (scopes.includes("profile")) {
    claims.name = user.display_name || user.username;
    claims.preferred_username = user.username;
    claims.display_name = user.display_name || user.username;
  }
  if (scopes.includes("email")) {
    claims.email = user.email;
    claims.email_verified = user.email_verified === 1;
  }
  if (scopes.includes("head")) {
    claims.picture = avatarUrl(user.id);
  }
  if (scopes.includes("permission")) {
    try {
      claims.permissions = JSON.parse(user.permissions);
    } catch {
      claims.permissions = [];
    }
  }
  return claims;
}

export interface IssuedTokens {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token?: string;
}

export function issueTokens(
  user: User,
  client: OAuthClient,
  scope: string,
  nonce: string | null
): IssuedTokens {
  const scopes = parseScopes(scope);
  const now = nowSec();
  const jti = randomToken(16);
  const subject = user.uuid || String(user.id);
  const accessClaims: Record<string, unknown> = {
    iss: PUBLIC_URL,
    sub: subject,
    aud: client.client_id,
    scope,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL,
    jti,
    typ: "access",
    ...profileClaims(user, scopes),
  };
  const accessToken = signJwt(accessClaims);
  getDb().prepare(
    `INSERT INTO tokens(token_hash, jti, kind, client_id, user_id, scope, expires_at, created_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(sha256(accessToken), jti, "access", client.client_id, user.id, scope,
    now + ACCESS_TOKEN_TTL, now);

  let refreshToken: string | undefined;
  if (scopes.includes("offline_access")) {
    refreshToken = `rt_${randomToken(32)}`;
    getDb().prepare(
      `INSERT INTO tokens(token_hash, jti, kind, client_id, user_id, scope, expires_at, created_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(sha256(refreshToken), null, "refresh", client.client_id, user.id, scope,
      now + REFRESH_TOKEN_TTL, now);
  }

  let idToken: string | undefined;
  if (scopes.includes("openid")) {
    const claims: Record<string, unknown> = {
      iss: PUBLIC_URL,
      sub: subject,
      aud: client.client_id,
      azp: client.client_id,
      iat: now,
      exp: now + ACCESS_TOKEN_TTL,
      auth_time: now,
      at_hash: Buffer.from(sha256(accessToken), "hex").subarray(0, 16).toString("base64url"),
      typ: "id",
      ...profileClaims(user, scopes),
    };
    if (nonce) claims.nonce = nonce;
    idToken = signJwt(claims);
  }

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL,
    refresh_token: refreshToken,
    scope,
    id_token: idToken,
  };
}

export function authenticateClient(req: NextRequest, form: URLSearchParams): OAuthClient {
  let clientId = form.get("client_id") || "";
  let secret = form.get("client_secret") || "";
  const header = req.headers.get("authorization") || "";
  if (header.toLowerCase().startsWith("basic ")) {
    try {
      const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
      const index = decoded.indexOf(":");
      clientId = decodeURIComponent(decoded.slice(0, index));
      secret = decodeURIComponent(decoded.slice(index + 1));
    } catch {
      throw new HttpError(401, "invalid_client", "Basic 认证格式错误");
    }
  }
  const client = getClient(clientId);
  if (!client || client.status !== "active") {
    throw new HttpError(401, "invalid_client", "应用不存在或已禁用");
  }
  if (!client.is_public) {
    if (!secret || !client.client_secret_hash ||
        !safeEqual(sha256(secret), client.client_secret_hash)) {
      throw new HttpError(401, "invalid_client", "client_secret 不正确");
    }
  }
  return client;
}
