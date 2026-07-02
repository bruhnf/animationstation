import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Alert,
  ActionSheetIOS,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import api from '../config/api';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { RootStackParams } from '../navigation';
import FullScreenImageModal, { OriginalImageBadge } from '../components/FullScreenImageModal';
import { buildTryOnCarousel } from '../utils/tryonCarousel';
import { requireRealUser } from '../utils/guestGate';
import ReportSheet, { ReportTargetType } from '../components/ReportSheet';
import RetryableImage from '../components/RetryableImage';

type Nav = NativeStackNavigationProp<RootStackParams, 'PublicProfile'>;
type Route = RouteProp<RootStackParams, 'PublicProfile'>;

interface PublicProfileData {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  bio?: string;
  avatarUrl?: string;
  tryOnCount: number;
  followingCount: number;
  followersCount: number;
  likesCount: number;
  createdAt: string;
  isFollowing: boolean;
  isSelf: boolean;
  viewerHasBlocked?: boolean;
  jobs: {
    id: string;
    resultFullBodyUrl?: string;
    resultMediumUrl?: string;
    clothingPhoto1Url?: string;
    bodyPhotoUrl?: string;
    likesCount: number;
    createdAt: string;
  }[];
}

export default function PublicProfileScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { username } = route.params;

  const [profile, setProfile] = useState<PublicProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [fullScreenImages, setFullScreenImages] = useState<string[]>([]);
  const [fullScreenAi, setFullScreenAi] = useState<boolean[]>([]);
  const [fullScreenLabels, setFullScreenLabels] = useState<string[]>([]);
  const [fullScreenBadges, setFullScreenBadges] = useState<(OriginalImageBadge | null)[]>([]);
  const [fullScreenIndex, setFullScreenIndex] = useState(0);
  const [reportTarget, setReportTarget] = useState<{ type: ReportTargetType; id: string } | null>(
    null,
  );
  const [blockBusy, setBlockBusy] = useState(false);

  async function handleBlock() {
    if (!profile || profile.isSelf) return;
    Alert.alert(
      `Block @${profile.username}?`,
      'You will no longer see their posts and they will not be able to see yours. You can unblock from Settings.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            setBlockBusy(true);
            try {
              await api.post(`/users/${profile.id}/block`);
              navigation.goBack();
            } catch {
              Alert.alert('Error', 'Could not block this user. Please try again.');
            } finally {
              setBlockBusy(false);
            }
          },
        },
      ],
    );
  }

  async function handleUnblock() {
    if (!profile) return;
    setBlockBusy(true);
    try {
      await api.delete(`/users/${profile.id}/block`);
      await load();
    } catch {
      Alert.alert('Error', 'Could not unblock this user.');
    } finally {
      setBlockBusy(false);
    }
  }

  function showActionSheet() {
    if (!profile || profile.isSelf) return;
    // Report / block / unblock are all account-bound — prompt a guest to sign up.
    if (!requireRealUser('Sign up to report or block users.')) return;
    const options = profile.viewerHasBlocked
      ? ['Unblock User', 'Cancel']
      : ['Report User', 'Block User', 'Cancel'];
    const cancelButtonIndex = options.length - 1;
    const destructiveButtonIndex = profile.viewerHasBlocked ? -1 : 1;

    const handleSelection = (index: number) => {
      if (profile.viewerHasBlocked) {
        if (index === 0) handleUnblock();
        return;
      }
      if (index === 0) setReportTarget({ type: 'USER', id: profile.id });
      else if (index === 1) handleBlock();
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex, destructiveButtonIndex },
        handleSelection,
      );
    } else {
      Alert.alert(
        'Actions',
        '',
        options
          .slice(0, -1)
          .map((label, i) => ({
            text: label,
            style: i === destructiveButtonIndex ? ('destructive' as const) : ('default' as const),
            onPress: () => handleSelection(i),
          }))
          .concat([{ text: 'Cancel', style: 'default' as const, onPress: () => {} }]),
      );
    }
  }

  async function load() {
    try {
      const { data } = await api.get<PublicProfileData>(`/profile/${encodeURIComponent(username)}`);
      setProfile(data);
    } catch {
      Alert.alert('Error', 'Could not load profile.');
      navigation.goBack();
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, [username]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [username]);

  async function toggleFollow() {
    if (!profile || profile.isSelf || followBusy) return;
    // Following is account-bound — prompt a guest to sign up (before the
    // optimistic update so the button doesn't flip then revert).
    if (!requireRealUser('Sign up to follow people.')) return;
    setFollowBusy(true);
    // Optimistic update
    const prevFollowing = profile.isFollowing;
    setProfile({
      ...profile,
      isFollowing: !prevFollowing,
      followersCount: profile.followersCount + (prevFollowing ? -1 : 1),
    });
    try {
      if (prevFollowing) {
        await api.delete(`/friends/unfollow/${profile.id}`);
      } else {
        await api.post(`/friends/follow/${profile.id}`);
      }
    } catch {
      // Roll back
      setProfile((p) =>
        p
          ? {
              ...p,
              isFollowing: prevFollowing,
              followersCount: p.followersCount + (prevFollowing ? 1 : -1),
            }
          : p,
      );
      Alert.alert('Error', 'Could not update follow status.');
    } finally {
      setFollowBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={Colors.textPrimary} />
      </View>
    );
  }

  if (!profile) return null;

  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ');

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={28} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          @{profile.username}
        </Text>
        {profile.isSelf ? (
          <View style={styles.backButton} />
        ) : (
          <TouchableOpacity
            onPress={showActionSheet}
            style={styles.backButton}
            accessibilityLabel="More actions"
          >
            <Ionicons name="ellipsis-horizontal" size={24} color={Colors.textPrimary} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.profileSection}>
          <View style={styles.avatar}>
            {profile.avatarUrl ? (
              <RetryableImage uri={profile.avatarUrl} style={styles.avatarImg} />
            ) : (
              <Text style={styles.avatarInitial}>{profile.username[0].toUpperCase()}</Text>
            )}
          </View>
          <View style={styles.userInfo}>
            {fullName ? <Text style={styles.fullName}>{fullName}</Text> : null}
            <Text style={styles.username}>@{profile.username}</Text>
            {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{profile.tryOnCount}</Text>
            <Text style={styles.statLabel}>Creations</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{profile.followersCount}</Text>
            <Text style={styles.statLabel}>Followers</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{profile.followingCount}</Text>
            <Text style={styles.statLabel}>Following</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{profile.likesCount}</Text>
            <Text style={styles.statLabel}>Likes</Text>
          </View>
        </View>

        {!profile.isSelf && (
          <TouchableOpacity
            style={[styles.followBtn, profile.isFollowing && styles.followingBtn]}
            onPress={toggleFollow}
            disabled={followBusy}
          >
            {followBusy ? (
              <ActivityIndicator color={profile.isFollowing ? Colors.black : Colors.white} />
            ) : (
              <Text style={[styles.followBtnText, profile.isFollowing && styles.followingBtnText]}>
                {profile.isFollowing ? 'Following' : 'Follow'}
              </Text>
            )}
          </TouchableOpacity>
        )}

        {profile.viewerHasBlocked ? (
          <View style={styles.blockedNotice}>
            <Ionicons name="ban-outline" size={32} color={Colors.gray400} />
            <Text style={styles.blockedTitle}>You blocked this user</Text>
            <Text style={styles.blockedSubtitle}>
              Their content is hidden. Unblock to see their profile.
            </Text>
            <TouchableOpacity
              style={styles.unblockButton}
              onPress={handleUnblock}
              disabled={blockBusy}
            >
              {blockBusy ? (
                <ActivityIndicator color={Colors.white} />
              ) : (
                <Text style={styles.unblockButtonText}>Unblock</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.gridSection}>
            <Text style={styles.sectionTitle}>Public Creations</Text>
            {profile.jobs.length === 0 ? (
              <Text style={styles.emptyText}>No public creations.</Text>
            ) : (
              <FlatList
                data={profile.jobs}
                numColumns={3}
                scrollEnabled={false}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => {
                  const slides = buildTryOnCarousel(item);
                  if (slides.length === 0) return <View style={styles.gridItem} />;
                  const thumbUrl = slides[0].url;
                  return (
                    <TouchableOpacity
                      style={styles.gridItem}
                      onPress={() => {
                        setFullScreenImages(slides.map((s) => s.url));
                        setFullScreenAi(slides.map((s) => s.aiGenerated));
                        setFullScreenLabels(slides.map((s) => s.label));
                        setFullScreenBadges(slides.map((s) => s.badge));
                        setFullScreenIndex(0);
                      }}
                      activeOpacity={0.85}
                    >
                      <RetryableImage uri={thumbUrl} style={styles.gridImage} resizeMode="cover" />
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </View>
        )}
      </ScrollView>

      <FullScreenImageModal
        visible={fullScreenImages.length > 0}
        imageUrls={fullScreenImages}
        initialIndex={fullScreenIndex}
        aiGenerated={fullScreenAi}
        labels={fullScreenLabels}
        originalBadges={fullScreenBadges}
        onClose={() => setFullScreenImages([])}
      />
      <ReportSheet
        visible={reportTarget !== null}
        targetType={reportTarget?.type ?? 'USER'}
        targetId={reportTarget?.id ?? ''}
        onClose={() => setReportTarget(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surface },
  centered: { justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.gray200,
  },
  backButton: { width: 44, padding: Spacing.xs },
  headerTitle: {
    flex: 1,
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  profileSection: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.md,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Colors.gray200,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: Spacing.md,
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: {
    fontSize: 40,
    fontWeight: Typography.fontWeightBold,
    color: Colors.gray600,
  },
  userInfo: { alignItems: 'center' },
  fullName: {
    fontSize: Typography.fontSizeXL,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  username: {
    fontSize: Typography.fontSizeMD,
    color: Colors.gray600,
    marginTop: 2,
  },
  bio: {
    fontSize: Typography.fontSizeMD,
    color: Colors.gray800,
    textAlign: 'center',
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    lineHeight: 22,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: Spacing.md,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: Colors.gray200,
    marginHorizontal: Spacing.md,
  },
  stat: { alignItems: 'center' },
  statValue: {
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  statLabel: { fontSize: Typography.fontSizeXS, color: Colors.gray600, marginTop: 2 },
  followBtn: {
    marginHorizontal: Spacing.md,
    marginTop: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
    backgroundColor: Colors.accent,
    alignItems: 'center',
  },
  followingBtn: {
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.gray200,
  },
  followBtnText: {
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  followingBtnText: { color: Colors.textPrimary },
  blockedNotice: {
    padding: Spacing.xl,
    marginTop: Spacing.md,
    borderTopWidth: 1,
    borderColor: Colors.gray200,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  blockedTitle: {
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  blockedSubtitle: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray600,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  unblockButton: {
    backgroundColor: Colors.black,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
  },
  unblockButtonText: {
    color: Colors.white,
    fontWeight: Typography.fontWeightBold,
  },
  gridSection: {
    padding: Spacing.md,
    marginTop: Spacing.md,
    borderTopWidth: 1,
    borderColor: Colors.gray200,
  },
  sectionTitle: {
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  emptyText: {
    fontSize: Typography.fontSizeMD,
    color: Colors.gray400,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: Spacing.lg,
  },
  gridItem: { flex: 1 / 3, aspectRatio: 1, padding: 1 },
  gridImage: { width: '100%', height: '100%', borderRadius: 4 },
});
