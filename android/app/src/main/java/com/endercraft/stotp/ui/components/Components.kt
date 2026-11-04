package com.endercraft.stotp.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.endercraft.stotp.ui.theme.StotpColors
import com.endercraft.stotp.ui.theme.StotpType

/** 白色统一面板：22 圆角 + 双层阴影。 */
@Composable
fun Panel(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(22.dp)
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .shadow(
                elevation = 10.dp,
                shape = shape,
                clip = false,
                ambientColor = Color.Black.copy(alpha = 0.04f),
                spotColor = Color.Black.copy(alpha = 0.05f),
            ),
        shape = shape,
        color = StotpColors.Surface,
        content = { Column(content = content) },
    )
}

@Composable
fun Hairline(modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .height(0.5.dp)
            .background(StotpColors.Hairline)
    )
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        modifier = modifier.padding(start = 20.dp, bottom = 8.dp),
        style = StotpType.Caption,
        color = StotpColors.TextSecondary,
    )
}

@Composable
fun Modifier.pressScale(
    interactionSource: MutableInteractionSource,
    pressedScale: Float = 0.98f,
): Modifier {
    val pressed by interactionSource.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) pressedScale else 1f,
        label = "pressScale",
    )
    return this.scale(scale)
}

@Composable
fun ListRow(
    title: String,
    subtitle: String? = null,
    icon: LineIcon? = null,
    trailing: String? = null,
    trailingColor: Color = StotpColors.TextSecondary,
    showChevron: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    val interaction = remember { MutableInteractionSource() }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .then(
                if (onClick != null) {
                    Modifier
                        .clickable(interactionSource = interaction, indication = null,
                            onClick = onClick)
                        .pressScale(interaction)
                } else Modifier
            )
            .heightIn(min = 56.dp)
            .padding(horizontal = 18.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        if (icon != null) {
            LineIcon(icon, tint = StotpColors.TextSecondary, size = 21.dp)
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = StotpType.Item, color = StotpColors.TextPrimary)
            if (subtitle != null) {
                Spacer(Modifier.height(2.dp))
                Text(subtitle, style = StotpType.Meta, color = StotpColors.TextSecondary)
            }
        }
        if (trailing != null) {
            Text(trailing, style = StotpType.Mono, color = trailingColor)
        }
        if (showChevron) {
            LineIcon(LineIcon.ChevronRight, tint = StotpColors.Faint, size = 18.dp)
        }
    }
}

@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
) {
    val interaction = remember { MutableInteractionSource() }
    val background = if (enabled) StotpColors.Accent else StotpColors.Track
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .height(52.dp)
            .clickable(
                interactionSource = interaction,
                indication = null,
                enabled = enabled && !loading,
                onClick = onClick,
            )
            .pressScale(interaction, 0.985f),
        shape = RoundedCornerShape(999.dp),
        color = background,
        contentColor = if (enabled) Color.White else StotpColors.TextTertiary,
    ) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            if (loading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    color = Color.White,
                    strokeWidth = 2.dp,
                )
            } else {
                Text(text, style = StotpType.Item, color = ContentColor)
            }
        }
    }
}

private val ContentColor: Color = Color.White

@Composable
fun SecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    danger: Boolean = false,
) {
    val interaction = remember { MutableInteractionSource() }
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .height(50.dp)
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .pressScale(interaction, 0.985f),
        shape = RoundedCornerShape(999.dp),
        color = StotpColors.Surface,
        border = androidx.compose.foundation.BorderStroke(0.5.dp, StotpColors.Hairline),
    ) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(
                text,
                style = StotpType.Item,
                color = if (danger) StotpColors.Danger else StotpColors.TextPrimary,
            )
        }
    }
}

@Composable
fun StotpTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    isPassword: Boolean = false,
    keyboardType: KeyboardType = KeyboardType.Text,
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(12.dp)
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier
            .fillMaxWidth()
            .height(48.dp)
            .background(if (focused) StotpColors.Surface else StotpColors.Hover, shape)
            .border(
                width = 1.dp,
                color = if (focused) StotpColors.Accent else StotpColors.Hairline,
                shape = shape,
            )
            .padding(horizontal = 14.dp),
        textStyle = StotpType.Body.copy(color = StotpColors.TextPrimary),
        singleLine = true,
        cursorBrush = SolidColor(StotpColors.Accent),
        interactionSource = interaction,
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        visualTransformation = if (isPassword) PasswordVisualTransformation()
        else VisualTransformation.None,
        decorationBox = { inner ->
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.CenterStart) {
                if (value.isEmpty()) {
                    Text(placeholder, style = StotpType.Body, color = StotpColors.TextQuaternary)
                }
                inner()
            }
        },
    )
}

@Composable
fun FieldLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        modifier = modifier.padding(start = 2.dp, bottom = 7.dp),
        style = StotpType.Caption,
        color = StotpColors.TextSecondary,
    )
}

@Composable
fun LiveDot(color: Color = StotpColors.Live, size: Dp = 6.dp) {
    Box(Modifier.size(size).background(color, CircleShape))
}

@Composable
fun Badge(text: String, color: Color = StotpColors.Accent) {
    Box(
        Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(color.copy(alpha = 0.09f))
            .padding(horizontal = 9.dp, vertical = 3.dp)
    ) {
        Text(text, style = StotpType.Caption, color = color)
    }
}

/** 30 秒倒计时环。 */
@Composable
fun CodeRing(
    remainingSeconds: Int,
    period: Int = 30,
    size: Dp = 46.dp,
) {
    val progress = (remainingSeconds.toFloat() / period).coerceIn(0f, 1f)
    Box(Modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val stroke = 3.dp.toPx()
            drawCircle(
                color = StotpColors.Track,
                radius = (this.size.minDimension - stroke) / 2,
                style = Stroke(width = stroke),
            )
            drawArc(
                color = StotpColors.Accent,
                startAngle = -90f,
                sweepAngle = 360f * progress,
                useCenter = false,
                topLeft = Offset(stroke / 2, stroke / 2),
                size = Size(this.size.width - stroke, this.size.height - stroke),
                style = Stroke(width = stroke, cap = StrokeCap.Round),
            )
        }
        Text(
            text = remainingSeconds.toString(),
            style = StotpType.Caption,
            color = StotpColors.TextSecondary,
        )
    }
}

@Composable
fun IconBadge(icon: LineIcon, tint: Color = StotpColors.Accent, size: Dp = 36.dp) {
    Box(
        Modifier
            .size(size)
            .clip(RoundedCornerShape(12.dp))
            .background(tint.copy(alpha = 0.09f)),
        contentAlignment = Alignment.Center,
    ) {
        LineIcon(icon, tint = tint, size = 20.dp)
    }
}

@Composable
fun RowScope.TabItem(
    icon: LineIcon,
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val tint = if (selected) StotpColors.Accent else StotpColors.TextTertiary
    Column(
        modifier = Modifier
            .weight(1f)
            .height(58.dp)
            .clickable(indication = null, interactionSource = remember { MutableInteractionSource() },
                onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        LineIcon(icon, tint = tint, size = 24.dp)
        Spacer(Modifier.height(3.dp))
        Text(label, style = StotpType.Caption, color = tint)
    }
}

@Composable
fun BottomTabBar(
    selected: Int,
    onSelect: (Int) -> Unit,
    items: List<Pair<LineIcon, String>>,
    modifier: Modifier = Modifier,
) {
    Surface(modifier = modifier.fillMaxWidth(), color = StotpColors.Ground.copy(alpha = 0.94f)) {
        Column {
            Hairline()
            Row(Modifier.fillMaxWidth()) {
                items.forEachIndexed { index, (icon, label) ->
                    TabItem(icon, label, index == selected) { onSelect(index) }
                }
            }
        }
    }
}

@Composable
fun ScreenTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier = modifier, style = StotpType.LargeTitle, color = StotpColors.TextPrimary)
}

@Composable
fun MetaText(text: String, modifier: Modifier = Modifier, color: Color = StotpColors.TextSecondary) {
    Text(text, modifier = modifier, style = StotpType.Meta, color = color)
}

@Composable
fun CodeText(code: String, modifier: Modifier = Modifier) {
    Text(code.chunked(3).joinToString(" "), modifier = modifier, style = StotpType.Code,
        color = StotpColors.TextPrimary)
}

@Composable
fun EmptyState(
    icon: LineIcon,
    title: String,
    message: String,
    action: @Composable () -> Unit,
) {
    Panel {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 22.dp, vertical = 30.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            IconBadge(icon, tint = StotpColors.Accent, size = 48.dp)
            Spacer(Modifier.height(16.dp))
            Text(title, style = StotpType.Item, color = StotpColors.TextPrimary)
            Spacer(Modifier.height(6.dp))
            Text(
                message,
                style = StotpType.Meta,
                color = StotpColors.TextSecondary,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
            Spacer(Modifier.height(20.dp))
            Box(Modifier.width(180.dp)) { action() }
        }
    }
}

@Composable
fun SpacerH(height: Dp) = Spacer(Modifier.height(height))
