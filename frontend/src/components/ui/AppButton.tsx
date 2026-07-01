import React from 'react';
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  View,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow } from '../../constants/theme';

type Variant = 'primary' | 'dark' | 'outline' | 'ghost' | 'danger';
type Size = 'lg' | 'md' | 'sm';

export interface AppButtonProps {
  title: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

const HEIGHTS: Record<Size, number> = { lg: 56, md: 48, sm: 38 };
const FONTS: Record<Size, number> = {
  lg: Typography.fontSizeLG,
  md: Typography.fontSizeMD,
  sm: Typography.fontSizeSM,
};

/**
 * The single button primitive for the redesign. Variants keep CTA styling
 * consistent: `primary` (accent) and `dark` (black) for main actions, `outline`
 * / `ghost` for secondary, `danger` for destructive.
 */
export default function AppButton({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  disabled = false,
  loading = false,
  fullWidth = false,
  style,
}: AppButtonProps) {
  const bg =
    variant === 'primary'
      ? Colors.accent
      : variant === 'dark'
        ? Colors.black
        : variant === 'danger'
          ? Colors.danger
          : 'transparent';
  const fg =
    variant === 'primary'
      ? Colors.black // black text on the bright-gold fill
      : variant === 'dark' || variant === 'danger'
        ? Colors.white
        : variant === 'ghost'
          ? Colors.accentText // dark gold link text
          : Colors.black; // outline
  const border = variant === 'outline' ? Colors.gray300 : 'transparent';

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      style={[
        styles.base,
        {
          height: HEIGHTS[size],
          backgroundColor: bg,
          borderColor: border,
          borderWidth: variant === 'outline' ? 1.5 : 0,
          opacity: disabled ? 0.45 : 1,
          alignSelf: fullWidth ? 'stretch' : 'auto',
          paddingHorizontal: size === 'sm' ? Spacing.md : Spacing.lg,
        },
        variant === 'primary' && !disabled ? Shadow.cta : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Ionicons name={icon} size={FONTS[size] + 4} color={fg} /> : null}
          <Text style={[styles.label, { color: fg, fontSize: FONTS[size] }]}>{title}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  label: { fontWeight: Typography.fontWeightBold },
});
