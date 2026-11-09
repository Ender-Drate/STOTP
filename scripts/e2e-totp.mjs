/** TOTP 端到端：需要 auth-center 已启动。 */
import path from "node:path";
import { createHmac, randomBytes } from "node:crypto";

const BASE = process.env.AUTH_BASE_URL || "http://127.0.0.1:3100";
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
    redirect: "manual",
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* ignore */ }
  return { res, body, text, cookie: cookieOf(res) };
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(text) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of text.toUpperCase().replace(/[^A-Z2-7]/g, "")) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totp(secret, offset = 0) {
  const counter = Math.floor(Date.now() / 1000 / 30) + offset;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const pos = hmac[hmac.length - 1] & 0xf;
  const binary = ((hmac[pos] & 0x7f) << 24)
    | (hmac[pos + 1] << 16) | (hmac[pos + 2] << 8) | hmac[pos + 3];
  return String(binary % 1000000).padStart(6, "0");
}

const suffix = randomBytes(4).toString("hex");
const username = `totp_${suffix}`;
const password = "totp-password-123";

const reg = await json("/api/auth/register", {
  method: "POST",
  body: JSON.stringify({ username, email: `${username}@example.com`, password }),
});
ok(reg.res.status === 200, "register user");
const cookie = reg.cookie;

const setup = await json("/api/settings/totp/setup", {
  method: "POST", headers: { Cookie: cookie },
  body: JSON.stringify({ password }),
});
ok(setup.res.status === 200 && setup.body?.secret && setup.body?.qr?.startsWith("data:image/"),
  "TOTP setup returns secret + QR");
const secret = setup.body.secret;

const badEnable = await json("/api/settings/totp/enable", {
  method: "POST", headers: { Cookie: cookie },
  body: JSON.stringify({ password, code: "000000" }),
});
ok(badEnable.res.status === 400, "wrong code cannot enable TOTP");

const enable = await json("/api/settings/totp/enable", {
  method: "POST", headers: { Cookie: cookie },
  body: JSON.stringify({ password, code: totp(secret) }),
});
ok(enable.res.status === 200, "enable TOTP");

await json("/api/auth/logout", {
  method: "POST", headers: { Cookie: cookie, Origin: BASE },
});
const step1 = await json("/api/auth/login", {
  method: "POST", body: JSON.stringify({ username, password }),
});
ok(step1.res.status === 200 && step1.body?.otp_required === true
  && step1.body?.method === "totp", "TOTP required after password");
ok(!step1.cookie.includes("ac_session"), "no session before TOTP");
const ticket = step1.body?.ticket;

const badOtp = await json("/api/auth/login/otp", {
  method: "POST",
  body: JSON.stringify({ ticket, code: "000000", next: "/dashboard" }),
});
ok(badOtp.res.status === 401, "wrong TOTP rejected");
const goodOtp = await json("/api/auth/login/otp", {
  method: "POST",
  body: JSON.stringify({ ticket, code: totp(secret, 1), next: "/dashboard" }),
});
ok(goodOtp.res.status === 200 && goodOtp.cookie.includes("ac_session"),
  "correct TOTP creates session");
const me = await json("/api/auth/me", { headers: { Cookie: goodOtp.cookie } });
ok(me.res.status === 200 && me.body?.user?.username === username, "session valid");

const { DatabaseSync } = await import("node:sqlite");
const db = new DatabaseSync(process.env.AUTH_DB_PATH || path.join(process.env.AUTH_DATA_DIR || "data", "auth.db"));
const storedSecret = db.prepare("SELECT totp_secret FROM users WHERE username = ?").get(username);
ok(String(storedSecret?.totp_secret || "").startsWith("v1."), "TOTP secret encrypted at rest");

const replayLogin = await json("/api/auth/login", {
  method: "POST", body: JSON.stringify({ username, password }),
});
const replayCode = await json("/api/auth/login/otp", {
  method: "POST",
  body: JSON.stringify({ ticket: replayLogin.body?.ticket, code: totp(secret, 1), next: "/dashboard" }),
});
ok(replayCode.res.status === 401, "same TOTP timestep cannot be replayed");
const replay = await json("/api/auth/login/otp", {
  method: "POST",
  body: JSON.stringify({ ticket, code: totp(secret), next: "/dashboard" }),
});
ok(replay.res.status === 401, "TOTP ticket is single-use");

const badDisable = await json("/api/settings/totp/disable", {
  method: "POST", headers: { Cookie: goodOtp.cookie },
  body: JSON.stringify({ password: "wrong", code: totp(secret, -1) }),
});
ok(badDisable.res.status === 400, "disable requires password");
const disable = await json("/api/settings/totp/disable", {
  method: "POST", headers: { Cookie: goodOtp.cookie },
  body: JSON.stringify({ password, code: totp(secret, -1) }),
});
ok(disable.res.status === 200, "disable TOTP");
await json("/api/auth/logout", {
  method: "POST", headers: { Cookie: goodOtp.cookie, Origin: BASE },
});
const plain = await json("/api/auth/login", {
  method: "POST", body: JSON.stringify({ username, password }),
});
ok(plain.res.status === 200 && !plain.body?.otp_required, "password-only after disable");

console.log(failures === 0 ? "\nALL TOTP CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
