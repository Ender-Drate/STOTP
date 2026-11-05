import Link from "next/link";

export const dynamic = "force-dynamic";

const scopes: Array<[string, string]> = [
  ["openid", "唯一标识 sub，返回 id_token"],
  ["profile", "用户名、昵称"],
  ["email", "邮箱与 email_verified"],
  ["head", "头像 URL（picture）"],
  ["permission", "账号权限节点数组"],
  ["offline_access", "签发 refresh_token"],
];

export default function DocsPage() {
  return (
    <div className="docs">
      <div className="page-head">
        <div>
          <h1 className="page-title">接入文档</h1>
          <p className="page-desc">用标准 OAuth2 / OpenID Connect 接入 STOTP 账户</p>
        </div>
        <Link className="btn btn-ghost" href="/dashboard">返回控制台</Link>
      </div>

      <div className="card card-pad">
        <h2 style={{ marginTop: 0 }}>快速开始</h2>
        <div className="step">
          <strong>1. 创建应用</strong>
          <p>管理员在「OAuth2 应用」中创建应用，填写回调地址与 scope。保存时得到的 Client Secret 只显示一次。</p>
        </div>
        <div className="step">
          <strong>2. 发起授权</strong>
          <p>把用户浏览器重定向到授权端点，带上 client_id、redirect_uri、scope、state 与 PKCE 参数。</p>
          <pre><code>{`GET /api/oauth/authorize
  ?response_type=code
  &client_id=YOUR_CLIENT_ID
  &redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback
  &scope=openid+profile+email
  &state=RANDOM_STATE
  &code_challenge=BASE64URL_SHA256(verifier)
  &code_challenge_method=S256`}</code></pre>
        </div>
        <div className="step">
          <strong>3. 换取令牌</strong>
          <p>用户同意后回调会带 <code>code</code>；服务端用 code + PKCE verifier 换取令牌。</p>
          <pre><code>{`POST /api/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=CODE
&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback
&client_id=YOUR_CLIENT_ID
&client_secret=YOUR_CLIENT_SECRET
&code_verifier=ORIGINAL_VERIFIER`}</code></pre>
          <p>公共客户端（无 secret）必须使用 PKCE，并省略 <code>client_secret</code>。</p>
        </div>
        <div className="step">
          <strong>4. 读取用户</strong>
          <pre><code>{`GET /api/oauth/userinfo
Authorization: Bearer ACCESS_TOKEN

{
  "sub": "4",
  "id": 4,
  "username": "Ender_drate",
  "preferred_username": "Ender_drate",
  "name": "Ender",
  "email": "user@example.com",
  "email_verified": true,
  "picture": "https://…",
  "permissions": ["user", "platform"]
}`}</code></pre>
        </div>
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>端点</h2>
        <table className="table">
          <thead>
            <tr><th>方法</th><th>路径</th><th>说明</th></tr>
          </thead>
          <tbody>
            <tr><td>GET</td><td><code>/api/oauth/authorize</code></td><td>用户授权，返回 code（也支持 POST 提交同意）</td></tr>
            <tr><td>POST</td><td><code>/api/oauth/token</code></td><td>code / refresh_token 换令牌</td></tr>
            <tr><td>GET</td><td><code>/api/oauth/userinfo</code></td><td>Bearer 读取用户资料</td></tr>
            <tr><td>GET</td><td><code>/api/oauth/head?uid=</code></td><td>头像（302 或 SVG）</td></tr>
            <tr><td>POST</td><td><code>/api/oauth/revoke</code></td><td>撤销 access / refresh token</td></tr>
            <tr><td>GET</td><td><code>/api/oauth/jwks</code></td><td>RS256 公钥（JWKS）</td></tr>
            <tr><td>GET</td><td><code>/.well-known/openid-configuration</code></td><td>OIDC 发现文档</td></tr>
          </tbody>
        </table>
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Scope</h2>
        <table className="table">
          <thead><tr><th>scope</th><th>返回</th></tr></thead>
          <tbody>
            {scopes.map(([scope, desc]) => (
              <tr key={scope}><td><code>{scope}</code></td><td>{desc}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>PKCE 示例（Node.js）</h2>
        <pre><code>{`import { createHash, randomBytes } from "node:crypto";

const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");

// 1. 浏览器跳转 /api/oauth/authorize?...&code_challenge=\${challenge}
// 2. 回调拿到 code 后：
const body = new URLSearchParams({
  grant_type: "authorization_code",
  code,
  redirect_uri: "https://app.example.com/callback",
  client_id: "ac_xxx",
  code_verifier: verifier,
});
const tokens = await fetch("https://auth.example.com/api/oauth/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body,
}).then((r) => r.json());`}</code></pre>
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>刷新与撤销</h2>
        <pre><code>{`# 刷新（offline_access）
grant_type=refresh_token&refresh_token=rt_xxx&client_id=...&client_secret=...

# 撤销
POST /api/oauth/revoke
token=ACCESS_OR_REFRESH_TOKEN&client_id=...&client_secret=...`}</code></pre>
        <p>
          Access Token 为 RS256 JWT，有效期 15 分钟；可本地用 JWKS 验签，或调用 userinfo 校验。
          Refresh Token 有效期 30 天，每次刷新会轮换。
        </p>
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>错误约定</h2>
        <p>
          授权/令牌端点返回标准 OAuth2 错误：<code>{"{ error, error_description }"}</code>；
          管理 API 返回 <code>{"{ ok:false, error:{ code, message } }"}</code>。所有响应均为
          <code>Cache-Control: no-store</code>。
        </p>
      </div>

      <div className="hint" style={{ marginTop: 18 }}>
        部署时设置 <code>AUTH_PUBLIC_URL</code> 为对外地址（如 https://auth.example.com），
        issuer 与发现文档会随之变化。
      </div>
    </div>
  );
}
