package com.endercraft.stotp

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import com.endercraft.stotp.ui.StotpApp
import com.endercraft.stotp.ui.StotpViewModel
import com.endercraft.stotp.ui.theme.StotpTheme

class MainActivity : ComponentActivity() {
    private val vm: StotpViewModel by viewModels()
    private var backgroundAt = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            StotpTheme {
                StotpApp(vm)
            }
        }
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        val data = intent?.data?.toString() ?: return
        if (data.startsWith("stotp://oauth/callback")) {
            vm.completeOAuth(data)
        }
    }

    override fun onStop() {
        super.onStop()
        backgroundAt = System.currentTimeMillis()
    }

    override fun onStart() {
        super.onStart()
        if (backgroundAt > 0 && System.currentTimeMillis() - backgroundAt > 60_000) {
            vm.lock()
        }
        backgroundAt = 0
    }
}
