package com.endercraft.stotp.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.endercraft.stotp.ui.Screen
import com.endercraft.stotp.ui.StotpViewModel
import com.endercraft.stotp.ui.UiState
import com.endercraft.stotp.ui.components.BottomTabBar
import com.endercraft.stotp.ui.components.Hairline
import com.endercraft.stotp.ui.components.IconBadge
import com.endercraft.stotp.ui.components.LineIcon
import com.endercraft.stotp.ui.components.ListRow
import com.endercraft.stotp.ui.components.Panel
import com.endercraft.stotp.ui.components.ScreenTitle
import com.endercraft.stotp.ui.components.SectionTitle
import com.endercraft.stotp.ui.theme.StotpColors
import com.endercraft.stotp.ui.theme.StotpType

@Composable
fun SettingsScreen(state: UiState, vm: StotpViewModel) {
    var confirmClear by remember { mutableStateOf(false) }
    val profile = state.selected
    val secondsToRotate = if (profile != null) {
        ((profile.epoch + 1) * 3600 - System.currentTimeMillis() / 1000).coerceAtLeast(0)
    } else 0L

    Box(Modifier.fillMaxSize().background(StotpColors.Ground)) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().statusBarsPadding(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 14.dp, bottom = 168.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item {
                Column {
                    ScreenTitle("设置")
                    Spacer(Modifier.height(2.dp))
                    Text("本地安全与服务端状态", style = StotpType.Meta,
                        color = StotpColors.TextSecondary)
                }
            }

            item { SectionTitle("服务端") }
            item {
                Panel {
                    ListRow(
                        "当前服务端",
                        subtitle = profile?.server ?: state.serverInput,
                        icon = LineIcon.Server,
                    )
                    Hairline(Modifier.padding(start = 18.dp))
                    ListRow(
                        "UUID 代次",
                        subtitle = profile?.let { "第 ${it.epoch} 代" } ?: "未注册设备",
                        icon = LineIcon.Key,
                        trailing = profile?.let {
                            "%02d:%02d".format(secondsToRotate / 60, secondsToRotate % 60)
                        },
                    )
                    Hairline(Modifier.padding(start = 18.dp))
                    ListRow(
                        "账户",
                        subtitle = profile?.accountName?.ifBlank { "—" } ?: "—",
                        icon = LineIcon.User,
                    )
                }
            }

            item { SectionTitle("安全") }
            item {
                Panel {
                    ListRow(
                        "立即锁定",
                        subtitle = "清空内存中的种子与令牌",
                        icon = LineIcon.Lock,
                        showChevron = true,
                        onClick = { vm.lock() },
                    )
                    Hairline(Modifier.padding(start = 18.dp))
                    ListRow(
                        "添加新设备",
                        subtitle = "通过 OAuth2 登录并注册",
                        icon = LineIcon.Plus,
                        showChevron = true,
                        onClick = { vm.navigate(Screen.Connect) },
                    )
                    Hairline(Modifier.padding(start = 18.dp))
                    ListRow(
                        "清除本机数据",
                        subtitle = "删除全部 CRI/CD 与设置",
                        icon = LineIcon.Trash,
                        trailingColor = StotpColors.Danger,
                        showChevron = true,
                        onClick = { confirmClear = true },
                    )
                }
            }

            item { SectionTitle("关于") }
            item {
                Panel {
                    Row(Modifier.padding(18.dp)) {
                        IconBadge(LineIcon.Shield, size = 44.dp)
                        Spacer(Modifier.padding(horizontal = 7.dp))
                        Column {
                            Text("STOTP", style = StotpType.Item, color = StotpColors.TextPrimary)
                            Spacer(Modifier.height(3.dp))
                            Text("Super-Enhanced TOTP · v1.0.0",
                                style = StotpType.Meta, color = StotpColors.TextSecondary)
                            Spacer(Modifier.height(8.dp))
                            Text(
                                "字体 Manrope 与 JetBrains Mono，均以 SIL Open Font License 授权。",
                                style = StotpType.Caption,
                                color = StotpColors.TextTertiary,
                            )
                        }
                    }
                }
            }
            item { Spacer(Modifier.height(12.dp)) }
        }

        BottomTabBar(
            selected = 1,
            onSelect = { index -> if (index == 0) vm.navigate(Screen.Home) },
            items = listOf(LineIcon.Shield to "验证码", LineIcon.Gear to "设置"),
            modifier = Modifier.align(androidx.compose.ui.Alignment.BottomCenter).navigationBarsPadding(),
        )
    }

    if (confirmClear) {
        AlertDialog(
            onDismissRequest = { confirmClear = false },
            title = { Text("清除本机数据？") },
            text = { Text("所有本地注册信息、描述文件与令牌都会被删除；云端注册不受影响。") },
            confirmButton = {
                TextButton(onClick = {
                    confirmClear = false
                    vm.clearAllData()
                }) { Text("清除", color = StotpColors.Danger) }
            },
            dismissButton = {
                TextButton(onClick = { confirmClear = false }) { Text("取消") }
            },
        )
    }
}
