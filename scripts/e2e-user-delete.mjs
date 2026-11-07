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

const suffix = Date.now().toString(36);
const password = "delete-password-123";
const normalName = `del_normal_${suffix}`;
const targetName = `del_target_${suffix}`;
const normal = await json("/api/auth/register", {
  method: "POST",
  body: JSON.stringify({ username: normalName, email: `${normalName}@example.com`, password }),
});
ok(normal.res.status === 200, "create normal user");
const target = await json("/api/auth/register", {
  method: "POST",
  body: JSON.stringify({ username: targetName, email: `${targetName}@example.com`, password }),
});
ok(target.res.status === 200, "create delete target");
const targetId = target.body?.user?.id;

const denied = await json(`/api/admin/users/${targetId}`, {
  method: "DELETE", headers: { Cookie: normal.cookie },
});
ok(denied.res.status === 403, "non-superadmin cannot delete users");

const admin = await json("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ username: "admin", password: ADMIN_PASSWORD }),
});
ok(admin.res.status === 200, "admin login");
const self = await json(`/api/admin/users/${admin.body?.user?.id}`, {
  method: "DELETE", headers: { Cookie: admin.cookie },
});
ok(self.res.status === 400, "cannot delete self");

const deleted = await json(`/api/admin/users/${targetId}`, {
  method: "DELETE", headers: { Cookie: admin.cookie },
});
ok(deleted.res.status === 200, "superadmin deletes user");
const loginAfter = await json("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ username: targetName, password }),
});
ok(loginAfter.res.status === 401, "deleted user cannot login");

console.log(failures === 0 ? "\nALL USER DELETE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
