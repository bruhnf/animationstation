import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  ActivityIndicator,
  Image,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import api from '../config/api';
import { useClosetStore } from '../store/useClosetStore';
import { ClosetItem } from '../types';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import CreditDisplay from '../components/CreditDisplay';
import AiGeneratedBadge from '../components/AiGeneratedBadge';
import { RootStackParams } from '../navigation';

type ClosetNavProp = NativeStackNavigationProp<RootStackParams, 'Closet'>;
type ClosetRouteProp = RouteProp<RootStackParams, 'Closet'>;

// "Library" — a scrollable grid of the user's saved creations. Generating
// happens on the separate DesignScreen; this screen is just the library. Opened
// with { picker: true } from the Video screen, tapping an item hands it back;
// opened normally, tapping opens the full-screen viewer.
export default function ClosetScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<ClosetNavProp>();
  const route = useRoute<ClosetRouteProp>();
  const pickerMode = route.params?.picker === true;
  const setPendingSelection = useClosetStore((s) => s.setPendingSelection);

  const [items, setItems] = useState<ClosetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [viewerItem, setViewerItem] = useState<ClosetItem | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadCloset = useCallback(async () => {
    try {
      setLoadError(false);
      const { data } = await api.get<{ items: ClosetItem[] }>('/closet');
      if (isMountedRef.current) setItems(data.items);
    } catch {
      if (isMountedRef.current) setLoadError(true);
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCloset();
  }, [loadCloset]);

  function handleTryOn(item: ClosetItem) {
    setPendingSelection(item);
    if (pickerMode) {
      navigation.goBack();
    } else {
      navigation.navigate('TryOn');
    }
  }

  function handleItemPress(item: ClosetItem) {
    if (pickerMode) {
      handleTryOn(item);
      return;
    }
    setViewerItem(item);
  }

  function confirmDelete(item: ClosetItem) {
    Alert.alert(
      'Delete Image',
      `Remove "${item.name}" from your library? Videos you already made with it are kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/closet/${item.id}`);
              if (isMountedRef.current) {
                setItems((prev) => prev.filter((i) => i.id !== item.id));
                setViewerItem((current) => (current?.id === item.id ? null : current));
              }
            } catch {
              Alert.alert('Error', 'Could not delete this image. Please try again.');
            }
          },
        },
      ],
    );
  }

  const renderItem = ({ item }: { item: ClosetItem }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => handleItemPress(item)}
      activeOpacity={0.85}
    >
      <View style={styles.cardImageWrap}>
        <Image source={{ uri: item.imageUrl }} style={styles.cardImage} resizeMode="cover" />
        <AiGeneratedBadge />
      </View>
      <Text style={styles.cardName} numberOfLines={2}>
        {item.name}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
        {navigation.canGoBack() ? (
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={26} color={Colors.textPrimary} />
          </TouchableOpacity>
        ) : (
          <View style={styles.backBtn} />
        )}
        <Text style={styles.title}>{pickerMode ? 'Pick from Library' : 'Library'}</Text>
        <CreditDisplay onPress={() => navigation.navigate('Purchase')} />
      </View>

      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + Spacing.xl }]}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={styles.emptySpinner} color={Colors.textPrimary} />
          ) : loadError ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>Couldn&apos;t load your library.</Text>
              <TouchableOpacity
                onPress={() => {
                  setLoading(true);
                  void loadCloset();
                }}
              >
                <Text style={styles.retryLink}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyEmoji}>🖼️</Text>
              <Text style={styles.emptyText}>Your library is empty.</Text>
              {!pickerMode ? (
                <TouchableOpacity
                  style={styles.designLink}
                  onPress={() => navigation.navigate('Design')}
                >
                  <Ionicons name="color-palette" size={16} color={Colors.textPrimary} />
                  <Text style={styles.designLinkText}>Generate an Image</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )
        }
      />

      <Modal
        visible={viewerItem !== null}
        animationType="fade"
        onRequestClose={() => setViewerItem(null)}
      >
        {viewerItem ? (
          <View style={[styles.viewer, { paddingTop: insets.top }]}>
            <View style={styles.viewerImageWrap}>
              <Image
                source={{ uri: viewerItem.imageUrl }}
                style={styles.viewerImage}
                resizeMode="contain"
              />
              <AiGeneratedBadge />
            </View>
            <Text style={styles.viewerName} numberOfLines={1}>
              {viewerItem.name}
            </Text>
            <Text style={styles.viewerDescription} numberOfLines={2}>
              {viewerItem.description}
            </Text>
            <View style={[styles.viewerActions, { paddingBottom: insets.bottom + Spacing.md }]}>
              <TouchableOpacity
                style={styles.viewerTryOnBtn}
                onPress={() => {
                  const item = viewerItem;
                  setViewerItem(null);
                  handleTryOn(item);
                }}
              >
                <Text style={styles.viewerTryOnText}>Make a Video</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.viewerDeleteBtn}
                onPress={() => confirmDelete(viewerItem)}
              >
                <Text style={styles.viewerDeleteText}>Delete</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.viewerCancelBtn} onPress={() => setViewerItem(null)}>
                <Text style={styles.viewerCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
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
  backBtn: { width: 50 },
  title: {
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  listContent: { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
  row: { gap: Spacing.sm },
  card: { flex: 1, marginBottom: Spacing.md, maxWidth: '49%' },
  cardImageWrap: {
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: Colors.gray100,
    aspectRatio: 3 / 4,
  },
  cardImage: { width: '100%', height: '100%' },
  cardName: { marginTop: 6, fontSize: Typography.fontSizeSM, color: Colors.textPrimary },
  emptySpinner: { marginTop: Spacing.xl },
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: Spacing.xxl,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  emptyEmoji: { fontSize: 40 },
  emptyText: { fontSize: Typography.fontSizeMD, color: Colors.gray600, textAlign: 'center' },
  retryLink: {
    marginTop: Spacing.sm,
    color: Colors.textPrimary,
    fontWeight: Typography.fontWeightSemiBold,
  },
  designLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.accent,
    borderRadius: Radius.full,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
  },
  designLinkText: {
    color: Colors.textPrimary,
    fontWeight: Typography.fontWeightBold,
    fontSize: Typography.fontSizeMD,
  },
  viewer: { flex: 1, backgroundColor: Colors.black },
  viewerImageWrap: { flex: 1, margin: Spacing.md },
  viewerImage: { width: '100%', height: '100%' },
  viewerName: {
    color: Colors.white,
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightBold,
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
  },
  viewerDescription: {
    color: Colors.gray400,
    fontSize: Typography.fontSizeSM,
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
    marginTop: 4,
  },
  viewerActions: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.md, gap: Spacing.sm },
  viewerTryOnBtn: {
    backgroundColor: Colors.surface,
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: 'center',
  },
  viewerTryOnText: {
    color: Colors.textPrimary,
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightSemiBold,
  },
  viewerDeleteBtn: {
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
  viewerCancelBtn: { paddingVertical: 12, alignItems: 'center' },
  viewerCancelText: { color: Colors.gray400, fontSize: Typography.fontSizeMD },
});
