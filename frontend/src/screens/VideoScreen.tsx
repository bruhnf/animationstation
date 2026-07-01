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
  Modal,
  FlatList,
  RefreshControl,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import api from '../config/api';
import { useUserStore } from '../store/useUserStore';
import { useConfigStore } from '../store/useConfigStore';
import { useVideoSourceStore } from '../store/useVideoSourceStore';
import { useVideoJobStore } from '../store/useVideoJobStore';
import { TryOnJob, ClosetItem } from '../types';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import CreditDisplay from '../components/CreditDisplay';
import HeaderMenu from '../components/HeaderMenu';
import AiGeneratedBadge from '../components/AiGeneratedBadge';
import RetryableImage from '../components/RetryableImage';
import AiConsentModal from '../components/AiConsentModal';
import { RootStackParams } from '../navigation';
import { processImageForUpload } from '../utils/imageUtils';

const POLL_INTERVAL_MS = 4000; // video gen is slow; poll a bit slower than image gen
const MAX_POLL_ERRORS = 4;
const MOTION_PROMPT_MAX = 300;

// Quick-start motion ideas. Tapping one fills the box (still fully editable).
const MOTION_IDEAS = [
  'Wave hello',
  'Smile and laugh',
  'Slow 360° spin',
  'Blow a kiss',
  'Walk toward the camera',
  'Strike a pose',
];

// The chosen source image to animate.
type Source =
  | { type: 'photo'; uri: string }
  | { type: 'tryon'; jobId: string; previewUrl: string };

// A pickable past creation for the "Use a Creation" picker — unified across both
// generation collections so a video can start from ANY image the user has made:
//   • tryon  → a transform-image job (sent to the server as sourceJobId)
//   • closet → a Design image (sent as a `photo` source; its remote URL is
//     fetched + processed at submit time)
type PickerItem =
  | { key: string; previewUrl: string; source: 'tryon'; job: TryOnJob }
  | { key: string; previewUrl: string; source: 'closet'; imageUrl: string };

export default function VideoScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const user = useUserStore((s) => s.user);
  const refreshUser = useUserStore((s) => s.refreshUser);
  // Live per-video cost (admin-tunable; server is authoritative at submit time).
  const videoCreditCost = useConfigStore((s) => s.videoCreditCost);
  const fetchConfig = useConfigStore((s) => s.fetchConfig);

  const [source, setSource] = useState<Source | null>(null);
  // Optional second image to transition toward. When set, the prompt describes
  // the transition between the two.
  const [source2, setSource2] = useState<Source | null>(null);
  // Target box for the async Try-On picker modal (1 = primary, 2 = transition).
  // Other sources pass the slot directly through their callbacks — see the
  // stale-closure note on chooseSource.
  const [pickerSlot, setPickerSlot] = useState<1 | 2>(1);
  const [motionPrompt, setMotionPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeJob, setActiveJob] = useState<TryOnJob | null>(null);
  const [aiConsentVisible, setAiConsentVisible] = useState(false);
  const [tryOnPickerVisible, setTryOnPickerVisible] = useState(false);
  const [pickerItems, setPickerItems] = useState<PickerItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  // True while we check the global store for an in-flight job on mount, so we
  // show a brief loader instead of flashing the empty form (and can't double-
  // submit in that window). Initialized from the store so the first render is
  // already the loader when a job is pending.
  const [rehydrating, setRehydrating] = useState<boolean>(
    () => !!useVideoJobStore.getState().activeJobId,
  );

  const scrollRef = useRef<ScrollView>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollErrorsRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  // Rehydrate an in-flight (or just-finished) video on mount. VideoScreen
  // unmounts when the user navigates away (e.g. via the Create FAB), so the
  // running generation would otherwise be unreachable and a blank form shown on
  // return. If the global store has an active job id, re-fetch it: resume the
  // progress view + polling when still running, or show the finished result. A
  // missing/errored job clears the stale id so the form falls through.
  useEffect(() => {
    const existingJobId = useVideoJobStore.getState().activeJobId;
    if (!existingJobId) {
      setRehydrating(false);
      return;
    }
    (async () => {
      try {
        const { data } = await api.get<TryOnJob>(`/tryon/${existingJobId}`);
        if (!isMountedRef.current) return;
        setActiveJob(data);
        if (data.status === 'PENDING' || data.status === 'PROCESSING') {
          pollJobStatus(existingJobId);
        }
      } catch {
        // Job not found / fetch failed → drop the stale id so the form shows.
        useVideoJobStore.getState().setActiveJobId(null);
      } finally {
        if (isMountedRef.current) setRehydrating(false);
      }
    })();
    // Mount-only: pollJobStatus is a stable hoisted function; resuming once on
    // mount is exactly the intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "MAKE VIDEO!" hand-off: if the user tapped it on a creation image, seed the
  // primary source box with the EXACT image they were viewing. We treat it as a
  // `photo` source (its remote URL is fetched + processed at submit time) so any
  // carousel slide can be animated, not just the primary result. Consume-once so it doesn't re-apply
  // on a later focus. Only seed when the form is idle — no in-progress job in
  // local state OR the global store (which we may not have rehydrated yet).
  useFocusEffect(
    useCallback(() => {
      if (activeJob || useVideoJobStore.getState().activeJobId) return;
      const pending = useVideoSourceStore.getState().consumePendingSource();
      if (pending) {
        setSource({ type: 'photo', uri: pending.imageUrl });
      }
    }, [activeJob]),
  );

  const previewOf = (s: Source | null) => (s?.type === 'photo' ? s.uri : s?.previewUrl);

  // Route a chosen source into a specific box. The slot is passed EXPLICITLY
  // (not via state): chooseSource shows the Alert synchronously in the same
  // render, so a `setActiveSlot(slot)` there wouldn't be visible to the Alert's
  // captured onPress closures yet — picking for box 2 would land in box 1.
  function applySource(slot: 1 | 2, src: Source) {
    if (slot === 2) setSource2(src);
    else setSource(src);
  }

  // Clear a box. Removing the primary while a 2nd image exists promotes the 2nd
  // to primary, so we never end up with only a transition target and no source.
  function removeSlot(slot: 1 | 2) {
    if (slot === 1) {
      if (source2) {
        setSource(source2);
        setSource2(null);
      } else {
        setSource(null);
      }
    } else {
      setSource2(null);
    }
  }

  function chooseSource(slot: 1 | 2) {
    const current = slot === 1 ? source : source2;
    // Every callback captures `slot` directly so the chosen image always lands
    // in the box the user tapped (no reliance on async state).
    const opts: { text: string; onPress?: () => void; style?: 'cancel' | 'destructive' }[] = [
      {
        text: current ? 'Replace from Library' : 'Choose from Library',
        onPress: () => pickFromLibrary(slot),
      },
      { text: 'Use a Creation', onPress: () => openTryOnPicker(slot) },
    ];
    // Let the user clear an already-populated box (either one).
    if (current) {
      opts.push({
        text: slot === 1 ? 'Remove image' : 'Remove 2nd image',
        style: 'destructive',
        onPress: () => removeSlot(slot),
      });
    }
    opts.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(
      slot === 1 ? 'Pick an image' : 'Transition to…',
      slot === 1
        ? 'The image you want to bring to life.'
        : 'An optional second image — the video will transition toward it.',
      opts,
    );
  }

  async function pickFromLibrary(slot: 1 | 2) {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) {
      applySource(slot, { type: 'photo', uri: result.assets[0].uri });
    }
  }

  async function openTryOnPicker(slot: 1 | 2) {
    try {
      // Merge BOTH generation collections so any image the user has made is a
      // valid video source: transform-image jobs (/tryon/history, excluding
      // videos) + Design images (/closet). Newest-first.
      const [jobsRes, closetRes] = await Promise.allSettled([
        api.get<{ jobs: TryOnJob[] }>('/tryon/history'),
        api.get<{ items: ClosetItem[] }>('/closet'),
      ]);
      const items: (PickerItem & { createdAt: string })[] = [];
      if (jobsRes.status === 'fulfilled') {
        for (const j of jobsRes.value.data.jobs || []) {
          if (j.kind === 'VIDEO') continue;
          const previewUrl = j.resultFullBodyUrl || j.resultMediumUrl;
          if (!previewUrl) continue;
          items.push({ key: `tryon:${j.id}`, previewUrl, source: 'tryon', job: j, createdAt: j.createdAt });
        }
      }
      if (closetRes.status === 'fulfilled') {
        for (const c of closetRes.value.data.items || []) {
          items.push({
            key: `closet:${c.id}`,
            previewUrl: c.imageUrl,
            source: 'closet',
            imageUrl: c.imageUrl,
            createdAt: c.createdAt,
          });
        }
      }
      items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
      if (items.length === 0) {
        Alert.alert('No creations yet', 'Generate an image first, then you can animate it.');
        return;
      }
      // The picker is a separate modal, so remember which box it targets.
      setPickerSlot(slot);
      setPickerItems(items.map(({ createdAt: _c, ...rest }) => rest));
      setTryOnPickerVisible(true);
    } catch {
      Alert.alert('Error', 'Could not load your creations.');
    }
  }

  function pickItem(item: PickerItem) {
    if (item.source === 'tryon') {
      applySource(pickerSlot, { type: 'tryon', jobId: item.job.id, previewUrl: item.previewUrl });
    } else {
      // Design images have no job id; send as a photo (URL fetched at submit).
      applySource(pickerSlot, { type: 'photo', uri: item.imageUrl });
    }
    setTryOnPickerVisible(false);
  }

  // Append one source's fields to the form data under the given field suffix
  // ('' for primary, '2' for the transition image).
  async function appendSource(formData: FormData, s: Source, suffix: '' | '2') {
    if (s.type === 'photo') {
      const processed = await processImageForUpload(s.uri, {
        maxWidth: 1536,
        maxHeight: 2048,
        compress: 0.85,
      });
      formData.append(`photo${suffix}`, processed as unknown as Blob);
    } else if (s.type === 'tryon') {
      formData.append(`sourceJobId${suffix}`, s.jobId);
    }
  }

  function handleSubmit() {
    if (!source) {
      Alert.alert('Pick an image', 'Choose a photo or a creation to animate.');
      return;
    }
    if (motionPrompt.trim().length < 2) {
      Alert.alert(
        'Describe the motion',
        'Tell the AI what the image should do — e.g. "wave and smile".',
      );
      return;
    }
    // Videos ALWAYS cost credits (no weekly allowance), so check up front rather
    // than making the user wait through image processing + upload only to be told
    // they're short. The server stays authoritative (SUBSCRIPTION_REQUIRED).
    if ((user?.credits ?? 0) < videoCreditCost) {
      Alert.alert(
        'Credits Required',
        `Creating a video costs ${videoCreditCost} credit${videoCreditCost === 1 ? '' : 's'}, and you don't have enough.`,
        [
          { text: 'Not Now', style: 'cancel' },
          { text: 'Get Credits', onPress: () => navigation.navigate('Purchase') },
        ],
      );
      return;
    }
    // Same explicit AI-processing consent gate as image generation.
    if (!user?.aiProcessingConsentAt) {
      setAiConsentVisible(true);
      return;
    }
    void performSubmit();
  }

  async function performSubmit() {
    if (!source) return;
    setSubmitting(true);
    try {
      const formData = new FormData();
      await appendSource(formData, source, '');
      if (source2) await appendSource(formData, source2, '2');
      formData.append('motionPrompt', motionPrompt.trim());
      formData.append('isPrivate', isPrivate.toString());
      const trimmedTitle = title.trim();
      if (trimmedTitle) formData.append('title', trimmedTitle);

      const { data } = await api.post<{
        jobId: string;
        status: string;
        creditCost?: number;
        scheduledStartAt?: string | null;
        queueDelayMs?: number;
      }>('/video', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      // Park the job id globally so it survives navigation away from this screen
      // (the user can return to watch progress, and can't start a second video
      // until this one finishes).
      useVideoJobStore.getState().setActiveJobId(data.jobId);
      setActiveJob({
        id: data.jobId,
        status: 'PENDING',
        scheduledStartAt: data.scheduledStartAt ?? null,
      } as TryOnJob);
      void refreshUser();

      // Soft-throttle queue notice (parity with TryOnScreen) — framed as a shared
      // queue, never a "limit". Subscribers get faster queues.
      if (data.queueDelayMs && data.queueDelayMs > 0) {
        const seconds = Math.max(1, Math.round(data.queueDelayMs / 1000));
        const upsell =
          user?.tier === 'PREMIUM' ? '' : ' Subscribers get faster queues and shorter waits.';
        Alert.alert(
          "You're in the queue",
          `A lot of members are creating right now, so your video is in the shared queue and will start in about ${seconds} second${seconds === 1 ? '' : 's'}.${upsell} You can close the app — we'll have it ready in your Profile.`,
        );
      }

      pollJobStatus(data.jobId);
    } catch (err: unknown) {
      const error = (err as { response?: { data?: { error?: string; message?: string } } })
        ?.response?.data;
      if (error?.error === 'AI_CONSENT_REQUIRED') {
        setAiConsentVisible(true);
      } else if (error?.error === 'SUBSCRIPTION_REQUIRED') {
        Alert.alert('Credits Required', error.message ?? 'You need credits to create a video.', [
          { text: 'Not Now', style: 'cancel' },
          { text: 'Get Credits', onPress: () => navigation.navigate('Purchase') },
        ]);
      } else if (error?.error === 'NO_BODY_PHOTOS') {
        Alert.alert(
          'Photo Missing',
          error.message ?? 'Upload that photo in your profile first.',
        );
      } else if (error?.error === 'INVALID_MOTION_PROMPT') {
        Alert.alert(
          'Describe the motion',
          error.message ?? 'Tell the AI what the image should do.',
        );
      } else {
        Alert.alert('Could not start video', error?.message ?? 'Please try again.');
      }
      setSubmitting(false);
    }
  }

  function pollJobStatus(jobId: string) {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    const tick = async () => {
      if (!isMountedRef.current) return;
      try {
        const { data } = await api.get<TryOnJob>(`/tryon/${jobId}`);
        pollErrorsRef.current = 0;
        if (!isMountedRef.current) return;
        setActiveJob(data);
        if (data.status === 'COMPLETE' || data.status === 'FAILED') {
          setSubmitting(false);
          void refreshUser();
          return;
        }
      } catch {
        pollErrorsRef.current += 1;
        if (pollErrorsRef.current >= MAX_POLL_ERRORS) {
          setSubmitting(false);
          Alert.alert(
            'Connection issue',
            'We lost track of your video. Check your Profile shortly.',
          );
          return;
        }
      }
      pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
    };
    pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
  }

  function reset() {
    // Cancel any in-flight poll so a queued tick can't fire after reset and
    // flash the old job back into the cleared form (matches TryOnScreen).
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollErrorsRef.current = 0;
    // Done with this job — clear the global handle so the form is reachable
    // again and a new video can be started.
    useVideoJobStore.getState().setActiveJobId(null);
    setSource(null);
    setSource2(null);
    setPickerSlot(1);
    setMotionPrompt('');
    setTitle('');
    setIsPrivate(false);
    setActiveJob(null);
    setSubmitting(false);
  }

  // Pull-to-refresh: re-pull the user (so a fresh credit balance — e.g. credits
  // just granted in the admin dashboard — shows without leaving the screen) and
  // the public config (live per-video cost).
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshUser(), fetchConfig()]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshUser, fetchConfig]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <HeaderMenu
        title="Video"
        showBack
        rightComponent={<CreditDisplay onPress={() => navigation.navigate('Purchase')} />}
      />

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.inner}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {rehydrating ? (
          <View style={styles.resultWrap}>
            <ActivityIndicator size="large" color={Colors.textPrimary} />
            <Text style={styles.resultMsg}>Checking your video…</Text>
          </View>
        ) : activeJob ? (
          <ResultView job={activeJob} onReset={reset} />
        ) : (
          <>
            <Text style={styles.sectionLabel}>1. Pick image(s) to animate</Text>
            <View style={styles.sourceRow}>
              <SourceBox
                preview={previewOf(source)}
                isPhoto={source?.type === 'photo'}
                label="Image to animate"
                onPress={() => chooseSource(1)}
              />
              <SourceBox
                preview={previewOf(source2)}
                isPhoto={source2?.type === 'photo'}
                label="2nd image (optional)"
                optional
                onPress={() => chooseSource(2)}
              />
            </View>
            <Text style={styles.helpHint}>
              Add a second image to create a transition between the two — then describe the
              transition below.
            </Text>

            <Text style={styles.sectionLabel}>
              2. {source2 ? 'Describe the transition' : 'Describe the motion'}
            </Text>
            <TextInput
              style={styles.promptInput}
              value={motionPrompt}
              onChangeText={setMotionPrompt}
              placeholder={
                source2
                  ? 'e.g. "smoothly morph from the first image into the second"'
                  : 'e.g. "wave and smile", "do a slow spin", "morph into a cat"'
              }
              placeholderTextColor={Colors.gray400}
              maxLength={MOTION_PROMPT_MAX}
              multiline
            />
            <View style={styles.chipRow}>
              {MOTION_IDEAS.map((idea) => (
                <TouchableOpacity
                  key={idea}
                  style={styles.chip}
                  onPress={() => setMotionPrompt(idea)}
                >
                  <Text style={styles.chipText}>{idea}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionLabel}>3. Caption (optional)</Text>
            <TextInput
              style={styles.captionInput}
              value={title}
              onChangeText={setTitle}
              placeholder="Name this video"
              placeholderTextColor={Colors.gray400}
              maxLength={140}
              returnKeyType="done"
              onFocus={() =>
                setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150)
              }
            />

            <View style={styles.privacyRow}>
              <View style={{ flex: 1 }}>
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
                <Text style={styles.submitBtnText}>
                  Create Video · {videoCreditCost} {videoCreditCost === 1 ? 'credit' : 'credits'}
                </Text>
              )}
            </TouchableOpacity>
            <Text style={styles.costHint}>Videos take a minute or two to generate.</Text>
          </>
        )}
      </ScrollView>

      {/* Creation source picker */}
      <Modal
        visible={tryOnPickerVisible}
        animationType="slide"
        onRequestClose={() => setTryOnPickerVisible(false)}
      >
        <View style={[styles.container, { paddingTop: insets.top + Spacing.sm }]}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>Pick a creation</Text>
            <TouchableOpacity onPress={() => setTryOnPickerVisible(false)} hitSlop={10}>
              <Text style={styles.pickerClose}>Close</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={pickerItems}
            keyExtractor={(i) => i.key}
            numColumns={3}
            contentContainerStyle={{ padding: Spacing.sm }}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.pickerCell} onPress={() => pickItem(item)}>
                <RetryableImage uri={item.previewUrl} style={styles.pickerImg} resizeMode="cover" />
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>

      <AiConsentModal
        mode="video"
        visible={aiConsentVisible}
        onAgree={() => {
          setAiConsentVisible(false);
          void performSubmit();
        }}
        onCancel={() => setAiConsentVisible(false)}
      />
    </View>
  );
}

// One of the two side-by-side source picker boxes.
function SourceBox({
  preview,
  isPhoto,
  label,
  optional,
  onPress,
}: {
  preview?: string;
  isPhoto?: boolean;
  label: string;
  optional?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.sourceBox} onPress={onPress} activeOpacity={0.85}>
      {preview ? (
        <>
          {isPhoto ? (
            <Image source={{ uri: preview }} style={styles.sourceImage} resizeMode="cover" />
          ) : (
            <RetryableImage uri={preview} style={styles.sourceImage} resizeMode="cover" />
          )}
          <Text style={styles.sourceBoxCaption} numberOfLines={1}>
            {label}
          </Text>
        </>
      ) : (
        <View style={styles.sourcePlaceholder}>
          <Text style={styles.addPlus}>+</Text>
          <Text style={styles.addLabel}>{label}</Text>
          {optional ? <Text style={styles.optionalTag}>optional</Text> : null}
        </View>
      )}
    </TouchableOpacity>
  );
}

function ResultView({ job, onReset }: { job: TryOnJob; onReset: () => void }) {
  const failed = job.status === 'FAILED';
  const complete = job.status === 'COMPLETE' && !!job.videoUrl;
  const pending = job.status === 'PENDING' || job.status === 'PROCESSING';
  // Drives the "subscribers get faster queues" upsell — hidden for PREMIUM.
  const tier = useUserStore((s) => s.user?.tier);

  // Soft-throttle countdown (parity with TryOnScreen): tick while a future
  // scheduledStartAt exists, then fall through to the normal "Generating…" view.
  const startAt = job.scheduledStartAt ? new Date(job.scheduledStartAt).getTime() : 0;
  const [now, setNow] = useState<number>(() => Date.now());
  const remainingMs = Math.max(0, startAt - now);
  const isQueued = pending && startAt > 0 && remainingMs > 0;
  useEffect(() => {
    if (!isQueued) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isQueued]);
  // useVideoPlayer requires a source; pass null until the URL exists.
  const player = useVideoPlayer(complete ? job.videoUrl! : null, (p) => {
    p.loop = true;
    if (complete) p.play();
  });

  // The Video tab stays MOUNTED when the user switches tabs, so the player would
  // keep playing in the background (and stack with feed/profile players). Pause
  // when the screen loses focus; resume when it's focused again.
  useFocusEffect(
    useCallback(() => {
      if (complete) player.play();
      return () => {
        // `player` can already be released if the screen unmounted — guard it.
        try {
          player.pause();
        } catch {
          // player released; nothing to pause
        }
      };
    }, [player, complete]),
  );

  if (failed) {
    return (
      <View style={styles.resultWrap}>
        <Text style={styles.resultTitle}>Couldn't create your video</Text>
        <Text style={styles.resultMsg}>
          {job.errorMessage || 'Something went wrong. Your credits were refunded if charged.'}
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
      <View style={styles.resultWrap}>
        <Text style={styles.queuedEmoji}>⏳</Text>
        <Text style={styles.resultTitle}>You're in the queue</Text>
        <Text style={styles.queuedCountdown}>{`Starts in ${mm}:${pad(ss)}`}</Text>
        <Text style={styles.resultMsg}>
          A lot of members are creating right now — your video will start automatically.
          {tier === 'PREMIUM' ? '' : ' Subscribers get faster queues and shorter waits.'} You can
          close the app; we'll have it ready in your Profile.
        </Text>
      </View>
    );
  }

  if (!complete) {
    return (
      <View style={styles.resultWrap}>
        <ActivityIndicator size="large" color={Colors.textPrimary} />
        <Text style={styles.resultMsg}>Generating your video… this can take a minute or two.</Text>
        <Text style={styles.resultMsg}>May be slower at peak usage times.</Text>
      </View>
    );
  }

  return (
    <View style={styles.resultWrap}>
      <View style={styles.videoWrap}>
        <VideoView player={player} style={styles.video} contentFit="contain" nativeControls />
        <AiGeneratedBadge placement="center" />
      </View>
      {job.title ? <Text style={styles.resultCaption}>{job.title}</Text> : null}
      <TouchableOpacity style={styles.submitBtn} onPress={onReset}>
        <Text style={styles.submitBtnText}>Make Another</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surface },
  scroll: { flex: 1 },
  inner: { padding: Spacing.md, paddingBottom: Spacing.xxl },
  sectionLabel: {
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightSemiBold,
    color: Colors.textPrimary,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  sourceRow: { flexDirection: 'row', gap: Spacing.sm },
  sourceBox: {
    flex: 1,
    aspectRatio: 3 / 4,
    maxHeight: 320,
    borderRadius: Radius.lg,
    backgroundColor: Colors.gray100,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceImage: { width: '100%', height: '100%' },
  sourceBoxCaption: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    color: Colors.white,
    fontSize: Typography.fontSizeXS,
    fontWeight: Typography.fontWeightSemiBold,
    textAlign: 'center',
    paddingVertical: 3,
  },
  sourcePlaceholder: { alignItems: 'center', padding: Spacing.md },
  addPlus: { fontSize: 40, color: Colors.gray400, fontWeight: '300' },
  addLabel: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray600,
    marginTop: Spacing.xs,
    textAlign: 'center',
  },
  optionalTag: { fontSize: Typography.fontSizeXS, color: Colors.gray400, marginTop: 2 },
  helpHint: { fontSize: Typography.fontSizeXS, color: Colors.gray600, marginTop: Spacing.sm },
  promptInput: {
    backgroundColor: Colors.gray100,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.fontSizeMD,
    color: Colors.textPrimary,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.sm },
  chip: {
    backgroundColor: Colors.gray100,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  chipText: { fontSize: Typography.fontSizeSM, color: Colors.textPrimary },
  captionInput: {
    backgroundColor: Colors.gray100,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.fontSizeMD,
    color: Colors.textPrimary,
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.gray100,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginTop: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  privacyLabel: {
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightSemiBold,
    color: Colors.textPrimary,
  },
  privacyHint: { fontSize: Typography.fontSizeXS, color: Colors.gray600, marginTop: 2 },
  submitBtn: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  submitBtnText: {
    color: Colors.textPrimary,
    fontWeight: Typography.fontWeightBold,
    fontSize: Typography.fontSizeMD,
  },
  disabled: { opacity: 0.5 },
  costHint: {
    fontSize: Typography.fontSizeXS,
    color: Colors.gray600,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  resultWrap: { alignItems: 'center', paddingTop: Spacing.lg, gap: Spacing.md },
  resultTitle: {
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  resultMsg: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray600,
    textAlign: 'center',
    paddingHorizontal: Spacing.lg,
  },
  resultCaption: { fontSize: Typography.fontSizeMD, color: Colors.textPrimary, textAlign: 'center' },
  queuedEmoji: { fontSize: 40 },
  queuedCountdown: {
    fontSize: Typography.fontSizeXL,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  videoWrap: {
    width: '100%',
    aspectRatio: 3 / 4,
    maxHeight: 480,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.black,
    position: 'relative',
  },
  video: { width: '100%', height: '100%' },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  pickerTitle: {
    fontSize: Typography.fontSizeXL,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  pickerClose: {
    fontSize: Typography.fontSizeMD,
    color: Colors.gray600,
    fontWeight: Typography.fontWeightSemiBold,
  },
  pickerCell: { flex: 1 / 3, aspectRatio: 3 / 4, padding: 2 },
  pickerImg: { width: '100%', height: '100%', borderRadius: Radius.sm },
});
