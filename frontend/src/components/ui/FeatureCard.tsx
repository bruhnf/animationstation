import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow } from '../../constants/theme';

/**
 * A tappable feature tile for the Create hub. `highlight` gives it the premium
 * gold-on-black treatment (used for the marquee features — Generate + Video).
 * `tag` shows a small gold pill.
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
  const titleColor = highlight ? Colors.white : Colors.black;
  const subColor = highlight ? Colors.gray200 : Colors.gray600;
  const iconColor = highlight ? Colors.black : Colors.goldText;
  const chevronColor = highlight ? Colors.gold : Colors.gray400;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.card, highlight ? styles.cardHighlight : styles.cardPlain, Shadow.card, style]}
    >
      <View style={[styles.iconWrap, highlight ? styles.iconWrapHighlight : styles.iconWrapPlain]}>
        <Ionicons name={icon} size={26} color={iconColor} />
      </View>
      <View style={styles.textWrap}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: titleColor }]}>{title}</Text>
          {tag ? (
            <View style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.subtitle, { color: subColor }]}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={chevronColor} />
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
  cardPlain: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.gray200 },
  cardHighlight: { backgroundColor: Colors.black, borderWidth: 1.5, borderColor: Colors.gold },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapPlain: { backgroundColor: Colors.goldSoft },
  iconWrapHighlight: { backgroundColor: Colors.gold },
  textWrap: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { fontSize: Typography.fontSizeLG, fontWeight: Typography.fontWeightBold },
  tag: {
    backgroundColor: Colors.gold,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  tagText: {
    fontSize: Typography.fontSizeXS,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  subtitle: { fontSize: Typography.fontSizeSM, marginTop: 2 },
});
