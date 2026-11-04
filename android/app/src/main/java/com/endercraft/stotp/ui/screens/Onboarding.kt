package com.endercraft.stotp.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.endercraft.stotp.ui.StotpViewModel
import com.endercraft.stotp.ui.components.FieldLabel
import com.endercraft.stotp.ui.components.LineIcon
import com.endercraft.stotp.ui.components.MetaText
import com.endercraft.stotp.ui.components.Panel
import com.endercraft.stotp.ui.components.PrimaryButton
import com.endercraft.stotp.ui.components.ScreenTitle
import com.endercraft.stotp.ui.components.StotpTextField
import com.endercraft.stotp.ui.theme.StotpColors
import com.endercraft.stotp.ui.theme.StotpType

@Composable
private fun BrandMark(size: Int = 64) {
    Box(
        modifier = Modifier
            .size(size.dp)
            .clip(RoundedCornerShape((size / 3).dp))
            .background(StotpColors.Accent),
        contentAlignment = Alignment.Center,
    ) {
        LineIcon(LineIcon.Shield, tint = androidx.compose.ui.graphics.Color.White,
            size = (size * 0.5f).dp, stroke = 2.dp)
    }
}

@Composable
fun WelcomeScreen(
    busy: Boolean,
    onCreate: (String, String) -> Unit,
) {
    var passphrase by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(StotpColors.Ground)
            .statusBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(48.dp))
        BrandMark()
        Spacer(Modifier.height(22.dp))
        Text("STOTP", style = StotpType.LargeTitle, color = StotpColors.TextPrimary)
        Spacer(Modifier.height(6.dp))
        Text(
            "Super-Enhanced TOTP",
            style = StotpType.Meta,
            color = StotpColors.TextSecondary,
        )
        Spacer(Modifier.height(30.dp))
        Text(
            "创建一个仅属于这台设备的口令。\n它用于加密本地注册信息（CRI）。\n服务端不会保存它。",
            style = StotpType.Body,
            color = StotpColors.TextBody,
            textAlign = TextAlign.Center,
            lineHeight = 26.sp,
        )
        Spacer(Modifier.height(26.dp))
        Panel {
            Column(Modifier.padding(20.dp)) {
                FieldLabel("解锁口令")
                StotpTextField(
                    value = passphrase,
                    onValueChange = { passphrase = it },
                    placeholder = "至少 6 位",
                    isPassword = true,
                    keyboardType = KeyboardType.Password,
                )
                Spacer(Modifier.height(15.dp))
                FieldLabel("再次输入")
                StotpTextField(
                    value = confirm,
                    onValueChange = { confirm = it },
                    placeholder = "确认口令",
                    isPassword = true,
                    keyboardType = KeyboardType.Password,
                )
                Spacer(Modifier.height(22.dp))
                PrimaryButton("创建保险库", { onCreate(passphrase, confirm) },
                    loading = busy,
                    enabled = passphrase.length >= 6 && confirm.isNotEmpty())
            }
        }
        Spacer(Modifier.height(18.dp))
        Text(
            "口令遗失将无法恢复本地注册信息，只能重新注册设备。",
            style = StotpType.Meta,
            color = StotpColors.TextTertiary,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(40.dp))
    }
}

@Composable
fun LockScreen(
    busy: Boolean,
    error: String?,
    onUnlock: (String) -> Unit,
) {
    var passphrase by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(StotpColors.Ground)
            .statusBarsPadding()
            .padding(horizontal = 24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        BrandMark(56)
        Spacer(Modifier.height(20.dp))
        ScreenTitle("解锁", modifier = Modifier.padding(0.dp))
        Spacer(Modifier.height(8.dp))
        MetaText("输入口令以解密本机注册信息", color = StotpColors.TextSecondary)
        Spacer(Modifier.height(28.dp))
        Panel {
            Column(Modifier.padding(20.dp)) {
                StotpTextField(
                    value = passphrase,
                    onValueChange = { passphrase = it },
                    placeholder = "解锁口令",
                    isPassword = true,
                    keyboardType = KeyboardType.Password,
                )
                if (error != null) {
                    Spacer(Modifier.height(10.dp))
                    Text(error, style = StotpType.Meta, color = StotpColors.Danger)
                }
                Spacer(Modifier.height(18.dp))
                PrimaryButton("解锁", { onUnlock(passphrase) },
                    loading = busy, enabled = passphrase.length >= 6)
            }
        }
        Spacer(Modifier.height(16.dp))
        Text(
            "设备密钥由 Android Keystore 保护",
            style = StotpType.Caption,
            color = StotpColors.TextTertiary,
        )
    }
}
