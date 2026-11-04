package com.endercraft.stotp.core

fun ByteArray.toHex(): String = buildString(size * 2) {
    for (byte in this@toHex) {
        val value = byte.toInt() and 0xff
        append("0123456789abcdef"[value ushr 4])
        append("0123456789abcdef"[value and 0x0f])
    }
}

fun String.hexToBytes(): ByteArray {
    require(length % 2 == 0) { "hex 长度必须为偶数" }
    return ByteArray(length / 2) { i ->
        substring(i * 2, i * 2 + 2).toInt(16).toByte()
    }
}

fun ByteArray.prefixUtf8(prefix: String): ByteArray =
    prefix.toByteArray(Charsets.UTF_8) + this
