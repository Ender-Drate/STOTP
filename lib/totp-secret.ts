import { decryptSecret, encryptSecret } from "./secret-box";

const PREFIX = "v1.";

export function isEncryptedTotpSecret(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptTotpSecret(secret: string): string {
  return encryptSecret(secret);
}

export function decryptTotpSecret(value: string): string {
  return isEncryptedTotpSecret(value) ? decryptSecret(value) : value;
}
