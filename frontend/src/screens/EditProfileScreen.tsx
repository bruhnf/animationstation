import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import api from '../config/api';
import { useUserStore } from '../store/useUserStore';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';

// Helper to extract user-friendly error message from API response
function parseApiError(err: unknown): string {
  const response = (err as { response?: { data?: { error?: unknown } } })?.response?.data;
  if (!response?.error) return 'Could not save changes.';

  // If error is a string, return it directly
  if (typeof response.error === 'string') return response.error;

  // If error is Zod's flattened format, extract field errors
  const zodError = response.error as { fieldErrors?: Record<string, string[]> };
  if (zodError.fieldErrors) {
    const messages = Object.entries(zodError.fieldErrors)
      .map(([field, errors]) => `${field}: ${(errors as string[]).join(', ')}`)
      .join('\n');
    return messages || 'Validation failed.';
  }

  return 'Could not save changes.';
}

export default function EditProfileScreen() {
  const navigation = useNavigation();
  const { user, updateUser } = useUserStore();
  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [city, setCity] = useState(user?.city ?? '');
  const [state, setState] = useState(user?.state ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    // Client-side validation for username
    const trimmedUsername = username.trim();
    if (trimmedUsername && !/^[a-zA-Z0-9_]+$/.test(trimmedUsername)) {
      Alert.alert(
        'Invalid Username',
        'Username can only contain letters, numbers, and underscores. No spaces allowed.',
      );
      return;
    }
    if (trimmedUsername && (trimmedUsername.length < 3 || trimmedUsername.length > 30)) {
      Alert.alert('Invalid Username', 'Username must be between 3 and 30 characters.');
      return;
    }

    setSaving(true);
    try {
      const { data } = await api.patch('/profile/me', {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        username: trimmedUsername,
        bio: bio.trim(),
        city: city.trim(),
        state: state.trim(),
      });
      updateUser({
        firstName: data.firstName,
        lastName: data.lastName,
        username: data.username,
        bio: data.bio,
        city: data.city,
        state: data.state,
      });
      navigation.goBack();
    } catch (err: unknown) {
      Alert.alert('Error', parseApiError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={styles.label}>First Name</Text>
            <TextInput
              style={styles.input}
              value={firstName}
              onChangeText={setFirstName}
              placeholder="First name"
              placeholderTextColor={Colors.gray400}
              autoCapitalize="words"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Last Name</Text>
            <TextInput
              style={styles.input}
              value={lastName}
              onChangeText={setLastName}
              placeholder="Last name"
              placeholderTextColor={Colors.gray400}
              autoCapitalize="words"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Username</Text>
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              placeholder="username"
              placeholderTextColor={Colors.gray400}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Bio</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={bio}
              onChangeText={setBio}
              placeholder="Tell people about yourself..."
              placeholderTextColor={Colors.gray400}
              multiline
              numberOfLines={4}
              maxLength={200}
            />
            <Text style={styles.charCount}>{bio.length}/200</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>City</Text>
            <TextInput
              style={styles.input}
              value={city}
              onChangeText={setCity}
              placeholder="City"
              placeholderTextColor={Colors.gray400}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>State</Text>
            <TextInput
              style={styles.input}
              value={state}
              onChangeText={setState}
              placeholder="State"
              placeholderTextColor={Colors.gray400}
            />
          </View>
        </View>

        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.disabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={Colors.white} />
          ) : (
            <Text style={styles.saveBtnText}>Save Changes</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surface },
  inner: { padding: Spacing.xl },
  form: { gap: Spacing.lg },
  field: { gap: Spacing.sm },
  label: {
    fontSize: Typography.fontSizeSM,
    fontWeight: Typography.fontWeightSemiBold,
    color: Colors.gray600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.gray200,
    borderRadius: Radius.md,
    padding: Spacing.md,
    fontSize: Typography.fontSizeMD,
    color: Colors.textPrimary,
    backgroundColor: Colors.gray100,
  },
  textArea: { minHeight: 100, textAlignVertical: 'top' },
  charCount: { fontSize: Typography.fontSizeXS, color: Colors.gray400, textAlign: 'right' },
  saveBtn: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.xl,
  },
  disabled: { opacity: 0.6 },
  saveBtnText: {
    color: Colors.textPrimary,
    fontWeight: Typography.fontWeightSemiBold,
    fontSize: Typography.fontSizeMD,
  },
});
