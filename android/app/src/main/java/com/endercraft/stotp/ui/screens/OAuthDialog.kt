package com.endercraft.stotp.ui.screens

import android.annotation.SuppressLint
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.endercraft.stotp.ui.components.Hairline
import com.endercraft.stotp.ui.components.LineIcon
import com.endercraft.stotp.ui.theme.StotpColors
import com.endercraft.stotp.ui.theme.StotpType

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun OAuthDialog(
    url: String,
    onCallback: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false,
        ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(StotpColors.Ground)
                .statusBarsPadding()
                .navigationBarsPadding(),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().height(54.dp).padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("登录 STOTP", style = StotpType.Item, color = StotpColors.TextPrimary,
                    modifier = Modifier.weight(1f))
                Box(
                    Modifier
                        .height(44.dp)
                        .clickable(onClick = onDismiss)
                        .padding(horizontal = 8.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    LineIcon(LineIcon.Close, tint = StotpColors.TextSecondary, size = 20.dp)
                }
            }
            Hairline()

            val holder = remember { mutableStateOf<WebView?>(null) }
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { context ->
                    WebView(context).apply {
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        settings.allowFileAccess = false
                        settings.allowContentAccess = false
                        settings.setSupportMultipleWindows(false)
                        webViewClient = object : WebViewClient() {
                            override fun shouldOverrideUrlLoading(
                                view: WebView?,
                                request: WebResourceRequest?,
                            ): Boolean = handle(request?.url?.toString(), onCallback)

                            @Deprecated("兼容旧 WebView")
                            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean =
                                handle(url, onCallback)

                            private fun handle(target: String?, callback: (String) -> Unit): Boolean {
                                if (target == null) return false
                                if (target.startsWith("stotp://oauth/callback")) {
                                    callback(target)
                                    return true
                                }
                                return !(target.startsWith("http://") || target.startsWith("https://"))
                            }
                        }
                        loadUrl(url)
                        holder.value = this
                    }
                },
            )
            DisposableEffect(Unit) {
                onDispose {
                    holder.value?.apply {
                        stopLoading()
                        destroy()
                    }
                    holder.value = null
                }
            }
        }
    }
}
