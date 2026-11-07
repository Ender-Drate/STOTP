import { randomBytes, createHash } from "node:crypto";

const BASE = process.env.AUTH_BASE_URL || "http://127.0.0.1:3100";
let failures = 0;

function ok(condition, label, extra = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${extra ? ` · ${extra}` : ""}`);
  if (!condition) failures += 1;
}

function cookieOf(res) {
  const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return list.map((item) => item.split(";")[0]).join("; ");
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
  return { res, body, text };
}

function form(values) {
  return new URLSearchParams(values).toString();
}

const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const state = randomBytes(8).toString("hex");
const nonce = randomBytes(8).toString("hex");
const suffix = randomBytes(4).toString("hex");
const username = `e2e_${suffix}`;
const password = "e2e-password-123";

const discovery = await json("/api/oauth/discovery");
ok(discovery.res.status === 200, "discovery 200", discovery.body?.issuer);
ok(discovery.body?.authorization_endpoint?.endsWith("/api/oauth/authorize"),
  "discovery authorize endpoint");

const reg = await json("/api/auth/register", {
  method: "POST",
  body: JSON.stringify({ username, email: `${username}@example.com`, password, displayName: "E2E" }),
});
ok(reg.res.status === 200, "register user", reg.body?.user?.username);
const userCookie = cookieOf(reg.res);
ok(userCookie.includes("ac_session"), "session cookie set");

const admin = await json("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ username: "admin", password: process.env.AUTH_ADMIN_PASSWORD || "admin1234" }),
});
ok(admin.res.status === 200, "admin login", admin.body?.user?.role);
const adminCookie = cookieOf(admin.res);

const app = await json("/api/admin/apps", {
  method: "POST",
  headers: { Cookie: adminCookie },
  body: JSON.stringify({
    name: "E2E App",
    description: "end-to-end",
    redirectUris: ["http://localhost:3100/callback"],
    scopes: ["openid", "profile", "email", "head", "permission", "offline_access"],
  }),
});
ok(app.res.status === 201, "create app", app.body?.client?.clientId);
const client = app.body?.client;
const secret = app.body?.clientSecret;
ok(Boolean(secret), "client secret returned once");

const authorizeQuery = form({
  response_type: "code",
  client_id: client.clientId,
  redirect_uri: "http://localhost:3100/callback",
  scope: "openid profile email head permission offline_access",
  state,
  nonce,
  code_challenge: challenge,
  code_challenge_method: "S256",
});

const consent = await fetch(`${BASE}/api/oauth/authorize?${authorizeQuery}`, {
  headers: { Cookie: userCookie }, redirect: "manual",
});
ok(consent.status === 303, "authorize redirects to consent",
  consent.headers.get("location")?.split("?")[0]);
const consentLocation = consent.headers.get("location") || "";

const approve = await fetch(BASE + "/api/oauth/authorize", {
  method: "POST",
  headers: {
    Cookie: userCookie,
    "Content-Type": "application/x-www-form-urlencoded",
    Origin: BASE,
  },
  body: form({
    response_type: "code",
    client_id: client.clientId,
    redirect_uri: "http://localhost:3100/callback",
    scope: "openid profile email head permission offline_access",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    decision: "allow",
  }),
  redirect: "manual",
});
ok(approve.status === 303, "consent approve redirects");
const callback = new URL(approve.headers.get("location") || "");
const code = callback.searchParams.get("code");
ok(Boolean(code), "authorization code returned", callback.searchParams.get("state") === state ? "state ok" : "state mismatch");

const tokenRes = await fetch(BASE + "/api/oauth/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: form({
    grant_type: "authorization_code",
    code,
    redirect_uri: "http://localhost:3100/callback",
    client_id: client.clientId,
    client_secret: secret,
    code_verifier: verifier,
  }),
});
const tokens = await tokenRes.json();
ok(tokenRes.status === 200 && Boolean(tokens.access_token), "token exchange",
  tokens.token_type);
ok(Boolean(tokens.id_token), "id_token issued");
const idPayload = JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url"));
ok(idPayload.nonce === nonce, "id_token carries nonce");
ok(Boolean(tokens.refresh_token), "refresh_token issued (offline_access)");

const userinfo = await fetch(BASE + "/api/oauth/userinfo", {
  headers: { Authorization: `Bearer ${tokens.access_token}` },
});
const profile = await userinfo.json();
ok(userinfo.status === 200, "userinfo 200");
ok(profile.username === username, "userinfo username", profile.username);
ok(profile.email === `${username}@example.com`, "userinfo email");
ok(Array.isArray(profile.permissions), "userinfo permissions");

const refreshRes = await fetch(BASE + "/api/oauth/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: form({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
    client_id: client.clientId,
    client_secret: secret,
  }),
});
const refreshed = await refreshRes.json();
ok(refreshRes.status === 200 && refreshed.access_token !== tokens.access_token,
  "refresh rotates access token");

const revokeRes = await fetch(BASE + "/api/oauth/revoke", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: form({
    token: refreshed.access_token,
    client_id: client.clientId,
    client_secret: secret,
  }),
});
ok(revokeRes.status === 200, "revoke 200");

const afterRevoke = await fetch(BASE + "/api/oauth/userinfo", {
  headers: { Authorization: `Bearer ${refreshed.access_token}` },
});
ok(afterRevoke.status === 401, "revoked access token rejected");

const consents = await json("/api/consents", { headers: { Cookie: userCookie } });
ok(consents.body?.consents?.some((item) => item.clientId === client.clientId),
  "consent listed");

const publicApp = await json("/api/admin/apps", {
  method: "POST",
  headers: { Cookie: adminCookie },
  body: JSON.stringify({
    name: "E2E Public",
    redirectUris: ["http://localhost:3100/public-callback"],
    scopes: ["openid", "profile"],
    isPublic: true,
  }),
});
ok(publicApp.res.status === 201 && !publicApp.body?.clientSecret, "public client has no secret");

const publicClient = publicApp.body.client;
const publicVerifier = randomBytes(32).toString("base64url");
const publicChallenge = createHash("sha256").update(publicVerifier).digest("base64url");
const publicAuthorize = await fetch(
  `${BASE}/api/oauth/authorize?` + form({
    response_type: "code",
    client_id: publicClient.clientId,
    redirect_uri: "http://localhost:3100/public-callback",
    scope: "openid profile",
    code_challenge: publicChallenge,
    code_challenge_method: "S256",
  }),
  { headers: { Cookie: userCookie }, redirect: "manual" }
);
ok(publicAuthorize.status === 303, "public client authorize");

const publicApprove = await fetch(BASE + "/api/oauth/authorize", {
  method: "POST",
  headers: {
    Cookie: userCookie,
    "Content-Type": "application/x-www-form-urlencoded",
    Origin: BASE,
  },
  body: form({
    response_type: "code",
    client_id: publicClient.clientId,
    redirect_uri: "http://localhost:3100/public-callback",
    scope: "openid profile",
    code_challenge: publicChallenge,
    code_challenge_method: "S256",
    decision: "allow",
  }),
  redirect: "manual",
});
const publicCode = new URL(publicApprove.headers.get("location") || "").searchParams.get("code");
const publicToken = await fetch(BASE + "/api/oauth/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: form({
    grant_type: "authorization_code",
    code: publicCode,
    redirect_uri: "http://localhost:3100/public-callback",
    client_id: publicClient.clientId,
    code_verifier: publicVerifier,
  }),
});
const publicTokens = await publicToken.json();
ok(publicToken.status === 200 && Boolean(publicTokens.access_token),
  "public client PKCE token exchange");
const publicProfile = await fetch(BASE + "/api/oauth/userinfo", {
  headers: { Authorization: `Bearer ${publicTokens.access_token}` },
}).then((r) => r.json());
ok(publicProfile.email === undefined, "userinfo hides email without email scope");

const jwks = await json("/api/oauth/jwks");
ok(jwks.res.status === 200 && jwks.body?.keys?.[0]?.kty === "RSA", "JWKS RS256 key");

const deleted = await fetch(`${BASE}/api/admin/apps/${publicClient.id}`, {
  method: "DELETE", headers: { Cookie: adminCookie, Origin: BASE },
});
ok(deleted.status === 200, "delete app");

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
