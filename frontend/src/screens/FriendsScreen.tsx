import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import api from '../config/api';
import { PublicUser } from '../types';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { RootStackParams, MainTabParams } from '../navigation';
import { requireRealUser } from '../utils/guestGate';
import RetryableImage from '../components/RetryableImage';
import CreditDisplay from '../components/CreditDisplay';

type Tab = 'following' | 'followers';
// Friends is a bottom tab; nav stays typed as the root stack so it can push
// PublicProfile / Purchase, but the ROUTE (its params) lives on the tab params.
type FriendsRouteProp = RouteProp<MainTabParams, 'Friends'>;

export default function FriendsScreen() {
  const insets = useSafeAreaInsets();
  const route = useRoute<FriendsRouteProp>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const initialTab = route.params?.initialTab ?? 'following';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [searchMode, setSearchMode] = useState(route.params?.openSearch ?? false);
  const [query, setQuery] = useState('');
  const [following, setFollowing] = useState<PublicUser[]>([]);
  const [followers, setFollowers] = useState<PublicUser[]>([]);
  const [searchResults, setSearchResults] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    loadFriends();
  }, []);

  // As a persistent tab this screen stays mounted, so react to param changes
  // from links (Profile's Following/Followers stats, the feed's search icon)
  // rather than only reading them on first mount.
  useEffect(() => {
    if (route.params?.initialTab) setTab(route.params.initialTab);
    if (route.params?.openSearch) setSearchMode(true);
  }, [route.params?.initialTab, route.params?.openSearch]);

  async function loadFriends() {
    setLoading(true);
    try {
      const [fol, folrs] = await Promise.all([
        api.get<PublicUser[]>('/friends/following'),
        api.get<PublicUser[]>('/friends/followers'),
      ]);
      setFollowing(fol.data);
      setFollowers(folrs.data);
    } catch {}
    setLoading(false);
  }

  const handleSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const { data } = await api.get<PublicUser[]>(`/friends/search?q=${encodeURIComponent(q)}`);
      setSearchResults(data);
    } catch {}
    setSearching(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => handleSearch(query), 400);
    return () => clearTimeout(timer);
  }, [query, handleSearch]);

  async function followUser(userId: string) {
    // Following is account-bound — prompt a guest to sign up.
    if (!requireRealUser('Sign up to follow people.')) return;
    try {
      await api.post(`/friends/follow/${userId}`);
      await loadFriends();
    } catch {
      Alert.alert('Error', 'Could not follow user.');
    }
  }

  async function unfollowUser(userId: string) {
    try {
      await api.delete(`/friends/unfollow/${userId}`);
      await loadFriends();
    } catch {
      Alert.alert('Error', 'Could not unfollow user.');
    }
  }

  const followingIds = new Set(following.map((u) => u.id));
  const displayList = searchMode ? searchResults : tab === 'following' ? following : followers;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerSide}>
          <CreditDisplay onPress={() => navigation.navigate('Purchase')} />
        </View>
        <Text style={styles.headerTitle}>Friends</Text>
        <View style={[styles.headerSide, styles.headerSideRight]}>
          <TouchableOpacity
            onPress={() => {
              setSearchMode(!searchMode);
              setQuery('');
            }}
          >
            <Ionicons name={searchMode ? 'close' : 'search'} size={24} color={Colors.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      {searchMode ? (
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={Colors.gray400} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search users..."
            placeholderTextColor={Colors.gray400}
            value={query}
            onChangeText={setQuery}
            autoFocus
          />
          {searching && <ActivityIndicator size="small" color={Colors.gray400} />}
        </View>
      ) : (
        <View style={styles.tabBar}>
          {(['following', 'followers'] as Tab[]).map((t) => (
            <TouchableOpacity key={t} style={styles.tabItem} onPress={() => setTab(t)}>
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t === 'following'
                  ? `Following (${following.length})`
                  : `Followers (${followers.length})`}
              </Text>
              {tab === t && <View style={styles.tabIndicator} />}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {loading && !searchMode ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.textPrimary} />
        </View>
      ) : (
        <FlatList
          data={displayList}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <UserRow
              user={item}
              isFollowing={followingIds.has(item.id)}
              onFollow={() => followUser(item.id)}
              onUnfollow={() => unfollowUser(item.id)}
              onPress={() => navigation.navigate('PublicProfile', { username: item.username })}
            />
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="people-outline" size={48} color={Colors.gray200} />
              <Text style={styles.emptyText}>
                {searchMode && query.length >= 2
                  ? 'No users found'
                  : tab === 'following'
                    ? "You're not following anyone yet"
                    : 'No followers yet'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

function UserRow({
  user,
  isFollowing,
  onFollow,
  onUnfollow,
  onPress,
}: {
  user: PublicUser;
  isFollowing: boolean;
  onFollow: () => void;
  onUnfollow: () => void;
  onPress: () => void;
}) {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
  return (
    <View style={styles.userRow}>
      <TouchableOpacity
        style={styles.userRowTap}
        onPress={onPress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Open ${user.username}'s profile`}
      >
        <View style={styles.userAvatar}>
          {user.avatarUrl ? (
            <RetryableImage uri={user.avatarUrl} style={styles.userAvatarImg} />
          ) : (
            <Text style={styles.userAvatarInitial}>{user.username[0].toUpperCase()}</Text>
          )}
        </View>
        <View style={styles.userInfo}>
          {fullName ? (
            <>
              <Text style={styles.userName}>{fullName}</Text>
              <Text style={styles.userHandle}>@{user.username}</Text>
            </>
          ) : (
            <Text style={styles.userName}>@{user.username}</Text>
          )}
          {user.bio ? (
            <Text style={styles.userBio} numberOfLines={1}>
              {user.bio}
            </Text>
          ) : null}
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.followBtn, isFollowing && styles.followingBtn]}
        onPress={isFollowing ? onUnfollow : onFollow}
      >
        <Text style={[styles.followBtnText, isFollowing && styles.followingBtnText]}>
          {isFollowing ? 'Following' : 'Follow'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
  },
  headerSide: { flex: 1, justifyContent: 'center', alignItems: 'flex-start' },
  headerSideRight: { alignItems: 'flex-end' },
  headerTitle: {
    fontSize: Typography.fontSizeXL,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: Spacing.md,
    padding: Spacing.md,
    backgroundColor: Colors.gray100,
    borderRadius: Radius.full,
    gap: Spacing.sm,
  },
  searchInput: { flex: 1, fontSize: Typography.fontSizeMD, color: Colors.textPrimary },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: Colors.gray200,
  },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: Spacing.md, position: 'relative' },
  tabText: { fontSize: Typography.fontSizeMD, color: Colors.gray600 },
  tabTextActive: { fontWeight: Typography.fontWeightSemiBold, color: Colors.textPrimary },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: '20%',
    right: '20%',
    height: 2,
    backgroundColor: Colors.black,
    borderRadius: 1,
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderColor: Colors.gray100,
    gap: Spacing.md,
  },
  userRowTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  userAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.gray200,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  userAvatarImg: { width: '100%', height: '100%' },
  userAvatarInitial: {
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightBold,
    color: Colors.gray600,
  },
  userInfo: { flex: 1 },
  userName: {
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightSemiBold,
    color: Colors.textPrimary,
  },
  userHandle: { fontSize: Typography.fontSizeSM, color: Colors.gray600, marginTop: 1 },
  userBio: { fontSize: Typography.fontSizeSM, color: Colors.gray600, marginTop: 2 },
  followBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: Radius.full,
    backgroundColor: Colors.accent,
  },
  followingBtn: { backgroundColor: Colors.surface, borderWidth: 1.5, borderColor: Colors.gray200 },
  followBtnText: {
    fontSize: Typography.fontSizeSM,
    fontWeight: Typography.fontWeightSemiBold,
    color: Colors.textPrimary,
  },
  followingBtnText: { color: Colors.textPrimary },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xxl,
    marginTop: 80,
  },
  emptyText: {
    fontSize: Typography.fontSizeMD,
    color: Colors.gray400,
    marginTop: Spacing.md,
    textAlign: 'center',
  },
});
