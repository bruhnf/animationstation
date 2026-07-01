import React from 'react';
import { Modal, View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Colors, Typography, Spacing } from '../constants/theme';
import AiGeneratedBadge from './AiGeneratedBadge';

// Full-screen player for an AI video result. `uri` is a presigned mp4 URL (null
// when closed). `motionPrompt` (optional) is the animation prompt the creator
// used, shown under the video. Auto-loops; tap Close or the backdrop to dismiss.
export default function VideoPlayerModal({
  visible,
  uri,
  motionPrompt,
  onClose,
}: {
  visible: boolean;
  uri: string | null;
  motionPrompt?: string | null;
  onClose: () => void;
}) {
  const player = useVideoPlayer(visible && uri ? uri : null, (p) => {
    p.loop = true;
    if (visible && uri) p.play();
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={12}>
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
        {uri ? (
          <View style={styles.videoWrap}>
            <VideoView player={player} style={styles.video} contentFit="contain" nativeControls />
            <AiGeneratedBadge placement="center" />
          </View>
        ) : null}
        {uri && motionPrompt ? (
          <Text style={styles.motionPrompt} numberOfLines={3}>
            <Text style={styles.motionPromptLabel}>Prompt: </Text>
            {motionPrompt}
          </Text>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: { position: 'absolute', top: 50, right: 20, zIndex: 2, padding: Spacing.sm },
  closeText: { color: Colors.white, fontSize: 28, fontWeight: Typography.fontWeightBold },
  videoWrap: { width: '100%', aspectRatio: 3 / 4, maxHeight: '85%', position: 'relative' },
  video: { width: '100%', height: '100%' },
  motionPrompt: {
    color: Colors.gray200,
    fontSize: Typography.fontSizeSM,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
  },
  motionPromptLabel: {
    color: Colors.gray400,
    fontStyle: 'normal',
    fontWeight: Typography.fontWeightBold,
  },
});
