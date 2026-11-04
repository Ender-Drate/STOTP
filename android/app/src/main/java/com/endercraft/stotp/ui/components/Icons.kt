package com.endercraft.stotp.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.cos
import kotlin.math.sin

/**
 * 24×24 线性图标（Lucide 风格）：单一描边、圆角端点，颜色由 tint 决定。
 */
enum class LineIcon {
    Shield, Key, Gear, Plus, ChevronRight, ChevronLeft, Copy, Refresh,
    Check, Lock, Trash, Close, Clock, Device, Server, Fingerprint, User,
}

@Composable
fun LineIcon(
    icon: LineIcon,
    modifier: Modifier = Modifier,
    tint: Color = Color.Unspecified,
    size: Dp = 24.dp,
    stroke: Dp = 1.75.dp,
) {
    val color = if (tint == Color.Unspecified) Color(0xFF1D1D1F) else tint
    Canvas(modifier = modifier.size(size)) {
        val s = this.size.minDimension / 24f
        fun p(vararg points: Float): Path = Path().apply {
            moveTo(points[0] * s, points[1] * s)
            var i = 2
            while (i + 1 < points.size) {
                lineTo(points[i] * s, points[i + 1] * s)
                i += 2
            }
        }
        val strokeStyle = Stroke(width = stroke.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)

        when (icon) {
            LineIcon.Shield -> {
                val path = Path().apply {
                    moveTo(12 * s, 3.2f * s)
                    lineTo(19 * s, 6 * s)
                    lineTo(19 * s, 11 * s)
                    cubicTo(19 * s, 15.6f * s, 16 * s, 18.8f * s, 12 * s, 20.4f * s)
                    cubicTo(8 * s, 18.8f * s, 5 * s, 15.6f * s, 5 * s, 11 * s)
                    lineTo(5 * s, 6 * s)
                    close()
                }
                drawPath(path, color, style = strokeStyle)
            }
            LineIcon.Key -> {
                drawCircle(color, radius = 3.4f * s, center = Offset(8.2f * s, 8.2f * s), style = strokeStyle)
                drawPath(p(11f, 11f, 19f, 19f), color, style = strokeStyle)
                drawPath(p(15.4f, 15.4f, 17.6f, 13.2f), color, style = strokeStyle)
            }
            LineIcon.Gear -> {
                val rows = listOf(6.5f to 9f, 12f to 15f, 17.5f to 7f)
                for ((y, knob) in rows) {
                    drawLine(color, Offset(4 * s, y * s), Offset((knob - 2.6f) * s, y * s),
                        strokeWidth = stroke.toPx(), cap = StrokeCap.Round)
                    drawLine(color, Offset((knob + 2.6f) * s, y * s), Offset(20 * s, y * s),
                        strokeWidth = stroke.toPx(), cap = StrokeCap.Round)
                    drawCircle(color, radius = 2.4f * s, center = Offset(knob * s, y * s),
                        style = strokeStyle)
                }
            }
            LineIcon.Plus -> {
                drawPath(p(12f, 5f, 12f, 19f), color, style = strokeStyle)
                drawPath(p(5f, 12f, 19f, 12f), color, style = strokeStyle)
            }
            LineIcon.ChevronRight ->
                drawPath(p(9.5f, 5.5f, 16f, 12f, 9.5f, 18.5f), color, style = strokeStyle)
            LineIcon.ChevronLeft ->
                drawPath(p(14.5f, 5.5f, 8f, 12f, 14.5f, 18.5f), color, style = strokeStyle)
            LineIcon.Copy -> {
                val path = Path().apply {
                    moveTo(9.5f * s, 8.5f * s)
                    lineTo(20f * s, 8.5f * s)
                    lineTo(20f * s, 20f * s)
                    lineTo(9.5f * s, 20f * s)
                    close()
                }
                drawPath(path, color, style = strokeStyle)
                drawPath(p(15.5f, 8.5f, 15.5f, 4f, 4f, 4f, 4f, 14.5f, 8.5f, 14.5f), color, style = strokeStyle)
            }
            LineIcon.Refresh -> {
                drawArc(
                    color = color,
                    startAngle = 40f,
                    sweepAngle = 280f,
                    useCenter = false,
                    topLeft = Offset(4f * s, 4f * s),
                    size = androidx.compose.ui.geometry.Size(16f * s, 16f * s),
                    style = strokeStyle,
                )
                drawPath(p(18.6f, 5f, 19.4f, 10.6f, 14.2f, 9.2f), color, style = strokeStyle)
            }
            LineIcon.Check -> drawPath(p(5f, 12.5f, 10f, 17.5f, 19f, 7f), color, style = strokeStyle)
            LineIcon.Lock -> {
                val body = Path().apply {
                    moveTo(5.5f * s, 11f * s)
                    lineTo(18.5f * s, 11f * s)
                    lineTo(18.5f * s, 20f * s)
                    lineTo(5.5f * s, 20f * s)
                    close()
                }
                drawPath(body, color, style = strokeStyle)
                drawArc(
                    color, startAngle = 180f, sweepAngle = 180f, useCenter = false,
                    topLeft = Offset(8f * s, 5f * s),
                    size = androidx.compose.ui.geometry.Size(8f * s, 10f * s),
                    style = strokeStyle,
                )
            }
            LineIcon.Trash -> {
                drawPath(p(4.5f, 7f, 19.5f, 7f), color, style = strokeStyle)
                drawPath(p(9f, 7f, 9f, 4.5f, 15f, 4.5f, 15f, 7f), color, style = strokeStyle)
                drawPath(p(6.5f, 7f, 7.5f, 20f, 16.5f, 20f, 17.5f, 7f), color, style = strokeStyle)
            }
            LineIcon.Close -> {
                drawPath(p(6f, 6f, 18f, 18f), color, style = strokeStyle)
                drawPath(p(18f, 6f, 6f, 18f), color, style = strokeStyle)
            }
            LineIcon.Clock -> {
                drawCircle(color, radius = 8.4f * s, center = Offset(12 * s, 12 * s), style = strokeStyle)
                drawPath(p(12f, 6.8f, 12f, 12f, 15.6f, 14.2f), color, style = strokeStyle)
            }
            LineIcon.Device -> {
                val rect = Path().apply {
                    moveTo(7f * s, 3.5f * s)
                    lineTo(17f * s, 3.5f * s)
                    lineTo(17f * s, 20.5f * s)
                    lineTo(7f * s, 20.5f * s)
                    close()
                }
                drawPath(rect, color, style = strokeStyle)
                drawPath(p(10.5f, 17.5f, 13.5f, 17.5f), color, style = strokeStyle)
            }
            LineIcon.Server -> {
                val top = Path().apply {
                    moveTo(4f * s, 5f * s); lineTo(20f * s, 5f * s)
                    lineTo(20f * s, 10f * s); lineTo(4f * s, 10f * s); close()
                }
                val bottom = Path().apply {
                    moveTo(4f * s, 14f * s); lineTo(20f * s, 14f * s)
                    lineTo(20f * s, 19f * s); lineTo(4f * s, 19f * s); close()
                }
                drawPath(top, color, style = strokeStyle)
                drawPath(bottom, color, style = strokeStyle)
                drawCircle(color, radius = 0.9f * s, center = Offset(7f * s, 7.5f * s))
                drawCircle(color, radius = 0.9f * s, center = Offset(7f * s, 16.5f * s))
            }
            LineIcon.Fingerprint -> {
                drawArc(color, 200f, 140f, false, Offset(4f * s, 4f * s),
                    androidx.compose.ui.geometry.Size(16f * s, 16f * s), style = strokeStyle)
                drawArc(color, 160f, 200f, false, Offset(7f * s, 7f * s),
                    androidx.compose.ui.geometry.Size(10f * s, 10f * s), style = strokeStyle)
                drawArc(color, 180f, 180f, false, Offset(10f * s, 10f * s),
                    androidx.compose.ui.geometry.Size(4f * s, 4f * s), style = strokeStyle)
            }
            LineIcon.User -> {
                drawCircle(color, radius = 3.6f * s, center = Offset(12 * s, 8 * s),
                    style = strokeStyle)
                val body = Path().apply {
                    moveTo(5 * s, 20.5f * s)
                    cubicTo(5 * s, 16f * s, 8.2f * s, 13.2f * s, 12 * s, 13.2f * s)
                    cubicTo(15.8f * s, 13.2f * s, 19 * s, 16f * s, 19 * s, 20.5f * s)
                }
                drawPath(body, color, style = strokeStyle)
            }
        }
    }
}
