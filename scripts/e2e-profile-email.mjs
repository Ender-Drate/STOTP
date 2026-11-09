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

const suffix = Date.now().toString(36);
const username = `email_${suffix}`;
const oldEmail = `${username}@example.com`;
const newEmail = `${username}+new@example.com`;
const password = "email-change-password-123";
const registered = await json("/api/auth/register", {
  method: "POST",
  body: JSON.stringify({ username, email: oldEmail, password }),
});
ok(registered.res.status === 200, "register email-change user");

const allowedAvatar = await json("/api/settings/profile", {
  method: "PATCH",
  headers: { Cookie: registered.cookie },
  body: JSON.stringify({ avatarUrl: "https://auth.builddreams.cn/avatars/test.png" }),
});
ok(allowedAvatar.res.status === 200
  && allowedAvatar.body?.user?.avatarUrl === "https://auth.builddreams.cn/avatars/test.png",
  "auth.builddreams.cn avatar path allowed");
const blockedAvatar = await json("/api/settings/profile", {
  method: "PATCH",
  headers: { Cookie: registered.cookie },
  body: JSON.stringify({ avatarUrl: "https://evil.example/avatars/test.png" }),
});
ok(blockedAvatar.res.status === 400, "foreign avatar origin rejected");

const withoutPassword = await json("/api/settings/profile", {
  method: "PATCH",
  headers: { Cookie: registered.cookie },
  body: JSON.stringify({ email: newEmail }),
});
ok(withoutPassword.res.status === 400, "email change requires current password");

const changed = await json("/api/settings/profile", {
  method: "PATCH",
  headers: { Cookie: registered.cookie },
  body: JSON.stringify({ email: newEmail, currentPassword: password }),
});
ok(changed.res.status === 200 && changed.body?.logout === true,
  "email change with password succeeds and revokes sessions");
const oldSession = await json("/api/auth/me", { headers: { Cookie: registered.cookie } });
ok(oldSession.res.status === 401, "old session invalid after email change");

const oldLogin = await json("/api/auth/login", {
  method: "POST", body: JSON.stringify({ username: oldEmail, password }),
});
ok(oldLogin.res.status === 401, "old email no longer logs in");
const newLogin = await json("/api/auth/login", {
  method: "POST", body: JSON.stringify({ username: newEmail, password }),
});
ok(newLogin.res.status === 200, "new email logs in");

console.log(failures === 0 ? "\nALL PROFILE EMAIL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
