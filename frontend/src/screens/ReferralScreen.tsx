import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Share } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import api from '../config/api';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import type { RootStackParams } from '../navigation';

type Nav = NativeStackNavigationProp<RootStackParams, 'Referral'>;

interface ReferralSummary {
  code: string;
  shareUrl: string;
  referredCount: number;
  pendingCount: number;
  creditsEarned: number;
  rewardPerReferral: number;
  offerActive: boolean;
}

// Brainstorm feature #5 — "Invite Friends & Earn Credits". Shows the user's
// referral code + share link and their earnings. The reward (both sides) is
// granted server-side when an invited friend verifies their email.
export default function ReferralScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const [summary, setSummary] = useState<ReferralSummary | null>(null);
  const [error, setError] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      setError(false);
      const { data } = await api.get<ReferralSummary>('/referral/me');
      if (mounted.current) setSummary(data);
    } catch {
      if (mounted.current) setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function shareInvite() {
    if (!summary) return;
    const reward = summary.offerActive
      ? ` We both get ${summary.rewardPerReferral} free credits!`
      : '';
    try {
      await Share.share({
        message: `Create AI images & videos on AnimationStation.${reward} Use my code ${summary.code}: ${summary.shareUrl}`,
        url: summary.shareUrl,
      });
    } catch {
      // cancelled — ignore
    }
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Invite Friends</Text>
        <View style={styles.backBtn} />
      </View>

      {!summary && !error ? (
        <ActivityIndicator style={{ marginTop: Spacing.xl }} color={Colors.textPrimary} />
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errText}>Couldn&apos;t load your invite info.</Text>
          <TouchableOpacity onPress={load}>
            <Text style={styles.retry}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : summary ? (
        <View style={styles.body}>
          <Text style={styles.emoji}>🎁</Text>
          <Text style={styles.headline}>
            {summary.offerActive
              ? `Give ${summary.rewardPerReferral}, get ${summary.rewardPerReferral} credits`
              : 'Invite friends to AnimationStation'}
          </Text>
          <Text style={styles.sub}>
            {summary.offerActive
              ? `When a friend signs up with your code and verifies their email, you each get ${summary.rewardPerReferral} free credits.`
              : 'Share AnimationStation with friends using your personal code.'}
          </Text>

          <Text style={styles.codeLabel}>YOUR CODE</Text>
          <TouchableOpacity style={styles.codeBox} onPress={shareInvite} activeOpacity={0.8}>
            <Text style={styles.code}>{summary.code}</Text>
            <Ionicons name="share-outline" size={20} color={Colors.gray600} />
          </TouchableOpacity>
          <View style={{ height: 18 }} />

          <TouchableOpacity style={styles.shareBtn} onPress={shareInvite}>
            <Ionicons name="share-outline" size={18} color={Colors.textPrimary} />
            <Text style={styles.shareText}>Share invite</Text>
          </TouchableOpacity>

          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{summary.referredCount}</Text>
              <Text style={styles.statLabel}>Friends joined</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{summary.creditsEarned}</Text>
              <Text style={styles.statLabel}>Credits earned</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{summary.pendingCount}</Text>
              <Text style={styles.statLabel}>Pending</Text>
            </View>
          </View>
        </View>
      ) : null}
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errText: { color: Colors.gray600, fontSize: Typography.fontSizeMD },
  retry: {
    marginTop: Spacing.sm,
    color: Colors.textPrimary,
    fontWeight: Typography.fontWeightSemiBold,
  },
  body: { paddingHorizontal: Spacing.lg, alignItems: 'center', paddingTop: Spacing.lg },
  emoji: { fontSize: 48, marginBottom: Spacing.sm },
  headline: {
    fontSize: Typography.fontSizeXL,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  sub: {
    fontSize: Typography.fontSizeMD,
    color: Colors.gray600,
    textAlign: 'center',
    marginTop: Spacing.sm,
    lineHeight: 21,
  },
  codeLabel: {
    marginTop: Spacing.xl,
    fontSize: Typography.fontSizeSM,
    color: Colors.gray400,
    fontWeight: Typography.fontWeightSemiBold,
    letterSpacing: 1,
  },
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.gray100,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    marginTop: Spacing.sm,
    alignSelf: 'stretch',
  },
  code: {
    fontSize: 26,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    letterSpacing: 3,
  },
  copiedNote: { color: Colors.success, fontSize: Typography.fontSizeSM, marginTop: 2, height: 18 },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.accent,
    borderRadius: 26,
    paddingVertical: 15,
    alignSelf: 'stretch',
    marginTop: Spacing.sm,
  },
  shareText: {
    color: Colors.textPrimary,
    fontWeight: Typography.fontWeightBold,
    fontSize: Typography.fontSizeMD,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignSelf: 'stretch',
    marginTop: Spacing.xl,
  },
  stat: { alignItems: 'center' },
  statNum: {
    fontSize: Typography.fontSizeXL,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
  },
  statLabel: { fontSize: Typography.fontSizeSM, color: Colors.gray600, marginTop: 2 },
});
