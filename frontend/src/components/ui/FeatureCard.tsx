import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Gradients, Typography, Spacing, Radius, Shadow } from '../../constants/theme';

/**
 * A tappable feature tile for the Create hub. `highlight` gives it the premium
 * neon treatment: a cyan-bordered glassy card with a cyan→purple gradient icon
 * chip and a soft glow (used for the marquee features). `tag` shows a small cyan
 * pill. Non-highlight tiles use the same dark surface with a subtler border.
 */
export default function FeatureCard({
  icon,
  title,
  subtitle,
  onPress,
  highlight = false,
  tag,
  style,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
  highlight?: boolean;
  tag?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[
        styles.card,
        highlight ? styles.cardHighlight : styles.cardPlain,
        highlight ? Shadow.cta : Shadow.card,
        style,
      ]}
    >
      {highlight ? (
        <LinearGradient
          colors={Gradients.primary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.iconWrap}
        >
          <Ionicons name={icon} size={26} color={Colors.white} />
        </LinearGradient>
      ) : (
        <View style={[styles.iconWrap, styles.iconWrapPlain]}>
          <Ionicons name={icon} size={26} color={Colors.accentCyan} />
        </View>
      )}
      <View style={styles.textWrap}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{title}</Text>
          {tag ? (
            <View style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      <Ionicons
        name="chevron-forward"
        size={20}
        color={highlight ? Colors.accentCyan : Colors.textTertiary}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  cardPlain: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  cardHighlight: {
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.accentCyan,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapPlain: {
    backgroundColor: Colors.surfaceGlass,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  textWrap: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: {
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  tag: {
    backgroundColor: Colors.accentCyan,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  tagText: {
    fontSize: Typography.fontSizeXS,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textInverse,
  },
  subtitle: { fontSize: Typography.fontSizeSM, marginTop: 2, color: Colors.textSecondary },
});
