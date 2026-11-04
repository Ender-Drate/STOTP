# STOTP 密码学协议

> 本文定义 STOTP v1 的密钥派生、文件格式、UUID 轮换与响应封装。密码学实现集中在
> `server/stotp/crypto.py`，仅依赖 [`cryptography`](https://cryptography.io/)（AES-GCM 与常量时间比较）
> 以及标准库的 `hashlib` / `hmac` / `secrets`。

## 0. 依赖边界

| 能力 | 来源 |
| --- | --- |
| AES-256-GCM | `cryptography.hazmat.primitives.ciphers.aead.AESGCM`（OpenSSL 后端） |
| HKDF / HMAC / SHA-256 / PBKDF2 | `hashlib` / `hmac`（标准库） |
| CSPRNG | `secrets.token_bytes` → `os.urandom` |
| TOTP | 自行实现 RFC 6238（`hmac` + `struct`） |

`requirements.txt` 固定 `cryptography>=42`。安装失败时服务端拒绝启动并给出明确提示，
不会降级到不安全的替代实现。

## 1. 原语

| 用途 | 算法 |
| --- | --- |
| 对称加密 | AES-256-GCM（96-bit nonce，128-bit tag） |
| 密钥派生 | HKDF-SHA256（RFC 5869） |
| 消息认证 | HMAC-SHA256 |
| 口令哈希 | PBKDF2-HMAC-SHA256，600 000 轮，16B salt |
| 随机数 | `os.urandom` / CSPRNG |
| TOTP | RFC 6238：HMAC-SHA1，6 位，30 秒步长 |

## 2. 种子与标签

`master_seed` 为 32 字节 CSPRNG 输出，注册时由客户端生成，**永不离开客户端明文**；
服务端收到的副本以信封加密落库（§7）。

所有子密钥都由 HKDF-SHA256 派生，`salt = client_id` 的 UTF-8 字节，`info` 使用下表固定标签：

| 子密钥 | info 标签 | 长度 | 用途 |
| --- | --- | --- | --- |
| `k_totp` | `stotp/totp/v1` | 20B | RFC 6238 的 HMAC 密钥 |
| `k_desc` | `stotp/descriptor/v1` | 32B | AES-256-REG 的加密密钥 |
| `k_uuid` | `stotp/uuid/v1` | 32B | UUID 派生 |
| `k_resp` | `stotp/response/v1` | 32B | 验证结果密文 |
| `k_cri` | `stotp/cri-kek/v1` | 32B | 本地 CRI 文件加密 |

```
k_x = HKDF-SHA256(ikm = master_seed, salt = UTF8(client_id), info = label, L = len)
```

## 3. CRI（客户端注册信息）文件格式

CRI 是**完全加密**的数据文件，落盘二进制布局：

```
offset  size  field
0       8     MAGIC = "STOTPCRI"
8       1     VER = 0x01
9       2     KDF_ITERS (u16, 实际 60000 的倍数编码：值×10)
11      16    SALT
27      12    NONCE
39      n     CIPHERTEXT
39+n    16    TAG
```

- `KEK = HKDF-SHA256(PBKDF2(passphrase, SALT, iters, 32) ‖ device_secret, info = "stotp/cri-kek/v1", L = 32)`
  - `device_secret` 在 Android 上来自 Android Keystore（StrongBox 优先），不出安全硬件。
  - 服务端/桌面端可用操作系统密钥环替代。
- `AAD = MAGIC ‖ VER ‖ client_id`，把文件绑定到具体客户端。
- 明文 JSON：

```json
{
  "v": 1,
  "client_id": "0f8fad5b-d9cb-469f-a165-70867728950e",
  "seed": "<base64 32B>",
  "account_id": "acc_...",
  "issuer": "STOTP",
  "created_at": "2026-11-04T12:00:00Z",
  "epoch": 496000
}
```

- `cri_fp = HMAC-SHA256(master_seed, "stotp/cri/v1" ‖ UTF8(client_id))`，注册时上报，
  服务端复算后存为十六进制。任何字段被改动（包括 seed 替换）都会导致指纹不符 → 作废。

## 4. CD（客户端描述文件）：AES-256-REG

**AES-256-REG** 是本项目定义的注册绑定 AEAD 档案（*Registration-bound Envelope with GCM*）：

```
token = MAGIC("STOTPCD") ‖ VER(0x01) ‖ epoch_be64 ‖ NONCE(12) ‖ AES-256-GCM(k_desc, ...) ‖ TAG(16)
AAD   = "stotp/descriptor/v1" ‖ UTF8(client_id) ‖ epoch_be64
```

- 密钥：`k_desc`（§2）。
- `nonce`：每次封装随机 12B；同一 `(k_desc, epoch)` 不会重复。
- 明文 JSON：

```json
{
  "v": 1,
  "client_id": "0f8fad5b-...",
  "epoch": 496000,
  "alg": "SHA1",
  "digits": 6,
  "period": 30,
  "secret": "<base64 k_totp>",
  "label": "EnderCraft",
  "issuer": "STOTP"
}
```

- **描述文件作废规则**：
  - AAD 绑定 `client_id` 与 `epoch` → 换小时、换设备后旧 token 无法解密（`InvalidTag`）。
  - 服务端只保存 `desc_digest = SHA-256(token)` 与种子证明，不保存 token 本身。
  - 上传/同步时客户端提交 `desc_proof = HMAC-SHA256(master_seed, "stotp/desc/v1" ‖ client_id ‖ desc_digest)`；
    服务端复算不符 → 该客户端 `status = revoked`，CD 作废。

## 5. UUID 小时轮换

```
epoch      = floor(unix_seconds / 3600)          # 服务端时钟为准
raw        = HMAC-SHA256(k_uuid, "stotp/uuid/v1" ‖ UTF8(client_id) ‖ be64(epoch))
uuid_bytes = raw[0:16]，按 RFC 4122 置 version = 8（自定义）、variant = 10xx
```

- 输出是标准 UUIDv8 字符串（36 字符），可直接放入数据库索引与日志。
- 服务器与客户端独立计算，服务端仅用 `hmac.compare_digest` 比较。
- **上一代自动作废**：服务端只接受 `epoch == current_epoch`；`min_epoch` 公告可强制跳到更高代次。
  代次由 HMAC 确定性派生，因此「释放」无需删除任何全局记录。
- `min_epoch` 由服务端维护（默认 = 当前小时；可被 `POST /v1/clients/{id}/rotate` 提升），
  客户端在启动、回前台、手动刷新时拉取并采用。

## 6. 验证响应封装（防状态码预言机）

### 6.1 客户端自检模式（Bearer 用户令牌）

- `k_resp = HKDF(seed, "stotp/response/v1", 32)`
- 明文固定 192B：

```
{"ok":true,"reason":"ok ","client_id":"...","epoch":123,"ts":...}  // 右侧补空格至 192B
```

- `payload = AES-256-GCM(k_resp, nonce=random12, aad = UTF8(client_id) ‖ be64(epoch))`
- HTTP 恒为 `200`，响应体恒为：

```json
{"v":1,"nonce":"<b64 12B>","payload":"<b64 192+16B>"}
```

长度固定，无 `ok`/`reason` 明文字段。

### 6.2 登录站模式（`client_credentials` 令牌）

- 登录站后端持有自己的 `client_secret`，服务端保存 `assert_key = HKDF(client_secret, "stotp/assertion/v1", 32)`
  （信封加密存储，见 §7）。
- 服务端签发定长 JWT（HS256）：`{"iss":"stotp","aud":client_id,"sub":account_id,"result":"allow|deny","exp":now+120,"jti":...,"pad":"..."}`，
  用 `assert_key` 签名；恒定 `200` 与固定长度（pad 补齐）。
- 登录站用同一 `assert_key` 验签，检查 `exp`/`aud`/`jti` 后决定放行。

> 两种模式的响应都**不包含**可用于区分的状态码、长度或明文布尔值；耗时由 §8 统一。

## 7. 服务端密钥与落库

- `STOTP_MASTER_KEY`：32B base64，来自环境变量或 `server/master.key`（权限 600，首次启动生成）。
- seed 落库：`seed_enc = AES-256-GCM(master_key, aad = client_id)`。
- `client_secret` 落库：仅存 `SHA-256(secret)`；`assert_key` 用 master_key 信封加密单独保存。
- 主密钥轮换：`stotp rotate-master` 使用新密钥重加密全部 `seed_enc` / `assert_key`，旧密文保留 24h 供回滚。

## 8. 常量时间与耗时预算

验证请求无论结果如何都执行相同工作：

1. 读取客户端记录（不存在时使用随机 dummy seed）；
2. 复算当前 UUID（比较用 `compare_digest`）；
3. 计算 TOTP 三个窗口（t-1, t, t+1）；
4. 检查重放缓存；
5. AES-GCM 封装固定长度响应。

随后把总耗时补齐到 `STOTP_VERIFY_BUDGET_MS`（默认 40ms）减去已用时间，使用 `time.sleep` 补足；
若已超出预算则不再额外 sleep。耗时抖动仍存在（SQLite、GC），因此**限速才是主防线**（见 `security.md`）。

## 9. 重放与时钟

- 重放缓存键：`(client_id, epoch, code)`，TTL = 90s；同一验证码在窗口内只能成功一次。
- TOTP 允许 ±1 步（即 ±30s），以兼容客户端时钟漂移；更宽的漂移直接拒绝。
- UUID 只接受当前小时（严格），避免「上一小时 UUID + 当前验证码」的混搭重放。

## 10. 版本演进

- CRI/CD 载荷含 `v`；解析方遇到更高版本必须拒绝，不得猜测。
- `/.well-known/stotp-configuration` 暴露 `min_client_version`、`algorithms`、`epoch_seconds`。
- 算法迁移（例如 SHA1 → SHA256）通过 `alg` 字段与双写窗口完成。
