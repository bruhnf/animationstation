import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParams } from './index';

// Standalone navigation ref so non-component code (the axios interceptor, the
// guest gate) can navigate without prop-drilling. Kept in its own module to
// avoid a circular import between navigation/index.tsx and utils/guestGate.ts.
export const navigationRef = createNavigationContainerRef<RootStackParams>();

export function navigateToAuth(screen: 'Login' | 'Signup' = 'Signup'): void {
  if (navigationRef.isReady()) {
    navigationRef.navigate('Auth', { screen });
  }
}
