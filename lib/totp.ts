import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb, nowSec } from "./db";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret: string, at = Date.now(), step = 30, digits = 6): string {
  const counter = Math.floor(at / 1000 / step);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = (
    ((hmac[offset] & 0x7f) << 24)
    | (hmac[offset + 1] << 16)
    | (hmac[offset + 2] << 8)
    | hmac[offset + 3]
  );
  return String(binary % 10 ** digits).padStart(digits, "0");
}

function codesEqual(expected: string, actual: string): boolean {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(actual, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyTotp(secret: string, code: string, window = 1): boolean {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized) || !secret) return false;
  const now = Date.now();
  for (let offset = -window; offset <= window; offset += 1) {
    if (codesEqual(totpCode(secret, now + offset * 30 * 1000), normalized)) return true;
  }
  return false;
}

/**
 * 登录/再认证使用：除时间窗外，同一用户同一 timestep 只能成功一次。
 * 返回 true 后该 timestep 已被记录，重放同一六位码会失败。
 */
export function verifyTotpForUser(
  userId: number,
  secret: string,
  code: string,
  window = 1,
): boolean {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized) || !secret) return false;
  const now = Date.now();
  for (let offset = -window; offset <= window; offset += 1) {
    const at = now + offset * 30 * 1000;
    if (!codesEqual(totpCode(secret, at), normalized)) continue;
    const timestep = Math.floor(at / 1000 / 30);
    const inserted = getDb().prepare(
      `INSERT OR IGNORE INTO totp_used(user_id, timestep, used_at)
       VALUES (?, ?, ?)`
    ).run(userId, timestep, nowSec());
    return Number(inserted.changes) === 1;
  }
  return false;
}

export function otpauthUri(secret: string, username: string, issuer = "STOTP"): string {
  const label = encodeURIComponent(`${issuer}:${username}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
