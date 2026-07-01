import fs from 'fs';
import path from 'path';
import {
  AppStoreServerAPIClient,
  Environment,
  LastTransactionsItem,
  Status,
  StatusResponse,
} from '@apple/app-store-server-library';
import prisma from '../lib/prisma';
import { env } from '../config/env';
import { verifyAndDecodeRenewalInfo, verifyAndDecodeTransaction } from './appleNotificationService';
import { createChildLogger } from './logger';

const log = createChildLogger('AppleServerApiService');

let cachedClient: AppStoreServerAPIClient | null = null;

export class AppleServerApiNotConfiguredError extends Error {
  constructor() {
    super(
      'App Store Server API is not configured. Set APPLE_API_KEY_ID, APPLE_API_KEY_ISSUER_ID, and APPLE_API_KEY_PATH in the backend .env. Generate an "In-App Purchase" key in App Store Connect → Users and Access → Integrations.',
    );
    this.name = 'AppleServerApiNotConfiguredError';
  }
}

export class AppleServerApiNoSubscriptionError extends Error {
  constructor(userId: string) {
    super(`User ${userId} has no subscription ApplePurchase on file to refresh.`);
    this.name = 'AppleServerApiNoSubscriptionError';
  }
}

function getClient(): AppStoreServerAPIClient {
  if (cachedClient) return cachedClient;
  const { serverApiKeyId, serverApiIssuerId, serverApiKeyPath, bundleId, environment } = env.apple;
  if (!serverApiKeyId || !serverApiIssuerId || !serverApiKeyPath) {
    throw new AppleServerApiNotConfiguredError();
  }
  const resolved = path.resolve(serverApiKeyPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Apple API key file not found at ${resolved}. Check APPLE_API_KEY_PATH.`);
  }
  const signingKey = fs.readFileSync(resolved, 'utf8');
  const apiEnv = environment === 'Production' ? Environment.PRODUCTION : Environment.SANDBOX;
  cachedClient = new AppStoreServerAPIClient(
    signingKey,
    serverApiKeyId,
    serverApiIssuerId,
    bundleId,
    apiEnv,
  );
  log.info('AppStoreServerAPIClient initialized', { environment, bundleId });
  return cachedClient;
}

export interface RefreshResult {
  // Matched the originalTransactionId against Apple's response. False means Apple
  // returned a status group that didn't include this purchase (rare — usually a
  // cross-environment misconfig: sandbox key looking up a production transaction).
  matched: boolean;
  appleStatus: Status | number | null;
  autoRenewStatus: boolean | null;
  expiresAt: Date | null;
  revoked: boolean;
}

// Find the LastTransactionsItem in the StatusResponse that matches our
// originalTransactionId. Apple groups by subscription group, so we may get
// entries for other subs the user has — pick the right one.
function findMatchingTransaction(
  response: StatusResponse,
  originalTransactionId: string,
): LastTransactionsItem | null {
  for (const group of response.data ?? []) {
    for (const item of group.lastTransactions ?? []) {
      if (item.originalTransactionId === originalTransactionId) return item;
    }
  }
  return null;
}

/**
 * Pull authoritative subscription state from Apple's App Store Server API and
 * persist it to the matching ApplePurchase row. Used by the admin "Refresh from
 * Apple" action to reconcile webhook drift or fill in legacy rows where
 * autoRenewStatus is unknown.
 */
export async function refreshSubscriptionForUser(userId: string): Promise<RefreshResult> {
  const purchase = await prisma.applePurchase.findFirst({
    where: { userId, tier: { in: ['BASIC', 'PREMIUM'] } },
    orderBy: [{ expiresAt: 'desc' }, { createdAt: 'desc' }],
  });
  if (!purchase) throw new AppleServerApiNoSubscriptionError(userId);

  const client = getClient();
  const response = await client.getAllSubscriptionStatuses(purchase.originalTransactionId);
  const match = findMatchingTransaction(response, purchase.originalTransactionId);

  if (!match) {
    log.warn('Apple StatusResponse did not contain our originalTransactionId', {
      userId,
      originalTransactionId: purchase.originalTransactionId,
      groupsReturned: response.data?.length ?? 0,
    });
    return {
      matched: false,
      appleStatus: null,
      autoRenewStatus: null,
      expiresAt: purchase.expiresAt,
      revoked: !!purchase.revokedAt,
    };
  }

  // Decode the signed JWS payloads — same verifier we use for webhooks, so the
  // cert chain validation runs here too. We don't trust any field that wasn't
  // signed by Apple.
  const txn = match.signedTransactionInfo
    ? await verifyAndDecodeTransaction(match.signedTransactionInfo)
    : null;
  const renewal = match.signedRenewalInfo
    ? await verifyAndDecodeRenewalInfo(match.signedRenewalInfo)
    : null;

  const appleStatus =
    typeof match.status === 'number'
      ? match.status
      : ((match.status as number | undefined) ?? null);
  const autoRenew =
    renewal?.autoRenewStatus === undefined || renewal?.autoRenewStatus === null
      ? null
      : renewal.autoRenewStatus === 1;
  const expiresAt = txn?.expiresDate ? new Date(txn.expiresDate) : purchase.expiresAt;
  // Status 5 (REVOKED) is Apple's terminal "refunded/revoked" state. Treat it
  // the same as a REVOKE/REFUND webhook would: set revokedAt if not already.
  const revoked = appleStatus === Status.REVOKED;

  await prisma.applePurchase.update({
    where: { id: purchase.id },
    data: {
      appleStatus,
      autoRenewStatus: autoRenew,
      expiresAt,
      revokedAt: revoked ? (purchase.revokedAt ?? new Date()) : purchase.revokedAt,
      lastSyncedFromAppleAt: new Date(),
    },
  });

  log.info('Refreshed subscription state from Apple', {
    userId,
    originalTransactionId: purchase.originalTransactionId,
    appleStatus,
    autoRenew,
    expiresAt,
  });

  return { matched: true, appleStatus, autoRenewStatus: autoRenew, expiresAt, revoked };
}
