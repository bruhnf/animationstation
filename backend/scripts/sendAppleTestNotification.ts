/**
 * One-shot script: ask Apple to fire a TEST notification at our configured URL.
 *
 * Usage (from backend/):
 *   APPLE_ISSUER_ID=...    \
 *   APPLE_KEY_ID=...       \
 *   APPLE_PRIVATE_KEY_PATH=./secrets/AuthKey_XXXXXXXXXX.p8 \
 *   APPLE_BUNDLE_ID=com.evofaceflow.tryon.app \
 *   npx ts-node scripts/sendAppleTestNotification.ts [sandbox|production]
 *
 * Defaults to sandbox. Apple sends the test notification to whichever URL is
 * saved in App Store Connect for that environment. Watch the backend logs to
 * confirm delivery.
 */
import { readFileSync } from 'fs';
import {
  AppStoreServerAPIClient,
  Environment,
} from '@apple/app-store-server-library';

async function main() {
  const issuerId = process.env.APPLE_ISSUER_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const keyPath = process.env.APPLE_PRIVATE_KEY_PATH;
  const bundleId = process.env.APPLE_BUNDLE_ID;
  const envArg = (process.argv[2] ?? 'sandbox').toLowerCase();

  if (!issuerId || !keyId || !keyPath || !bundleId) {
    console.error(
      'Missing env vars. Required: APPLE_ISSUER_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY_PATH, APPLE_BUNDLE_ID',
    );
    process.exit(1);
  }

  const environment = envArg === 'production' ? Environment.PRODUCTION : Environment.SANDBOX;
  const privateKey = readFileSync(keyPath, 'utf8');

  const client = new AppStoreServerAPIClient(privateKey, keyId, issuerId, bundleId, environment);

  console.log(`Requesting test notification (${environment})...`);
  const response = await client.requestTestNotification();
  const token = response.testNotificationToken;
  console.log('testNotificationToken:', token);

  // Poll once for delivery status. Apple may not have a result yet — that's fine.
  console.log('Waiting 5s, then checking delivery status...');
  await new Promise((r) => setTimeout(r, 5000));

  try {
    const status = await client.getTestNotificationStatus(token!);
    console.log('Status:', JSON.stringify(status, null, 2));
  } catch (err) {
    console.log('Status not yet available. Re-check by hand if needed:', (err as Error).message);
  }
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
