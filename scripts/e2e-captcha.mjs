/** 登录失败后图形验证码端到端。 */
import { randomBytes } from "node:crypto";

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

const suffix = randomBytes(4).toString("hex");
const username = `captcha_${suffix}`;
const password = "captcha-password-123";
const registered = await json("/api/auth/register", {
  method: "POST",
  body: JSON.stringify({
    username, email: `${username}@example.com`, password,
  }),
});
ok(registered.res.status === 200, "create captcha test account");
await json("/api/auth/logout", { method: "POST", headers: { Cookie: registered.cookie } });

const firstFail = await json("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ username, password: "wrong-password" }),
});
ok(firstFail.res.status === 401 && firstFail.body?.captcha_required === true,
  "first password failure requires captcha on next login");

const noCaptcha = await json("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ username, password }),
});
ok(noCaptcha.res.status === 400 && noCaptcha.body?.captcha_required === true,
  "correct password without captcha rejected");

const captcha = await json("/api/auth/captcha?purpose=login");
ok(captcha.res.status === 200 && captcha.body?.ticket && captcha.body?.image,
  "captcha challenge issued");
ok(String(captcha.body?.image || "").startsWith("data:image/png;base64,"),
  "captcha image is a PNG data URI");
const png = Buffer.from(String(captcha.body?.image || "").split(",")[1] || "", "base64");
ok(png.readUInt32BE(16) === 360 && png.readUInt32BE(20) === 240,
  "captcha image is 360x240");
const answer = String(captcha.body.testAnswer || "");
ok(/^\d+,\d+$/.test(answer), "captcha exposes a test click point (test mode)", answer);
ok(typeof captcha.body.prompt === "string" && captcha.body.prompt.length > 0,
  "captcha includes a shape prompt", captcha.body.prompt);

const registerCaptcha = await json("/api/auth/captcha?purpose=register");
const mismatch = await json("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({
    username, password,
    captchaTicket: registerCaptcha.body?.ticket,
    captchaCode: String(registerCaptcha.body?.testAnswer || ""),
  }),
});
ok(mismatch.res.status === 400 && mismatch.body?.captcha_required === true,
  "captcha issued for another purpose is rejected");

const limited = await json("/api/auth/captcha?purpose=login");
const limitedAnswer = String(limited.body.testAnswer || "");
const wrongCode = "0,0";
for (let attempt = 1; attempt <= 5; attempt += 1) {
  const wrong = await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      username, password,
      captchaTicket: limited.body.ticket, captchaCode: wrongCode,
    }),
  });
  ok(wrong.res.status === 400 && wrong.body?.captcha_required === true,
    `wrong captcha rejected (attempt ${attempt}/5)`);
}
const afterLimit = await json("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({
    username, password,
    captchaTicket: limited.body.ticket, captchaCode: limitedAnswer,
  }),
});
ok(afterLimit.res.status === 400 && afterLimit.body?.captcha_required === true,
  "captcha ticket is burnt after 5 wrong attempts");

const fresh = await json("/api/auth/captcha?purpose=login");
const freshAnswer = String(fresh.body.testAnswer || "");
const login = await json("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({
    username, password,
    captchaTicket: fresh.body.ticket, captchaCode: freshAnswer,
  }),
});
ok(login.res.status === 200 && login.cookie.includes("ac_session"),
  "correct captcha + password creates session");
const me = await json("/api/auth/me", { headers: { Cookie: login.cookie } });
ok(me.body?.user?.username === username, "captcha login maps to local user");

const afterLogin = await json("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ username, password }),
});
ok(afterLogin.res.status === 200 && afterLogin.cookie.includes("ac_session"),
  "failure counter resets after successful login");

console.log(failures === 0 ? "\nALL CAPTCHA CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
