package com.endercraft.stotp.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp

private val StotpColorScheme = lightColorScheme(
    primary = StotpColors.Accent,
    onPrimary = StotpColors.Surface,
    secondary = StotpColors.TextSecondary,
    onSecondary = StotpColors.Surface,
    background = StotpColors.Ground,
    onBackground = StotpColors.TextPrimary,
    surface = StotpColors.Surface,
    onSurface = StotpColors.TextPrimary,
    surfaceVariant = StotpColors.Hover,
    onSurfaceVariant = StotpColors.TextSecondary,
    outline = StotpColors.Faint,
    outlineVariant = StotpColors.Hairline,
    error = StotpColors.Danger,
)

// 圆角阶梯：thumb 12 / sheet-button 16 / card 18 / panel 22 / hero 26
private val StotpShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(18.dp),
    large = RoundedCornerShape(22.dp),
    extraLarge = RoundedCornerShape(26.dp),
)

@Composable
fun StotpTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = StotpColorScheme,
        shapes = StotpShapes,
        content = content,
    )
}
