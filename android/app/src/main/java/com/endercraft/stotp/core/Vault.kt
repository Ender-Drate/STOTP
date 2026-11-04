package com.endercraft.stotp.core

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * 本地保险库：
 * - 口令 PBKDF2 + Android Keystore 设备密钥派生 KEK
 * - 每个客户端一份 CRI（加密）与 CD（AES-256-REG Token）
 * - 令牌单独以 KEK 封装
 */
class Vault(private val context: Context) {
    private val prefs = context.getSharedPreferences("stotp_vault", Context.MODE_PRIVATE)
    private val credsDir = File(context.filesDir, "creds").apply { mkdirs() }

    private var salt: ByteArray? = null
    private var key: ByteArray? = null

    val unlocked: Boolean get() = key != null

    fun hasVault(): Boolean = prefs.contains(KEY_SALT)

    fun create(passphrase: CharArray) {
        val newSalt = Crypto.randomBytes(16)
        val newKey = deriveKey(passphrase, newSalt)
        val check = Crypto.seal(newKey, CHECK_TEXT, CHECK_AAD)
        prefs.edit()
            .putString(KEY_SALT, Crypto.b64(newSalt))
            .putString(KEY_CHECK, Crypto.b64(check))
            .apply()
        salt = newSalt
        key = newKey
    }

    fun unlock(passphrase: CharArray): Boolean {
        val saltB64 = prefs.getString(KEY_SALT, null) ?: return false
        val checkB64 = prefs.getString(KEY_CHECK, null) ?: return false
        return try {
            val candidate = deriveKey(passphrase, Crypto.unb64(saltB64))
            val plain = Crypto.open(candidate, Crypto.unb64(checkB64), CHECK_AAD)
            if (!plain.contentEquals(CHECK_TEXT)) return false
            salt = Crypto.unb64(saltB64)
            key = candidate
            true
        } catch (_: Exception) {
            false
        }
    }

    fun lock() {
        key?.fill(0)
        key = null
    }

    private fun deriveKey(passphrase: CharArray, salt: ByteArray): ByteArray {
        val stretched = Crypto.pbkdf2(passphrase, salt)
        return Crypto.hkdf(stretched, DeviceSecret.get(context),
            "stotp/vault/v1".toByteArray(Charsets.UTF_8), 32)
    }

    private fun requireKey(): ByteArray = key ?: error("保险库未解锁")

    // ---- 资料索引 -------------------------------------------------------

    fun profiles(): List<Profile> =
        Profile.listFromJson(prefs.getString(KEY_PROFILES, null)).sortedByDescending { it.createdAt }

    private fun writeIndex(profiles: List<Profile>) {
        prefs.edit().putString(KEY_PROFILES, Profile.listToJson(profiles)).apply()
    }

    // ---- CRI / CD -------------------------------------------------------

    fun saveProfile(profile: Profile, seed: ByteArray, tokens: Tokens? = null) {
        val descriptor = buildDescriptor(profile, seed)
        writeCri(profile, seed)
        File(credsDir, cdName(profile.id)).writeBytes(descriptor.token) // lgtm[java/clear-text-storage]
        if (tokens != null) saveTokens(profile.id, tokens)
        val index = profiles().filterNot { it.id == profile.id } + profile
        writeIndex(index.distinctBy { it.id })
    }

    fun loadSeed(profile: Profile): ByteArray {
        val file = File(credsDir, criName(profile.id))
        require(file.exists()) { "本地注册信息不存在" }
        val data = DataInputStream(ByteArrayInputStream(file.readBytes()))
        val magic = ByteArray(8).also { data.readFully(it) }
        require(String(magic, Charsets.US_ASCII) == CRI_MAGIC) { "CRI 文件损坏" }
        val version = data.readByte().toInt()
        require(version == 1) { "不支持的 CRI 版本" }
        data.readShort()          // KDF 轮数编码（KEK 由保险库统一派生）
        val fileSalt = ByteArray(16).also { data.readFully(it) }
        require(fileSalt.contentEquals(salt ?: fileSalt)) { "CRI 盐不匹配" }
        val blob = ByteArray(data.available()).also { data.readFully(it) }
        val aad = CRI_MAGIC.toByteArray(Charsets.US_ASCII) + byteArrayOf(version.toByte()) +
            profile.id.toByteArray(Charsets.UTF_8)
        val plain = Crypto.open(requireKey(), blob, aad)
        return Crypto.unb64(JSONObject(String(plain, Charsets.UTF_8)).getString("seed"))
    }

    fun buildDescriptor(profile: Profile, seed: ByteArray): Descriptor {
        val descriptorKey = Crypto.deriveKey(seed, profile.id, Crypto.DESC_LABEL)
        val totpSecret = Crypto.deriveKey(seed, profile.id, Crypto.TOTP_LABEL, 20)
        val payload = JSONObject().apply {
            put("v", 1)
            put("client_id", profile.id)
            put("epoch", profile.epoch)
            put("alg", "SHA1")
            put("digits", 6)
            put("period", 30)
            put("secret", Crypto.b64(totpSecret))
            put("label", profile.name)
            put("issuer", "STOTP")
        }.toString().toByteArray(Charsets.UTF_8)
        val aad = "stotp/descriptor/v1".toByteArray(Charsets.UTF_8) +
            profile.id.toByteArray(Charsets.UTF_8) + Crypto.be64(profile.epoch)
        val blob = Crypto.seal(descriptorKey, payload, aad)
        val out = ByteArrayOutputStream()
        DataOutputStream(out).use { data ->
            data.write(CD_MAGIC.toByteArray(Charsets.US_ASCII))
            data.writeByte(1)
            data.writeLong(profile.epoch)
            data.write(blob)
        }
        val token = out.toByteArray()
        return Descriptor(token = token, digest = Crypto.sha256Hex(token), epoch = profile.epoch)
    }

    fun readDescriptor(profile: Profile): ByteArray? {
        val file = File(credsDir, cdName(profile.id))
        return if (file.exists()) file.readBytes() else null
    }

    private fun writeCri(profile: Profile, seed: ByteArray) {
        val payload = JSONObject().apply {
            put("v", 1)
            put("client_id", profile.id)
            put("seed", Crypto.b64(seed))
            put("account_id", profile.accountId)
            put("account_name", profile.accountName)
            put("server", profile.server)
            put("created_at", profile.createdAt)
            put("epoch", profile.epoch)
        }.toString().toByteArray(Charsets.UTF_8)
        val aad = CRI_MAGIC.toByteArray(Charsets.US_ASCII) + byteArrayOf(1) +
            profile.id.toByteArray(Charsets.UTF_8)
        val blob = Crypto.seal(requireKey(), payload, aad)
        val out = ByteArrayOutputStream()
        DataOutputStream(out).use { data ->
            data.write(CRI_MAGIC.toByteArray(Charsets.US_ASCII))
            data.writeByte(1)
            data.writeShort(60_000)   // 600000 轮 / 10
            data.write(salt ?: Crypto.randomBytes(16))
            data.write(blob)
        }
        File(credsDir, criName(profile.id)).writeBytes(out.toByteArray())
    }

    // ---- 令牌 -----------------------------------------------------------

    fun saveTokens(profileId: String, tokens: Tokens) {
        val blob = Crypto.seal(requireKey(), tokens.toJson().toString().toByteArray(Charsets.UTF_8),
            "tokens:".toByteArray(Charsets.UTF_8) + profileId.toByteArray(Charsets.UTF_8))
        prefs.edit().putString("tok_$profileId", Crypto.b64(blob)).apply()
    }

    fun loadTokens(profileId: String): Tokens? {
        val stored = prefs.getString("tok_$profileId", null) ?: return null
        return runCatching {
            val plain = Crypto.open(requireKey(), Crypto.unb64(stored),
                "tokens:".toByteArray(Charsets.UTF_8) + profileId.toByteArray(Charsets.UTF_8))
            Tokens.fromJson(JSONObject(String(plain, Charsets.UTF_8)))
        }.getOrNull()
    }

    // ---- 删除 -----------------------------------------------------------

    fun deleteProfile(profile: Profile) {
        File(credsDir, criName(profile.id)).delete()
        File(credsDir, cdName(profile.id)).delete()
        prefs.edit().remove("tok_${profile.id}").apply()
        writeIndex(profiles().filterNot { it.id == profile.id })
    }

    fun clearAll() {
        credsDir.listFiles()?.forEach { it.delete() }
        prefs.edit().clear().apply()
        key = null
        salt = null
    }

    private fun criName(id: String) = "cri_$id.bin"
    private fun cdName(id: String) = "cd_$id.bin"

    companion object {
        private const val KEY_SALT = "vault_salt"
        private const val KEY_CHECK = "vault_check"
        private const val KEY_PROFILES = "profiles"
        private const val CRI_MAGIC = "STOTPCRI"
        private const val CD_MAGIC = "STOTPCD"
        private val CHECK_TEXT = "stotp-vault-v1".toByteArray(Charsets.UTF_8)
        private val CHECK_AAD = "stotp/vault-check".toByteArray(Charsets.UTF_8)
    }
}

/**
 * 设备密钥：优先 Android Keystore；极端情况下（无可用 Keystore 的模拟器）回退到
 * 应用私有目录中的随机密钥，保证功能可用，但安全等级下降。
 */
private object DeviceSecret {
    private const val ALIAS = "stotp.device.key.v1"

    fun get(context: Context): ByteArray {
        val prefs = context.getSharedPreferences("stotp_device", Context.MODE_PRIVATE)
        prefs.getString("plain", null)?.let { return Crypto.unb64(it) }
        val wrapped = prefs.getString("wrapped", null)
        if (wrapped != null) {
            runCatching { return unwrap(wrapped) }
            val secret = Crypto.randomBytes(32)
            prefs.edit().putString("plain", Crypto.b64(secret)).apply()
            return secret
        }
        val secret = Crypto.randomBytes(32)
        val encoded = runCatching { wrap(secret) }.getOrNull()
        if (encoded != null) {
            prefs.edit().putString("wrapped", encoded).apply()
        } else {
            prefs.edit().putString("plain", Crypto.b64(secret)).apply()
        }
        return secret
    }

    private fun secretKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (!store.containsAlias(ALIAS)) {
            val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            generator.init(
                KeyGenParameterSpec.Builder(ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .setUserAuthenticationRequired(false)
                    .build()
            )
            generator.generateKey()
        }
        return store.getKey(ALIAS, null) as SecretKey
    }

    private fun wrap(secret: ByteArray): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val ciphertext = cipher.doFinal(secret)
        return Crypto.b64(cipher.iv + ciphertext)
    }

    private fun unwrap(encoded: String): ByteArray {
        val blob = Crypto.unb64(encoded)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, blob, 0, 12))
        return cipher.doFinal(blob, 12, blob.size - 12)
    }
}
