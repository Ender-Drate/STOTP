import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import path from "node:path";
import { readKeyFile, writeKeyFile } from "./db";
import { PUBLIC_URL } from "./config";

interface KeyMaterial {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  publicJwk: Record<string, unknown>;
}

const globalForKeys = globalThis as unknown as { __authCenterKeys?: KeyMaterial };

interface StoredKeys {
  kid: string;
  privateJwk: Record<string, unknown>;
  publicJwk: Record<string, unknown>;
}

function keysPath(): string {
  const dataDir = process.env.AUTH_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dataDir, "oidc-keys.json");
}

function loadKeys(): KeyMaterial {
  if (globalForKeys.__authCenterKeys) return globalForKeys.__authCenterKeys;

  const file = keysPath();
  const raw = readKeyFile(file);
  let stored: StoredKeys;
  if (raw) {
    stored = JSON.parse(raw) as StoredKeys;
  } else {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateJwk = privateKey.export({ format: "jwk" }) as Record<string, unknown>;
    const publicJwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
    const kid = createHash("sha256")
      .update(`${String(publicJwk.e)}.${String(publicJwk.n)}`)
      .digest("base64url")
      .slice(0, 16);
    stored = { kid, privateJwk, publicJwk };
    writeKeyFile(file, JSON.stringify(stored));
  }

  const material: KeyMaterial = {
    kid: stored.kid,
    privateKey: createPrivateKey({ key: stored.privateJwk as never, format: "jwk" }),
    publicKey: createPublicKey({ key: stored.publicJwk as never, format: "jwk" }),
    publicJwk: stored.publicJwk,
  };
  globalForKeys.__authCenterKeys = material;
  return material;
}

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function signJwt(claims: Record<string, unknown>): string {
  const { kid, privateKey } = loadKeys();
  const header = { alg: "RS256", typ: "JWT", kid };
  const input = `${b64urlJson(header)}.${b64urlJson(claims)}`;
  const signature = sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url");
  return `${input}.${signature}`;
}

export function verifyJwt(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
  if (header.alg !== "RS256") throw new Error("unsupported alg");
  const { publicKey } = loadKeys();
  const valid = verify(
    "RSA-SHA256",
    Buffer.from(`${headerB64}.${payloadB64}`),
    publicKey,
    Buffer.from(signatureB64, "base64url")
  );
  if (!valid) throw new Error("bad signature");
  const claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === "number" && now > claims.exp + 30) throw new Error("expired");
  return claims as Record<string, unknown>;
}

export function jwks(): { keys: Array<Record<string, unknown>> } {
  const { kid, publicJwk } = loadKeys();
  return {
    keys: [{ ...publicJwk, kid, alg: "RS256", use: "sig" }],
  };
}

export function issuer(): string {
  return PUBLIC_URL;
}
