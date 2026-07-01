import fs from 'fs';
import path from 'path';
import {
  Environment,
  SignedDataVerifier,
  ResponseBodyV2DecodedPayload,
  JWSTransactionDecodedPayload,
  JWSRenewalInfoDecodedPayload,
} from '@apple/app-store-server-library';
import { env } from '../config/env';
import { createChildLogger } from './logger';
import { isEnvironmentMismatch, describeAppleVerifyError } from '../utils/appleVerifyStatus';

const log = createChildLogger('AppleNotificationService');

let cachedVerifier: SignedDataVerifier | null = null;
let cachedFallbackVerifier: SignedDataVerifier | null = null;

function loadAppleRootCerts(): Buffer[] {
  const dir = path.resolve(env.apple.rootCertsDir);
  if (!fs.existsSync(dir)) {
    throw new Error(
      `Apple root cert dir not found: ${dir}. Download Apple root CAs from https://www.apple.com/certificateauthority/ (at minimum AppleRootCA-G3.cer) and place .cer files in this directory.`,
    );
  }
  const certs = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.cer') || f.toLowerCase().endsWith('.der'))
    .map((f) => fs.readFileSync(path.join(dir, f)));
  if (certs.length === 0) {
    throw new Error(`No Apple root certs (.cer/.der) found in ${dir}`);
  }
  return certs;
}

function getEnvironment(): Environment {
  return env.apple.environment === 'Production' ? Environment.PRODUCTION : Environment.SANDBOX;
}

export function getVerifier(): SignedDataVerifier {
  if (cachedVerifier) return cachedVerifier;
  const roots = loadAppleRootCerts();
  cachedVerifier = new SignedDataVerifier(
    roots,
    true, // enableOnlineChecks — verify cert revocation against Apple
    getEnvironment(),
    env.apple.bundleId,
    env.apple.appAppleId || undefined,
  );
  log.info('Apple SignedDataVerifier initialized', {
    environment: env.apple.environment,
    bundleId: env.apple.bundleId,
    rootCertCount: roots.length,
  });
  return cachedVerifier;
}

export async function verifyAndDecodeNotification(
  signedPayload: string,
): Promise<ResponseBodyV2DecodedPayload> {
  return getVerifier().verifyAndDecodeNotification(signedPayload);
}

export async function verifyAndDecodeTransaction(
  signedTransactionInfo: string,
): Promise<JWSTransactionDecodedPayload> {
  return getVerifier().verifyAndDecodeTransaction(signedTransactionInfo);
}

// Verifier for the OPPOSITE environment from the configured one. Same root
// certs and bundle id; appAppleId is only meaningful for Production.
function getFallbackVerifier(): SignedDataVerifier {
  if (cachedFallbackVerifier) return cachedFallbackVerifier;
  const roots = loadAppleRootCerts();
  const fallbackEnv =
    getEnvironment() === Environment.PRODUCTION ? Environment.SANDBOX : Environment.PRODUCTION;
  cachedFallbackVerifier = new SignedDataVerifier(
    roots,
    true,
    fallbackEnv,
    env.apple.bundleId,
    fallbackEnv === Environment.PRODUCTION ? env.apple.appAppleId || undefined : undefined,
  );
  log.info('Apple fallback SignedDataVerifier initialized', {
    environment: fallbackEnv,
    bundleId: env.apple.bundleId,
  });
  return cachedFallbackVerifier;
}

/**
 * Verify a signed transaction against the configured environment FIRST, and on
 * an INVALID_ENVIRONMENT failure retry against the opposite environment.
 *
 * Why: Apple signs TestFlight and App Review purchases with the SANDBOX
 * environment even when the app build talks to the production backend. A
 * Production-only verifier rejects those receipts, which (a) breaks purchases
 * for TestFlight testers and (b) breaks App Review's own IAP testing — a
 * classic Guideline 2.1 rejection. The cryptographic verification (Apple cert
 * chain, signature) is identical in both cases; only the environment tag
 * differs, and we surface it to the caller so grants can be labeled.
 */
export async function verifyAndDecodeTransactionAnyEnv(
  signedTransactionInfo: string,
): Promise<{ transaction: JWSTransactionDecodedPayload; environment: 'Production' | 'Sandbox' }> {
  const primaryIsProduction = getEnvironment() === Environment.PRODUCTION;
  try {
    const transaction = await getVerifier().verifyAndDecodeTransaction(signedTransactionInfo);
    return { transaction, environment: primaryIsProduction ? 'Production' : 'Sandbox' };
  } catch (err) {
    if (!isEnvironmentMismatch(err)) throw err;
    log.info('Receipt is from the opposite Apple environment — retrying with fallback verifier', {
      configuredEnvironment: env.apple.environment,
    });
    try {
      const transaction =
        await getFallbackVerifier().verifyAndDecodeTransaction(signedTransactionInfo);
      return { transaction, environment: primaryIsProduction ? 'Sandbox' : 'Production' };
    } catch (fallbackErr) {
      log.warn('Fallback-environment verification also failed', {
        ...describeAppleVerifyError(fallbackErr),
      });
      throw fallbackErr;
    }
  }
}

export async function verifyAndDecodeRenewalInfo(
  signedRenewalInfo: string,
): Promise<JWSRenewalInfoDecodedPayload> {
  return getVerifier().verifyAndDecodeRenewalInfo(signedRenewalInfo);
}
