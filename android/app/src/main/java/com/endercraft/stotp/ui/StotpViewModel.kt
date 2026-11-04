package com.endercraft.stotp.ui

import android.app.Application
import android.net.Uri
import android.os.Build
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.endercraft.stotp.core.Crypto
import com.endercraft.stotp.core.Profile
import com.endercraft.stotp.core.StotpApi
import com.endercraft.stotp.core.StotpException
import com.endercraft.stotp.core.Tokens
import com.endercraft.stotp.core.Vault
import com.endercraft.stotp.core.VerifyOutcome
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

enum class Screen { Welcome, Lock, Connect, Home, Settings, Detail }

data class UiState(
    val screen: Screen = Screen.Lock,
    val hasVault: Boolean = false,
    val profiles: List<Profile> = emptyList(),
    val selectedId: String? = null,
    val busy: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
    val serverInput: String = UiState.DEFAULT_SERVER,
    val deviceName: String = "Android 设备",
    val authUrl: String? = null,
    val verify: VerifyOutcome? = null,
    val tick: Long = 0,
) {
    val selected: Profile?
        get() = profiles.firstOrNull { it.id == selectedId } ?: profiles.firstOrNull()

    companion object {
        const val DEFAULT_SERVER = "http://10.0.2.2:8787"
    }
}

private data class PendingOAuth(
    val server: String,
    val clientId: String,
    val verifier: String,
    val state: String,
    val deviceName: String,
)

class StotpViewModel(application: Application) : AndroidViewModel(application) {
    private val vault = Vault(application)
    private val prefs = application.getSharedPreferences("stotp_settings",
        android.content.Context.MODE_PRIVATE)
    private val seeds = mutableMapOf<String, ByteArray>()
    private var pending: PendingOAuth? = null

    var ui by mutableStateOf(UiState(
        hasVault = vault.hasVault(),
        screen = if (vault.hasVault()) Screen.Lock else Screen.Welcome,
        serverInput = prefs.getString("server", UiState.DEFAULT_SERVER) ?: UiState.DEFAULT_SERVER,
        deviceName = prefs.getString("device_name", defaultDeviceName()) ?: defaultDeviceName(),
    ))
        private set

    private fun defaultDeviceName(): String {
        val model = listOfNotNull(Build.MANUFACTURER, Build.MODEL).joinToString(" ").trim()
        return when {
            model.isBlank() -> "Android 设备"
            model.contains("sdk_gphone", ignoreCase = true) ||
                model.contains("emulator", ignoreCase = true) -> "Android 模拟器"
            else -> model
        }
    }

    // ---- 保险库 ---------------------------------------------------------

    fun createVault(passphrase: String, confirm: String) {
        if (passphrase.length < 6) {
            ui = ui.copy(error = "口令至少 6 位")
            return
        }
        if (passphrase != confirm) {
            ui = ui.copy(error = "两次输入的口令不一致")
            return
        }
        ui = ui.copy(busy = true, error = null)
        viewModelScope.launch {
            val ok = runCatching {
                withContext(Dispatchers.IO) { vault.create(passphrase.toCharArray()) }
            }.isSuccess
            ui = if (ok) ui.copy(busy = false, screen = Screen.Connect, hasVault = true)
            else ui.copy(busy = false, error = "无法创建本地保险库")
        }
    }

    fun unlock(passphrase: String) {
        ui = ui.copy(busy = true, error = null)
        viewModelScope.launch {
            val ok = withContext(Dispatchers.IO) { vault.unlock(passphrase.toCharArray()) }
            if (!ok) {
                ui = ui.copy(busy = false, error = "口令不正确")
                return@launch
            }
            val profiles = withContext(Dispatchers.IO) { loadSeeds(vault.profiles()) }
            ui = ui.copy(
                busy = false,
                profiles = profiles,
                selectedId = profiles.firstOrNull()?.id,
                screen = Screen.Home,
                error = null,
            )
        }
    }

    fun lock() {
        vault.lock()
        seeds.values.forEach { it.fill(0) }
        seeds.clear()
        pending = null
        ui = ui.copy(
            screen = if (ui.hasVault) Screen.Lock else Screen.Welcome,
            authUrl = null,
            verify = null,
            error = null,
            notice = null,
        )
    }

    private fun loadSeeds(profiles: List<Profile>): List<Profile> {
        profiles.forEach { profile ->
            runCatching { vault.loadSeed(profile) }.getOrNull()?.let { seeds[profile.id] = it }
        }
        return profiles
    }

    // ---- 表单 -----------------------------------------------------------

    fun updateServer(value: String) {
        ui = ui.copy(serverInput = value, error = null)
    }

    fun updateDeviceName(value: String) {
        ui = ui.copy(deviceName = value, error = null)
    }

    fun navigate(screen: Screen) {
        ui = ui.copy(screen = screen, error = null, notice = null)
    }

    fun selectProfile(id: String) {
        ui = ui.copy(selectedId = id)
    }

    fun showError(message: String?) {
        ui = ui.copy(error = message)
    }

    fun notify(message: String) {
        ui = ui.copy(notice = message)
    }

    fun consumeNotice() {
        ui = ui.copy(notice = null)
    }

    // ---- OAuth 注册流程 --------------------------------------------------

    fun beginOAuth() {
        val server = normalizeServer(ui.serverInput)
        if (server == null) {
            ui = ui.copy(error = "服务端地址不合法")
            return
        }
        ui = ui.copy(busy = true, error = null)
        viewModelScope.launch {
            val result = runCatching {
                withContext(Dispatchers.IO) {
                    val api = StotpApi(server)
                    val clientId = prefs.getString("oauth_client:$server", null)
                        ?: api.registerOauthApp().getString("client_id").also {
                            prefs.edit().putString("oauth_client:$server", it).apply()
                        }
                    val verifier = StotpApi.pkceVerifier()
                    val state = UUID.randomUUID().toString()
                    pending = PendingOAuth(server, clientId, verifier, state, ui.deviceName.trim())
                    prefs.edit().putString("server", server).apply()
                    prefs.edit().putString("device_name", ui.deviceName.trim()).apply()
                    api.authorizeUrl(clientId, StotpApi.pkceChallenge(verifier), state)
                }
            }
            ui = result.fold(
                onSuccess = { url -> ui.copy(busy = false, authUrl = url) },
                onFailure = { error -> ui.copy(busy = false, error = friendly(error)) },
            )
        }
    }

    fun cancelOAuth() {
        pending = null
        ui = ui.copy(authUrl = null)
    }

    fun completeOAuth(callbackUrl: String) {
        val uri = runCatching { Uri.parse(callbackUrl) }.getOrNull()
        val code = uri?.getQueryParameter("code")
        val state = uri?.getQueryParameter("state")
        val session = pending
        if (uri == null || code == null || session == null || state != session.state) {
            pending = null
            ui = ui.copy(authUrl = null, error = "登录回调无效，请重试")
            return
        }
        ui = ui.copy(authUrl = null, busy = true, error = null)
        viewModelScope.launch {
            val result = runCatching {
                withContext(Dispatchers.IO) { registerNewClient(session, code) }
            }
            result.fold(
                onSuccess = { profile ->
                    pending = null
                    ui = ui.copy(
                        busy = false,
                        profiles = vault.profiles(),
                        selectedId = profile.id,
                        screen = Screen.Home,
                        notice = "设备已注册",
                    )
                },
                onFailure = { error ->
                    pending = null
                    ui = ui.copy(busy = false, error = friendly(error))
                },
            )
        }
    }

    private fun registerNewClient(session: PendingOAuth, code: String): Profile {
        val api = StotpApi(session.server)
        val tokens = api.exchangeCode(session.clientId, code, session.verifier)
        val accountName = runCatching { api.userinfo(tokens.accessToken).optString("preferred_username") }
            .getOrDefault("")
        val seed = Crypto.randomBytes(32)
        val clientId = UUID.randomUUID().toString()
        val createdAt = Instant.now().truncatedTo(ChronoUnit.SECONDS).toString()
        var profile = Profile(
            id = clientId,
            name = session.deviceName.ifBlank { defaultDeviceName() },
            server = session.server,
            accountId = "",
            accountName = accountName,
            epoch = Crypto.currentEpoch(),
            createdAt = createdAt,
        )
        var descriptor = vault.buildDescriptor(profile, seed)
        val criFp = Crypto.criFingerprint(seed, clientId)
        val proof = Crypto.descriptorProof(seed, clientId, descriptor.digest)
        val created = api.registerClient(
            tokens.accessToken, clientId, seed, profile.name, "android",
            criFp, descriptor.digest, proof,
        )
        profile = profile.copy(
            accountId = created.optString("account_id", ""),
            epoch = created.optLong("epoch", profile.epoch),
        )
        if (profile.epoch != descriptor.epoch) {
            descriptor = vault.buildDescriptor(profile, seed)
        }
        val freshEpoch = api.epoch(tokens.accessToken, clientId).optLong("epoch", profile.epoch)
        if (freshEpoch != profile.epoch) {
            profile = profile.copy(epoch = freshEpoch)
            descriptor = vault.buildDescriptor(profile, seed)
        }
        val finalProof = Crypto.descriptorProof(seed, clientId, descriptor.digest)
        runCatching {
            api.updateDescriptor(tokens.accessToken, clientId, profile.epoch,
                descriptor.digest, finalProof)
        }
        vault.saveProfile(profile, seed, tokens)
        seeds[clientId] = seed
        return profile
    }

    // ---- 同步 / 校验 ----------------------------------------------------

    fun tick() {
        ui = ui.copy(tick = System.currentTimeMillis() / 1000)
    }

    fun remainingSeconds(): Int = 30 - ((System.currentTimeMillis() / 1000) % 30).toInt()

    fun codeFor(profile: Profile): String {
        val seed = seeds[profile.id] ?: return "------"
        if (profile.status != "active") return "------"
        val secret = Crypto.deriveKey(seed, profile.id, Crypto.TOTP_LABEL, 20)
        return Crypto.totp(secret)
    }

    fun refreshAll(silent: Boolean = true) {
        val selected = ui.selected ?: return
        if (!silent) ui = ui.copy(busy = true, error = null)
        viewModelScope.launch {
            val result = runCatching {
                withContext(Dispatchers.IO) { syncProfile(selected) }
            }
            result.fold(
                onSuccess = { (updated, _) ->
                    ui = ui.copy(busy = false, profiles = vault.profiles(), selectedId = updated.id)
                },
                onFailure = { error ->
                    ui = ui.copy(busy = false,
                        error = if (silent) null else friendly(error))
                },
            )
        }
    }

    fun verifyNow() {
        val profile = ui.selected ?: return
        ui = ui.copy(busy = true, error = null, verify = null)
        viewModelScope.launch {
            val result = runCatching {
                withContext(Dispatchers.IO) {
                    val (updated, seed) = syncProfile(profile)
                    val tokens = ensureTokens(updated)
                    val uuid = Crypto.deriveUuid(seed, updated.id, updated.epoch)
                    val code = codeFor(updated)
                    val api = StotpApi(updated.server)
                    val response = api.verify(tokens.accessToken, updated.id, updated.epoch, uuid, code)
                    api.openVerdict(seed, updated.id, updated.epoch, response)
                }
            }
            ui = result.fold(
                onSuccess = { outcome ->
                    ui = ui.copy(busy = false, verify = outcome, profiles = vault.profiles())
                    if (outcome.ok) ui = ui.copy(notice = "在线校验通过")
                    ui
                },
                onFailure = { error -> ui.copy(busy = false, error = friendly(error)) },
            )
        }
    }

    fun rotateNow() {
        val profile = ui.selected ?: return
        ui = ui.copy(busy = true, error = null)
        viewModelScope.launch {
            val result = runCatching {
                withContext(Dispatchers.IO) {
                    val tokens = ensureTokens(profile)
                    StotpApi(profile.server).rotate(tokens.accessToken, profile.id)
                    syncProfile(profile, forceEpoch = true)
                }
            }
            ui = result.fold(
                onSuccess = {
                    ui.copy(busy = false, profiles = vault.profiles(),
                        notice = "UUID 已轮换到新代次")
                },
                onFailure = { error -> ui.copy(busy = false, error = friendly(error)) },
            )
        }
    }

    fun revokeCurrent() {
        val profile = ui.selected ?: return
        ui = ui.copy(busy = true, error = null)
        viewModelScope.launch {
            val result = runCatching {
                withContext(Dispatchers.IO) {
                    val tokens = ensureTokens(profile)
                    StotpApi(profile.server).revoke(tokens.accessToken, profile.id)
                    val seed = seeds[profile.id]
                    val updated = profile.copy(status = "revoked")
                    if (seed != null) vault.saveProfile(updated, seed, tokens)
                }
            }
            ui = result.fold(
                onSuccess = {
                    ui.copy(busy = false, profiles = vault.profiles(), notice = "设备已吊销")
                },
                onFailure = { error -> ui.copy(busy = false, error = friendly(error)) },
            )
        }
    }

    fun removeCurrent() {
        val profile = ui.selected ?: return
        viewModelScope.launch {
            val remaining = withContext(Dispatchers.IO) {
                vault.deleteProfile(profile)
                seeds.remove(profile.id)?.fill(0)
                vault.profiles()
            }
            ui = ui.copy(profiles = remaining, selectedId = remaining.firstOrNull()?.id,
                screen = Screen.Home, notice = "已从本机移除")
        }
    }

    fun clearAllData() {
        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                vault.clearAll()
                seeds.values.forEach { it.fill(0) }
                seeds.clear()
            }
            ui = UiState(
                hasVault = false,
                screen = Screen.Welcome,
                serverInput = prefs.getString("server", UiState.DEFAULT_SERVER)
                    ?: UiState.DEFAULT_SERVER,
                deviceName = prefs.getString("device_name", defaultDeviceName())
                    ?: defaultDeviceName(),
            )
        }
    }

    // ---- 内部工具 -------------------------------------------------------

    private fun syncProfile(profile: Profile, forceEpoch: Boolean = false): Pair<Profile, ByteArray> {
        val seed = seeds[profile.id] ?: vault.loadSeed(profile).also { seeds[profile.id] = it }
        val tokens = ensureTokens(profile)
        val api = StotpApi(profile.server)
        val epoch = api.epoch(tokens.accessToken, profile.id).optLong("epoch", profile.epoch)
        var updated = profile
        if (forceEpoch || epoch != profile.epoch) {
            updated = profile.copy(epoch = epoch)
            val descriptor = vault.buildDescriptor(updated, seed)
            val proof = Crypto.descriptorProof(seed, updated.id, descriptor.digest)
            api.updateDescriptor(tokens.accessToken, updated.id, epoch, descriptor.digest, proof)
            vault.saveProfile(updated, seed, tokens)
        }
        return updated to seed
    }

    private fun ensureTokens(profile: Profile): Tokens {
        val stored = vault.loadTokens(profile.id)
            ?: throw StotpException(401, "no_token", "登录已失效，请重新登录")
        if (stored.expiresAt > System.currentTimeMillis() / 1000 + 30) return stored
        if (stored.refreshToken.isBlank()) throw StotpException(401, "no_refresh", "登录已过期，请重新登录")
        val clientId = prefs.getString("oauth_client:${profile.server}", null)
            ?: throw StotpException(401, "no_client", "请重新连接服务器")
        val refreshed = StotpApi(profile.server).refresh(clientId, stored.refreshToken)
        val merged = refreshed.copy(refreshToken = refreshed.refreshToken.ifBlank { stored.refreshToken })
        vault.saveTokens(profile.id, merged)
        return merged
    }

    private fun normalizeServer(input: String): String? {
        var text = input.trim()
        if (text.isEmpty()) return null
        if (!text.startsWith("http://") && !text.startsWith("https://")) text = "http://$text"
        val uri = runCatching { Uri.parse(text) }.getOrNull() ?: return null
        val host = uri.host ?: return null
        val port = if (uri.port > 0) ":${uri.port}" else ""
        val scheme = uri.scheme ?: "http"
        return "$scheme://$host$port"
    }

    private fun friendly(error: Throwable): String = when (error) {
        is StotpException -> error.message ?: "请求失败"
        is java.net.UnknownHostException -> "无法连接服务端"
        is java.net.ConnectException -> "服务端未启动或地址不可达"
        is javax.net.ssl.SSLException -> "TLS 连接失败"
        else -> error.message ?: "操作失败"
    }
}
