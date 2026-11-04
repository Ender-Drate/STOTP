package com.endercraft.stotp.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.endercraft.stotp.ui.StotpViewModel
import com.endercraft.stotp.ui.UiState
import com.endercraft.stotp.ui.components.Badge
import com.endercraft.stotp.ui.components.CodeRing
import com.endercraft.stotp.ui.components.CodeText
import com.endercraft.stotp.ui.components.Hairline
import com.endercraft.stotp.ui.components.IconBadge
import com.endercraft.stotp.ui.components.LineIcon
import com.endercraft.stotp.ui.components.ListRow
import com.endercraft.stotp.ui.components.Panel
import com.endercraft.stotp.ui.components.PrimaryButton
import com.endercraft.stotp.ui.components.SecondaryButton
import com.endercraft.stotp.ui.components.SectionTitle
import com.endercraft.stotp.ui.components.pressScale
import com.endercraft.stotp.ui.theme.StotpColors
import com.endercraft.stotp.ui.theme.StotpType

@Composable
fun DetailScreen(state: UiState, vm: StotpViewModel) {
    val profile = state.selected
    val context = LocalContext.current
    var confirmRemove by remember { mutableStateOf(false) }
    var confirmRevoke by remember { mutableStateOf(false) }

    if (profile == null) {
        androidx.compose.runtime.LaunchedEffect(Unit) {
            vm.navigate(com.endercraft.stotp.ui.Screen.Home)
        }
        return
    }

    val now = System.currentTimeMillis() / 1000
    val secondsToRotate = ((profile.epoch + 1) * 3600 - now).coerceAtLeast(0)
    val code = vm.codeFor(profile)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(StotpColors.Ground)
            .statusBarsPadding(),
    ) {
        DetailTopBar(profile.name, onBack = { vm.navigate(com.endercraft.stotp.ui.Screen.Home) })
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(horizontal = 20.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Panel {
                Column(Modifier.padding(22.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(profile.accountName.ifBlank { "STOTP 账户" },
                                style = StotpType.Meta, color = StotpColors.TextSecondary)
                            Spacer(Modifier.height(4.dp))
                            Text(hostOf(profile.server), style = StotpType.Item,
                                color = StotpColors.TextPrimary)
                        }
                        if (profile.status == "active") {
                            Badge("已激活", StotpColors.Live)
                        } else {
                            Badge("已吊销", StotpColors.Danger)
                        }
                    }
                    Spacer(Modifier.height(20.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        CodeText(code)
                        CodeRing(vm.remainingSeconds())
                    }
                    Spacer(Modifier.height(14.dp))
                    Text(
                        "验证码每 30 秒刷新，仅在本地计算。",
                        style = StotpType.Caption,
                        color = StotpColors.TextTertiary,
                    )
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        SmallPill("复制", LineIcon.Copy) {
                            copyToClipboard(context, code)
                            vm.notify("验证码已复制")
                        }
                        SmallPill("在线校验", LineIcon.Refresh) { vm.verifyNow() }
                    }
                }
            }

            state.verify?.let { outcome ->
                Panel {
                    Row(
                        Modifier.padding(18.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        IconBadge(
                            if (outcome.ok) LineIcon.Check else LineIcon.Close,
                            tint = if (outcome.ok) StotpColors.Live else StotpColors.Danger,
                            size = 38.dp,
                        )
                        Spacer(Modifier.width(14.dp))
                        Column {
                            Text(outcome.label, style = StotpType.Item,
                                color = StotpColors.TextPrimary)
                            Spacer(Modifier.height(2.dp))
                            Text(
                                if (outcome.ok) "云端注册态、UUID 与验证码一致"
                                else "原因代码：${outcome.reason}",
                                style = StotpType.Meta,
                                color = StotpColors.TextSecondary,
                            )
                        }
                    }
                }
            }

            SectionTitle("设备信息", Modifier.padding(top = 2.dp))
            Panel {
                ListRow("服务端", subtitle = profile.server, icon = LineIcon.Server)
                Hairline(Modifier.padding(start = 18.dp))
                ListRow("账户", subtitle = profile.accountId.ifBlank { "—" },
                    icon = LineIcon.User)
                Hairline(Modifier.padding(start = 18.dp))
                ListRow("注册时间", subtitle = profile.createdAt, icon = LineIcon.Clock)
                Hairline(Modifier.padding(start = 18.dp))
                ListRow(
                    "UUID 代次",
                    subtitle = "第 ${profile.epoch} 代 · 每小时轮换",
                    icon = LineIcon.Key,
                    trailing = "%02d:%02d".format(secondsToRotate / 60, secondsToRotate % 60),
                )
                Hairline(Modifier.padding(start = 18.dp))
                ListRow("设备 ID", subtitle = profile.id, icon = LineIcon.Device)
            }

            SectionTitle("操作", Modifier.padding(top = 2.dp))
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                PrimaryButton(
                    text = "在线校验",
                    onClick = { vm.verifyNow() },
                    loading = state.busy,
                    enabled = profile.status == "active",
                )
                SecondaryButton("强制轮换 UUID", {
                    vm.rotateNow()
                })
                SecondaryButton("吊销设备", { confirmRevoke = true }, danger = true)
            }
            Text(
                "吊销后该设备的描述文件立即失效，需要重新注册；强制轮换会提升 min_epoch，客户端同步后自动跳代。",
                style = StotpType.Caption,
                color = StotpColors.TextTertiary,
            )
            Text(
                "从本机移除",
                style = StotpType.Item,
                color = StotpColors.Danger,
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { confirmRemove = true }
                    .padding(vertical = 12.dp),
            )
            Spacer(Modifier.height(28.dp))
        }
    }

    if (confirmRemove) {
        AlertDialog(
            onDismissRequest = { confirmRemove = false },
            title = { Text("从本机移除？") },
            text = { Text("本地 CRI/CD 会被删除，云端注册不受影响。") },
            confirmButton = {
                TextButton(onClick = {
                    confirmRemove = false
                    vm.removeCurrent()
                }) { Text("移除", color = StotpColors.Danger) }
            },
            dismissButton = {
                TextButton(onClick = { confirmRemove = false }) { Text("取消") }
            },
        )
    }
    if (confirmRevoke) {
        AlertDialog(
            onDismissRequest = { confirmRevoke = false },
            title = { Text("吊销此设备？") },
            text = { Text("云端会立即将该客户端标记为 revoked，描述文件永久失效。") },
            confirmButton = {
                TextButton(onClick = {
                    confirmRevoke = false
                    vm.revokeCurrent()
                }) { Text("吊销", color = StotpColors.Danger) }
            },
            dismissButton = {
                TextButton(onClick = { confirmRevoke = false }) { Text("取消") }
            },
        )
    }
}

@Composable
private fun DetailTopBar(title: String, onBack: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(StotpColors.Ground.copy(alpha = 0.96f))
    ) {
        Row(
            Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val interaction = remember { MutableInteractionSource() }
            Box(
                Modifier
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(12.dp))
                    .clickable(interactionSource = interaction, indication = null, onClick = onBack)
                    .pressScale(interaction)
                    .padding(horizontal = 14.dp),
                contentAlignment = Alignment.Center,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    LineIcon(LineIcon.ChevronLeft, tint = StotpColors.TextPrimary, size = 21.dp)
                    Spacer(Modifier.width(2.dp))
                    Text("返回", style = StotpType.Meta, color = StotpColors.TextPrimary)
                }
            }
            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                Text(title, style = StotpType.Item, color = StotpColors.TextPrimary,
                    maxLines = 1)
            }
            Spacer(Modifier.width(72.dp))
        }
        Hairline()
    }
}

@Composable
private fun SmallPill(text: String, kind: LineIcon, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(StotpColors.Hover)
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .pressScale(interaction)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LineIcon(kind, tint = StotpColors.Accent, size = 15.dp)
        Spacer(Modifier.width(6.dp))
        Text(text, style = StotpType.Caption, color = StotpColors.Accent)
    }
}
