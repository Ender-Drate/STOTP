/**
 * 测试用 STOTP mock：实现登录站需要的 /oauth/token 与 /v1/login/verify。
 * 只用于本地 e2e，不参与生产。
 */
import { createHmac, hkdfSync, randomBytes } from "node:crypto";
import { createServer } from "node:http";

export const MOCK_CLIENT_ID = "11111111-1111-4111-8111-111111111111";
export const MOCK_ACCOUNT_ID = "acc_mock_0001";

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function signAssertion({
  secret, loginClientId, clientId, result, reason, aud = loginClientId, expOffset = 120,
}) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: "stotp",
    aud,
    sub: MOCK_ACCOUNT_ID,
    result,
    reason,
    client_id: clientId,
    epoch: Math.floor(now / 3600),
    iat: now,
    exp: now + expOffset,
    jti: randomBytes(8).toString("hex"),
    pad: "0".repeat(120),
  }));
  const key = Buffer.from(hkdfSync(
    "sha256",
    Buffer.from(secret, "utf8"),
    Buffer.from(loginClientId, "utf8"),
    Buffer.from("stotp/assertion/v1", "utf8"),
    32
  ));
  const signature = createHmac("sha256", key).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export function startMock({
  loginClientId = "srv_mock",
  loginClientSecret = "cs_mock_secret",
  allowCode = "123456",
  denyCode = "000000",
  tamperCode = "999999",
  audCode = "888888",
  expiredCode = "777777",
  port = 0,
} = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "POST" && url.pathname === "/oauth/token") {
      const form = new URLSearchParams(await readBody(req));
      if (form.get("client_id") !== loginClientId
        || form.get("client_secret") !== loginClientSecret) {
        return sendJson(res, 401, { error: "invalid_client" });
      }
      return sendJson(res, 200, {
        access_token: "mock-access-token",
        token_type: "Bearer",
        expires_in: 900,
        scope: "stotp.verify",
      });
    }
    if (req.method === "POST" && url.pathname === "/v1/login/verify") {
      const auth = req.headers.authorization || "";
      if (auth !== "Bearer mock-access-token") {
        return sendJson(res, 401, { error: "invalid_token" });
      }
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch { /* ignore */ }
      const clientId = String(body.client_id || "");
      const code = String(body.code || "");
      let result = "deny";
      let reason = "unknown_client";
      let aud = loginClientId;
      let expOffset = 120;
      if (clientId === MOCK_CLIENT_ID) {
        if (code === allowCode) { result = "allow"; reason = "ok"; }
        else if (code === denyCode) { result = "deny"; reason = "code_invalid"; }
        else if (code === tamperCode) { result = "allow"; reason = "ok"; }
        else if (code === audCode) { result = "allow"; reason = "ok"; aud = "srv_wrong"; }
        else if (code === expiredCode) { result = "allow"; reason = "ok"; expOffset = -600; }
        else { result = "deny"; reason = "code_invalid"; }
      }
      const signatureSecret = code === tamperCode ? "wrong-secret" : loginClientSecret;
      const assertion = signAssertion({
        secret: signatureSecret,
        loginClientId,
        clientId: clientId || MOCK_CLIENT_ID,
        result,
        reason,
        aud,
        expOffset,
      });
      return sendJson(res, 200, { v: 1, mode: "assertion", assertion, pad: "" });
    }
    if (url.pathname === "/healthz") return sendJson(res, 200, { ok: true });
    sendJson(res, 404, { error: "not_found" });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const actual = server.address().port;
      resolve({
        server,
        port: actual,
        url: `http://127.0.0.1:${actual}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

if (process.argv[1] && process.argv[1].endsWith("mock-stotp.mjs")) {
  const mock = await startMock({ port: Number(process.env.MOCK_PORT || 8899) });
  console.log(`mock STOTP listening on ${mock.url}`);
}
