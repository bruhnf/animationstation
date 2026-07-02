import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Linking,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import IAP, { IAP_AVAILABLE } from '../services/iapNative';
import * as WebBrowser from 'expo-web-browser';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL, SUPPORT_EMAIL } from '../constants/legal';
import { useUserStore } from '../store/useUserStore';
import { useConfigStore } from '../store/useConfigStore';
import SignupCTA from '../components/ui/SignupCTA';
import { UserTier } from '../types';
import {
  CREDITS_FOR_SKU,
  DisplayProduct,
  MANAGE_SUBSCRIPTIONS_URL,
  creditPackSkusForTier,
  endIap,
  flushPendingTransactions,
  loadProductsForTier,
  initIap,
  purchaseCreditPack,
  purchaseSubscription,
  restorePurchases,
  verifyAndFinish,
} from '../services/iap';
import Constants from 'expo-constants';

type AppleProductsConfig = {
  subscriptions: { basicMonthly: string; premiumMonthly: string };
};

const APPLE_PRODUCTS: AppleProductsConfig =
  (Constants.expoConfig?.extra as { appleProducts?: AppleProductsConfig })?.appleProducts ??
  ({} as AppleProductsConfig);

const TIER_FEATURES: Record<
  UserTier,
  {
    name: string;
    tagline: string;
    features: string[];
    sku?: string;
    tier: UserTier;
    badge?: string;
  }
> = {
  FREE: {
    tier: 'FREE',
    name: 'Free',
    tagline: 'Get started with free credits',
    // features[0] is replaced at render with the live join-offer copy (or
    // dropped when the offer is discontinued) — see the '__JOIN_OFFER__' map below.
    features: [
      '__JOIN_OFFER__',
      'No credit card or subscription required',
      'Extra credits $0.60 each',
      'Full access to community feed',
    ],
  },
  BASIC: {
    tier: 'BASIC',
    name: 'Basic',
    tagline: '12 generations per week',
    features: [
      '12 generations per week included',
      'Basic members get lower credit pricing, from $0.40–$0.50 per credit depending on package size.',
      'Priority queue',
    ],
    sku: APPLE_PRODUCTS.subscriptions?.basicMonthly,
  },
  PREMIUM: {
    tier: 'PREMIUM',
    name: 'Premium',
    tagline: '24 generations per week',
    features: [
      '24 generations per week included',
      'Premium members get the lowest credit pricing, from $0.30–$0.32 per credit depending on package size.',
      'Top-priority queue',
    ],
    sku: APPLE_PRODUCTS.subscriptions?.premiumMonthly,
    badge: 'BEST VALUE',
  },
};

const CREDIT_TIERS: UserTier[] = ['FREE', 'BASIC', 'PREMIUM'];

// Per-credit price for a pack. Uses the numeric `priceAmount` so we don't
// have to parse the localized displayPrice (which would break in non-USD
// locales). Returns null when we can't compute it (e.g. priceAmount missing
// from the StoreKit response).
function formatPricePerCredit(
  priceAmount: number | undefined,
  currency: string | undefined,
  credits: number,
): string | null {
  if (priceAmount == null || !Number.isFinite(priceAmount) || credits <= 0) return null;
  const perCredit = priceAmount / credits;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(perCredit);
  } catch {
    return `${perCredit.toFixed(2)}`;
  }
}

export default function PurchaseScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { user, refreshUser } = useUserStore();
  const { signupCreditGrant, signupCreditsOffer } = useConfigStore();
  const [selectedTab, setSelectedTab] = useState<'tiers' | 'credits'>('tiers');
  const [busy, setBusy] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [subscriptions, setSubscriptions] = useState<DisplayProduct[]>([]);
  const [creditPacks, setCreditPacks] = useState<DisplayProduct[]>([]);

  const currentTier: UserTier = user?.tier ?? 'FREE';
  // Guests can't buy via StoreKit (no account to attach the entitlement to), so
  // we never show them the IAP UI — they get the free-account CTA below instead.
  const isGuest = user?.isGuest === true;

  // On mount: silently finish any transactions StoreKit held over from a
  // previous session so they don't get re-delivered mid-purchase. The purchase
  // listener also finishes any that slip through — this is an early
  // belt-and-suspenders cleanup.
  useEffect(() => {
    if (isGuest) return;
    flushPendingTransactions();
  }, [isGuest]);

  // Re-fetch when the user's tier changes — credit-pack SKUs (and prices)
  // are tier-specific, so a user upgrading from FREE to BASIC mid-session
  // should immediately see Basic prices.
  useEffect(() => {
    if (isGuest) {
      setProductsLoading(false);
      return;
    }
    let cancelled = false;
    async function run() {
      setProductsLoading(true);
      try {
        await initIap();
        const products = await loadProductsForTier(currentTier);
        if (cancelled) return;
        setSubscriptions(products.subscriptions);
        setCreditPacks(products.credits);
        setProductsError(null);
      } catch (err) {
        if (!cancelled) {
          setProductsError(err instanceof Error ? err.message : 'Could not load products');
        }
      } finally {
        if (!cancelled) setProductsLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [currentTier, isGuest]);

  // SKU the user just tapped Subscribe / Buy on. The listener uses this to
  // distinguish a user-initiated purchase (show feedback, clear the spinner)
  // from an unsolicited event StoreKit pushes — a subscription auto-renewal
  // or a stale transaction replayed from a previous session. Both are still
  // verified + finished so the backend stays in sync and StoreKit drops them
  // from its queue; only user-initiated ones surface a popup.
  const expectingPurchaseSku = useRef<string | null>(null);

  // True once the active user-initiated purchase has been resolved (outcome
  // decided / alert shown). expo-iap can emit a second purchase-updated event
  // for the same transaction after finishTransaction — this guarantees exactly
  // one alert per purchase. Reset when the user initiates a new buy.
  const purchaseResolved = useRef<boolean>(false);

  // Safety-net timer: started when a purchase begins, cleared the instant
  // StoreKit reports back through either listener. If it ever actually fires,
  // StoreKit never responded at all — we un-stick the spinner so the user is
  // never trapped on a frozen loading wheel.
  const watchdogTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearWatchdog() {
    if (watchdogTimer.current) {
      clearTimeout(watchdogTimer.current);
      watchdogTimer.current = null;
    }
  }

  function startWatchdog() {
    clearWatchdog();
    watchdogTimer.current = setTimeout(() => {
      watchdogTimer.current = null;
      // If a purchase is still flagged in-flight, nothing came back from
      // StoreKit. Release the UI and tell the user how to recover.
      if (!expectingPurchaseSku.current) return;
      expectingPurchaseSku.current = null;
      purchaseResolved.current = true;
      setBusy(null);
      void refreshUser();
      Alert.alert(
        'Taking longer than expected',
        'We did not hear back from the App Store. If your purchase went through, your credits will appear within a minute or after you tap Restore Purchases. If not, please try again.',
      );
    }, 120000);
  }

  // Listen for purchase results from StoreKit. EVERY delivered transaction is
  // verified with the backend and finished — including stale ones StoreKit
  // re-delivers from earlier sessions — so nothing lingers in StoreKit's
  // queue. The `finally` block ALWAYS clears the spinner for the active
  // purchase. That is the fix for the long-standing "spinner stuck after
  // several purchases" bug: the old txId dedupe early-returned on a
  // re-delivered transaction, skipping both finishTransaction and setBusy(null)
  // — so the stale transaction never drained and the wheel spun forever.
  useEffect(() => {
    // Expo Go has no StoreKit — skip registering native listeners so the
    // screen renders (purchases require a dev build / TestFlight).
    if (!IAP_AVAILABLE) return;
    const updateSub = IAP.purchaseUpdatedListener(async (purchase: unknown) => {
      const purchaseSku = (purchase as { productId?: string })?.productId;
      const isUserInitiated = !!purchaseSku && purchaseSku === expectingPurchaseSku.current;

      try {
        const result = await verifyAndFinish(purchase as never);
        await refreshUser();

        // Unsolicited event (subscription renewal, or a stale transaction
        // replayed by StoreKit). It has been verified + finished above;
        // there's nothing to surface to the user.
        if (!isUserInitiated) return;

        // Resolve the active purchase exactly once — expo-iap can emit a
        // second event for the same transaction after finishTransaction.
        if (purchaseResolved.current) return;
        purchaseResolved.current = true;

        if (result.fastPathSkipped) {
          // The backend could not verify the receipt on the spot (or no JWS
          // was present), leaving the App Store Server webhook as the only
          // remaining grant path. Do NOT claim success yet — poll for the
          // credit/tier change and report what actually happened. The old
          // unconditional "Purchase confirmed" alert here showed success while
          // BOTH server paths had failed, and the buyer's credits silently
          // never arrived (lost-credits incident, 2026-06-11).
          const before = useUserStore.getState().user;
          let applied = false;
          for (let i = 0; i < 6; i += 1) {
            await new Promise((r) => setTimeout(r, 2500));
            await refreshUser();
            const after = useUserStore.getState().user;
            if (
              after &&
              before &&
              (after.credits !== before.credits || after.tier !== before.tier)
            ) {
              applied = true;
              break;
            }
          }
          if (applied) {
            Alert.alert('Purchase complete', 'Your account has been updated.');
          } else {
            Alert.alert(
              'Purchase received — still processing',
              'Apple accepted your purchase, but it has not reached your account yet. ' +
                'It usually appears within a few minutes — pull down to refresh, or tap ' +
                `Restore Purchases. If it still doesn't show up, contact ${SUPPORT_EMAIL}.`,
            );
          }
        } else if (result.alreadyProcessed) {
          // A transaction StoreKit had delivered before (e.g. a stale one
          // re-delivered on this tap). It is finished now and any credits were
          // granted on the original pass — close the spinner quietly; the user
          // can tap again for a fresh purchase.
        } else {
          Alert.alert('Purchase complete', 'Your account has been updated.');
        }
      } catch (err) {
        if (isUserInitiated && !purchaseResolved.current) {
          purchaseResolved.current = true;
          Alert.alert(
            'Purchase verification failed',
            err instanceof Error ? err.message : 'Please try Restore Purchases.',
          );
        }
      } finally {
        // ALWAYS release the spinner for the active purchase — every branch
        // above, including the early returns, falls through to here.
        if (isUserInitiated) {
          expectingPurchaseSku.current = null;
          clearWatchdog();
          setBusy(null);
        }
      }
    });
    const errSub = IAP.purchaseErrorListener((err: { code?: string; message?: string }) => {
      clearWatchdog();
      setBusy(null);
      expectingPurchaseSku.current = null;
      purchaseResolved.current = false;
      // User-cancelled is not an error worth surfacing.
      if (err && err.code !== 'E_USER_CANCELLED') {
        Alert.alert('Purchase failed', err.message ?? 'Unknown error.');
      }
    });
    return () => {
      updateSub.remove();
      errSub.remove();
      clearWatchdog();
    };
    // refreshUser is a stable Zustand action (defined once in create()) and
    // clearWatchdog only touches refs, so [] is correct. Using [refreshUser]
    // would tear down and re-add the listeners on every render if refreshUser
    // were ever made non-stable, creating a window where a StoreKit event
    // could be missed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tear down the IAP connection when leaving the screen.
  useEffect(
    () => () => {
      void endIap();
    },
    [],
  );

  function priceForSku(sku?: string): string {
    if (!sku) return '';
    const sub = subscriptions.find((p) => p.sku === sku);
    if (sub) return sub.displayPrice;
    const pack = creditPacks.find((p) => p.sku === sku);
    if (pack) return pack.displayPrice;
    return '';
  }

  async function handleSubscribe(tier: UserTier) {
    if (!user) return;
    const config = TIER_FEATURES[tier];
    if (!config.sku) {
      Alert.alert('Unavailable', 'This tier is not available for purchase.');
      return;
    }
    if (tier === currentTier) return;
    setBusy(config.sku);
    expectingPurchaseSku.current = config.sku;
    purchaseResolved.current = false;
    startWatchdog();
    try {
      await purchaseSubscription(config.sku, user.id);
      // Result lands in the purchaseUpdatedListener.
    } catch (err) {
      clearWatchdog();
      setBusy(null);
      expectingPurchaseSku.current = null;
      Alert.alert('Purchase failed', err instanceof Error ? err.message : 'Unknown error.');
    }
  }

  async function handleBuyCredits(sku: string) {
    if (!user) return;
    setBusy(sku);
    expectingPurchaseSku.current = sku;
    purchaseResolved.current = false;
    startWatchdog();
    try {
      await purchaseCreditPack(sku, user.id);
    } catch (err) {
      clearWatchdog();
      setBusy(null);
      expectingPurchaseSku.current = null;
      Alert.alert('Purchase failed', err instanceof Error ? err.message : 'Unknown error.');
    }
  }

  async function handleRestore() {
    setRestoring(true);
    try {
      const { restoredCount } = await restorePurchases();
      await refreshUser();
      Alert.alert(
        restoredCount > 0 ? 'Purchases Restored' : 'No Purchases Found',
        restoredCount > 0
          ? `Restored ${restoredCount} purchase${restoredCount === 1 ? '' : 's'}.`
          : 'We did not find any prior purchases for this Apple ID.',
      );
    } catch (err) {
      Alert.alert('Restore failed', err instanceof Error ? err.message : 'Unknown error.');
    } finally {
      setRestoring(false);
    }
  }

  function handleManageSubscription() {
    Linking.openURL(MANAGE_SUBSCRIPTIONS_URL).catch(() =>
      Alert.alert('Could not open', 'Open the App Store app and go to your account settings.'),
    );
  }

  // The credit packs to render: the current tier's 4 SKUs paired with the
  // StoreKit product actually returned for each (price/title come from Apple).
  // Packs with no matching product are dropped — and when ALL are missing
  // (StoreKit returned nothing: the dev-client variant has no App Store Connect
  // app, or Apple's fetch failed / products not yet approved) we show an empty
  // state instead of a blank area (the bug this guards against).
  const creditPacksToShow = creditPackSkusForTier(currentTier)
    .map((sku) => ({ sku, pack: creditPacks.find((p) => p.sku === sku) }))
    .filter((x): x is { sku: string; pack: DisplayProduct } => !!x.pack);

  // Guests never see the (non-functional-for-them) StoreKit UI — they get the
  // free-account CTA. Buying credits requires a free account, no card to join.
  if (isGuest) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, backgroundColor: Colors.surface }]}>
        <View style={styles.guestCloseRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
            <Ionicons name="close" size={28} color={Colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <SignupCTA context="credits" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeButton}>
          <Ionicons name="close" size={28} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Get More Generations</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.statusCard}>
          <Ionicons name="wallet-outline" size={24} color={Colors.gray600} />
          <View style={styles.statusInfo}>
            <Text style={styles.statusLabel}>Current Tier</Text>
            <Text style={styles.statusValue}>
              {TIER_FEATURES[currentTier].name} · {user?.credits ?? 0} credits
            </Text>
          </View>
        </View>

        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, selectedTab === 'tiers' && styles.tabActive]}
            onPress={() => setSelectedTab('tiers')}
          >
            <Text style={[styles.tabText, selectedTab === 'tiers' && styles.tabTextActive]}>
              Tiers
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, selectedTab === 'credits' && styles.tabActive]}
            onPress={() => setSelectedTab('credits')}
          >
            <Text style={[styles.tabText, selectedTab === 'credits' && styles.tabTextActive]}>
              Buy Credits
            </Text>
          </TouchableOpacity>
        </View>

        {productsLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={Colors.textPrimary} />
            <Text style={styles.loadingText}>Loading prices from the App Store…</Text>
          </View>
        ) : productsError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{productsError}</Text>
          </View>
        ) : selectedTab === 'tiers' ? (
          <View>
            {CREDIT_TIERS.map((tierKey) => {
              const tier = TIER_FEATURES[tierKey];
              const isCurrent = tier.tier === currentTier;
              const localizedPrice = priceForSku(tier.sku);
              const isBusy = busy === tier.sku;
              // Replace the FREE tier's join-offer placeholder with live,
              // admin-controlled copy: a limited-time offer line when active, or
              // drop the line entirely when the offer is discontinued.
              const features = tier.features
                .map((f) =>
                  f === '__JOIN_OFFER__'
                    ? signupCreditsOffer
                      ? `Limited time offer: Sign up and get ${signupCreditGrant} free credits`
                      : null
                    : f,
                )
                .filter((f): f is string => f !== null);
              return (
                <View
                  key={tier.tier}
                  style={[styles.tierCard, isCurrent && styles.tierCardCurrent]}
                >
                  {tier.badge ? (
                    <View style={styles.tierBadge}>
                      <Ionicons name="star" size={11} color={Colors.white} />
                      <Text style={styles.tierBadgeText}>{tier.badge}</Text>
                    </View>
                  ) : null}

                  <Text style={styles.tierName}>{tier.name}</Text>
                  <View style={styles.tierPriceRow}>
                    <Text style={styles.tierPriceAmount}>
                      {localizedPrice || (tier.sku ? '—' : 'Free')}
                    </Text>
                    {tier.sku ? <Text style={styles.tierPricePer}>/month</Text> : null}
                  </View>
                  <Text style={styles.tierTagline}>{tier.tagline}</Text>

                  <View style={styles.tierFeatureList}>
                    {features.map((f) => (
                      <View key={f} style={styles.tierFeatureItem}>
                        <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
                        <Text style={styles.tierFeatureText}>{f}</Text>
                      </View>
                    ))}
                  </View>

                  {tier.sku ? (
                    <>
                      <TouchableOpacity
                        style={[styles.tierButton, isCurrent && styles.tierButtonCurrent]}
                        onPress={() => handleSubscribe(tier.tier)}
                        disabled={isBusy || isCurrent || !localizedPrice}
                      >
                        {isBusy ? (
                          <ActivityIndicator color={Colors.white} />
                        ) : (
                          <Text
                            style={[
                              styles.tierButtonText,
                              isCurrent && styles.tierButtonTextCurrent,
                            ]}
                          >
                            {isCurrent ? 'Current Tier' : `Subscribe for ${localizedPrice}/month`}
                          </Text>
                        )}
                      </TouchableOpacity>

                      {/* App Store Review Guideline 3.1.2(a): auto-renew disclosure
                          must appear adjacent to the subscribe action. */}
                      <Text style={styles.subscribeDisclosure}>
                        Auto-renews monthly at {localizedPrice || tier.name + ' price'}. Cancel
                        anytime in Settings &gt; Apple ID &gt; Subscriptions; cancellation takes
                        effect at the end of the current period. By subscribing you agree to our{' '}
                        <Text
                          style={styles.disclosureLink}
                          onPress={() => WebBrowser.openBrowserAsync(TERMS_OF_SERVICE_URL)}
                        >
                          Terms of Service
                        </Text>{' '}
                        and{' '}
                        <Text
                          style={styles.disclosureLink}
                          onPress={() => WebBrowser.openBrowserAsync(PRIVACY_POLICY_URL)}
                        >
                          Privacy Policy
                        </Text>
                        .
                      </Text>
                    </>
                  ) : (
                    <View style={[styles.tierButton, styles.tierButtonCurrent]}>
                      <Text style={[styles.tierButtonText, styles.tierButtonTextCurrent]}>
                        {isCurrent ? 'Current Tier' : 'Free'}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}

            <TouchableOpacity
              style={styles.restoreButton}
              onPress={handleRestore}
              disabled={restoring}
            >
              {restoring ? (
                <ActivityIndicator color={Colors.textPrimary} />
              ) : (
                <Text style={styles.restoreButtonText}>Restore Purchases</Text>
              )}
            </TouchableOpacity>

            {Platform.OS === 'ios' ? (
              <TouchableOpacity style={styles.manageButton} onPress={handleManageSubscription}>
                <Text style={styles.manageButtonText}>Manage Subscription</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : (
          <View>
            <Text style={styles.sectionTitle}>Buy Credits</Text>
            <Text style={styles.sectionSubtitle}>
              Credits never expire. Your weekly generation allowance is used first; credits are
              spent only after the weekly allowance runs out.
            </Text>

            {creditPacksToShow.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="cart-outline" size={28} color={Colors.gray400} />
                <Text style={styles.emptyText}>
                  Credit packs aren&apos;t available from the App Store right now. Please try again
                  in a moment, or use Restore Purchases.
                </Text>
                <TouchableOpacity
                  style={styles.restoreButton}
                  onPress={handleRestore}
                  disabled={restoring}
                >
                  {restoring ? (
                    <ActivityIndicator color={Colors.textPrimary} />
                  ) : (
                    <Text style={styles.restoreButtonText}>Restore Purchases</Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : null}

            {creditPacksToShow.map(({ sku, pack }) => {
              const credits = CREDITS_FOR_SKU[sku] ?? 0;
              const isBusy = busy === sku;
              const perCredit = formatPricePerCredit(pack.priceAmount, pack.currency, credits);
              return (
                <TouchableOpacity
                  key={sku}
                  style={styles.creditCard}
                  onPress={() => handleBuyCredits(sku)}
                  disabled={isBusy}
                >
                  <View style={styles.creditInfo}>
                    <View style={styles.creditAmountRow}>
                      <Ionicons name="flash" size={20} color={Colors.warning} />
                      <Text style={styles.creditCount}>{credits}</Text>
                      <Text style={styles.creditLabel}>credits</Text>
                    </View>
                    <View style={styles.creditPriceColumn}>
                      <Text style={styles.creditPrice}>{pack.displayPrice}</Text>
                      {perCredit ? (
                        <Text style={styles.creditPerUnit}>{perCredit}/credit</Text>
                      ) : null}
                    </View>
                  </View>
                  {isBusy ? (
                    <ActivityIndicator style={styles.creditLoader} color={Colors.textPrimary} />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.gray100 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.gray200,
  },
  closeButton: { padding: Spacing.xs },
  guestCloseRow: {
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  headerTitle: {
    fontSize: Typography.fontSizeXL,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  headerRight: { width: 36 },
  content: { padding: Spacing.md, paddingBottom: Spacing.xxl },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    borderRadius: Radius.md,
    marginBottom: Spacing.md,
  },
  statusInfo: { flex: 1, marginLeft: Spacing.sm },
  statusLabel: { fontSize: Typography.fontSizeSM, color: Colors.gray600 },
  statusValue: {
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: 4,
    marginBottom: Spacing.lg,
  },
  tab: { flex: 1, paddingVertical: Spacing.sm, alignItems: 'center', borderRadius: Radius.sm },
  tabActive: { backgroundColor: Colors.black },
  tabText: {
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightMedium,
    color: Colors.gray600,
  },
  tabTextActive: { color: Colors.white },
  loadingBox: { alignItems: 'center', padding: Spacing.xl, gap: Spacing.sm },
  loadingText: { color: Colors.gray600, fontSize: Typography.fontSizeSM },
  errorBox: {
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderLeftWidth: 3,
    borderLeftColor: Colors.danger,
  },
  errorText: { color: Colors.danger, fontSize: Typography.fontSizeSM },
  emptyBox: {
    alignItems: 'center',
    backgroundColor: Colors.surface,
    padding: Spacing.lg,
    borderRadius: Radius.md,
    gap: Spacing.sm,
  },
  emptyText: {
    color: Colors.gray600,
    fontSize: Typography.fontSizeSM,
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  sectionSubtitle: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray600,
    marginBottom: Spacing.md,
  },
  tierCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.gray200,
    position: 'relative',
  },
  tierCardCurrent: { borderColor: Colors.border, borderWidth: 2 },
  tierBadge: {
    position: 'absolute',
    top: -10,
    right: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.black,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
    gap: 4,
  },
  tierBadgeText: {
    fontSize: Typography.fontSizeXS,
    fontWeight: Typography.fontWeightBold,
    color: Colors.white,
  },
  tierName: {
    fontSize: Typography.fontSizeXXL,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  tierPriceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 2,
    marginBottom: Spacing.xs,
  },
  tierPriceAmount: {
    fontSize: Typography.fontSizeXXL,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  tierPricePer: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray600,
    marginLeft: 2,
  },
  tierTagline: {
    fontSize: Typography.fontSizeMD,
    color: Colors.gray600,
    marginBottom: Spacing.md,
  },
  tierFeatureList: { marginBottom: Spacing.md },
  tierFeatureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  tierFeatureText: { fontSize: Typography.fontSizeSM, color: Colors.gray800, flex: 1 },
  tierButton: {
    backgroundColor: Colors.accent,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
    alignItems: 'center',
  },
  tierButtonCurrent: { backgroundColor: Colors.gray200 },
  tierButtonText: {
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  tierButtonTextCurrent: { color: Colors.gray600 },
  subscribeDisclosure: {
    fontSize: Typography.fontSizeXS,
    color: Colors.gray600,
    lineHeight: 16,
    marginTop: Spacing.sm,
  },
  disclosureLink: {
    color: Colors.textPrimary,
    textDecorationLine: 'underline',
  },
  creditCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.gray200,
  },
  creditInfo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  creditAmountRow: { flexDirection: 'row', alignItems: 'center' },
  creditCount: {
    fontSize: Typography.fontSizeXXL,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    marginLeft: Spacing.xs,
  },
  creditLabel: { fontSize: Typography.fontSizeMD, color: Colors.gray600, marginLeft: Spacing.xs },
  creditPriceColumn: {
    alignItems: 'flex-end',
  },
  creditPrice: {
    fontSize: Typography.fontSizeXXL,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  creditPerUnit: {
    fontSize: Typography.fontSizeXS,
    color: Colors.gray600,
    marginTop: 2,
  },
  creditLoader: { position: 'absolute', right: Spacing.md, top: '50%', marginTop: -10 },
  restoreButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  restoreButtonText: {
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightSemiBold,
    color: Colors.textPrimary,
  },
  manageButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    marginBottom: Spacing.md,
  },
  manageButtonText: {
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightSemiBold,
    color: Colors.textPrimary,
    textDecorationLine: 'underline',
  },
});
