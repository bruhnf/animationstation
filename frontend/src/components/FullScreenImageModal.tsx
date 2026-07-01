import React, { useState, useRef } from 'react';
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/theme';
import AiGeneratedBadge from './AiGeneratedBadge';
import ImageOverlayBadge from './ImageOverlayBadge';
import RetryableImage from './RetryableImage';

// Each original-image overlay carries a label and an icon. The icon is
// optional — pass null to render text only.
export interface OriginalImageBadge {
  label: string;
  iconName?: keyof typeof Ionicons.glyphMap;
}

interface FullScreenImageModalProps {
  visible: boolean;
  imageUrls: string[];
  initialIndex?: number;
  onClose: () => void;
  // Whether the AI-generated disclosure badge should be drawn over each image.
  //   - boolean: applies to every image in imageUrls.
  //   - boolean[]: per-image; index N controls image N. Use when the carousel
  //     mixes AI results with original inputs (clothing / body photos).
  //   Default false (no badge).
  aiGenerated?: boolean | boolean[];
  // Per-image labels shown next to the pagination dots. Index N applies to
  // image N. Falls back to "M of N" when the slot is missing.
  labels?: string[];
  // Optional per-image overlay badge for non-AI images (clothing, body
  // photo, etc.). Index N applies to image N; pass null/undefined for any
  // image that should not get an overlay. AI-generated slots take the AI
  // disclosure badge instead and ignore this prop.
  originalBadges?: (OriginalImageBadge | null | undefined)[];
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function FullScreenImageModal({
  visible,
  imageUrls,
  initialIndex = 0,
  onClose,
  aiGenerated = false,
  labels,
  originalBadges,
}: FullScreenImageModalProps) {
  function isAiAt(index: number): boolean {
    if (Array.isArray(aiGenerated)) return !!aiGenerated[index];
    return aiGenerated;
  }
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const scrollRef = useRef<ScrollView>(null);

  if (imageUrls.length === 0) return null;

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(offsetX / SCREEN_WIDTH);
    if (index !== currentIndex && index >= 0 && index < imageUrls.length) {
      setCurrentIndex(index);
    }
  };

  const effectiveLabels = labels ?? ['Full Body', 'Medium'];

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
        <TouchableOpacity
          style={[styles.closeButton, { top: insets.top + 16 }]}
          onPress={onClose}
          activeOpacity={0.7}
        >
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>

        {/* Spacer below safe area + close button so the image starts where the controls end */}
        <View style={{ height: insets.top + 60 }} />

        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          contentOffset={{ x: initialIndex * SCREEN_WIDTH, y: 0 }}
          style={styles.carousel}
        >
          {imageUrls.map((url, index) => {
            const ai = isAiAt(index);
            const original = !ai ? originalBadges?.[index] : undefined;
            return (
              <View key={index} style={styles.imageContainer}>
                {/* Render the image directly in the page (no nested ScrollView).
                    A nested zoomable ScrollView here caused a release-build-only
                    layout race: with centerContent + an odd-aspect image (e.g. a
                    narrow clothing screenshot), the inner scroll applied a wrong
                    initial content-offset before layout settled, so the page
                    opened shifted "out of frame" until touched. The dev client's
                    slower timing hid it; optimized Hermes in release exposed it.
                    Pinch-to-zoom can be re-added later via react-native-gesture-
                    handler + reanimated (gated to page only at scale 1). */}
                <RetryableImage uri={url} style={styles.image} resizeMode="contain" />
                {ai ? (
                  <AiGeneratedBadge />
                ) : original ? (
                  <ImageOverlayBadge label={original.label} iconName={original.iconName} />
                ) : null}
              </View>
            );
          })}
        </ScrollView>

        {/* Bottom spacer so the image doesn't sit underneath the pagination dots */}
        <View style={{ height: insets.bottom + (imageUrls.length > 1 ? 80 : 20) }} />

        {imageUrls.length > 1 && (
          <View style={[styles.pagination, { bottom: insets.bottom + 40 }]}>
            <Text style={styles.paginationLabel}>
              {effectiveLabels[currentIndex] || `${currentIndex + 1} of ${imageUrls.length}`}
            </Text>
            <View style={styles.dots}>
              {imageUrls.map((_, index) => (
                <View
                  key={index}
                  style={[styles.dot, index === currentIndex && styles.dotActive]}
                />
              ))}
            </View>
          </View>
        )}

        <TouchableOpacity style={styles.tapArea} onPress={onClose} activeOpacity={1} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
  },
  carousel: {
    flex: 1,
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
  closeText: {
    fontSize: 20,
    color: Colors.white,
    fontWeight: '300',
  },
  imageContainer: {
    width: SCREEN_WIDTH,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: SCREEN_WIDTH,
    height: '100%',
  },
  tapArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: -1,
  },
  pagination: {
    position: 'absolute',
    alignItems: 'center',
    zIndex: 10,
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
    backgroundColor: Colors.white,
  },
});
