# STOTP Auth Center

一个可被第三方接入的 **OIDC / OAuth2 统一登录站 + 核心 SSO 管理台**，独立于 STOTP TOTP 服务部署。

- 标准 OIDC：授权码 + PKCE(S256)、RS256 id_token/access_token、refresh_token、JWKS、发现文档。
- Scope：`openid`、`profile`、`email`、`head`（头像）、`permission`（权限节点）、`offline_access`。
- 管理台：概览、OAuth2 应用（创建/编辑/密钥轮换/启停/删除）、我的授权（撤销）、用户管理（角色/状态）、个人设置。
- 登录站：登录、注册、授权同意页、退出；密码使用 scrypt 哈希，会话保存在服务端。

技术栈：Next.js 16（App Router）+ React 19 + Node 内置 `node:sqlite`，无外部数据库依赖。

> **Node 版本**：必须 **>= 22.13**，推荐 **Node 24 LTS**。`node:sqlite` 是 Node 22.5 才引入的
> 内置模块，旧版本会在 Next.js 显示 Ready 后、请求页面时报
> `ERR_UNKNOWN_BUILTIN_MODULE: No such built-in module: node:sqlite`。

## 快速开始

```powershell
cd auth-center
npm install
$env:AUTH_ADMIN_PASSWORD = "change-me-please"
$env:AUTH_PUBLIC_URL = "http://127.0.0.1:3100"
npm run dev          # http://127.0.0.1:3100
```

首次启动会自动建库并创建管理员（默认 `admin`；密码取 `AUTH_ADMIN_PASSWORD`，未设置时开发环境为
`admin1234`，生产环境随机生成并打印一次）。**上线前务必修改密码。**

生产构建：

```powershell
npm run build
$env:NODE_ENV = "production"
npm run start
```

`npm run start` 只监听 `127.0.0.1:3100`，供同机 nginx 反代；需要局域网直连时用 `npm run start:lan`。
`build` 和 `start` 前都会执行 Node 版本检查，版本不够会直接报错退出，而不是先显示 Ready 再崩。

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AUTH_PUBLIC_URL` | `http://localhost:3100` | 对外基础地址；issuer、发现文档、登录跳转都基于它，必须与浏览器地址一致 |
| `AUTH_DATA_DIR` | `./data` | SQLite、RSA 密钥目录 |
| `AUTH_DB_PATH` | `./data/auth.db` | 覆盖数据库路径 |
| `AUTH_ADMIN_USERNAME` | `admin` | 首次启动创建的管理员用户名 |
| `AUTH_ADMIN_EMAIL` | `admin@localhost` | 管理员邮箱 |
| `AUTH_ADMIN_PASSWORD` | 见上 | 管理员初始密码 |
| `PORT` | `3100` | `npm run dev/start` 已固定 3100，可自行改脚本 |

数据目录包含：

- `data/auth.db`：用户、OAuth 应用、授权码、令牌、会话、授权记录、审计。
- `data/oidc-keys.json`：RSA 私钥（0600），用于 RS256 签名；**不要提交或泄露**。

## 第三方接入

1. 管理员在「OAuth2 应用」创建应用，填写回调地址与 scope；保存时得到的 **Client Secret 只显示一次**。
2. 应用把用户重定向到：

```
GET {AUTH_PUBLIC_URL}/api/oauth/authorize
  ?response_type=code
  &client_id=YOUR_CLIENT_ID
  &redirect_uri=YOUR_CALLBACK
  &scope=openid+profile+email
  &state=STATE
  &code_challenge=PKCE_S256_CHALLENGE
  &code_challenge_method=S256
```

3. 回调拿到 `code` 后，服务端调用 `POST /api/oauth/token` 换取令牌（公共客户端省略 secret，仍必须带 PKCE）。
4. 用 `Authorization: Bearer <access_token>` 调 `GET /api/oauth/userinfo`。

完整字段、refresh/revoke 与错误约定见运行中的 `/docs` 页面。

### 端点

| 方法 | 路径 |
| --- | --- |
| GET | `/api/oauth/authorize` |
| POST | `/api/oauth/token` |
| GET | `/api/oauth/userinfo` |
| GET | `/api/oauth/head?uid=` |
| POST | `/api/oauth/revoke` |
| GET | `/api/oauth/jwks` |
| GET | `/.well-known/openid-configuration` |

## 安全

- 授权码一次性、10 分钟过期，绑定 client / redirect_uri / PKCE。
- Access Token 15 分钟（RS256 JWT），Refresh Token 30 天且每次刷新轮换。
- Client Secret 只存 SHA-256；用户密码 scrypt + 随机盐。
- 登录/注册按 IP 限速；管理 API 校验同源 Origin；Cookie `HttpOnly` + `SameSite=Lax`，HTTPS 部署自动加 `Secure`。
- 禁用用户会删除其会话并撤销令牌；修改密码会踢掉其它会话。
- 生产部署请放在 TLS 反向代理后，并把 `AUTH_PUBLIC_URL` 设为 `https://...`。

## 自检

```powershell
# 终端 1
$env:AUTH_ADMIN_PASSWORD="admin1234"
$env:AUTH_PUBLIC_URL="http://127.0.0.1:3100"
npm run start

# 终端 2
$env:AUTH_ADMIN_PASSWORD="admin1234"
npm run e2e
```

`e2e` 覆盖：注册、管理员登录、创建应用、授权同意、code 换 token、id_token、userinfo、
refresh 轮换、revoke、公共客户端 PKCE、JWKS、删除应用。

## 截图

| 概览 | OAuth2 应用 |
| --- | --- |
| ![overview](docs/screenshots/overview.png) | ![apps](docs/screenshots/apps.png) |

| 登录 | 授权同意 |
| --- | --- |
| ![login](docs/screenshots/login.png) | ![consent](docs/screenshots/consent.png) |

## 已知限制

- 未做邮箱验证、找回密码、TOTP/Passkey、第三方账号绑定（可后续接入）。
- 单节点 SQLite；多实例需替换 `lib/db.ts` 为共享数据库。
- 权限节点目前由管理员在数据库层面维护，管理台只展示；后续可加权限编辑。
