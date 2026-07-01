import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Typography, Spacing, Radius, Shadow } from '../../constants/theme';
import { useConfigStore } from '../../store/useConfigStore';
import { getSignupCopy, SignupContext } from '../../utils/signupCopy';
import { RootStackParams } from '../../navigation';
import AppButton from './AppButton';

const ICONS: Record<SignupContext, keyof typeof Ionicons.glyphMap> = {
  design: 'color-palette',
  video: 'videocam',
  credits: 'sparkles',
  inbox: 'mail',
  profile: 'person-circle',
  save: 'bookmark',
  generic: 'sparkles',
};

/**
 * The eye-catching guest → sign-up CTA. Big, warm, and reassuring: a large
 * accent icon, hero headline, the contextual value prop, the live free-credits
 * offer, and the "free / no card / no subscription" promises — then a prominent
 * Sign Up button and a quiet Log In link. Used both as full guest-gated screens
 * (Design/Video/Inbox/Buy-credits when an account is required) and inline.
 */
export default function SignupCTA({
  context,
  icon,
}: {
  context: SignupContext;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const insets = useSafeAreaInsets();
  const grant = useConfigStore((s) => s.signupCreditGrant);
  const offer = useConfigStore((s) => s.signupCreditsOffer);
  const copy = getSignupCopy(context);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + Spacing.xl, paddingBottom: insets.bottom + Spacing.xl },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.iconCircle}>
        <Ionicons name={icon ?? ICONS[context]} size={46} color={Colors.black} />
      </View>

      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.message}>{copy.message}</Text>

      {offer && grant > 0 ? (
        <View style={styles.offerPill}>
          <Ionicons name="gift" size={18} color={Colors.goldText} />
          <Text style={styles.offerText}>Get {grant} free credits when you join</Text>
        </View>
      ) : null}

      <View style={styles.bullets}>
        {copy.bullets.map((b) => (
          <View key={b} style={styles.bulletRow}>
            <Ionicons name="checkmark-circle" size={20} color={Colors.accentText} />
            <Text style={styles.bulletText}>{b}</Text>
          </View>
        ))}
      </View>

      <View style={styles.actions}>
        <AppButton
          title="Sign Up Free"
          icon="arrow-forward"
          size="lg"
          fullWidth
          onPress={() => navigation.navigate('Auth', { screen: 'Signup' })}
        />
        <AppButton
          title="I already have an account · Log In"
          variant="ghost"
          size="md"
          fullWidth
          onPress={() => navigation.navigate('Auth', { screen: 'Login' })}
        />
      </View>

      <Text style={styles.footnote}>No credit card. No subscription. Cancel nothing.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.white },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  iconCircle: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
    ...Shadow.cta,
  },
  title: {
    fontSize: Typography.fontSizeHero,
    fontWeight: Typography.fontWeightHeavy,
    color: Colors.black,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  message: {
    fontSize: Typography.fontSizeMD,
    color: Colors.gray600,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.lg,
    paddingHorizontal: Spacing.sm,
  },
  offerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.goldSoft,
    borderRadius: Radius.full,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.lg,
  },
  offerText: {
    color: Colors.goldText,
    fontWeight: Typography.fontWeightBold,
    fontSize: Typography.fontSizeMD,
  },
  bullets: {
    alignSelf: 'stretch',
    backgroundColor: Colors.accentSoft,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  bulletText: {
    fontSize: Typography.fontSizeMD,
    color: Colors.black,
    fontWeight: Typography.fontWeightMedium,
    flex: 1,
  },
  actions: { alignSelf: 'stretch', gap: Spacing.sm },
  footnote: {
    marginTop: Spacing.lg,
    fontSize: Typography.fontSizeXS,
    color: Colors.gray400,
    textAlign: 'center',
  },
});
