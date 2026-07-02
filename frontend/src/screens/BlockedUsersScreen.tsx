import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import api from '../config/api';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import RetryableImage from '../components/RetryableImage';

interface BlockedEntry {
  blockedAt: string;
  user: {
    id: string;
    username: string;
    firstName?: string;
    lastName?: string;
    avatarUrl?: string;
  };
}

export default function BlockedUsersScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [blocks, setBlocks] = useState<BlockedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  async function load() {
    try {
      const { data } = await api.get<{ blocks: BlockedEntry[] }>('/users/me/blocks');
      setBlocks(data.blocks);
    } catch {
      Alert.alert('Error', 'Could not load your blocked list.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, []);

  async function unblock(userId: string, username: string) {
    Alert.alert(
      `Unblock @${username}?`,
      'They will be able to see your profile and posts again. You will see theirs in your feed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          onPress: async () => {
            setUnblockingId(userId);
            try {
              await api.delete(`/users/${userId}/block`);
              setBlocks((prev) => prev.filter((b) => b.user.id !== userId));
            } catch {
              Alert.alert('Error', 'Could not unblock. Please try again.');
            } finally {
              setUnblockingId(null);
            }
          },
        },
      ],
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={28} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Blocked Users</Text>
        <View style={styles.backButton} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.textPrimary} />
        </View>
      ) : blocks.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="people-outline" size={48} color={Colors.gray400} />
          <Text style={styles.emptyTitle}>No blocked users</Text>
          <Text style={styles.emptySubtitle}>
            You haven't blocked anyone. You can block users from their profile or via the actions
            menu on any post.
          </Text>
        </View>
      ) : (
        <FlatList
          data={blocks}
          keyExtractor={(item) => item.user.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => {
            const fullName = [item.user.firstName, item.user.lastName].filter(Boolean).join(' ');
            const isBusy = unblockingId === item.user.id;
            return (
              <View style={styles.row}>
                <View style={styles.avatar}>
                  {item.user.avatarUrl ? (
                    <RetryableImage uri={item.user.avatarUrl} style={styles.avatarImg} />
                  ) : (
                    <Text style={styles.avatarInitial}>{item.user.username[0].toUpperCase()}</Text>
                  )}
                </View>
                <View style={styles.info}>
                  {fullName ? <Text style={styles.fullName}>{fullName}</Text> : null}
                  <Text style={styles.username}>@{item.user.username}</Text>
                </View>
                <TouchableOpacity
                  style={styles.unblockButton}
                  onPress={() => unblock(item.user.id, item.user.username)}
                  disabled={isBusy}
                >
                  {isBusy ? (
                    <ActivityIndicator color={Colors.textPrimary} />
                  ) : (
                    <Text style={styles.unblockButtonText}>Unblock</Text>
                  )}
                </TouchableOpacity>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surface },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.gray200,
  },
  backButton: { padding: Spacing.xs, width: 44, alignItems: 'center' },
  headerTitle: {
    flex: 1,
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    marginTop: Spacing.sm,
  },
  emptySubtitle: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray600,
    textAlign: 'center',
    lineHeight: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    gap: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.gray100,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.gray200,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: {
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightBold,
    color: Colors.gray600,
  },
  info: { flex: 1 },
  fullName: {
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightSemiBold,
    color: Colors.textPrimary,
  },
  username: { fontSize: Typography.fontSizeSM, color: Colors.gray600 },
  unblockButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    borderColor: Colors.border,
    minWidth: 80,
    alignItems: 'center',
  },
  unblockButtonText: {
    color: Colors.textPrimary,
    fontWeight: Typography.fontWeightSemiBold,
    fontSize: Typography.fontSizeSM,
  },
});
