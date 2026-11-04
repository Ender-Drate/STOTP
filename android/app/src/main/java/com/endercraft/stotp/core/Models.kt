package com.endercraft.stotp.core

import org.json.JSONArray
import org.json.JSONObject

data class Profile(
    val id: String,
    val name: String,
    val server: String,
    val accountId: String,
    val accountName: String,
    val epoch: Long,
    val createdAt: String,
    val status: String = "active",
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("name", name)
        put("server", server)
        put("account_id", accountId)
        put("account_name", accountName)
        put("epoch", epoch)
        put("created_at", createdAt)
        put("status", status)
    }

    companion object {
        fun fromJson(json: JSONObject) = Profile(
            id = json.getString("id"),
            name = json.optString("name", "未命名设备"),
            server = json.getString("server"),
            accountId = json.optString("account_id", ""),
            accountName = json.optString("account_name", ""),
            epoch = json.optLong("epoch", 0),
            createdAt = json.optString("created_at", ""),
            status = json.optString("status", "active"),
        )

        fun listFromJson(raw: String?): List<Profile> {
            if (raw.isNullOrBlank()) return emptyList()
            return runCatching {
                val array = JSONArray(raw)
                (0 until array.length()).map { fromJson(array.getJSONObject(it)) }
            }.getOrDefault(emptyList())
        }

        fun listToJson(profiles: List<Profile>): String {
            val array = JSONArray()
            profiles.forEach { array.put(it.toJson()) }
            return array.toString()
        }
    }
}

data class Tokens(
    val accessToken: String,
    val refreshToken: String,
    val expiresAt: Long,
    val scope: String = "",
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("access", accessToken)
        put("refresh", refreshToken)
        put("expires_at", expiresAt)
        put("scope", scope)
    }

    companion object {
        fun fromJson(json: JSONObject) = Tokens(
            accessToken = json.getString("access"),
            refreshToken = json.optString("refresh", ""),
            expiresAt = json.optLong("expires_at", 0),
            scope = json.optString("scope", ""),
        )
    }
}

data class Descriptor(
    val token: ByteArray,
    val digest: String,
    val epoch: Long,
)

data class VerifyOutcome(val ok: Boolean, val reason: String) {
    val label: String
        get() = when (reason) {
            "ok" -> "校验通过"
            "code_invalid" -> "验证码不正确"
            "stale_epoch" -> "UUID 已过期，请刷新"
            "uuid_mismatch" -> "设备 UUID 与云端不符"
            "replay" -> "验证码已被使用"
            "revoked" -> "设备已被吊销"
            "rate_limited", "locked" -> "尝试过于频繁，请稍后再试"
            "unknown_client" -> "云端找不到该设备"
            else -> "校验未通过"
        }
}
