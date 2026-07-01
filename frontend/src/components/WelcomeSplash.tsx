import React, { useEffect, useState } from 'react';
import { Modal } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useConfigStore } from '../store/useConfigStore';
import HomeHubScreen from '../screens/HomeHubScreen';

// Admin-toggleable welcome splash. When the backend flag `welcomeSplashEnabled`
// is on (Admin Console → "Welcome splash screen") and the user hasn't opted out
// locally, this shows the AnimationStation hub over the app once per launch.
// The user can tick "Do not display at next login" to opt out permanently, or
// dismiss/act from the hub. Renders nothing when disabled or opted out — never
// blocks the app.
const DISMISS_KEY = 'welcome_splash_dismissed_v1';

export default function WelcomeSplash() {
  const enabled = useConfigStore((s) => s.welcomeSplashEnabled);
  const loaded = useConfigStore((s) => s.loaded);
  const [visible, setVisible] = useState(false);
  const [dontShow, setDontShow] = useState(false);
  const [decided, setDecided] = useState(false);

  useEffect(() => {
    if (!loaded || decided) return;
    let cancelled = false;
    (async () => {
      if (!enabled) {
        setDecided(true);
        return;
      }
      let dismissed = false;
      try {
        dismissed = (await SecureStore.getItemAsync(DISMISS_KEY)) === '1';
      } catch {
        // ignore — treat as not dismissed
      }
      if (cancelled) return;
      setDecided(true);
      if (!dismissed) setVisible(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [loaded, enabled, decided]);

  const onDismiss = async () => {
    if (dontShow) {
      try {
        await SecureStore.setItemAsync(DISMISS_KEY, '1');
      } catch {
        // non-fatal — worst case the splash shows again next launch
      }
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <Modal visible animationType="fade" onRequestClose={onDismiss}>
      <HomeHubScreen
        splash={{
          onDismiss,
          dontShowAgain: dontShow,
          onToggleDontShow: () => setDontShow((v) => !v),
        }}
      />
    </Modal>
  );
}
