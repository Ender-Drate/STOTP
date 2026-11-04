# STOTP 服务端

Python 3.11+ 实现：OAuth2 用户中心 + STOTP 注册/轮换/验证。接口契约见
[`../docs/api.md`](../docs/api.md)，密码学细节见 [`../docs/crypto-protocol.md`](../docs/crypto-protocol.md)。

## 快速开始

```powershell
cd server
python -m pip install -r requirements.txt

# 首次启动会生成 data/keys/{master,session,token}.key
python -m stotp --dev-login --create-account demo:demo1234 --db .\data\stotp.db

# 另一个终端
curl.exe http://127.0.0.1:8787/healthz
```

`--dev-login` 会在浏览器流程中提供内置登录页，仅用于本地联调；生产环境不要开启。

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `STOTP_HOST` / `--host` | `127.0.0.1` | 监听地址；生产环境置于反向代理之后 |
| `STOTP_PORT` / `--port` | `8787` | 监听端口 |
| `STOTP_DB` / `--db` | `data/stotp.db` | SQLite 路径（WAL） |
| `STOTP_PUBLIC_URL` / `--public-url` | `http://host:port` | 发现文档与令牌 `iss` 的对外地址 |
| `STOTP_DEV_LOGIN` / `--dev-login` | 关 | 启用内置登录页 |
| `STOTP_REQUIRE_TLS` / `--require-tls` | 关 | 生产模式；会关闭 Secure Cookie 的降级 |
| `STOTP_TRUST_PROXY` / `--trust-proxy` | 关 | 信任 `X-Forwarded-For` |
| `STOTP_EPOCH_SECONDS` | `3600` | UUID 轮换周期 |
| `STOTP_VERIFY_BUDGET_MS` | `40` | 验证接口耗时预算（含 sleep 补齐） |
| `STOTP_MASTER_KEY` | 自动生成 | 32B base64/hex；信封加密主密钥 |
| `STOTP_SESSION_KEY` | 自动生成 | 会话 JWT 密钥 |
| `STOTP_TOKEN_KEY` | 自动生成 | access/id token HS256 密钥 |

密钥文件位于 `data/keys/`（权限 0600），也可以用 `*_FILE` 方式由 KMS/Secret 挂载。

## 目录

```
server/
├── stotp/
│   ├── __main__.py     # CLI
│   ├── app.py          # 装配：路由、限速、dummy seed、assertion key
│   ├── config.py       # 环境变量与密钥文件
│   ├── crypto.py       # HKDF / AES-GCM / TOTP / UUIDv8 / JWT / PBKDF2
│   ├── store.py        # SQLite + seed 信封加密
│   ├── oauth.py        # /oauth/*、发现文档、dev 登录页
│   ├── api.py          # /v1/*：注册、epoch、descriptor、verify
│   ├── auth.py         # Bearer / 会话 Cookie
│   ├── http.py         # 路由、统一错误、安全响应头
│   └── ratelimit.py    # 令牌桶 + 失败锁定
├── tests/              # unittest（KDF/TOTP 向量 + HTTP 端到端）
├── requirements.txt
└── README.md
```

## 自检

```powershell
cd server
python -m unittest discover -s tests -v
```

覆盖：

- HKDF RFC 5869 测试向量、RFC 6238 TOTP 向量、UUIDv8 确定性、AES-GCM 篡改检测、JWT 签名。
- 完整 HTTP 流程：注册客户端 → 取 epoch → sealed 校验（通过/错误码/未知客户端等长响应）→ 重放拒绝 →
  强制轮换后旧 epoch 拒绝 → 描述文件证明不符触发 revoked。
- 客户端凭证 + assertion 模式：动态注册登录站 → `client_credentials` → 验证 → 用派生密钥验签。

## 手工联调

```powershell
# 1) 启动（demo/demo1234）
python -m stotp --dev-login --create-account demo:demo1234

# 2) 浏览器打开授权页（需要先登录）： 
#    http://127.0.0.1:8787/oauth/authorize?response_type=code&client_id=...&redirect_uri=...
#    Android 客户端会自动完成动态注册与 PKCE。
```

## 部署

```
[客户端] --TLS1.3--> [Caddy/Nginx] --HTTP--> [stotp 127.0.0.1:8787]
```

- TLS 在反向代理终止；设置 `STOTP_PUBLIC_URL=https://stotp.example.com` 与 `STOTP_REQUIRE_TLS=1`。
- 单机 SQLite 足够中小规模；水平扩展需替换 `store.py` 为 PostgreSQL 实现。
- 主密钥丢失 = 所有 seed 不可用；请备份或托管到 KMS。

## 安全边界

- 验证接口除认证失败（401）外恒 `200`；sealed 响应定长 208B 密文，assertion 响应定长 900B。
- 未知客户端使用 dummy seed 走同等计算；比较全部 `hmac.compare_digest`。
- 连续 5 次失败锁定 15 分钟；每客户端 10 次/分钟、每 IP 60 次/分钟。
- 只记录结果与原因到审计表，不记录验证码、seed、令牌。
