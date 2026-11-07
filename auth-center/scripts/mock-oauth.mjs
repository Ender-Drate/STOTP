/** 测试用外部 OAuth2 登录服务。 */
import { createServer } from "node:http";

export function startMockOAuth(profile = {
  sub: "friend-1",
  email: "friend@example.com",
  email_verified: true,
  name: "Friend",
}) {
  let token = "mock-access-token";
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/authorize") {
      const redirect = url.searchParams.get("redirect_uri") || "";
      const state = url.searchParams.get("state") || "";
      const target = new URL(redirect);
      target.searchParams.set("code", "mock-code");
      target.searchParams.set("state", state);
      res.writeHead(302, { Location: target.toString() });
      res.end();
      return;
    }
    if (url.pathname === "/token" && req.method === "POST") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      if (form.get("code") !== "mock-code") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        access_token: token, token_type: "Bearer", expires_in: 3600,
      }));
      return;
    }
    if (url.pathname === "/userinfo") {
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_token" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(profile));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
        setProfile(next) { profile = next; },
      });
    });
  });
}
