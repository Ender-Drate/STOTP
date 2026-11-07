/** 登录会话列表 / 撤销 / 退出其他设备。 */
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
const username = `sessions_${suffix}`;
const password = "sessions-password-123";
const registered = await json("/api/auth/register", {
  method: "POST",
  headers: { "User-Agent": "Session-A" },
  body: JSON.stringify({ username, email: `${username}@example.com`, password }),
});
ok(registered.res.status === 200, "register creates first session");
const first = registered.cookie;

const second = await json("/api/auth/login", {
  method: "POST",
  headers: { "User-Agent": "Session-B" },
  body: JSON.stringify({ username, password }),
});
ok(second.res.status === 200, "second login creates second session");

const list = await json("/api/settings/sessions", { headers: { Cookie: first } });
ok(list.res.status === 200 && list.body?.sessions?.length === 2,
  "two sessions listed", String(list.body?.sessions?.length));
ok(list.body.sessions.filter((item) => item.current).length === 1,
  "exactly one current session");

const other = list.body.sessions.find((item) => !item.current);
const revoked = await json(`/api/settings/sessions/${other.id}`, {
  method: "DELETE", headers: { Cookie: first },
});
ok(revoked.res.status === 200 && revoked.body?.current === false, "revoke other session");
const secondMe = await json("/api/auth/me", { headers: { Cookie: second.cookie } });
ok(secondMe.res.status === 401, "revoked session is invalid");
const firstMe = await json("/api/auth/me", { headers: { Cookie: first } });
ok(firstMe.res.status === 200, "current session remains valid");

const third = await json("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ username, password }),
});
const others = await json("/api/settings/sessions", {
  method: "DELETE", headers: { Cookie: first },
});
ok(others.res.status === 200 && others.body?.count >= 1, "revoke all other sessions");
const thirdMe = await json("/api/auth/me", { headers: { Cookie: third.cookie } });
ok(thirdMe.res.status === 401, "other session revoked by bulk action");
const still = await json("/api/auth/me", { headers: { Cookie: first } });
ok(still.res.status === 200, "bulk action keeps current session");

console.log(failures === 0 ? "\nALL SESSION CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
