import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Modal,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import api from '../config/api';
import { useUserStore } from '../store/useUserStore';
import { TryOnJob } from '../types';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { RootStackParams } from '../navigation';
import TryOnDetailModal from '../components/TryOnDetailModal';
import VideoPlayerModal from '../components/VideoPlayerModal';
import RetryableImage from '../components/RetryableImage';
import CreditDisplay from '../components/CreditDisplay';
import CreationsGrid, { CreationCounts } from '../components/CreationsGrid';
import { processImageForUpload, isLowResolution, confirmLowResolution } from '../utils/imageUtils';

type Nav = NativeStackNavigationProp<RootStackParams>;

// Keep in sync with REAL_USER_MENU_ITEMS in components/HeaderMenu.tsx —
// ProfileScreen renders its own copy of the dropdown.
const MENU_ITEMS = [
  { key: 'edit', label: 'Edit Profile' },
  { key: 'video', label: 'Animate a Photo (Video)' },
  { key: 'design', label: 'Generate an Image' },
  { key: 'closet', label: 'My Library' },
  { key: 'saved', label: 'Saved Creations' },
  { key: 'compare', label: 'Compare Creations' },
  { key: 'settings', label: 'Settings' },
  { key: 'logout', label: 'Log Out', danger: true },
];

// Mirrors backend TRYON_STORAGE_LIMIT in tryonController.ts. Kept in sync by
// hand — if the cap changes server-side, update both. Used for the "X/500
// sessions used" hint and threshold-based warning colors.
const TRYON_STORAGE_LIMIT = 500;

// One tile in the Creator Stats panel: a gold icon, big white count, gold label.
function CreatorStat({
  icon,
  value,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: number;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.creatorStat} onPress={onPress} activeOpacity={0.8}>
      <Ionicons name={icon} size={22} color={Colors.gold} />
      <Text style={styles.creatorValue}>{value}</Text>
      <Text style={styles.creatorLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { user, updateUser, logout, refreshUser } = useUserStore();
  const [menuVisible, setMenuVisible] = useState(false);
  // Live counts of the unified creations grid (images + videos + total), fed by
  // CreationsGrid so the creator-stat tiles stay accurate.
  const [creationCounts, setCreationCounts] = useState<CreationCounts>({
    images: 0,
    videos: 0,
    total: 0,
  });
  // Bumped on pull-to-refresh to force the embedded CreationsGrid to reload.
  const [reloadToken, setReloadToken] = useState(0);
  const [uploading, setUploading] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // The creations grid (list, selection, delete, detail modals) now lives in the
  // shared <CreationsGrid> below — it fetches + merges /tryon/history and /closet
  // and re-fetches on focus. Here we only refresh the header (credits/stats).
  useFocusEffect(
    useCallback(() => {
      refreshUser();
    }, []),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshUser();
    setReloadToken((t) => t + 1); // force the embedded grid to reload too
    setRefreshing(false);
  }, []);

  async function handlePhotoUpload(
    field: 'avatar' | 'fullBody' | 'medium',
    endpoint: string,
    aspect: [number, number],
  ) {
    // No permission request here — launchImageLibraryAsync uses
    // PHPickerViewController on iOS 14+, which runs out-of-process and only
    // returns photos the user explicitly selects. No library-wide access is
    // granted to the app, so no Photos permission is needed. Asking for one
    // would be unnecessary friction (and over-collection per Apple's HIG).
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: field === 'avatar',
      aspect: field === 'avatar' ? aspect : undefined,
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;

    // Body photos set the quality ceiling for every future try-on, so warn on
    // low-res sources up front. Avatars are display-only — never AI input.
    if (
      field !== 'avatar' &&
      isLowResolution(result.assets[0].width, result.assets[0].height) &&
      !(await confirmLowResolution('body'))
    ) {
      return;
    }

    setUploading(field);
    try {
      // Convert HEIF/HEIC to JPEG for server compatibility
      const processedImage = await processImageForUpload(result.assets[0].uri, {
        maxWidth: field === 'avatar' ? 512 : 1536,
        maxHeight: field === 'avatar' ? 512 : 2048,
        compress: 0.85,
      });

      const formData = new FormData();
      formData.append('photo', processedImage as unknown as Blob);
      const { data } = await api.post<{ url: string }>(endpoint, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (field === 'avatar') updateUser({ avatarUrl: data.url });
      if (field === 'fullBody') updateUser({ fullBodyUrl: data.url });
      if (field === 'medium') updateUser({ mediumBodyUrl: data.url });
    } catch {
      Alert.alert('Upload Failed', 'Could not upload photo. Please try again.');
    } finally {
      setUploading(null);
    }
  }

  async function handlePhotoDelete(field: 'avatar' | 'fullBody' | 'medium', endpoint: string) {
    Alert.alert('Remove Photo', 'Are you sure you want to remove this photo?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(endpoint);
            if (field === 'avatar') updateUser({ avatarUrl: undefined });
            if (field === 'fullBody') updateUser({ fullBodyUrl: undefined });
            if (field === 'medium') updateUser({ mediumBodyUrl: undefined });
          } catch {
            Alert.alert('Error', 'Could not remove photo.');
          }
        },
      },
    ]);
  }

  function handleMenuAction(key: string) {
    setMenuVisible(false);
    if (key === 'edit') navigation.navigate('EditProfile');
    if (key === 'video') navigation.navigate('Video');
    if (key === 'design') navigation.navigate('Design');
    if (key === 'closet') navigation.navigate('Closet', undefined);
    if (key === 'saved') navigation.navigate('SavedLooks');
    if (key === 'compare') navigation.navigate('Compare');
    if (key === 'settings') navigation.navigate('Settings');
    if (key === 'logout') {
      Alert.alert('Log Out', 'Are you sure you want to log out?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log Out', style: 'destructive', onPress: logout },
      ]);
    }
  }

  if (!user) return null;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <CreditDisplay onPress={() => navigation.navigate('Purchase')} />
        </View>
        <Text style={styles.headerTitle}>User Profile</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity onPress={() => setMenuVisible(true)} style={styles.menuButton}>
            <Ionicons name="ellipsis-vertical" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Avatar Row with Subscription */}
        <View style={styles.avatarSection}>
          {/* Empty spacer balances the Tier badge so the avatar stays centered.
              (Creation counts now live in the Creator Stats panel below.) */}
          <View style={styles.avatarSideItem} />

          {/* Avatar - Center */}
          <View style={styles.avatarCenter}>
            <TouchableOpacity
              style={styles.avatarWrap}
              onPress={() => handlePhotoUpload('avatar', '/upload/avatar', [1, 1])}
              onLongPress={() => user.avatarUrl && handlePhotoDelete('avatar', '/upload/avatar')}
            >
              {uploading === 'avatar' ? (
                <ActivityIndicator color={Colors.gray400} />
              ) : user.avatarUrl ? (
                <RetryableImage uri={user.avatarUrl} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarPlaceholder}>{user.username[0].toUpperCase()}</Text>
              )}
              <View style={styles.avatarEditBadge}>
                <Ionicons name="add" size={18} color={Colors.white} />
              </View>
            </TouchableOpacity>

            <View style={styles.userInfo}>
              {(user.firstName || user.lastName) && (
                <Text style={styles.fullName}>
                  {[user.firstName, user.lastName].filter(Boolean).join(' ')}
                </Text>
              )}
              <Text style={styles.username}>@{user.username}</Text>
            </View>
          </View>

          {/* Tier - Right */}
          <TouchableOpacity
            style={styles.avatarSideItem}
            onPress={() => navigation.navigate('Purchase')}
          >
            <View
              style={[
                styles.subscriptionBadge,
                user.tier !== 'FREE' ? styles.subscriptionActive : styles.subscriptionInactive,
              ]}
            >
              <Ionicons
                name={
                  user.tier === 'PREMIUM'
                    ? 'star'
                    : user.tier === 'BASIC'
                      ? 'checkmark-circle'
                      : 'close-circle'
                }
                size={18}
                color={user.tier !== 'FREE' ? Colors.success : Colors.gray400}
              />
            </View>
            <Text style={styles.avatarSideLabel}>
              {user.tier === 'PREMIUM' ? 'Premium' : user.tier === 'BASIC' ? 'Basic' : 'Free'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Creator Stats — flashy gold-on-black panel (Try-Ons / Videos /
            Designs). Deliberately a big bordered panel, not a small pill, so it
            never reads as the credit pill. Each tile taps through to make more. */}
        <View style={styles.creatorStats}>
          <CreatorStat
            icon="image"
            value={creationCounts.images}
            label="Images"
            onPress={() => navigation.navigate('TryOn')}
          />
          <View style={styles.creatorDivider} />
          <CreatorStat
            icon="videocam"
            value={creationCounts.videos}
            label="Videos"
            onPress={() => navigation.navigate('Video')}
          />
          <View style={styles.creatorDivider} />
          <CreatorStat
            icon="albums"
            value={creationCounts.total}
            label="Library"
            onPress={() => navigation.navigate('Closet', undefined)}
          />
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <TouchableOpacity
            style={styles.stat}
            onPress={() => navigation.navigate('Friends', { initialTab: 'following' })}
          >
            <Text style={styles.statValue}>{user.followingCount}</Text>
            <Text style={styles.statLabel}>Following</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.stat}
            onPress={() => navigation.navigate('Friends', { initialTab: 'followers' })}
          >
            <Text style={styles.statValue}>{user.followersCount}</Text>
            <Text style={styles.statLabel}>Followers</Text>
          </TouchableOpacity>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{user.likesCount}</Text>
            <Text style={styles.statLabel}>Likes</Text>
          </View>
        </View>

        {user.bio ? <Text style={styles.bio}>{user.bio}</Text> : null}

        {/* Creation History — the user's generated assets are the only content
            below the profile header (the old TryOn body-photo uploads are gone). */}
        <View style={styles.section}>
          {/* Unified creations — all generated images + videos (merged from
              /tryon/history + /closet), with per-item view/detail/delete. The
              grid, selection, and detail/video/closet modals all live inside
              CreationsGrid so the Library tab and this screen stay identical. */}
          <CreationsGrid
            title="My Creations"
            scrollEnabled={false}
            contentPaddingBottom={0}
            onCountChange={setCreationCounts}
            reloadToken={reloadToken}
          />
        </View>
      </ScrollView>

      {/* Hamburger dropdown menu */}
      <Modal
        transparent
        visible={menuVisible}
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <TouchableOpacity style={styles.modalOverlay} onPress={() => setMenuVisible(false)}>
          <View style={styles.menuSheet}>
            {MENU_ITEMS.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={styles.menuItem}
                onPress={() => handleMenuAction(item.key)}
              >
                <Text style={[styles.menuItemText, item.danger && styles.menuItemDanger]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.gray200,
  },
  headerTitle: {
    fontSize: Typography.fontSizeXL,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  headerLeft: {
    flex: 1,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerRight: {
    flex: 1,
    alignItems: 'flex-end',
  },
  menuButton: { padding: Spacing.sm },
  avatarSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.md,
  },
  avatarSideItem: {
    alignItems: 'center',
    width: 70,
    paddingTop: Spacing.md,
  },
  creatorStats: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.black,
    borderWidth: 1.5,
    borderColor: Colors.gold,
    borderRadius: Radius.lg,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    paddingVertical: Spacing.md,
  },
  creatorStat: { flex: 1, alignItems: 'center', gap: 3 },
  creatorValue: {
    color: Colors.white,
    fontSize: Typography.fontSizeXXL,
    fontWeight: Typography.fontWeightHeavy,
  },
  creatorLabel: {
    color: Colors.gold,
    fontSize: Typography.fontSizeXS,
    fontWeight: Typography.fontWeightSemiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  creatorDivider: { width: 1, height: 38, backgroundColor: 'rgba(255,255,255,0.15)' },
  creditsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.black,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: Radius.full,
    gap: 4,
  },
  creditsText: {
    color: Colors.white,
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightBold,
  },
  subscriptionBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subscriptionActive: {
    backgroundColor: 'rgba(52,211,153,0.12)',
  },
  subscriptionInactive: {
    backgroundColor: Colors.gray100,
  },
  avatarSideLabel: {
    fontSize: Typography.fontSizeXS,
    color: Colors.gray600,
    marginTop: 4,
  },
  avatarCenter: {
    alignItems: 'center',
  },
  avatarWrap: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: Colors.gray200,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
    position: 'relative',
  },
  avatarImage: { width: '100%', height: '100%', borderRadius: 45 },
  avatarPlaceholder: {
    fontSize: 36,
    fontWeight: Typography.fontWeightBold,
    color: Colors.gray600,
  },
  avatarEditBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.black,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.white,
  },
  userInfo: { alignItems: 'center' },
  fullName: {
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  username: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray600,
    marginTop: 2,
  },
  handle: { fontSize: Typography.fontSizeSM, color: Colors.gray600, marginTop: 2 },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: Spacing.lg,
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
  bio: {
    fontSize: Typography.fontSizeMD,
    color: Colors.gray800,
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    lineHeight: 22,
  },
  // "Design Your Own Outfit" banner — mirrors styles.closetCard on TryOnScreen.
  // Adds horizontal margin (the TryOn version sits inside a padded container;
  // here it spans the unpadded profile body).
  closetCard: {
    backgroundColor: Colors.black,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.gold,
    padding: Spacing.md,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
    position: 'relative',
    overflow: 'hidden',
  },
  closetBadge: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    backgroundColor: Colors.gold,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  closetBadgeText: {
    fontSize: Typography.fontSizeXS,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    letterSpacing: 0.5,
  },
  closetCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingRight: 52, // clear the NEW badge
  },
  closetEmojiCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closetEmoji: { fontSize: 28 },
  closetTextCol: { flex: 1 },
  closetTitle: {
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightBold,
    color: Colors.white,
    marginBottom: 4,
  },
  closetSubtitle: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray400,
    lineHeight: 18,
  },
  closetCtaPill: {
    marginTop: Spacing.md,
    backgroundColor: Colors.gold,
    borderRadius: Radius.full,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  closetCtaText: {
    color: Colors.textPrimary,
    fontWeight: Typography.fontWeightBold,
    fontSize: Typography.fontSizeMD,
  },
  section: { padding: Spacing.md, borderTopWidth: 1, borderColor: Colors.gray200 },
  sectionTitle: {
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  sectionHint: { fontSize: Typography.fontSizeXS, color: Colors.gray400, marginBottom: Spacing.md },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  tipsLink: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray600,
    fontWeight: Typography.fontWeightSemiBold,
  },
  bodyPhotosRow: { flexDirection: 'row', gap: Spacing.md },
  bodyPhotoSlot: {
    flex: 1,
    aspectRatio: 3 / 4,
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: Colors.gray100,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: Colors.gray200,
    position: 'relative',
  },
  bodyPhotoImage: { width: '100%', height: '100%' },
  bodyPhotoEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bodyPhotoPlusIcon: { fontSize: 28, color: Colors.gray400 },
  bodyPhotoEmptyLabel: { fontSize: Typography.fontSizeSM, color: Colors.gray600, marginTop: 4 },
  bodyPhotoLabel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    padding: 4,
  },
  bodyPhotoLabelText: {
    color: Colors.white,
    fontSize: Typography.fontSizeXS,
    textAlign: 'center',
  },
  emptyHistory: {
    fontSize: Typography.fontSizeMD,
    color: Colors.gray400,
    fontStyle: 'italic',
    marginTop: Spacing.sm,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  historyHeaderAction: {
    fontSize: Typography.fontSizeSM,
    fontWeight: Typography.fontWeightSemiBold,
    color: Colors.textPrimary,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
  storageUsage: {
    fontSize: Typography.fontSizeXS,
    color: Colors.gray600,
    marginBottom: Spacing.sm,
  },
  storageUsageWarn: { color: Colors.warning },
  storageUsageDanger: {
    color: Colors.danger,
    fontWeight: Typography.fontWeightSemiBold,
  },
  selectionOverlay: {
    position: 'absolute',
    top: 1,
    left: 1,
    right: 1,
    bottom: 1,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  selectionOverlayActive: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: 2,
    borderColor: Colors.border,
  },
  selectionCheck: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderWidth: 1.5,
    borderColor: Colors.gray400,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionCheckActive: {
    backgroundColor: Colors.black,
    borderColor: Colors.border,
  },
  deleteBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.gray200,
  },
  deleteButton: {
    backgroundColor: Colors.danger,
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  deleteButtonDisabled: { backgroundColor: Colors.gray400 },
  deleteButtonText: {
    color: Colors.white,
    fontWeight: Typography.fontWeightBold,
    fontSize: Typography.fontSizeMD,
  },
  historyItem: { flex: 1 / 3, aspectRatio: 1, padding: 1, position: 'relative' },
  historyImage: { width: '100%', height: '100%', borderRadius: 4 },
  historyPlaceholder: {
    backgroundColor: Colors.gray100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyStatus: { fontSize: 9, color: Colors.gray400 },
  historyPlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 40,
    height: 40,
    marginLeft: -20,
    marginTop: -20,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  privateBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-end' },
  menuSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingBottom: 40,
    paddingTop: Spacing.md,
  },
  menuItem: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderBottomWidth: 1,
    borderColor: Colors.gray100,
  },
  menuItemText: { fontSize: Typography.fontSizeMD, color: Colors.textPrimary },
  menuItemDanger: { color: Colors.danger },
});
