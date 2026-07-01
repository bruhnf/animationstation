import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUserStore } from '../store/useUserStore';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';

interface CreditDisplayProps {
  onPress?: () => void;
}

export default function CreditDisplay({ onPress }: CreditDisplayProps) {
  const user = useUserStore((s) => s.user);

  if (!user) return null;

  const content = (
    <View style={styles.container}>
      <Ionicons name="flash" size={14} color={Colors.white} />
      <Text style={styles.text}>{user.credits}</Text>
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        accessibilityRole="button"
        accessibilityLabel="Credits"
      >
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.black,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
    gap: 4,
  },
  text: {
    color: Colors.white,
    fontSize: Typography.fontSizeSM,
    fontWeight: '600',
  },
});
