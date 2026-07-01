import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../config/api';
import { useUserStore } from '../store/useUserStore';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { RootStackParams } from '../navigation';

type Nav = NativeStackNavigationProp<RootStackParams, 'ChangePassword'>;

const PASSWORD_RULES = [
  'At least 8 characters',
  'At least one uppercase letter',
  'At least one number',
  'At least one special character',
];

export default function ChangePasswordScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { logout } = useUserStore();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function validateLocally(): string | null {
    if (!current) return 'Enter your current password.';
    if (!next) return 'Enter a new password.';
    if (next !== confirm) return 'New password and confirmation do not match.';
    if (next.length < 8) return 'New password must be at least 8 characters.';
    if (!/[A-Z]/.test(next)) return 'New password must contain at least one uppercase letter.';
    if (!/[0-9]/.test(next)) return 'New password must contain at least one number.';
    if (!/[^A-Za-z0-9]/.test(next))
      return 'New password must contain at least one special character.';
    if (next === current) return 'New password must be different from your current password.';
    return null;
  }

  async function handleSubmit() {
    const localError = validateLocally();
    if (localError) {
      Alert.alert('Check your input', localError);
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/auth/change-password', {
        currentPassword: current,
        newPassword: next,
      });
      // Server invalidates all refresh tokens; sign out locally and bounce
      // back to Login.
      Alert.alert(
        'Password Updated',
        'Your password has been changed. Please sign in again with your new password.',
        [
          {
            text: 'OK',
            onPress: async () => {
              await logout();
            },
          },
        ],
      );
    } catch (err: unknown) {
      const response = (err as { response?: { data?: { error?: unknown; message?: string } } })
        ?.response?.data;
      let msg = response?.message ?? 'Could not change password. Please try again.';
      if (typeof response?.error === 'string') {
        msg = response.error;
      } else if (response?.error && typeof response.error === 'object') {
        const fieldErrors = (response.error as { fieldErrors?: Record<string, string[]> })
          .fieldErrors;
        const formErrors = (response.error as { formErrors?: string[] }).formErrors;
        const parts: string[] = [];
        if (fieldErrors) {
          for (const errs of Object.values(fieldErrors)) parts.push(...errs);
        }
        if (formErrors) parts.push(...formErrors);
        if (parts.length > 0) msg = parts.join('\n');
      }
      Alert.alert('Could Not Change Password', String(msg));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeButton}>
          <Ionicons name="close" size={28} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Change Password</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Current Password</Text>
        <TextInput
          style={styles.input}
          placeholder="Current password"
          placeholderTextColor={Colors.gray400}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          value={current}
          onChangeText={setCurrent}
          textContentType="password"
        />

        <Text style={[styles.label, { marginTop: Spacing.lg }]}>New Password</Text>
        <TextInput
          style={styles.input}
          placeholder="New password"
          placeholderTextColor={Colors.gray400}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          value={next}
          onChangeText={setNext}
          textContentType="newPassword"
        />

        <Text style={styles.label}>Confirm New Password</Text>
        <TextInput
          style={styles.input}
          placeholder="Confirm new password"
          placeholderTextColor={Colors.gray400}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          value={confirm}
          onChangeText={setConfirm}
          textContentType="newPassword"
        />

        <View style={styles.rulesBox}>
          <Text style={styles.rulesTitle}>Your new password must include:</Text>
          {PASSWORD_RULES.map((r) => (
            <Text key={r} style={styles.ruleItem}>
              • {r}
            </Text>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color={Colors.white} />
          ) : (
            <Text style={styles.submitButtonText}>Update Password</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.footnote}>
          For security, you'll be signed out of all devices and asked to sign in again after the
          change is saved.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.gray200,
  },
  closeButton: { padding: Spacing.xs, width: 36 },
  headerTitle: {
    fontSize: Typography.fontSizeXL,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  headerSpacer: { width: 36 },
  body: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  label: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray600,
    marginBottom: Spacing.xs,
    fontWeight: Typography.fontWeightSemiBold,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.gray200,
    borderRadius: Radius.md,
    padding: Spacing.md,
    fontSize: Typography.fontSizeMD,
    color: Colors.textPrimary,
    backgroundColor: Colors.gray100,
    marginBottom: Spacing.md,
  },
  rulesBox: {
    backgroundColor: Colors.gray100,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginTop: Spacing.sm,
  },
  rulesTitle: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray800,
    fontWeight: Typography.fontWeightSemiBold,
    marginBottom: Spacing.xs,
  },
  ruleItem: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray600,
    lineHeight: 20,
  },
  submitButton: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.lg,
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonText: {
    color: Colors.textPrimary,
    fontWeight: Typography.fontWeightBold,
    fontSize: Typography.fontSizeMD,
  },
  footnote: {
    fontSize: Typography.fontSizeXS,
    color: Colors.gray600,
    textAlign: 'center',
    marginTop: Spacing.md,
    lineHeight: 16,
  },
});
