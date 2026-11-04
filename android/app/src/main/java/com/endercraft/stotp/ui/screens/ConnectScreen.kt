package com.endercraft.stotp.ui.screens

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.endercraft.stotp.core.LocalNetworkPermission
import com.endercraft.stotp.ui.components.FieldLabel
import com.endercraft.stotp.ui.components.IconBadge
import com.endercraft.stotp.ui.components.LineIcon
import com.endercraft.stotp.ui.components.Panel
import com.endercraft.stotp.ui.components.PrimaryButton
import com.endercraft.stotp.ui.components.ScreenTitle
import com.endercraft.stotp.ui.components.SecondaryButton
import com.endercraft.stotp.ui.components.StotpTextField
import com.endercraft.stotp.ui.components.pressScale
import com.endercraft.stotp.ui.theme.StotpColors
import com.endercraft.stotp.ui.theme.StotpType
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource

@Composable
fun ConnectScreen(
    server: String,
    deviceName: String,
    preview: String,
    busy: Boolean,
    onServerChange: (String) -> Unit,
    onDeviceNameChange: (String) -> Unit,
    onContinue: () -> Unit,
    onTest: () -> Unit,
    onBack: () -> Unit,
) {
    var localServer by remember(server) { mutableStateOf(server) }
    var localName by remember(deviceName) { mutableStateOf(deviceName) }

    val context = LocalContext.current
    var networkGranted by remember { mutableStateOf(LocalNetworkPermission.granted(context)) }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> networkGranted = granted }
    LaunchedEffect(Unit) {
        if (LocalNetworkPermission.supported(context) && !networkGranted) {
            permissionLauncher.launch(LocalNetworkPermission.NAME)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(StotpColors.Ground)
            .statusBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp),
    ) {
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            val interaction = remember { MutableInteractionSource() }
            Row(
                modifier = Modifier
                    .height(44.dp)
                    .clickable(interactionSource = interaction, indication = null, onClick = onBack)
                    .pressScale(interaction)
                    .padding(end = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                LineIcon(LineIcon.ChevronLeft, tint = StotpColors.TextPrimary, size = 22.dp)
                Text("返回", style = StotpType.Meta, color = StotpColors.TextPrimary)
            }
        }
        Spacer(Modifier.height(10.dp))
        ScreenTitle("连接服务器")
        Spacer(Modifier.height(8.dp))
        Text(
            "输入 STOTP 服务端地址，使用 OAuth2 登录后自动注册本机设备。",
            style = StotpType.Body,
            color = StotpColors.TextSecondary,
            lineHeight = 24.sp,
        )
        Spacer(Modifier.height(24.dp))
        Panel {
            Column(Modifier.padding(20.dp)) {
                FieldLabel("服务端地址")
                StotpTextField(
                    value = localServer,
                    onValueChange = { localServer = it; onServerChange(it) },
                    placeholder = "http://10.0.2.2:8787",
                    keyboardType = KeyboardType.Uri,
                )
                Spacer(Modifier.height(7.dp))
                Text(
                    "将连接 $preview",
                    style = StotpType.Caption,
                    color = StotpColors.TextTertiary,
                )
                if (localServer.trim().startsWith("https://")) {
                    Spacer(Modifier.height(5.dp))
                    Text(
                        "局域网地址通常没有 TLS；若连接失败，请把 https:// 改成 http://",
                        style = StotpType.Caption,
                        color = StotpColors.Heat,
                    )
                }
                Spacer(Modifier.height(15.dp))
                FieldLabel("设备名称")
                StotpTextField(
                    value = localName,
                    onValueChange = { localName = it; onDeviceNameChange(it) },
                    placeholder = "例如：Pixel 7",
                )

                if (LocalNetworkPermission.supported(context) && !networkGranted) {
                    Spacer(Modifier.height(15.dp))
                    Panel {
                        Column(Modifier.padding(17.dp)) {
                            Text(
                                "需要本地网络权限",
                                style = StotpType.Item,
                                color = StotpColors.TextPrimary,
                            )
                            Spacer(Modifier.height(5.dp))
                            Text(
                                "Android 16+ 会拦截 App 访问 192.168.x.x；浏览器不受此限制。",
                                style = StotpType.Caption,
                                color = StotpColors.TextSecondary,
                            )
                            Spacer(Modifier.height(12.dp))
                            PrimaryButton(
                                text = "允许本地网络",
                                onClick = {
                                    permissionLauncher.launch(LocalNetworkPermission.NAME)
                                },
                            )
                            Spacer(Modifier.height(8.dp))
                            Text(
                                "去系统设置授权",
                                style = StotpType.Caption,
                                color = StotpColors.Accent,
                                modifier = Modifier.clickable {
                                    context.startActivity(
                                        Intent(
                                            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                            Uri.fromParts("package", context.packageName, null),
                                        )
                                    )
                                },
                            )
                        }
                    }
                }

                Spacer(Modifier.height(22.dp))
                PrimaryButton(
                    text = "登录并注册",
                    onClick = onContinue,
                    loading = busy,
                    enabled = localServer.isNotBlank(),
                )
                Spacer(Modifier.height(10.dp))
                SecondaryButton(
                    text = "测试连接",
                    onClick = onTest,
                )
            }
        }
        Spacer(Modifier.height(20.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            IconBadge(LineIcon.Server, tint = StotpColors.TextSecondary, size = 34.dp)
            Column(Modifier.weight(1f)) {
                Text("回调地址", style = StotpType.Caption, color = StotpColors.TextTertiary)
                Spacer(Modifier.height(3.dp))
                Text("stotp://oauth/callback", style = StotpType.Mono,
                    color = StotpColors.TextSecondary)
            }
        }
        Spacer(Modifier.height(14.dp))
        Text(
            "登录页由服务端或你本地部署的登录站提供，STOTP 不接触你的账号密码。",
            style = StotpType.Meta,
            color = StotpColors.TextTertiary,
            lineHeight = 20.sp,
        )
        Spacer(Modifier.height(40.dp))
    }
}
