import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { hashPasswordSync } from "./crypto";
import { encryptTotpSecret } from "./totp-secret";
import { encryptSecret } from "./secret-box";
import { ALL_PERMISSION_KEYS, DEFAULT_ROLE_PERMISSIONS } from "./permission-defs";

export type Role = string;

export interface RoleRecord {
  id: number;
  key: string;
  name: string;
  description: string | null;
  permissions: string;
  is_system: number;
  created_at: string;
}

export type UserStatus = "active" | "disabled" | "pending";

export interface User {
  id: number;
  uuid: string;
  username: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  avatar_url: string | null;
  role: Role;
  role_id: number | null;
  status: UserStatus;
  permissions: string;
  totp_secret: string | null;
  email_verified: number;
  risk_score: number;
  risk_updated_at: string | null;
  created_at: string;
  last_login_at: string | null;
}

export interface StotpBinding {
  user_id: number;
  client_id: string;
  account_id: string | null;
  status: string;
  created_at: string;
  last_verified_at: string | null;
}

export interface OAuthClient {  id: number;
  client_id: string;
  client_secret_hash: string | null;
  name: string;
  description: string | null;
  redirect_uris: string;
  scopes: string;
  is_public: number;
  status: "active" | "disabled";
  owner_id: number;
  created_at: string;
  last_used_at: string | null;
}

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  permissions TEXT NOT NULL DEFAULT '[]',
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  role_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  permissions TEXT NOT NULL DEFAULT '[]',
  totp_secret TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  risk_score INTEGER NOT NULL DEFAULT 0,
  risk_updated_at TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT,
  last_seen_at INTEGER
);

CREATE TABLE IF NOT EXISTS oauth_clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL UNIQUE,
  client_secret_hash TEXT,
  name TEXT NOT NULL,
  description TEXT,
  redirect_uris TEXT NOT NULL,
  scopes TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  owner_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS auth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL,
  code_challenge TEXT,
  nonce TEXT,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens (
  token_hash TEXT PRIMARY KEY,
  jti TEXT,
  kind TEXT NOT NULL,
  client_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  scope TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS consents (
  user_id INTEGER NOT NULL,
  client_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, client_id)
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  event TEXT NOT NULL,
  user_id INTEGER,
  client_id TEXT,
  ip TEXT,
  detail TEXT
);

CREATE TABLE IF NOT EXISTS login_challenges (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ttl_seconds INTEGER NOT NULL,
  ip TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'totp',
  attempts INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS passkeys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  name TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  token_hash TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  user_id INTEGER,
  type TEXT NOT NULL,
  ip TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'low',
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS totp_used (
  user_id INTEGER NOT NULL,
  timestep INTEGER NOT NULL,
  used_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, timestep)
);

CREATE TABLE IF NOT EXISTS login_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  icon_url TEXT,
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  authorization_url TEXT NOT NULL,
  token_url TEXT NOT NULL,
  userinfo_url TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT 'openid profile email',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_login_states (
  state_hash TEXT PRIMARY KEY,
  provider_id INTEGER NOT NULL,
  verifier TEXT NOT NULL,
  next TEXT NOT NULL,
  ip TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_links (
  provider_id INTEGER NOT NULL,
  subject TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider_id, subject),
  UNIQUE (user_id, provider_id)
);

CREATE TABLE IF NOT EXISTS provider_link_tickets (
  token_hash TEXT PRIMARY KEY,
  provider_id INTEGER NOT NULL,
  subject TEXT NOT NULL,
  display_name TEXT,
  email TEXT,
  next TEXT NOT NULL,
  ip TEXT NOT NULL,
  user_id INTEGER,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_failures (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS totp_pending (
  user_id INTEGER PRIMARY KEY,
  secret TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS captcha_challenges (
  token_hash TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  answer TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'login',
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS risk_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS risk_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  ip TEXT NOT NULL,
  user_id INTEGER,
  path TEXT,
  user_agent TEXT,
  tls_fingerprint TEXT,
  signals TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  reasons TEXT
);

CREATE TABLE IF NOT EXISTS ip_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL UNIQUE,
  action TEXT NOT NULL DEFAULT 'watch',
  reason TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS ip_risk_clears (
  ip TEXT PRIMARY KEY,
  cleared_at TEXT NOT NULL,
  cleared_by INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id);

CREATE INDEX IF NOT EXISTS idx_tokens_client ON tokens(client_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_challenges_expiry ON login_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_risk_observations_ip_ts ON risk_observations(ip, ts);
CREATE INDEX IF NOT EXISTS idx_risk_observations_ts ON risk_observations(ts);
CREATE INDEX IF NOT EXISTS idx_audit_ip_ts ON audit(ip, ts);
CREATE INDEX IF NOT EXISTS idx_audit_event_ts ON audit(event, ts);
CREATE INDEX IF NOT EXISTS idx_audit_event_ip_ts ON audit(event, ip, ts);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts);
CREATE INDEX IF NOT EXISTS idx_login_failures_last ON login_failures(last_at);
`;

const globalForDb = globalThis as unknown as {
  __authCenterDb?: DatabaseSync;
  __authCenterCleanupTimer?: ReturnType<typeof setInterval>;
};

export function cleanupExpired(db: DatabaseSync = getDb()): void {
  const now = nowSec();
  for (const table of [
    "auth_codes", "tokens", "sessions", "login_challenges", "webauthn_challenges",
    "email_verification_tokens", "password_reset_tokens", "captcha_challenges",
    "provider_link_tickets", "totp_pending",
  ]) {
    db.prepare(`DELETE FROM ${table} WHERE expires_at < ?`).run(now);
  }
  db.prepare("DELETE FROM totp_used WHERE used_at < ?").run(now - 300);
  const retention = db.prepare(
    "SELECT value FROM risk_settings WHERE key = 'audit_retention_days'"
  ).get() as { value: string } | undefined;
  const days = Math.max(1, Math.min(3650, Number(retention?.value) || 30));
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
  db.prepare("DELETE FROM audit WHERE ts < ?").run(cutoff);
  db.prepare("DELETE FROM risk_observations WHERE ts < ?").run(cutoff);
  db.prepare("DELETE FROM login_failures WHERE last_at < ?").run(now - 86400);
  db.prepare("DELETE FROM rate_limits WHERE reset_at < ?").run(now - 3600);
}

function ensureRoles(db: DatabaseSync) {
  const now = nowIso();
  const systemRoles = [
    {
      key: "superadmin", name: "最高管理员",
      description: "拥有全部权限，可以管理权限等级",
      permissions: JSON.stringify(ALL_PERMISSION_KEYS),
    },
    {
      key: "admin", name: "管理员",
      description: "日常管理，不能修改权限等级",
      permissions: JSON.stringify(DEFAULT_ROLE_PERMISSIONS.admin),
    },
    {
      key: "user", name: "普通用户",
      description: "只能使用自己的账号功能",
      permissions: JSON.stringify(DEFAULT_ROLE_PERMISSIONS.user),
    },
  ];
  for (const role of systemRoles) {
    db.prepare(
      `INSERT OR IGNORE INTO roles(key, name, description, permissions, is_system, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`
    ).run(role.key, role.name, role.description, role.permissions, now);
  }
  const superId = (db.prepare("SELECT id FROM roles WHERE key = 'superadmin'").get() as {
    id: number;
  }).id;
  const userId = (db.prepare("SELECT id FROM roles WHERE key = 'user'").get() as {
    id: number;
  }).id;
  const legacy = db.prepare(
    "SELECT id, role FROM users WHERE role_id IS NULL"
  ).all() as Array<{ id: number; role: string }>;
  for (const row of legacy) {
    const isAdmin = row.role === "admin" || row.role === "superadmin";
    const roleId = isAdmin ? superId : userId;
    const key = isAdmin ? "superadmin" : "user";
    const permissions = JSON.stringify(
      isAdmin ? ALL_PERMISSION_KEYS : DEFAULT_ROLE_PERMISSIONS.user
    );
    db.prepare(
      "UPDATE users SET role_id = ?, role = ?, permissions = ? WHERE id = ?"
    ).run(roleId, key, permissions, row.id);
  }
}

function ensureAdmin(db: DatabaseSync) {
  const row = db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
  if (row.c > 0) return;
  const username = process.env.AUTH_ADMIN_USERNAME || "admin";
  const email = process.env.AUTH_ADMIN_EMAIL || "admin@localhost";
  const password = process.env.AUTH_ADMIN_PASSWORD ||
    (process.env.NODE_ENV === "production"
      ? randomBytes(12).toString("base64url")
      : "admin1234");
  const now = nowIso();
  const superRole = db.prepare("SELECT id FROM roles WHERE key = 'superadmin'").get() as {
    id: number;
  };
  const uuid = randomUUID();
  db.prepare(
    `INSERT INTO users(uuid, username, email, password_hash, display_name, role, role_id,
       status, permissions, created_at)
     VALUES (?, ?, ?, ?, ?, 'superadmin', ?, 'active', ?, ?)`
  ).run(uuid, username, email, hashPasswordSync(password), username, superRole.id,
    JSON.stringify(ALL_PERMISSION_KEYS), now);
  if (!process.env.AUTH_ADMIN_PASSWORD) {
    console.warn(`[auth-center] 已创建管理员 ${username} / ${password}（请尽快修改密码）`);
  }
}

export function getDb(): DatabaseSync {
  if (globalForDb.__authCenterDb) return globalForDb.__authCenterDb;
  const dataDir = process.env.AUTH_DATA_DIR || path.join(process.cwd(), "data");
  mkdirSync(dataDir, { recursive: true });
  const file = process.env.AUTH_DB_PATH || path.join(dataDir, "auth.db");
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const codeColumns = db.prepare("PRAGMA table_info(auth_codes)").all() as Array<{ name: string }>;
  if (!codeColumns.some((column) => column.name === "nonce")) {
    db.exec("ALTER TABLE auth_codes ADD COLUMN nonce TEXT");
  }
  const userColumns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  if (!userColumns.some((column) => column.name === "role_id")) {
    db.exec("ALTER TABLE users ADD COLUMN role_id INTEGER");
  }
  if (!userColumns.some((column) => column.name === "email_verified")) {
    db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0");
  }
  if (!userColumns.some((column) => column.name === "risk_score")) {
    db.exec("ALTER TABLE users ADD COLUMN risk_score INTEGER NOT NULL DEFAULT 0");
  }
  if (!userColumns.some((column) => column.name === "risk_updated_at")) {
    db.exec("ALTER TABLE users ADD COLUMN risk_updated_at TEXT");
  }
  if (!userColumns.some((column) => column.name === "uuid")) {
    db.exec("ALTER TABLE users ADD COLUMN uuid TEXT");
  }
  const missingUuid = db.prepare("SELECT id FROM users WHERE uuid IS NULL OR uuid = ''")
    .all() as Array<{ id: number }>;
  for (const row of missingUuid) {
    db.prepare("UPDATE users SET uuid = ? WHERE id = ?").run(randomUUID(), row.id);
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_uuid ON users(uuid)");
  const challengeColumns = db.prepare("PRAGMA table_info(login_challenges)")
    .all() as Array<{ name: string }>;
  if (!challengeColumns.some((column) => column.name === "method")) {
    db.exec("ALTER TABLE login_challenges ADD COLUMN method TEXT NOT NULL DEFAULT 'totp'");
  }
  const linkTicketColumns = db.prepare("PRAGMA table_info(provider_link_tickets)")
    .all() as Array<{ name: string }>;
  if (!linkTicketColumns.some((column) => column.name === "user_id")) {
    db.exec("ALTER TABLE provider_link_tickets ADD COLUMN user_id INTEGER");
  }
  const captchaColumns = db.prepare("PRAGMA table_info(captcha_challenges)")
    .all() as Array<{ name: string }>;
  if (!captchaColumns.some((column) => column.name === "purpose")) {
    db.exec("ALTER TABLE captcha_challenges ADD COLUMN purpose TEXT NOT NULL DEFAULT 'login'");
  }
  if (!captchaColumns.some((column) => column.name === "attempts")) {
    db.exec("ALTER TABLE captcha_challenges ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");
  }
  if (!captchaColumns.some((column) => column.name === "answer")) {
    db.exec("ALTER TABLE captcha_challenges ADD COLUMN answer TEXT NOT NULL DEFAULT ''");
  }
  const sessionColumns = db.prepare("PRAGMA table_info(sessions)")
    .all() as Array<{ name: string }>;
  for (const column of ["ip", "user_agent"]) {
    if (!sessionColumns.some((item) => item.name === column)) {
      db.exec(`ALTER TABLE sessions ADD COLUMN ${column} TEXT`);
    }
  }
  if (!sessionColumns.some((item) => item.name === "last_seen_at")) {
    db.exec("ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)");
  ensureRoles(db);
  ensureAdmin(db);
  const plaintextTotp = db.prepare(
    "SELECT id, totp_secret FROM users WHERE totp_secret IS NOT NULL AND totp_secret NOT LIKE 'v1.%'"
  ).all() as unknown as Array<{ id: number; totp_secret: string }>;
  for (const row of plaintextTotp) {
    db.prepare("UPDATE users SET totp_secret = ? WHERE id = ?")
      .run(encryptTotpSecret(row.totp_secret), row.id);
  }
  const plaintextProviderSecrets = db.prepare(
    "SELECT id, client_secret FROM login_providers WHERE client_secret NOT LIKE 'v1.%'"
  ).all() as unknown as Array<{ id: number; client_secret: string }>;
  for (const row of plaintextProviderSecrets) {
    db.prepare("UPDATE login_providers SET client_secret = ? WHERE id = ?")
      .run(encryptSecret(row.client_secret), row.id);
  }
  cleanupExpired(db);
  globalForDb.__authCenterDb = db;
  if (!globalForDb.__authCenterCleanupTimer) {
    globalForDb.__authCenterCleanupTimer = setInterval(() => {
      try {
        cleanupExpired(db);
      } catch (error) {
        console.error("[auth-center] cleanup failed", error);
      }
    }, 24 * 3600 * 1000);
    globalForDb.__authCenterCleanupTimer.unref?.();
  }
  return db;
}

export function findUserByUsername(username: string): User | undefined {
  return getDb().prepare("SELECT * FROM users WHERE username = ? OR email = ?")
    .get(username, username) as unknown as User | undefined;
}

export function findUserById(id: number): User | undefined {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as unknown as User | undefined;
}

export function findUserByUuid(uuid: string): User | undefined {
  return getDb().prepare("SELECT * FROM users WHERE uuid = ?").get(uuid) as unknown as User | undefined;
}

export function countUsers(): number {
  return (getDb().prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c;
}

export function audit(event: string, data: {
  userId?: number; clientId?: string; ip?: string; detail?: string;
}) {
  getDb().prepare(
    "INSERT INTO audit(ts, event, user_id, client_id, ip, detail) VALUES (?,?,?,?,?,?)"
  ).run(nowIso(), event, data.userId ?? null, data.clientId ?? null, data.ip ?? null,
    data.detail ?? null);
}

export function readKeyFile(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export function writeKeyFile(file: string, content: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, { encoding: "utf8", mode: 0o600 });
}
