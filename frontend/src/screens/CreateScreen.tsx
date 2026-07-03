import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import api from '../config/api';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { useUserStore } from '../store/useUserStore';
import { useConfigStore } from '../store/useConfigStore';
import { requireRealUser } from '../utils/guestGate';
import { processImageForUpload } from '../utils/imageUtils';
import AiConsentModal from '../components/AiConsentModal';
import AiGeneratedBadge from '../components/AiGeneratedBadge';
import VideoPlayerModal from '../components/VideoPlayerModal';
import RetryableImage from '../components/RetryableImage';
import { downloadImageToGallery } from '../utils/imageUtils';
import { useVideoSourceStore } from '../store/useVideoSourceStore';
import { Creation } from '../types';

// ── Unified Create screen (Grok-Imagine-style) ────────────────────────────────
// One prompt box + a compact control row replaces the old hub of feature
// buttons. Mode toggles between Image (text-to-image, or transform when photos
// are attached) and Video (animate an attached photo with a motion prompt).
// Aspect ratio and (for video) duration are chip menus, mirroring Grok's UI.
// Results land in the preview area here and — like every Creation — on the
// Home feed and the user's Profile grid automatically.

type Mode = 'image' | 'video';

// Inputs captured at submit time so "Regenerate" can re-run the exact same
// request even after the composer is cleared on completion.
type SubmitInput = {
  mode: Mode;
  prompt: string;
  attached: string[];
  aspect: string;
  durationSec: number;
};

// Max characters allowed in the prompt box. Kept in lockstep with the backend
// (TRANSFORM_PROMPT_MAX_LENGTH / MOTION_PROMPT_MAX) and the DB VARCHAR width.
const PROMPT_MAX = 1000;

const ASPECTS: Array<{ value: string; label: string; hint: string }> = [
  { value: '2:3', label: '2:3', hint: 'Tall' },
  { value: '3:2', label: '3:2', hint: 'Wide' },
  { value: '1:1', label: '1:1', hint: 'Square' },
  { value: '9:16', label: '9:16', hint: 'Vertical' },
  { value: '16:9', label: '16:9', hint: 'Widescreen' },
];

const DURATIONS = [4, 8, 12, 15];

const MAX_IMAGES: Record<Mode, number> = { image: 2, video: 1 };

export default function CreateScreen() {
  const navigation = useNavigation<any>();
  const { user, refreshUser } = useUserStore();
  const videoCreditCost = useConfigStore((s) => s.videoCreditCost ?? 2);

  const [mode, setMode] = useState<Mode>('image');
  const [prompt, setPrompt] = useState('');
  const [attached, setAttached] = useState<string[]>([]);
  const [aspect, setAspect] = useState<string>('2:3');
  const [durationSec, setDurationSec] = useState<number>(8);
  const [menu, setMenu] = useState<'aspect' | 'duration' | null>(null);
  const [consentVisible, setConsentVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeJob, setActiveJob] = useState<Creation | null>(null);
  const [queueSecondsLeft, setQueueSecondsLeft] = useState<number | null>(null);
  const [videoPlayerUri, setVideoPlayerUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSubmitRef = useRef<SubmitInput | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Reset the preview + composer whenever the signed-in user changes — including
  // logout → guest → a DIFFERENT login on the same device. Create is a
  // persistent tab, so without this a new user would still see the previous
  // user's generated image/video in the preview window.
  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setActiveJob(null);
    setPrompt('');
    setAttached([]);
    setVideoPlayerUri(null);
    lastSubmitRef.current = null;
  }, [user?.id]);

  // Live "starts in M:SS" countdown while the soft queue delays the job.
  useEffect(() => {
    if (!activeJob?.scheduledStartAt) {
      setQueueSecondsLeft(null);
      return;
    }
    const target = new Date(activeJob.scheduledStartAt).getTime();
    const tick = () => {
      const left = Math.max(0, Math.round((target - Date.now()) / 1000));
      setQueueSecondsLeft(left > 0 ? left : null);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [activeJob?.scheduledStartAt]);

  const busy = submitting || (activeJob !== null && activeJob.status !== 'COMPLETE');
  const canSubmit =
    !busy && (prompt.trim().length > 0 || (mode === 'image' && attached.length > 0));

  function switchMode(next: Mode) {
    if (next === mode) return;
    // Video mode is real-account only (backend blockGuests) and animates ONE image.
    if (next === 'video' && !requireRealUser('Create a free account to make videos.')) return;
    setMode(next);
    setAttached((prev) => prev.slice(0, MAX_IMAGES[next]));
  }

  async function pickImage() {
    if (attached.length >= MAX_IMAGES[mode]) {
      Alert.alert(
        'Limit reached',
        mode === 'video'
          ? 'Video animates one image. Remove the current one to pick another.'
          : 'You can attach up to two reference images.',
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      setAttached((prev) => [...prev, result.assets[0].uri]);
    }
  }

  function describeError(err: unknown) {
    const error = (err as { response?: { data?: { error?: string; message?: string } } })?.response
      ?.data;
    switch (error?.error) {
      case 'AI_CONSENT_REQUIRED':
        setConsentVisible(true);
        return;
      case 'SUBSCRIPTION_REQUIRED':
        Alert.alert('Credits Required', 'You need credits or a subscription to create.', [
          { text: 'Not Now', style: 'cancel' },
          { text: 'Get Credits', onPress: () => navigation.navigate('Purchase') },
        ]);
        return;
      case 'WEEKLY_LIMIT_REACHED':
        Alert.alert('Limit Reached', error.message ?? 'Get more credits to continue.', [
          { text: 'OK', style: 'cancel' },
          { text: 'Get Credits', onPress: () => navigation.navigate('Purchase') },
        ]);
        return;
      case 'CREATION_LIMIT_REACHED':
        Alert.alert(
          'Storage Full',
          error.message ?? 'Delete some creations from your Profile to continue.',
        );
        return;
      case 'PROMPT_REJECTED':
      case 'INVALID_MOTION_PROMPT':
      case 'PROMPT_REQUIRED':
        Alert.alert('Prompt Issue', error.message ?? 'Please adjust your prompt and try again.');
        return;
      case 'INPUT_MODERATION_BLOCKED':
        Alert.alert(
          'Image not allowed',
          error.message ?? "This image can't be used. Please choose a different one.",
        );
        return;
      default:
        Alert.alert('Error', error?.message ?? 'Something went wrong. Please try again.');
    }
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    if (mode === 'video') {
      if (!requireRealUser('Create a free account to make videos.')) return;
      if (attached.length === 0) {
        Alert.alert('Add an image', 'Video animates a photo — attach one to bring it to life.');
        return;
      }
    }
    if (!user?.aiProcessingConsentAt) {
      setConsentVisible(true);
      return;
    }
    await performSubmit();
  }

  async function performSubmit(input?: SubmitInput) {
    // Regenerate passes the captured inputs; a normal submit uses live state.
    const p: SubmitInput = input ?? { mode, prompt, attached, aspect, durationSec };
    lastSubmitRef.current = p;
    setSubmitting(true);
    setActiveJob(null);
    try {
      const formData = new FormData();
      const fileField = p.mode === 'video' ? 'photo' : 'photos';
      for (const uri of p.attached) {
        const processed = await processImageForUpload(uri, {
          maxWidth: 1536,
          maxHeight: 2048,
          compress: 0.85,
        });
        formData.append(fileField, processed as unknown as Blob);
      }
      formData.append('aspectRatio', p.aspect);
      if (p.mode === 'video') {
        formData.append('motionPrompt', p.prompt.trim());
        formData.append('durationSec', String(p.durationSec));
      } else {
        formData.append('prompt', p.prompt.trim());
      }

      const endpoint = p.mode === 'video' ? '/video' : '/transform';
      const { data } = await api.post<{
        jobId: string;
        status: string;
        scheduledStartAt?: string | null;
        queueDelayMs?: number;
      }>(endpoint, formData, { headers: { 'Content-Type': 'multipart/form-data' } });

      setActiveJob({
        id: data.jobId,
        status: 'PENDING',
        kind: p.mode === 'video' ? 'VIDEO' : 'IMAGE',
        scheduledStartAt: data.scheduledStartAt ?? null,
      } as Creation);
      void refreshUser();

      if (data.queueDelayMs && data.queueDelayMs > 0) {
        const seconds = Math.max(1, Math.round(data.queueDelayMs / 1000));
        Alert.alert(
          "You're in the queue",
          `A lot of members are creating right now — yours starts in about ${seconds} second${seconds === 1 ? '' : 's'}.`,
        );
      }
      startPolling(data.jobId);
    } catch (err) {
      describeError(err);
    } finally {
      setSubmitting(false);
    }
  }

  function startPolling(jobId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get<Creation>(`/creations/${jobId}`);
        setActiveJob(data);
        if (data.status === 'COMPLETE' || data.status === 'FAILED') {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          if (data.status === 'COMPLETE') {
            // Clear the composer for the next idea; the result stays on screen
            // and is already on the Home feed + Profile grid.
            setPrompt('');
            setAttached([]);
          } else {
            Alert.alert(
              'Generation failed',
              data.errorMessage ?? 'Something went wrong. Any credit spent was refunded.',
            );
          }
        }
      } catch {
        // Transient poll failure — keep polling; the job continues server-side.
      }
    }, 3000);
  }

  // ── Actions on a finished result ────────────────────────────────────────────
  async function handleSaveToPhotos() {
    const job = activeJob;
    if (!job || saving) return;
    const url = job.kind === 'VIDEO' ? job.videoUrl : (job.resultImageUrl ?? job.resultImage2Url);
    if (!url) return;
    setSaving(true);
    try {
      const ext = job.kind === 'VIDEO' ? 'mp4' : 'jpg';
      const res = await downloadImageToGallery(url, `AnimationStation_${Date.now()}.${ext}`);
      Alert.alert(res.success ? 'Saved' : 'Could not save', res.message);
    } catch {
      Alert.alert('Could not save', 'Something went wrong saving to your photos.');
    } finally {
      setSaving(false);
    }
  }

  // Hand the finished image off to the video generator (VideoScreen reads the
  // pending source on focus). Images only — you can't animate a video.
  function handleMakeVideo() {
    const url = activeJob?.resultImageUrl ?? activeJob?.resultImage2Url;
    if (!url) return;
    if (!requireRealUser('Create a free account to make videos.')) return;
    useVideoSourceStore.getState().setPendingSource({ imageUrl: url });
    navigation.navigate('Video');
  }

  function handleRegenerate() {
    if (busy || !lastSubmitRef.current) return;
    void performSubmit(lastSubmitRef.current);
  }

  function handleClear() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setActiveJob(null);
    setVideoPlayerUri(null);
  }

  const aspectMeta = ASPECTS.find((a) => a.value === aspect) ?? ASPECTS[0];

  function renderPreview() {
    if (activeJob?.status === 'COMPLETE') {
      const isVideo = activeJob.kind === 'VIDEO';
      const imageUrl = activeJob.resultImageUrl ?? activeJob.resultImage2Url;

      let media: React.ReactNode = null;
      if (isVideo && activeJob.videoUrl) {
        media = (
          <TouchableOpacity
            style={styles.previewMedia}
            onPress={() => setVideoPlayerUri(activeJob.videoUrl!)}
            activeOpacity={0.85}
          >
            {activeJob.sourceImageUrl ? (
              <RetryableImage uri={activeJob.sourceImageUrl} style={styles.previewImage} />
            ) : (
              <View style={[styles.previewImage, styles.previewFallback]} />
            )}
            <View style={styles.playOverlay}>
              <Ionicons name="play-circle" size={72} color={Colors.white} />
            </View>
            <AiGeneratedBadge placement="center" />
          </TouchableOpacity>
        );
      } else if (imageUrl) {
        media = (
          <View style={styles.previewMedia}>
            <RetryableImage uri={imageUrl} style={styles.previewImage} />
            <AiGeneratedBadge />
          </View>
        );
      }

      if (media) {
        return (
          <View style={styles.resultWrap}>
            {media}
            <View style={styles.actionsRow}>
              <ActionButton
                icon="download-outline"
                label={saving ? 'Saving…' : 'Save'}
                onPress={handleSaveToPhotos}
                disabled={saving}
              />
              {!isVideo && (
                <ActionButton
                  icon="videocam-outline"
                  label="Make Video"
                  onPress={handleMakeVideo}
                />
              )}
              <ActionButton
                icon="refresh-outline"
                label="Regenerate"
                onPress={handleRegenerate}
                disabled={busy || !lastSubmitRef.current}
              />
              <ActionButton icon="trash-outline" label="Clear" onPress={handleClear} />
            </View>
          </View>
        );
      }
    }
    if (busy) {
      return (
        <View style={styles.previewIdle}>
          <ActivityIndicator size="large" color={Colors.accentCyan} />
          <Text style={styles.previewStatus}>
            {queueSecondsLeft !== null
              ? `In the queue — starts in ${Math.floor(queueSecondsLeft / 60)}:${String(queueSecondsLeft % 60).padStart(2, '0')}`
              : mode === 'video'
                ? 'Animating… videos can take a few minutes'
                : 'Creating…'}
          </Text>
          <Text style={styles.previewHint}>You can leave — results land in your Profile.</Text>
        </View>
      );
    }
    return (
      <View style={styles.previewIdle}>
        <Text style={styles.brandline}>Imagine. Create. Transcend.</Text>
        <Text style={styles.previewHint}>
          Describe anything — or attach a photo to transform or animate it.
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.previewWrap} keyboardShouldPersistTaps="handled">
          {renderPreview()}
        </ScrollView>

        <View style={styles.composer}>
          {attached.length > 0 && (
            <View style={styles.thumbRow}>
              {attached.map((uri, i) => (
                <View key={uri} style={styles.thumbWrap}>
                  <Image source={{ uri }} style={styles.thumb} />
                  <TouchableOpacity
                    style={styles.thumbRemove}
                    onPress={() => setAttached((prev) => prev.filter((_, j) => j !== i))}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close" size={12} color={Colors.white} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          <View style={styles.inputRow}>
            <TouchableOpacity style={styles.attachBtn} onPress={pickImage} disabled={busy}>
              <Ionicons name="add" size={24} color={Colors.textSecondary} />
            </TouchableOpacity>
            <TextInput
              style={styles.input}
              placeholder={mode === 'video' ? 'Describe the motion…' : 'Type to imagine…'}
              placeholderTextColor={Colors.textTertiary}
              value={prompt}
              onChangeText={setPrompt}
              multiline
              maxLength={PROMPT_MAX}
              editable={!busy}
            />
          </View>

          <View style={styles.controlsRow}>
            <View style={styles.modeToggle}>
              {(['image', 'video'] as Mode[]).map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.modeBtn, mode === m && styles.modeBtnActive]}
                  onPress={() => switchMode(m)}
                  disabled={busy}
                >
                  <Ionicons
                    name={m === 'image' ? 'image' : 'videocam'}
                    size={14}
                    color={mode === m ? Colors.background : Colors.textSecondary}
                  />
                  <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>
                    {m === 'image' ? 'Image' : 'Video'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity style={styles.chip} onPress={() => setMenu('aspect')} disabled={busy}>
              <Ionicons name="tablet-landscape-outline" size={13} color={Colors.textSecondary} />
              <Text style={styles.chipText}>{aspectMeta.label}</Text>
            </TouchableOpacity>

            {mode === 'video' && (
              <TouchableOpacity
                style={styles.chip}
                onPress={() => setMenu('duration')}
                disabled={busy}
              >
                <Ionicons name="time-outline" size={13} color={Colors.textSecondary} />
                <Text style={styles.chipText}>{durationSec}s</Text>
              </TouchableOpacity>
            )}

            <View style={styles.flex} />

            <TouchableOpacity
              style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={!canSubmit}
            >
              {busy ? (
                <ActivityIndicator size="small" color={Colors.background} />
              ) : (
                <Ionicons name="arrow-up" size={22} color={Colors.background} />
              )}
            </TouchableOpacity>
          </View>

          {mode === 'video' && (
            <Text style={styles.costHint}>
              Video · {videoCreditCost} credit{videoCreditCost === 1 ? '' : 's'}
            </Text>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* Aspect / duration chip menus (Grok-style popup list) */}
      <Modal visible={menu !== null} transparent animationType="fade">
        <TouchableOpacity
          style={styles.menuBackdrop}
          activeOpacity={1}
          onPress={() => setMenu(null)}
        >
          <View style={styles.menuCard}>
            {menu === 'aspect' &&
              ASPECTS.map((a) => (
                <TouchableOpacity
                  key={a.value}
                  style={styles.menuItem}
                  onPress={() => {
                    setAspect(a.value);
                    setMenu(null);
                  }}
                >
                  <Text style={[styles.menuItemLabel, aspect === a.value && styles.menuItemActive]}>
                    {a.label}
                  </Text>
                  <Text style={styles.menuItemHint}>{a.hint}</Text>
                </TouchableOpacity>
              ))}
            {menu === 'duration' &&
              DURATIONS.map((d) => (
                <TouchableOpacity
                  key={d}
                  style={styles.menuItem}
                  onPress={() => {
                    setDurationSec(d);
                    setMenu(null);
                  }}
                >
                  <Text style={[styles.menuItemLabel, durationSec === d && styles.menuItemActive]}>
                    {d}s
                  </Text>
                  <Text style={styles.menuItemHint}>{d === 8 ? 'Default' : ''}</Text>
                </TouchableOpacity>
              ))}
          </View>
        </TouchableOpacity>
      </Modal>

      <AiConsentModal
        visible={consentVisible}
        mode={mode === 'video' ? 'video' : 'transform'}
        onAgree={() => {
          setConsentVisible(false);
          void performSubmit();
        }}
        onCancel={() => setConsentVisible(false)}
      />

      <VideoPlayerModal
        visible={videoPlayerUri !== null}
        uri={videoPlayerUri}
        motionPrompt={null}
        onClose={() => setVideoPlayerUri(null)}
      />
    </SafeAreaView>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.actionButton, disabled && styles.actionDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={22} color={Colors.textPrimary} />
      <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  previewWrap: { flexGrow: 1, justifyContent: 'center', padding: Spacing.lg },
  previewIdle: { alignItems: 'center', gap: Spacing.sm },
  brandline: {
    fontSize: Typography.fontSizeXXL,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  previewStatus: {
    fontSize: Typography.fontSizeMD,
    color: Colors.textPrimary,
    marginTop: Spacing.sm,
  },
  previewHint: {
    fontSize: Typography.fontSizeSM,
    color: Colors.textTertiary,
    textAlign: 'center',
    maxWidth: 280,
  },
  previewMedia: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
    aspectRatio: 3 / 4,
    maxHeight: 480,
    alignSelf: 'center',
    width: '92%',
    backgroundColor: Colors.backgroundElevated,
  },
  previewImage: { width: '100%', height: '100%' },
  previewFallback: { backgroundColor: Colors.backgroundElevated },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultWrap: { width: '100%', alignItems: 'center', gap: Spacing.md },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.lg,
  },
  actionButton: { alignItems: 'center', gap: 4, minWidth: 60 },
  actionDisabled: { opacity: 0.4 },
  actionLabel: {
    fontSize: Typography.fontSizeXS,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  composer: {
    backgroundColor: Colors.backgroundElevated,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  thumbRow: { flexDirection: 'row', gap: Spacing.sm },
  thumbWrap: { position: 'relative' },
  thumb: { width: 52, height: 52, borderRadius: Radius.md },
  thumbRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: Colors.backgroundElevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 2,
  },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm },
  attachBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    fontSize: Typography.fontSizeMD,
    color: Colors.textPrimary,
    maxHeight: 110,
    paddingVertical: 8,
  },
  controlsRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  modeToggle: {
    flexDirection: 'row',
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  modeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  modeBtnActive: { backgroundColor: Colors.accentCyan },
  modeText: { fontSize: Typography.fontSizeSM, color: Colors.textSecondary, fontWeight: '600' },
  modeTextActive: { color: Colors.background },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipText: { fontSize: Typography.fontSizeSM, color: Colors.textSecondary, fontWeight: '600' },
  submitBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.accentCyan,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnDisabled: { opacity: 0.4 },
  costHint: { fontSize: Typography.fontSizeSM, color: Colors.textTertiary, textAlign: 'right' },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
    padding: Spacing.lg,
    paddingBottom: 140,
  },
  menuCard: {
    backgroundColor: Colors.backgroundElevated,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: Spacing.xs,
    alignSelf: 'flex-start',
    minWidth: 200,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    gap: Spacing.lg,
  },
  menuItemLabel: { fontSize: Typography.fontSizeMD, color: Colors.textPrimary, fontWeight: '600' },
  menuItemActive: { color: Colors.accentCyan },
  menuItemHint: { fontSize: Typography.fontSizeSM, color: Colors.textTertiary },
});
