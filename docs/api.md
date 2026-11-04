# STOTP HTTP API（v1）

> 基准地址示例：`https://stotp.example.com`。所有请求/响应均为 UTF-8 JSON（OAuth2 令牌端点使用
> `application/x-www-form-urlencoded`）。时间戳为 RFC 3339 UTC。

## 0. 约定

### 0.1 认证

除 OAuth2 授权端点与发现文档外，所有接口都需要：

```http
Authorization: Bearer <access_token>
```

作用域：`openid`、`profile`、`stotp.clients`（注册/轮换/吊销）、`stotp.verify`（验证）。

### 0.2 标准错误

```json
{"ok": false, "error": {"code": "invalid_request", "message": "seed 必须是 32 字节"}}
```

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | `invalid_request` | 字段缺失/格式错误 |
| 401 | `invalid_token` | 令牌缺失、过期、签名错误 |
| 403 | `insufficient_scope` / `client_revoked` | 作用域不足 / 客户端已作废 |
| 404 | `not_found` | 资源不存在（对调用者无权访问的资源一律 404，避免枚举） |
| 409 | `already_exists` | `client_id` 冲突 |
| 429 | `rate_limited` | 触发限速，响应头带 `Retry-After` |

> **例外**：`POST /v1/verify` 永不返回上述错误——它恒为 `200` + 定长密文/断言，
> 详见 §5。

### 0.3 限速

| 端点 | 限制 |
| --- | --- |
| `/v1/verify` | 每个 `client_id` 10 次/分钟；每个 IP 60 次/分钟；连续失败 5 次锁定 15 分钟 |
| `/oauth/token` | 每个 `client_id` 30 次/分钟 |
| `/oauth/register` | 每个 IP 10 次/小时 |
| `/v1/clients` | 每个账户 30 次/小时 |

超限返回 `429`，带 `Retry-After`（秒）。登录站应把 429 视为「稍后再试」，不得重试轰炸。

## 1. 发现文档

### `GET /.well-known/openid-configuration`

```json
{
  "issuer": "https://stotp.example.com",
  "authorization_endpoint": "https://stotp.example.com/oauth/authorize",
  "token_endpoint": "https://stotp.example.com/oauth/token",
  "userinfo_endpoint": "https://stotp.example.com/oauth/userinfo",
  "registration_endpoint": "https://stotp.example.com/oauth/register",
  "scopes_supported": ["openid", "profile", "stotp.verify", "stotp.clients"],
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token", "client_credentials"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post"],
  "id_token_signing_alg_values_supported": ["HS256"]
}
```

### `GET /.well-known/stotp-configuration`

```json
{
  "protocol": "stotp",
  "version": 1,
  "epoch_seconds": 3600,
  "totp": {"alg": "SHA1", "digits": 6, "period": 30, "skew_steps": 1},
  "algorithms": ["AES-256-REG"],
  "min_client_version": "0.1.0",
  "verify_modes": ["sealed", "assertion"]
}
```

## 2. OAuth2

### 2.1 动态客户端注册

`POST /oauth/register`

```json
{
  "client_name": "EnderCraft 登录站",
  "redirect_uris": ["https://login.endercraft.example/callback"],
  "grant_types": ["authorization_code", "refresh_token", "client_credentials"],
  "scope": "openid profile stotp.verify"
}
```

响应 `201`：

```json
{
  "client_id": "srv_7c1f0d2a9b3e4f56",
  "client_secret": "cs_9f2c...（仅此一次返回）",
  "client_name": "EnderCraft 登录站",
  "redirect_uris": ["https://login.endercraft.example/callback"],
  "grant_types": ["authorization_code", "refresh_token", "client_credentials"],
  "scope": "openid profile stotp.verify",
  "created_at": "2026-11-04T12:00:00Z"
}
```

- `redirect_uris` 必须为 `https://`；`http://127.0.0.1` / `http://localhost` 仅用于本地联调。
- `client_secret` 只存 SHA-256 哈希；`assertion` 签名密钥由 secret 派生后信封加密保存。

### 2.2 授权

`GET /oauth/authorize?response_type=code&client_id=...&redirect_uri=...&scope=openid%20stotp.verify&state=...&code_challenge=...&code_challenge_method=S256`

- 浏览器携带登录站签发的会话 Cookie（`stotp_session`，HS256 JWT，密钥 `STOTP_SESSION_KEY`），
  服务端验证后生成一次性授权码并 302 回 `redirect_uri`。
- 服务端开启 `--dev-login` 时提供一个仅供联调的内置登录表单；生产模式禁用。
- 授权码 10 分钟有效、一次性、绑定 `redirect_uri` 与 `code_challenge`。

错误按 OAuth2 规范 302 回 `redirect_uri?error=...`（缺参时直接 `400`）。

### 2.3 令牌

`POST /oauth/token`，`Content-Type: application/x-www-form-urlencoded`

**授权码 + PKCE**

```
grant_type=authorization_code
code=<授权码>
redirect_uri=<与授权请求一致>
client_id=<client_id>
code_verifier=<43~128 字符>
```

**刷新**

```
grant_type=refresh_token&refresh_token=<token>&client_id=<client_id>
```

**客户端凭证（登录站后端）**

```
grant_type=client_credentials&client_id=<id>&client_secret=<secret>&scope=stotp.verify
```

响应：

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 900,
  "refresh_token": "rt_...",
  "scope": "openid profile stotp.verify",
  "id_token": "eyJhbGciOiJIUzI1NiIs..."
}
```

`access_token` 为 HS256 JWT，claims：`iss, sub, aud, scope, client_id, exp, iat, jti`。
`refresh_token` 30 天有效、每次刷新轮换、旧值立即失效。

### 2.4 用户信息

`GET /oauth/userinfo` → `{"sub":"acc_...","preferred_username":"ender","name":"Ender","email":null}`

## 3. STOTP 客户端注册

### 3.1 注册

`POST /v1/clients`（`stotp.clients`）

```json
{
  "client_id": "0f8fad5b-d9cb-469f-a165-70867728950e",
  "seed": "<base64 32B>",
  "name": "Pixel 7",
  "platform": "android",
  "cri_fp": "<hex HMAC>",
  "desc_digest": "<hex sha256>",
  "desc_proof": "<hex HMAC>"
}
```

- `client_id` 必须是 UUIDv4；`seed` 必须 32B。
- `cri_fp = HMAC-SHA256(seed, "stotp/cri/v1" ‖ client_id)`（服务端复算）。
- `desc_proof = HMAC-SHA256(seed, "stotp/desc/v1" ‖ client_id ‖ desc_digest)`。
- 证明不符 → `400 invalid_request`，**不落库**。

响应 `201`：

```json
{
  "client_id": "0f8fad5b-...",
  "account_id": "acc_5f...",
  "name": "Pixel 7",
  "platform": "android",
  "status": "active",
  "created_at": "2026-11-04T12:00:00Z",
  "epoch": 496000,
  "min_epoch": 496000
}
```

### 3.2 列表 / 详情 / 吊销

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/v1/clients` | 当前账户下所有客户端（不含 seed） |
| `GET` | `/v1/clients/{client_id}` | 详情：`status, created_at, epoch, min_epoch, last_verify_at` |
| `DELETE` | `/v1/clients/{client_id}` | 吊销（幂等），立即拒绝后续验证 |
| `POST` | `/v1/clients/{client_id}/rotate` | 强制轮换：`{"min_epoch": 496001}` |
| `POST` | `/v1/clients/{client_id}/descriptor` | 轮换后更新描述文件摘要 |

详情响应示例：

```json
{
  "client_id": "0f8fad5b-...",
  "name": "Pixel 7",
  "platform": "android",
  "status": "active",
  "created_at": "2026-11-04T12:00:00Z",
  "epoch": 496000,
  "min_epoch": 496000,
  "last_verify_at": "2026-11-04T12:31:02Z",
  "uuid_epoch_seconds": 3600
}
```

### 3.3 代次同步

`GET /v1/clients/{client_id}/epoch`

```json
{
  "epoch": 496000,
  "min_epoch": 496000,
  "server_time": "2026-11-04T12:31:02Z",
  "next_epoch_at": "2026-11-04T13:00:00Z"
}
```

客户端每次启动、回前台、以及每 5 分钟（前台时）调用一次；
`epoch < min_epoch` 时客户端必须立刻重新派生 UUID 与 CD。

### 3.4 更新描述文件

`POST /v1/clients/{client_id}/descriptor`

```json
{"epoch": 496001, "desc_digest": "<hex>", "desc_proof": "<hex>"}
```

- 服务端校验 `desc_proof` 与种子对应关系；不符 → 客户端立即 `revoked`，返回 `403 client_revoked`。
- 成功后旧摘要替换，旧 CD 永不恢复。

## 4. 验证

### 4.1 `POST /v1/verify`

请求体：

```json
{"client_id": "0f8fad5b-...", "epoch": 496000, "uuid": "6c1f...-...", "code": "817204"}
```

- 用户令牌（`stotp.verify`）→ **sealed** 模式，返回种子派生密钥加密的结果。
- 客户端凭证令牌 → **assertion** 模式，返回 HS256 断言供登录站验签。

**sealed 响应（恒 200）**

```json
{"v": 1, "mode": "sealed", "nonce": "<b64 12B>", "payload": "<b64 208B>"}
```

- `payload = AES-256-GCM(k_resp, nonce, aad = client_id ‖ be64(epoch))`，明文固定 192B：
  `{"ok":true,"reason":"ok","client_id":"...","epoch":496000,"ts":...,"jti":"..."}` 右侧空格补齐。
- 客户端用 `k_resp = HKDF(seed, "stotp/response/v1", 32)` 解密；失败即视为拒绝。

**assertion 响应（恒 200）**

```json
{"v": 1, "mode": "assertion", "assertion": "eyJhbGciOiJIUzI1NiJ9..."}
```

- claims：`iss=stotp`、`aud=<登录站 client_id>`、`sub=<account_id>`、`result=allow|deny`、
  `reason`、`client_id`、`epoch`、`iat`、`exp=+120s`、`jti`、`pad`（定长填充）。
- 登录站用 `assert_key = HKDF(client_secret, "stotp/assertion/v1", 32)` 验签，
  校验 `exp`、`aud`、`jti` 后放行。

**无论客户端是否存在、是否被吊销、验证码是否正确，响应都是 200 且结构/长度一致。**

## 5. 健康检查

`GET /healthz` → `{"ok":true,"version":"1.0.0","uptime_s":1234}`（不鉴权，不泄露配置）。

## 6. 调用示例

```bash
# 1) 登录站拿客户端凭证令牌
curl -s -X POST https://stotp.example.com/oauth/token \
  -d grant_type=client_credentials \
  -d client_id=srv_7c1f0d2a9b3e4f56 \
  -d client_secret=cs_9f2c... \
  -d scope=stotp.verify

# 2) 校验用户验证码（恒 200）
curl -s -X POST https://stotp.example.com/v1/verify \
  -H "Authorization: Bearer <client_credentials_token>" \
  -H "Content-Type: application/json" \
  -d '{"client_id":"0f8fad5b-...","epoch":496000,"uuid":"...","code":"817204"}'
```
