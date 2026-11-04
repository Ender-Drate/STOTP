package com.endercraft.stotp.core

import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

class StotpException(
    val status: Int,
    val code: String,
    message: String,
) : Exception(message)

data class HttpResult(val status: Int, val body: String)

/** 极简 HTTP 客户端：HttpURLConnection + org.json，避免额外依赖。 */
class StotpHttp(server: String) {
    val base: String = server.trim().trimEnd('/')

    fun get(path: String, token: String? = null): HttpResult =
        request("GET", path, null, token)

    fun postJson(path: String, body: JSONObject, token: String? = null): HttpResult =
        request("POST", path, body.toString().toByteArray(Charsets.UTF_8), token,
            "application/json")

    fun postForm(path: String, form: Map<String, String>): HttpResult {
        val encoded = form.entries.joinToString("&") { (key, value) ->
            URLEncoder.encode(key, "UTF-8") + "=" + URLEncoder.encode(value, "UTF-8")
        }
        return request("POST", path, encoded.toByteArray(Charsets.UTF_8), null,
            "application/x-www-form-urlencoded")
    }

    fun delete(path: String, token: String? = null): HttpResult =
        request("DELETE", path, null, token)

    private fun request(method: String, path: String, body: ByteArray?,
                        token: String?, contentType: String? = null): HttpResult {
        val url = URL(base + path)
        // 局域网地址绕过系统 HTTP 代理：手机上的 Clash/公司代理常把私网地址也代理走，
        // 表现为浏览器能开、App 的 TCP 连接却超时。
        val raw = if (isPrivateHost(url.host)) {
            url.openConnection(java.net.Proxy.NO_PROXY)
        } else {
            url.openConnection()
        }
        val connection = (raw as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 6_000
            readTimeout = 15_000
            instanceFollowRedirects = false
            setRequestProperty("Accept", "application/json")
            if (token != null) setRequestProperty("Authorization", "Bearer $token")
            if (contentType != null) setRequestProperty("Content-Type", contentType)
            if (body != null) doOutput = true
        }
        try {
            if (body != null) connection.outputStream.use { it.write(body) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            return HttpResult(status, text)
        } finally {
            connection.disconnect()
        }
    }

    private fun isPrivateHost(host: String): Boolean {
        if (host.equals("localhost", ignoreCase = true) ||
            host.endsWith(".local", ignoreCase = true)
        ) return true
        val parts = host.split(".")
        if (parts.size != 4) return false
        val octets = parts.map { it.toIntOrNull() ?: return false }
        if (octets.any { it !in 0..255 }) return false
        val (a, b) = octets
        return a == 10 || a == 127 || (a == 192 && b == 168) ||
            (a == 172 && b in 16..31) || (a == 169 && b == 254)
    }
}

class StotpApi(server: String) {
    private val http = StotpHttp(server)
    val baseUrl: String get() = http.base

    fun registerOauthApp(): JSONObject {
        val body = JSONObject().apply {
            put("client_name", "STOTP Android")
            put("redirect_uris", org.json.JSONArray().put(REDIRECT_URI))
            put("grant_types", org.json.JSONArray().put("authorization_code").put("refresh_token"))
            put("scope", "openid profile stotp.verify stotp.clients")
            put("token_endpoint_auth_method", "none")
        }
        return ensureOk(http.postJson("/oauth/register", body))
    }

    fun authorizeUrl(clientId: String, challenge: String, state: String): String =
        http.base + "/oauth/authorize?" + listOf(
            "response_type" to "code",
            "client_id" to clientId,
            "redirect_uri" to REDIRECT_URI,
            "scope" to "openid profile stotp.verify stotp.clients",
            "state" to state,
            "code_challenge" to challenge,
            "code_challenge_method" to "S256",
        ).joinToString("&") { (k, v) -> "$k=${enc(v)}" }

    fun exchangeCode(clientId: String, code: String, verifier: String): Tokens {
        val result = http.postForm("/oauth/token", mapOf(
            "grant_type" to "authorization_code",
            "client_id" to clientId,
            "code" to code,
            "redirect_uri" to REDIRECT_URI,
            "code_verifier" to verifier,
        ))
        if (result.status !in 200..299) {
            val json = runCatching { JSONObject(result.body) }.getOrNull()
            throw StotpException(result.status, json?.optString("error") ?: "oauth_error",
                json?.optString("error_description") ?: "登录失败（${result.status}）")
        }
        return parseTokens(JSONObject(result.body))
    }

    fun refresh(clientId: String, refreshToken: String): Tokens {
        val result = http.postForm("/oauth/token", mapOf(
            "grant_type" to "refresh_token",
            "client_id" to clientId,
            "refresh_token" to refreshToken,
        ))
        if (result.status !in 200..299) throw StotpException(result.status, "refresh_failed", "登录已过期，请重新登录")
        return parseTokens(JSONObject(result.body))
    }

    fun registerClient(token: String, clientId: String, seed: ByteArray, name: String,
                       platform: String, criFp: String, digest: String,
                       proof: String): JSONObject {
        val body = JSONObject().apply {
            put("client_id", clientId)
            put("seed", Crypto.b64(seed))
            put("name", name)
            put("platform", platform)
            put("cri_fp", criFp)
            put("desc_digest", digest)
            put("desc_proof", proof)
        }
        return ensureOk(http.postJson("/v1/clients", body, token))
    }

    fun epoch(token: String, clientId: String): JSONObject =
        ensureOk(http.get("/v1/clients/$clientId/epoch", token))

    /** 无需鉴权的连通性探测。 */
    fun health(): JSONObject = ensureOk(http.get("/healthz"))

    fun userinfo(token: String): JSONObject = ensureOk(http.get("/oauth/userinfo", token))

    fun rotate(token: String, clientId: String): JSONObject =
        ensureOk(http.postJson("/v1/clients/$clientId/rotate", JSONObject(), token))

    fun revoke(token: String, clientId: String): JSONObject =
        ensureOk(http.delete("/v1/clients/$clientId", token))

    fun updateDescriptor(token: String, clientId: String, epoch: Long,
                         digest: String, proof: String): JSONObject {
        val body = JSONObject().apply {
            put("epoch", epoch)
            put("desc_digest", digest)
            put("desc_proof", proof)
        }
        return ensureOk(http.postJson("/v1/clients/$clientId/descriptor", body, token))
    }

    fun verify(token: String, clientId: String, epoch: Long, uuid: String,
               code: String): JSONObject = ensureOk(http.postJson("/v1/verify", JSONObject().apply {
        put("client_id", clientId)
        put("epoch", epoch)
        put("uuid", uuid)
        put("code", code)
    }, token))

    /** 解密 sealed 校验结果。 */
    fun openVerdict(seed: ByteArray, clientId: String, epoch: Long,
                    response: JSONObject): VerifyOutcome {
        val key = Crypto.deriveKey(seed, clientId, Crypto.RESPONSE_LABEL)
        val blob = Crypto.unb64(response.getString("nonce")) + Crypto.unb64(response.getString("payload"))
        val aad = clientId.toByteArray(Charsets.UTF_8) + Crypto.be64(epoch)
        val plain = Crypto.open(key, blob, aad)
        val json = JSONObject(String(plain, Charsets.UTF_8).trim())
        return VerifyOutcome(json.optBoolean("ok", false), json.optString("reason", "unknown"))
    }

    private fun parseTokens(json: JSONObject) = Tokens(
        accessToken = json.getString("access_token"),
        refreshToken = json.optString("refresh_token", ""),
        expiresAt = System.currentTimeMillis() / 1000 + json.optLong("expires_in", 900),
        scope = json.optString("scope", ""),
    )

    private fun ensureOk(result: HttpResult): JSONObject {
        val json = runCatching { JSONObject(result.body) }.getOrElse {
            throw StotpException(result.status, "bad_response", "服务端响应异常（${result.status}）")
        }
        if (result.status !in 200..299) {
            val error = json.optJSONObject("error")
            throw StotpException(result.status, error?.optString("code") ?: "error",
                error?.optString("message") ?: "请求失败（${result.status}）")
        }
        return json
    }

    companion object {
        const val REDIRECT_URI = "stotp://oauth/callback"

        fun enc(value: String): String = URLEncoder.encode(value, "UTF-8")

        fun pkceVerifier(): String = Crypto.b64(Crypto.randomBytes(48))

        fun pkceChallenge(verifier: String): String =
            Crypto.b64(Crypto.sha256(verifier.toByteArray(Charsets.US_ASCII)))
    }
}
