import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import api from '../config/api';
import { Colors, Typography, Spacing } from '../constants/theme';
import RetryableImage from '../components/RetryableImage';
import AiGeneratedBadge from '../components/AiGeneratedBadge';
import { unsaveLook } from '../utils/looks';
import { shareTryOn } from '../utils/share';
import type { TryOnJob } from '../types';
import type { RootStackParams } from '../navigation';

type Nav = NativeStackNavigationProp<RootStackParams, 'SavedLooks'>;
type SavedLook = TryOnJob & { savedAt: string };

// Brainstorm feature #1 — "Saved Creations". The user's bookmarked results
// in one place: re-view, share, or remove. Closes the create -> keep loop.
// Backed by GET/POST/DELETE /api/looks.
export default function SavedLooksScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const [looks, setLooks] = useState<SavedLook[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      setError(false);
      const { data } = await api.get<{ looks: SavedLook[] }>('/looks');
      if (mounted.current) setLooks(data.looks ?? []);
    } catch {
      if (mounted.current) setError(true);
    } finally {
      if (mounted.current) setLoaded(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      mounted.current = true;
      void load();
      return () => {
        mounted.current = false;
      };
    }, [load]),
  );

  async function remove(jobId: string) {
    // Optimistic — drop it, then call the API.
    setLooks((prev) => prev.filter((l) => l.id !== jobId));
    await unsaveLook(jobId);
  }

  const renderItem = ({ item }: { item: SavedLook }) => {
    const url = item.resultFullBodyUrl ?? item.resultMediumUrl;
    return (
      <View style={styles.cell}>
        {url ? <RetryableImage uri={url} style={styles.image} resizeMode="cover" /> : null}
        <AiGeneratedBadge />
        <View style={styles.cellActions}>
          <TouchableOpacity style={styles.cellBtn} onPress={() => shareTryOn(item.id)} hitSlop={8}>
            <Ionicons name="share-outline" size={16} color={Colors.white} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.cellBtn} onPress={() => remove(item.id)} hitSlop={8}>
            <Ionicons name="bookmark" size={16} color={Colors.gold} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Saved Creations</Text>
        <View style={styles.backBtn} />
      </View>

      {!loaded ? (
        <ActivityIndicator style={{ marginTop: Spacing.xl }} color={Colors.textPrimary} />
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.muted}>Couldn&apos;t load your saved creations.</Text>
          <TouchableOpacity
            onPress={() => {
              setLoaded(false);
              void load();
            }}
          >
            <Text style={styles.retry}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : looks.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emoji}>🔖</Text>
          <Text style={styles.muted}>
            No saved creations yet. Tap the bookmark on any creation to save it here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={looks}
          keyExtractor={(l) => l.id}
          renderItem={renderItem}
          numColumns={2}
          contentContainerStyle={{ padding: 2, paddingBottom: insets.bottom + Spacing.lg }}
        />
      )}
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  emoji: { fontSize: 44, marginBottom: Spacing.sm },
  muted: { color: Colors.gray600, fontSize: Typography.fontSizeMD, textAlign: 'center' },
  retry: {
    marginTop: Spacing.sm,
    color: Colors.textPrimary,
    fontWeight: Typography.fontWeightSemiBold,
  },
  cell: { flex: 1 / 2, aspectRatio: 3 / 4, padding: 2, position: 'relative' },
  image: { width: '100%', height: '100%', borderRadius: 6 },
  cellActions: { position: 'absolute', top: 8, right: 8, flexDirection: 'row', gap: 6 },
  cellBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
