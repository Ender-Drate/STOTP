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

const captcha = await json("/api/auth/captcha");
ok(captcha.res.status === 200 && captcha.body?.ticket && captcha.body?.image,
  "captcha challenge issued");
const code = String(captcha.body.testCode || "");
ok(/^[A-Z2-9]{4}$/.test(code), "captcha contains 4 characters (test mode)", code);

const wrongCaptcha = await json("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({
    username, password, captchaTicket: captcha.body.ticket, captchaCode: "ZZZZ",
  }),
});
ok(wrongCaptcha.res.status === 400 && wrongCaptcha.body?.captcha_required === true,
  "wrong captcha rejected");

const fresh = await json("/api/auth/captcha");
const freshCode = String(fresh.body.testCode || "");
const login = await json("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({
    username, password,
    captchaTicket: fresh.body.ticket, captchaCode: freshCode,
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
