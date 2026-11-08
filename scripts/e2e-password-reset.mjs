const BASE = process.env.AUTH_BASE_URL || "http://127.0.0.1:3100";
let failures = 0;
function ok(condition, label, extra = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${extra ? ` · ${extra}` : ""}`);
  if (!condition) failures += 1;
}
async function json(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* ignore */ }
  return { res, body, text, cookie: (res.headers.getSetCookie?.() || []).map((x) => x.split(";")[0]).join("; ") };
}

const suffix = Date.now().toString(36);
const username = `reset_${suffix}`;
const oldPassword = "reset-old-password";
const newPassword = "reset-new-password";
const reg = await json("/api/auth/register", {
  method: "POST",
  body: JSON.stringify({ username, email: `${username}@example.com`, password: oldPassword }),
});
ok(reg.res.status === 200, "register reset user");

const unknown = await json("/api/auth/forgot-password", {
  method: "POST",
  body: JSON.stringify({ email: `nobody-${suffix}@example.com` }),
});
ok(unknown.res.status === 202 && !unknown.body?.testToken, "unknown email gets generic response");

const forgot = await json("/api/auth/forgot-password", {
  method: "POST",
  body: JSON.stringify({ email: `${username}@example.com` }),
});
ok(forgot.res.status === 202 && Boolean(forgot.body?.testToken), "forgot returns test token in e2e");
const token = forgot.body?.testToken || "";

const invalid = await json("/api/auth/reset-password", {
  method: "POST",
  body: JSON.stringify({ token: "invalid", password: newPassword }),
});
ok(invalid.res.status === 400, "invalid reset token rejected");

const reset = await json("/api/auth/reset-password", {
  method: "POST",
  body: JSON.stringify({ token, password: newPassword }),
});
ok(reset.res.status === 200, "reset password");
const replay = await json("/api/auth/reset-password", {
  method: "POST",
  body: JSON.stringify({ token, password: "another-password-123" }),
});
ok(replay.res.status === 400, "reset token is single-use");

const oldLogin = await json("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ username, password: oldPassword }),
});
ok(oldLogin.res.status === 401, "old password rejected");
const captcha = await json("/api/auth/captcha");
const newLogin = await json("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({
    username, password: newPassword,
    captchaTicket: captcha.body?.ticket || "",
    captchaCode: captcha.body?.testCode || "",
  }),
});
ok(newLogin.res.status === 200, "new password accepted");
const oldSession = await json("/api/auth/me", { headers: { Cookie: reg.cookie } });
ok(oldSession.res.status === 401, "old session revoked after reset");

const { DatabaseSync } = await import("node:sqlite");
const db = new DatabaseSync(process.env.AUTH_DB_PATH || "data/auth.db");
const risk = db.prepare("SELECT risk_score FROM users WHERE username = ?").get(username);
ok(Number(risk?.risk_score) >= 85, "password reset bumps account risk", String(risk?.risk_score));

console.log(failures === 0 ? "\nALL PASSWORD RESET CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
