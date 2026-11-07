# STOTP Auth Center

一个可被第三方接入的 **OIDC / OAuth2 统一登录站 + 核心 SSO 管理台**，独立于 STOTP TOTP 服务部署。

- 标准 OIDC：授权码 + PKCE(S256)、RS256 id_token/access_token、refresh_token、JWKS、发现文档。
- Scope：`openid`、`profile`、`email`、`head`（头像）、`permission`（权限节点）、`offline_access`。
- 管理台：概览、OAuth2 应用（创建/编辑/密钥轮换/启停/删除）、我的授权（撤销）、用户管理（权限等级/状态）、**权限等级（RBAC）**、个人设置。
- 登录站：登录、注册、授权同意页、退出；密码使用 scrypt 哈希，会话保存在服务端。
- **STOTP 两步验证（可选）**：绑定设备后，登录需要密码 + STOTP App 的 6 位验证码；注册流程不变，未绑定用户仍可密码登录。

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

> 自动创建只在**用户表为空**时执行。如果库里已经有用户（例如注册过普通账号），改
> `AUTH_ADMIN_PASSWORD` 不会新增管理员；用下面的 seed 命令创建或重置。

### 创建 / 重置管理员

```bash
cd auth-center

# 创建或重置 admin，密码用环境变量传入（推荐，避免留在 shell history）
AUTH_ADMIN_PASSWORD='换成强密码' npm run seed

# 或显式指定用户名/密码/邮箱
npm run seed -- admin '换成强密码' admin@example.com
```

脚本会写入 `role=admin`、`status=active`、`permissions=["admin","user"]`；已存在的用户会被更新密码并提升为管理员。
数据库位置按 `AUTH_DB_PATH` > `AUTH_DATA_DIR/auth.db` > `./data/auth.db` 的顺序解析。

生产构建：

```powershell
npm run build
$env:NODE_ENV = "production"
npm run start
```

`npm run start` 只监听 `127.0.0.1:3100`，供同机 nginx 反代；需要局域网直连时用 `npm run start:lan`。
`build` 和 `start` 前都会执行 Node 版本检查，版本不够会直接报错退出，而不是先显示 Ready 再崩。

反向代理必须保留 Host，否则同源校验会报 `bad_origin`：

```nginx
location / {
    proxy_pass http://127.0.0.1:3100;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-Host  $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
}
```

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AUTH_PUBLIC_URL` | `http://localhost:3100` | 对外基础地址；issuer、发现文档、登录跳转都基于它，必须与浏览器地址一致 |
| `AUTH_DATA_DIR` | `./data` | SQLite、RSA 密钥目录 |
| `AUTH_DB_PATH` | `./data/auth.db` | 覆盖数据库路径 |
| `AUTH_ADMIN_USERNAME` | `admin` | 首次启动创建的管理员用户名 |
| `AUTH_ADMIN_EMAIL` | `admin@localhost` | 管理员邮箱 |
| `AUTH_ADMIN_PASSWORD` | 见上 | 管理员初始密码 |
| `STOTP_BASE_URL` | 空 | STOTP 服务端内部地址，如 `http://127.0.0.1:8787`；为空则无法绑定，已绑定用户会 fail closed |
| `STOTP_LOGIN_CLIENT_ID` | 空 | 在 STOTP `/oauth/register` 注册的**登录站** OAuth client_id（`srv_...`） |
| `STOTP_LOGIN_CLIENT_SECRET` | 空 | 上述登录站客户端的 secret，用于换 token 和验 assertion |
| `STOTP_TIMEOUT_MS` | `5000` | 调用 STOTP 服务端的超时 |
| `PORT` | `3100` | `npm run dev/start` 已固定 3100，可自行改脚本 |

数据目录包含：

- `data/auth.db`：用户、OAuth 应用、授权码、令牌、会话、授权记录、审计。
- `data/oidc-keys.json`：RSA 私钥（0600），用于 RS256 签名；**不要提交或泄露**。

## STOTP 两步验证（可选）

默认行为是固定的：**只有已绑定设备的用户**在密码之后需要 6 位验证码；未绑定用户、注册流程完全不变。
没有“强制所有人绑定”或“全局关闭”的开关；绑定入口在「设置 → STOTP 两步验证」。

### 1. STOTP 服务端开启登录站接口

```bash
# /etc/stotp/stotp.env
STOTP_LOGIN_VERIFY=1
```

对应接口是 `POST /v1/login/verify`，只接受登录站 `client_credentials` 令牌；详见 `docs/api.md` §4.2。

### 2. 在 STOTP 注册登录站客户端

```bash
curl -s -X POST http://127.0.0.1:8787/oauth/register \
  -H 'Content-Type: application/json' \
  -d '{
    "client_name": "STOTP Auth Center",
    "redirect_uris": ["https://auth.example.com/"],
    "grant_types": ["client_credentials"],
    "scope": "stotp.verify"
  }'
```

响应里的 `client_id` / `client_secret` 只显示一次，保存到 auth-center 的环境变量。

### 3. auth-center 环境变量

```bash
STOTP_BASE_URL=http://127.0.0.1:8787
STOTP_LOGIN_CLIENT_ID=srv_...
STOTP_LOGIN_CLIENT_SECRET=cs_...
```

重启 auth-center 后，设置页会出现绑定表单。用户输入 STOTP App 设备详情里的 `client_id` 和当前 6 位码，
验证通过才落库；一个设备只能绑定一个账号。

### 4. 登录行为

- 未绑定：密码登录。
- 已绑定：密码 + 6 位验证码。
- 已绑定用户遇到 STOTP 不可达、assertion 验签失败或超时 → 拒绝登录（fail closed）；未绑定用户不受影响。
- 管理员可在「用户管理」查看绑定状态并解绑。

## 权限等级（RBAC）

管理台使用「权限等级 + 权限节点」，而不是固定的 admin/user 两档。

- **最高管理员（superadmin）**：拥有全部权限，且是唯一可以进入「权限」页创建/编辑权限等级的角色。
- **管理员（admin）**：系统内置的日常管理等级，不能修改权限等级。
- **普通用户（user）**：默认只有「绑定 STOTP」权限。
- 最高管理员可以在「权限」页新建自定义等级，勾选该等级拥有的权限节点；自定义等级可以编辑/删除，
  系统内置等级只读。
- 用户管理页可以把用户分配到任意权限等级（仅最高管理员可改）；禁用/启用用户需要 `users.disable`。

权限节点：

| 节点 | 含义 |
| --- | --- |
| `admin.access` | 访问管理台 |
| `users.view` | 查看用户列表 |
| `users.manage` | 编辑用户资料/角色 |
| `users.disable` | 禁用 / 重新启用用户 |
| `oauth.apps.manage` | 接入 / 管理 OAuth2 应用 |
| `stotp.bind` | 绑定自己的 STOTP 设备 |
| `stotp.manage` | 解绑他人的 STOTP 设备 |
| `stats.view` | 查看统计 |
| `audit.view` | 查看审计 |

从旧版本升级时，已有的 `admin` 账号会自动迁移为 `superadmin`，其它账号迁移为 `user`；
自定义权限等级保存在 `roles` 表，用户通过 `role_id` 关联。

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
- STOTP 两步验证：assertion 用 `HKDF(client_secret, "stotp/assertion/v1")` 验 HS256，并校验 `aud/exp/client_id`；
  登录 challenge 5 分钟一次性、最多 5 次尝试，绑定设备全局唯一。
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

STOTP 两步验证用 mock 服务端做独立端到端（会自动启动临时 auth-center，不污染现有数据库）：

```bash
npm run e2e:stotp
```

覆盖：无绑定密码登录、绑定错误码/正确码、登录 `otp_required`、错误 OTP、正确 OTP、ticket 单次使用、
assertion 篡改/错误 aud/过期、重复绑定、用户解绑、管理员解绑、STOTP 不可达 fail closed。

权限等级：

```bash
npm run e2e:rbac
```

覆盖：自定义权限等级、节点校验、系统等级只读、角色分配、页面/API 权限、禁用/启用、非最高管理员限制。

## 截图

| 概览 | OAuth2 应用 |
| --- | --- |
| ![overview](docs/screenshots/overview.png) | ![apps](docs/screenshots/apps.png) |

| 登录 | 授权同意 |
| --- | --- |
| ![login](docs/screenshots/login.png) | ![consent](docs/screenshots/consent.png) |

| STOTP 两步验证 | 设置中绑定 |
| --- | --- |
| ![otp](docs/screenshots/stotp-otp.png) | ![settings](docs/screenshots/stotp-settings.png) |

| 权限等级 | 接入文档 |
| --- | --- |
| ![roles](docs/screenshots/roles.png) | ![docs](docs/screenshots/docs-v2.png) |

## 已知限制

- 未做邮箱验证、找回密码、Passkey、第三方账号绑定；STOTP 两步验证是可选项，默认不强制。
- 单节点 SQLite；多实例需替换 `lib/db.ts` 为共享数据库。
- 权限节点目前由管理员在数据库层面维护，管理台只展示；后续可加权限编辑。
