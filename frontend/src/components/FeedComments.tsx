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
import { Ionicons } from '@expo/vector-icons';
import api from '../config/api';
import { useUserStore } from '../store/useUserStore';
import { useCommentDeltas } from '../store/useCommentDeltas';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { Comment } from '../types';
import RetryableImage from './RetryableImage';
import ReportSheet from './ReportSheet';
import { requireRealUser } from '../utils/guestGate';

// Inline comment panel used by the full-screen feed's "pulled-back" state
// (FeedPost). It owns the comment thread for one post — fetch, post, reply,
// like, delete, report — the same contract as the full-screen TryOnCommentsScreen,
// minus that screen's own job-image header + navigation chrome (the post content
// sits above this panel in FeedPost). Kept self-contained so the feed's comment
// UX doesn't depend on the standalone screen. Comment-count changes are bumped
// into useCommentDeltas so the feed's comment count stays in step.

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

export default function FeedComments({
  jobId,
  jobOwnerId,
}: {
  jobId: string;
  // Post owner — a post owner may delete any comment on their own post.
  jobOwnerId?: string;
}) {
  const { user } = useUserStore();
  const bumpCommentDelta = useCommentDeltas((s) => s.bump);

  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [body, setBody] = useState('');
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [reportTargetId, setReportTargetId] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<Comment>>(null);

  // Live keyboard height, used to lift the docked input bar above the keyboard.
  // Manual (not KeyboardAvoidingView) because this panel lives inside a
  // fixed-height page of the vertical pager, where KAV mis-measures. iOS only —
  // Android resizes the window itself.
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

  const loadComments = useCallback(async () => {
    try {
      const { data } = await api.get<{ comments: Comment[] }>(`/tryon/${jobId}/comments`);
      setComments(data.comments);
    } catch {
      // Leave the list empty on error; the user can still try to comment.
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  function startReply(parent: Comment) {
    setReplyTarget({ parentId: parent.id, username: parent.user.username });
    inputRef.current?.focus();
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
        setComments((prev) =>
          prev.map((c) =>
            c.id === replyTarget.parentId ? { ...c, replies: [...(c.replies ?? []), created] } : c,
          ),
        );
      } else {
        setComments((prev) => [...prev, { ...created, replies: created.replies ?? [] }]);
      }
      bumpCommentDelta(jobId, 1);
      setBody('');
      setReplyTarget(null);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (err: unknown) {
      const response = (err as { response?: { data?: { error?: unknown; message?: string } } })
        ?.response?.data;
      let msg = response?.message ?? 'Could not post comment.';
      if (typeof response?.error === 'string') msg = response.error;
      else if (response?.error && typeof response.error === 'object') {
        const fieldErrors = (response.error as { fieldErrors?: Record<string, string[]> })
          .fieldErrors;
        if (fieldErrors) msg = Object.values(fieldErrors).flat().join('\n') || msg;
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
        setComments((prev) =>
          prev.map((c) =>
            c.id === target.parentId
              ? { ...c, replies: (c.replies ?? []).filter((r) => r.id !== target.id) }
              : c,
          ),
        );
      } else {
        setComments((prev) => prev.filter((c) => c.id !== target.id));
      }
      bumpCommentDelta(jobId, -(data.removed ?? 1));
    } catch {
      Alert.alert('Error', 'Could not delete comment.');
    }
  }

  async function toggleLike(target: Comment) {
    if (!requireRealUser('Sign up to like comments.')) return;
    const wasLiked = target.liked;
    const apply = (next: boolean) => (c: Comment) =>
      c.id === target.id
        ? { ...c, liked: next, likesCount: Math.max(0, c.likesCount + (next ? 1 : -1)) }
        : c;
    setComments((prev) =>
      prev.map((c) => {
        const updated = apply(!wasLiked)(c);
        return { ...updated, replies: (updated.replies ?? []).map(apply(!wasLiked)) };
      }),
    );
    try {
      if (wasLiked) await api.delete(`/comments/${target.id}/likes`);
      else await api.post(`/comments/${target.id}/likes`);
    } catch {
      setComments((prev) =>
        prev.map((c) => {
          const reverted = apply(wasLiked)(c);
          return { ...reverted, replies: (reverted.replies ?? []).map(apply(wasLiked)) };
        }),
      );
    }
  }

  function openCommentMenu(comment: Comment) {
    const isAuthor = comment.userId === user?.id;
    const isPostOwner = jobOwnerId === user?.id;
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

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.textPrimary} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={comments}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="chatbubble-outline" size={32} color={Colors.gray400} />
              <Text style={styles.emptyText}>No comments yet. Be the first.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View>
              <CommentRow
                comment={item}
                onMenu={() => openCommentMenu(item)}
                onLike={() => toggleLike(item)}
                onReply={() => startReply(item)}
              />
              {(item.replies ?? []).map((reply) => (
                <CommentRow
                  key={reply.id}
                  comment={reply}
                  isReply
                  onMenu={() => openCommentMenu(reply)}
                  onLike={() => toggleLike(reply)}
                />
              ))}
            </View>
          )}
          contentContainerStyle={styles.listContent}
        />
      )}

      <View style={[styles.inputBar, { marginBottom: keyboardHeight }]}>
        {replyTarget ? (
          <View style={styles.replyHint}>
            <Text style={styles.replyHintText} numberOfLines={1}>
              Replying to <Text style={styles.replyHintHandle}>@{replyTarget.username}</Text>
            </Text>
            <TouchableOpacity onPress={() => setReplyTarget(null)} hitSlop={8}>
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
  onMenu,
  onLike,
  onReply,
}: {
  comment: Comment;
  isReply?: boolean;
  onMenu: () => void;
  onLike: () => void;
  onReply?: () => void;
}) {
  const fullName = [comment.user.firstName, comment.user.lastName].filter(Boolean).join(' ');
  return (
    <View style={[styles.commentRow, isReply && styles.commentRowReply]}>
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
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: Spacing.xl,
  },
  listContent: { paddingVertical: Spacing.sm, paddingBottom: Spacing.md },
  emptyState: { alignItems: 'center', padding: Spacing.xl, gap: Spacing.sm },
  emptyText: { fontSize: Typography.fontSizeSM, color: Colors.gray600 },
  avatarInitial: {
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightBold,
    color: Colors.gray600,
  },
  commentRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
    alignItems: 'flex-start',
  },
  commentRowReply: { paddingLeft: Spacing.xxl },
  commentAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.gray200,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  commentAvatarReply: { width: 26, height: 26, borderRadius: 13 },
  commentAvatarImg: { width: '100%', height: '100%' },
  commentBody: { flex: 1 },
  commentMeta: { fontSize: Typography.fontSizeSM },
  commentAuthor: { fontWeight: Typography.fontWeightSemiBold, color: Colors.textPrimary },
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
    paddingBottom: Spacing.sm,
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
  replyHintText: { flex: 1, fontSize: Typography.fontSizeSM, color: Colors.gray600 },
  replyHintHandle: { color: Colors.textPrimary, fontWeight: Typography.fontWeightSemiBold },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm },
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
