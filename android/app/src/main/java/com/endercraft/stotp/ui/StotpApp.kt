package com.endercraft.stotp.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.endercraft.stotp.ui.screens.ConnectScreen
import com.endercraft.stotp.ui.screens.DetailScreen
import com.endercraft.stotp.ui.screens.HomeScreen
import com.endercraft.stotp.ui.screens.LockScreen
import com.endercraft.stotp.ui.screens.OAuthDialog
import com.endercraft.stotp.ui.screens.SettingsScreen
import com.endercraft.stotp.ui.screens.WelcomeScreen
import com.endercraft.stotp.ui.theme.StotpColors
import com.endercraft.stotp.ui.theme.StotpType
import kotlinx.coroutines.delay

@Composable
fun StotpApp(vm: StotpViewModel) {
    val state = vm.ui

    LaunchedEffect(Unit) {
        while (true) {
            delay(1000)
            vm.tick()
        }
    }

    BackHandler(
        enabled = state.authUrl == null &&
            (state.screen == Screen.Detail || state.screen == Screen.Settings ||
                state.screen == Screen.Connect),
    ) {
        vm.navigate(Screen.Home)
    }

    Box(Modifier.fillMaxSize().background(StotpColors.Ground)) {
        when (state.screen) {
            Screen.Welcome -> WelcomeScreen(
                busy = state.busy,
                onCreate = vm::createVault,
            )
            Screen.Lock -> LockScreen(
                busy = state.busy,
                error = state.error,
                onUnlock = vm::unlock,
            )
            Screen.Connect -> ConnectScreen(
                server = state.serverInput,
                deviceName = state.deviceName,
                busy = state.busy,
                onServerChange = vm::updateServer,
                onDeviceNameChange = vm::updateDeviceName,
                onContinue = vm::beginOAuth,
                onBack = { vm.navigate(Screen.Home) },
            )
            Screen.Home -> HomeScreen(state, vm)
            Screen.Settings -> SettingsScreen(state, vm)
            Screen.Detail -> DetailScreen(state, vm)
        }

        state.authUrl?.let { url ->
            OAuthDialog(
                url = url,
                onCallback = vm::completeOAuth,
                onDismiss = vm::cancelOAuth,
            )
        }

        val message = state.error ?: state.notice
        if (message != null && state.authUrl == null) {
            LaunchedEffect(message) {
                delay(3600)
                if (state.error != null) vm.showError(null) else vm.consumeNotice()
            }
            Surface(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(horizontal = 24.dp, vertical = 96.dp),
                shape = RoundedCornerShape(999.dp),
                color = if (state.error != null) StotpColors.Danger else StotpColors.TextPrimary,
                shadowElevation = 8.dp,
            ) {
                Text(
                    text = message,
                    modifier = Modifier.padding(horizontal = 18.dp, vertical = 10.dp),
                    style = StotpType.Meta,
                    color = Color.White,
                )
            }
        }
    }
}
