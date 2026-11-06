import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { hashPassword } from "./crypto";

export type Role = "admin" | "user";
export type UserStatus = "active" | "disabled";

export interface User {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  avatar_url: string | null;
  role: Role;
  status: UserStatus;
  permissions: string;
  totp_secret: string | null;
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

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  permissions TEXT NOT NULL DEFAULT '[]',
  totp_secret TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
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

CREATE TABLE IF NOT EXISTS stotp_bindings (
  user_id INTEGER PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  account_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  last_verified_at TEXT
);

CREATE TABLE IF NOT EXISTS login_challenges (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ttl_seconds INTEGER NOT NULL,
  ip TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tokens_client ON tokens(client_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_challenges_expiry ON login_challenges(expires_at);
`;

const globalForDb = globalThis as unknown as { __authCenterDb?: DatabaseSync };

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
  db.prepare(
    `INSERT INTO users(username, email, password_hash, display_name, role, status, permissions, created_at)
     VALUES (?, ?, ?, ?, 'admin', 'active', ?, ?)`
  ).run(username, email, hashPassword(password), username, JSON.stringify(["admin", "user"]), now);
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
  const columns = db.prepare("PRAGMA table_info(auth_codes)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "nonce")) {
    db.exec("ALTER TABLE auth_codes ADD COLUMN nonce TEXT");
  }
  ensureAdmin(db);
  globalForDb.__authCenterDb = db;
  return db;
}

export function findUserByUsername(username: string): User | undefined {
  return getDb().prepare("SELECT * FROM users WHERE username = ? OR email = ?")
    .get(username, username) as unknown as User | undefined;
}

export function findUserById(id: number): User | undefined {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as unknown as User | undefined;
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
