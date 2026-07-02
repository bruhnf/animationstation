import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import api from '../config/api';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { Notification } from '../types';
import { RootStackParams } from '../navigation';
import HeaderMenu from '../components/HeaderMenu';
import CreditDisplay from '../components/CreditDisplay';
import RetryableImage from '../components/RetryableImage';
import { useNotificationStore } from '../store/useNotificationStore';

type Nav = NativeStackNavigationProp<RootStackParams>;

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const wk = Math.floor(day / 7);
  if (wk < 4) return `${wk}w`;
  return new Date(iso).toLocaleDateString();
}

export default function InboxScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const clearUnreadCount = useNotificationStore((s) => s.clearUnreadCount);

  async function load() {
    try {
      const { data } = await api.get<{ notifications: Notification[] }>('/notifications');
      setNotifications(data.notifications);
      setLoadError(false);
    } catch {
      // Surface a retry banner so a transient backend hiccup doesn't look
      // like an empty inbox.
      setLoadError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
    clearUnreadCount();
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, []);

  async function handlePress(n: Notification) {
    // Mark as read (fire-and-forget)
    if (!n.read) {
      api.patch(`/notifications/${n.id}/read`).catch(() => {});
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    }
    // Notifications with a jobId drill into the relevant creation's comment
    // thread. COMMENT_REPLY and COMMENT_LIKE additionally carry the
    // commentId so the screen can auto-scroll and briefly highlight the
    // referenced comment. FOLLOW (and anything missing a jobId) opens
    // the actor's profile.
    if (
      (n.type === 'COMMENT' ||
        n.type === 'COMMENT_REPLY' ||
        n.type === 'COMMENT_LIKE' ||
        n.type === 'LIKE') &&
      n.jobId
    ) {
      navigation.navigate('Comments', {
        jobId: n.jobId,
        commentId: n.commentId ?? undefined,
      });
      return;
    }
    if (n.actor?.username) {
      navigation.navigate('PublicProfile', { username: n.actor.username });
    }
  }

  async function markAllRead() {
    if (notifications.every((n) => n.read)) return;
    try {
      await api.post('/notifications/read-all');
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      clearUnreadCount();
    } catch {}
  }

  const hasUnread = notifications.some((n) => !n.read);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <HeaderMenu
        title="Inbox"
        leftComponent={<CreditDisplay onPress={() => navigation.navigate('Purchase')} />}
        rightComponent={
          hasUnread ? (
            <TouchableOpacity onPress={markAllRead} style={styles.markAllButton}>
              <Text style={styles.markAllText}>Mark all read</Text>
            </TouchableOpacity>
          ) : undefined
        }
      />
      {loadError ? (
        <View style={styles.errorBanner}>
          <Ionicons name="cloud-offline-outline" size={18} color={Colors.danger} />
          <Text style={styles.errorBannerText}>Couldn't load messages.</Text>
          <TouchableOpacity onPress={load} hitSlop={10}>
            <Text style={styles.errorBannerAction}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.textPrimary} />
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => (
            <NotificationRow notification={item} onPress={() => handlePress(item)} />
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="mail-outline" size={56} color={Colors.gray200} />
              <Text style={styles.emptyTitle}>No messages yet</Text>
              <Text style={styles.emptySubtitle}>
                When people follow or like your creations, you'll see them here.
              </Text>
            </View>
          }
          contentContainerStyle={notifications.length === 0 ? styles.emptyContainer : undefined}
        />
      )}
    </View>
  );
}

function NotificationRow({
  notification,
  onPress,
}: {
  notification: Notification;
  onPress: () => void;
}) {
  const actorName = notification.actor
    ? [notification.actor.firstName, notification.actor.lastName].filter(Boolean).join(' ') ||
      `@${notification.actor.username}`
    : 'Someone';

  let message = '';
  if (notification.type === 'FOLLOW') message = 'started following you';
  else if (notification.type === 'LIKE') message = 'liked your creation';
  else if (notification.type === 'COMMENT') message = 'commented on your creation';
  else if (notification.type === 'COMMENT_REPLY') message = 'replied to your comment';
  else if (notification.type === 'COMMENT_LIKE') message = 'liked your comment';
  else if (notification.type === 'CREATION_COMPLETE') message = 'Your creation is ready';

  const jobThumbUrl = notification.job?.resultImageUrl ?? notification.job?.resultImage2Url;

  return (
    <TouchableOpacity
      style={[styles.row, !notification.read && styles.rowUnread]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.avatar}>
        {notification.actor?.avatarUrl ? (
          <RetryableImage uri={notification.actor.avatarUrl} style={styles.avatarImg} />
        ) : (
          <Text style={styles.avatarInitial}>
            {(notification.actor?.username ?? '?')[0].toUpperCase()}
          </Text>
        )}
      </View>
      <View style={styles.body}>
        <Text style={styles.message} numberOfLines={2}>
          <Text style={styles.actorName}>{actorName}</Text> {message}
        </Text>
        <Text style={styles.timestamp}>{timeAgo(notification.createdAt)}</Text>
      </View>
      {jobThumbUrl ? <RetryableImage uri={jobThumbUrl} style={styles.jobThumb} /> : null}
      {!notification.read && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surface },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  markAllButton: { padding: Spacing.sm },
  markAllText: { fontSize: Typography.fontSizeSM, color: Colors.gray600 },
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderColor: Colors.gray100,
    gap: Spacing.md,
  },
  rowUnread: { backgroundColor: Colors.gray100 },
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
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightBold,
    color: Colors.gray600,
  },
  body: { flex: 1 },
  message: { fontSize: Typography.fontSizeMD, color: Colors.textPrimary, lineHeight: 20 },
  actorName: { fontWeight: Typography.fontWeightSemiBold },
  timestamp: { fontSize: Typography.fontSizeXS, color: Colors.gray600, marginTop: 2 },
  jobThumb: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
    backgroundColor: Colors.gray100,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.black,
    marginLeft: Spacing.xs,
  },
  emptyContainer: { flex: 1 },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xxl,
    gap: Spacing.md,
  },
  emptyTitle: {
    fontSize: Typography.fontSizeXL,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  emptySubtitle: {
    fontSize: Typography.fontSizeMD,
    color: Colors.gray600,
    textAlign: 'center',
    lineHeight: 22,
  },
});
