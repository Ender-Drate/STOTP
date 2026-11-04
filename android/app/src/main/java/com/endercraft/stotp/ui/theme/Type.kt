package com.endercraft.stotp.ui.theme

import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.endercraft.stotp.R

/**
 * 字体：Manrope 承担 UI（接近 SF 的几何人文体），JetBrains Mono 承担数字与验证码。
 * 中文由系统字体回退渲染。
 */
val Manrope = FontFamily(
    Font(R.font.manrope_400, FontWeight.Normal),
    Font(R.font.manrope_500, FontWeight.Medium),
    Font(R.font.manrope_600, FontWeight.SemiBold),
    Font(R.font.manrope_700, FontWeight.Bold),
)

val MonoFont = FontFamily(
    Font(R.font.jetbrains_mono_400, FontWeight.Normal),
    Font(R.font.jetbrains_mono_500, FontWeight.Medium),
)

/**
 * 排版规范：
 * - 大标题负字距（越大越负）
 * - 正文行高 ≥ 1.55（移动端）
 * - 数字一律等宽（Mono 字体）
 */
object StotpType {
    val LargeTitle = TextStyle(
        fontFamily = Manrope,
        fontSize = 34.sp,
        lineHeight = 38.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = (-0.7).sp,
    )

    val Title = TextStyle(
        fontFamily = Manrope,
        fontSize = 22.sp,
        lineHeight = 28.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = (-0.4).sp,
    )

    val Item = TextStyle(
        fontFamily = Manrope,
        fontSize = 16.sp,
        lineHeight = 22.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = (-0.2).sp,
    )

    val Body = TextStyle(
        fontFamily = Manrope,
        fontSize = 16.sp,
        lineHeight = 26.sp,
        fontWeight = FontWeight.Normal,
    )

    val Meta = TextStyle(
        fontFamily = Manrope,
        fontSize = 13.sp,
        lineHeight = 20.sp,
        fontWeight = FontWeight.Normal,
    )

    val Caption = TextStyle(
        fontFamily = Manrope,
        fontSize = 11.sp,
        lineHeight = 15.sp,
        fontWeight = FontWeight.Medium,
        letterSpacing = 0.2.sp,
    )

    val Mono = TextStyle(
        fontFamily = MonoFont,
        fontSize = 15.sp,
        lineHeight = 22.sp,
        fontWeight = FontWeight.Medium,
        letterSpacing = 0.6.sp,
    )

    val Code = TextStyle(
        fontFamily = MonoFont,
        fontSize = 50.sp,
        lineHeight = 58.sp,
        fontWeight = FontWeight.Medium,
        letterSpacing = 3.sp,
    )

    val CodeSmall = TextStyle(
        fontFamily = MonoFont,
        fontSize = 17.sp,
        lineHeight = 22.sp,
        fontWeight = FontWeight.Medium,
        letterSpacing = 1.sp,
    )
}
