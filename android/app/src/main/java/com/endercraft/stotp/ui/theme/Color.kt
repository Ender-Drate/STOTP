package com.endercraft.stotp.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Apple Liquid Glass 调色板。
 * 规则：body 世界只有黑白灰，颜色只用于 accent / live / heat。
 */
object StotpColors {
    val Ground = Color(0xFFF5F5F7)
    val Surface = Color(0xFFFFFFFF)
    val Hover = Color(0xFFFBFBFD)

    val TextPrimary = Color(0xFF1D1D1F)
    val TextBody = Color(0xFF424245)
    val TextSecondary = Color(0xFF6E6E73)
    val TextTertiary = Color(0xFF86868B)
    val TextQuaternary = Color(0xFFAEAEB2)
    val Faint = Color(0xFFD2D2D7)

    val Hairline = Color(0x12000000)   // rgba(0,0,0,0.07)
    val Track = Color(0xFFE8E8ED)

    val Accent = Color(0xFF0071E3)
    val AccentPressed = Color(0xFF0066CC)
    val Indigo = Color(0xFF5E5CE6)
    val Live = Color(0xFF30D158)
    val Danger = Color(0xFFFF3B30)
    val Heat = Color(0xFFFF6B00)
}
