/** 浏览器端密码信封加密，使用服务端 RSA-OAEP 公钥。 */

let cached: { kid: string; key: JsonWebKey } | null = null;

function base64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function publicKey(): Promise<{ kid: string; key: JsonWebKey }> {
  if (cached) return cached;
  const res = await fetch("/api/auth/password-key", { cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.kid || !data?.key) {
    throw new Error("无法获取密码加密公钥");
  }
  cached = { kid: data.kid, key: data.key };
  return cached;
}

export async function encryptPassword(password: string): Promise<{
  password_enc: string;
  password_key: string;
}> {
  if (!password) throw new Error("密码不能为空");
  if (!globalThis.crypto?.subtle) {
    throw new Error("当前浏览器不支持密码加密，请使用 HTTPS 访问");
  }
  const { kid, key } = await publicKey();
  const imported = await crypto.subtle.importKey(
    "jwk",
    key,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    imported,
    new TextEncoder().encode(password),
  );
  return { password_enc: base64(ciphertext), password_key: kid };
}

export async function encryptedPasswordPayload(password: string): Promise<Record<string, string>> {
  const encrypted = await encryptPassword(password);
  return encrypted;
}
