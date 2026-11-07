import { randomBytes } from "node:crypto";
import { getDb, nowIso, nowSec } from "./db";
import { randomToken, sha256 } from "./crypto";
import { HttpError } from "./http";

export interface ProviderBody {
  name?: string;
  iconUrl?: string;
  clientId?: string;
  clientSecret?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  userinfoUrl?: string;
  scopes?: string;
  enabled?: boolean;
}

export function providerUrl(value: unknown, label: string): string {
  const raw = String(value || "").trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, "invalid_request", `${label} 不是合法 URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new HttpError(400, "invalid_request", `${label} 只支持 http/https`);
  }
  return url.toString();
}

export function providerIconUrl(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, "invalid_request", "图标地址不合法");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new HttpError(400, "invalid_request", "图标只支持 http/https");
  }
  return url.toString();
}

export interface LoginProvider {
  id: number;
  key: string;
  name: string;
  icon_url: string | null;
  client_id: string;
  client_secret: string;
  authorization_url: string;
  token_url: string;
  userinfo_url: string;
  scopes: string;
  enabled: number;
  created_at: string;
}

export interface LoginProviderView {
  id: number;
  key: string;
  name: string;
  iconUrl: string | null;
  clientId: string;
  hasSecret: boolean;
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scopes: string;
  enabled: boolean;
  createdAt: string;
}

export function providerView(provider: LoginProvider): LoginProviderView {
  return {
    id: provider.id,
    key: provider.key,
    name: provider.name,
    iconUrl: provider.icon_url,
    clientId: provider.client_id,
    hasSecret: Boolean(provider.client_secret),
    authorizationUrl: provider.authorization_url,
    tokenUrl: provider.token_url,
    userinfoUrl: provider.userinfo_url,
    scopes: provider.scopes,
    enabled: Boolean(provider.enabled),
    createdAt: provider.created_at,
  };
}

export function listProviders(onlyEnabled = false): LoginProvider[] {
  return getDb().prepare(
    `SELECT * FROM login_providers ${onlyEnabled ? "WHERE enabled = 1" : ""}
     ORDER BY id ASC`
  ).all() as unknown as LoginProvider[];
}

export function getProviderByKey(key: string): LoginProvider | undefined {
  return getDb().prepare("SELECT * FROM login_providers WHERE key = ?")
    .get(key) as unknown as LoginProvider | undefined;
}

export function getProvider(id: number): LoginProvider | undefined {
  return getDb().prepare("SELECT * FROM login_providers WHERE id = ?")
    .get(id) as unknown as LoginProvider | undefined;
}

export function createProvider(input: {
  name: string; iconUrl: string | null; clientId: string; clientSecret: string;
  authorizationUrl: string; tokenUrl: string; userinfoUrl: string;
  scopes: string; enabled: boolean;
}): LoginProvider {
  const key = `provider_${randomBytes(5).toString("hex")}`;
  const result = getDb().prepare(
    `INSERT INTO login_providers(key, name, icon_url, client_id, client_secret,
       authorization_url, token_url, userinfo_url, scopes, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(key, input.name, input.iconUrl, input.clientId, input.clientSecret,
    input.authorizationUrl, input.tokenUrl, input.userinfoUrl, input.scopes,
    input.enabled ? 1 : 0, nowIso());
  return getProvider(Number(result.lastInsertRowid))!;
}

export function updateProvider(id: number, input: {
  name: string; iconUrl: string | null; clientId: string;
  authorizationUrl: string; tokenUrl: string; userinfoUrl: string;
  scopes: string; enabled: boolean; clientSecret?: string;
}): void {
  getDb().prepare(
    `UPDATE login_providers SET name = ?, icon_url = ?, client_id = ?,
       authorization_url = ?, token_url = ?, userinfo_url = ?, scopes = ?,
       enabled = ? WHERE id = ?`
  ).run(input.name, input.iconUrl, input.clientId, input.authorizationUrl,
    input.tokenUrl, input.userinfoUrl, input.scopes, input.enabled ? 1 : 0, id);
  if (input.clientSecret) {
    getDb().prepare("UPDATE login_providers SET client_secret = ? WHERE id = ?")
      .run(input.clientSecret, id);
  }
}

export function deleteProvider(id: number): boolean {
  getDb().prepare("DELETE FROM provider_links WHERE provider_id = ?").run(id);
  getDb().prepare("DELETE FROM provider_link_tickets WHERE provider_id = ?").run(id);
  const result = getDb().prepare("DELETE FROM login_providers WHERE id = ?").run(id);
  return Number(result.changes) > 0;
}

export function listUserProviderLinks(userId: number): Array<{
  providerId: number;
  name: string;
  key: string;
  iconUrl: string | null;
  subject: string;
  createdAt: string;
}> {
  return getDb().prepare(
    `SELECT provider_links.provider_id AS providerId, login_providers.name AS name,
       login_providers.key AS key, login_providers.icon_url AS iconUrl,
       provider_links.subject AS subject, provider_links.created_at AS createdAt
     FROM provider_links
     JOIN login_providers ON login_providers.id = provider_links.provider_id
     WHERE provider_links.user_id = ?
     ORDER BY provider_links.created_at DESC`
  ).all(userId) as unknown as Array<{
    providerId: number; name: string; key: string;
    iconUrl: string | null; subject: string; createdAt: string;
  }>;
}

export function removeProviderLink(userId: number, providerId: number): boolean {
  const result = getDb().prepare(
    "DELETE FROM provider_links WHERE user_id = ? AND provider_id = ?"
  ).run(userId, providerId);
  return Number(result.changes) > 0;
}

export function findProviderLink(providerId: number, subject: string) {
  return getDb().prepare(
    "SELECT * FROM provider_links WHERE provider_id = ? AND subject = ?"
  ).get(providerId, subject) as unknown as {
    provider_id: number; subject: string; user_id: number; created_at: string;
  } | undefined;
}

export function linkProvider(providerId: number, subject: string, userId: number): void {
  getDb().prepare(
    `INSERT INTO provider_links(provider_id, subject, user_id, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(providerId, subject, userId, nowIso());
}

export function getProviderLinkByUser(
  userId: number, providerId: number
): { provider_id: number; subject: string; user_id: number } | undefined {
  return getDb().prepare(
    "SELECT * FROM provider_links WHERE user_id = ? AND provider_id = ?"
  ).get(userId, providerId) as unknown as {
    provider_id: number; subject: string; user_id: number;
  } | undefined;
}

export const LINK_TICKET_TTL = 10 * 60;

export function createLinkTicket(input: {
  providerId: number; subject: string; displayName: string;
  email: string; next: string; ip: string;
}): string {
  const ticket = randomToken(32);
  const now = nowSec();
  getDb().prepare(
    `INSERT INTO provider_link_tickets(token_hash, provider_id, subject, display_name,
       email, next, ip, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(sha256(ticket), input.providerId, input.subject, input.displayName.slice(0, 80),
    input.email.slice(0, 200), input.next, input.ip, now + LINK_TICKET_TTL, now);
  getDb().prepare("DELETE FROM provider_link_tickets WHERE expires_at < ?").run(now - 60);
  return ticket;
}

export interface LinkTicket {
  token_hash: string;
  provider_id: number;
  subject: string;
  display_name: string | null;
  email: string | null;
  next: string;
  ip: string;
  user_id: number | null;
  expires_at: number;
  used: number;
  created_at: number;
}

export function getLinkTicket(ticket: string, ip: string): LinkTicket | undefined {
  if (!ticket) return undefined;
  const row = getDb().prepare(
    "SELECT * FROM provider_link_tickets WHERE token_hash = ?"
  ).get(sha256(ticket)) as unknown as LinkTicket | undefined;
  if (!row || row.used || row.expires_at < nowSec() || row.ip !== ip) return undefined;
  return row;
}

export function markLinkTicketUsed(ticket: string): void {
  getDb().prepare("UPDATE provider_link_tickets SET used = 1 WHERE token_hash = ?")
    .run(sha256(ticket));
}

export function setLinkTicketUser(ticket: string, userId: number): void {
  getDb().prepare("UPDATE provider_link_tickets SET user_id = ? WHERE token_hash = ?")
    .run(userId, sha256(ticket));
}

export const OAUTH_STATE_COOKIE = "ac_oauth_state";
export const OAUTH_STATE_TTL = 10 * 60;

export interface OAuthLoginState {
  state: string;
  provider_id: number;
  verifier: string;
  next: string;
  ip: string;
  expires_at: number;
  used: number;
  created_at: number;
}

export function createOAuthState(
  providerId: number, verifier: string, next: string, ip: string
): string {
  const state = randomToken(32);
  const now = nowSec();
  getDb().prepare(
    `INSERT INTO oauth_login_states(state_hash, provider_id, verifier, next, ip, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(sha256(state), providerId, verifier, next, ip, now + OAUTH_STATE_TTL, now);
  getDb().prepare("DELETE FROM oauth_login_states WHERE expires_at < ?").run(now - 60);
  return state;
}

export function consumeOAuthState(
  state: string, ip: string
): OAuthLoginState | undefined {
  if (!state) return undefined;
  const row = getDb().prepare(
    "SELECT * FROM oauth_login_states WHERE state_hash = ?"
  ).get(sha256(state)) as unknown as OAuthLoginState | undefined;
  if (!row || row.used || row.expires_at < nowSec() || row.ip !== ip) return undefined;
  getDb().prepare("UPDATE oauth_login_states SET used = 1 WHERE state_hash = ?")
    .run(sha256(state));
  return row;
}

