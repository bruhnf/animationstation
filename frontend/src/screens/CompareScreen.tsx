import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import api from '../config/api';
import { Colors, Typography, Spacing } from '../constants/theme';
import RetryableImage from '../components/RetryableImage';
import AiGeneratedBadge from '../components/AiGeneratedBadge';
import type { TryOnJob } from '../types';
import type { RootStackParams } from '../navigation';

type Nav = NativeStackNavigationProp<RootStackParams, 'Compare'>;

// Brainstorm feature #4 — "Compare Creations". Pick two of your completed
// creations and view them side by side. Reuses the existing /tryon/history
// endpoint and the AI-generated badge; nothing new on the backend. Reached from
// the Profile menu ("Compare Creations").
export default function CompareScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();

  const [history, setHistory] = useState<TryOnJob[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Selected job ids, in tap order. Capped at 2.
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      setLoadError(false);
      const { data } = await api.get<{ jobs: TryOnJob[] }>('/tryon/history');
      // Only COMPLETE jobs that actually have a result image can be compared.
      const usable = (data.jobs ?? []).filter(
        (j) => j.status === 'COMPLETE' && (j.resultFullBodyUrl || j.resultMediumUrl),
      );
      if (mounted.current) setHistory(usable);
    } catch {
      if (mounted.current) setLoadError(true);
    } finally {
      if (mounted.current) setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id]; // drop the oldest, keep last two
      return [...prev, id];
    });
  }

  const jobById = (id: string) => history.find((j) => j.id === id);
  const resultUrl = (j?: TryOnJob) => j?.resultFullBodyUrl ?? j?.resultMediumUrl;

  const left = jobById(selected[0]);
  const right = jobById(selected[1]);

  const renderItem = ({ item }: { item: TryOnJob }) => {
    const url = resultUrl(item);
    const idx = selected.indexOf(item.id);
    const isSelected = idx >= 0;
    return (
      <TouchableOpacity
        style={styles.gridItem}
        onPress={() => toggle(item.id)}
        activeOpacity={0.85}
      >
        {url ? <RetryableImage uri={url} style={styles.gridImage} resizeMode="cover" /> : null}
        {isSelected ? (
          <View style={styles.selBadge}>
            <Text style={styles.selBadgeText}>{idx + 1}</Text>
          </View>
        ) : (
          <View style={styles.selEmpty} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Compare Creations</Text>
        <View style={styles.backBtn} />
      </View>

      {!loaded ? (
        <ActivityIndicator style={{ marginTop: Spacing.xl }} color={Colors.textPrimary} />
      ) : loadError ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>Couldn&apos;t load your creations.</Text>
          <TouchableOpacity
            onPress={() => {
              setLoaded(false);
              void load();
            }}
          >
            <Text style={styles.retryLink}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : history.length < 2 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyEmoji}>🖼️</Text>
          <Text style={styles.emptyText}>
            You need at least two completed creations to compare. Make a few more, then come back.
          </Text>
        </View>
      ) : (
        <>
          <Text style={styles.hint}>Pick two creations to compare side by side.</Text>
          <FlatList
            data={history}
            keyExtractor={(j) => j.id}
            renderItem={renderItem}
            numColumns={3}
            contentContainerStyle={[styles.grid, { paddingBottom: insets.bottom + 90 }]}
          />
          {selected.length === 2 ? (
            <View style={[styles.compareBar, { paddingBottom: insets.bottom + Spacing.sm }]}>
              <TouchableOpacity style={styles.compareBtn} onPress={() => setComparing(true)}>
                <Text style={styles.compareBtnText}>Compare</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </>
      )}

      {/* Split-screen viewer */}
      <Modal visible={comparing} animationType="slide" onRequestClose={() => setComparing(false)}>
        <View style={[styles.viewer, { paddingTop: insets.top }]}>
          <View style={styles.viewerHeader}>
            <Text style={styles.viewerTitle}>Side by side</Text>
            <TouchableOpacity onPress={() => setComparing(false)} hitSlop={12}>
              <Ionicons name="close" size={28} color={Colors.white} />
            </TouchableOpacity>
          </View>
          <View style={styles.split}>
            {[left, right].map((j, i) => {
              const url = resultUrl(j);
              return (
                <View key={i} style={styles.splitPane}>
                  {url ? (
                    <View style={styles.splitImageWrap}>
                      <RetryableImage uri={url} style={styles.splitImage} resizeMode="contain" />
                      <AiGeneratedBadge />
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  backBtn: { width: 40 },
  title: {
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  hint: {
    textAlign: 'center',
    color: Colors.gray600,
    fontSize: Typography.fontSizeSM,
    paddingVertical: Spacing.sm,
  },
  grid: { paddingHorizontal: 1 },
  gridItem: { flex: 1 / 3, aspectRatio: 1, padding: 1, position: 'relative' },
  gridImage: { width: '100%', height: '100%', borderRadius: 4 },
  selBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.black,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.white,
  },
  selBadgeText: { color: Colors.white, fontSize: 12, fontWeight: Typography.fontWeightBold },
  selEmpty: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  emptyWrap: { alignItems: 'center', paddingVertical: Spacing.xl, paddingHorizontal: Spacing.lg },
  emptyEmoji: { fontSize: 40, marginBottom: Spacing.sm },
  emptyText: { fontSize: Typography.fontSizeMD, color: Colors.gray600, textAlign: 'center' },
  retryLink: {
    marginTop: Spacing.sm,
    color: Colors.textPrimary,
    fontWeight: Typography.fontWeightSemiBold,
  },
  compareBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.gray200,
  },
  compareBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 26,
    paddingVertical: 15,
    alignItems: 'center',
  },
  compareBtnText: {
    color: Colors.textPrimary,
    fontWeight: Typography.fontWeightBold,
    fontSize: Typography.fontSizeMD,
  },
  viewer: { flex: 1, backgroundColor: Colors.black },
  viewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  viewerTitle: {
    color: Colors.white,
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightSemiBold,
  },
  split: { flex: 1, flexDirection: 'row' },
  splitPane: { flex: 1, padding: 2 },
  splitImageWrap: { flex: 1 },
  splitImage: { width: '100%', height: '100%' },
});
