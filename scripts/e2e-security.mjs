/** 安全审计回归：H-1、M-1、M-3、M-4、M-5。 */
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

const headers = await fetch(BASE + "/login");
const csp = headers.headers.get("content-security-policy") || "";
ok(headers.headers.get("x-frame-options") === "DENY", "X-Frame-Options DENY");
ok(headers.headers.get("x-content-type-options") === "nosniff", "nosniff");
ok(csp.includes("frame-ancestors 'none'"), "CSP frame-ancestors none");
ok(!headers.headers.get("x-powered-by"), "X-Powered-By removed");

const suffix = Date.now().toString(36);
const username = `sec_${suffix}`;
const password = "security-password-123";
const registered = await json("/api/auth/register", {
  method: "POST",
  body: JSON.stringify({ username, email: `${username}@example.com`, password }),
});
ok(registered.res.status === 200, "register security test user");

// H-1：伪造 CF/XFF 不应改变服务端看到的 IP（本地直连无 X-Real-IP）。
const spoofed = await json("/api/auth/login", {
  method: "POST",
  headers: {
    "CF-Connecting-IP": "8.8.4.4",
    "X-Forwarded-For": "8.8.4.4",
    "Forwarded": "for=8.8.4.4",
  },
  body: JSON.stringify({ username, password }),
});
ok(spoofed.res.status === 200, "login with spoofed proxy headers");
const sessions = await json("/api/settings/sessions", {
  headers: { Cookie: spoofed.cookie },
});
const current = sessions.body?.sessions?.find((item) => item.current);
ok(current && current.ip !== "8.8.4.4", "spoofed CF/XFF ignored", current?.ip);

// 兼容多层代理重复追加的 X-Real-IP，而不是把整个列表当成非法 IP 落到 127.0.0.1。
const commaHeader = await json("/api/auth/login", {
  method: "POST",
  headers: { "X-Real-IP": "112.9.40.76, 112.9.40.76" },
  body: JSON.stringify({ username, password }),
});
const commaSessions = await json("/api/settings/sessions", {
  headers: { Cookie: commaHeader.cookie },
});
const commaCurrent = commaSessions.body?.sessions?.find((item) => item.current);
ok(commaSessions.res.status === 200 && commaCurrent?.ip === "112.9.40.76",
  "comma-separated X-Real-IP is parsed", commaCurrent?.ip);

// M-1：反斜杠 next 不能跳出站外。
const openRedirect = await fetch(BASE + "/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    username, password, next: "/\\evil.example",
  }),
  redirect: "manual",
});
const location = openRedirect.headers.get("location") || "";
ok(openRedirect.status === 303 && !location.includes("evil.example"),
  "backslash next does not open redirect", location);
const encodedRedirect = await fetch(BASE + "/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    username, password, next: "/%5Cevil.example",
  }),
  redirect: "manual",
});
const encodedLocation = encodedRedirect.headers.get("location") || "";
ok(encodedRedirect.status === 303 && !encodedLocation.includes("evil.example"),
  "encoded backslash next does not open redirect", encodedLocation);

// OAuth 登录的 next 含有 redirect_uri（里面必然有 %2F），不能被误判为开放重定向。
const oauthNext = "/api/oauth/authorize?client_id=test&redirect_uri=https%3A%2F%2Fauth.builddreams.cn%2Fcallback&response_type=code&state=x";
const oauthRedirect = await fetch(BASE + "/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ username, password, next: oauthNext }),
  redirect: "manual",
});
const oauthLocation = oauthRedirect.headers.get("location") || "";
ok(oauthRedirect.status === 303 && oauthLocation.includes("/api/oauth/authorize?")
  && oauthLocation.includes("redirect_uri=https%3A%2F%2Fauth.builddreams.cn%2Fcallback"),
  "oauth next with encoded redirect_uri is preserved", oauthLocation);

// L-1：跨站 logout 被拒绝。
const csrfLogout = await fetch(BASE + "/api/auth/logout", {
  method: "POST",
  headers: { Origin: "https://evil.example", Cookie: spoofed.cookie },
});
ok(csrfLogout.status === 403, "cross-origin logout rejected");

// M-4：未登录客户端信号不能把任意 IP 刷成 critical。
const risk = await json("/api/risk/observe", {
  method: "POST",
  body: JSON.stringify({
    path: "/login",
    signals: { webdriver: true, headless: true },
  }),
});
ok(risk.res.status === 200 && risk.body?.score <= 55 && risk.body?.level !== "critical",
  "unauthenticated risk score is capped", JSON.stringify(risk.body));

// M-5：换 IP 仍按账号要求验证码。
const firstFail = await json("/api/auth/login", {
  method: "POST",
  headers: { "X-Real-IP": "100.64.0.1" },
  body: JSON.stringify({ username, password: "wrong-password" }),
});
ok(firstFail.res.status === 401 && firstFail.body?.captcha_required === true,
  "first failure asks for captcha");
const secondFail = await json("/api/auth/login", {
  method: "POST",
  headers: { "X-Real-IP": "100.64.0.2" },
  body: JSON.stringify({ username, password: "wrong-password" }),
});
ok(secondFail.res.status === 400 && secondFail.body?.error?.code === "captcha_required",
  "different IP still requires captcha for same account");

// L-3：CSV 公式注入转义。
const adminLogin = await json("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ username: "admin", password: ADMIN_PASSWORD }),
});
await json("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ username: '=HYPERLINK("http://evil","click")', password: "wrong-password" }),
});
const csv = await fetch(BASE + "/api/admin/audit/export", {
  headers: { Cookie: adminLogin.cookie },
});
const csvText = await csv.text();
ok(csv.status === 200 && !csvText.includes('"=HYPERLINK')
  && csvText.includes("'=HYPERLINK"), "CSV formula injection escaped");

const watch = await json("/api/admin/ip-rules", {
  method: "POST",
  headers: { Cookie: adminLogin.cookie },
  body: JSON.stringify({ ip: "203.0.113.77", action: "watch", reason: "e2e expiry" }),
});
ok(watch.res.status === 201 && Boolean(watch.body?.rule?.expires_at),
  "watch rule has automatic expiry", watch.body?.rule?.expires_at);
if (watch.body?.rule?.id) {
  await json(`/api/admin/ip-rules?id=${watch.body.rule.id}`, {
    method: "DELETE", headers: { Cookie: adminLogin.cookie },
  });
}

const detail = await fetch(BASE + "/api/admin/risk/ip?ip=127.0.0.1", {
  headers: { Cookie: adminLogin.cookie },
});
const detailBody = await detail.json().catch(() => null);
ok(detail.status === 200 && Array.isArray(detailBody?.observations),
  "IP detail API returns observations");
const deniedDetail = await fetch(BASE + "/api/admin/risk/ip?ip=127.0.0.1", {
  headers: { Cookie: spoofed.cookie },
});
ok(deniedDetail.status === 403, "normal user cannot read IP detail");

console.log(failures === 0 ? "\nALL SECURITY CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
