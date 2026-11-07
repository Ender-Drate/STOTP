import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { getDb, nowIso, readKeyFile, writeKeyFile } from "./db";

const globalForConfig = globalThis as unknown as { __authCenterConfigSecret?: Buffer };

function secretKey(): Buffer {
  if (globalForConfig.__authCenterConfigSecret) return globalForConfig.__authCenterConfigSecret;
  const env = process.env.AUTH_CONFIG_SECRET;
  if (env) {
    const key = createHash("sha256").update(env).digest();
    globalForConfig.__authCenterConfigSecret = key;
    return key;
  }
  const dataDir = process.env.AUTH_DATA_DIR || path.join(process.cwd(), "data");
  const file = path.join(dataDir, "config-secret");
  const raw = readKeyFile(file);
  if (raw && /^[a-f0-9]{64}$/i.test(raw.trim())) {
    const key = Buffer.from(raw.trim(), "hex");
    globalForConfig.__authCenterConfigSecret = key;
    return key;
  }
  const generated = randomBytes(32);
  writeKeyFile(file, generated.toString("hex"));
  globalForConfig.__authCenterConfigSecret = generated;
  return generated;
}

export function encryptSetting(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSetting(value: string): string {
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("bad encrypted setting");
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const data = Buffer.from(parts[3], "base64url");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb().prepare(
    `INSERT INTO app_settings(key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, nowIso());
}
