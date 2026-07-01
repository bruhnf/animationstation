import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { TryOnJob } from '../types';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import AiGeneratedBadge from './AiGeneratedBadge';
import RetryableImage from './RetryableImage';

interface Props {
  job: TryOnJob;
  onPress?: () => void;
}

export default function TryOnResultCard({ job, onPress }: Props) {
  const displayUrl = job.resultFullBodyUrl ?? job.resultMediumUrl;
  const isPending = job.status === 'PENDING' || job.status === 'PROCESSING';
  const isFailed = job.status === 'FAILED';

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.imageWrap}>
        {isPending ? (
          <View style={styles.pendingOverlay}>
            <ActivityIndicator color={Colors.white} />
            <Text style={styles.pendingText}>Generating…</Text>
          </View>
        ) : isFailed ? (
          <View style={styles.failedOverlay}>
            <Text style={styles.failedText}>Failed</Text>
          </View>
        ) : displayUrl ? (
          <>
            <RetryableImage uri={displayUrl} style={styles.resultImage} resizeMode="cover" />
            <AiGeneratedBadge />
          </>
        ) : null}

        {job.clothingPhoto1Url && (
          <RetryableImage
            uri={job.clothingPhoto1Url}
            style={styles.clothingThumb}
            resizeMode="cover"
          />
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.date}>{new Date(job.createdAt).toLocaleDateString()}</Text>
        <StatusBadge status={job.status} />
      </View>
    </TouchableOpacity>
  );
}

function StatusBadge({ status }: { status: TryOnJob['status'] }) {
  const colors: Record<TryOnJob['status'], string> = {
    PENDING: Colors.warning,
    PROCESSING: Colors.warning,
    COMPLETE: Colors.success,
    FAILED: Colors.danger,
  };
  return (
    <View style={[styles.badge, { backgroundColor: colors[status] }]}>
      <Text style={styles.badgeText}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.gray200,
  },
  imageWrap: { position: 'relative', aspectRatio: 3 / 4, backgroundColor: Colors.gray100 },
  resultImage: { width: '100%', height: '100%' },
  pendingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  pendingText: { color: Colors.white, fontSize: Typography.fontSizeSM },
  failedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(229,57,53,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  failedText: { color: Colors.danger, fontWeight: Typography.fontWeightBold },
  clothingThumb: {
    position: 'absolute',
    bottom: Spacing.sm,
    right: Spacing.sm,
    width: 50,
    height: 66,
    borderRadius: Radius.sm,
    borderWidth: 2,
    borderColor: Colors.white,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.sm,
  },
  date: { fontSize: Typography.fontSizeXS, color: Colors.gray600 },
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  badgeText: { color: Colors.white, fontSize: 9, fontWeight: Typography.fontWeightBold },
});
