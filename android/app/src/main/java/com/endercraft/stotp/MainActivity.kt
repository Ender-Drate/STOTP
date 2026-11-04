package com.endercraft.stotp

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.endercraft.stotp.ui.theme.StotpColors
import com.endercraft.stotp.ui.theme.StotpTheme
import com.endercraft.stotp.ui.theme.StotpType

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            StotpTheme {
                ScaffoldHome()
            }
        }
    }
}

@Composable
private fun ScaffoldHome() {
    Surface(modifier = Modifier.fillMaxSize(), color = StotpColors.Ground) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .systemBarsPadding()
                .padding(horizontal = 24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Surface(
                modifier = Modifier.size(72.dp),
                shape = RoundedCornerShape(22.dp),
                color = StotpColors.Accent,
            ) {
                Column(
                    modifier = Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        text = "S",
                        color = Color.White,
                        fontSize = 36.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
            Spacer(Modifier.height(20.dp))
            Text(text = "STOTP", style = StotpType.LargeTitle, color = StotpColors.TextPrimary)
            Spacer(Modifier.height(6.dp))
            Text(
                text = "Super-Enhanced TOTP",
                style = StotpType.Meta,
                color = StotpColors.TextSecondary,
            )
            Spacer(Modifier.height(28.dp))
            Surface(
                modifier = Modifier
                    .clip(RoundedCornerShape(18.dp))
                    .background(StotpColors.Surface),
                color = StotpColors.Surface,
            ) {
                Text(
                    text = "工程骨架已就绪 · 服务端与客户端按 Issue 交付",
                    modifier = Modifier.padding(horizontal = 18.dp, vertical = 12.dp),
                    style = StotpType.Caption,
                    color = StotpColors.TextSecondary,
                )
            }
        }
    }
}
