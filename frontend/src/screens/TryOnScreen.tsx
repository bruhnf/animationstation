import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Image,
  ActivityIndicator,
  Switch,
  TextInput,
  Linking,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import api from '../config/api';
import { useUserStore } from '../store/useUserStore';
import { useClosetStore } from '../store/useClosetStore';
import { requireRealUser } from '../utils/guestGate';
import { TryOnJob, ClosetItem } from '../types';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import FullScreenImageModal from '../components/FullScreenImageModal';
import CreditDisplay from '../components/CreditDisplay';
import HeaderMenu from '../components/HeaderMenu';
import AiGeneratedBadge from '../components/AiGeneratedBadge';
import RetryableImage from '../components/RetryableImage';
import AiConsentModal from '../components/AiConsentModal';
import UploadTipsSheet from '../components/UploadTipsSheet';
import AppButton from '../components/ui/AppButton';
import { RootStackParams } from '../navigation';
import { processImageForUpload, isLowResolution, confirmLowResolution } from '../utils/imageUtils';

// One-time flag: once the user dismisses the inline tips card it stays gone.
// The "Tips" link next to the section label remains as the permanent entry.
const TIPS_CARD_DISMISSED_KEY = 'upload_tips_card_dismissed_v1';

const POLL_INTERVAL_MS = 2500; // 2.5s between polls — tightened so the result
// appears promptly after the worker finishes (generation is now ~12s with the
// parallel-perspective change; a 5s poll added up to 5s of perceived lag).
const MAX_POLL_ERRORS = 3; // Stop polling after this many consecutive errors

// Keep in sync with TRYON_TITLE_MAX_LENGTH in backend tryonController — the
// server also trims + caps, this is just for the live character counter.
const TRYON_TITLE_MAX = 140;

// Optional free-form prompt describing how to transform the reference image.
// Kept in sync with the backend's 300-char cap on the `prompt` field.
const PROMPT_MAX = 300;

export default function TryOnScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const user = useUserStore((s) => s.user);
  const refreshUser = useUserStore((s) => s.refreshUser);

  const [clothingPhotos, setClothingPhotos] = useState<string[]>([]);
  // Outfit Designer alternative to a photo: a saved closet item. Mutually
  // exclusive with clothingPhotos (one clothing source per try-on).
  const [closetItem, setClosetItem] = useState<ClosetItem | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  // Optional caption the user can add to their creation; shown under the result
  // image on the public feed. Capped to match the server (TRYON_TITLE_MAX).
  const [title, setTitle] = useState('');
  // Optional free-form prompt describing how to transform the reference image.
  // Sent as the `prompt` field on submit; empty is allowed. Capped to PROMPT_MAX.
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [activeJob, setActiveJob] = useState<TryOnJob | null>(null);
  const [aiConsentVisible, setAiConsentVisible] = useState(false);
  const [tipsVisible, setTipsVisible] = useState(false);
  // Starts true so the card never flashes before the stored flag loads.
  const [tipsCardDismissed, setTipsCardDismissed] = useState(true);

  // Scrolls the caption field above the keyboard when it's focused (belt-and-
  // braces alongside automaticallyAdjustKeyboardInsets on the ScrollView).
  const scrollRef = useRef<ScrollView>(null);

  // Use refs for polling to avoid closure issues and ensure cleanup
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollErrorsRef = useRef(0);
  const isMountedRef = useRef(true);

  const maxItems = 1; // One clothing item per try-on

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    SecureStore.getItemAsync(TIPS_CARD_DISMISSED_KEY)
      .then((v) => {
        if (isMountedRef.current && !v) setTipsCardDismissed(false);
      })
      .catch(() => {});
  }, []);

  function dismissTipsCard() {
    setTipsCardDismissed(true);
    SecureStore.setItemAsync(TIPS_CARD_DISMISSED_KEY, '1').catch(() => {});
  }

  // Consume a closet pick handed over by ClosetScreen (set there, cleared
  // here) whenever this tab regains focus.
  useFocusEffect(
    useCallback(() => {
      const picked = useClosetStore.getState().consumePendingSelection();
      if (picked) {
        setClosetItem(picked);
        setClothingPhotos([]);
        setActiveJob(null);
      }
    }, []),
  );

  async function pickClothingPhoto() {
    if (clothingPhotos.length >= maxItems) {
      Alert.alert('Limit Reached', 'You can only add 1 reference image per creation.');
      return;
    }

    // Show the source choice FIRST — only request Camera permission if the
    // user actually picks "Take Photo". Library uploads use PHPicker which is
    // permission-less on iOS 14+. Requesting Camera up-front violates iOS
    // best practice (Apple HIG: ask in context, when the user expresses
    // intent) and was a likely contributor to App Store reviewer confusion.
    Alert.alert('Add Reference Image', 'How would you like to add a reference image?', [
      { text: 'Take Photo', onPress: takePhoto },
      { text: 'Choose from Library', onPress: pickFromLibrary },
      {
        text: 'My Library ✨',
        onPress: () => {
          // The library is a real-account feature; guests get the signup
          // prompt instead of a dead screen.
          if (requireRealUser('Create a free account to generate and save images.')) {
            navigation.navigate('Closet', { picker: true });
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Camera Access Needed',
        'AnimationStation needs camera access to take photos. You can enable it in iOS Settings, or choose a photo from your library instead.',
        [
          { text: 'Choose from Library', onPress: pickFromLibrary },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      await addClothingPhoto(result.assets[0]);
    }
  }

  async function pickFromLibrary() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      await addClothingPhoto(result.assets[0]);
    }
  }

  // Catch marginal photos before a credit is spent: a low-res source loses
  // detail through the AI pipeline and users blame the app for the result.
  async function addClothingPhoto(asset: ImagePicker.ImagePickerAsset) {
    if (isLowResolution(asset.width, asset.height) && !(await confirmLowResolution('clothing'))) {
      return;
    }
    // Mutually exclusive clothing sources — a fresh photo replaces any closet
    // pick (the UI hides Add while one is selected; this is belt-and-braces).
    setClosetItem(null);
    setClothingPhotos((prev) => [...prev, asset.uri]);
  }

  function removePhoto(index: number) {
    setClothingPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    if (clothingPhotos.length === 0 && !closetItem) {
      Alert.alert('No Image', 'Please add a reference image or pick one from your library.');
      return;
    }
    const hasWeeklyAllowance = user?.tier === 'BASIC' || user?.tier === 'PREMIUM';
    if (!hasWeeklyAllowance && (user?.credits ?? 0) <= 0) {
      Alert.alert(
        'Credits Required',
        'You need credits or a Basic/Premium subscription to generate images.',
        [
          { text: 'Not Now', style: 'cancel' },
          { text: 'Get Credits', onPress: () => navigation.navigate('Purchase') },
        ],
      );
      return;
    }

    // App Store Review Guidelines 5.1.1(i) / 5.1.2(i): require explicit
    // in-app consent before any photo is transmitted to xAI. The backend also
    // enforces this (returns AI_CONSENT_REQUIRED) so a tampered client can't
    // bypass it.
    if (!user?.aiProcessingConsentAt) {
      setAiConsentVisible(true);
      return;
    }

    await performTryOnSubmit();
  }

  async function performTryOnSubmit() {
    setSubmitting(true);
    try {
      const formData = new FormData();

      if (closetItem) {
        // Closet path: the server already holds the outfit image — just
        // reference it. No upload, no resize.
        formData.append('closetItemId', closetItem.id);
      } else {
        // Process each photo to convert HEIF to JPEG
        for (const uri of clothingPhotos) {
          const processedImage = await processImageForUpload(uri, {
            maxWidth: 1536,
            maxHeight: 2048,
            compress: 0.85,
          });
          formData.append('photos', processedImage as unknown as Blob);
        }
      }
      formData.append('isPrivate', isPrivate.toString());
      // Optional caption. Trimmed; only sent when non-empty (the server also
      // sanitizes + length-caps it).
      const trimmedTitle = title.trim();
      if (trimmedTitle) formData.append('title', trimmedTitle);
      // Optional free-form prompt describing how to transform the reference
      // image. Trimmed; only sent when non-empty (the server accepts an
      // optional `prompt` field, max 300 chars).
      const trimmedPrompt = prompt.trim();
      if (trimmedPrompt) formData.append('prompt', trimmedPrompt);

      const { data } = await api.post<{
        jobId: string;
        status: string;
        scheduledStartAt?: string | null;
        queueDelayMs?: number;
      }>('/tryon', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setActiveJob({
        id: data.jobId,
        status: 'PENDING',
        scheduledStartAt: data.scheduledStartAt ?? null,
      } as TryOnJob);

      // The submit deducted a credit server-side (when not covered by a weekly
      // allowance). Re-sync the user so the CreditDisplay on this screen updates
      // immediately — otherwise the stale balance lingers until another screen
      // refreshes the store. Authoritative (handles credit vs. weekly-allowance
      // cases correctly); fire-and-forget so it never blocks the result view.
      void refreshUser();

      // Set expectations *before* the countdown view appears so users
      // understand they're sharing a queue with other members rather than
      // waiting on a stuck job. Never framed as a "limit" — they're in line.
      if (data.queueDelayMs && data.queueDelayMs > 0) {
        const seconds = Math.max(1, Math.round(data.queueDelayMs / 1000));
        const upsell =
          user?.tier === 'PREMIUM' ? '' : ' Subscribers get faster queues and shorter waits.';
        Alert.alert(
          "You're in the queue",
          `A lot of members are creating right now, so yours is in the shared queue and will start in about ${seconds} second${seconds === 1 ? '' : 's'}.${upsell} You can close the app — we'll have your result ready in your Profile.`,
        );
      }

      pollJobStatus(data.jobId);
    } catch (err: unknown) {
      const error = (err as { response?: { data?: { error?: string; message?: string } } })
        ?.response?.data;
      if (error?.error === 'CLOSET_ITEM_NOT_FOUND') {
        setClosetItem(null);
        Alert.alert(
          'Image Missing',
          'That saved image no longer exists. Pick another or add a photo.',
        );
      } else if (error?.error === 'AI_CONSENT_REQUIRED') {
        // The local store thought consent was on file but the server disagreed.
        // Surface the consent dialog so the user can re-confirm.
        setAiConsentVisible(true);
      } else if (error?.error === 'SUBSCRIPTION_REQUIRED') {
        // Navigate to purchase screen instead of showing error
        Alert.alert('Credits Required', 'You need credits or a subscription to generate images.', [
          { text: 'Not Now', style: 'cancel' },
          { text: 'Get Credits', onPress: () => navigation.navigate('Purchase') },
        ]);
      } else if (error?.error === 'WEEKLY_LIMIT_REACHED') {
        Alert.alert(
          'Weekly Limit Reached',
          error.message ?? "You've used all your weekly generations. Get more credits to continue.",
          [
            { text: 'OK', style: 'cancel' },
            { text: 'Get Credits', onPress: () => navigation.navigate('Purchase') },
          ],
        );
      } else if (error?.error === 'TRYON_LIMIT_REACHED') {
        Alert.alert(
          'Storage Full',
          error.message ??
            "You've reached the storage limit. Delete some creations from your Profile to continue.",
          [
            { text: 'Not Now', style: 'cancel' },
            {
              text: 'Open Profile',
              // Profile is a tab, not a root-stack screen, so the typed
              // navigator doesn't know about it directly. The cast lets
              // React Navigation bubble the name up to the tab navigator
              // at runtime.
              onPress: () => (navigation.navigate as (route: string) => void)('Profile'),
            },
          ],
        );
      } else {
        Alert.alert('Error', 'Could not submit your creation. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function pollJobStatus(jobId: string) {
    if (!isMountedRef.current) return;

    pollTimerRef.current = setTimeout(async () => {
      if (!isMountedRef.current) return;

      try {
        const { data } = await api.get<TryOnJob>(`/tryon/${jobId}`);
        if (!isMountedRef.current) return;

        setActiveJob(data);
        pollErrorsRef.current = 0; // Reset error count on success

        if (data.status === 'PENDING' || data.status === 'PROCESSING') {
          pollJobStatus(jobId);
        }
      } catch (err: unknown) {
        if (!isMountedRef.current) return;

        const status = (err as { response?: { status?: number } })?.response?.status;
        pollErrorsRef.current += 1;

        if (status === 429) {
          // Rate limited — back off and retry after 10s.
          pollTimerRef.current = setTimeout(() => pollJobStatus(jobId), 10000);
        } else if (pollErrorsRef.current < MAX_POLL_ERRORS) {
          // Retry on other errors
          pollJobStatus(jobId);
        } else {
          // Too many errors - show user a way to retry
          Alert.alert(
            'Connection Issue',
            'Unable to check job status. The job may still be processing.',
            [
              {
                text: 'Check Again',
                onPress: () => {
                  pollErrorsRef.current = 0;
                  pollJobStatus(jobId);
                },
              },
              { text: 'Start Over', onPress: resetTryOn, style: 'destructive' },
            ],
          );
        }
      }
    }, POLL_INTERVAL_MS);
  }

  function resetTryOn() {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollErrorsRef.current = 0;
    setClothingPhotos([]);
    setClosetItem(null);
    setIsPrivate(false);
    setPrompt('');
    setActiveJob(null);
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <HeaderMenu
        title="Transform"
        showBack
        rightComponent={<CreditDisplay onPress={() => navigation.navigate('Purchase')} />}
      />
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.inner}
        // Keep the focused field (e.g. the optional caption near the bottom)
        // above the keyboard: on iOS this adds a keyboard-sized content inset
        // and scrolls the first responder into view. No-op on Android, which
        // resizes the window instead.
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {!activeJob && (
          <>
            <View style={styles.sectionLabelRow}>
              <Text style={styles.sectionLabel}>Reference Image</Text>
              <TouchableOpacity onPress={() => setTipsVisible(true)} hitSlop={8}>
                <Text style={styles.tipsLink}>📸 Tips</Text>
              </TouchableOpacity>
            </View>

            {!tipsCardDismissed && (
              <View style={styles.tipsCard}>
                <View style={styles.tipsCardBody}>
                  <Text style={styles.tipsCardTitle}>Get the best results</Text>
                  <Text style={styles.tipsCardText}>
                    Clear, well-lit, high-resolution photos work best.{' '}
                    <Text style={styles.tipsCardLink} onPress={() => setTipsVisible(true)}>
                      See all tips
                    </Text>
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={dismissTipsCard}
                  hitSlop={8}
                  accessibilityLabel="Dismiss tips"
                >
                  <Text style={styles.tipsCardClose}>✕</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.photoRow}>
              {clothingPhotos.map((uri, i) => (
                <View key={i} style={styles.photoSlot}>
                  <Image source={{ uri }} style={styles.photoImage} resizeMode="cover" />
                  <TouchableOpacity style={styles.removeBtn} onPress={() => removePhoto(i)}>
                    <Text style={styles.removeBtnText}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}

              {closetItem && (
                <View style={styles.photoSlot}>
                  <Image
                    source={{ uri: closetItem.imageUrl }}
                    style={styles.photoImage}
                    resizeMode="cover"
                  />
                  <View style={styles.closetTag}>
                    <Text style={styles.closetTagText} numberOfLines={1}>
                      ✨ {closetItem.name}
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.removeBtn} onPress={() => setClosetItem(null)}>
                    <Text style={styles.removeBtnText}>✕</Text>
                  </TouchableOpacity>
                </View>
              )}

              {clothingPhotos.length < maxItems && !closetItem && (
                <TouchableOpacity style={styles.photoSlot} onPress={pickClothingPhoto}>
                  <View style={styles.addPlaceholder}>
                    <Text style={styles.addPlus}>+</Text>
                    <Text style={styles.addLabel}>Add Reference Image</Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.subtitle}>
              Add a reference image and describe how you want it transformed.
            </Text>

            <View style={styles.captionBlock}>
              <Text style={styles.captionLabel}>Prompt (optional)</Text>
              <TextInput
                style={styles.promptInput}
                value={prompt}
                onChangeText={setPrompt}
                placeholder="Describe how to transform this image — e.g. “make it a watercolor painting”"
                placeholderTextColor={Colors.gray400}
                maxLength={PROMPT_MAX}
                multiline
                textAlignVertical="top"
                onFocus={() =>
                  setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150)
                }
              />
              <Text style={styles.captionHint}>{PROMPT_MAX - prompt.length} left</Text>
            </View>

            <View style={styles.captionBlock}>
              <Text style={styles.captionLabel}>Add a caption (optional)</Text>
              <TextInput
                style={styles.captionInput}
                value={title}
                onChangeText={setTitle}
                placeholder="Name this creation — e.g. “Neon dreamscape”"
                placeholderTextColor={Colors.gray400}
                maxLength={TRYON_TITLE_MAX}
                returnKeyType="done"
                // Defer so the keyboard inset is applied before we scroll, then
                // bring the caption (near the bottom) above the keyboard.
                onFocus={() =>
                  setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150)
                }
              />
              <Text style={styles.captionHint}>
                Shown under your result on the feed. {TRYON_TITLE_MAX - title.length} left
              </Text>
            </View>

            <View style={styles.privacyRow}>
              <View style={styles.privacyInfo}>
                <Text style={styles.privacyLabel}>Keep Private</Text>
                <Text style={styles.privacyHint}>
                  {isPrivate ? 'Only visible to you' : 'Visible on public feed'}
                </Text>
              </View>
              <Switch
                value={isPrivate}
                onValueChange={setIsPrivate}
                trackColor={{ false: Colors.gray200, true: Colors.black }}
                thumbColor={Colors.white}
              />
            </View>

            <TouchableOpacity
              style={[styles.submitBtn, submitting && styles.disabled]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color={Colors.white} />
              ) : (
                <Text style={styles.submitBtnText}>Generate</Text>
              )}
            </TouchableOpacity>
          </>
        )}

        {activeJob && <ResultView job={activeJob} onReset={resetTryOn} />}

        <UploadTipsSheet
          visible={tipsVisible}
          kind="clothing"
          onClose={() => setTipsVisible(false)}
        />

        <AiConsentModal
          visible={aiConsentVisible}
          onAgree={() => {
            setAiConsentVisible(false);
            void performTryOnSubmit();
          }}
          onCancel={() => setAiConsentVisible(false)}
        />
      </ScrollView>
    </View>
  );
}

function ResultView({ job, onReset }: { job: TryOnJob; onReset: () => void }) {
  const [fullScreenImages, setFullScreenImages] = useState<string[]>([]);
  const [fullScreenIndex, setFullScreenIndex] = useState(0);
  // Drives the "subscribers get faster queues" upsell on the queued view —
  // hidden for PREMIUM (already the fastest tier).
  const tier = useUserStore((s) => s.user?.tier);
  const isPending = job.status === 'PENDING' || job.status === 'PROCESSING';
  const isFailed = job.status === 'FAILED';

  // Throttle countdown. Ticks once per second while a `scheduledStartAt` in
  // the future exists. When it elapses we fall through to the normal
  // "Generating…" view; the worker will pick the job up at that moment.
  const startAt = job.scheduledStartAt ? new Date(job.scheduledStartAt).getTime() : 0;
  const [now, setNow] = useState<number>(() => Date.now());
  const remainingMs = Math.max(0, startAt - now);
  const isQueued = isPending && startAt > 0 && remainingMs > 0;

  useEffect(() => {
    if (!isQueued) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isQueued]);

  if (isFailed) {
    return (
      <View style={styles.resultContainer}>
        <Text style={styles.resultErrorTitle}>Generation Failed</Text>
        <Text style={styles.resultErrorText}>
          {job.errorMessage ?? 'Something went wrong. Please try again.'}
        </Text>
        <TouchableOpacity style={styles.submitBtn} onPress={onReset}>
          <Text style={styles.submitBtnText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (isQueued) {
    const totalSec = Math.ceil(remainingMs / 1000);
    const mm = Math.floor(totalSec / 60);
    const ss = totalSec % 60;
    const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
    return (
      <View style={styles.resultContainer}>
        <Text style={styles.queuedEmoji}>⏳</Text>
        <Text style={styles.queuedTitle}>You're in the queue</Text>
        <Text style={styles.queuedCountdown}>{`Starts in ${mm}:${pad(ss)}`}</Text>
        <Text style={styles.queuedSubtext}>
          A lot of members are creating right now — yours will start automatically.
          {tier === 'PREMIUM' ? '' : ' Subscribers get faster queues and shorter waits.'} You can
          close the app; we'll have your result ready in your Profile.
        </Text>
      </View>
    );
  }

  if (isPending) {
    return (
      <View style={styles.resultContainer}>
        <ActivityIndicator size="large" color={Colors.textPrimary} />
        <Text style={styles.generatingText}>Generating your image…</Text>
        <Text style={styles.generatingSubtext}>This usually takes 15–30 seconds.</Text>
      </View>
    );
  }

  const images = [
    job.resultFullBodyUrl && { label: 'Full Body', url: job.resultFullBodyUrl },
    job.resultMediumUrl && { label: 'Waist Up', url: job.resultMediumUrl },
  ].filter(Boolean) as Array<{ label: string; url: string }>;

  const allUrls = images.map((img) => img.url);

  return (
    <View style={styles.resultContainer}>
      <Text style={styles.resultTitle}>Your Results</Text>
      {/* A COMPLETE job can carry a notice in errorMessage: one perspective
          hit a transient error (credit refunded) or was content-moderated,
          and the job completed with the surviving view(s). */}
      {job.errorMessage ? (
        <View style={styles.partialNoticeBox}>
          <Text style={styles.partialNoticeText}>{job.errorMessage}</Text>
        </View>
      ) : null}
      {images.map((img, index) => (
        <TouchableOpacity
          key={img.url}
          style={styles.resultImageWrap}
          onPress={() => {
            setFullScreenImages(allUrls);
            setFullScreenIndex(index);
          }}
          activeOpacity={0.9}
        >
          <View style={styles.resultImageContainer}>
            <RetryableImage uri={img.url} style={styles.resultImage} resizeMode="contain" />
            {/* Guideline 4.0: visible AI-generated disclosure on every result surface. */}
            <AiGeneratedBadge variant="overlay" />
          </View>
          <Text style={styles.resultLabel}>{img.label}</Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity style={styles.resetBtn} onPress={onReset}>
        <Text style={styles.resetBtnText}>Create Another</Text>
      </TouchableOpacity>
      <FullScreenImageModal
        visible={fullScreenImages.length > 0}
        imageUrls={fullScreenImages}
        initialIndex={fullScreenIndex}
        aiGenerated
        onClose={() => setFullScreenImages([])}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surface },
  scroll: { flex: 1 },
  inner: { padding: Spacing.xl },
  subtitle: {
    fontSize: Typography.fontSizeMD,
    color: Colors.gray600,
    lineHeight: 22,
    marginBottom: Spacing.xl,
  },
  warningBox: {
    backgroundColor: 'rgba(251,191,36,0.12)',
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: Colors.warning,
  },
  warningText: { fontSize: Typography.fontSizeSM, color: Colors.gray800, lineHeight: 20 },
  partialNoticeBox: {
    backgroundColor: 'rgba(251,191,36,0.12)',
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: Colors.warning,
    alignSelf: 'stretch',
  },
  partialNoticeText: { fontSize: Typography.fontSizeSM, color: Colors.gray800, lineHeight: 20 },
  sectionLabel: {
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightSemiBold,
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  tipsLink: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray600,
    fontWeight: Typography.fontWeightSemiBold,
  },
  tipsCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.gray100,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  tipsCardBody: { flex: 1 },
  tipsCardTitle: {
    fontSize: Typography.fontSizeSM,
    fontWeight: Typography.fontWeightSemiBold,
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  tipsCardText: { fontSize: Typography.fontSizeSM, color: Colors.gray600, lineHeight: 20 },
  tipsCardLink: { color: Colors.textPrimary, fontWeight: Typography.fontWeightSemiBold },
  tipsCardClose: { fontSize: Typography.fontSizeSM, color: Colors.gray400, padding: 2 },
  planBadge: { fontWeight: Typography.fontWeightRegular, color: Colors.gray400 },
  photoRow: { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.md },
  photoSlot: {
    flex: 1,
    aspectRatio: 3 / 4,
    borderRadius: Radius.md,
    overflow: 'hidden',
    position: 'relative',
  },
  photoImage: { width: '100%', height: '100%' },
  closetTag: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: Radius.full,
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  closetTagText: {
    color: Colors.white,
    fontSize: Typography.fontSizeXS,
    fontWeight: Typography.fontWeightSemiBold,
  },
  closetCard: {
    backgroundColor: Colors.black,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.gold,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    position: 'relative',
    overflow: 'hidden',
  },
  closetBadge: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    backgroundColor: Colors.gold,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  closetBadgeText: {
    fontSize: Typography.fontSizeXS,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    letterSpacing: 0.5,
  },
  closetCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingRight: 52, // clear the NEW badge
  },
  closetEmojiCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closetEmoji: { fontSize: 28 },
  closetTextCol: { flex: 1 },
  closetTitle: {
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightBold,
    color: Colors.white,
    marginBottom: 4,
  },
  closetSubtitle: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray400,
    lineHeight: 18,
  },
  closetCtaPill: {
    marginTop: Spacing.md,
    backgroundColor: Colors.gold,
    borderRadius: Radius.full,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  closetCtaText: {
    color: Colors.textPrimary,
    fontWeight: Typography.fontWeightBold,
    fontSize: Typography.fontSizeMD,
  },
  removeBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBtnText: { color: Colors.white, fontSize: 11 },
  photoLabel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    color: Colors.white,
    fontSize: Typography.fontSizeXS,
    padding: 4,
    textAlign: 'center',
  },
  addPlaceholder: {
    flex: 1,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: Colors.gray200,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.gray100,
  },
  addPlus: { fontSize: 28, color: Colors.gray400 },
  addLabel: {
    fontSize: Typography.fontSizeMD,
    color: Colors.gray600,
    fontWeight: Typography.fontWeightMedium,
  },
  addSublabel: { fontSize: Typography.fontSizeXS, color: Colors.gray400 },
  helpText: {
    fontSize: Typography.fontSizeXS,
    color: Colors.gray400,
    lineHeight: 18,
    marginBottom: Spacing.lg,
  },
  divider: { height: 1, backgroundColor: Colors.gray200, marginVertical: Spacing.lg },
  captionBlock: {
    marginBottom: Spacing.md,
  },
  captionLabel: {
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightSemiBold,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  captionInput: {
    backgroundColor: Colors.gray100,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.fontSizeMD,
    color: Colors.textPrimary,
  },
  promptInput: {
    backgroundColor: Colors.gray100,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.fontSizeMD,
    color: Colors.textPrimary,
    minHeight: 88,
  },
  captionHint: {
    fontSize: Typography.fontSizeXS,
    color: Colors.gray600,
    marginTop: 4,
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.gray100,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.xl,
  },
  privacyInfo: { flex: 1 },
  privacyLabel: {
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightSemiBold,
    color: Colors.textPrimary,
  },
  privacyHint: {
    fontSize: Typography.fontSizeXS,
    color: Colors.gray600,
    marginTop: 2,
  },
  pill: { paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: Radius.full },
  pillActive: { backgroundColor: Colors.black },
  pillInactive: { backgroundColor: Colors.gray100 },
  pillText: { fontSize: Typography.fontSizeSM, fontWeight: Typography.fontWeightMedium },
  pillTextActive: { color: Colors.white },
  pillTextInactive: { color: Colors.gray600 },
  submitBtn: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  disabled: { opacity: 0.5 },
  submitBtnText: {
    color: Colors.textPrimary,
    fontWeight: Typography.fontWeightSemiBold,
    fontSize: Typography.fontSizeMD,
  },
  resultContainer: { alignItems: 'center', paddingVertical: Spacing.xl, gap: Spacing.lg },
  generatingText: {
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightSemiBold,
    color: Colors.textPrimary,
    marginTop: Spacing.md,
  },
  generatingSubtext: { fontSize: Typography.fontSizeSM, color: Colors.gray600 },
  queuedEmoji: { fontSize: 44 },
  queuedTitle: {
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightSemiBold,
    color: Colors.textPrimary,
  },
  queuedCountdown: {
    fontSize: Typography.fontSizeXXL,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  queuedSubtext: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray600,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: Spacing.lg,
  },
  resultTitle: {
    fontSize: Typography.fontSizeXL,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    alignSelf: 'flex-start',
  },
  resultImageWrap: { width: '100%', alignItems: 'center' },
  resultImageContainer: {
    width: '100%',
    position: 'relative',
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  resultImage: { width: '100%', aspectRatio: 3 / 4, borderRadius: Radius.lg },
  resultLabel: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray600,
    marginTop: Spacing.xs,
  },
  resultErrorTitle: {
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightBold,
    color: Colors.danger,
  },
  resultErrorText: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray600,
    textAlign: 'center',
    lineHeight: 20,
  },
  resetBtn: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  resetBtnText: {
    color: Colors.textPrimary,
    fontWeight: Typography.fontWeightSemiBold,
    fontSize: Typography.fontSizeMD,
  },
});
