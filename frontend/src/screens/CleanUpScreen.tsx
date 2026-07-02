import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../config/api';
import { useUserStore } from '../store/useUserStore';
import { useVideoSourceStore } from '../store/useVideoSourceStore';
import { processImageForUpload } from '../utils/imageUtils';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { RootStackParams } from '../navigation';
import { ClosetItem } from '../types';
import AppButton from '../components/ui/AppButton';
import AiGeneratedBadge from '../components/AiGeneratedBadge';
import RetryableImage from '../components/RetryableImage';
import CreditDisplay from '../components/CreditDisplay';

const PROMPT_MAX = 200;

/**
 * Transform an Image — a deliberate, confirm-before-generate workflow:
 *   pick an image → see it in a preview → add a transform instruction →
 *   press Generate. Nothing is sent until the user confirms, so a wrong pick is
 *   easy to undo. The prompt is sanitized + denylisted server-side.
 */
export default function CleanUpScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const insets = useSafeAreaInsets();
  const refreshUser = useUserStore((s) => s.refreshUser);
  const credits = useUserStore((s) => s.user?.credits ?? 0);
  // Hand-off channel to the Video screen (it consumes this on focus).
  const setPendingSource = useVideoSourceStore((s) => s.setPendingSource);

  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ClosetItem | null>(null);
  // The processed payload ready for multipart upload (set when a photo is picked).
  const processedRef = useRef<unknown | null>(null);
  const isMountedRef = useRef(true);
  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  async function pickFrom(source: 'camera' | 'library') {
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Camera Access Needed', 'Enable camera access in Settings to take a photo.', [
            { text: 'Choose from Library', onPress: () => pickFrom('library') },
            { text: 'Cancel', style: 'cancel' },
          ]);
          return;
        }
      }
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ quality: 0.9 })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              quality: 0.9,
            });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const processed = await processImageForUpload(asset.uri, {
        maxWidth: 1536,
        maxHeight: 2048,
        compress: 0.9,
      });
      if (!isMountedRef.current) return;
      processedRef.current = processed;
      setPreviewUri(asset.uri);
      setResult(null);
    } catch {
      Alert.alert('Could not load that photo', 'Please try a different one.');
    }
  }

  function choosePhoto() {
    Alert.alert('Transform an Image', 'Pick the image you want to transform.', [
      { text: 'Take Photo', onPress: () => pickFrom('camera') },
      { text: 'Choose from Library', onPress: () => pickFrom('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function generate() {
    if (!processedRef.current || submitting) return;
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('photo', processedRef.current as unknown as Blob);
      const trimmed = prompt.trim();
      if (trimmed) formData.append('prompt', trimmed);
      const { data } = await api.post<ClosetItem>('/closet/cleanup', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 90000,
      });
      if (!isMountedRef.current) return;
      setResult(data);
      void refreshUser();
    } catch (err: unknown) {
      const error = (err as { response?: { data?: { error?: string; message?: string } } })
        ?.response?.data;
      if (error?.error === 'INSUFFICIENT_CREDITS' || error?.error === 'SUBSCRIPTION_REQUIRED') {
        Alert.alert('Credits Required', error.message ?? 'Transforming an image costs 1 credit.', [
          { text: 'Not Now', style: 'cancel' },
          { text: 'Get Credits', onPress: () => navigation.navigate('Purchase') },
        ]);
      } else if (error?.error === 'INVALID_INSTRUCTION' || error?.error === 'CONTENT_MODERATED') {
        Alert.alert('Adjust your request', error.message ?? 'Please revise your instruction.');
      } else {
        Alert.alert('Could not transform the image', error?.message ?? 'Please try again.');
      }
    } finally {
      if (isMountedRef.current) setSubmitting(false);
    }
  }

  function reset() {
    processedRef.current = null;
    setPreviewUri(null);
    setPrompt('');
    setResult(null);
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Transform an Image</Text>
        <CreditDisplay onPress={() => navigation.navigate('Purchase')} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xxl }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {result ? (
          <View style={styles.resultWrap}>
            <Text style={styles.heading}>Transformed ✨</Text>
            <Text style={styles.sub}>Saved to your library — make a video anytime.</Text>
            <View style={styles.resultImageWrap}>
              <RetryableImage uri={result.imageUrl} style={styles.resultImage} resizeMode="cover" />
              <AiGeneratedBadge placement="center" />
            </View>
            <AppButton
              title="Make a Video"
              icon="videocam"
              size="lg"
              fullWidth
              onPress={() => {
                if (!result) return;
                // Park the transformed image; the Video screen consumes it on focus and loads it
                // as the source image. Must write useVideoSourceStore + navigate to 'Video' — the
                // old closet-store + 'Transform' hand-off dropped the image and dead-ended.
                setPendingSource({ imageUrl: result.imageUrl });
                navigation.navigate('Video');
              }}
            />
            <View style={{ height: Spacing.sm }} />
            <AppButton title="Transform Another" variant="outline" fullWidth onPress={reset} />
          </View>
        ) : (
          <>
            <Text style={styles.intro}>
              Start from any image, then describe how you want it transformed — change the style,
              scene, colors, or add and remove elements.
            </Text>

            {previewUri ? (
              <View style={styles.previewBlock}>
                <Image source={{ uri: previewUri }} style={styles.preview} resizeMode="cover" />
                <TouchableOpacity style={styles.replaceBtn} onPress={choosePhoto}>
                  <Ionicons name="swap-horizontal" size={16} color={Colors.accentText} />
                  <Text style={styles.replaceText}>Choose a different photo</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.dropzone} onPress={choosePhoto} activeOpacity={0.85}>
                <Ionicons name="image-outline" size={40} color={Colors.accentText} />
                <Text style={styles.dropTitle}>Select an image</Text>
                <Text style={styles.dropSub}>Take a photo or choose from your library</Text>
              </TouchableOpacity>
            )}

            {previewUri ? (
              <>
                <Text style={styles.label}>Describe how to transform this image</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. turn it into a watercolor painting at sunset"
                  placeholderTextColor={Colors.gray400}
                  value={prompt}
                  onChangeText={(t) => setPrompt(t.slice(0, PROMPT_MAX))}
                  multiline
                  maxLength={PROMPT_MAX}
                />
                <Text style={styles.counter}>
                  {prompt.length}/{PROMPT_MAX}
                </Text>

                <View style={styles.confirmBar}>
                  <AppButton
                    title={submitting ? 'Generating…' : 'Generate · 1 credit'}
                    icon={submitting ? undefined : 'sparkles'}
                    size="lg"
                    fullWidth
                    loading={submitting}
                    disabled={submitting}
                    onPress={generate}
                  />
                  {!submitting ? (
                    <AppButton title="Cancel" variant="ghost" fullWidth onPress={reset} />
                  ) : null}
                </View>
                {submitting ? (
                  <View style={styles.workingRow}>
                    <ActivityIndicator color={Colors.textPrimary} />
                    <Text style={styles.workingText}>This usually takes 10–30 seconds…</Text>
                  </View>
                ) : (
                  <Text style={styles.creditNote}>You have {credits} credits.</Text>
                )}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surface },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  topTitle: {
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  content: { padding: Spacing.md },
  intro: {
    fontSize: Typography.fontSizeMD,
    color: Colors.gray600,
    lineHeight: 22,
    marginBottom: Spacing.lg,
  },
  dropzone: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.accentSoft,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.accent,
    borderStyle: 'dashed',
    paddingVertical: Spacing.xxl,
  },
  dropTitle: {
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    marginTop: Spacing.sm,
  },
  dropSub: { fontSize: Typography.fontSizeSM, color: Colors.gray600 },
  previewBlock: { alignItems: 'center' },
  preview: { width: '100%', height: 360, borderRadius: Radius.lg, backgroundColor: Colors.gray100 },
  replaceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.md,
  },
  replaceText: {
    color: Colors.accentText,
    fontWeight: Typography.fontWeightSemiBold,
    fontSize: Typography.fontSizeSM,
  },
  label: {
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.gray200,
    borderRadius: Radius.md,
    padding: Spacing.md,
    fontSize: Typography.fontSizeMD,
    color: Colors.textPrimary,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  counter: {
    alignSelf: 'flex-end',
    color: Colors.gray400,
    fontSize: Typography.fontSizeXS,
    marginTop: 4,
  },
  confirmBar: { marginTop: Spacing.lg, gap: Spacing.sm },
  workingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  workingText: { color: Colors.gray600, fontSize: Typography.fontSizeSM },
  creditNote: {
    textAlign: 'center',
    color: Colors.gray400,
    fontSize: Typography.fontSizeSM,
    marginTop: Spacing.md,
  },
  resultWrap: { alignItems: 'center' },
  heading: {
    fontSize: Typography.fontSizeHero,
    fontWeight: Typography.fontWeightHeavy,
    color: Colors.textPrimary,
  },
  sub: { fontSize: Typography.fontSizeMD, color: Colors.gray600, marginBottom: Spacing.lg },
  resultImageWrap: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    marginBottom: Spacing.lg,
    position: 'relative',
  },
  resultImage: { width: '100%', height: '100%' },
});
