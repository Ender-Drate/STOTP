package com.endercraft.stotp.core

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build

/**
 * Android 16+ 的本地网络权限：targetSdk 37 的 App 访问 192.168.x.x 需要单独授权。
 * 未授权时系统会静默拦截局域网连接，表现为 TCP 超时（而不是 SecurityException）。
 */
object LocalNetworkPermission {
    const val NAME = "android.permission.ACCESS_LOCAL_NETWORK"

    fun supported(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < 36) return false
        // 部分 Android 16 版本尚未定义该权限；以 PackageManager 是否认识为准。
        return runCatching {
            context.packageManager.getPermissionInfo(NAME, 0)
            true
        }.getOrDefault(false)
    }

    fun granted(context: Context): Boolean =
        context.checkSelfPermission(NAME) == PackageManager.PERMISSION_GRANTED
}
