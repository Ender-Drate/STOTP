package com.endercraft.stotp.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.endercraft.stotp.core.Profile
import com.endercraft.stotp.ui.Screen
import com.endercraft.stotp.ui.StotpViewModel
import com.endercraft.stotp.ui.UiState
import com.endercraft.stotp.ui.components.Badge
import com.endercraft.stotp.ui.components.BottomTabBar
import com.endercraft.stotp.ui.components.CodeRing
import com.endercraft.stotp.ui.components.CodeText
import com.endercraft.stotp.ui.components.EmptyState
import com.endercraft.stotp.ui.components.Hairline
import com.endercraft.stotp.ui.components.IconBadge
import com.endercraft.stotp.ui.components.LineIcon
import com.endercraft.stotp.ui.components.ListRow
import com.endercraft.stotp.ui.components.LiveDot
import com.endercraft.stotp.ui.components.Panel
import com.endercraft.stotp.ui.components.PrimaryButton
import com.endercraft.stotp.ui.components.ScreenTitle
import com.endercraft.stotp.ui.components.SectionTitle
import com.endercraft.stotp.ui.components.pressScale
import com.endercraft.stotp.ui.theme.StotpColors
import com.endercraft.stotp.ui.theme.StotpType

fun copyToClipboard(context: Context, text: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("STOTP", text))
}

fun hostOf(server: String): String =
    runCatching { android.net.Uri.parse(server).host }.getOrNull() ?: server

fun formatCode(code: String): String =
    if (code.length == 6) "${code.substring(0, 3)} ${code.substring(3)}" else code

@Composable
fun HomeScreen(state: UiState, vm: StotpViewModel) {
    val listState = rememberLazyListState()
    val collapsed by remember {
        derivedStateOf {
            listState.firstVisibleItemIndex > 0 || listState.firstVisibleItemScrollOffset > 24
        }
    }
    val context = LocalContext.current
    val selected = state.selected

    Box(Modifier.fillMaxSize().background(StotpColors.Ground)) {
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize().statusBarsPadding(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 132.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item {
                HomeHeader(
                    count = state.profiles.size,
                    onAdd = { vm.navigate(Screen.Connect) },
                )
            }
            item {
                if (selected != null) {
                    CodeCard(
                        profile = selected,
                        code = vm.codeFor(selected),
                        remaining = vm.remainingSeconds(),
                        onClick = {
                            vm.selectProfile(selected.id)
                            vm.navigate(Screen.Detail)
                        },
                        onCopy = {
                            copyToClipboard(context, vm.codeFor(selected))
                            vm.notify("验证码已复制")
                        },
                    )
                } else {
                    EmptyState(
                        icon = LineIcon.Plus,
                        title = "还没有注册设备",
                        message = "连接 STOTP 服务端，登录后会自动生成本机注册信息与描述文件。",
                    ) {
                        PrimaryButton("添加设备", { vm.navigate(Screen.Connect) })
                    }
                }
            }
            if (state.profiles.isNotEmpty()) {
                item { SectionTitle("全部设备", Modifier.padding(top = 4.dp)) }
                item {
                    Panel {
                        state.profiles.forEachIndexed { index, profile ->
                            if (index > 0) Hairline(Modifier.padding(start = 18.dp))
                            ListRow(
                                title = profile.name,
                                subtitle = hostOf(profile.server) +
                                    if (profile.status != "active") " · 已吊销" else "",
                                icon = LineIcon.Shield,
                                trailing = formatCode(vm.codeFor(profile)),
                                trailingColor = if (profile.status == "active")
                                    StotpColors.TextPrimary else StotpColors.TextQuaternary,
                                showChevron = true,
                                onClick = {
                                    vm.selectProfile(profile.id)
                                    vm.navigate(Screen.Detail)
                                },
                            )
                        }
                    }
                }
            }
            item {
                Text(
                    "验证码在本地离线生成；UUID 每小时自动轮换，旧代次立即作废。",
                    style = StotpType.Caption,
                    color = StotpColors.TextTertiary,
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 6.dp),
                )
            }
        }

        // 滚动后出现的紧凑导航条（液态玻璃）
        AnimatedVisibility(
            visible = collapsed,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.TopCenter),
        ) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(StotpColors.Ground.copy(alpha = 0.94f))
                    .statusBarsPadding()
            ) {
                Box(Modifier.fillMaxWidth().height(50.dp), contentAlignment = Alignment.Center) {
                    Text("验证码", style = StotpType.Item, color = StotpColors.TextPrimary)
                }
                Hairline()
            }
        }

        BottomTabBar(
            selected = 0,
            onSelect = { index -> if (index == 1) vm.navigate(Screen.Settings) },
            items = listOf(LineIcon.Shield to "验证码", LineIcon.Gear to "设置"),
            modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding(),
        )
    }
}

@Composable
private fun HomeHeader(count: Int, onAdd: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            ScreenTitle("验证码")
            Spacer(Modifier.height(2.dp))
            Text(
                if (count == 0) "尚未注册设备" else "$count 台设备 · 与云端同步",
                style = StotpType.Meta,
                color = StotpColors.TextSecondary,
            )
        }
        val interaction = remember { MutableInteractionSource() }
        Box(
            modifier = Modifier
                .size(44.dp)
                .shadow(8.dp, CircleShape, clip = false,
                    ambientColor = Color.Black.copy(alpha = 0.05f),
                    spotColor = Color.Black.copy(alpha = 0.08f))
                .clip(CircleShape)
                .background(StotpColors.Surface)
                .clickable(interactionSource = interaction, indication = null, onClick = onAdd)
                .pressScale(interaction),
            contentAlignment = Alignment.Center,
        ) {
            LineIcon(LineIcon.Plus, tint = StotpColors.TextPrimary, size = 22.dp)
        }
    }
}

@Composable
private fun CodeCard(
    profile: Profile,
    code: String,
    remaining: Int,
    onClick: () -> Unit,
    onCopy: () -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    Panel(
        modifier = Modifier
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .pressScale(interaction, 0.99f)
    ) {
        Column(Modifier.padding(22.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconBadge(LineIcon.Shield)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(profile.name, style = StotpType.Item, color = StotpColors.TextPrimary,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Spacer(Modifier.height(2.dp))
                    Text(hostOf(profile.server), style = StotpType.Meta,
                        color = StotpColors.TextSecondary)
                }
                if (profile.status == "active") {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        LiveDot()
                        Spacer(Modifier.width(6.dp))
                        Text("已同步", style = StotpType.Caption, color = StotpColors.TextSecondary)
                    }
                } else {
                    Badge("已吊销", StotpColors.Danger)
                }
            }
            Spacer(Modifier.height(22.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                CodeText(code)
                CodeRing(remaining, 30)
            }
            Spacer(Modifier.height(18.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "每 30 秒刷新 · UUID 每小时轮换",
                    style = StotpType.Caption,
                    color = StotpColors.TextTertiary,
                    modifier = Modifier.weight(1f),
                )
                CopyPill(onCopy)
            }
        }
    }
}

@Composable
private fun CopyPill(onCopy: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(StotpColors.Hover)
            .clickable(interactionSource = interaction, indication = null, onClick = onCopy)
            .pressScale(interaction)
            .padding(horizontal = 12.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LineIcon(LineIcon.Copy, tint = StotpColors.Accent, size = 15.dp)
        Spacer(Modifier.width(6.dp))
        Text("复制", style = StotpType.Caption, color = StotpColors.Accent)
    }
}
