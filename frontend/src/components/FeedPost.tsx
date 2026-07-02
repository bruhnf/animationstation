import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { TryOnJob } from '../types';
import RetryableImage from './RetryableImage';
import AiGeneratedBadge from './AiGeneratedBadge';
import FeedComments from './FeedComments';

export interface FeedJob extends TryOnJob {
  user: { username: string; firstName?: string; lastName?: string; avatarUrl?: string };
  liked?: boolean;
  saved?: boolean;
  likesCount?: number;
  commentsCount?: number;
}

// Fraction of the page the content shrinks to when a post is "pulled back" to
// reveal comments. The rest of the page becomes the comment panel.
const EXPANDED_CONTENT_FRACTION = 0.42;

/**
 * One full-screen post in the immersive feed. The AI result (image or muted,
 * looping, autoplaying video) fills the page edge-to-edge; the creator, caption,
 * and the like / comment / share / save / more actions are overlays on top of it
 * (the ✨AI-generated badge stays visible per Guideline 4.0; the ⋯ menu keeps
 * Report/Block reachable per Guideline 1.2). Tapping the content pulls it back
 * into a top window and shows the comment thread underneath; tapping again
 * returns to full screen. Default is always full screen.
 */
export default function FeedPost({
  job,
  height,
  isActive,
  expanded,
  commentsCount,
  onToggleExpand,
  onUsernamePress,
  onLikePress,
  onSavePress,
  onSharePress,
  onMorePress,
}: {
  job: FeedJob;
  height: number;
  isActive: boolean;
  expanded: boolean;
  commentsCount: number;
  onToggleExpand: () => void;
  onUsernamePress: () => void;
  onLikePress: () => void;
  onSavePress: () => void;
  onSharePress: () => void;
  onMorePress: () => void;
}) {
  const isVideo = job.kind === 'VIDEO';
  // Image posts show the AI result; video posts play the generated clip (its
  // poster/source is bodyPhotoUrl, shown until the player is ready).
  const displayUrl = job.resultFullBodyUrl || job.resultMediumUrl;
  const videoPoster = job.bodyPhotoUrl;
  const fullName = [job.user.firstName, job.user.lastName].filter(Boolean).join(' ');
  const contentHeight = expanded ? Math.round(height * EXPANDED_CONTENT_FRACTION) : height;

  const [muted, setMuted] = useState(true);
  // One player per video post. Muted + looping; only the on-screen (active) post
  // plays — the rest pause so we never play several clips at once.
  const player = useVideoPlayer(isVideo ? (job.videoUrl ?? null) : null, (p) => {
    p.loop = true;
    p.muted = true;
  });

  useEffect(() => {
    if (!isVideo) return;
    try {
      if (isActive) player.play();
      else player.pause();
    } catch {
      // player may be released mid-transition; ignore.
    }
  }, [isActive, isVideo, player]);

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    try {
      player.muted = next;
    } catch {
      // ignore if released
    }
  }

  return (
    <View style={[styles.page, { height }]}>
      {/* Content window (image or video). Tapping toggles the comment view. */}
      <Pressable onPress={onToggleExpand} style={[styles.content, { height: contentHeight }]}>
        {isVideo ? (
          job.videoUrl ? (
            <VideoView
              player={player}
              style={styles.media}
              contentFit="cover"
              nativeControls={false}
            />
          ) : videoPoster ? (
            <RetryableImage uri={videoPoster} style={styles.media} resizeMode="cover" />
          ) : (
            <View style={[styles.media, styles.placeholder]} />
          )
        ) : displayUrl ? (
          <RetryableImage uri={displayUrl} style={styles.media} resizeMode="cover" />
        ) : (
          <View style={[styles.media, styles.placeholder]} />
        )}

        {/* Guideline 4.0 — visible AI disclosure over every result. */}
        <AiGeneratedBadge />

        {/* Mute/unmute for video (default muted). */}
        {isVideo && job.videoUrl ? (
          <TouchableOpacity style={styles.muteBtn} onPress={toggleMute} hitSlop={10}>
            <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={18} color={Colors.white} />
          </TouchableOpacity>
        ) : null}

        {/* Bottom scrim so the creator + caption stay legible over any image. */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.6)']}
          style={styles.scrim}
          pointerEvents="none"
        />

        {/* Creator + caption, bottom-left. */}
        <View style={styles.creatorWrap} pointerEvents="box-none">
          <TouchableOpacity style={styles.creatorRow} onPress={onUsernamePress} activeOpacity={0.8}>
            <View style={styles.avatar}>
              {job.user.avatarUrl ? (
                <RetryableImage uri={job.user.avatarUrl} style={styles.avatarImg} />
              ) : (
                <Text style={styles.avatarInitial}>{job.user.username[0].toUpperCase()}</Text>
              )}
            </View>
            <Text style={styles.creatorName} numberOfLines={1}>
              {fullName || `@${job.user.username}`}
            </Text>
          </TouchableOpacity>
          {job.title ? (
            <Text style={styles.caption} numberOfLines={expanded ? 1 : 3}>
              {job.title}
            </Text>
          ) : null}
          {isVideo && job.motionPrompt && !expanded ? (
            <Text style={styles.motionPrompt} numberOfLines={2}>
              <Text style={styles.motionPromptLabel}>Prompt: </Text>
              {job.motionPrompt}
            </Text>
          ) : null}
        </View>

        {/* Vertical action rail, bottom-right. */}
        <View style={styles.rail} pointerEvents="box-none">
          <RailButton
            icon={job.liked ? 'heart' : 'heart-outline'}
            color={job.liked ? Colors.danger : Colors.white}
            label={(job.likesCount ?? 0) > 0 ? String(job.likesCount) : undefined}
            onPress={onLikePress}
            accessibilityLabel={job.liked ? 'Unlike' : 'Like'}
          />
          <RailButton
            icon="chatbubble-outline"
            color={Colors.white}
            label={commentsCount > 0 ? String(commentsCount) : undefined}
            onPress={onToggleExpand}
            accessibilityLabel="Comments"
          />
          <RailButton
            icon="arrow-redo-outline"
            color={Colors.white}
            onPress={onSharePress}
            accessibilityLabel="Share"
          />
          <RailButton
            icon={job.saved ? 'bookmark' : 'bookmark-outline'}
            color={job.saved ? Colors.gold : Colors.white}
            onPress={onSavePress}
            accessibilityLabel={job.saved ? 'Remove from your creations' : 'Save'}
          />
          <RailButton
            icon="ellipsis-horizontal"
            color={Colors.white}
            onPress={onMorePress}
            accessibilityLabel="More actions"
          />
        </View>
      </Pressable>

      {/* Pulled-back comment panel. */}
      {expanded ? (
        <View style={[styles.commentsWrap, { height: height - contentHeight }]}>
          <FeedComments jobId={job.id} jobOwnerId={job.userId} />
        </View>
      ) : null}
    </View>
  );
}

function RailButton({
  icon,
  color,
  label,
  onPress,
  accessibilityLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label?: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <TouchableOpacity
      style={styles.railBtn}
      onPress={onPress}
      hitSlop={8}
      accessibilityLabel={accessibilityLabel}
    >
      <Ionicons name={icon} size={30} color={color} />
      {label ? <Text style={styles.railLabel}>{label}</Text> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  page: { width: '100%', backgroundColor: Colors.black },
  content: { width: '100%', backgroundColor: Colors.black, overflow: 'hidden' },
  media: { width: '100%', height: '100%' },
  placeholder: { backgroundColor: Colors.gray800 },
  muteBtn: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 180,
  },
  creatorWrap: {
    position: 'absolute',
    left: Spacing.md,
    right: 80, // clear the action rail
    bottom: Spacing.lg,
    gap: Spacing.xs,
  },
  creatorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: {
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightBold,
    color: Colors.white,
  },
  creatorName: {
    color: Colors.white,
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightBold,
    flexShrink: 1,
  },
  caption: {
    color: Colors.white,
    fontSize: Typography.fontSizeSM,
    lineHeight: 19,
  },
  motionPrompt: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: Typography.fontSizeXS,
    fontStyle: 'italic',
  },
  motionPromptLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontStyle: 'normal',
    fontWeight: Typography.fontWeightBold,
  },
  rail: {
    position: 'absolute',
    right: Spacing.sm,
    bottom: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.lg,
  },
  railBtn: { alignItems: 'center', gap: 3 },
  railLabel: {
    color: Colors.white,
    fontSize: Typography.fontSizeXS,
    fontWeight: Typography.fontWeightSemiBold,
  },
  commentsWrap: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    overflow: 'hidden',
  },
});
