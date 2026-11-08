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
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* ignore */ }
  return { res, body, text, cookie: cookieOf(res) };
}

const { DatabaseSync } = await import("node:sqlite");
const db = new DatabaseSync(process.env.AUTH_DB_PATH || "data/auth.db");
const ip = "203.0.113.88";
const now = new Date().toISOString();
db.prepare("DELETE FROM risk_observations WHERE ip = ?").run(ip);
db.prepare(
  `INSERT INTO risk_observations(ts, ip, path, signals, score, reasons)
   VALUES (?, ?, '/login', '{}', 95, '["e2e high risk"]')`
).run(now, ip);

const admin = await json("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ username: "admin", password: process.env.AUTH_ADMIN_PASSWORD || "admin1234" }),
});
const clear = await json("/api/admin/risk/ip/clear", {
  method: "POST", headers: { Cookie: admin.cookie },
  body: JSON.stringify({ ip }),
});
ok(clear.res.status === 200, "admin clears IP risk");
const row = db.prepare("SELECT cleared_at FROM ip_risk_clears WHERE ip = ?").get(ip);
ok(Boolean(row?.cleared_at), "clear timestamp persisted");
const detail = await json(`/api/admin/risk/ip?ip=${encodeURIComponent(ip)}`, {
  headers: { Cookie: admin.cookie },
});
ok(detail.res.status === 200 && Number(detail.body?.observations?.[0]?.score) === 0,
  "cleared observation no longer counts as risk");

const userSuffix = Date.now().toString(36);
const normal = await json("/api/auth/register", {
  method: "POST",
  body: JSON.stringify({
    username: `ipclear_${userSuffix}`,
    email: `ipclear_${userSuffix}@example.com`,
    password: "ipclear-password-123",
  }),
});
const denied = await json("/api/admin/risk/ip/clear", {
  method: "POST", headers: { Cookie: normal.cookie },
  body: JSON.stringify({ ip }),
});
ok(denied.res.status === 403, "normal user cannot clear IP risk");

console.log(failures === 0 ? "\nALL IP RISK CLEAR CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
