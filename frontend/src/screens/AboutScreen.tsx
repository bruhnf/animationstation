/**
 * AboutScreen — pre-signup pricing and value-proposition screen.
 *
 * Accessible without authentication (mounted on the AuthStack) so prospective
 * users can see what the app does, what tiers/credit packs cost, and why an
 * account is required BEFORE they're asked to register.
 *
 * App Store Review Guideline 5.1.1(v) context: Apple flagged the previous
 * build for requiring registration before users could see what they'd be
 * purchasing. This screen demonstrates the IAP catalog and tier features
 * pre-signup, and explains why an account is genuinely tied to the
 * functionality (server-side AI processing of the user's specific images
 * and prompts, per-user credit and tier state, personalized AI outputs).
 *
 * Pricing is fetched live from StoreKit via the existing iap service — no
 * hardcoded prices, per Guideline 3.1.1(a). Tier feature lists are static
 * marketing copy. If the StoreKit fetch fails (e.g. offline, sandbox
 * unavailable), the screen still renders feature bullets but shows
 * "See in app" for prices.
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { AuthStackParams } from '../navigation';
import { CREDITS_FOR_SKU, DisplayProduct, initIap, loadProductsForTier } from '../services/iap';
import { useConfigStore } from '../store/useConfigStore';

type Props = { navigation: NativeStackNavigationProp<AuthStackParams, 'About'> };

interface TierInfo {
  name: string;
  tagline: string;
  features: string[];
  badge?: string;
}

const TIERS: TierInfo[] = [
  {
    name: 'Free',
    // tagline + features[0] are replaced at render with the live, admin-
    // controlled join offer (or dropped when discontinued). See '__JOIN_OFFER__'.
    tagline: '__JOIN_OFFER__',
    features: [
      '__JOIN_OFFER__',
      'Extra credits available for purchase',
      'Full access to community feed',
    ],
  },
  {
    name: 'Basic',
    tagline: '12 generations per week',
    features: [
      '12 generations per week included',
      'Lower per-credit pricing on extras',
      'Priority queue',
    ],
  },
  {
    name: 'Premium',
    tagline: '24 generations per week',
    features: [
      '24 generations per week included',
      'Lowest per-credit pricing on extras',
      'Top-priority queue',
    ],
    badge: 'BEST VALUE',
  },
];

export default function AboutScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { signupCreditGrant, signupCreditsOffer } = useConfigStore();
  const [subscriptions, setSubscriptions] = useState<DisplayProduct[]>([]);
  const [creditPacks, setCreditPacks] = useState<DisplayProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [pricingError, setPricingError] = useState<string | null>(null);

  // Fetch live StoreKit prices. Defaults to FREE-tier credit-pack pricing
  // since the viewer is not signed in (and therefore on no paid tier).
  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        await initIap();
        const products = await loadProductsForTier('FREE');
        if (cancelled) return;
        setSubscriptions(products.subscriptions);
        setCreditPacks(products.credits);
        setPricingError(null);
      } catch (err) {
        if (!cancelled) {
          setPricingError(err instanceof Error ? err.message : 'Pricing unavailable');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  // Find the subscription DisplayProduct that matches a tier's product ID by
  // looking for a SKU containing the tier name. Fragile but acceptable for a
  // pre-signup screen — if the lookup misses, we fall back to "See in app".
  function priceForSubscription(tierName: string): string {
    const needle = tierName.toLowerCase();
    const match = subscriptions.find((p) => p.sku.toLowerCase().includes(needle));
    return match?.displayPrice ?? 'See in app';
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.md }]}
    >
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Ionicons name="chevron-back" size={28} color={Colors.textPrimary} />
      </TouchableOpacity>

      <Text style={styles.title}>AnimationStation</Text>
      <Text style={styles.subtitle}>Create AI images & videos from your photos and prompts</Text>

      {/* What AnimationStation does */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>How it works</Text>
        <Text style={styles.bodyText}>
          Type a prompt to generate an image from scratch, or upload a reference image and describe
          how you want it transformed. AnimationStation uses AI to create the image for you — and you
          can even turn any image into a short motion video.
        </Text>
      </View>

      {/* Subscriptions */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Plans</Text>
        {TIERS.map((tier, idx) => {
          const isPaid = tier.name === 'Basic' || tier.name === 'Premium';
          const priceText = isPaid ? priceForSubscription(tier.name) : 'Free';
          // Resolve the live join-offer copy: a limited-time tagline/feature when
          // the offer is active, or fall back / drop the line when discontinued.
          const tagline =
            tier.tagline === '__JOIN_OFFER__'
              ? signupCreditsOffer
                ? `Limited time offer: ${signupCreditGrant} free credits when you join`
                : 'Get started for free'
              : tier.tagline;
          const features = tier.features
            .map((feat) =>
              feat === '__JOIN_OFFER__'
                ? signupCreditsOffer
                  ? `${signupCreditGrant} free credits at signup`
                  : null
                : feat,
            )
            .filter((feat): feat is string => feat !== null);
          return (
            <View key={tier.name} style={[styles.tierCard, idx > 0 && styles.tierCardSpacing]}>
              <View style={styles.tierHeader}>
                <Text style={styles.tierName}>{tier.name}</Text>
                {tier.badge ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{tier.badge}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.tagline}>{tagline}</Text>
              <View style={styles.priceRow}>
                <Text style={styles.price}>{priceText}</Text>
                {isPaid ? <Text style={styles.pricePeriod}> / month</Text> : null}
              </View>
              {features.map((feat) => (
                <View key={feat} style={styles.featureRow}>
                  <Ionicons name="checkmark" size={16} color={Colors.success} />
                  <Text style={styles.featureText}>{feat}</Text>
                </View>
              ))}
            </View>
          );
        })}
      </View>

      {/* Credit packs */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Credit packs</Text>
        <Text style={styles.bodyText}>
          Credits unlock additional generations beyond your tier's weekly allowance. Pack pricing
          shown below is for Free-tier members; Basic and Premium subscribers see lower prices.
        </Text>
        {loading ? (
          <ActivityIndicator color={Colors.textPrimary} style={{ marginTop: Spacing.md }} />
        ) : pricingError ? (
          <Text style={styles.mutedText}>Pricing unavailable — see in app after signup.</Text>
        ) : creditPacks.length === 0 ? (
          <Text style={styles.mutedText}>Pricing unavailable — see in app after signup.</Text>
        ) : (
          <View style={styles.creditPackList}>
            {creditPacks.map((pack) => {
              const credits = CREDITS_FOR_SKU[pack.sku];
              return (
                <View key={pack.sku} style={styles.creditPackRow}>
                  <Text style={styles.creditPackName}>{credits ?? '?'} credits</Text>
                  <Text style={styles.creditPackPrice}>{pack.displayPrice}</Text>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* Why an account is required */}
      <View style={[styles.section, styles.whyAccountSection]}>
        <Text style={styles.sectionHeader}>Why an account is required</Text>
        <Text style={styles.bodyText}>
          AnimationStation's AI generates images and videos that are personalized to you, which means
          your account isn't just for login — it's where the app's core functionality lives:
        </Text>
        <View style={styles.bulletList}>
          <BulletItem>
            The images you upload are sent to our secure servers so the AI can generate new images
            and videos for you.
          </BulletItem>
          <BulletItem>
            Your subscription tier and AI credits are tracked server-side and tied to your account,
            so you can sign in on a new device and have everything available.
          </BulletItem>
          <BulletItem>
            Your creation history (the AI images and videos generated for you) is saved to your
            account so you can return to past results.
          </BulletItem>
        </View>
        <Text style={styles.bodyText}>
          You can delete your account and all associated data at any time from Settings.
        </Text>
      </View>

      {/* CTAs */}
      <View style={styles.ctaSection}>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => navigation.navigate('Signup')}
        >
          <Text style={styles.primaryButtonText}>Create an Account</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => navigation.navigate('Login')}
        >
          <Text style={styles.secondaryButtonText}>I already have an account</Text>
        </TouchableOpacity>
      </View>

      <View style={{ height: insets.bottom + Spacing.xl }} />
    </ScrollView>
  );
}

function BulletItem({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.bulletRow}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surface },
  content: { padding: Spacing.xl, paddingBottom: 0 },
  backButton: { alignSelf: 'flex-start', padding: Spacing.xs, marginBottom: Spacing.sm },
  title: {
    fontSize: 36,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: Typography.fontSizeMD,
    color: Colors.gray600,
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  section: { marginBottom: Spacing.xl },
  sectionHeader: {
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  bodyText: {
    fontSize: Typography.fontSizeMD,
    color: Colors.gray800,
    lineHeight: 22,
    marginBottom: Spacing.sm,
  },
  mutedText: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray600,
    fontStyle: 'italic',
    marginTop: Spacing.sm,
  },
  tierCard: {
    borderWidth: 1,
    borderColor: Colors.gray200,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  tierCardSpacing: { marginTop: Spacing.sm },
  tierHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.xs,
  },
  tierName: {
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  badge: {
    backgroundColor: Colors.black,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.sm,
  },
  badgeText: {
    color: Colors.white,
    fontSize: Typography.fontSizeXS,
    fontWeight: Typography.fontWeightBold,
    letterSpacing: 0.5,
  },
  tagline: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray600,
    marginBottom: Spacing.sm,
  },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: Spacing.sm },
  price: {
    fontSize: Typography.fontSizeXL,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  pricePeriod: { fontSize: Typography.fontSizeSM, color: Colors.gray600 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs, marginTop: 4 },
  featureText: { flex: 1, fontSize: Typography.fontSizeSM, color: Colors.gray800, lineHeight: 20 },
  creditPackList: { marginTop: Spacing.sm },
  creditPackRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.gray100,
  },
  creditPackName: {
    fontSize: Typography.fontSizeMD,
    color: Colors.textPrimary,
    fontWeight: Typography.fontWeightMedium,
  },
  creditPackPrice: {
    fontSize: Typography.fontSizeMD,
    color: Colors.textPrimary,
    fontWeight: Typography.fontWeightSemiBold,
  },
  whyAccountSection: {
    backgroundColor: Colors.gray100,
    padding: Spacing.md,
    borderRadius: Radius.md,
  },
  bulletList: { marginTop: Spacing.xs, marginBottom: Spacing.sm },
  bulletRow: { flexDirection: 'row', marginBottom: Spacing.sm },
  bulletDot: {
    fontSize: Typography.fontSizeMD,
    color: Colors.gray800,
    marginRight: Spacing.sm,
    lineHeight: 22,
  },
  bulletText: { flex: 1, fontSize: Typography.fontSizeMD, color: Colors.gray800, lineHeight: 22 },
  ctaSection: { marginTop: Spacing.md, gap: Spacing.sm },
  primaryButton: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: Colors.textPrimary,
    fontWeight: Typography.fontWeightSemiBold,
    fontSize: Typography.fontSizeMD,
  },
  secondaryButton: {
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: Colors.textPrimary,
    fontWeight: Typography.fontWeightMedium,
    fontSize: Typography.fontSizeMD,
  },
});
