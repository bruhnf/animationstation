import React from 'react';
import { View, Text, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';

/**
 * Visible label indicating an image is AI-generated.
 *
 * Apple App Store Review Guideline 4.0 (Design) and 1.2 (Safety) increasingly
 * expect apps that generate or display synthetic media to clearly disclose it.
 * Use this on every AI result image surface (cards, detail views,
 * full-screen modals) so users always know what they're looking at.
 */
type Variant = 'overlay' | 'inline';
// 'corner' = top-left (default, for still images). 'center' = top-center, used
// over VIDEO so the badge doesn't sit on the native player's fullscreen/cast/
// scrubber controls (which live in the corners + bottom).
type Placement = 'corner' | 'center';

interface Props {
  variant?: Variant;
  placement?: Placement;
  style?: StyleProp<ViewStyle>;
}

export default function AiGeneratedBadge({
  variant = 'overlay',
  placement = 'corner',
  style,
}: Props) {
  const overlayStyle = placement === 'center' ? styles.overlayCenter : styles.overlay;
  return (
    <View
      style={[variant === 'overlay' ? overlayStyle : styles.inline, style]}
      accessibilityLabel="AI-generated image"
      accessibilityRole="text"
    >
      <Ionicons
        name="sparkles"
        size={variant === 'overlay' ? 10 : 12}
        color={variant === 'overlay' ? Colors.white : Colors.gray600}
      />
      <Text style={variant === 'overlay' ? styles.overlayText : styles.inlineText}>
        AI-generated
      </Text>
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
  // Top-center: an absolutely-positioned element with `alignSelf:'center'` and
  // no left/right is centered horizontally by Yoga within its parent. Sits at
  // the top edge, clear of the player's bottom scrubber and corner controls.
  overlayCenter: {
    position: 'absolute',
    top: Spacing.sm,
    alignSelf: 'center',
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
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  inlineText: {
    color: Colors.gray600,
    fontSize: Typography.fontSizeXS,
    fontWeight: Typography.fontWeightMedium,
  },
});
