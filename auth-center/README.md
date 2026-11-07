# STOTP Auth Center

一个可被第三方接入的 **OIDC / OAuth2 统一登录站 + 核心 SSO 管理台**，独立于 STOTP TOTP 服务部署。

- 标准 OIDC：授权码 + PKCE(S256)、RS256 id_token/access_token、refresh_token、JWKS、发现文档。
- Scope：`openid`、`profile`、`email`、`head`（头像）、`permission`（权限节点）、`offline_access`。
- 管理台：概览、OAuth2 应用（创建/编辑/密钥轮换/启停/删除）、我的授权（撤销）、用户管理（权限等级/状态）、**权限等级（RBAC）**、个人设置。
- 登录站：登录、注册、授权同意页、退出；密码使用 scrypt 哈希，会话保存在服务端。
- 登录方式：密码、Passkey（无密码）、TOTP 两步验证、外部 OAuth2 登录服务（管理员配置图标/回调）。
- **STOTP 两步验证（旧版可选）**：已有绑定仍兼容；新部署推荐 TOTP。

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
| `AUTH_TRUST_PROXY` | `1` | 信任反向代理传来的 `X-Real-IP` / `X-Forwarded-For` / `CF-Connecting-IP`；应用直接暴露公网时设为 `0` |
| `AUTH_DISPLAY_TZ` | `Asia/Hong_Kong` | 服务端页面显示时间使用的 IANA 时区；数据库仍保存 UTC |
| `STOTP_BASE_URL` | 空 | STOTP 服务端内部地址，如 `http://127.0.0.1:8787`；为空则无法绑定，已绑定用户会 fail closed |
| `STOTP_LOGIN_CLIENT_ID` | 空 | 在 STOTP `/oauth/register` 注册的**登录站** OAuth client_id（`srv_...`） |
| `STOTP_LOGIN_CLIENT_SECRET` | 空 | 上述登录站客户端的 secret，用于换 token 和验 assertion |
| `STOTP_TIMEOUT_MS` | `5000` | 调用 STOTP 服务端的超时 |
| `PORT` | `3100` | `npm run dev/start` 已固定 3100，可自行改脚本 |

数据目录包含：

- `data/auth.db`：用户、OAuth 应用、授权码、令牌、会话、授权记录、审计。
- `data/oidc-keys.json`：RSA 私钥（0600），用于 RS256 签名；**不要提交或泄露**。

### 反向代理真实 IP

如果审计里全是 `127.0.0.1`，说明 nginx 没有把客户端 IP 传给 auth-center。nginx 至少需要：

```nginx
location / {
    proxy_pass http://127.0.0.1:3100;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;   # 覆盖，不要追加不可信 XFF
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
}
```

完整示例见 [`docs/nginx-auth-center.conf`](docs/nginx-auth-center.conf)。

应用会按 `CF-Connecting-IP` → `X-Real-IP` → `X-Forwarded-For` / `Forwarded` 的顺序取第一个公网地址。
修改 nginx 后执行 `nginx -t && systemctl reload nginx`；历史审计里的 `127.0.0.1` 不会自动回填，新登录开始记录真实 IP。

## 登录方式

### TOTP 两步验证

设置页「TOTP 两步验证」→ 扫描二维码 → 输入 6 位码启用。启用后登录需要密码 + TOTP 动态码；
关闭时需要当前密码。使用标准 TOTP（SHA1 / 6 位 / 30 秒，允许 ±1 步）。

### Passkey（无密码登录）

设置页「Passkey」添加设备，登录页点「使用 Passkey 登录」即可无密码进入。

- `RP ID` / `Origin` 从 `AUTH_PUBLIC_URL` 自动推导；必须是 **HTTPS 域名**（`localhost` 除外）。
- 换域名会导致已注册 Passkey 失效。
- 添加/删除 Passkey 都在设置页，删除需要已登录会话。

### 外部 OAuth2 登录服务

最高管理员在「登录入口」添加外部 OAuth2 登录服务：

- 名称、图标 URL、Client ID / Secret
- 授权地址、Token 地址、UserInfo 地址、scope
- 统一回调地址：`{AUTH_PUBLIC_URL}/api/oauth/callback`

该服务 UserInfo 必须返回 `sub`（或 `id`）。未绑定的第三方账户首次登录会跳转到本地账户绑定页，
需要使用本地用户名/密码确认一次；绑定页提供「注册本地账户」入口。若该账号启用 TOTP，
密码通过后会进入独立的动态码页面，验证通过才写入绑定并建立会话。
绑定后再次登录直接复用本地账号，不再按邮箱自动创建或接管账号。

### GitHub OAuth 配置示例

| 字段 | 值 |
| --- | --- |
| Authorization URL | `https://github.com/login/oauth/authorize` |
| Token URL | `https://github.com/login/oauth/access_token` |
| UserInfo URL | `https://api.github.com/user` |
| Scope | `read:user`（需要邮箱时用 `read:user user:email`） |
| Callback | `https://auth.yxzhou.com/api/oauth/callback` |

GitHub OAuth App 的 Authorization callback URL 必须与上面的 Callback 完全一致。
GitHub Token 端点默认返回 `application/x-www-form-urlencoded`，auth-center 已同时兼容 JSON 与表单响应。

设置页「第三方登录绑定」可查看并解绑已绑定的服务；解绑后该第三方账户需要重新绑定本地账户。

第三方登录命中本地账号后，如果该账号启用了 TOTP（或旧 STOTP 绑定），仍必须进入第二步验证，
不会直接建立会话。

> 外部登录的 `client_secret` 保存在 `data/auth.db`，请确保数据库文件权限为 600 并做好备份。
> 旧的 STOTP 绑定仍兼容，但新部署推荐 TOTP / Passkey；设置页已不再显示 STOTP 绑定入口。

### 登录行为

- 只启用 TOTP：密码 + TOTP。
- 只启用 Passkey：可直接 Passkey 登录；密码仍可用。
- 两者都启用：密码登录走 TOTP，Passkey 登录独立可用。
- 外部登录服务：登录页显示按钮，走 OAuth2 回调；已绑定本地账号时仍按该账号的 TOTP/STOTP 策略验证。

### 登录失败图形验证码

同一 IP + 账号在计数窗口内密码失败后，下一次登录必须输入图形验证码：

- 验证码由服务端生成 PNG，带随机旋转、干扰线和噪点；
- 5 分钟有效、一次性、绑定 IP；
- 阈值、失败窗口可在「风险控制」中由最高管理员调整；
- 验证成功或密码正确后清除失败计数。

## 统计与风险控制

「开发」分组新增两个页面：

- **统计信息**：CPU、内存、磁盘、网络收发速率、认证 QPS、负载、运行时间、进程内存。
- **风险控制**：24h 登录失败、独立 IP、高风险 IP、验证码阈值、最近审计与 IP 风险估值。

风控指标仅最高管理员可修改，包括验证码触发阈值、失败计数窗口、高中风险阈值、审计保留天数。
审计页会结合 `login_failed`、TOTP/STOTP 拒绝记录给出 IP 风险分。

## 权限等级（RBAC）

管理台使用「权限等级 + 权限节点」，而不是固定的 admin/user 两档。

- **最高管理员（superadmin）**：拥有全部权限，且是唯一可以进入「权限」页创建/编辑权限等级的角色。
- **管理员（admin）**：系统内置的日常管理等级，可查看统计/审计，可编辑权限节点。
- **普通用户（user）**：默认只有「绑定 STOTP」权限。
- 最高管理员可以在「权限」页新建自定义等级，勾选该等级拥有的权限节点；自定义等级可以编辑/删除，
  `admin` / `user` 等内置等级也可以编辑权限节点，只有 `superadmin` 本身不可改。
- 用户管理页可以把用户分配到任意权限等级（仅最高管理员可改）；禁用/启用用户需要 `users.disable`。

权限节点：

| 节点 | 含义 |
| --- | --- |
| `admin.access` | 访问管理台 |
| `users.view` | 查看用户列表 |
| `users.manage` | 编辑用户资料/角色 |
| `users.disable` | 禁用 / 重新启用用户 |
| `oauth.apps.manage` | 接入 / 管理 OAuth2 应用 |
| `login.providers.manage` | 管理外部登录服务 |
| `stotp.bind` | 绑定自己的 STOTP 设备（旧版兼容） |
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
- TOTP secret 与外部登录的 client_secret 存在 `data/auth.db`，请把数据库权限设为 600 并做好备份；
  外部登录只保存 Passkey 公钥，不保存私钥。
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

TOTP / Passkey / 外部登录 / 图形验证码 / 风险控制：

```bash
npm run e2e:totp
npm run e2e:provider
npm run e2e:captcha
npm run e2e:risk
```

覆盖：TOTP 启用/登录/重放/关闭；外部 OAuth2 授权码回调、本地绑定、TOTP 二阶段绑定、已绑定复用、解绑；
图形验证码触发/错误/正确/计数清除；统计与风险页面、最高管理员修改风控指标、普通用户拒绝修改。
`e2e:captcha` 需要以 `AUTH_E2E=1` 启动 auth-center 才会返回测试用验证码文本；生产环境不要设置。
Passkey 使用 Chromium virtual authenticator 做过注册 + 无密码登录实测（需要 HTTPS 域名或 localhost）。

权限等级：

```bash
npm run e2e:rbac
```

覆盖：自定义权限等级、节点校验、superadmin 不可修改、角色分配、页面/API 权限、禁用/启用、非最高管理员限制。

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

| 登录方式 | TOTP 设置 |
| --- | --- |
| ![login-methods](docs/screenshots/login-methods.png) | ![totp](docs/screenshots/totp-setup.png) |

| 外部登录服务 | Passkey |
| --- | --- |
| ![logins](docs/screenshots/logins.png) | ![passkey](docs/screenshots/passkey.png) |

| 第三方账户绑定 | 接入文档 |
| --- | --- |
| ![link](docs/screenshots/link-account.png) | ![docs](docs/screenshots/docs-v2.png) |

| 统计信息 | 风险控制 |
| --- | --- |
| ![stats](docs/screenshots/stats.png) | ![risk](docs/screenshots/risk.png) |

| 图形验证码 | 移动端 |
| --- | --- |
| ![captcha](docs/screenshots/captcha.png) | ![mobile](docs/screenshots/mobile-dashboard.png) |

## 已知限制

- 统计页的 QPS 是认证事件速率，不是全站 HTTP 请求计数；网络指标依赖 Linux `/proc/net/dev`。
- 图形验证码为服务端 PNG，仍属于传统图形验证码，不是无感风控。
- 单节点 SQLite；多实例需替换 `lib/db.ts` 为共享数据库。
- Passkey 需要 HTTPS 域名或 localhost；`AUTH_PUBLIC_URL` 变更会使已注册 Passkey 失效。
- 外部登录 `client_secret` 存在 `data/auth.db`，请限制数据库文件权限。
