import React, { useEffect, useState } from 'react';
import { Modal, View, Image, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../config/api';
import { Colors, Spacing, Typography } from '../constants/theme';
import {
  resolveSplashDisplay,
  getSplashLocalState,
  setSplashLocalState,
  SplashLocalState,
} from '../utils/splash';

// Backend-controlled splash/announcement screen (promotions, service notices).
// On launch this asks GET /api/splash; when the backend has a splash image
// published, it's shown full-screen and the user must tap OK to continue.
// First showing of a newly published splash: OK only. Second showing onward:
// a "Don't show this again" option appears (also controllable from Settings →
// Announcements). No published splash = this component renders nothing and the
// app proceeds normally. Failures are swallowed — the splash must never block
// or delay app startup.
export default function SplashAnnouncementModal() {
  const [visible, setVisible] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [offerDismiss, setOfferDismiss] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [localState, setLocalState] = useState<SplashLocalState | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/splash');
        if (cancelled || !data?.active || !data.id || !data.imageUrl) return;
        const stored = await getSplashLocalState();
        const decision = resolveSplashDisplay({ id: data.id, imageUrl: data.imageUrl }, stored);
        if (!decision.show || !decision.nextState) return;
        // Persist the incremented seen-count up front so a force-close while
        // the splash is open still counts as a showing.
        await setSplashLocalState(decision.nextState);
        if (cancelled) return;
        setLocalState(decision.nextState);
        setOfferDismiss(decision.offerDismiss);
        setImageUrl(data.imageUrl);
        setVisible(true);
      } catch {
        // Offline / backend hiccup — skip the splash silently.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleOk() {
    if (dontShowAgain && localState) {
      await setSplashLocalState({ ...localState, dismissed: true });
    }
    setVisible(false);
  }

  if (!visible || !imageUrl) return null;

  return (
    <Modal visible animationType="fade" onRequestClose={handleOk}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <Image
          source={{ uri: imageUrl }}
          style={styles.image}
          resizeMode="contain"
          // If the image itself fails to load there's nothing to announce —
          // don't strand the user behind a blank screen.
          onError={() => setVisible(false)}
        />
        <View style={styles.footer}>
          {offerDismiss ? (
            <TouchableOpacity
              style={styles.dismissRow}
              onPress={() => setDontShowAgain((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: dontShowAgain }}
            >
              <Ionicons
                name={dontShowAgain ? 'checkbox' : 'square-outline'}
                size={22}
                color={Colors.black}
              />
              <Text style={styles.dismissLabel}>Don&apos;t show this again</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.okButton} onPress={handleOk} accessibilityRole="button">
            <Text style={styles.okLabel}>OK</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.white },
  image: { flex: 1, width: '100%' },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
  },
  dismissRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  dismissLabel: {
    marginLeft: Spacing.sm,
    fontSize: Typography.fontSizeMD,
    color: Colors.gray600,
  },
  okButton: {
    backgroundColor: Colors.black,
    borderRadius: 28,
    paddingVertical: 14,
    alignItems: 'center',
  },
  okLabel: {
    color: Colors.white,
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightBold,
  },
});
