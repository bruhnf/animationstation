import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';

export type UploadTipsKind = 'clothing' | 'body';

interface Props {
  visible: boolean;
  kind: UploadTipsKind;
  onClose: () => void;
}

const CLOTHING_TIPS: { icon: string; text: string }[] = [
  {
    icon: '📵',
    text:
      'Avoid cluttered screenshots. A screen-grab full of text, buttons, or other elements ' +
      'confuses the AI, so your result may not look quite right. Use a clean photo instead.',
  },
  { icon: '💡', text: 'Use good, even lighting — avoid harsh shadows across the subject.' },
  {
    icon: '🖼️',
    text: 'Keep the main subject clear and let it fill most of the frame.',
  },
  { icon: '📐', text: 'Get the whole subject in frame — avoid awkward crops.' },
  {
    icon: '🔍',
    text: 'Sharp and in focus. Blurry or low-resolution photos lose detail in the result.',
  },
  {
    icon: '✨',
    text:
      'Got a messy photo? Add it to your Library and tap "Transform" — AI can turn it into a ' +
      'clean, polished image.',
  },
];

const BODY_TIPS: { icon: string; text: string }[] = [
  { icon: '💡', text: 'Good, even lighting — face a window or stand outside in shade.' },
  { icon: '🧍', text: 'Keep the main subject clear and centered in the frame.' },
  {
    icon: '🖼️',
    text: 'Plain, uncluttered background helps the AI focus on your subject.',
  },
  {
    icon: '📱',
    text: 'Hold the phone steady, or prop it up, to avoid motion blur.',
  },
  { icon: '🔍', text: 'Sharp and in focus. Your photos set the quality ceiling for every result.' },
];

/**
 * Bottom-sheet with photo guidance, shown from the creation and photo-upload
 * screens. Purely informational — better inputs mean better AI results, and
 * users blame the app when a marginal photo produces a marginal result.
 */
export default function UploadTipsSheet({ visible, kind, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const tips = kind === 'clothing' ? CLOTHING_TIPS : BODY_TIPS;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.header}>
            <Text style={styles.title}>
              {kind === 'clothing' ? '📸 Reference Image Tips' : '📸 Photo Tips'}
            </Text>
            <TouchableOpacity onPress={onClose} accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={Colors.black} />
            </TouchableOpacity>
          </View>
          <Text style={styles.subtitle}>
            The better the photo, the better your result. A few seconds here saves a wasted
            generation.
          </Text>

          <ScrollView bounces={false}>
            {tips.map((tip) => (
              <View key={tip.text} style={styles.tipRow}>
                <Text style={styles.tipIcon}>{tip.icon}</Text>
                <Text style={styles.tipText}>{tip.text}</Text>
              </View>
            ))}
          </ScrollView>

          <TouchableOpacity style={styles.doneButton} onPress={onClose}>
            <Text style={styles.doneButtonText}>Got It</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    padding: Spacing.lg,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  title: {
    fontSize: Typography.fontSizeXL,
    fontWeight: Typography.fontWeightBold,
    color: Colors.black,
  },
  subtitle: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray600,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs + 2,
  },
  tipIcon: { fontSize: 18, width: 26, textAlign: 'center' },
  tipText: { flex: 1, fontSize: Typography.fontSizeSM, color: Colors.black, lineHeight: 20 },
  doneButton: {
    backgroundColor: Colors.black,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
    alignItems: 'center',
    marginTop: Spacing.lg,
  },
  doneButtonText: {
    color: Colors.white,
    fontWeight: Typography.fontWeightBold,
    fontSize: Typography.fontSizeMD,
  },
});
