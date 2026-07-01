import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Sentry from '@sentry/react-native';
import AppNavigator from './src/navigation';

// Mirror the backend's posture: the whole Sentry integration is GATED on a DSN.
// With EXPO_PUBLIC_SENTRY_DSN unset (local dev, or any build that hasn't wired
// it up) init never runs and Sentry.wrap is a passthrough — zero behaviour
// change. Set EXPO_PUBLIC_SENTRY_DSN (an EAS env var / .env) to switch it on.
// EXPO_PUBLIC_-prefixed vars are inlined into the JS bundle at build time.
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    // Errors only by default (tracesSampleRate 0) to preserve the free-tier
    // quota — matches the backend. Bump via EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE.
    tracesSampleRate: Number(process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0),
    // We handle PII deliberately: don't let the SDK attach IP/user data on its
    // own. The app processes personal photos/emails, so default-on PII is unsafe.
    sendDefaultPii: false,
    environment:
      process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? (__DEV__ ? 'development' : 'production'),
  });
}

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AppNavigator />
    </SafeAreaProvider>
  );
}

// Sentry.wrap adds the error boundary + touch/navigation breadcrumbs. Only
// apply it when Sentry was actually initialized above: in @sentry/react-native
// 7.x `wrap` opens an "App Start" span on import and warns ("App Start Span
// could not be finished. `Sentry.wrap` was called before `Sentry.init`") when
// no client exists — which is every local dev run, where DSN is unset. Gating
// on the DSN keeps that path a true no-op and silences the warning.
export default SENTRY_DSN ? Sentry.wrap(App) : App;
