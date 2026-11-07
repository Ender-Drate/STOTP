#!/usr/bin/env node
/**
 * 创建或重置管理员账号。
 *
 *   node scripts/seed.mjs [用户名] [密码] [邮箱]
 *   AUTH_ADMIN_PASSWORD='...' node scripts/seed.mjs
 *
 * 数据库位置：AUTH_DB_PATH，或 AUTH_DATA_DIR/auth.db，或 ./data/auth.db
 */
import { randomBytes, scryptSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const [usernameArg, passwordArg, emailArg] = process.argv.slice(2);
const username = (usernameArg || process.env.AUTH_ADMIN_USERNAME || "admin").trim();
const password = passwordArg || process.env.AUTH_ADMIN_PASSWORD || "";
const email = (emailArg || process.env.AUTH_ADMIN_EMAIL || "admin@localhost").trim();

if (!password) {
  console.error("用法: node scripts/seed.mjs [用户名] [密码] [邮箱]");
  console.error("  或: AUTH_ADMIN_PASSWORD='至少8位' node scripts/seed.mjs");
  process.exit(1);
}
if (password.length < 8) {
  console.error("密码至少 8 位");
  process.exit(1);
}

const dataDir = process.env.AUTH_DATA_DIR || path.join(process.cwd(), "data");
const file = process.env.AUTH_DB_PATH || path.join(dataDir, "auth.db");

const db = new DatabaseSync(file);
const table = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'")
  .get();
if (!table) {
  console.error(`数据库还没有 users 表：${file}`);
  console.error("请先启动一次 auth-center，让服务端完成建表。");
  process.exit(1);
}

const roleTable = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'roles'")
  .get();
if (!roleTable) {
  console.error("数据库还没有 roles 表，请先启动一次 auth-center 完成迁移。");
  process.exit(1);
}
const superRole = db
  .prepare("SELECT id, permissions FROM roles WHERE key = 'superadmin'")
  .get();
if (!superRole) {
  console.error("缺少 superadmin 角色，请先启动一次 auth-center。");
  process.exit(1);
}

const salt = randomBytes(16);
const derived = scryptSync(password, salt, 64);
const passwordHash = `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
const permissions = superRole.permissions;
const now = new Date().toISOString();

const existing = db
  .prepare("SELECT id, username FROM users WHERE username = ?")
  .get(username);

if (!existing) {
  const emailOwner = db
    .prepare("SELECT username FROM users WHERE email = ?")
    .get(email);
  if (emailOwner) {
    console.error(`邮箱 ${email} 已被用户 ${emailOwner.username} 使用，请换一个邮箱或用户名。`);
    process.exit(1);
  }
}

if (existing) {
  db.prepare(
    `UPDATE users
     SET username = ?, email = ?, password_hash = ?, role = 'superadmin',
         role_id = ?, status = 'active', permissions = ?
     WHERE id = ?`
  ).run(username, email, passwordHash, superRole.id, permissions, existing.id);
  console.log(`已重置最高管理员：${username}（id=${existing.id}）`);
} else {
  const result = db.prepare(
    `INSERT INTO users(username, email, password_hash, display_name, role, role_id,
       status, permissions, created_at)
     VALUES (?, ?, ?, ?, 'superadmin', ?, 'active', ?, ?)`
  ).run(username, email, passwordHash, username, superRole.id, permissions, now);
  console.log(`已创建最高管理员：${username}（id=${result.lastInsertRowid}）`);
}

console.log(`数据库：${file}`);
console.log("现在可以用该用户名和新密码登录 /login。");
db.close();
