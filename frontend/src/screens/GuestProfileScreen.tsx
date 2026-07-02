import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import api from '../config/api';
import { useUserStore } from '../store/useUserStore';
import { useConfigStore } from '../store/useConfigStore';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import CreditDisplay from '../components/CreditDisplay';
import RetryableImage from '../components/RetryableImage';
import FullScreenImageModal, { OriginalImageBadge } from '../components/FullScreenImageModal';
import { buildCreationCarousel, CarouselSlot, indexOfSlot } from '../utils/creationCarousel';
import type { Creation } from '../types';
import type { RootStackParams } from '../navigation';

type Nav = NativeStackNavigationProp<RootStackParams>;

// Profile tab for guest (anonymous) sessions. Shows the guest's remaining free
// credits and any creations they've already made (forced-private until they
// convert), and surfaces the signup CTA. Guests create free-form on the Create
// tab, so there is no photo upload here — on conversion their creations and
// remaining credits carry over with the rest of the account.
export default function GuestProfileScreen() {
  const navigation = useNavigation<Nav>();
  const { user } = useUserStore();
  const { signupCreditGrant, signupCreditsOffer } = useConfigStore();
  const [history, setHistory] = useState<Creation[]>([]);
  const [fullScreenImages, setFullScreenImages] = useState<string[]>([]);
  const [fullScreenInitialIndex, setFullScreenInitialIndex] = useState(0);
  const [fullScreenAi, setFullScreenAi] = useState<boolean[]>([]);
  const [fullScreenLabels, setFullScreenLabels] = useState<string[]>([]);
  const [fullScreenBadges, setFullScreenBadges] = useState<(OriginalImageBadge | null)[]>([]);

  // Reload the guest's own creation history whenever the tab regains focus, so a
  // creation completed on the Create tab shows up here without an app restart.
  // /creation/history is requireAuth-only (not blockGuests) and returns the
  // owner's COMPLETE jobs — including the forced-private guest ones.
  const loadHistory = useCallback(async () => {
    try {
      const { data } = await api.get<{ jobs: Creation[] }>('/creations/history');
      setHistory(data.jobs);
    } catch {
      // Leave any previously-loaded history in place on a transient failure.
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [loadHistory]),
  );

  // Open the read-only full-screen carousel for a history item (result and
  // source slides). Guests get the same viewer as the Home feed but no
  // privacy toggle — their creations stay private until they convert.
  const openCarousel = useCallback((item: Creation, slot: CarouselSlot) => {
    const slides = buildCreationCarousel(item);
    if (slides.length === 0) return;
    setFullScreenImages(slides.map((s) => s.url));
    setFullScreenAi(slides.map((s) => s.aiGenerated));
    setFullScreenLabels(slides.map((s) => s.label));
    setFullScreenBadges(slides.map((s) => s.badge));
    setFullScreenInitialIndex(indexOfSlot(slides, slot));
  }, []);

  const credits = user?.credits ?? 0;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerLabel}>Credits</Text>
        <CreditDisplay onPress={() => navigation.navigate('Purchase')} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Ionicons name="person-circle-outline" size={56} color={Colors.gray400} />
        <Text style={styles.title}>You're browsing as a guest</Text>
        <Text style={styles.subtitle}>
          You have {credits} free {credits === 1 ? 'creation' : 'creations'} left. Make something on
          the Create tab, then sign up to keep it.
        </Text>

        {history.length > 0 ? (
          <View style={styles.historySection}>
            <Text style={styles.historyHeading}>Your Creations</Text>
            <FlatList
              data={history}
              numColumns={3}
              scrollEnabled={false}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => {
                const url = item.resultImageUrl ?? item.resultImage2Url;
                return (
                  <TouchableOpacity
                    style={styles.historyItem}
                    activeOpacity={url ? 0.8 : 1}
                    onPress={() => {
                      if (url) openCarousel(item, item.resultImageUrl ? 'full' : 'medium');
                    }}
                  >
                    {url ? (
                      <>
                        <RetryableImage uri={url} style={styles.historyImage} resizeMode="cover" />
                        <View style={styles.privateBadge}>
                          <Ionicons name="lock-closed" size={10} color={Colors.white} />
                        </View>
                      </>
                    ) : (
                      <View style={[styles.historyImage, styles.historyPlaceholder]}>
                        <Text style={styles.historyStatus}>{item.status}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              }}
            />
            <Text style={styles.historyHint}>
              These are private to you. Sign up to keep them — your creations and remaining credits
              carry over to your new account.
            </Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => navigation.navigate('Auth', { screen: 'Signup' })}
        >
          <Text style={styles.primaryButtonText}>
            {signupCreditsOffer ? `Sign Up — Get ${signupCreditGrant} Free Credits` : 'Sign Up'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate('Auth', { screen: 'Login' })}>
          <Text style={styles.secondaryLink}>Already have an account? Log in</Text>
        </TouchableOpacity>
      </ScrollView>

      <FullScreenImageModal
        visible={fullScreenImages.length > 0}
        imageUrls={fullScreenImages}
        initialIndex={fullScreenInitialIndex}
        aiGenerated={fullScreenAi}
        labels={fullScreenLabels}
        originalBadges={fullScreenBadges}
        onClose={() => setFullScreenImages([])}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.gray200,
  },
  headerLabel: {
    fontSize: Typography.fontSizeSM,
    fontWeight: Typography.fontWeightSemiBold,
    color: Colors.gray600,
  },
  content: { alignItems: 'center', padding: Spacing.xl, paddingTop: Spacing.xl },
  title: {
    fontSize: Typography.fontSizeXL,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    marginTop: Spacing.md,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: Typography.fontSizeMD,
    color: Colors.gray600,
    textAlign: 'center',
    marginTop: Spacing.sm,
    lineHeight: 21,
  },
  historySection: {
    alignSelf: 'stretch',
    width: '100%',
    marginTop: Spacing.xl,
  },
  historyHeading: {
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  historyItem: { flex: 1 / 3, aspectRatio: 1, padding: 1, position: 'relative' },
  historyImage: { width: '100%', height: '100%', borderRadius: 4 },
  historyPlaceholder: {
    backgroundColor: Colors.gray100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyStatus: { fontSize: 9, color: Colors.gray400 },
  privateBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    padding: 3,
  },
  historyHint: {
    fontSize: Typography.fontSizeXS,
    color: Colors.gray600,
    marginTop: Spacing.sm,
    lineHeight: 18,
  },
  primaryButton: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    marginTop: Spacing.xl,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  primaryButtonText: {
    color: Colors.textPrimary,
    fontWeight: Typography.fontWeightBold,
    fontSize: Typography.fontSizeMD,
  },
  secondaryLink: {
    color: Colors.gray600,
    marginTop: Spacing.md,
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightSemiBold,
  },
});
