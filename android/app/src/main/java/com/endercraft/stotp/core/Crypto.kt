package com.endercraft.stotp.core

import android.util.Base64
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * STOTP v1 客户端密码学。
 *
 * 与服务端 `server/stotp/crypto.py` 使用完全相同的标签与封装格式；
 * 任何改动都必须同时升级协议版本。
 */
object Crypto {
    const val TOTP_LABEL = "stotp/totp/v1"
    const val DESC_LABEL = "stotp/descriptor/v1"
    const val UUID_LABEL = "stotp/uuid/v1"
    const val RESPONSE_LABEL = "stotp/response/v1"
    const val CRI_LABEL = "stotp/cri/v1"
    const val DESC_PROOF_LABEL = "stotp/desc/v1"

    private val random = SecureRandom()

    fun randomBytes(size: Int): ByteArray = ByteArray(size).also(random::nextBytes)

    fun hmacSha256(key: ByteArray, data: ByteArray): ByteArray =
        Mac.getInstance("HmacSHA256").run {
            init(SecretKeySpec(key, "HmacSHA256"))
            doFinal(data)
        }

    fun hkdf(ikm: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
        val prk = hmacSha256(if (salt.isEmpty()) ByteArray(32) else salt, ikm)
        var okm = ByteArray(0)
        var block = ByteArray(0)
        var counter = 1
        while (okm.size < length) {
            block = hmacSha256(prk, block + info + byteArrayOf(counter.toByte()))
            okm += block
            counter++
        }
        return okm.copyOf(length)
    }

    fun deriveKey(seed: ByteArray, clientId: String, label: String, length: Int = 32): ByteArray =
        hkdf(seed, clientId.toByteArray(Charsets.UTF_8), label.toByteArray(Charsets.UTF_8), length)

    fun sha256(data: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(data)

    fun sha256Hex(data: ByteArray): String = sha256(data).toHex()

    fun hmacHex(key: ByteArray, data: ByteArray): String = hmacSha256(key, data).toHex()

    fun pbkdf2(passphrase: CharArray, salt: ByteArray, iterations: Int = 600_000): ByteArray {
        val spec = PBEKeySpec(passphrase, salt, iterations, 256)
        return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
            .generateSecret(spec).encoded
    }

    fun seal(key: ByteArray, plaintext: ByteArray, aad: ByteArray): ByteArray {
        val nonce = randomBytes(12)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        cipher.updateAAD(aad)
        return nonce + cipher.doFinal(plaintext)
    }

    fun open(key: ByteArray, blob: ByteArray, aad: ByteArray): ByteArray {
        require(blob.size > 28) { "密文过短" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, blob, 0, 12))
        cipher.updateAAD(aad)
        return cipher.doFinal(blob, 12, blob.size - 12)
    }

    fun constantTimeEquals(a: ByteArray, b: ByteArray): Boolean = MessageDigest.isEqual(a, b)

    fun totp(secret: ByteArray, atSeconds: Long = System.currentTimeMillis() / 1000,
             digits: Int = 6, step: Int = 30): String {
        val counter = atSeconds / step
        val msg = ByteArray(8)
        for (i in 0..7) {
            msg[i] = ((counter ushr (8 * (7 - i))) and 0xff).toByte()
        }
        val hash = Mac.getInstance("HmacSHA1").run {
            init(SecretKeySpec(secret, "HmacSHA1"))
            doFinal(msg)
        }
        val offset = hash[19].toInt() and 0x0f
        val value = ((hash[offset].toInt() and 0x7f) shl 24) or
            ((hash[offset + 1].toInt() and 0xff) shl 16) or
            ((hash[offset + 2].toInt() and 0xff) shl 8) or
            (hash[offset + 3].toInt() and 0xff)
        return (value % pow10(digits)).toString().padStart(digits, '0')
    }

    private fun pow10(digits: Int): Int {
        var result = 1
        repeat(digits) { result *= 10 }
        return result
    }

    fun currentEpoch(epochSeconds: Long = 3600): Long =
        (System.currentTimeMillis() / 1000) / epochSeconds

    fun deriveUuid(seed: ByteArray, clientId: String, epoch: Long): String {
        val key = deriveKey(seed, clientId, UUID_LABEL)
        val data = "stotp/uuid/v1".toByteArray(Charsets.UTF_8) +
            clientId.toByteArray(Charsets.UTF_8) + be64(epoch)
        val raw = hmacSha256(key, data).copyOf(16)
        raw[6] = ((raw[6].toInt() and 0x0f) or 0x80).toByte()
        raw[8] = ((raw[8].toInt() and 0x3f) or 0x80).toByte()
        return formatUuid(raw)
    }

    fun criFingerprint(seed: ByteArray, clientId: String): String =
        hmacHex(seed, CRI_LABEL.toByteArray(Charsets.US_ASCII) + clientId.toByteArray(Charsets.UTF_8))

    fun descriptorProof(seed: ByteArray, clientId: String, digestHex: String): String =
        hmacHex(
            seed,
            DESC_PROOF_LABEL.toByteArray(Charsets.US_ASCII) +
                clientId.toByteArray(Charsets.UTF_8) + digestHex.hexToBytes()
        )

    fun be64(value: Long): ByteArray {
        val out = ByteArray(8)
        for (i in 0..7) out[i] = ((value ushr (8 * (7 - i))) and 0xff).toByte()
        return out
    }

    private fun formatUuid(bytes: ByteArray): String {
        val hex = bytes.toHex()
        return buildString {
            append(hex, 0, 8); append('-')
            append(hex, 8, 12); append('-')
            append(hex, 12, 16); append('-')
            append(hex, 16, 20); append('-')
            append(hex, 20, 32)
        }
    }

    fun b64(data: ByteArray): String =
        Base64.encodeToString(data, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

    fun unb64(text: String): ByteArray =
        Base64.decode(text, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
}
