import Link from "next/link";
import { CodeBlock } from "@/app/components/CodeBlock";

export const dynamic = "force-dynamic";

const scopes: Array<[string, string]> = [
  ["openid", "唯一标识 sub，返回 id_token"],
  ["profile", "用户名、昵称"],
  ["email", "邮箱与 email_verified"],
  ["head", "头像 URL（picture）"],
  ["permission", "账号权限节点数组"],
  ["offline_access", "签发 refresh_token"],
];

const toc = [
  ["quick", "快速开始"],
  ["endpoints", "端点"],
  ["scopes", "Scope"],
  ["pkce", "PKCE 示例"],
  ["refresh", "刷新与撤销"],
  ["errors", "错误约定"],
];

export default function DocsPage() {
  return (
    <div className="docs-shell">
      <aside className="docs-side">
        <Link href="/" className="docs-brand">
          <span className="brand-mark">S</span>
          <span>
            <span className="docs-brand-name">STOTP 账户</span>
            <span className="docs-brand-sub">接入文档</span>
          </span>
        </Link>
        <div className="docs-nav-label">目录</div>
        <nav className="docs-nav">
          {toc.map(([id, label], index) => (
            <a href={`#${id}`} key={id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              {label}
            </a>
          ))}
        </nav>
        <div className="docs-side-foot">
          <Link className="btn btn-ghost btn-sm" href="/dashboard">返回控制台</Link>
          <Link className="btn btn-primary btn-sm" href="/login">登录</Link>
        </div>
      </aside>

      <main className="docs-main">
        <header className="docs-hero">
          <div className="docs-eyebrow"><span className="docs-dot" />OIDC · OAuth2 · PKCE</div>
          <h1>接入 STOTP 账户</h1>
          <p>
            用标准 OAuth2 / OpenID Connect 把第三方系统接到 STOTP 账户。
            授权码 + PKCE、RS256 令牌、OIDC 发现文档，全部开箱可用。
          </p>
          <div className="docs-hero-actions">
            <a className="btn btn-primary" href="#quick">开始接入</a>
            <a className="btn btn-ghost" href="/api/oauth/discovery" target="_blank" rel="noreferrer">
              OIDC Discovery
            </a>
          </div>
          <div className="docs-meta">
            <span>Authorization Code</span>
            <span>PKCE S256</span>
            <span>RS256</span>
            <span>Refresh Token</span>
          </div>
        </header>

        <section id="quick" className="docs-section card card-pad">
          <div className="docs-section-head">
            <span className="docs-step">01</span>
            <div>
              <h2>快速开始</h2>
              <p>四步完成一次完整授权。</p>
            </div>
          </div>

          <div className="docs-step-block">
            <h3>1. 创建应用</h3>
            <p>管理员在「OAuth2 应用」中创建应用，填写回调地址与 scope。Client Secret 只在保存时显示一次。</p>
          </div>

          <div className="docs-step-block">
            <h3>2. 发起授权</h3>
            <p>把用户浏览器重定向到授权端点，带上 client_id、redirect_uri、scope、state 与 PKCE 参数。</p>
            <CodeBlock label="GET /api/oauth/authorize" code={`/api/oauth/authorize
  ?response_type=code
  &client_id=YOUR_CLIENT_ID
  &redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback
  &scope=openid+profile+email
  &state=RANDOM_STATE
  &code_challenge=BASE64URL_SHA256(verifier)
  &code_challenge_method=S256`} />
          </div>

          <div className="docs-step-block">
            <h3>3. 换取令牌</h3>
            <p>用户同意后回调会带 <code>code</code>；服务端用 code + PKCE verifier 换取令牌。</p>
            <CodeBlock label="POST /api/oauth/token" code={`Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=CODE
&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback
&client_id=YOUR_CLIENT_ID
&client_secret=YOUR_CLIENT_SECRET
&code_verifier=ORIGINAL_VERIFIER`} />
            <p className="docs-note">公共客户端（无 secret）必须使用 PKCE，并省略 <code>client_secret</code>。</p>
          </div>

          <div className="docs-step-block">
            <h3>4. 读取用户</h3>
            <CodeBlock label="GET /api/oauth/userinfo" code={`Authorization: Bearer ACCESS_TOKEN

{
  "sub": "4",
  "id": 4,
  "username": "Ender_drate",
  "preferred_username": "Ender_drate",
  "name": "Ender",
  "email": "user@example.com",
  "email_verified": true,
  "picture": "https://…",
  "permissions": ["stotp.bind"]
}`} />
          </div>
        </section>

        <section id="endpoints" className="docs-section card card-pad">
          <div className="docs-section-head">
            <span className="docs-step">02</span>
            <div>
              <h2>端点</h2>
              <p>所有路径相对于账户中心地址。</p>
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>方法</th><th>路径</th><th>说明</th></tr>
              </thead>
              <tbody>
                <tr><td><span className="method get">GET</span></td><td><code>/api/oauth/authorize</code></td><td>用户授权，返回 code（也支持 POST 提交同意）</td></tr>
                <tr><td><span className="method post">POST</span></td><td><code>/api/oauth/token</code></td><td>code / refresh_token 换令牌</td></tr>
                <tr><td><span className="method get">GET</span></td><td><code>/api/oauth/userinfo</code></td><td>Bearer 读取用户资料</td></tr>
                <tr><td><span className="method get">GET</span></td><td><code>/api/oauth/head?uid=</code></td><td>头像（302 或 SVG）</td></tr>
                <tr><td><span className="method post">POST</span></td><td><code>/api/oauth/revoke</code></td><td>撤销 access / refresh token</td></tr>
                <tr><td><span className="method get">GET</span></td><td><code>/api/oauth/jwks</code></td><td>RS256 公钥（JWKS）</td></tr>
                <tr><td><span className="method get">GET</span></td><td><code>/.well-known/openid-configuration</code></td><td>OIDC 发现文档</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section id="scopes" className="docs-section card card-pad">
          <div className="docs-section-head">
            <span className="docs-step">03</span>
            <div>
              <h2>Scope</h2>
              <p>按需申请，userinfo 只返回已授权字段。</p>
            </div>
          </div>
          <div className="scope-grid">
            {scopes.map(([scope, desc]) => (
              <div className="scope-card" key={scope}>
                <code>{scope}</code>
                <span>{desc}</span>
              </div>
            ))}
          </div>
        </section>

        <section id="pkce" className="docs-section card card-pad">
          <div className="docs-section-head">
            <span className="docs-step">04</span>
            <div>
              <h2>PKCE 示例（Node.js）</h2>
              <p>公共客户端必须使用 S256。</p>
            </div>
          </div>
          <CodeBlock label="Node.js" code={`import { createHash, randomBytes } from "node:crypto";

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
const tokens = await fetch("/api/oauth/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body,
}).then((r) => r.json());`} />
        </section>

        <section id="refresh" className="docs-section card card-pad">
          <div className="docs-section-head">
            <span className="docs-step">05</span>
            <div>
              <h2>刷新与撤销</h2>
              <p>Refresh Token 30 天，每次刷新轮换。</p>
            </div>
          </div>
          <CodeBlock label="刷新令牌" code={`# 前提：授权时申请了 offline_access
grant_type=refresh_token
&refresh_token=REFRESH_TOKEN
&client_id=YOUR_CLIENT_ID
&client_secret=YOUR_CLIENT_SECRET`} />
          <CodeBlock label="撤销令牌" code={`POST /api/oauth/revoke
Content-Type: application/x-www-form-urlencoded

token=ACCESS_OR_REFRESH_TOKEN
&client_id=YOUR_CLIENT_ID
&client_secret=YOUR_CLIENT_SECRET`} />
          <p className="docs-note">Access Token 15 分钟；可用 JWKS 验签，或调 userinfo 校验。</p>
        </section>

        <section id="errors" className="docs-section card card-pad">
          <div className="docs-section-head">
            <span className="docs-step">06</span>
            <div>
              <h2>错误约定</h2>
              <p>OAuth 端点与用户中心 API 分开处理。</p>
            </div>
          </div>
          <div className="docs-two">
            <div>
              <h3>OAuth 端点</h3>
              <p>返回标准 OAuth2 错误：</p>
              <CodeBlock label="JSON" code={`{
  "error": "invalid_grant",
  "error_description": "授权码无效或已过期"
}`} />
            </div>
            <div>
              <h3>用户中心 API</h3>
              <p>返回统一包装：</p>
              <CodeBlock label="JSON" code={`{
  "ok": false,
  "error": {
    "code": "invalid_request",
    "message": "…"
  }
}`} />
            </div>
          </div>
          <p className="docs-note">
            所有响应带 <code>Cache-Control: no-store</code>。部署时把 <code>AUTH_PUBLIC_URL</code>
            设为对外地址，issuer 与发现文档会与之一致。
          </p>
        </section>

        <footer className="docs-footer">
          STOTP 账户中心 · OAuth2 / OpenID Connect · <Link href="/dashboard">控制台</Link>
        </footer>
      </main>
    </div>
  );
}
