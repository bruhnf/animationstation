import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  ActionSheetIOS,
  Alert,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import api from '../config/api';
import { useUserStore } from '../store/useUserStore';
import { useConfigStore } from '../store/useConfigStore';
import { shareTryOn } from '../utils/share';
import { saveLook, unsaveLook } from '../utils/looks';
import { TryOnJob } from '../types';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { RootStackParams, MainTabParams } from '../navigation';
import FullScreenImageModal, { OriginalImageBadge } from '../components/FullScreenImageModal';
import CreditDisplay from '../components/CreditDisplay';
import HeaderMenu from '../components/HeaderMenu';
import AiGeneratedBadge from '../components/AiGeneratedBadge';
import VideoPlayerModal from '../components/VideoPlayerModal';
import RetryableImage from '../components/RetryableImage';
import ReportSheet, { ReportTargetType } from '../components/ReportSheet';
import { buildTryOnCarousel, CarouselSlot, indexOfSlot } from '../utils/tryonCarousel';
import { useCommentDeltas } from '../store/useCommentDeltas';
import { requireRealUser } from '../utils/guestGate';

type Nav = NativeStackNavigationProp<RootStackParams>;

interface FeedJob extends TryOnJob {
  user: { username: string; firstName?: string; lastName?: string; avatarUrl?: string };
  liked?: boolean;
  saved?: boolean;
  likesCount?: number;
  commentsCount?: number;
}

// Module-level so its identity is stable across renders (a fresh inline
// keyExtractor would make FlatList re-key on every render).
const keyExtractor = (item: FeedJob) => item.id;

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  // Same underlying navigation object as `navigation` above, but typed as
  // the bottom-tab nav so we can subscribe to the 'tabPress' event below.
  const tabNavigation = useNavigation<BottomTabNavigationProp<MainTabParams, 'Home'>>();
  const { user, refreshUser } = useUserStore();
  const isGuest = user?.isGuest === true;
  const { signupCreditGrant, signupCreditsOffer } = useConfigStore();
  const [jobs, setJobs] = useState<FeedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [fullScreenImages, setFullScreenImages] = useState<string[]>([]);
  const [fullScreenInitialIndex, setFullScreenInitialIndex] = useState(0);
  const [fullScreenAi, setFullScreenAi] = useState<boolean[]>([]);
  const [fullScreenLabels, setFullScreenLabels] = useState<string[]>([]);
  const [fullScreenBadges, setFullScreenBadges] = useState<(OriginalImageBadge | null)[]>([]);
  // Presigned mp4 URL for the full-screen video player (null = closed) + the
  // creator's motion prompt to show under it.
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoPrompt, setVideoPrompt] = useState<string | null>(null);
  const openVideo = useCallback((item: FeedJob) => {
    setVideoUri(item.videoUrl ?? null);
    setVideoPrompt(item.motionPrompt ?? null);
  }, []);

  // Open the 4-slide TryOn carousel anchored to whichever thumbnail the user
  // tapped. Slots that aren't present on the job are skipped, so the initial
  // index falls back to the first available slide (which will normally be
  // the requested one — the source thumbnail wouldn't render otherwise).
  const openCarousel = useCallback((item: FeedJob, slot: CarouselSlot) => {
    const slides = buildTryOnCarousel(item);
    if (slides.length === 0) return;
    setFullScreenImages(slides.map((s) => s.url));
    setFullScreenAi(slides.map((s) => s.aiGenerated));
    setFullScreenLabels(slides.map((s) => s.label));
    setFullScreenBadges(slides.map((s) => s.badge));
    setFullScreenInitialIndex(indexOfSlot(slides, slot));
  }, []);
  const [reportTarget, setReportTarget] = useState<{ type: ReportTargetType; id: string } | null>(
    null,
  );
  const [feedError, setFeedError] = useState(false);
  const commentDeltas = useCommentDeltas((s) => s.deltas);
  const clearCommentDeltas = useCommentDeltas((s) => s.clear);

  // Show platform-native action sheet on iOS, basic Alert on Android, with
  // Report and Block options. Required by App Store Review Guideline 1.2.
  const handleMoreActions = useCallback(
    (job: FeedJob) => {
      // Post actions are account-bound — prompt a guest to sign up.
      if (!requireRealUser('Sign up for post options.')) return;
      const isOwnPost = job.userId === user?.id;

      // Own post → owner actions (Make Private / Share / Delete). Previously the
      // menu was empty for own posts (just "Cancel"), so it looked like a dead end.
      if (isOwnPost) {
        const privacyLabel = job.isPrivate ? 'Make Public' : 'Make Private';

        const togglePrivacy = async () => {
          const newVal = !job.isPrivate;
          try {
            await api.patch(`/tryon/${job.id}/privacy`, { isPrivate: newVal });
            // The feed shows only public posts, so making one private removes it
            // from the feed; making public (defensive) just updates the flag.
            setJobs((prev) =>
              newVal
                ? prev.filter((j) => j.id !== job.id)
                : prev.map((j) => (j.id === job.id ? { ...j, isPrivate: false } : j)),
            );
          } catch {
            Alert.alert('Error', 'Could not update privacy. Please try again.');
          }
        };

        const confirmDelete = () => {
          Alert.alert(
            'Delete Creation',
            'This permanently deletes this creation and its images. This cannot be undone.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await api.post('/tryon/bulk-delete', { jobIds: [job.id] });
                    setJobs((prev) => prev.filter((j) => j.id !== job.id));
                  } catch {
                    Alert.alert('Error', 'Could not delete. Please try again.');
                  }
                },
              },
            ],
          );
        };

        const runOwn = (index: number) => {
          if (index === 0) void togglePrivacy();
          else if (index === 1) void shareTryOn(job.id);
          else if (index === 2) confirmDelete();
        };

        if (Platform.OS === 'ios') {
          ActionSheetIOS.showActionSheetWithOptions(
            {
              options: [privacyLabel, 'Share', 'Delete', 'Cancel'],
              cancelButtonIndex: 3,
              destructiveButtonIndex: 2,
            },
            runOwn,
          );
        } else {
          Alert.alert('Options', '', [
            { text: privacyLabel, onPress: () => runOwn(0) },
            { text: 'Share', onPress: () => runOwn(1) },
            { text: 'Delete', style: 'destructive', onPress: () => runOwn(2) },
            { text: 'Cancel', style: 'cancel' },
          ]);
        }
        return;
      }

      const options = ['Report Post', 'Report User', `Block @${job.user.username}`, 'Cancel'];
      const cancelButtonIndex = options.length - 1;
      const destructiveButtonIndex = 2;

      const handleSelection = async (index: number) => {
        if (index === cancelButtonIndex) return;
        if (index === 0) setReportTarget({ type: 'TRYON_JOB', id: job.id });
        else if (index === 1) setReportTarget({ type: 'USER', id: job.userId });
        else if (index === 2) {
          Alert.alert(
            `Block @${job.user.username}?`,
            'You will no longer see their posts and they will not be able to see yours. You can unblock anyone from Settings.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Block',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await api.post(`/users/${job.userId}/block`);
                    setJobs((prev) => prev.filter((j) => j.userId !== job.userId));
                  } catch {
                    Alert.alert('Error', 'Could not block this user. Please try again.');
                  }
                },
              },
            ],
          );
        }
      };

      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          { options, cancelButtonIndex, destructiveButtonIndex },
          handleSelection,
        );
      } else {
        // Minimal Android fallback. The app is iOS-first; Android UX can be improved later.
        if (isOwnPost) return;
        Alert.alert('Actions', '', [
          { text: 'Report Post', onPress: () => handleSelection(0) },
          { text: 'Report User', onPress: () => handleSelection(1) },
          {
            text: `Block @${job.user.username}`,
            style: 'destructive',
            onPress: () => handleSelection(2),
          },
          { text: 'Cancel', style: 'cancel' },
        ]);
      }
    },
    [user?.id],
  );

  async function fetchFeed(p = 1, refresh = false) {
    try {
      const { data } = await api.get<{ jobs: FeedJob[]; page: number }>(`/feed?page=${p}`);
      setJobs((prev) => (refresh ? data.jobs : [...prev, ...data.jobs]));
      setHasMore(data.jobs.length === 20);
      setPage(p);
      setFeedError(false);
      // Server counts now reflect every committed change, so the in-flight
      // deltas would double-count if we kept them.
      if (refresh) clearCommentDeltas();
    } catch {
      // Surface a retry banner instead of just an empty state — empty + no
      // feedback makes a transient backend hiccup look like an empty feed.
      setFeedError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    fetchFeed(1, true);
  }, []);

  // Refresh the Discover feed only when the Home tab button is pressed
  // while Home is ALREADY the focused tab. Switching back to Home from a
  // different tab should preserve the user's existing scroll position and
  // feed cache. The bottom-tab navigator emits 'tabPress' before the focus
  // change occurs, so `isFocused()` returns true only in the "already on
  // Home, tapped Home again" case.
  useEffect(() => {
    const unsubscribe = tabNavigation.addListener('tabPress', () => {
      if (!tabNavigation.isFocused()) return;
      setRefreshing(true);
      fetchFeed(1, true);
    });
    return unsubscribe;
    // fetchFeed reads only setters (stable across renders) so we don't need
    // to add it to the dep array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabNavigation]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refreshUser();
    fetchFeed(1, true);
  }, []);

  // `loading` is only true on the first fetch, so it can't guard pagination.
  // A dedicated in-flight ref prevents a fast scroll from firing loadMore twice
  // for the same page (which appends duplicate cards → duplicate-key warnings).
  const loadingMoreRef = useRef(false);
  const loadMore = () => {
    if (!hasMore || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    fetchFeed(page + 1).finally(() => {
      loadingMoreRef.current = false;
    });
  };

  // Optimistic toggle of `liked` state on a feed item. Takes the whole job
  // (not just an id) so it never needs to close over `jobs` — that keeps the
  // callback stable, which is what lets memoized FeedCards skip re-rendering.
  const toggleLike = useCallback(
    async (job: FeedJob) => {
      // Liking is account-bound — prompt a guest to sign up (before any
      // optimistic UI change so the heart doesn't flash filled then revert).
      if (!requireRealUser('Sign up to like creations.')) return;
      // Don't allow self-likes (server enforces too)
      if (user && job.user.username === user.username) return;

      const wasLiked = !!job.liked;
      setJobs((prev) =>
        prev.map((j) =>
          j.id === job.id
            ? {
                ...j,
                liked: !wasLiked,
                likesCount: Math.max(0, (j.likesCount ?? 0) + (wasLiked ? -1 : 1)),
              }
            : j,
        ),
      );

      try {
        if (wasLiked) await api.delete(`/likes/${job.id}`);
        else await api.post(`/likes/${job.id}`);
      } catch {
        // Roll back on failure
        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? {
                  ...j,
                  liked: wasLiked,
                  likesCount: Math.max(0, (j.likesCount ?? 0) + (wasLiked ? 1 : -1)),
                }
              : j,
          ),
        );
      }
    },
    [user],
  );

  const handleUsernamePress = useCallback(
    (job: FeedJob) => navigation.navigate('PublicProfile', { username: job.user.username }),
    [navigation],
  );

  const handleCommentsPress = useCallback(
    (job: FeedJob) => navigation.navigate('TryOnComments', { jobId: job.id }),
    [navigation],
  );

  // Toggle a look in the user's Saved Looks. Account-bound (guests are prompted
  // to sign up). Optimistically flips the card's `saved` state (the bookmark
  // turns yellow) and rolls back on failure. Server is idempotent both ways.
  const handleSavePress = useCallback(async (job: FeedJob) => {
    if (!requireRealUser('Sign up to save creations.')) return;
    const wasSaved = !!job.saved;
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, saved: !wasSaved } : j)));
    const ok = wasSaved ? await unsaveLook(job.id) : await saveLook(job.id);
    if (!ok) {
      // Roll back on failure.
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, saved: wasSaved } : j)));
      Alert.alert('Could not save', 'Please try again.');
    }
  }, []);

  // Memoized so its identity only changes when the comment deltas or one of
  // the (already stable) handlers change — letting React.memo on FeedCard
  // skip every row whose data is unchanged.
  const renderItem = useCallback(
    ({ item }: { item: FeedJob }) => (
      <FeedCard
        job={item}
        commentsCountOverride={(item.commentsCount ?? 0) + (commentDeltas[item.id] ?? 0)}
        onPhotoPress={openCarousel}
        onVideoPress={openVideo}
        onUsernamePress={handleUsernamePress}
        onLikePress={toggleLike}
        onSavePress={handleSavePress}
        onMorePress={handleMoreActions}
        onCommentsPress={handleCommentsPress}
      />
    ),
    [
      commentDeltas,
      openCarousel,
      openVideo,
      handleUsernamePress,
      toggleLike,
      handleMoreActions,
      handleCommentsPress,
    ],
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.textPrimary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <HeaderMenu
        title="Discover"
        leftComponent={<CreditDisplay onPress={() => navigation.navigate('Purchase')} />}
        rightComponent={
          <TouchableOpacity
            onPress={() =>
              navigation.navigate('Friends', { initialTab: 'following', openSearch: true })
            }
            style={styles.searchIconButton}
            accessibilityLabel="Search users"
          >
            <Ionicons name="search" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>
        }
      />
      {isGuest ? (
        <TouchableOpacity
          style={styles.guestBanner}
          onPress={() => navigation.navigate('Auth', { screen: 'Signup' })}
          activeOpacity={0.9}
        >
          <View style={styles.guestBannerTop}>
            <Text style={styles.guestBannerTitle}>
              {signupCreditsOffer
                ? `Join free — get ${signupCreditGrant} more credits`
                : 'Create your free account'}
            </Text>
            <View style={styles.guestBannerBtn}>
              <Text style={styles.guestBannerBtnText}>Sign Up</Text>
              <Ionicons name="arrow-forward" size={14} color={Colors.textPrimary} />
            </View>
          </View>
          <Text style={styles.guestBannerSub}>
            Save your creations, follow people, and buy credits — all on a free account.
          </Text>
          <View style={styles.guestBannerChips}>
            {['No credit card', 'No subscription', 'Free to join'].map((c) => (
              <View key={c} style={styles.guestChip}>
                <Ionicons name="checkmark-circle" size={13} color={Colors.gold} />
                <Text style={styles.guestChipText}>{c}</Text>
              </View>
            ))}
          </View>
        </TouchableOpacity>
      ) : null}
      {feedError ? (
        <View style={styles.errorBanner}>
          <Ionicons name="cloud-offline-outline" size={18} color={Colors.danger} />
          <Text style={styles.errorBannerText}>Couldn't load the feed.</Text>
          <TouchableOpacity onPress={() => fetchFeed(1, true)} hitSlop={10}>
            <Text style={styles.errorBannerAction}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <FlatList
        data={jobs}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListFooterComponent={hasMore ? <ActivityIndicator style={styles.footer} /> : null}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🎨</Text>
            <Text style={styles.emptyTitle}>No creations yet</Text>
            <Text style={styles.emptySubtitle}>
              Be the first to create something using the button below!
            </Text>
          </View>
        }
        contentContainerStyle={jobs.length === 0 ? styles.emptyContainer : undefined}
      />
      <FullScreenImageModal
        visible={fullScreenImages.length > 0}
        imageUrls={fullScreenImages}
        initialIndex={fullScreenInitialIndex}
        aiGenerated={fullScreenAi}
        labels={fullScreenLabels}
        originalBadges={fullScreenBadges}
        onClose={() => setFullScreenImages([])}
      />
      <ReportSheet
        visible={reportTarget !== null}
        targetType={reportTarget?.type ?? 'TRYON_JOB'}
        targetId={reportTarget?.id ?? ''}
        onClose={() => setReportTarget(null)}
      />
      <VideoPlayerModal
        visible={videoUri !== null}
        uri={videoUri}
        motionPrompt={videoPrompt}
        onClose={() => {
          setVideoUri(null);
          setVideoPrompt(null);
        }}
      />
    </View>
  );
}

const FeedCard = React.memo(function FeedCard({
  job,
  commentsCountOverride,
  onPhotoPress,
  onVideoPress,
  onUsernamePress,
  onLikePress,
  onSavePress,
  onMorePress,
  onCommentsPress,
}: {
  job: FeedJob;
  // Effective comment count to display on the card. Lets the parent layer in
  // unsynced state (e.g. comments posted on TryOnCommentsScreen since the
  // feed was last fetched).
  commentsCountOverride: number;
  // Handlers receive the job rather than being per-item closures, so the
  // parent can pass stable useCallback references — that's what lets
  // React.memo skip re-rendering cards whose data hasn't changed. onPhotoPress
  // also takes a slot identifying which carousel slide to anchor on.
  onPhotoPress: (job: FeedJob, slot: CarouselSlot) => void;
  onVideoPress: (job: FeedJob) => void;
  onUsernamePress: (job: FeedJob) => void;
  onLikePress: (job: FeedJob) => void;
  onSavePress: (job: FeedJob) => void;
  onMorePress: (job: FeedJob) => void;
  onCommentsPress: (job: FeedJob) => void;
}) {
  // Collect all available result images
  const resultImages: string[] = [];
  if (job.resultFullBodyUrl) resultImages.push(job.resultFullBodyUrl);
  if (job.resultMediumUrl) resultImages.push(job.resultMediumUrl);

  const displayUrl = resultImages[0];
  const isVideo = job.kind === 'VIDEO';
  // A video's poster is its source image (bodyPhotoUrl).
  const videoPoster = job.bodyPhotoUrl;
  const fullName = [job.user.firstName, job.user.lastName].filter(Boolean).join(' ');

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <TouchableOpacity
          style={styles.headerUserRow}
          onPress={() => onUsernamePress(job)}
          activeOpacity={0.7}
        >
          <View style={styles.avatar}>
            {job.user.avatarUrl ? (
              <RetryableImage uri={job.user.avatarUrl} style={styles.avatarImg} />
            ) : (
              <Text style={styles.avatarInitial}>{job.user.username[0].toUpperCase()}</Text>
            )}
          </View>
          <View>
            {fullName ? (
              <>
                <Text style={styles.displayName}>{fullName}</Text>
                <Text style={styles.username}>@{job.user.username}</Text>
              </>
            ) : (
              <Text style={styles.displayName}>@{job.user.username}</Text>
            )}
          </View>
        </TouchableOpacity>

        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.likeButton}
            onPress={() => onLikePress(job)}
            accessibilityLabel={job.liked ? 'Unlike' : 'Like'}
            hitSlop={10}
          >
            <Ionicons
              name={job.liked ? 'heart' : 'heart-outline'}
              size={24}
              color={job.liked ? Colors.danger : Colors.black}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.likeButton}
            onPress={() => onSavePress(job)}
            accessibilityLabel={job.saved ? 'Remove from your creations' : 'Save to your creations'}
            hitSlop={10}
          >
            <Ionicons
              name={job.saved ? 'bookmark' : 'bookmark-outline'}
              size={22}
              color={job.saved ? Colors.gold : Colors.black}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.likeButton}
            onPress={() => onMorePress(job)}
            accessibilityLabel="More actions"
            hitSlop={10}
          >
            <Ionicons name="ellipsis-horizontal" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      {isVideo ? (
        // Video card: full-width poster (the source image) with a ▶ overlay;
        // tapping plays the generated clip. No side-thumb column.
        <View style={styles.videoRow}>
          <TouchableOpacity
            style={styles.videoContainer}
            onPress={() => onVideoPress(job)}
            activeOpacity={0.9}
            accessibilityLabel="Play video"
          >
            {videoPoster ? (
              <RetryableImage uri={videoPoster} style={styles.videoPoster} resizeMode="cover" />
            ) : (
              <View style={[styles.videoPoster, styles.resultPlaceholder]} />
            )}
            <View style={styles.playOverlay}>
              <Ionicons name="play" size={34} color={Colors.white} />
            </View>
            <AiGeneratedBadge />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.resultsRow}>
          {displayUrl ? (
            <TouchableOpacity
              style={styles.resultImageContainer}
              // Result image opens the carousel at "Full Body" — falls back to
              // first available result if full-body is missing.
              onPress={() => onPhotoPress(job, job.resultFullBodyUrl ? 'full' : 'medium')}
              activeOpacity={0.9}
            >
              <RetryableImage uri={displayUrl} style={styles.resultImage} resizeMode="cover" />
              <AiGeneratedBadge />
              {resultImages.length > 1 && (
                <View style={styles.multiImageBadge}>
                  <Text style={styles.multiImageText}>1/{resultImages.length}</Text>
                </View>
              )}
            </TouchableOpacity>
          ) : (
            <View style={[styles.resultImage, styles.resultPlaceholder]}>
              <ActivityIndicator color={Colors.gray400} />
            </View>
          )}

          <View style={styles.thumbColumn}>
            {job.bodyPhotoUrl ? (
              <TouchableOpacity onPress={() => onPhotoPress(job, 'body')} activeOpacity={0.9}>
                <RetryableImage
                  uri={job.bodyPhotoUrl}
                  style={styles.sideThumb}
                  resizeMode="cover"
                />
              </TouchableOpacity>
            ) : (
              <View style={[styles.sideThumb, styles.sideThumbPlaceholder]} />
            )}
            {job.clothingPhoto1Url ? (
              <TouchableOpacity onPress={() => onPhotoPress(job, 'clothing')} activeOpacity={0.9}>
                <RetryableImage
                  uri={job.clothingPhoto1Url}
                  style={styles.sideThumb}
                  resizeMode="cover"
                />
              </TouchableOpacity>
            ) : (
              <View style={[styles.sideThumb, styles.sideThumbPlaceholder]} />
            )}
          </View>
        </View>
      )}

      {job.title ? (
        <Text style={styles.caption} numberOfLines={3}>
          {job.title}
        </Text>
      ) : null}

      {/* For an AI video, show the motion prompt the creator used to animate it. */}
      {isVideo && job.motionPrompt ? (
        <Text style={styles.motionPrompt} numberOfLines={3}>
          <Text style={styles.motionPromptLabel}>Prompt: </Text>
          {job.motionPrompt}
        </Text>
      ) : null}

      <View style={styles.cardFooter}>
        {(job.likesCount ?? 0) > 0 ? (
          <Text style={styles.likesCount}>
            {job.likesCount} {job.likesCount === 1 ? 'like' : 'likes'}
          </Text>
        ) : (
          <View />
        )}

        {/* Right-aligned actions: share + comments. Feed cards are public
            (COMPLETE, non-private) so they're always shareable. */}
        <View style={styles.footerRight}>
          <TouchableOpacity
            style={styles.shareButton}
            onPress={() => shareTryOn(job.id)}
            accessibilityLabel="Share this creation"
            hitSlop={10}
          >
            <Ionicons name="share-outline" size={20} color={Colors.textPrimary} />
          </TouchableOpacity>
          {/* Comments icon — always visible (even with zero comments) so a user
              can be the first to comment. */}
          <TouchableOpacity
            style={styles.commentsButton}
            onPress={() => onCommentsPress(job)}
            accessibilityLabel="Open comments"
            hitSlop={10}
          >
            <Ionicons name="chatbubble-outline" size={20} color={Colors.textPrimary} />
            {commentsCountOverride > 0 ? (
              <Text style={styles.commentsCount}>{commentsCountOverride}</Text>
            ) : null}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surface },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  searchIconButton: {
    padding: Spacing.sm,
    marginRight: Spacing.xs,
  },
  guestBanner: {
    backgroundColor: Colors.black,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    gap: Spacing.xs,
  },
  guestBannerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  guestBannerTitle: {
    flex: 1,
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightHeavy,
    color: Colors.white,
  },
  guestBannerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.accent,
    borderRadius: Radius.full,
    paddingVertical: 6,
    paddingHorizontal: Spacing.md,
  },
  guestBannerBtnText: {
    fontSize: Typography.fontSizeSM,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  guestBannerSub: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray200,
  },
  guestBannerChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  guestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  guestChipText: {
    fontSize: Typography.fontSizeXS,
    color: Colors.white,
    fontWeight: Typography.fontWeightMedium,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.gray100,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.gray200,
  },
  errorBannerText: {
    flex: 1,
    fontSize: Typography.fontSizeSM,
    color: Colors.gray800,
  },
  errorBannerAction: {
    fontSize: Typography.fontSizeSM,
    fontWeight: Typography.fontWeightSemiBold,
    color: Colors.textPrimary,
  },
  card: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.lg,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.gray200,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  headerUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flex: 1,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.gray200,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: {
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightBold,
    color: Colors.gray600,
  },
  displayName: {
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightSemiBold,
    color: Colors.textPrimary,
  },
  username: { fontSize: Typography.fontSizeSM, color: Colors.gray600 },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  likeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultsRow: { flexDirection: 'row', gap: Spacing.sm, padding: Spacing.md, paddingTop: 0 },
  videoRow: { padding: Spacing.md, paddingTop: 0 },
  videoContainer: {
    position: 'relative',
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: Colors.gray100,
  },
  videoPoster: { width: '100%', aspectRatio: 3 / 4 },
  playOverlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 64,
    height: 64,
    marginLeft: -32,
    marginTop: -32,
    borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultImageContainer: {
    flex: 1,
    position: 'relative',
  },
  resultImage: {
    flex: 1,
    aspectRatio: 3 / 4,
    borderRadius: Radius.md,
    backgroundColor: Colors.gray100,
  },
  resultPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  multiImageBadge: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.sm,
  },
  multiImageText: {
    color: Colors.white,
    fontSize: Typography.fontSizeXS,
    fontWeight: Typography.fontWeightSemiBold,
  },
  thumbColumn: {
    width: 90,
    gap: Spacing.sm,
    justifyContent: 'flex-start',
  },
  sideThumb: {
    width: 90,
    aspectRatio: 3 / 4,
    borderRadius: Radius.md,
    backgroundColor: Colors.gray100,
  },
  sideThumbPlaceholder: {
    backgroundColor: Colors.gray100,
  },
  caption: {
    fontSize: Typography.fontSizeSM,
    color: Colors.textPrimary,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
  },
  motionPrompt: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray600,
    fontStyle: 'italic',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xs,
  },
  motionPromptLabel: {
    color: Colors.gray400,
    fontStyle: 'normal',
    fontWeight: '600',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    paddingTop: 4,
    minHeight: 36,
  },
  likesCount: {
    fontSize: Typography.fontSizeSM,
    fontWeight: Typography.fontWeightSemiBold,
    color: Colors.textPrimary,
  },
  footerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  shareButton: {
    paddingHorizontal: Spacing.xs,
    paddingVertical: 4,
  },
  commentsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 4,
  },
  commentsCount: {
    fontSize: Typography.fontSizeSM,
    fontWeight: Typography.fontWeightSemiBold,
    color: Colors.textPrimary,
  },
  footer: { padding: Spacing.lg },
  emptyContainer: { flex: 1 },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xxl,
    marginTop: 80,
  },
  emptyIcon: { fontSize: 48, marginBottom: Spacing.md },
  emptyTitle: {
    fontSize: Typography.fontSizeXL,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  emptySubtitle: {
    fontSize: Typography.fontSizeMD,
    color: Colors.gray600,
    textAlign: 'center',
    lineHeight: 22,
  },
});
