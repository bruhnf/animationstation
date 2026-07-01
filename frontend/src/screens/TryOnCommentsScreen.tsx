import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Keyboard,
  Platform,
  Alert,
  ActionSheetIOS,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import api from '../config/api';
import { useUserStore } from '../store/useUserStore';
import { useCommentDeltas } from '../store/useCommentDeltas';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { Comment, TryOnJob } from '../types';
import { RootStackParams } from '../navigation';
import AiGeneratedBadge from '../components/AiGeneratedBadge';
import ReportSheet from '../components/ReportSheet';
import RetryableImage from '../components/RetryableImage';
import { requireRealUser } from '../utils/guestGate';

type Nav = NativeStackNavigationProp<RootStackParams, 'TryOnComments'>;
type Rt = RouteProp<RootStackParams, 'TryOnComments'>;

interface JobWithUser extends TryOnJob {
  user?: { username: string; firstName?: string; lastName?: string; avatarUrl?: string };
}

// State for the "you're replying to @user" hint above the input. Cleared on
// post-success or by the Cancel button.
interface ReplyTarget {
  parentId: string;
  username: string;
}

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
  return new Date(iso).toLocaleDateString();
}

export default function TryOnCommentsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const { jobId, commentId: focusCommentId } = route.params;
  const { user } = useUserStore();
  const bumpCommentDelta = useCommentDeltas((s) => s.bump);

  const [job, setJob] = useState<JobWithUser | null>(null);
  // Top-level comments only. Each may contain a `replies` array.
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [body, setBody] = useState('');
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [reportTargetId, setReportTargetId] = useState<string | null>(null);
  // ID of a comment to render with a transient highlight background. Set
  // when arriving via a notification with a commentId, cleared after a
  // short delay.
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<Comment>>(null);
  // Live keyboard height, used to lift the docked input bar above the keyboard.
  // We drive this manually instead of using KeyboardAvoidingView because that
  // component mis-measures inside a @react-navigation/native-stack card on iOS
  // (the input ends up hidden behind the keyboard). iOS only — on Android the
  // OS window resize handles it and adding padding here would double-offset.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const onShow = Keyboard.addListener('keyboardWillShow', (e) =>
      setKeyboardHeight(e.endCoordinates?.height ?? 0),
    );
    const onHide = Keyboard.addListener('keyboardWillHide', () => setKeyboardHeight(0));
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [jobRes, commentsRes] = await Promise.all([
        api.get<JobWithUser>(`/tryon/${jobId}`),
        api.get<{ comments: Comment[] }>(`/tryon/${jobId}/comments`),
      ]);
      setJob(jobRes.data);
      setComments(commentsRes.data.comments);
    } catch {
      Alert.alert('Error', 'Could not load this creation.');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, [jobId, navigation]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // When the screen is opened via a notification (commentId set), find the
  // referenced comment after data loads, scroll to it, and briefly highlight
  // the row. The targeted comment may be top-level (scroll to its index in
  // the FlatList) or a reply (scroll to its parent's index — the reply
  // renders in the same list item).
  useEffect(() => {
    if (loading || !focusCommentId || comments.length === 0) return;
    let parentIndex = -1;
    for (let i = 0; i < comments.length; i += 1) {
      const c = comments[i];
      if (c.id === focusCommentId) {
        parentIndex = i;
        break;
      }
      if ((c.replies ?? []).some((r) => r.id === focusCommentId)) {
        parentIndex = i;
        break;
      }
    }
    if (parentIndex < 0) return;

    setHighlightedId(focusCommentId);
    // Defer the scroll a tick so the FlatList has measured layout.
    const t = setTimeout(() => {
      listRef.current?.scrollToIndex({
        index: parentIndex,
        animated: true,
        viewPosition: 0.3,
      });
    }, 120);
    const clearTimer = setTimeout(() => setHighlightedId(null), 2400);
    return () => {
      clearTimeout(t);
      clearTimeout(clearTimer);
    };
  }, [loading, focusCommentId, comments]);

  function startReply(parent: Comment) {
    setReplyTarget({ parentId: parent.id, username: parent.user.username });
    inputRef.current?.focus();
  }

  function cancelReply() {
    setReplyTarget(null);
  }

  async function handleSend() {
    // Commenting is account-bound — prompt a guest to sign up.
    if (!requireRealUser('Sign up to join the conversation.')) return;
    const trimmed = body.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    try {
      const { data: created } = await api.post<Comment>(`/tryon/${jobId}/comments`, {
        body: trimmed,
        parentId: replyTarget?.parentId,
      });
      if (replyTarget) {
        // Append the new reply under its parent.
        setComments((prev) =>
          prev.map((c) =>
            c.id === replyTarget.parentId ? { ...c, replies: [...(c.replies ?? []), created] } : c,
          ),
        );
      } else {
        // Top-level: append to the end. Server seeds replies to [].
        setComments((prev) => [...prev, { ...created, replies: created.replies ?? [] }]);
      }
      bumpCommentDelta(jobId, 1);
      setBody('');
      setReplyTarget(null);
      // Scroll to the bottom of the list so the new entry is visible.
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (err: unknown) {
      const response = (err as { response?: { data?: { error?: unknown; message?: string } } })
        ?.response?.data;
      let msg = response?.message ?? 'Could not post comment.';
      if (typeof response?.error === 'string') msg = response.error;
      else if (response?.error && typeof response.error === 'object') {
        const fieldErrors = (response.error as { fieldErrors?: Record<string, string[]> })
          .fieldErrors;
        if (fieldErrors) {
          msg = Object.values(fieldErrors).flat().join('\n') || msg;
        }
      }
      Alert.alert('Could not post comment', String(msg));
    } finally {
      setPosting(false);
    }
  }

  async function deleteComment(target: Comment) {
    try {
      const { data } = await api.delete<{ deleted: boolean; removed: number }>(
        `/comments/${target.id}`,
      );
      if (target.parentId) {
        // Reply: remove just this row from its parent's replies. Removed
        // count from the server is always 1 for replies (no children).
        setComments((prev) =>
          prev.map((c) =>
            c.id === target.parentId
              ? { ...c, replies: (c.replies ?? []).filter((r) => r.id !== target.id) }
              : c,
          ),
        );
      } else {
        // Top-level: remove the row entirely (cascade removes replies in DB).
        setComments((prev) => prev.filter((c) => c.id !== target.id));
      }
      bumpCommentDelta(jobId, -(data.removed ?? 1));
    } catch {
      Alert.alert('Error', 'Could not delete comment.');
    }
  }

  // Optimistically toggle the like state of a single comment (top-level or
  // reply). Rolls back on failure. Updates likesCount in lockstep.
  async function toggleLike(target: Comment) {
    // Liking is account-bound — prompt a guest to sign up (before the optimistic
    // toggle so the heart doesn't flash filled then revert).
    if (!requireRealUser('Sign up to like comments.')) return;
    const wasLiked = target.liked;
    const apply = (next: boolean) => (c: Comment) =>
      c.id === target.id
        ? { ...c, liked: next, likesCount: Math.max(0, c.likesCount + (next ? 1 : -1)) }
        : c;
    setComments((prev) =>
      prev.map((c) => {
        const updated = apply(!wasLiked)(c);
        return {
          ...updated,
          replies: (updated.replies ?? []).map(apply(!wasLiked)),
        };
      }),
    );
    try {
      if (wasLiked) await api.delete(`/comments/${target.id}/likes`);
      else await api.post(`/comments/${target.id}/likes`);
    } catch {
      // Roll back
      setComments((prev) =>
        prev.map((c) => {
          const reverted = apply(wasLiked)(c);
          return {
            ...reverted,
            replies: (reverted.replies ?? []).map(apply(wasLiked)),
          };
        }),
      );
    }
  }

  function openCommentMenu(comment: Comment) {
    const isAuthor = comment.userId === user?.id;
    const isPostOwner = job?.userId === user?.id;
    const canDelete = isAuthor || isPostOwner;
    const canReport = !isAuthor;

    const actions: { label: string; destructive?: boolean; onPress: () => void }[] = [];
    if (canDelete) {
      actions.push({
        label: 'Delete',
        destructive: true,
        onPress: () =>
          Alert.alert('Delete Comment', 'Are you sure?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => deleteComment(comment) },
          ]),
      });
    }
    if (canReport) {
      actions.push({
        label: 'Report',
        onPress: () => {
          // Reporting is account-bound — prompt a guest to sign up.
          if (!requireRealUser('Sign up to report comments.')) return;
          setReportTargetId(comment.id);
        },
      });
    }
    if (actions.length === 0) return;

    const options = [...actions.map((a) => a.label), 'Cancel'];
    const cancelButtonIndex = options.length - 1;
    const destructiveButtonIndex = actions.findIndex((a) => a.destructive);

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex,
          destructiveButtonIndex: destructiveButtonIndex >= 0 ? destructiveButtonIndex : undefined,
        },
        (idx) => {
          if (idx >= 0 && idx < actions.length) actions[idx].onPress();
        },
      );
    } else {
      Alert.alert('', '', [
        ...actions.map((a) => ({
          text: a.label,
          style: a.destructive ? ('destructive' as const) : ('default' as const),
          onPress: a.onPress,
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  }

  if (loading || !job) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={Colors.textPrimary} />
      </View>
    );
  }

  const displayUrl = job.resultFullBodyUrl || job.resultMediumUrl;
  const ownerName =
    [job.user?.firstName, job.user?.lastName].filter(Boolean).join(' ') ||
    (job.user?.username ? `@${job.user.username}` : 'Unknown');

  return (
    // Manual keyboard avoidance (see keyboardHeight effect): adding the keyboard
    // height as bottom padding lifts the FlatList + docked input bar above the
    // keyboard. Reliable inside a native-stack card where KeyboardAvoidingView
    // is not. No-op on Android (keyboardHeight stays 0; OS handles it).
    <View style={[styles.container, { paddingBottom: keyboardHeight }]}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeButton}>
          <Ionicons name="close" size={28} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Comments</Text>
        <View style={styles.headerSpacer} />
      </View>

      <FlatList
        ref={listRef}
        data={comments}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <View style={styles.tryonCard}>
              <View style={styles.ownerRow}>
                <View style={styles.avatar}>
                  {job.user?.avatarUrl ? (
                    <RetryableImage uri={job.user.avatarUrl} style={styles.avatarImg} />
                  ) : (
                    <Text style={styles.avatarInitial}>
                      {(job.user?.username ?? '?')[0].toUpperCase()}
                    </Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.ownerName}>{ownerName}</Text>
                  {job.user?.username ? (
                    <Text style={styles.ownerHandle}>@{job.user.username}</Text>
                  ) : null}
                </View>
              </View>
              {displayUrl ? (
                <View style={styles.imageWrap}>
                  <RetryableImage uri={displayUrl} style={styles.image} resizeMode="cover" />
                  <AiGeneratedBadge />
                </View>
              ) : null}
            </View>
            {comments.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="chatbubble-outline" size={36} color={Colors.gray400} />
                <Text style={styles.emptyText}>No comments yet. Be the first.</Text>
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <View>
            <CommentRow
              comment={item}
              highlighted={highlightedId === item.id}
              onMenu={() => openCommentMenu(item)}
              onLike={() => toggleLike(item)}
              onReply={() => startReply(item)}
            />
            {(item.replies ?? []).map((reply) => (
              <CommentRow
                key={reply.id}
                comment={reply}
                isReply
                highlighted={highlightedId === reply.id}
                onMenu={() => openCommentMenu(reply)}
                onLike={() => toggleLike(reply)}
              />
            ))}
          </View>
        )}
        contentContainerStyle={styles.listContent}
        // FlatList may reject a scrollToIndex if the target row hasn't been
        // measured yet. Wait, then retry — by the second attempt the row
        // will be on screen or close to it.
        onScrollToIndexFailed={(info) => {
          setTimeout(() => {
            listRef.current?.scrollToIndex({
              index: info.index,
              animated: true,
              viewPosition: 0.3,
            });
          }, 300);
        }}
      />

      <View
        style={[
          styles.inputBar,
          // When the keyboard is up it covers the home-indicator area, so drop
          // the safe-area bottom inset and sit the bar right on the keyboard.
          { paddingBottom: keyboardHeight > 0 ? Spacing.sm : insets.bottom + Spacing.sm },
        ]}
      >
        {replyTarget ? (
          <View style={styles.replyHint}>
            <Text style={styles.replyHintText} numberOfLines={1}>
              Replying to <Text style={styles.replyHintHandle}>@{replyTarget.username}</Text>
            </Text>
            <TouchableOpacity onPress={cancelReply} hitSlop={8}>
              <Ionicons name="close" size={16} color={Colors.gray600} />
            </TouchableOpacity>
          </View>
        ) : null}
        <View style={styles.inputRow}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder={replyTarget ? `Reply to @${replyTarget.username}…` : 'Add a comment…'}
            placeholderTextColor={Colors.gray400}
            value={body}
            onChangeText={setBody}
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[styles.sendButton, (!body.trim() || posting) && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!body.trim() || posting}
          >
            {posting ? (
              <ActivityIndicator color={Colors.white} size="small" />
            ) : (
              <Ionicons name="arrow-up" size={18} color={Colors.textPrimary} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      <ReportSheet
        visible={reportTargetId !== null}
        targetType="COMMENT"
        targetId={reportTargetId ?? ''}
        onClose={() => setReportTargetId(null)}
      />
    </View>
  );
}

function CommentRow({
  comment,
  isReply,
  highlighted,
  onMenu,
  onLike,
  onReply,
}: {
  comment: Comment;
  isReply?: boolean;
  highlighted?: boolean;
  onMenu: () => void;
  onLike: () => void;
  onReply?: () => void;
}) {
  const fullName = [comment.user.firstName, comment.user.lastName].filter(Boolean).join(' ');
  return (
    <View
      style={[
        styles.commentRow,
        isReply && styles.commentRowReply,
        highlighted && styles.commentRowHighlighted,
      ]}
    >
      <View style={[styles.commentAvatar, isReply && styles.commentAvatarReply]}>
        {comment.user.avatarUrl ? (
          <RetryableImage uri={comment.user.avatarUrl} style={styles.commentAvatarImg} />
        ) : (
          <Text style={styles.avatarInitial}>{comment.user.username[0].toUpperCase()}</Text>
        )}
      </View>
      <View style={styles.commentBody}>
        <Text style={styles.commentMeta}>
          <Text style={styles.commentAuthor}>{fullName || `@${comment.user.username}`}</Text>
          <Text style={styles.commentTime}>
            {'  '}
            {timeAgo(comment.createdAt)}
          </Text>
        </Text>
        <Text style={styles.commentText}>{comment.body}</Text>
        <View style={styles.commentActions}>
          {comment.likesCount > 0 ? (
            <Text style={styles.commentLikesCount}>
              {comment.likesCount} {comment.likesCount === 1 ? 'like' : 'likes'}
            </Text>
          ) : null}
          {/* Reply is only offered for top-level comments — replies don't
              have their own thread. Tapping a reply's row to reply still
              attaches to the same parent (handled by the caller passing
              onReply only for top-level rows). */}
          {onReply ? (
            <TouchableOpacity onPress={onReply} hitSlop={8}>
              <Text style={styles.commentReplyButton}>Reply</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
      <View style={styles.commentRightActions}>
        <TouchableOpacity
          onPress={onLike}
          hitSlop={8}
          accessibilityLabel={comment.liked ? 'Unlike' : 'Like'}
        >
          <Ionicons
            name={comment.liked ? 'heart' : 'heart-outline'}
            size={18}
            color={comment.liked ? Colors.danger : Colors.gray600}
          />
        </TouchableOpacity>
        <TouchableOpacity onPress={onMenu} hitSlop={8} style={styles.commentMenu}>
          <Ionicons name="ellipsis-horizontal" size={18} color={Colors.gray600} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surface },
  centered: { justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.gray200,
  },
  closeButton: { padding: Spacing.xs, width: 36 },
  headerTitle: {
    fontSize: Typography.fontSizeXL,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  headerSpacer: { width: 36 },
  listContent: { paddingBottom: Spacing.md },
  tryonCard: {
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.gray100,
  },
  ownerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
  ownerName: {
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightSemiBold,
    color: Colors.textPrimary,
  },
  ownerHandle: { fontSize: Typography.fontSizeSM, color: Colors.gray600 },
  imageWrap: {
    position: 'relative',
    borderRadius: Radius.md,
    overflow: 'hidden',
    aspectRatio: 3 / 4,
    backgroundColor: Colors.gray100,
  },
  image: { width: '100%', height: '100%' },
  emptyState: {
    alignItems: 'center',
    padding: Spacing.xxl,
    gap: Spacing.sm,
  },
  emptyText: { fontSize: Typography.fontSizeSM, color: Colors.gray600 },
  commentRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
    alignItems: 'flex-start',
  },
  // Replies are inset to make the threading visually clear.
  commentRowReply: {
    paddingLeft: Spacing.xxl,
  },
  // Transient highlight when arriving via a notification deep-link.
  commentRowHighlighted: {
    backgroundColor: 'rgba(255, 230, 150, 0.6)',
  },
  commentAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.gray200,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  commentAvatarReply: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  commentAvatarImg: { width: '100%', height: '100%' },
  commentBody: { flex: 1 },
  commentMeta: { fontSize: Typography.fontSizeSM },
  commentAuthor: {
    fontWeight: Typography.fontWeightSemiBold,
    color: Colors.textPrimary,
  },
  commentTime: { color: Colors.gray600 },
  commentText: {
    fontSize: Typography.fontSizeMD,
    color: Colors.textPrimary,
    marginTop: 2,
    lineHeight: 20,
  },
  commentActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: 4,
  },
  commentLikesCount: {
    fontSize: Typography.fontSizeXS,
    color: Colors.gray600,
    fontWeight: Typography.fontWeightSemiBold,
  },
  commentReplyButton: {
    fontSize: Typography.fontSizeXS,
    color: Colors.gray600,
    fontWeight: Typography.fontWeightSemiBold,
  },
  commentRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingTop: 2,
  },
  commentMenu: { padding: 2 },
  inputBar: {
    paddingHorizontal: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.gray200,
    backgroundColor: Colors.surface,
  },
  replyHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.gray100,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.md,
    marginBottom: Spacing.xs,
  },
  replyHintText: {
    flex: 1,
    fontSize: Typography.fontSizeSM,
    color: Colors.gray600,
  },
  replyHintHandle: {
    color: Colors.textPrimary,
    fontWeight: Typography.fontWeightSemiBold,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: 36,
    maxHeight: 100,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.gray100,
    borderRadius: Radius.full,
    fontSize: Typography.fontSizeMD,
    color: Colors.textPrimary,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { backgroundColor: Colors.gray200 },
});
