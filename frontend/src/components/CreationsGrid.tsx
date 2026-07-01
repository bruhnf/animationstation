import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Modal,
  Image,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import api from '../config/api';
import { TryOnJob, ClosetItem } from '../types';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import RetryableImage from './RetryableImage';
import TryOnDetailModal from './TryOnDetailModal';
import VideoPlayerModal from './VideoPlayerModal';
import AiGeneratedBadge from './AiGeneratedBadge';
import { useVideoSourceStore } from '../store/useVideoSourceStore';

// A unified "creations" grid — the single view of everything a user has
// generated, merged from BOTH backend collections:
//   • /tryon/history  → transform images (kind IMAGE) + AI videos (kind VIDEO)
//   • /closet         → text-to-image "Design" results (ClosetItem)
// It sorts newest-first and dispatches per-item actions by source: tryon images
// open the full detail modal (privacy / like / save / comments), tryon videos
// open the player, and closet images open a lightweight viewer. Delete routes to
// the correct endpoint per source. Used by both the Library tab and the Profile
// screen so the two always show the same complete set.

export type Creation =
  | { key: string; source: 'tryon'; createdAt: string; job: TryOnJob }
  | { key: string; source: 'closet'; createdAt: string; item: ClosetItem };

export interface CreationCounts {
  images: number;
  videos: number;
  total: number;
}

function thumbFor(c: Creation): { url?: string; isVideo: boolean; isPrivate: boolean } {
  if (c.source === 'closet') return { url: c.item.imageUrl, isVideo: false, isPrivate: false };
  const job = c.job;
  const isVideo = job.kind === 'VIDEO';
  const url = isVideo ? job.bodyPhotoUrl : (job.resultFullBodyUrl ?? job.resultMediumUrl);
  return { url, isVideo, isPrivate: !!job.isPrivate };
}

export default function CreationsGrid({
  title,
  scrollEnabled = true,
  contentPaddingBottom = Spacing.xl,
  onCountChange,
  reloadToken,
}: {
  title?: string;
  scrollEnabled?: boolean;
  contentPaddingBottom?: number;
  onCountChange?: (counts: CreationCounts) => void;
  // Bump from a parent (e.g. Profile pull-to-refresh) to force a reload while the
  // screen is already focused. Focus alone re-fetches on tab switches.
  reloadToken?: number;
}) {
  const navigation = useNavigation<any>();
  const setPendingSource = useVideoSourceStore((s) => s.setPendingSource);

  const [creations, setCreations] = useState<Creation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoPrompt, setVideoPrompt] = useState<string | null>(null);
  const [detailJob, setDetailJob] = useState<TryOnJob | null>(null);
  const [closetViewer, setClosetViewer] = useState<ClosetItem | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    const [jobsRes, closetRes] = await Promise.allSettled([
      api.get<{ jobs: TryOnJob[] }>('/tryon/history'),
      api.get<{ items: ClosetItem[] }>('/closet'),
    ]);
    const merged: Creation[] = [];
    if (jobsRes.status === 'fulfilled') {
      for (const job of jobsRes.value.data.jobs ?? []) {
        merged.push({ key: `tryon:${job.id}`, source: 'tryon', createdAt: job.createdAt, job });
      }
    }
    if (closetRes.status === 'fulfilled') {
      for (const item of closetRes.value.data.items ?? []) {
        merged.push({ key: `closet:${item.id}`, source: 'closet', createdAt: item.createdAt, item });
      }
    }
    // Newest first across both collections.
    merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    if (!mounted.current) return;
    setCreations(merged);
    setLoaded(true);
    if (onCountChange) {
      let images = 0;
      let videos = 0;
      for (const c of merged) {
        if (c.source === 'closet') images += 1;
        else if (c.job.kind === 'VIDEO') videos += 1;
        else images += 1;
      }
      onCountChange({ images, videos, total: merged.length });
    }
  }, [onCountChange]);

  // Refetch on every focus (tabs stay mounted, so a mount-only load goes stale).
  useFocusEffect(
    useCallback(() => {
      mounted.current = true;
      void load();
      return () => {
        mounted.current = false;
      };
    }, [load]),
  );

  // Parent-driven reload (pull-to-refresh) while already focused.
  useEffect(() => {
    if (reloadToken === undefined) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken]);

  function exitSelection() {
    setSelectionMode(false);
    setSelected(new Set());
  }

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function enterSelectionWith(key: string) {
    setSelectionMode(true);
    setSelected(new Set([key]));
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    const keys = Array.from(selected);
    Alert.alert(
      'Delete Creations',
      `Permanently delete ${keys.length} ${keys.length === 1 ? 'creation' : 'creations'}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            const tryonIds = keys.filter((k) => k.startsWith('tryon:')).map((k) => k.slice(6));
            const closetIds = keys.filter((k) => k.startsWith('closet:')).map((k) => k.slice(7));
            try {
              await Promise.all([
                tryonIds.length
                  ? api.post('/tryon/bulk-delete', { jobIds: tryonIds })
                  : Promise.resolve(),
                ...closetIds.map((id) => api.delete(`/closet/${id}`)),
              ]);
              if (mounted.current) {
                setCreations((prev) => prev.filter((c) => !selected.has(c.key)));
                exitSelection();
              }
            } catch {
              Alert.alert('Error', 'Could not delete some creations. Please try again.');
            } finally {
              if (mounted.current) setDeleting(false);
            }
          },
        },
      ],
    );
  }

  function openCreation(c: Creation) {
    if (c.source === 'closet') {
      setClosetViewer(c.item);
      return;
    }
    const job = c.job;
    if (job.kind === 'VIDEO') {
      if (job.videoUrl) {
        setVideoUri(job.videoUrl);
        setVideoPrompt(job.motionPrompt ?? null);
      }
      return;
    }
    if (job.resultFullBodyUrl || job.resultMediumUrl) setDetailJob(job);
  }

  const renderItem = ({ item: c }: { item: Creation }) => {
    const { url, isVideo, isPrivate } = thumbFor(c);
    const isSelected = selected.has(c.key);
    return (
      <TouchableOpacity
        style={styles.item}
        activeOpacity={0.8}
        onPress={() => (selectionMode ? toggle(c.key) : openCreation(c))}
        onLongPress={() => (selectionMode ? toggle(c.key) : enterSelectionWith(c.key))}
      >
        {url ? (
          <>
            <RetryableImage uri={url} style={styles.image} resizeMode="cover" />
            {isVideo ? (
              <View style={styles.playBadge} pointerEvents="none">
                <Ionicons name="play" size={18} color={Colors.white} />
              </View>
            ) : null}
            {isPrivate ? (
              <View style={styles.privateBadge} pointerEvents="none">
                <Ionicons name="lock-closed" size={10} color={Colors.white} />
              </View>
            ) : null}
          </>
        ) : (
          <View style={[styles.image, styles.placeholder]}>
            <Text style={styles.placeholderText}>
              {c.source === 'tryon' ? c.job.status : ''}
            </Text>
          </View>
        )}
        {selectionMode ? (
          <View
            style={[styles.selOverlay, isSelected && styles.selOverlayActive]}
            pointerEvents="none"
          >
            <View style={[styles.selCheck, isSelected && styles.selCheckActive]}>
              {isSelected ? <Ionicons name="checkmark" size={16} color={Colors.white} /> : null}
            </View>
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {(title || (loaded && creations.length > 0)) && (
        <View style={styles.headerRow}>
          {title ? <Text style={styles.title}>{title}</Text> : <View />}
          {loaded && creations.length > 0 ? (
            selectionMode ? (
              <View style={styles.headerActions}>
                <TouchableOpacity onPress={deleteSelected} disabled={deleting} hitSlop={8}>
                  <Text style={[styles.action, styles.actionDanger]}>
                    {deleting ? 'Deleting…' : `Delete (${selected.size})`}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={exitSelection} hitSlop={8}>
                  <Text style={styles.action}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={() => setSelectionMode(true)} hitSlop={8}>
                <Text style={styles.action}>Select</Text>
              </TouchableOpacity>
            )
          ) : null}
        </View>
      )}

      {!loaded ? (
        <ActivityIndicator color={Colors.accentCyan} style={{ marginTop: Spacing.xl }} />
      ) : creations.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>🎨</Text>
          <Text style={styles.emptyText}>No creations yet.</Text>
          <TouchableOpacity
            style={styles.emptyCta}
            onPress={() => navigation.navigate('Create')}
          >
            <Ionicons name="sparkles" size={16} color={Colors.textInverse} />
            <Text style={styles.emptyCtaText}>Start Creating</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={creations}
          keyExtractor={(c) => c.key}
          renderItem={renderItem}
          numColumns={3}
          scrollEnabled={scrollEnabled}
          columnWrapperStyle={styles.row}
          contentContainerStyle={{ paddingBottom: contentPaddingBottom }}
        />
      )}

      <VideoPlayerModal
        visible={videoUri !== null}
        uri={videoUri}
        motionPrompt={videoPrompt}
        onClose={() => {
          setVideoUri(null);
          setVideoPrompt(null);
        }}
      />
      <TryOnDetailModal
        visible={detailJob !== null}
        job={detailJob}
        onClose={() => setDetailJob(null)}
        onPrivacyChanged={(jobId, isPrivate) => {
          setCreations((prev) =>
            prev.map((c) =>
              c.source === 'tryon' && c.job.id === jobId
                ? { ...c, job: { ...c.job, isPrivate } }
                : c,
            ),
          );
        }}
        onSavedChanged={(jobId, saved) => {
          setCreations((prev) =>
            prev.map((c) =>
              c.source === 'tryon' && c.job.id === jobId
                ? { ...c, job: { ...c.job, saved } }
                : c,
            ),
          );
        }}
      />

      {/* Lightweight viewer for closet (Design) images. */}
      <Modal
        visible={closetViewer !== null}
        animationType="fade"
        transparent={false}
        onRequestClose={() => setClosetViewer(null)}
      >
        {closetViewer ? (
          <View style={styles.viewer}>
            <View style={styles.viewerImageWrap}>
              <Image
                source={{ uri: closetViewer.imageUrl }}
                style={styles.viewerImage}
                resizeMode="contain"
              />
              <AiGeneratedBadge />
            </View>
            {closetViewer.name ? (
              <Text style={styles.viewerName} numberOfLines={1}>
                {closetViewer.name}
              </Text>
            ) : null}
            <View style={styles.viewerActions}>
              <TouchableOpacity
                style={styles.viewerPrimary}
                onPress={() => {
                  const item = closetViewer;
                  setClosetViewer(null);
                  // VideoScreen consumes useVideoSourceStore on focus; the old
                  // closet-store write left the source box empty on arrival.
                  setPendingSource({ imageUrl: item.imageUrl });
                  navigation.navigate('Video');
                }}
              >
                <Text style={styles.viewerPrimaryText}>Make a Video</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.viewerDelete}
                onPress={() => {
                  const item = closetViewer;
                  Alert.alert('Delete Image', `Remove "${item.name}" from your library?`, [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          await api.delete(`/closet/${item.id}`);
                          if (mounted.current) {
                            setCreations((prev) => prev.filter((c) => c.key !== `closet:${item.id}`));
                            setClosetViewer(null);
                          }
                        } catch {
                          Alert.alert('Error', 'Could not delete this image.');
                        }
                      },
                    },
                  ]);
                }}
              >
                <Text style={styles.viewerDeleteText}>Delete</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.viewerCancel} onPress={() => setClosetViewer(null)}>
                <Text style={styles.viewerCancelText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </Modal>
    </View>
  );
}

const GAP = Spacing.xs;

const styles = StyleSheet.create({
  container: { width: '100%' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
    minHeight: 24,
  },
  title: {
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  headerActions: { flexDirection: 'row', gap: Spacing.md },
  action: { color: Colors.accentCyan, fontWeight: Typography.fontWeightSemiBold },
  actionDanger: { color: Colors.danger },
  row: { justifyContent: 'space-between', marginBottom: GAP },
  item: {
    width: '32%',
    aspectRatio: 1,
    borderRadius: Radius.sm,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceElevated,
  },
  image: { width: '100%', height: '100%' },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  placeholderText: { color: Colors.textTertiary, fontSize: Typography.fontSizeXS },
  playBadge: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -16,
    marginTop: -16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  privateBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8,11,22,0.35)',
    alignItems: 'flex-end',
    padding: 6,
  },
  selOverlayActive: { backgroundColor: 'rgba(34,211,238,0.25)' },
  selCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selCheckActive: { backgroundColor: Colors.accentCyan, borderColor: Colors.accentCyan },
  empty: { alignItems: 'center', paddingVertical: Spacing.xxl, gap: Spacing.sm },
  emptyEmoji: { fontSize: 40 },
  emptyText: { color: Colors.textSecondary, fontSize: Typography.fontSizeMD },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.accent,
    borderRadius: Radius.full,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
  },
  emptyCtaText: { color: Colors.textInverse, fontWeight: Typography.fontWeightBold },
  viewer: { flex: 1, backgroundColor: Colors.background, paddingTop: 48 },
  viewerImageWrap: { flex: 1, margin: Spacing.md },
  viewerImage: { width: '100%', height: '100%' },
  viewerName: {
    color: Colors.textPrimary,
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightBold,
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
  },
  viewerActions: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.md, paddingBottom: 32, gap: Spacing.sm },
  viewerPrimary: {
    backgroundColor: Colors.surface,
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: 'center',
  },
  viewerPrimaryText: {
    color: Colors.textPrimary,
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightSemiBold,
  },
  viewerDelete: {
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.danger,
  },
  viewerDeleteText: {
    color: Colors.danger,
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightSemiBold,
  },
  viewerCancel: { paddingVertical: 12, alignItems: 'center' },
  viewerCancelText: { color: Colors.textSecondary, fontSize: Typography.fontSizeMD },
});
