/** 外部 OAuth2 登录服务端到端。需要 auth-center 已启动。 */
import { randomBytes } from "node:crypto";
import { startMockOAuth } from "./mock-oauth.mjs";

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

const mock = await startMockOAuth();
const suffix = randomBytes(4).toString("hex");

const admin = await json("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ username: "admin", password: ADMIN_PASSWORD }),
});
ok(admin.res.status === 200, "admin login");
const adminCookie = admin.cookie;

const created = await json("/api/admin/logins", {
  method: "POST", headers: { Cookie: adminCookie },
  body: JSON.stringify({
    name: `朋友登录 ${suffix}`,
    iconUrl: "https://example.com/friend.png",
    clientId: "friend-client",
    clientSecret: "friend-secret",
    authorizationUrl: `${mock.url}/authorize`,
    tokenUrl: `${mock.url}/token`,
    userinfoUrl: `${mock.url}/userinfo`,
    scopes: "openid profile email",
    enabled: true,
  }),
});
ok(created.res.status === 201, "create provider", created.body?.provider?.key);
const provider = created.body.provider;

const loginPage = await fetch(BASE + "/login");
const loginHtml = await loginPage.text();
ok(loginHtml.includes(provider.name) && loginHtml.includes("friend.png"),
  "login page shows provider + icon");

async function flow() {
  const start = await fetch(
    `${BASE}/api/oauth/start?provider=${encodeURIComponent(provider.key)}&next=%2Fdashboard`,
    { redirect: "manual" }
  );
  const stateCookie = cookieOf(start);
  const authorize = await fetch(start.headers.get("location"), { redirect: "manual" });
  const callbackUrl = authorize.headers.get("location");
  const callback = await fetch(callbackUrl, {
    headers: { Cookie: stateCookie }, redirect: "manual",
  });
  return { start, callback, cookie: cookieOf(callback), location: callback.headers.get("location") || "" };
}

const first = await flow();
ok(first.start.status >= 300 && first.start.status < 400, "start redirects to provider");
ok(first.callback.status === 303 && first.cookie.includes("ac_session"),
  "callback creates session", first.location);
const me = await json("/api/auth/me", { headers: { Cookie: first.cookie } });
ok(me.res.status === 200 && me.body?.user?.email === "friend@example.com",
  "provider user created/linked", me.body?.user?.email);
const firstUserId = me.body?.user?.id;

const second = await flow();
ok(second.callback.status === 303 && second.cookie.includes("ac_session"),
  "second login reuses provider link");
const me2 = await json("/api/auth/me", { headers: { Cookie: second.cookie } });
ok(me2.body?.user?.id === firstUserId, "same local user on repeat login");

mock.setProfile({
  sub: `friend-unverified-${suffix}`,
  email: `unverified-${suffix}@example.com`,
  email_verified: false,
  name: "Unverified",
});
const unverified = await flow();
ok(unverified.callback.status === 303
  && unverified.location.includes("/login?") && unverified.location.includes("error="),
  "unverified email rejected", unverified.location);
ok(!unverified.cookie.includes("ac_session"), "no session for unverified email");

const loginsPage = await fetch(BASE + "/dashboard/logins", {
  headers: { Cookie: adminCookie },
});
const loginsHtml = await loginsPage.text();
ok(loginsHtml.includes(`${BASE}/api/oauth/callback`), "admin page shows callback URL");
ok(loginsHtml.includes(provider.name), "admin page lists provider");

const deleted = await json(`/api/admin/logins/${provider.id}`, {
  method: "DELETE", headers: { Cookie: adminCookie },
});
ok(deleted.res.status === 200, "delete provider");

await mock.close();
console.log(failures === 0 ? "\nALL PROVIDER CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
