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
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as WebBrowser from 'expo-web-browser';
import api from '../config/api';
import { useUserStore } from '../store/useUserStore';
import { useConfigStore } from '../store/useConfigStore';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { AuthStackParams } from '../navigation';
import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from '../constants/legal';
import AppButton from '../components/ui/AppButton';

type Props = { navigation: NativeStackNavigationProp<AuthStackParams, 'Signup'> };

export default function SignupScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  // Shown in the hint below the form: a claiming guest keeps this handle.
  const guestUsername = useUserStore((s) => (s.user?.isGuest ? s.user.username : null));
  const signupCreditGrant = useConfigStore((s) => s.signupCreditGrant);
  const signupCreditsOffer = useConfigStore((s) => s.signupCreditsOffer);

  async function handleSignup() {
    if (!email.trim() || !password) {
      Alert.alert('Error', 'Email and password are required.');
      return;
    }
    if (password !== confirm) {
      Alert.alert('Error', 'Passwords do not match.');
      return;
    }
    if (!agreed) {
      Alert.alert('Error', 'Please agree to the Terms of Service and Privacy Policy.');
      return;
    }

    // Validate password requirements before sending
    const passwordErrors: string[] = [];
    if (password.length < 8) passwordErrors.push('at least 8 characters');
    if (!/[A-Z]/.test(password)) passwordErrors.push('one uppercase letter');
    if (!/[0-9]/.test(password)) passwordErrors.push('one number');
    if (!/[^A-Za-z0-9]/.test(password)) passwordErrors.push('one special character');
    if (passwordErrors.length > 0) {
      Alert.alert('Password Requirements', `Password must contain ${passwordErrors.join(', ')}.`);
      return;
    }

    setLoading(true);
    try {
      // If the current session is an anonymous guest, "claim" (upgrade) that
      // existing account so the guest's try-ons and credits carry over. The
      // payload is identical to signup; only the endpoint differs. After
      // verifying their email and logging in, the user gets the admin-configured
      // welcome bonus (default 10, 0 when the offer is discontinued) on top of
      // any remaining guest credits.
      //
      // No username is sent: a claimed guest keeps their user####### handle
      // and a direct signup gets one generated server-side. Either way it's
      // changeable later in Edit Profile.
      const isGuest = useUserStore.getState().user?.isGuest === true;
      const code = referralCode.trim();
      await api.post(isGuest ? '/auth/claim' : '/auth/signup', {
        email: email.trim().toLowerCase(),
        password,
        // Optional — backend resolves + normalizes it; an unknown code is
        // ignored, never an error.
        ...(code ? { referralCode: code } : {}),
      });
      Alert.alert(
        'Account Created',
        'Please check your email to verify your account, then log in.',
        [{ text: 'OK', onPress: () => navigation.navigate('Login') }],
      );
    } catch (err: unknown) {
      const response = (err as { response?: { data?: { error?: unknown; message?: string } } })
        ?.response?.data;
      let errorMessage = 'Signup failed. Please try again.';

      if (response?.error) {
        if (typeof response.error === 'string') {
          errorMessage = response.error;
        } else if (typeof response.error === 'object') {
          // Handle Zod validation errors
          const zodError = response.error as { fieldErrors?: Record<string, string[]> };
          const fieldErrors = zodError.fieldErrors;
          if (fieldErrors) {
            const messages = Object.entries(fieldErrors)
              .map(([field, errors]) => `${field}: ${(errors as string[]).join(', ')}`)
              .join('\n');
            errorMessage = messages || errorMessage;
          }
        }
      } else if (response?.message) {
        errorMessage = response.message;
      }

      Alert.alert('Signup Failed', errorMessage);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Create your free account</Text>
        <Text style={styles.subtitle}>
          Just an email and password — add a username and more later.
        </Text>

        <View style={styles.reassure}>
          {signupCreditsOffer && signupCreditGrant > 0 ? (
            <View style={styles.offerRow}>
              <Ionicons name="gift" size={18} color={Colors.goldText} />
              <Text style={styles.offerText}>
                Get {signupCreditGrant} free credits the moment you verify your email
              </Text>
            </View>
          ) : null}
          <View style={styles.reassureChips}>
            {['No credit card', 'No subscription', 'Free forever to join'].map((c) => (
              <View key={c} style={styles.reassureChip}>
                <Ionicons name="checkmark-circle" size={14} color={Colors.accentText} />
                <Text style={styles.reassureChipText}>{c}</Text>
              </View>
            ))}
          </View>
        </View>

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
          <Text style={styles.passwordHint}>
            8+ characters, one uppercase, one number, one special character
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Confirm Password"
            placeholderTextColor={Colors.gray400}
            secureTextEntry
            value={confirm}
            onChangeText={setConfirm}
          />
          <TextInput
            style={styles.input}
            placeholder="Referral code (optional)"
            placeholderTextColor={Colors.gray400}
            autoCapitalize="characters"
            autoCorrect={false}
            value={referralCode}
            onChangeText={setReferralCode}
          />

          {guestUsername && (
            <Text style={styles.usernameNote}>
              You'll keep your current username ({guestUsername}) — change it anytime in Edit
              Profile. Your creations and credits carry over too.
            </Text>
          )}

          <TouchableOpacity style={styles.checkRow} onPress={() => setAgreed(!agreed)}>
            <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
              {agreed && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={styles.checkLabel}>
              I agree to the{' '}
              <Text
                style={styles.linkText}
                onPress={() => WebBrowser.openBrowserAsync(TERMS_OF_SERVICE_URL)}
              >
                Terms of Service
              </Text>{' '}
              and{' '}
              <Text
                style={styles.linkText}
                onPress={() => WebBrowser.openBrowserAsync(PRIVACY_POLICY_URL)}
              >
                Privacy Policy
              </Text>
              , including the processing of your photos by AI services.
            </Text>
          </TouchableOpacity>

          <AppButton
            title="Create Free Account"
            variant="primary"
            size="lg"
            fullWidth
            loading={loading}
            disabled={loading}
            onPress={handleSignup}
            style={{ marginTop: Spacing.sm }}
          />

          <View style={styles.loginRow}>
            <Text style={styles.mutedText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Login')}>
              <Text style={styles.linkText}>Log In</Text>
            </TouchableOpacity>
          </View>

          {/* Pre-signup info screen — same link as LoginScreen. Shown here too
              so a reviewer (or user) starting on Signup can see the value
              proposition and pricing without completing the form. */}
          <TouchableOpacity style={styles.aboutLink} onPress={() => navigation.navigate('About')}>
            <Text style={styles.linkText}>How AnimationStation works & pricing</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.white },
  inner: { flexGrow: 1, padding: Spacing.xl, paddingTop: Spacing.xxl },
  backButton: { marginBottom: Spacing.lg },
  backText: { fontSize: Typography.fontSizeMD, color: Colors.gray600 },
  title: {
    fontSize: Typography.fontSizeHero,
    fontWeight: Typography.fontWeightHeavy,
    color: Colors.black,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: Typography.fontSizeMD,
    color: Colors.gray600,
    marginBottom: Spacing.lg,
    lineHeight: 22,
  },
  reassure: {
    backgroundColor: Colors.accentSoft,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  offerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  offerText: {
    flex: 1,
    color: Colors.goldText,
    fontWeight: Typography.fontWeightBold,
    fontSize: Typography.fontSizeSM,
  },
  reassureChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  reassureChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  reassureChipText: {
    color: Colors.accentText,
    fontSize: Typography.fontSizeXS,
    fontWeight: Typography.fontWeightSemiBold,
  },
  form: { gap: Spacing.md },
  usernameNote: {
    fontSize: Typography.fontSizeXS,
    color: Colors.gray400,
    lineHeight: 18,
    marginTop: -Spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.gray200,
    borderRadius: Radius.md,
    padding: Spacing.md,
    fontSize: Typography.fontSizeMD,
    color: Colors.black,
    backgroundColor: Colors.gray100,
  },
  passwordHint: { fontSize: Typography.fontSizeXS, color: Colors.gray400, marginTop: -Spacing.sm },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: Colors.gray400,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    flexShrink: 0,
  },
  checkboxChecked: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  checkmark: { color: Colors.black, fontSize: 13, fontWeight: Typography.fontWeightBold },
  checkLabel: { flex: 1, fontSize: Typography.fontSizeSM, color: Colors.gray600, lineHeight: 20 },
  loginRow: { flexDirection: 'row', justifyContent: 'center', marginTop: Spacing.md },
  aboutLink: { alignItems: 'center', marginTop: Spacing.md, paddingVertical: Spacing.xs },
  mutedText: { color: Colors.gray600, fontSize: Typography.fontSizeMD },
  linkText: { color: Colors.accentText, fontWeight: Typography.fontWeightBold },
});
