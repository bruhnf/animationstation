import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUserStore } from '../store/useUserStore';
import { useConfigStore } from '../store/useConfigStore';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { RootStackParams } from '../navigation';
import FeatureCard from '../components/ui/FeatureCard';
import CreditDisplay from '../components/CreditDisplay';

/**
 * The Create hub — the single landing spot for every creation feature, opened by
 * the center tab. Replaces the old "press TryOn → dead-end" flow. Available to
 * guests and real users alike (guests can use any feature they have credits for;
 * the destination screens handle out-of-credits + sign-up nudges).
 */
export default function CreateHubScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const insets = useSafeAreaInsets();
  const user = useUserStore((s) => s.user);
  const isGuest = user?.isGuest === true;
  const credits = user?.credits ?? 0;
  const videoCost = useConfigStore((s) => s.videoCreditCost);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>Create</Text>
          <Text style={styles.title}>What will you make?</Text>
        </View>
        <CreditDisplay onPress={() => navigation.navigate('Purchase')} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xxl }]}
        showsVerticalScrollIndicator={false}
      >
        {isGuest ? (
          <View style={styles.guestNote}>
            <Ionicons name="sparkles" size={18} color={Colors.goldText} />
            <Text style={styles.guestNoteText}>
              You have {credits} free {credits === 1 ? 'credit' : 'credits'} to explore — no account
              needed yet.
            </Text>
          </View>
        ) : null}

        <Text style={styles.sectionLabel}>Most loved</Text>
        <FeatureCard
          icon="sparkles"
          title="Generate from a Prompt"
          subtitle="Describe anything and let AI create an image for you."
          highlight
          tag="Popular"
          onPress={() => navigation.navigate('Design')}
        />
        <View style={{ height: Spacing.md }} />
        <FeatureCard
          icon="videocam"
          title="Make a Video"
          subtitle={`Animate an image into a short AI clip · ${videoCost} credits`}
          highlight
          onPress={() => navigation.navigate('Video')}
        />

        <Text style={[styles.sectionLabel, { marginTop: Spacing.xl }]}>More ways to create</Text>
        <FeatureCard
          icon="color-wand"
          title="Transform an Image"
          subtitle="Upload a reference image and a prompt to reimagine it."
          onPress={() => navigation.navigate('TryOn')}
        />
        <View style={{ height: Spacing.md }} />
        <FeatureCard
          icon="image"
          title="Clean Up a Photo"
          subtitle="Turn a messy screenshot into a clean, polished image."
          onPress={() => navigation.navigate('CleanUp')}
        />
        <View style={{ height: Spacing.md }} />
        <FeatureCard
          icon="images"
          title="My Library"
          subtitle="Your saved creations, ready to revisit anytime."
          onPress={() => navigation.navigate('Closet', undefined)}
        />

        {isGuest ? (
          <TouchableOpacity
            style={styles.upsell}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Auth', { screen: 'Signup' })}
          >
            <Text style={styles.upsellTitle}>Want more credits?</Text>
            <Text style={styles.upsellText}>
              Create a free account for bonus credits — no credit card, no subscription.
            </Text>
            <View style={styles.upsellBtn}>
              <Text style={styles.upsellBtnText}>Sign Up Free</Text>
              <Ionicons name="arrow-forward" size={16} color={Colors.black} />
            </View>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.white },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  kicker: {
    fontSize: Typography.fontSizeSM,
    fontWeight: Typography.fontWeightBold,
    color: Colors.goldText,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: Typography.fontSizeXXL,
    fontWeight: Typography.fontWeightHeavy,
    color: Colors.black,
  },
  scroll: { flex: 1 },
  content: { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
  guestNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.goldSoft,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  guestNoteText: {
    flex: 1,
    color: Colors.goldText,
    fontSize: Typography.fontSizeSM,
    fontWeight: Typography.fontWeightMedium,
  },
  sectionLabel: {
    fontSize: Typography.fontSizeSM,
    fontWeight: Typography.fontWeightBold,
    color: Colors.gray600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
  },
  upsell: {
    marginTop: Spacing.xl,
    backgroundColor: Colors.black,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
  },
  upsellTitle: {
    color: Colors.white,
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightHeavy,
  },
  upsellText: {
    color: Colors.gray200,
    fontSize: Typography.fontSizeSM,
    marginTop: Spacing.xs,
    marginBottom: Spacing.md,
  },
  upsellBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.xs,
    backgroundColor: Colors.gold,
    borderRadius: Radius.full,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  upsellBtnText: {
    color: Colors.black,
    fontWeight: Typography.fontWeightBold,
    fontSize: Typography.fontSizeMD,
  },
});
