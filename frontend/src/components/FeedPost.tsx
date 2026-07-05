import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, TouchableOpacity, StyleSheet } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { Creation } from '../types';
import RetryableImage from './RetryableImage';
import AiGeneratedBadge from './AiGeneratedBadge';
import FeedComments from './FeedComments';
import { useFeedAudioStore } from '../store/useFeedAudioStore';

export interface FeedJob extends Creation {
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
 * One full-screen post in the immersive feed. The AI result fills the page:
 * videos (muted, looping, autoplaying) and images are shown edge-to-edge, and
 * an image that isn't the phone's aspect ratio is letterboxed (resizeMode
 * "contain") against black rather than cropped. The creator, caption, and the
 * like / comment / share / save / more actions are overlays on top of it (the
 * ✨AI-generated badge stays visible per Guideline 4.0; the ⋯ menu keeps
 * Report/Block reachable per Guideline 1.2).
 *
 * Interactions: the COMMENT button opens/closes the comment view (pulls the
 * content into a top window with the thread underneath). Tapping the content
 * itself pauses/resumes a video and does nothing to an image.
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
  // poster/source is sourceImageUrl, shown until the player is ready).
  const displayUrl = job.resultImageUrl || job.resultImage2Url;
  const videoPoster = job.sourceImageUrl;
  const fullName = [job.user.firstName, job.user.lastName].filter(Boolean).join(' ');
  const contentHeight = expanded ? Math.round(height * EXPANDED_CONTENT_FRACTION) : height;

  // Feed-wide mute preference (shared across every post) so un-muting one video
  // keeps audio on as the viewer scrolls, instead of resetting per clip.
  const muted = useFeedAudioStore((s) => s.muted);
  const toggleMuted = useFeedAudioStore((s) => s.toggleMuted);
  // Whether the viewer manually paused this video by tapping it. Reset whenever
  // the post scrolls back into view so a fresh view always autoplays.
  const [userPaused, setUserPaused] = useState(false);
  // Whether the Home feed screen is actually on top. Screens in a tab navigator
  // stay MOUNTED when you switch tabs, and pushing a stack screen (Create,
  // Video, a profile…) over the tabs doesn't unmount them either — so without
  // this gate the active post's player would keep playing audio underneath the
  // page you navigated to. Goes false for both cases.
  const isFocused = useIsFocused();
  // One player per video post. Looping; only the on-screen (active) post plays —
  // the rest pause so we never play several clips at once. Seed muted from the
  // shared preference (via getState so we don't re-run the factory on toggle);
  // the effect below keeps it in sync afterwards.
  const player = useVideoPlayer(isVideo ? (job.videoUrl ?? null) : null, (p) => {
    p.loop = true;
    p.muted = useFeedAudioStore.getState().muted;
  });

  // Play only when this post is the on-screen one AND the feed is focused;
  // pause otherwise. Gating on focus (not just isActive) is what stops the
  // video's audio from continuing to play after navigating to another tab or
  // screen.
  useEffect(() => {
    if (!isVideo) return;
    try {
      if (isActive && isFocused) {
        player.play();
        setUserPaused(false);
      } else {
        player.pause();
      }
    } catch {
      // player may be released mid-transition; ignore.
    }
  }, [isActive, isFocused, isVideo, player]);

  // Apply the shared mute preference to this player — on mount (a freshly
  // scrolled-in video adopts the current setting) and whenever it changes
  // (toggling on one post updates every mounted player live).
  useEffect(() => {
    if (!isVideo) return;
    try {
      player.muted = muted;
    } catch {
      // ignore if released
    }
  }, [muted, isVideo, player]);

  function toggleMute() {
    // Flip the shared preference; the effect above pushes it to the player.
    toggleMuted();
  }

  // Tapping the content pauses/resumes a video; images do nothing.
  function handleContentPress() {
    if (!isVideo) return;
    try {
      if (userPaused) {
        player.play();
        setUserPaused(false);
      } else {
        player.pause();
        setUserPaused(true);
      }
    } catch {
      // player may be released; ignore.
    }
  }

  return (
    <View style={[styles.page, { height }]}>
      {/* Content window (image or video). Tapping pauses/resumes a video; images ignore taps. */}
      <Pressable onPress={handleContentPress} style={[styles.content, { height: contentHeight }]}>
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
          <RetryableImage uri={displayUrl} style={styles.media} resizeMode="contain" />
        ) : (
          <View style={[styles.media, styles.placeholder]} />
        )}

        {/* Paused indicator — video only, shown when the viewer tapped to pause. */}
        {isVideo && userPaused ? (
          <View style={styles.pauseOverlay} pointerEvents="none">
            <Ionicons name="play" size={64} color="rgba(255,255,255,0.9)" />
          </View>
        ) : null}

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
  pauseOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
