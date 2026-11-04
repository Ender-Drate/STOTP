# 安全设计与威胁模型

> STOTP 的安全目标不是「服务端不知道种子」，而是：**验证结果无法被低成本地试探，注册态一旦不符就立即失效。**
> 本文说明资产、威胁、抗枚举设计、密钥管理和已知残余风险。

## 1. 资产

| 资产 | 位置 | 泄露后果 |
| --- | --- | --- |
| `master_seed` | 客户端 CRI（加密）；服务端 `seed_enc` | 可离线生成任意验证码 |
| `client_secret` | 登录站后端；服务端只存哈希 | 可冒充登录站调用验证接口 |
| `assert_key` | 服务端（信封加密）；登录站本地派生 | 可伪造「验证通过」断言 |
| `STOTP_MASTER_KEY` | 服务端环境变量 / 密钥文件 | 可解密全部 seed |
| TOTP 验证码 | 用户输入 / 客户端内存 | 30 秒内可重放一次（受重放缓存限制） |
| 审计日志 | SQLite | 泄露行为画像（已做 IP 哈希） |

## 2. 威胁模型

| 威胁 | 能力 | 缓解 |
| --- | --- | --- |
| **T1 网络攻击者** | 可抓包、改包 | TLS 1.3 终止于反向代理；HSTS；证书固定（客户端可选） |
| **T2 Burp 用户（合法账户）** | 可重放、篡改、并发爆破自己的验证码 | 统一 200 + 定长密文；限速 + 失败锁定；重放缓存 |
| **T3 数据库泄露** | 拿到 `stotp.db` | seed 信封加密；主密钥不在库内；client_secret 仅哈希 |
| **T4 设备丢失 / CRI 被复制** | 持有 CRI 文件 | 口令 + Keystore 双重 KEK；UUID 小时轮换使副本在下个整点失效 |
| **T5 恶意登录站** | 注册 OAuth 客户端，诱导用户 | 回调白名单；授权码绑定 redirect_uri + PKCE；作用域最小化 |
| **T6 内部人** | 可读环境变量 | 主密钥托管 KMS / 最小权限；审计；轮换流程 |
| **T7 拒绝服务** | 高频请求 | 令牌桶、连接上限、反代层限速；验证预算封顶 |

## 3. 抗枚举：为什么「看状态码爆破」行不通

TOTP 码空间只有 `10^6`。如果验证接口用 `200 / 401` 区分结果，Burp Intruder 可以在一个 30 秒窗口内
高速试探；即使单线程，也可跨窗口持续跑。STOTP 的处理：

1. **恒 200**：`/v1/verify` 对「通过 / 拒绝 / 客户端不存在 / 已吊销 / 格式错误」全部返回 200。
2. **定长响应**：
   - sealed：`192B` 明文 + 16B tag，Base64 后长度恒定；
   - assertion：JWT 通过 `pad` 补齐到该客户端的固定长度。
3. **同等工作量**：未知客户端也走 dummy seed 的 UUID/TOTP 计算 + AES-GCM 封装，不提前返回。
4. **恒定耗时预算**：默认 40ms，测量后补 `sleep`；SQLite 查询与 HMAC 在所有分支都执行。
5. **限速与锁定**：每 `client_id` 10 次/分钟；连续 5 次失败锁定 15 分钟；每 IP 60 次/分钟。
6. **重放缓存**：`(client_id, epoch, code)` 成功一次即写入 90 秒 TTL，重复使用直接拒绝。
7. **UUID 严格当前小时**：避免跨小时组合重放。

量化：在 10 次/分钟且 5 次失败即锁定的约束下，猜中 6 位码的期望尝试次数为 `5×10^5`，
需要约 `10^5` 个锁定周期（≈ 3.4 年），且每次锁定都会产生审计事件。**成本远高于收益。**

> 残余的时间侧信道：SQLite 命中/未命中、GC、网络抖动仍可能带来毫秒级差异。
> 因此限速是主防线，恒定耗时只是纵深防御；不要把它当作密码学保证。

## 4. 注册态校验

每次验证都检查：

| 检查 | 不符时 |
| --- | --- |
| `stotp_clients.status == active` | 拒绝，审计 `revoked` |
| `epoch == max(current_epoch, min_epoch)` | 拒绝，审计 `stale_epoch` |
| `uuid == HMAC(k_uuid, client_id ‖ epoch)`（`compare_digest`） | 拒绝，审计 `uuid_mismatch` |
| `cri_fp` 与注册时一致 | 标记 `revoked`，审计 `cri_mismatch` |
| `desc_digest` 与最近一次上报一致 | 标记 `revoked`，审计 `descriptor_mismatch` |
| TOTP 在 ±1 步内 | 拒绝，审计 `code_invalid` |
| 重放缓存未命中 | 拒绝，审计 `replay` |

「描述文件作废」是**服务端状态机**：一旦 `revoked`，该 `client_id` 永久失效，重新注册需生成新 seed 与新
`client_id`，旧 CD 不再可用。

## 5. 密钥管理

- **主密钥**：32B，`STOTP_MASTER_KEY` 或 `server/master.key`（首次启动生成，权限 600）。
  丢失主密钥 = 全部 seed 不可用（只能让用户重新注册）；泄露主密钥 = 全部 seed 可解密。
  生产环境建议放入 KMS，进程启动时拉取，不落盘。
- **会话密钥**（`STOTP_SESSION_KEY`）：登录站签发会话 JWT 用；与主密钥分离。
- **令牌密钥**（`STOTP_TOKEN_KEY`）：access_token/id_token 的 HS256 密钥；轮换时保留旧密钥 15 分钟。
- **OAuth client_secret**：仅存 `SHA-256`；比较用 `compare_digest`。
- **assert_key**：`HKDF(client_secret, "stotp/assertion/v1")`，用主密钥信封加密存储。
- 所有密钥支持通过文件注入（`*_FILE` 变量），避免出现在进程命令行。

## 6. 传输与部署

- 只信任反向代理转发的 `X-Forwarded-Proto: https`；`STOTP_REQUIRE_TLS=1` 时拒绝明文。
- 响应头：`Strict-Transport-Security`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`。
- 内置 dev 登录页（`--dev-login`）仅绑定 `127.0.0.1`，带 CSP 与 CSRF token，生产模式不可开启。
- 日志脱敏：不记录验证码、seed、令牌；IP 用 HMAC(pepper) 哈希后落库。

## 7. 客户端安全（Android）

- CRI：`PBKDF2(passphrase) + Keystore device_secret` → AES-256-GCM；应用退到后台 5 分钟后清空内存中的 seed。
- 屏幕：验证码页面禁止截屏（`FLAG_SECURE` 可选开关）。
- 网络：仅允许 HTTPS；`network_security_config` 禁止明文；可选用证书固定。
- 备份：`android:allowBackup="false"`，避免 CRI 被 ADB 备份导出。
- 剪贴板：复制验证码 30 秒后自动清空（Android 13+ 显示剪贴板提示）。

## 8. 残余风险

| 风险 | 说明 | 后续 |
| --- | --- | --- |
| 服务端可解密 seed | OTP 服务端的固有约束 | 评估 OPAQUE/PAKE 或硬件 HSM 封装 |
| 30 秒窗口内重放 | 重放缓存已限制为一次 | 可结合登录站的一次性 nonce |
| 时钟漂移 | 允许 ±1 步 | 客户端展示服务端时间偏差 |
| SQLite 单点 | 单机部署 | 提供 PostgreSQL 适配层 |
| 供应链 | `cryptography` 依赖 | 锁定版本 + 哈希校验 |

## 9. 安全自检清单

- [ ] `/v1/verify` 所有分支 HTTP 200、响应长度一致
- [ ] sealed payload 恒 192B 明文；assertion 定长
- [ ] 未知 client 使用 dummy seed，不提前返回
- [ ] 比较全部使用 `hmac.compare_digest`
- [ ] 失败锁定与重放缓存生效
- [ ] 日志中无 code / seed / token
- [ ] 主密钥缺失时拒绝启动
- [ ] 生产模式禁用 dev 登录
