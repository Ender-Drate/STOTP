import {
  createHash, createPrivateKey, createPublicKey, constants,
  generateKeyPairSync, privateDecrypt, type KeyObject,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { HttpError } from "./http";
import { PUBLIC_URL } from "./config";

interface StoredKeys {
  kid: string;
  publicKey: string;
  privateKey: string;
}

interface KeyPairCache {
  kid: string;
  publicJwk: JsonWebKey;
  privateKey: KeyObject;
}

let cache: KeyPairCache | null = null;

function keyFile(): string {
  const dir = process.env.AUTH_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "password-key.json");
}

function loadOrCreate(): StoredKeys {
  const file = keyFile();
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as StoredKeys;
      if (parsed.kid && parsed.publicKey && parsed.privateKey) return parsed;
    } catch {
      // 损坏时重新生成
    }
  }
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 3072,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const publicPem = String(publicKey);
  const kid = createHash("sha256").update(publicPem).digest("hex").slice(0, 16);
  const stored = { kid, publicKey: publicPem, privateKey: String(privateKey) };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(stored, null, 2), { encoding: "utf8", mode: 0o600 });
  return stored;
}

function getKeys(): KeyPairCache {
  if (cache) return cache;
  const stored = loadOrCreate();
  const publicJwk = createPublicKey(stored.publicKey).export({ format: "jwk" }) as JsonWebKey;
  cache = {
    kid: stored.kid,
    publicJwk: {
      ...publicJwk,
      use: "enc",
      alg: "RSA-OAEP-256",
      key_ops: ["encrypt"],
      ext: true,
    },
    privateKey: createPrivateKey(stored.privateKey),
  };
  return cache;
}

export function getPasswordPublicKey(): { kid: string; key: JsonWebKey } {
  const { kid, publicJwk } = getKeys();
  return { kid, key: publicJwk };
}

export interface PasswordPayload {
  password?: string;
  password_enc?: string;
  password_key?: string;
  currentPassword?: string;
  currentPassword_enc?: string;
  newPassword?: string;
  newPassword_enc?: string;
}

function decryptValue(encrypted: string, keyId?: string): string {
  if (!encrypted || encrypted.length > 8192) {
    throw new HttpError(400, "invalid_encrypted_password", "加密密码格式不正确");
  }
  const { kid, privateKey } = getKeys();
  if (keyId && keyId !== kid) {
    throw new HttpError(409, "password_key_rotated", "密码密钥已更新，请刷新页面重试");
  }
  try {
    const plain = privateDecrypt(
      {
        key: privateKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(encrypted, "base64"),
    ).toString("utf8");
    if (!plain) throw new Error("empty");
    return plain;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "invalid_encrypted_password", "无法解密密码，请刷新页面重试");
  }
}

function requiresEncryptedPassword(): boolean {
  const flag = process.env.AUTH_REQUIRE_ENCRYPTED_PASSWORD;
  if (flag === "1") return true;
  if (flag === "0") return false;
  // 生产 HTTPS 默认拒绝明文；本地 http 测试环境保留兼容。
  return process.env.NODE_ENV === "production"
    && PUBLIC_URL.startsWith("https://")
    && process.env.AUTH_E2E !== "1";
}

export function decryptPasswordField(
  plain: string | undefined,
  encrypted: string | undefined,
  keyId: string | undefined,
  label = "密码",
): string {
  if (encrypted) return decryptValue(encrypted, keyId);
  if (requiresEncryptedPassword()) {
    throw new HttpError(426, "encrypted_password_required", `${label}必须通过 HTTPS 加密提交`);
  }
  return typeof plain === "string" ? plain : "";
}
