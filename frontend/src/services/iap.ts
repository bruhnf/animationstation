/**
 * StoreKit / In-App Purchase wrapper for AnimationStation.
 *
 * Wraps `expo-iap` so screens don't have to import the library directly. Centralizes:
 *   - Product ID catalog (subscriptions + credit packs)
 *   - Connection lifecycle (init / end)
 *   - Fetching products with localized prices from Apple
 *   - Initiating purchases with appAccountToken set to our user.id
 *   - Posting the signed receipt to our backend for verification
 *   - Finishing transactions only after the backend confirms
 *
 * Apple App Store Review Guideline 3.1.1: subscription and consumable
 * entitlements must be granted only via StoreKit. Hardcoded prices and
 * server-side "purchase" endpoints are disallowed.
 */
import IAP, { IAP_AVAILABLE } from './iapNative';
import Constants from 'expo-constants';
import api from '../config/api';
import { UserTier } from '../types';

type CreditSizeMap = { '10': string; '25': string; '50': string; '100': string };
type AppleProductsConfig = {
  subscriptions: { basicMonthly: string; premiumMonthly: string };
  credits: { FREE: CreditSizeMap; BASIC: CreditSizeMap; PREMIUM: CreditSizeMap };
};

const APPLE_PRODUCTS: AppleProductsConfig =
  (Constants.expoConfig?.extra as { appleProducts?: AppleProductsConfig })?.appleProducts ??
  ({} as AppleProductsConfig);

const CREDIT_SIZES = ['10', '25', '50', '100'] as const;

export const SUBSCRIPTION_SKUS = [
  APPLE_PRODUCTS.subscriptions?.basicMonthly,
  APPLE_PRODUCTS.subscriptions?.premiumMonthly,
].filter(Boolean) as string[];

// Returns the 4 credit-pack SKUs priced for the given tier. Each tier sees
// different prices in App Store Connect, but the credits granted per pack
// size are identical. The client must offer ONLY the matching tier's SKUs;
// the backend logs a warning if a purchased SKU's tier variant doesn't
// match the user's current tier (see routes/credits.ts verify-receipt).
export function creditPackSkusForTier(tier: UserTier): string[] {
  const map = APPLE_PRODUCTS.credits?.[tier];
  if (!map) return [];
  return CREDIT_SIZES.map((size) => map[size]).filter(Boolean) as string[];
}

// Maps any credit-pack SKU (across all 12 variants) to the number of credits
// it grants. Used only for display; the backend is the source of truth.
export const CREDITS_FOR_SKU: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  for (const tier of ['FREE', 'BASIC', 'PREMIUM'] as UserTier[]) {
    for (const size of CREDIT_SIZES) {
      const sku = APPLE_PRODUCTS.credits?.[tier]?.[size];
      if (sku) map[sku] = parseInt(size, 10);
    }
  }
  return map;
})();

// True when the productId is one of our consumable credit packs (as opposed
// to an auto-renewing subscription). StoreKit needs the correct consumable
// flag at finishTransaction time — a wrong flag can leave the transaction
// unfinished in the queue, where StoreKit re-delivers it on later purchases.
function isConsumableSku(productId: string | undefined | null): boolean {
  return !!productId && productId in CREDITS_FOR_SKU;
}

export interface DisplayProduct {
  sku: string;
  displayPrice: string; // localized, e.g. "$9.99" or "€9,99"
  // Numeric price in major currency units (e.g. 9.99). Used to compute
  // derived figures like price-per-credit. Localized formatting should
  // still come from `displayPrice` whenever possible.
  priceAmount?: number;
  currency?: string;
  title?: string;
  description?: string;
}

let connectionInitialized = false;

export async function initIap(): Promise<void> {
  // Expo Go has no StoreKit native module — no-op so screens that call this on
  // mount (About/Purchase) don't crash. See services/iapNative.ts.
  if (!IAP_AVAILABLE) return;
  if (connectionInitialized) return;
  await IAP.initConnection();
  connectionInitialized = true;
}

export async function endIap(): Promise<void> {
  if (!connectionInitialized) return;
  try {
    await IAP.endConnection();
  } finally {
    connectionInitialized = false;
  }
}

function toDisplay(p: {
  id?: string;
  productId?: string;
  displayPrice?: string;
  price?: string | number;
  currency?: string;
  title?: string;
  description?: string;
}): DisplayProduct {
  // `price` from expo-iap is a numeric string (e.g. "5.99") on iOS. Parse it
  // so we can compute per-credit pricing without re-parsing the localized
  // displayPrice (which would break in non-USD locales).
  const rawPrice = p.price;
  let priceAmount: number | undefined;
  if (typeof rawPrice === 'number' && Number.isFinite(rawPrice)) {
    priceAmount = rawPrice;
  } else if (typeof rawPrice === 'string') {
    const parsed = parseFloat(rawPrice);
    if (Number.isFinite(parsed)) priceAmount = parsed;
  }
  return {
    sku: p.id ?? p.productId ?? '',
    displayPrice: p.displayPrice ?? (typeof rawPrice === 'string' ? rawPrice : '') ?? '',
    priceAmount,
    currency: p.currency,
    title: p.title,
    description: p.description,
  };
}

// Loads the StoreKit catalog for a given user tier: every subscription SKU
// plus the 4 credit-pack SKUs priced for that tier. Wraps the library's
// `IAP.fetchProducts` so callers don't deal with separate calls for subs vs.
// consumables. Named distinctly to avoid colliding with `IAP.fetchProducts`.
export async function loadProductsForTier(tier: UserTier): Promise<{
  subscriptions: DisplayProduct[];
  credits: DisplayProduct[];
}> {
  if (!IAP_AVAILABLE) return { subscriptions: [], credits: [] };
  await initIap();
  const creditSkus = creditPackSkusForTier(tier);
  const [subs, credits] = await Promise.all([
    IAP.fetchProducts({ skus: SUBSCRIPTION_SKUS, type: 'subs' as const }),
    creditSkus.length > 0
      ? IAP.fetchProducts({ skus: creditSkus, type: 'inapp' as const })
      : Promise.resolve([] as unknown[]),
  ]);
  return {
    subscriptions: (subs as unknown as Record<string, unknown>[]).map((p) => toDisplay(p as never)),
    credits: (credits as unknown as Record<string, unknown>[]).map((p) => toDisplay(p as never)),
  };
}

/**
 * Initiate a StoreKit purchase. `userId` is set as `appAccountToken` so App
 * Store Server Notifications can be mapped back to the user on our side.
 *
 * StoreKit on iOS will surface the system purchase sheet. The result comes
 * back via the purchase listener (set up by callers); this function returns
 * once the request has been dispatched.
 */
export async function purchaseSubscription(sku: string, userId: string): Promise<void> {
  await initIap();
  // Cast: Android subscriptions need subscriptionOffers, which we don't ship yet.
  // App is iOS-only at submission time. Revisit when adding Android support.
  await IAP.requestPurchase({
    request: { ios: { sku, appAccountToken: userId } },
    type: 'subs',
  } as never);
}

export async function purchaseCreditPack(sku: string, userId: string): Promise<void> {
  await initIap();
  await IAP.requestPurchase({
    request: { ios: { sku, appAccountToken: userId } },
    type: 'inapp',
  } as never);
}

interface PurchaseLike {
  productId?: string;
  transactionId?: string;
  id?: string;
  // Field names vary by expo-iap version and platform — we try them in order.
  jwsRepresentationIos?: string;
  purchaseToken?: string;
  transactionReceipt?: string;
}

// Pull the JWS / receipt out of a purchase object regardless of which field
// name the installed expo-iap version uses.
function extractReceipt(purchase: PurchaseLike): string | null {
  return (
    purchase.jwsRepresentationIos ?? purchase.purchaseToken ?? purchase.transactionReceipt ?? null
  );
}

/**
 * Send the signed receipt to our backend for verification, then mark the
 * StoreKit transaction as finished. Only finish AFTER the backend confirms
 * the entitlement was applied — finishing earlier would let the entitlement
 * silently fail if our DB write didn't land.
 *
 * If no JWS field is present on the purchase object (library version drift),
 * we log the available keys and skip verify-receipt. The webhook on the
 * backend is the safety net that grants entitlement either way; we still
 * finish the transaction so StoreKit doesn't keep retrying.
 */
export interface VerifyReceiptResult {
  tier?: string;
  credits?: number;
  alreadyProcessed?: boolean;
  // Transient/offline failure (network or 5xx) — the receipt wasn't applied on
  // the spot, but the App Store Server webhook may still reconcile it. Safe to
  // poll/refresh and treat as "pending".
  fastPathSkipped?: boolean;
  // The backend DEFINITIVELY rejected the receipt (HTTP 4xx). The common case is
  // a 403 when the receipt's appAccountToken belongs to a DIFFERENT
  // AnimationStation account — e.g. this Apple ID first subscribed while signed
  // in as another account. Polling/the webhook won't grant it to THIS account,
  // so it must NOT be reported as a successful restore, and the user should be
  // told why.
  rejected?: { status: number; code?: string };
}

export async function verifyAndFinish(purchase: PurchaseLike): Promise<VerifyReceiptResult> {
  const jwsRepresentation = extractReceipt(purchase);

  let result: VerifyReceiptResult = {};

  if (jwsRepresentation) {
    try {
      const { data } = await api.post<{
        success?: boolean;
        alreadyProcessed?: boolean;
        tier?: string;
        credits?: number;
      }>('/credits/verify-receipt', { jwsRepresentation });
      result = data;
    } catch (err) {
      const response = (err as { response?: { status?: number; data?: { error?: string } } })
        ?.response;
      const status = response?.status;
      const code = response?.data?.error;
      if (typeof status === 'number' && status >= 400 && status < 500) {
        // Permanent rejection (foreign/duplicate/malformed receipt). Surface it —
        // the webhook won't grant it to this account either.
        result.rejected = { status, code };
      } else {
        // Transient (network / 5xx) — fall through to finishTransaction so
        // StoreKit doesn't retry forever; the webhook reconciles state.
        result.fastPathSkipped = true;
      }
      console.warn('[iap] verify-receipt failed', { status, code });
    }
  } else {
    // Surface what fields ARE on the object so we can update the extractor.

    console.warn('[iap] Purchase missing JWS — fields available:', Object.keys(purchase));
    result.fastPathSkipped = true;
  }

  // Always finish the transaction to remove it from StoreKit's queue.
  // Wrapped separately so a finish failure never masks a successful verify.
  // The isConsumable flag must match the product type: credit packs are
  // consumable, subscriptions are not. A wrong flag can leave the transaction
  // pending so StoreKit re-delivers it on later purchases.
  try {
    await IAP.finishTransaction({
      purchase: purchase as never,
      isConsumable: isConsumableSku(purchase.productId),
    });
  } catch (finishErr) {
    console.warn(
      '[iap] finishTransaction failed — StoreKit may re-deliver this transaction:',
      finishErr,
    );
  }

  return result;
}

// Flush any transactions StoreKit has queued from previous sessions (e.g. the
// app closed before finishTransaction was called, or a finish failed). These
// are silently finished — the backend is idempotent on transactionId and the
// App Store Server webhook already reconciled state. Call this on
// PurchaseScreen mount; otherwise StoreKit re-delivers stale transactions
// through purchaseUpdatedListener and confuses the busy/spinner state.
//
// `onlyIncludeActiveItemsIOS: false` is REQUIRED here: with the default
// (active items only) StoreKit returns just current entitlements, which never
// includes consumables — so unfinished credit-pack transactions would be
// invisible to the flush and never drained.
export async function flushPendingTransactions(): Promise<void> {
  if (!IAP_AVAILABLE) return;
  await initIap();
  try {
    const pending = (await IAP.getAvailablePurchases({
      onlyIncludeActiveItemsIOS: false,
    } as never)) as unknown as PurchaseLike[];
    await Promise.allSettled(
      pending.map((p) =>
        IAP.finishTransaction({
          purchase: p as never,
          isConsumable: isConsumableSku(p.productId),
        }).catch(() => {}),
      ),
    );
  } catch {
    // Non-fatal — worst case is stale transactions get re-delivered once more
  }
}

/**
 * Restore previously-purchased subscriptions/credits. App Store Review
 * Guideline 3.1.1 requires that auto-renewing subscription apps expose this
 * flow. We re-verify each available purchase against our backend so the user
 * lands in the correct tier even on a fresh install.
 */
export async function restorePurchases(): Promise<{
  // Entitlements the backend actually applied to THIS account (success or
  // already-on-file).
  restoredCount: number;
  // Purchases the backend refused for this account — almost always because the
  // Apple ID's purchase is registered to a different AnimationStation account.
  // Surfaced so the UI can explain instead of falsely claiming a restore.
  rejectedCount: number;
}> {
  if (!IAP_AVAILABLE) return { restoredCount: 0, rejectedCount: 0 };
  await initIap();
  const purchases = (await IAP.getAvailablePurchases()) as unknown as PurchaseLike[];
  let restoredCount = 0;
  let rejectedCount = 0;
  for (const purchase of purchases) {
    // verifyAndFinish never throws — it captures verify/finish errors on the
    // result — so a single bad receipt can't abort the loop.
    const result = await verifyAndFinish(purchase);
    if (result.rejected) {
      rejectedCount += 1;
    } else if (!result.fastPathSkipped) {
      // Backend applied it: fresh success OR alreadyProcessed (already on file).
      restoredCount += 1;
    }
  }
  return { restoredCount, rejectedCount };
}

/**
 * Open the iOS Manage Subscriptions screen. Required by App Store guidelines
 * for any app with auto-renewing subscriptions.
 */
export const MANAGE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';
