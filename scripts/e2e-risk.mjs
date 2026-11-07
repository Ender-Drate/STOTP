/** 统计信息与风险控制端到端。 */
import { randomBytes } from "node:crypto";

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
    redirect: "manual",
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* ignore */ }
  return { res, body, text, cookie: cookieOf(res) };
}

const admin = await json("/api/auth/login", {
  method: "POST",
  headers: {
    "X-Real-IP": "203.0.113.10",
    "X-Forwarded-For": "203.0.113.10, 127.0.0.1",
  },
  body: JSON.stringify({ username: "admin", password: ADMIN_PASSWORD }),
});
ok(admin.res.status === 200, "admin login through trusted proxy");

const proxiedRisk = await fetch(BASE + "/dashboard/risk", {
  headers: { Cookie: admin.cookie },
});
const proxiedHtml = await proxiedRisk.text();
ok(proxiedHtml.includes("203.0.113.10"), "audit stores X-Real-IP instead of 127.0.0.1");

const rule = await json("/api/admin/ip-rules", {
  method: "POST", headers: { Cookie: admin.cookie },
  body: JSON.stringify({ ip: "203.0.113.99", action: "block", reason: "e2e" }),
});
ok(rule.res.status === 201 && rule.body?.rule?.action === "block", "create IP block rule");
const blockedLogin = await json("/api/auth/login", {
  method: "POST",
  headers: { "X-Real-IP": "203.0.113.99" },
  body: JSON.stringify({ username: "admin", password: ADMIN_PASSWORD }),
});
ok(blockedLogin.res.status === 403 && blockedLogin.body?.error?.code === "ip_blocked",
  "blocked IP cannot login");
const removed = await json(`/api/admin/ip-rules?id=${rule.body.rule.id}`, {
  method: "DELETE", headers: { Cookie: admin.cookie },
});
ok(removed.res.status === 200, "delete IP block rule");

const stats = await fetch(BASE + "/dashboard/stats", { headers: { Cookie: admin.cookie } });
const statsHtml = await stats.text();
ok(stats.status === 200 && statsHtml.includes("统计信息") && statsHtml.includes("CPU 使用率"),
  "stats page renders host metrics");

const observed = await json("/api/risk/observe", {
  method: "POST",
  headers: {
    "X-Real-IP": "112.9.40.76",
    "User-Agent": "Mozilla/5.0 RiskTest",
    "X-TLS-Fingerprint": "t13d1513_test_fingerprint",
  },
  body: JSON.stringify({
    path: "/risk-test",
    signals: {
      languages: ["zh-CN"], timezone: "Asia/Shanghai",
      screen: { width: 1920, height: 1080, colorDepth: 24 },
      hardwareConcurrency: 8, plugins: 3, platform: "Win32",
      webglRenderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER)",
    },
  }),
});
ok(observed.res.status === 200, "risk observation accepted");

const risk = await fetch(BASE + "/dashboard/risk", { headers: { Cookie: admin.cookie } });
const riskHtml = await risk.text();
ok(risk.status === 200 && riskHtml.includes("风险控制") && riskHtml.includes("最近审计"),
  "risk page renders audit");
ok(riskHtml.includes("112.9.40.76") && riskHtml.includes("山东省青岛市"),
  "72h IP table resolves Chinese location");
ok(riskHtml.includes("最近访问观测") && riskHtml.includes("1660 SUPER"),
  "environment observations visible");
ok(riskHtml.includes("t13d1513_test_fingerprint"), "TLS fingerprint header recorded");

const exported = await fetch(BASE + "/api/admin/audit/export", {
  headers: { Cookie: admin.cookie },
});
ok(exported.status === 200 && (exported.headers.get("content-type") || "").includes("text/csv"),
  "audit CSV export");

const patched = await json("/api/admin/risk", {
  method: "PATCH", headers: { Cookie: admin.cookie },
  body: JSON.stringify({
    captchaAfterFailures: 2,
    loginFailWindowSeconds: 600,
    riskHighThreshold: 65,
    riskCriticalThreshold: 90,
    auditRetentionDays: 30,
  }),
});
ok(patched.res.status === 200 && patched.body?.settings?.captchaAfterFailures === 2,
  "superadmin can change risk settings");

const reset = await json("/api/admin/risk", {
  method: "PATCH", headers: { Cookie: admin.cookie },
  body: JSON.stringify({
    captchaAfterFailures: 1,
    loginFailWindowSeconds: 900,
    riskHighThreshold: 70,
    riskCriticalThreshold: 90,
    auditRetentionDays: 30,
  }),
});
ok(reset.res.status === 200 && reset.body?.settings?.captchaAfterFailures === 1,
  "risk settings reset");

const suffix = randomBytes(4).toString("hex");
const normal = await json("/api/auth/register", {
  method: "POST",
  body: JSON.stringify({
    username: `risk_${suffix}`,
    email: `risk_${suffix}@example.com`,
    password: "risk-password-123",
  }),
});
ok(normal.res.status === 200, "create normal user");
const forbidden = await json("/api/admin/risk", {
  method: "PATCH", headers: { Cookie: normal.cookie },
  body: JSON.stringify({ captchaAfterFailures: 3 }),
});
ok(forbidden.res.status === 403, "normal user cannot change risk settings");

console.log(failures === 0 ? "\nALL RISK CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
