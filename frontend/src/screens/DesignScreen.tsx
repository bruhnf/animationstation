import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import api from '../config/api';
import { useUserStore } from '../store/useUserStore';
import { useVideoSourceStore } from '../store/useVideoSourceStore';
import { ClosetItem } from '../types';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import CreditDisplay from '../components/CreditDisplay';
import AiGeneratedBadge from '../components/AiGeneratedBadge';
import AppButton from '../components/ui/AppButton';
import { RootStackParams } from '../navigation';
import { STYLE_CHIPS, OCCASION_CHIPS, randomSurprisePrompt } from '../constants/outfitIdeas';

const DESCRIPTION_MAX = 300;

type DesignNavProp = NativeStackNavigationProp<RootStackParams, 'Design'>;

// "Generate an Image" — the image generator tools only (no library grid). Describe
// an image, Grok Imagine generates it (1 credit), and the result is shown for
// review: Keep it (it's saved to the library) or Reject it (deletes it). Saved
// creations live on the separate "Library" screen.
export default function DesignScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<DesignNavProp>();
  const refreshUser = useUserStore((s) => s.refreshUser);
  const setPendingSource = useVideoSourceStore((s) => s.setPendingSource);

  const [description, setDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  // The freshly generated image awaiting the user's Keep/Reject decision. It is
  // already persisted server-side (generate auto-saves); Reject deletes it.
  const [result, setResult] = useState<ClosetItem | null>(null);
  const isMountedRef = useRef(true);
  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  async function handleGenerate() {
    const trimmed = description.trim();
    if (trimmed.length < 3) {
      Alert.alert(
        'Please enter a prompt',
        'Tell us what to create — e.g. "a neon cyberpunk city at night".',
      );
      return;
    }
    setGenerating(true);
    try {
      const { data } = await api.post<ClosetItem>(
        '/closet/generate',
        { description: trimmed },
        { timeout: 90000 },
      );
      if (!isMountedRef.current) return;
      setResult(data);
      void refreshUser();
    } catch (err: unknown) {
      const resp = (err as { response?: { data?: { error?: string; message?: string } } })?.response
        ?.data;
      void refreshUser();
      if (resp?.error === 'INSUFFICIENT_CREDITS') {
        Alert.alert('Credits Required', resp.message ?? 'Generating an image costs 1 credit.', [
          { text: 'Not Now', style: 'cancel' },
          { text: 'Get Credits', onPress: () => navigation.navigate('Purchase') },
        ]);
      } else if (resp?.error === 'CONTENT_MODERATED' || resp?.error === 'INVALID_DESCRIPTION') {
        Alert.alert(
          'Cannot Create This Image',
          resp.message ?? 'Please enter a prompt.',
        );
      } else if (resp?.error === 'CLOSET_FULL') {
        Alert.alert(
          'Library Full',
          resp.message ?? 'Delete some items in your library to create more.',
        );
      } else {
        Alert.alert(
          'Generation Failed',
          resp?.message ??
            'Could not generate the image. If a credit was used it is refunded automatically.',
        );
      }
    } finally {
      if (isMountedRef.current) setGenerating(false);
    }
  }

  async function handleSurprise() {
    if (generating) return;
    // Prefer the server's combinatorial generator (far more variety than the
    // local list); fall back to the bundled prompts on any network/error so the
    // button always works offline.
    try {
      const { data } = await api.get<{ prompt?: string }>('/closet/surprise');
      if (data?.prompt) {
        setDescription(data.prompt);
        return;
      }
    } catch {
      // fall through to the local fallback below
    }
    setDescription((prev) => randomSurprisePrompt(prev.trim() || undefined));
  }

  function appendModifier(phrase: string) {
    if (generating) return;
    setDescription((prev) => {
      const current = prev.trim();
      if (current.toLowerCase().includes(phrase.toLowerCase())) return prev;
      const next = current.length === 0 ? phrase : `${current}, ${phrase}`;
      return next.length > DESCRIPTION_MAX ? prev : next;
    });
  }

  // Keep the creation (it's already saved) and reset to create another.
  function handleKeep() {
    setResult(null);
    setDescription('');
    Alert.alert('Saved ✨', 'Added to your library. Create another anytime.');
  }

  // Reject — delete the just-saved item and reset to create another.
  async function handleReject() {
    const item = result;
    if (!item) return;
    setResult(null);
    setDescription('');
    try {
      await api.delete(`/closet/${item.id}`);
    } catch {
      // Best-effort: if the delete fails the item simply remains in the library.
    }
  }

  // Keep + hand off to the Video screen with this creation pre-selected.
  function handleTryOn() {
    if (!result) return;
    // Seed the Video screen's source box with this image. VideoScreen consumes
    // `useVideoSourceStore` on focus — writing the closet store + navigating to
    // the (body-photo-gated) TryOn screen dropped the image and dead-ended.
    setPendingSource({ imageUrl: result.imageUrl });
    setResult(null);
    setDescription('');
    navigation.navigate('Video');
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
        {navigation.canGoBack() ? (
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={26} color={Colors.textPrimary} />
          </TouchableOpacity>
        ) : (
          <View style={styles.backBtn} />
        )}
        <Text style={styles.title}>Generate an Image</Text>
        <CreditDisplay onPress={() => navigation.navigate('Purchase')} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {result ? (
          // --- Review the freshly generated image ---
          <View style={styles.reviewWrap}>
            <Text style={styles.reviewHeading}>Here's your image ✨</Text>
            <View style={styles.reviewImageWrap}>
              <Image
                source={{ uri: result.imageUrl }}
                style={styles.reviewImage}
                resizeMode="cover"
              />
              <AiGeneratedBadge placement="center" />
            </View>
            <Text style={styles.reviewName} numberOfLines={2}>
              {result.name}
            </Text>
            <AppButton
              title="Save to Library"
              icon="checkmark"
              size="lg"
              fullWidth
              onPress={handleKeep}
            />
            <View style={{ height: Spacing.sm }} />
            <AppButton title="Make a Video Now" variant="outline" fullWidth onPress={handleTryOn} />
            <TouchableOpacity style={styles.rejectBtn} onPress={handleReject} hitSlop={8}>
              <Ionicons name="trash-outline" size={16} color={Colors.danger} />
              <Text style={styles.rejectText}>Reject this image</Text>
            </TouchableOpacity>
          </View>
        ) : (
          // --- Designer tools ---
          <View style={styles.designer}>
            <View style={styles.designerTitleRow}>
              <Text style={styles.designerHint}>
                Describe any image and AI will create it for you.
              </Text>
              <TouchableOpacity
                onPress={() => void handleSurprise()}
                disabled={generating}
                style={styles.surpriseBtn}
                hitSlop={8}
              >
                <Text style={styles.surpriseText}>🎲 Surprise me</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              placeholder='e.g. "a neon cyberpunk city at night"'
              placeholderTextColor={Colors.gray400}
              multiline
              maxLength={DESCRIPTION_MAX}
              value={description}
              onChangeText={setDescription}
              editable={!generating}
            />
            <View style={styles.chipRow}>
              {[...STYLE_CHIPS, ...OCCASION_CHIPS].map((c) => (
                <TouchableOpacity
                  key={c}
                  style={styles.chip}
                  onPress={() => appendModifier(c)}
                  disabled={generating}
                >
                  <Text style={styles.chipText}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.charCount}>
              {description.length}/{DESCRIPTION_MAX}
            </Text>
            <AppButton
              title={generating ? 'Creating…' : 'Generate · 1 credit'}
              size="lg"
              fullWidth
              loading={generating}
              disabled={generating}
              onPress={handleGenerate}
              style={{ marginTop: Spacing.sm }}
            />
            {generating ? (
              <View style={styles.workingRow}>
                <ActivityIndicator color={Colors.accentText} />
                <Text style={styles.workingText}>This usually takes 15–30 seconds…</Text>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  backBtn: { width: 50 },
  title: {
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  content: { padding: Spacing.md },
  designer: {},
  designerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  designerHint: { flex: 1, fontSize: Typography.fontSizeSM, color: Colors.gray600 },
  surpriseBtn: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.gray200,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  surpriseText: {
    fontSize: Typography.fontSizeSM,
    fontWeight: Typography.fontWeightSemiBold,
    color: Colors.textPrimary,
  },
  input: {
    backgroundColor: Colors.gray100,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.gray200,
    padding: Spacing.md,
    minHeight: 90,
    textAlignVertical: 'top',
    fontSize: Typography.fontSizeMD,
    color: Colors.textPrimary,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.sm },
  chip: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.gray200,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  chipText: { fontSize: Typography.fontSizeSM, color: Colors.gray600 },
  charCount: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray400,
    alignSelf: 'flex-end',
    marginTop: Spacing.sm,
  },
  workingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  workingText: { color: Colors.gray600, fontSize: Typography.fontSizeSM },
  reviewWrap: { alignItems: 'center' },
  reviewHeading: {
    fontSize: Typography.fontSizeHero,
    fontWeight: Typography.fontWeightHeavy,
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
  },
  reviewImageWrap: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.gray100,
    position: 'relative',
  },
  reviewImage: { width: '100%', height: '100%' },
  reviewName: {
    fontSize: Typography.fontSizeMD,
    color: Colors.textPrimary,
    fontWeight: Typography.fontWeightSemiBold,
    textAlign: 'center',
    marginVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  rejectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.md,
    marginTop: Spacing.xs,
  },
  rejectText: {
    color: Colors.danger,
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightSemiBold,
  },
});
