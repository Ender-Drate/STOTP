import { createHash, createHmac, randomBytes } from "node:crypto";
import path from "node:path";
import { PUBLIC_URL } from "./config";
import { readKeyFile, writeKeyFile } from "./db";
import { safeEqual } from "./crypto";

const globalForAvatar = globalThis as unknown as { __authCenterAvatarSecret?: Buffer };

function secret(): Buffer {
  if (globalForAvatar.__authCenterAvatarSecret) return globalForAvatar.__authCenterAvatarSecret;
  const env = process.env.AUTH_AVATAR_SECRET;
  if (env) {
    const derived = createHash("sha256").update(env).digest();
    globalForAvatar.__authCenterAvatarSecret = derived;
    return derived;
  }
  const dataDir = process.env.AUTH_DATA_DIR || path.join(process.cwd(), "data");
  const file = path.join(dataDir, "avatar-secret");
  const raw = readKeyFile(file);
  if (raw && /^[a-f0-9]{64}$/i.test(raw.trim())) {
    const derived = Buffer.from(raw.trim(), "hex");
    globalForAvatar.__authCenterAvatarSecret = derived;
    return derived;
  }
  const generated = randomBytes(32);
  writeKeyFile(file, generated.toString("hex"));
  globalForAvatar.__authCenterAvatarSecret = generated;
  return generated;
}

export function avatarSignature(uid: number): string {
  return createHmac("sha256", secret()).update(String(uid)).digest("base64url");
}

export function avatarUrl(uid: number): string {
  return `${PUBLIC_URL}/api/oauth/head?uid=${encodeURIComponent(String(uid))}&sig=${encodeURIComponent(avatarSignature(uid))}`;
}

export function verifyAvatarSignature(uid: number, signature: string): boolean {
  if (!Number.isInteger(uid) || uid <= 0 || !signature) return false;
  return safeEqual(avatarSignature(uid), signature);
}
