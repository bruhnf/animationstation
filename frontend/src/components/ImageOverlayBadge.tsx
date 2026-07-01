import React from 'react';
import { View, Text, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';

/**
 * Generic top-left overlay badge for image surfaces. Mirrors the visual style
 * of `AiGeneratedBadge` but accepts arbitrary text + icon — used to label
 * non-AI source images in the carousel (e.g. "Original clothing item",
 * "Original body view") so the AI disclosure on result images stays
 * unambiguous and reserved for actual AI-generated content.
 */
interface Props {
  label: string;
  iconName?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
}

export default function ImageOverlayBadge({ label, iconName, style }: Props) {
  return (
    <View style={[styles.overlay, style]} accessibilityLabel={label} accessibilityRole="text">
      {iconName ? <Ionicons name={iconName} size={10} color={Colors.white} /> : null}
      <Text style={styles.overlayText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: Spacing.sm,
    left: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  overlayText: {
    color: Colors.white,
    fontSize: 10,
    fontWeight: Typography.fontWeightSemiBold,
    letterSpacing: 0.3,
  },
});
