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
  LayoutAnimation,
  UIManager,
  ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import api from '../config/api';
import { useUserStore } from '../store/useUserStore';
import { useConfigStore } from '../store/useConfigStore';
import { shareCreation } from '../utils/share';
import { saveLook, unsaveLook } from '../utils/looks';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { RootStackParams, MainTabParams } from '../navigation';
import CreditDisplay from '../components/CreditDisplay';
import HeaderMenu from '../components/HeaderMenu';
import ReportSheet, { ReportTargetType } from '../components/ReportSheet';
import FeedPost, { FeedJob } from '../components/FeedPost';
import { useCommentDeltas } from '../store/useCommentDeltas';
import { requireRealUser } from '../utils/guestGate';

type Nav = NativeStackNavigationProp<RootStackParams>;

// Enable smooth expand/collapse of the pulled-back comment view on Android
// (iOS supports LayoutAnimation out of the box).
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Module-level so its identity is stable across renders.
const keyExtractor = (item: FeedJob) => item.id;

// A post counts as the "active" (on-screen) one when ≥80% visible — that post's
// video autoplays; the others pause.
const viewabilityConfig = { itemVisiblePercentThreshold: 80 };

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  // Same underlying navigation object, typed as the bottom-tab nav so we can
  // subscribe to 'tabPress'.
  const tabNavigation = useNavigation<BottomTabNavigationProp<MainTabParams, 'Home'>>();
  const { user, refreshUser } = useUserStore();
  const isGuest = user?.isGuest === true;
  const { signupCreditGrant, signupCreditsOffer } = useConfigStore();
  const [jobs, setJobs] = useState<FeedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [feedError, setFeedError] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ type: ReportTargetType; id: string } | null>(
    null,
  );
  const commentDeltas = useCommentDeltas((s) => s.deltas);
  const clearCommentDeltas = useCommentDeltas((s) => s.clear);

  // Measured height of one full-screen page (the space between the top title bar
  // and the bottom tab bar). Each post fills exactly this so paging snaps
  // one-post-per-swipe.
  const [pageHeight, setPageHeight] = useState(0);
  // The on-screen post (drives video autoplay) and the post currently pulled
  // back to show comments (null = all full screen, the default).
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = useCallback((id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedId((cur) => (cur === id ? null : id));
  }, []);

  // Track which post is on screen. Moving to a different post also collapses any
  // pulled-back comment view, so the feed always returns to full screen.
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0]?.item as FeedJob | undefined;
    if (!first) return;
    setActiveId(first.id);
    setExpandedId((cur) => (cur && cur !== first.id ? null : cur));
  }).current;

  // Show platform-native action sheet on iOS, basic Alert on Android, with
  // Report and Block options. Required by App Store Review Guideline 1.2.
  const handleMoreActions = useCallback(
    (job: FeedJob) => {
      // Post actions are account-bound — prompt a guest to sign up.
      if (!requireRealUser('Sign up for post options.')) return;
      const isOwnPost = job.userId === user?.id;

      // Own post → owner actions (Make Private / Share / Delete).
      if (isOwnPost) {
        const privacyLabel = job.isPrivate ? 'Make Public' : 'Make Private';

        const togglePrivacy = async () => {
          const newVal = !job.isPrivate;
          try {
            await api.patch(`/creations/${job.id}/privacy`, { isPrivate: newVal });
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
                    await api.post('/creations/bulk-delete', { jobIds: [job.id] });
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
          else if (index === 1) void shareCreation(job.id);
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
        if (index === 0) setReportTarget({ type: 'CREATION', id: job.id });
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
      if (refresh) clearCommentDeltas();
    } catch {
      setFeedError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    fetchFeed(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh the feed only when the Home tab is tapped while already focused.
  useEffect(() => {
    const unsubscribe = tabNavigation.addListener('tabPress', () => {
      if (!tabNavigation.isFocused()) return;
      setRefreshing(true);
      fetchFeed(1, true);
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabNavigation]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refreshUser();
    fetchFeed(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadingMoreRef = useRef(false);
  const loadMore = () => {
    if (!hasMore || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    fetchFeed(page + 1).finally(() => {
      loadingMoreRef.current = false;
    });
  };

  const toggleLike = useCallback(
    async (job: FeedJob) => {
      if (!requireRealUser('Sign up to like creations.')) return;
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

  const handleSavePress = useCallback(async (job: FeedJob) => {
    if (!requireRealUser('Sign up to save creations.')) return;
    const wasSaved = !!job.saved;
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, saved: !wasSaved } : j)));
    const ok = wasSaved ? await unsaveLook(job.id) : await saveLook(job.id);
    if (!ok) {
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, saved: wasSaved } : j)));
      Alert.alert('Could not save', 'Please try again.');
    }
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: FeedJob }) => (
      <FeedPost
        job={item}
        height={pageHeight}
        isActive={item.id === activeId}
        expanded={item.id === expandedId}
        commentsCount={(item.commentsCount ?? 0) + (commentDeltas[item.id] ?? 0)}
        onToggleExpand={() => toggleExpand(item.id)}
        onUsernamePress={() => handleUsernamePress(item)}
        onLikePress={() => toggleLike(item)}
        onSavePress={() => handleSavePress(item)}
        onSharePress={() => shareCreation(item.id)}
        onMorePress={() => handleMoreActions(item)}
      />
    ),
    [
      pageHeight,
      activeId,
      expandedId,
      commentDeltas,
      toggleExpand,
      handleUsernamePress,
      toggleLike,
      handleSavePress,
      handleMoreActions,
    ],
  );

  const getItemLayout = useCallback(
    (_: ArrayLike<FeedJob> | null | undefined, index: number) => ({
      length: pageHeight,
      offset: pageHeight * index,
      index,
    }),
    [pageHeight],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <HeaderMenu
        title="Discover"
        leftComponent={<CreditDisplay onPress={() => navigation.navigate('Purchase')} />}
        rightComponent={
          <TouchableOpacity
            onPress={() =>
              navigation.navigate('Main', {
                screen: 'Friends',
                params: { initialTab: 'following', openSearch: true },
              })
            }
            style={styles.searchIconButton}
            accessibilityLabel="Search users"
          >
            <Ionicons name="search" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>
        }
      />

      {/* Compact guest sign-up strip — part of the top chrome so it doesn't
          overlap the full-screen posts. */}
      {isGuest ? (
        <TouchableOpacity
          style={styles.guestStrip}
          onPress={() => navigation.navigate('Auth', { screen: 'Signup' })}
          activeOpacity={0.85}
        >
          <Ionicons name="sparkles" size={14} color={Colors.gold} />
          <Text style={styles.guestStripText} numberOfLines={1}>
            {signupCreditsOffer
              ? `Join free — get ${signupCreditGrant} more credits`
              : 'Create your free account'}
          </Text>
          <View style={styles.guestStripBtn}>
            <Text style={styles.guestStripBtnText}>Sign Up</Text>
            <Ionicons name="arrow-forward" size={12} color={Colors.textPrimary} />
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

      {/* Measure the page area so each post fills exactly the space between the
          title bar and the tab bar. */}
      <View style={styles.feedArea} onLayout={(e) => setPageHeight(e.nativeEvent.layout.height)}>
        {loading || pageHeight === 0 ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={Colors.textPrimary} />
          </View>
        ) : jobs.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🎨</Text>
            <Text style={styles.emptyTitle}>No creations yet</Text>
            <Text style={styles.emptySubtitle}>
              Be the first to create something using the button below!
            </Text>
          </View>
        ) : (
          <FlatList
            data={jobs}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            getItemLayout={getItemLayout}
            pagingEnabled
            showsVerticalScrollIndicator={false}
            // Lock paging while a post is pulled back so the comment list scrolls
            // freely; the comment button collapses it and re-enables paging.
            scrollEnabled={expandedId === null}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            onEndReached={loadMore}
            onEndReachedThreshold={0.6}
            initialNumToRender={2}
            windowSize={3}
            maxToRenderPerBatch={3}
          />
        )}
      </View>

      <ReportSheet
        visible={reportTarget !== null}
        targetType={reportTarget?.type ?? 'CREATION'}
        targetId={reportTarget?.id ?? ''}
        onClose={() => setReportTarget(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.black },
  feedArea: { flex: 1, backgroundColor: Colors.black },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  searchIconButton: { padding: Spacing.sm, marginRight: Spacing.xs },
  guestStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  guestStripText: {
    flex: 1,
    fontSize: Typography.fontSizeSM,
    fontWeight: Typography.fontWeightSemiBold,
    color: Colors.textPrimary,
  },
  guestStripBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.gold,
    borderRadius: Radius.full,
    paddingVertical: 5,
    paddingHorizontal: Spacing.sm,
  },
  guestStripBtnText: {
    fontSize: Typography.fontSizeXS,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  errorBannerText: { flex: 1, fontSize: Typography.fontSizeSM, color: Colors.textPrimary },
  errorBannerAction: {
    fontSize: Typography.fontSizeSM,
    fontWeight: Typography.fontWeightBold,
    color: Colors.accent,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xxl,
    gap: Spacing.sm,
  },
  emptyIcon: { fontSize: 48 },
  emptyTitle: {
    fontSize: Typography.fontSizeXL,
    fontWeight: Typography.fontWeightBold,
    color: Colors.white,
  },
  emptySubtitle: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray400,
    textAlign: 'center',
  },
});
