import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../config/api';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';

export type ReportTargetType = 'TRYON_JOB' | 'USER' | 'COMMENT';
export type ReportReason =
  | 'INAPPROPRIATE'
  | 'HARASSMENT'
  | 'IMPERSONATION'
  | 'SPAM'
  | 'COPYRIGHT'
  | 'OTHER';

interface Props {
  visible: boolean;
  targetType: ReportTargetType;
  targetId: string;
  onClose: () => void;
}

const REASONS: { value: ReportReason; label: string }[] = [
  { value: 'INAPPROPRIATE', label: 'Sexually explicit, violent, or otherwise inappropriate' },
  { value: 'HARASSMENT', label: 'Harassment, hate speech, or bullying' },
  { value: 'IMPERSONATION', label: 'Impersonation of a real person' },
  { value: 'SPAM', label: 'Spam or scam' },
  { value: 'COPYRIGHT', label: 'Copyright or trademark infringement' },
  { value: 'OTHER', label: 'Other' },
];

export default function ReportSheet({ visible, targetType, targetId, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setReason(null);
    setDetails('');
    setSubmitting(false);
  }

  async function submit() {
    if (!reason) return;
    setSubmitting(true);
    try {
      await api.post('/reports', {
        targetType,
        targetId,
        reason,
        details: details.trim() || undefined,
      });
      Alert.alert(
        'Report submitted',
        'Thank you. Our team reviews reports within 24 hours and will take appropriate action.',
        [
          {
            text: 'OK',
            onPress: () => {
              reset();
              onClose();
            },
          },
        ],
      );
    } catch {
      Alert.alert('Error', 'Could not submit report. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Lift the docked details input + Submit button above the keyboard. The
          sheet is justified to the bottom, so without this the keyboard would
          cover both. behavior 'height' on Android (Modal windows don't reliably
          resize there). */}
      <KeyboardAvoidingView
        style={styles.avoider}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
            <View style={styles.header}>
              <Text style={styles.title}>Report {targetType === 'USER' ? 'User' : 'Content'}</Text>
              <TouchableOpacity
                onPress={() => {
                  reset();
                  onClose();
                }}
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={24} color={Colors.black} />
              </TouchableOpacity>
            </View>
            <Text style={styles.subtitle}>Why are you reporting this?</Text>

            {REASONS.map((r) => (
              <TouchableOpacity
                key={r.value}
                style={[styles.reasonRow, reason === r.value && styles.reasonRowActive]}
                onPress={() => setReason(r.value)}
                activeOpacity={0.7}
              >
                <View style={[styles.radio, reason === r.value && styles.radioActive]}>
                  {reason === r.value ? <View style={styles.radioInner} /> : null}
                </View>
                <Text style={styles.reasonLabel}>{r.label}</Text>
              </TouchableOpacity>
            ))}

            <Text style={[styles.subtitle, { marginTop: Spacing.md }]}>
              Additional details (optional)
            </Text>
            <TextInput
              style={styles.detailsInput}
              multiline
              placeholder="Tell us more about what we should look at."
              placeholderTextColor={Colors.gray400}
              value={details}
              onChangeText={setDetails}
              maxLength={1000}
            />

            <TouchableOpacity
              style={[styles.submitButton, (!reason || submitting) && styles.submitButtonDisabled]}
              onPress={submit}
              disabled={!reason || submitting}
            >
              {submitting ? (
                <ActivityIndicator color={Colors.white} />
              ) : (
                <Text style={styles.submitButtonText}>Submit Report</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  avoider: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    padding: Spacing.lg,
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
  subtitle: { fontSize: Typography.fontSizeSM, color: Colors.gray600, marginBottom: Spacing.sm },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  reasonRowActive: {},
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.gray400,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: Colors.black },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.black },
  reasonLabel: { fontSize: Typography.fontSizeSM, color: Colors.black, flex: 1 },
  detailsInput: {
    borderWidth: 1,
    borderColor: Colors.gray200,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    fontSize: Typography.fontSizeSM,
    color: Colors.black,
    minHeight: 80,
    textAlignVertical: 'top',
    backgroundColor: Colors.gray100,
  },
  submitButton: {
    backgroundColor: Colors.black,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
    alignItems: 'center',
    marginTop: Spacing.lg,
  },
  submitButtonDisabled: { backgroundColor: Colors.gray400 },
  submitButtonText: {
    color: Colors.white,
    fontWeight: Typography.fontWeightBold,
    fontSize: Typography.fontSizeMD,
  },
});
