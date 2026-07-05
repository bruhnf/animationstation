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
import { describeAppleVerifyError, runWithEnvFallback } from '../utils/appleVerifyStatus';

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
  return (await verifyWithEnvFallback((v) => v.verifyAndDecodeNotification(signedPayload))).result;
}

export async function verifyAndDecodeTransaction(
  signedTransactionInfo: string,
): Promise<JWSTransactionDecodedPayload> {
  return (await verifyWithEnvFallback((v) => v.verifyAndDecodeTransaction(signedTransactionInfo)))
    .result;
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
 * Run any SignedDataVerifier decode against the configured environment FIRST,
 * and on an INVALID_ENVIRONMENT failure retry against the OPPOSITE environment.
 *
 * Why: Apple signs TestFlight and App Review payloads with the SANDBOX
 * environment even when the app build talks to the production backend, and real
 * customers produce PRODUCTION payloads. Whichever single environment a box is
 * configured for, the other one's cryptographically-valid receipts AND server
 * notifications would be rejected — breaking either App Review (Guideline 2.1)
 * or live customers. The cert-chain/signature verification is identical in both;
 * only the environment tag differs. Applying this to notifications, transactions
 * AND renewal info lets the webhook worker reconcile entitlement changes from
 * BOTH environments through a single deployed config. The retry orchestration
 * itself lives in appleVerifyStatus.runWithEnvFallback (pure + unit-tested).
 */
async function verifyWithEnvFallback<T>(
  fn: (verifier: SignedDataVerifier) => Promise<T>,
): Promise<{ result: T; environment: 'Production' | 'Sandbox' }> {
  const primaryEnv: 'Production' | 'Sandbox' =
    getEnvironment() === Environment.PRODUCTION ? 'Production' : 'Sandbox';
  return runWithEnvFallback(
    primaryEnv,
    () => fn(getVerifier()),
    () => fn(getFallbackVerifier()),
    {
      onRetry: () =>
        log.info(
          'Apple payload is from the opposite environment — retrying with fallback verifier',
          {
            configuredEnvironment: env.apple.environment,
          },
        ),
      onFallbackFailure: (err) =>
        log.warn('Fallback-environment verification also failed', {
          ...describeAppleVerifyError(err),
        }),
    },
  );
}

export async function verifyAndDecodeTransactionAnyEnv(
  signedTransactionInfo: string,
): Promise<{ transaction: JWSTransactionDecodedPayload; environment: 'Production' | 'Sandbox' }> {
  const { result, environment } = await verifyWithEnvFallback((v) =>
    v.verifyAndDecodeTransaction(signedTransactionInfo),
  );
  return { transaction: result, environment };
}

export async function verifyAndDecodeRenewalInfo(
  signedRenewalInfo: string,
): Promise<JWSRenewalInfoDecodedPayload> {
  return (await verifyWithEnvFallback((v) => v.verifyAndDecodeRenewalInfo(signedRenewalInfo)))
    .result;
}
