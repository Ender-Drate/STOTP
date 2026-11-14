/** 登录失败后图形验证码端到端。 */
import { randomBytes } from "node:crypto";
import { fetchCaptcha, solveFromDb } from "./captcha-test-helper.mjs";

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

const captcha = await fetchCaptcha(BASE, "login");
ok(captcha.res.status === 200 && Boolean(captcha.body?.image),
  "captcha challenge issued");
ok(Object.keys(captcha.body || {}).join(",") === "image",
  "captcha response contains only the image", Object.keys(captcha.body || {}).join(","));
ok(String(captcha.body?.image || "").startsWith("data:image/png;base64,"),
  "captcha image is a PNG data URI");
const png = Buffer.from(String(captcha.body?.image || "").split(",")[1] || "", "base64");
ok(png.readUInt32BE(16) === 420 && png.readUInt32BE(20) === 344,
  "captcha image is 420x344");
ok(captcha.cookie.startsWith("ac_captcha=") && captcha.httpOnly,
  "captcha token is set as an HttpOnly cookie");

const registerCaptcha = await fetchCaptcha(BASE, "register");
const mismatch = await json("/api/auth/login", {
  method: "POST",
  headers: { Cookie: registerCaptcha.cookie },
  body: JSON.stringify({
    username, password,
    captchaCode: solveFromDb(registerCaptcha.cookie),
  }),
});
ok(mismatch.res.status === 400 && mismatch.body?.captcha_required === true,
  "captcha issued for another purpose is rejected");

const limited = await fetchCaptcha(BASE, "login");
const limitedAnswer = solveFromDb(limited.cookie);
const wrongCode = "0,0";
for (let attempt = 1; attempt <= 5; attempt += 1) {
  const wrong = await json("/api/auth/login", {
    method: "POST",
    headers: { Cookie: limited.cookie },
    body: JSON.stringify({
      username, password, captchaCode: wrongCode,
    }),
  });
  ok(wrong.res.status === 400 && wrong.body?.captcha_required === true,
    `wrong captcha rejected (attempt ${attempt}/5)`);
}
const afterLimit = await json("/api/auth/login", {
  method: "POST",
  headers: { Cookie: limited.cookie },
  body: JSON.stringify({
    username, password, captchaCode: limitedAnswer,
  }),
});
ok(afterLimit.res.status === 400 && afterLimit.body?.captcha_required === true,
  "captcha ticket is burnt after 5 wrong attempts");

const fresh = await fetchCaptcha(BASE, "login");
const freshAnswer = solveFromDb(fresh.cookie);
const login = await json("/api/auth/login", {
  method: "POST",
  headers: { Cookie: fresh.cookie },
  body: JSON.stringify({
    username, password, captchaCode: freshAnswer,
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
