import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

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
  if (existsSync(file)) {
    const raw = readFileSync(file, "utf8").trim();
    if (/^[a-f0-9]{64}$/i.test(raw)) {
      const key = Buffer.from(raw, "hex");
      globalForConfig.__authCenterConfigSecret = key;
      return key;
    }
  }
  const generated = randomBytes(32);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, generated.toString("hex"), { encoding: "utf8", mode: 0o600 });
  globalForConfig.__authCenterConfigSecret = generated;
  return generated;
}

export function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(value: string): string {
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("bad encrypted value");
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const data = Buffer.from(parts[3], "base64url");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
