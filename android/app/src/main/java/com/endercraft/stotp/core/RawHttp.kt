package com.endercraft.stotp.core

import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI
import javax.net.ssl.SSLSocketFactory

/**
 * 直连 socket 的 HTTP/1.1 客户端。
 *
 * 刻意不使用 HttpURLConnection/OkHttp：
 * - 无连接池，不会复用已失效的 keep-alive 连接；
 * - 无系统代理/PAC 参与；
 * - 每个请求 `Connection: close`。
 * 服务端只返回 Content-Length 或 chunked，两种都支持。
 */
object RawHttp {
    fun request(
        method: String,
        url: String,
        headers: Map<String, String> = emptyMap(),
        body: ByteArray? = null,
        connectTimeoutMs: Int = 6_000,
        readTimeoutMs: Int = 15_000,
    ): HttpResult {
        val uri = URI(url)
        val secure = uri.scheme.equals("https", ignoreCase = true)
        val host = uri.host ?: throw IOException("URL 缺少主机名")
        val port = if (uri.port > 0) uri.port else if (secure) 443 else 80

        val plain = Socket()
        try {
            plain.connect(InetSocketAddress(host, port), connectTimeoutMs)
            plain.soTimeout = readTimeoutMs
            val socket: Socket = if (secure) {
                (SSLSocketFactory.getDefault() as SSLSocketFactory)
                    .createSocket(plain, host, port, true)
                    .also { it.soTimeout = readTimeoutMs }
            } else {
                plain
            }
            try {
                return exchange(socket, method, uri, host, port, secure, headers, body)
            } finally {
                runCatching { socket.close() }
            }
        } finally {
            runCatching { plain.close() }
        }
    }

    private fun exchange(
        socket: Socket,
        method: String,
        uri: URI,
        host: String,
        port: Int,
        secure: Boolean,
        headers: Map<String, String>,
        body: ByteArray?,
    ): HttpResult {
        val path = buildString {
            append(uri.rawPath?.ifEmpty { "/" } ?: "/")
            uri.rawQuery?.let { append('?').append(it) }
        }
        val head = StringBuilder()
        head.append(method).append(' ').append(path).append(" HTTP/1.1\r\n")
        head.append("Host: ").append(host)
        if (port != (if (secure) 443 else 80)) head.append(':').append(port)
        head.append("\r\n")
        head.append("Connection: close\r\n")
        headers.forEach { (key, value) ->
            head.append(key).append(": ").append(value).append("\r\n")
        }
        if (body != null) head.append("Content-Length: ").append(body.size).append("\r\n")
        head.append("\r\n")

        val output = socket.getOutputStream()
        output.write(head.toString().toByteArray(Charsets.ISO_8859_1))
        if (body != null) output.write(body)
        output.flush()

        val input = BufferedInputStream(socket.getInputStream())
        val statusLine = readAsciiLine(input)
            ?: throw IOException("服务端没有返回响应")
        val status = statusLine.split(' ').getOrNull(1)?.toIntOrNull()
            ?: throw IOException("响应行无法解析：$statusLine")
        val responseHeaders = mutableMapOf<String, String>()
        while (true) {
            val line = readAsciiLine(input) ?: break
            if (line.isEmpty()) break
            val index = line.indexOf(':')
            if (index > 0) {
                responseHeaders[line.substring(0, index).trim().lowercase()] =
                    line.substring(index + 1).trim()
            }
        }
        val bytes = when {
            responseHeaders["transfer-encoding"]?.contains("chunked", true) == true ->
                readChunked(input)
            responseHeaders["content-length"]?.toIntOrNull() != null ->
                readExactly(input, responseHeaders.getValue("content-length").toInt())
            else -> input.readBytes()
        }
        return HttpResult(status, String(bytes, Charsets.UTF_8))
    }

    private fun readAsciiLine(input: InputStream): String? {
        val buffer = ByteArrayOutputStream()
        while (true) {
            val value = input.read()
            if (value == -1) {
                return if (buffer.size() == 0) null else buffer.toString("ISO-8859-1")
            }
            if (value == '\n'.code) {
                val bytes = buffer.toByteArray()
                val length = if (bytes.isNotEmpty() && bytes.last() == '\r'.code.toByte()) {
                    bytes.size - 1
                } else bytes.size
                return String(bytes, 0, length, Charsets.ISO_8859_1)
            }
            buffer.write(value)
        }
    }

    private fun readExactly(input: InputStream, length: Int): ByteArray {
        if (length == 0) return ByteArray(0)
        val data = ByteArray(length)
        var offset = 0
        while (offset < length) {
            val count = input.read(data, offset, length - offset)
            if (count < 0) throw IOException("响应被截断")
            offset += count
        }
        return data
    }

    private fun readChunked(input: InputStream): ByteArray {
        val output = ByteArrayOutputStream()
        while (true) {
            val line = readAsciiLine(input) ?: break
            val size = line.substringBefore(';').trim().toIntOrNull(16) ?: break
            if (size == 0) {
                readAsciiLine(input)
                break
            }
            output.write(readExactly(input, size))
            readAsciiLine(input)
        }
        return output.toByteArray()
    }
}
