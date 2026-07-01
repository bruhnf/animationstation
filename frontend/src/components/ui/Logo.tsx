import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Gradients, Typography } from '../../constants/theme';

// AnimationStation wordmark: a neon gradient "stacked layers" mark + the name,
// with "Station" in cyan to echo the cyan→purple accent language. `height`
// scales the mark; the text sizes relative to it. Pass `markOnly` for a compact
// avatar/badge use.
export default function Logo({
  height = 28,
  markOnly = false,
}: {
  height?: number;
  markOnly?: boolean;
}) {
  const mark = (
    <LinearGradient
      colors={Gradients.primary}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.mark, { width: height, height, borderRadius: height * 0.28 }]}
    >
      <Ionicons name="layers" size={height * 0.58} color={Colors.white} />
    </LinearGradient>
  );

  if (markOnly) return mark;

  return (
    <View style={styles.row}>
      {mark}
      <Text style={[styles.word, { fontSize: height * 0.66 }]}>
        Animation<Text style={{ color: Colors.accentCyan }}>Station</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mark: { alignItems: 'center', justifyContent: 'center' },
  word: {
    color: Colors.textPrimary,
    fontWeight: Typography.fontWeightHeavy,
    letterSpacing: -0.3,
  },
});
