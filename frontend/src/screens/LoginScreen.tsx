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
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import api from '../config/api';
import { useUserStore } from '../store/useUserStore';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { AuthStackParams } from '../navigation';
import { User } from '../types';
import AppButton from '../components/ui/AppButton';

type Props = { navigation: NativeStackNavigationProp<AuthStackParams, 'Login'> };

export default function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const setUser = useUserStore((s) => s.setUser);
  // True only when a real user's session expired and they were routed here to
  // re-authenticate (see useUserStore.sessionExpired / initialize). It's false
  // when a guest opens this screen from the Auth modal, so the banner shows only
  // in the "your session ended" case.
  const sessionEnded = useUserStore((s) => s.sessionEnded);

  async function handleLogin() {
    if (!email.trim() || !password) {
      Alert.alert('Error', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post<{ accessToken: string; refreshToken: string; user: User }>(
        '/auth/login',
        { email: email.trim().toLowerCase(), password },
      );
      await setUser(data.user, data.accessToken, data.refreshToken);
    } catch (err: unknown) {
      // The backend returns either { error: 'STRING_CODE', message: '...' } or
      // { error: <zod flatten object> } on validation failure. Pulling the
      // object out and passing it to Alert.alert as `message` will crash on
      // newer React Native versions ("text strings must be rendered within a
      // <Text>"). Coerce defensively before showing.
      const response = (err as { response?: { data?: { error?: unknown; message?: string } } })
        ?.response?.data;
      const errorCode = typeof response?.error === 'string' ? response.error : undefined;

      let msg = response?.message ?? errorCode ?? 'Login failed. Please try again.';
      if (!errorCode && response?.error && typeof response.error === 'object') {
        const fieldErrors = (response.error as { fieldErrors?: Record<string, string[]> })
          .fieldErrors;
        if (fieldErrors) {
          msg =
            Object.entries(fieldErrors)
              .map(([field, errors]) => `${field}: ${errors.join(', ')}`)
              .join('\n') || msg;
        }
      }

      if (errorCode === 'EMAIL_NOT_VERIFIED') {
        Alert.alert(
          'Email Not Verified',
          'Please verify your email before logging in. Check your inbox.',
          [
            {
              text: 'Resend Email',
              onPress: () => resendVerificationFor(email.trim().toLowerCase()),
            },
            { text: 'OK' },
          ],
        );
      } else {
        Alert.alert('Login Failed', String(msg));
      }
    } finally {
      setLoading(false);
    }
  }

  async function resendVerificationFor(targetEmail: string) {
    if (!targetEmail) {
      Alert.alert('Email required', 'Enter your email address above, then tap Resend again.');
      return;
    }
    try {
      await api.post('/auth/resend-verification', { email: targetEmail });
      Alert.alert(
        'Sent',
        'A new verification email has been sent. Please check your inbox (and spam folder).',
      );
    } catch {
      Alert.alert('Error', 'Could not resend verification email.');
    }
  }

  // "Forgot password?" CTA. Previously this was an iOS-only Alert.prompt?.()
  // (silent no-op on Android) wrapped in a TouchableOpacity that navigated to
  // Signup — a mis-tap trap. Now: use the email already typed in the form when
  // there is one; fall back to the prompt on iOS; on Android (no Alert.prompt)
  // ask the user to fill the email field first.
  function handleForgotPassword() {
    const sendReset = async (target: string) => {
      try {
        await api.post('/auth/forgot-password', { email: target.trim() });
        Alert.alert(
          'Email Sent',
          'If an account exists for that email, a reset link is on its way. The link opens a page where you can choose a new password.',
        );
      } catch {
        Alert.alert('Error', 'Could not send the reset email. Please try again.');
      }
    };

    const typed = email.trim();
    if (typed) {
      Alert.alert('Reset Password', `Send a password-reset link to ${typed}?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send', onPress: () => void sendReset(typed) },
      ]);
      return;
    }
    if (Platform.OS === 'ios' && Alert.prompt) {
      Alert.prompt('Forgot Password', 'Enter your email to reset your password', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: (value?: string) => {
            if (value && value.trim()) void sendReset(value);
          },
        },
      ]);
    } else {
      Alert.alert(
        'Forgot Password',
        'Type your email in the Email field above, then tap "Forgot password?" again.',
      );
    }
  }

  function handleResendPress() {
    const typed = email.trim().toLowerCase();
    if (typed) {
      resendVerificationFor(typed);
      return;
    }
    // Alert.prompt is iOS-only; on Android the user just gets instructions.
    if (Alert.prompt) {
      Alert.prompt('Resend Verification Email', 'Enter the email you signed up with:', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: (e?: string) => {
            if (e) resendVerificationFor(e.trim().toLowerCase());
          },
        },
      ]);
    } else {
      Alert.alert(
        'Email required',
        'Type the email you signed up with in the field above, then tap Resend.',
      );
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>AnimationStation</Text>
        <Text style={styles.subtitle}>Create AI images & videos from your photos and prompts</Text>

        {sessionEnded ? (
          <View style={styles.sessionBanner}>
            <Text style={styles.sessionBannerText}>Your session expired — please sign in.</Text>
          </View>
        ) : null}

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={Colors.gray400}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={Colors.gray400}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <TouchableOpacity style={styles.forgotLink} onPress={handleForgotPassword}>
            <Text style={styles.linkText}>Forgot password?</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.forgotLink} onPress={handleResendPress}>
            <Text style={styles.linkText}>Didn't get the verification email?</Text>
          </TouchableOpacity>

          <AppButton
            title="Log In"
            variant="dark"
            size="lg"
            fullWidth
            loading={loading}
            disabled={loading}
            onPress={handleLogin}
            style={{ marginTop: Spacing.sm }}
          />

          <View style={styles.signupRow}>
            <Text style={styles.mutedText}>Don't have an account? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Signup')}>
              <Text style={styles.linkText}>Sign Up</Text>
            </TouchableOpacity>
          </View>

          {/* Pre-signup info screen — required for App Store Guideline 5.1.1(v)
              compliance. Lets prospective users see tier features, live StoreKit
              pricing, and why an account is required before being asked to
              register. */}
          <TouchableOpacity style={styles.aboutLink} onPress={() => navigation.navigate('About')}>
            <Text style={styles.linkText}>How AnimationStation works & pricing</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surface },
  inner: { flexGrow: 1, justifyContent: 'center', padding: Spacing.xl },
  title: {
    fontSize: Typography.fontSizeDisplay,
    fontWeight: Typography.fontWeightHeavy,
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: Typography.fontSizeMD,
    color: Colors.gray600,
    textAlign: 'center',
    marginBottom: Spacing.xxl,
  },
  sessionBanner: {
    backgroundColor: Colors.gray100,
    borderLeftWidth: 3,
    borderLeftColor: Colors.black,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.lg,
  },
  sessionBannerText: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray800,
    fontWeight: Typography.fontWeightMedium,
  },
  form: { gap: Spacing.md },
  input: {
    borderWidth: 1,
    borderColor: Colors.gray200,
    borderRadius: Radius.md,
    padding: Spacing.md,
    fontSize: Typography.fontSizeMD,
    color: Colors.textPrimary,
    backgroundColor: Colors.gray100,
  },
  forgotLink: { alignSelf: 'flex-end' },
  signupRow: { flexDirection: 'row', justifyContent: 'center', marginTop: Spacing.md },
  aboutLink: { alignItems: 'center', marginTop: Spacing.md, paddingVertical: Spacing.xs },
  mutedText: { color: Colors.gray600, fontSize: Typography.fontSizeMD },
  linkText: {
    color: Colors.accentText,
    fontWeight: Typography.fontWeightBold,
    fontSize: Typography.fontSizeMD,
  },
});
