/** RSA-OAEP 密码信封加密。 */
import { constants, createPublicKey, publicEncrypt } from "node:crypto";

const BASE = process.env.AUTH_BASE_URL || "http://127.0.0.1:3100";
const ADMIN_PASSWORD = process.env.AUTH_ADMIN_PASSWORD || "admin1234";
let failures = 0;
function ok(condition, label, extra = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${extra ? ` · ${extra}` : ""}`);
  if (!condition) failures += 1;
}
function cookieOf(res) {
  return (res.headers.getSetCookie ? res.headers.getSetCookie() : [])
    .map((item) => item.split(";")[0]).join("; ");
}
async function json(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* ignore */ }
  return { res, body, text, cookie: cookieOf(res) };
}

const keyResponse = await json("/api/auth/password-key");
ok(keyResponse.res.status === 200 && keyResponse.body?.kid && keyResponse.body?.key,
  "password public key available");
const { kid, key } = keyResponse.body;
const publicKey = createPublicKey({ key, format: "jwk" });
const encrypt = (value) => publicEncrypt({
  key: publicKey,
  padding: constants.RSA_PKCS1_OAEP_PADDING,
  oaepHash: "sha256",
}, Buffer.from(value)).toString("base64");
const encrypted = encrypt(ADMIN_PASSWORD);

const login = await json("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({
    username: "admin", password_enc: encrypted, password_key: kid,
  }),
});
ok(login.res.status === 200 && login.body?.ok === true, "encrypted password login");
ok(!login.text.includes(ADMIN_PASSWORD), "response does not echo password");

const wrongKey = await json("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({
    username: "admin", password_enc: encrypted, password_key: "wrong-key",
  }),
});
ok(wrongKey.res.status === 409 && wrongKey.body?.error?.code === "password_key_rotated",
  "stale public key rejected");

const plaintext = await json("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ username: "admin", password: ADMIN_PASSWORD }),
});
ok(plaintext.res.status === 200, "plaintext API remains compatible by default");

const suffix = Date.now().toString(36);
const username = `enc_${suffix}`;
const oldPassword = "encrypted-old-123";
const newPassword = "encrypted-new-456";
const registered = await json("/api/auth/register", {
  method: "POST",
  body: JSON.stringify({
    username,
    email: `${username}@example.com`,
    password_enc: encrypt(oldPassword),
    password_key: kid,
  }),
});
ok(registered.res.status === 200, "encrypted registration");
const changed = await json("/api/settings/password", {
  method: "POST",
  headers: { Cookie: registered.cookie },
  body: JSON.stringify({
    currentPassword_enc: encrypt(oldPassword),
    newPassword_enc: encrypt(newPassword),
    password_key: kid,
  }),
});
ok(changed.res.status === 200, "encrypted password change");
const newLogin = await json("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({
    username, password_enc: encrypt(newPassword), password_key: kid,
  }),
});
ok(newLogin.res.status === 200, "login with encrypted new password");

console.log(failures === 0 ? "\nALL ENCRYPTED PASSWORD CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
