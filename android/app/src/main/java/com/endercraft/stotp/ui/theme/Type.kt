package com.endercraft.stotp.ui.theme

import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * 排版规范：
 * - 大标题负字距（越大越负）
 * - 正文行高 ≥ 1.6（移动端 1.55–1.7）
 * - 数字一律 tabular-nums（等宽数字由 [Numeric] / [Mono] 承担）
 */
object StotpType {
    private val Sans = FontFamily.SansSerif
    private val MonoFamily = FontFamily.Monospace

    val LargeTitle = TextStyle(
        fontFamily = Sans,
        fontSize = 34.sp,
        lineHeight = 38.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = (-0.7).sp,
    )

    val Title = TextStyle(
        fontFamily = Sans,
        fontSize = 22.sp,
        lineHeight = 28.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = (-0.4).sp,
    )

    val Item = TextStyle(
        fontFamily = Sans,
        fontSize = 16.sp,
        lineHeight = 22.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = (-0.2).sp,
    )

    val Body = TextStyle(
        fontFamily = Sans,
        fontSize = 16.sp,
        lineHeight = 26.sp,
        fontWeight = FontWeight.Normal,
    )

    val Meta = TextStyle(
        fontFamily = Sans,
        fontSize = 13.sp,
        lineHeight = 20.sp,
        fontWeight = FontWeight.Normal,
    )

    val Caption = TextStyle(
        fontFamily = Sans,
        fontSize = 11.sp,
        lineHeight = 15.sp,
        fontWeight = FontWeight.Medium,
        letterSpacing = 0.2.sp,
    )

    val Mono = TextStyle(
        fontFamily = MonoFamily,
        fontSize = 15.sp,
        lineHeight = 22.sp,
        fontWeight = FontWeight.Medium,
    )

    val Code = TextStyle(
        fontFamily = MonoFamily,
        fontSize = 52.sp,
        lineHeight = 60.sp,
        fontWeight = FontWeight.Medium,
        letterSpacing = 4.sp,
    )
}
