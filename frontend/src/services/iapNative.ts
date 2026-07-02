/**
 * Expo Go-safe access to `expo-iap`.
 *
 * `expo-iap` resolves its native module with `requireNativeModule('ExpoIap')`
 * AT IMPORT TIME, which throws in stock Expo Go (the module isn't bundled
 * there). Since iap.ts is imported by several screens, a direct
 * `import * as IAP from 'expo-iap'` would crash the whole app on launch in
 * Expo Go.
 *
 * This module defers loading `expo-iap` until a property is actually accessed
 * (via a Proxy), and exposes `IAP_AVAILABLE` so callers can no-op in Expo Go.
 * Net effect: the app runs in Expo Go for everything except purchases; real
 * StoreKit testing happens in a development build / TestFlight (which is the
 * only place IAP works anyway).
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';

// Expo Go reports executionEnvironment === 'storeClient'. Dev builds and
// standalone/TestFlight builds report 'standalone' (or 'bare'), where the
// native ExpoIap module is present.
export const IAP_AVAILABLE =
  Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

let cached: Record<string, unknown> | null = null;

function loadModule(): Record<string, unknown> {
  if (!IAP_AVAILABLE) {
    throw new Error(
      'In-app purchases are unavailable in Expo Go. Use a development build or TestFlight.',
    );
  }
  if (!cached) {
    // Lazily required so merely importing this file never touches the native
    // module — that is what lets Expo Go load the app.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cached = require('expo-iap') as Record<string, unknown>;
  }
  return cached;
}

// Property access (IAP.initConnection, IAP.fetchProducts, ...) resolves against
// the real module only when touched. Existing `IAP.*` call sites keep working
// unchanged on a real build; in Expo Go they throw the friendly error above,
// but callers guard the hot paths with IAP_AVAILABLE so it never gets there.
// Typed `any` on purpose: this mirrors `import * as IAP from 'expo-iap'` at the
// call sites without importing the native module's types at load time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const IAP: any = new Proxy(
  {},
  {
    get(_target, prop) {
      const mod = loadModule();
      return mod[prop as string];
    },
  },
);

export default IAP;
