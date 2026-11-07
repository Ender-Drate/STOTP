/** 外部 OAuth2 登录服务端到端：首次登录必须绑定本地账户。 */
import { createHmac, randomBytes } from "node:crypto";
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

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(text) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of text.toUpperCase().replace(/[^A-Z2-7]/g, "")) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totp(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const pos = hmac[hmac.length - 1] & 0xf;
  const binary = ((hmac[pos] & 0x7f) << 24)
    | (hmac[pos + 1] << 16) | (hmac[pos + 2] << 8) | hmac[pos + 3];
  return String(binary % 1000000).padStart(6, "0");
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

const localUsername = `link_${suffix}`;
const localPassword = "link-password-123";
const local = await json("/api/auth/register", {
  method: "POST",
  body: JSON.stringify({
    username: localUsername, email: `${localUsername}@example.com`, password: localPassword,
  }),
});
ok(local.res.status === 200, "create local account", localUsername);
const localId = local.body?.user?.id;
await json("/api/auth/logout", { method: "POST", headers: { Cookie: local.cookie } });

const created = await json("/api/admin/logins", {
  method: "POST", headers: { Cookie: adminCookie },
  body: JSON.stringify({
    name: `第三方登录 ${suffix}`,
    iconUrl: "https://example.com/provider.png",
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
ok(loginHtml.includes(provider.name) && loginHtml.includes("provider.png"),
  "login page shows provider + icon");

async function flow() {
  const start = await fetch(
    `${BASE}/api/oauth/start?provider=${encodeURIComponent(provider.key)}&next=%2Fdashboard`,
    { redirect: "manual" }
  );
  const stateCookie = cookieOf(start);
  const authorize = await fetch(start.headers.get("location"), { redirect: "manual" });
  const callback = await fetch(authorize.headers.get("location"), {
    headers: { Cookie: stateCookie }, redirect: "manual",
  });
  return {
    start, callback, cookie: cookieOf(callback),
    location: callback.headers.get("location") || "",
  };
}

const first = await flow();
ok(first.callback.status === 303 && first.location.includes("/login/link"),
  "unbound provider account requires local binding", first.location);
ok(!first.cookie.includes("ac_session"), "no session before local binding");
const linkUrl = new URL(first.location);
const ticket = linkUrl.searchParams.get("ticket") || "";

const wrong = await json("/api/auth/link", {
  method: "POST",
  body: JSON.stringify({ ticket, username: localUsername, password: "wrong" }),
});
ok(wrong.res.status === 401, "wrong local password rejected");

const linked = await json("/api/auth/link", {
  method: "POST",
  body: JSON.stringify({ ticket, username: localUsername, password: localPassword }),
});
ok(linked.res.status === 200 && linked.cookie.includes("ac_session"),
  "local credentials bind provider account");
const me = await json("/api/auth/me", { headers: { Cookie: linked.cookie } });
ok(me.res.status === 200 && me.body?.user?.id === localId,
  "logged into bound local account", me.body?.user?.username);

const reused = await flow();
ok(reused.callback.status === 303 && reused.cookie.includes("ac_session"),
  "bound provider account logs in directly");
const me2 = await json("/api/auth/me", { headers: { Cookie: reused.cookie } });
ok(me2.body?.user?.id === localId, "same local user on repeat login");

const setup = await json("/api/settings/totp/setup", {
  method: "POST", headers: { Cookie: linked.cookie },
  body: JSON.stringify({ password: localPassword }),
});
const secret = setup.body?.secret;
const enabled = await json("/api/settings/totp/enable", {
  method: "POST", headers: { Cookie: linked.cookie },
  body: JSON.stringify({ password: localPassword, code: totp(secret) }),
});
ok(enabled.res.status === 200, "enable TOTP on bound local account");

const gated = await flow();
ok(gated.callback.status === 303 && gated.location.includes("/login/otp")
  && !gated.cookie.includes("ac_session"),
  "provider login cannot bypass TOTP", gated.location);
const gatedTicket = new URL(gated.location).searchParams.get("ticket") || "";
const gatedWrong = await json("/api/auth/login/otp", {
  method: "POST",
  body: JSON.stringify({ ticket: gatedTicket, code: "000000", next: "/dashboard" }),
});
ok(gatedWrong.res.status === 401, "provider TOTP wrong code rejected");
const gatedOtp = await json("/api/auth/login/otp", {
  method: "POST",
  body: JSON.stringify({ ticket: gatedTicket, code: totp(secret), next: "/dashboard" }),
});
ok(gatedOtp.res.status === 200 && gatedOtp.cookie.includes("ac_session"),
  "provider TOTP creates session");
const gatedMe = await json("/api/auth/me", { headers: { Cookie: gatedOtp.cookie } });
ok(gatedMe.body?.user?.id === localId, "provider TOTP session is local account");

const settingsPage = await fetch(BASE + "/dashboard/settings", {
  headers: { Cookie: linked.cookie },
});
const settingsHtml = await settingsPage.text();
ok(settingsHtml.includes("第三方登录绑定") && settingsHtml.includes(provider.name),
  "settings lists provider link");
const unlinked = await json(`/api/settings/links/${provider.id}`, {
  method: "DELETE", headers: { Cookie: linked.cookie },
});
ok(unlinked.res.status === 200, "unlink provider account");
const linkPage = await fetch(BASE + "/login/link?ticket=test&next=%2Fdashboard", {
  headers: { Cookie: linked.cookie },
});
const linkPageHtml = await linkPage.text();
ok(linkPage.status === 200 && linkPageHtml.includes("绑定本地账户"),
  "existing session does not bypass binding page");
const afterUnlink = await flow();
ok(afterUnlink.callback.status === 303 && afterUnlink.location.includes("/login/link")
  && !afterUnlink.cookie.includes("ac_session"), "unlinked identity requires binding again");

mock.setProfile({
  sub: `friend-other-${suffix}`,
  email: `other-${suffix}@example.com`,
  email_verified: false,
  name: "Other",
});
const other = await flow();
ok(other.callback.status === 303 && other.location.includes("/login/link")
  && !other.cookie.includes("ac_session"),
  "new provider identity still requires local binding");
const otherTicket = new URL(other.location).searchParams.get("ticket") || "";
const otherPage = await fetch(other.location, { headers: { Cookie: linked.cookie } });
const otherHtml = await otherPage.text();
ok(otherPage.status === 200 && otherHtml.includes("注册本地账户"),
  "binding page offers local registration");
const otherLink = await json("/api/auth/link", {
  method: "POST",
  body: JSON.stringify({
    ticket: otherTicket, username: localUsername, password: localPassword,
  }),
});
ok(otherLink.res.status === 200 && otherLink.body?.otp_required === true
  && !otherLink.cookie.includes("ac_session"),
  "binding a TOTP account moves to second step", otherLink.text.slice(0, 80));
const otherOtp = await json("/api/auth/link/otp", {
  method: "POST",
  body: JSON.stringify({ ticket: otherTicket, code: totp(secret), next: "/dashboard" }),
});
ok(otherOtp.res.status === 200 && otherOtp.cookie.includes("ac_session"),
  "binding TOTP completes and creates session");
const otherMe = await json("/api/auth/me", { headers: { Cookie: otherOtp.cookie } });
ok(otherMe.body?.user?.id === localId, "binding TOTP session maps to local account");

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
