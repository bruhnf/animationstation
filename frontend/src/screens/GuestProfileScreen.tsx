import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import api from '../config/api';
import { useUserStore } from '../store/useUserStore';
import { useConfigStore } from '../store/useConfigStore';
import { processImageForUpload, isLowResolution, confirmLowResolution } from '../utils/imageUtils';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import CreditDisplay from '../components/CreditDisplay';
import UploadTipsSheet from '../components/UploadTipsSheet';
import RetryableImage from '../components/RetryableImage';
import FullScreenImageModal, { OriginalImageBadge } from '../components/FullScreenImageModal';
import { buildTryOnCarousel, CarouselSlot, indexOfSlot } from '../utils/tryonCarousel';
import type { TryOnJob } from '../types';
import type { RootStackParams } from '../navigation';

type Nav = NativeStackNavigationProp<RootStackParams>;

// Profile tab for guest (anonymous) sessions. Unlike the generic
// GuestPromptScreen, this one lets a guest add a photo — used for the free
// creation — and surfaces the signup CTA. Photo upload endpoints are NOT
// guest-gated on the backend, so the guest's free creation can run; on
// conversion these photos carry over with the rest of the account.
export default function GuestProfileScreen() {
  const navigation = useNavigation<Nav>();
  const { user, updateUser } = useUserStore();
  const { signupCreditGrant, signupCreditsOffer } = useConfigStore();
  const [uploading, setUploading] = useState<'fullBody' | 'medium' | null>(null);
  const [tipsVisible, setTipsVisible] = useState(false);
  const [history, setHistory] = useState<TryOnJob[]>([]);
  const [fullScreenImages, setFullScreenImages] = useState<string[]>([]);
  const [fullScreenInitialIndex, setFullScreenInitialIndex] = useState(0);
  const [fullScreenAi, setFullScreenAi] = useState<boolean[]>([]);
  const [fullScreenLabels, setFullScreenLabels] = useState<string[]>([]);
  const [fullScreenBadges, setFullScreenBadges] = useState<(OriginalImageBadge | null)[]>([]);

  // Reload the guest's own creation history whenever the tab regains focus, so a
  // creation completed on the Create tab shows up here without an app restart.
  // /tryon/history is requireAuth-only (not blockGuests) and returns the
  // owner's COMPLETE jobs — including the forced-private guest ones.
  const loadHistory = useCallback(async () => {
    try {
      const { data } = await api.get<{ jobs: TryOnJob[] }>('/tryon/history');
      setHistory(data.jobs);
    } catch {
      // Leave any previously-loaded history in place on a transient failure.
    } finally {
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
  const openCarousel = useCallback((item: TryOnJob, slot: CarouselSlot) => {
    const slides = buildTryOnCarousel(item);
    if (slides.length === 0) return;
    setFullScreenImages(slides.map((s) => s.url));
    setFullScreenAi(slides.map((s) => s.aiGenerated));
    setFullScreenLabels(slides.map((s) => s.label));
    setFullScreenBadges(slides.map((s) => s.badge));
    setFullScreenInitialIndex(indexOfSlot(slides, slot));
  }, []);

  async function handlePhotoUpload(field: 'fullBody' | 'medium', endpoint: string) {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;

    // Source photos set the quality ceiling for every creation — warn early.
    if (
      isLowResolution(result.assets[0].width, result.assets[0].height) &&
      !(await confirmLowResolution('body'))
    ) {
      return;
    }

    setUploading(field);
    try {
      const processedImage = await processImageForUpload(result.assets[0].uri, {
        maxWidth: 1536,
        maxHeight: 2048,
        compress: 0.85,
      });
      const formData = new FormData();
      formData.append('photo', processedImage as unknown as Blob);
      const { data } = await api.post<{ url: string }>(endpoint, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (field === 'fullBody') updateUser({ fullBodyUrl: data.url });
      if (field === 'medium') updateUser({ mediumBodyUrl: data.url });
    } catch {
      Alert.alert('Upload Failed', 'Could not upload photo. Please try again.');
    } finally {
      setUploading(null);
    }
  }

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
          Add a photo and tap the camera button to start creating — you have {credits} free{' '}
          {credits === 1 ? 'creation' : 'creations'} left.
        </Text>

        <View style={styles.photosRow}>
          <BodyPhotoSlot
            label="Full Body"
            url={user?.fullBodyUrl}
            loading={uploading === 'fullBody'}
            onPress={() => handlePhotoUpload('fullBody', '/upload/full-body')}
          />
          <BodyPhotoSlot
            label="Waist-up (optional)"
            url={user?.mediumBodyUrl}
            loading={uploading === 'medium'}
            onPress={() => handlePhotoUpload('medium', '/upload/medium-body')}
          />
        </View>
        <TouchableOpacity onPress={() => setTipsVisible(true)} hitSlop={8}>
          <Text style={styles.tipsLink}>📸 Tips for photos that get the best results</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>
          We never share your close-up/profile photo with the AI — only the photos you choose for a
          creation.
        </Text>

        <UploadTipsSheet visible={tipsVisible} kind="body" onClose={() => setTipsVisible(false)} />

        {history.length > 0 ? (
          <View style={styles.historySection}>
            <Text style={styles.historyHeading}>Your Creations</Text>
            <FlatList
              data={history}
              numColumns={3}
              scrollEnabled={false}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => {
                const url = item.resultFullBodyUrl ?? item.resultMediumUrl;
                return (
                  <TouchableOpacity
                    style={styles.historyItem}
                    activeOpacity={url ? 0.8 : 1}
                    onPress={() => {
                      if (url) openCarousel(item, item.resultFullBodyUrl ? 'full' : 'medium');
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

function BodyPhotoSlot({
  label,
  url,
  loading,
  onPress,
}: {
  label: string;
  url?: string;
  loading: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.photoSlot} onPress={onPress} disabled={loading}>
      {loading ? (
        <ActivityIndicator color={Colors.gray400} />
      ) : url ? (
        <RetryableImage uri={url} style={styles.photoImage} resizeMode="cover" />
      ) : (
        <View style={styles.photoEmpty}>
          <Text style={styles.photoPlus}>+</Text>
          <Text style={styles.photoEmptyLabel}>{label}</Text>
        </View>
      )}
      {url ? (
        <View style={styles.photoLabel}>
          <Text style={styles.photoLabelText}>{label}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.white },
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
    color: Colors.black,
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
  photosRow: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xl },
  photoSlot: {
    width: 130,
    aspectRatio: 3 / 4,
    borderRadius: Radius.md,
    backgroundColor: Colors.gray100,
    borderWidth: 1,
    borderColor: Colors.gray200,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoImage: { width: '100%', height: '100%' },
  photoEmpty: { alignItems: 'center' },
  photoPlus: { fontSize: 32, color: Colors.gray400, fontWeight: Typography.fontWeightBold },
  photoEmptyLabel: { fontSize: Typography.fontSizeSM, color: Colors.gray600, marginTop: 4 },
  photoLabel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingVertical: 4,
    alignItems: 'center',
  },
  photoLabelText: {
    color: Colors.white,
    fontSize: Typography.fontSizeXS,
    fontWeight: Typography.fontWeightSemiBold,
  },
  hint: {
    fontSize: Typography.fontSizeXS,
    color: Colors.gray400,
    textAlign: 'center',
    marginTop: Spacing.md,
    lineHeight: 18,
  },
  tipsLink: {
    fontSize: Typography.fontSizeSM,
    color: Colors.black,
    fontWeight: Typography.fontWeightSemiBold,
    textAlign: 'center',
    marginTop: Spacing.md,
  },
  historySection: {
    alignSelf: 'stretch',
    width: '100%',
    marginTop: Spacing.xl,
  },
  historyHeading: {
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightBold,
    color: Colors.black,
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
    color: Colors.black,
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
