import React, { useState, useRef, useEffect } from 'react';
import {
  Modal,
  View,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Dimensions,
  Text,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Switch,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Radius } from '../constants/theme';
import RetryableImage from './RetryableImage';
import { Creation } from '../types';
import { RootStackParams } from '../navigation';
import api from '../config/api';
import { downloadImageToGallery, downloadMultipleImages, shareImage } from '../utils/imageUtils';
import { ensurePhotoLibrarySavePermission } from '../utils/permissions';
import { saveLook, unsaveLook } from '../utils/looks';
import { useVideoSourceStore } from '../store/useVideoSourceStore';
import AiGeneratedBadge from './AiGeneratedBadge';
import ImageOverlayBadge from './ImageOverlayBadge';
import { buildCreationCarousel } from '../utils/creationCarousel';

interface CreationDetailModalProps {
  visible: boolean;
  job: Creation | null;
  onClose: () => void;
  onPrivacyChanged?: (jobId: string, isPrivate: boolean) => void;
  // Notify the parent list when the owner toggles "Save" so its state
  // stays in sync without a refetch (mirrors onPrivacyChanged).
  onSavedChanged?: (jobId: string, saved: boolean) => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function CreationDetailModal({
  visible,
  job,
  onClose,
  onPrivacyChanged,
  onSavedChanged,
}: CreationDetailModalProps) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPrivate, setIsPrivate] = useState(job?.isPrivate ?? false);
  const [updating, setUpdating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [saved, setSaved] = useState(job?.saved ?? false);
  const [savingLook, setSavingLook] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Reset state when job changes
  useEffect(() => {
    if (job) {
      setIsPrivate(job.isPrivate ?? false);
      setSaved(job.saved ?? false);
      setCurrentIndex(0);
      scrollRef.current?.scrollTo({ x: 0, animated: false });
    }
  }, [job?.id]);

  if (!job) return null;

  const jobId = job.id;

  // Build the same 4-slide carousel used everywhere else (HomeScreen feed
  // taps, PublicProfileScreen). Slots that aren't present are dropped.
  // Order: Result (AI) → Variation (AI) → Original reference → Original photo.
  const slides = buildCreationCarousel(job);
  const aiSlides = slides.filter((s) => s.aiGenerated);

  // "MAKE VIDEO!" — a VIDEO job is already a video; nothing to animate. For an
  // image creation, any displayed slide can be animated (see handleMakeVideo).
  const canMakeVideo = job.kind !== 'VIDEO';

  // The only case this can happen is a job that completed with neither
  // result URL set, AND with no clothing/body inputs we can show — basically
  // a malformed row. Bail rather than render an empty modal.
  if (slides.length === 0) return null;

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(offsetX / SCREEN_WIDTH);
    if (index !== currentIndex && index >= 0 && index < slides.length) {
      setCurrentIndex(index);
    }
  };

  async function togglePrivacy() {
    const newValue = !isPrivate;
    setUpdating(true);
    try {
      await api.patch(`/creations/${jobId}/privacy`, { isPrivate: newValue });
      setIsPrivate(newValue);
      onPrivacyChanged?.(jobId, newValue);
    } catch {
      Alert.alert('Error', 'Could not update privacy setting.');
    } finally {
      setUpdating(false);
    }
  }

  async function handleDownloadCurrent() {
    if (downloading) return;
    const granted = await ensurePhotoLibrarySavePermission(
      'to save your creations to your gallery',
    );
    if (!granted) return;
    setDownloading(true);
    const currentImage = slides[currentIndex];
    const result = await downloadImageToGallery(
      currentImage.url,
      `AnimationStation_${currentImage.label.replace(/\s/g, '')}_${Date.now()}.jpg`,
    );
    setDownloading(false);
    Alert.alert(result.success ? 'Saved!' : 'Error', result.message);
  }

  // Save All saves only the AI-generated results — the source images are
  // inputs the user already has elsewhere and aren't outputs of this
  // creation. The button is hidden when there's only one AI result to save.
  async function handleDownloadAll() {
    if (downloading || aiSlides.length < 2) return;
    const granted = await ensurePhotoLibrarySavePermission(
      'to save your creations to your gallery',
    );
    if (!granted) return;
    setDownloading(true);
    const result = await downloadMultipleImages(aiSlides);
    setDownloading(false);
    Alert.alert(result.success ? 'Saved!' : 'Error', result.message);
  }

  async function handleShare() {
    const currentImage = slides[currentIndex];
    await shareImage(currentImage.url);
  }

  // Hand the CURRENTLY-DISPLAYED carousel image off to VideoScreen as the image
  // to animate, then close the modal and jump to the Video screen.
  function handleMakeVideo() {
    const currentImage = slides[currentIndex];
    if (!currentImage) return;
    useVideoSourceStore.getState().setPendingSource({ imageUrl: currentImage.url });
    onClose();
    navigation.navigate('Video');
  }

  // Bookmark this creation into the in-app "Saved Creations" collection (distinct
  // from "Save"/"Save All", which download images to the device gallery).
  // Optimistic toggle; turns yellow when saved, rolls back on failure.
  async function handleToggleSaveLook() {
    if (savingLook) return;
    const wasSaved = saved;
    setSaved(!wasSaved);
    setSavingLook(true);
    const ok = wasSaved ? await unsaveLook(jobId) : await saveLook(jobId);
    setSavingLook(false);
    if (ok) {
      onSavedChanged?.(jobId, !wasSaved);
    } else {
      setSaved(wasSaved);
      Alert.alert('Error', 'Could not update your Saved Creations. Please try again.');
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <StatusBar barStyle="light-content" backgroundColor="rgba(0,0,0,0.95)" />
      <View style={styles.overlay}>
        {/* Close button */}
        <TouchableOpacity
          style={[styles.closeButton, { top: insets.top + 16 }]}
          onPress={onClose}
          activeOpacity={0.7}
        >
          <Ionicons name="close" size={24} color={Colors.white} />
        </TouchableOpacity>

        {/* Spacer for safe area + close button row so the image starts below it */}
        <View style={{ height: insets.top + 60 }} />

        {/* Image carousel — fills remaining vertical space between header and controls */}
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          style={styles.carousel}
        >
          {slides.map((slide, index) => (
            <View key={index} style={styles.imageContainer}>
              <RetryableImage uri={slide.url} style={styles.image} resizeMode="contain" />
              {slide.aiGenerated ? (
                <AiGeneratedBadge />
              ) : slide.badge ? (
                <ImageOverlayBadge label={slide.badge.label} iconName={slide.badge.iconName} />
              ) : null}
            </View>
          ))}
        </ScrollView>

        {/* Bottom controls */}
        <View style={[styles.controls, { paddingBottom: insets.bottom + 20 }]}>
          {/* Pagination */}
          {slides.length > 1 && (
            <View style={styles.pagination}>
              <Text style={styles.paginationLabel}>{slides[currentIndex].label}</Text>
              <View style={styles.dots}>
                {slides.map((_, index) => (
                  <View
                    key={index}
                    style={[styles.dot, index === currentIndex && styles.dotActive]}
                  />
                ))}
              </View>
            </View>
          )}

          {/* Action buttons */}
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleShare}
              disabled={downloading}
            >
              <Ionicons name="share-outline" size={22} color={Colors.white} />
              <Text style={styles.actionButtonText}>Share</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleDownloadCurrent}
              disabled={downloading}
            >
              {downloading ? (
                <ActivityIndicator color={Colors.white} size="small" />
              ) : (
                <Ionicons name="download-outline" size={22} color={Colors.white} />
              )}
              <Text style={styles.actionButtonText}>Save</Text>
            </TouchableOpacity>

            {aiSlides.length > 1 && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={handleDownloadAll}
                disabled={downloading}
              >
                {downloading ? (
                  <ActivityIndicator color={Colors.white} size="small" />
                ) : (
                  <Ionicons name="images-outline" size={22} color={Colors.white} />
                )}
                <Text style={styles.actionButtonText}>Save All</Text>
              </TouchableOpacity>
            )}

            {/* Save — bookmark into the in-app Saved Creations collection
                (distinct from the gallery downloads above). */}
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleToggleSaveLook}
              disabled={savingLook}
            >
              {savingLook ? (
                <ActivityIndicator color={Colors.white} size="small" />
              ) : (
                <Ionicons
                  name={saved ? 'bookmark' : 'bookmark-outline'}
                  size={22}
                  color={saved ? Colors.gold : Colors.white}
                />
              )}
              <Text style={styles.actionButtonText}>{saved ? 'Saved' : 'Save'}</Text>
            </TouchableOpacity>
          </View>

          {/* MAKE VIDEO! — animate this creation into a short clip */}
          {canMakeVideo && (
            <TouchableOpacity
              style={styles.makeVideoButton}
              onPress={handleMakeVideo}
              activeOpacity={0.85}
            >
              <Ionicons name="videocam" size={20} color={Colors.textPrimary} />
              <Text style={styles.makeVideoText}>MAKE VIDEO!</Text>
            </TouchableOpacity>
          )}

          {/* Privacy toggle */}
          <View style={styles.privacyContainer}>
            <View style={styles.privacyInfo}>
              <Ionicons
                name={isPrivate ? 'lock-closed' : 'globe-outline'}
                size={20}
                color={Colors.white}
              />
              <View style={styles.privacyTextContainer}>
                <Text style={styles.privacyLabel}>{isPrivate ? 'Private' : 'Public'}</Text>
                <Text style={styles.privacyHint}>
                  {isPrivate ? 'Only you can see this' : 'Visible on public feed'}
                </Text>
              </View>
            </View>
            {updating ? (
              <ActivityIndicator color={Colors.white} size="small" />
            ) : (
              <Switch
                value={isPrivate}
                onValueChange={togglePrivacy}
                trackColor={{ false: 'rgba(255,255,255,0.3)', true: Colors.white }}
                thumbColor={isPrivate ? Colors.black : Colors.white}
              />
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
  },
  closeButton: {
    position: 'absolute',
    right: 16,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  carousel: {
    flex: 1,
  },
  imageContainer: {
    width: SCREEN_WIDTH,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: SCREEN_WIDTH - 32,
    height: '100%',
    borderRadius: Radius.lg,
  },
  controls: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  pagination: {
    alignItems: 'center',
    marginBottom: 20,
  },
  paginationLabel: {
    color: Colors.white,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  dots: {
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  dotActive: {
    backgroundColor: Colors.surface,
  },
  privacyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: Radius.md,
    padding: 16,
  },
  privacyInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  privacyTextContainer: {
    gap: 2,
  },
  privacyLabel: {
    color: Colors.white,
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightSemiBold,
  },
  privacyHint: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: Typography.fontSizeXS,
  },
  actionButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 16,
  },
  actionButton: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: Radius.md,
    minWidth: 70,
  },
  actionButtonText: {
    color: Colors.white,
    fontSize: Typography.fontSizeXS,
    fontWeight: Typography.fontWeightMedium,
  },
  makeVideoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    backgroundColor: Colors.gold,
    borderRadius: Radius.md,
    marginBottom: 16,
  },
  makeVideoText: {
    color: Colors.textPrimary,
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightBold,
    letterSpacing: 0.5,
  },
});
