import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { navigationRef } from '../navigation/navigationRef';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Gradients, Spacing, Radius, Typography } from '../constants/theme';
import { useUserStore } from '../store/useUserStore';
import { useNotificationStore } from '../store/useNotificationStore';
import Logo from '../components/ui/Logo';

// The AnimationStation hub — the neon hero ("Imagine. Create. Transcend."), a
// primary "Start Creating" CTA, the two headline creation modes (AI Image /
// Video), and the value props. It is used ONLY as the admin-toggleable welcome
// splash now (the Home tab is the global feed). In splash mode it renders a
// close button + a "Do not display at next login" checkbox, and every action
// dismisses the splash before navigating.
export interface HubSplashProps {
  onDismiss: () => void;
  dontShowAgain: boolean;
  onToggleDontShow: () => void;
}

export default function HomeHubScreen({ splash }: { splash?: HubSplashProps }) {
  const insets = useSafeAreaInsets();
  const user = useUserStore((s) => s.user);
  const unread = useNotificationStore((s) => s.unreadCount);
  const isGuest = user?.isGuest === true;

  // This screen renders as the welcome splash — a <Modal> mounted OUTSIDE the
  // navigator (navigation/index.tsx) — so useNavigation() would throw ("no
  // navigation object"). Navigate through the global ref instead (a no-op until
  // the tree is ready). Loose string arg mirrors the previous useNavigation<any>().
  const navigate = (name: string) => {
    if (navigationRef.isReady()) {
      (navigationRef.navigate as unknown as (n: string) => void)(name);
    }
  };

  // In splash mode, dismiss the overlay before navigating so the destination
  // isn't rendered underneath the modal.
  const go = (fn: () => void) => {
    if (splash) splash.onDismiss();
    fn();
  };
  const goCreate = () => go(() => navigate('Create'));
  const goImage = () => go(() => navigate('TryOn'));
  const goVideo = () => go(() => navigate('Video'));
  const goDesign = () => go(() => navigate('Design'));

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      {/* Ambient top wash for depth */}
      <LinearGradient
        colors={Gradients.canvasTop}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.sm, paddingBottom: Spacing.xxl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header: wordmark + (splash) close, or notifications/profile */}
        <View style={styles.header}>
          <Logo height={26} />
          {splash ? (
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={splash.onDismiss}
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={22} color={Colors.textPrimary} />
            </TouchableOpacity>
          ) : (
            <View style={styles.headerRight}>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => navigate(isGuest ? 'Profile' : 'Inbox')}
                accessibilityLabel="Notifications"
              >
                <Ionicons name="notifications-outline" size={20} color={Colors.textPrimary} />
                {!isGuest && unread > 0 ? <View style={styles.dot} /> : null}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.avatarBtn}
                onPress={() => navigate('Profile')}
                accessibilityLabel="Profile"
              >
                <LinearGradient colors={Gradients.primary} style={styles.avatarRing}>
                  <View style={styles.avatarInner}>
                    <Ionicons name="person" size={16} color={Colors.textPrimary} />
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroCopy}>
            <Text style={styles.heroLine}>Imagine.</Text>
            <Text style={[styles.heroLine, { color: Colors.accentCyan }]}>Create.</Text>
            <Text style={[styles.heroLine, { color: Colors.accentPurple }]}>Transcend.</Text>
            <Text style={styles.heroSub}>AI-powered creation.{'\n'}Limitless possibilities.</Text>
            <TouchableOpacity activeOpacity={0.9} onPress={goCreate} style={styles.ctaWrap}>
              <LinearGradient
                colors={Gradients.primary}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.cta}
              >
                <Ionicons name="sparkles" size={16} color={Colors.textInverse} />
                <Text style={styles.ctaText}>Start Creating</Text>
                <Ionicons name="chevron-forward" size={16} color={Colors.textInverse} />
              </LinearGradient>
            </TouchableOpacity>
          </View>
          {/* Neon orb — stands in for the hero art */}
          <View style={styles.orbWrap} pointerEvents="none">
            <LinearGradient colors={Gradients.image} style={styles.orbGlow} />
            <LinearGradient colors={Gradients.primary} style={styles.orb}>
              <Ionicons name="planet-outline" size={44} color={Colors.white} />
            </LinearGradient>
          </View>
        </View>

        {/* Create with AI */}
        <SectionHeader title="Create with AI" actionLabel="View all" onAction={goCreate} />
        <View style={styles.rowCards}>
          <FeatureBig
            gradient={Gradients.image}
            icon="image"
            title="AI Image Creation"
            desc="Generate stunning images from text and photos in seconds."
            tag="Text → Image"
            onPress={goDesign}
          />
          <FeatureBig
            gradient={Gradients.video}
            icon="videocam"
            title="AI Video Creation"
            desc="Turn ideas into cinematic short videos with AI."
            tag="Image → Video"
            onPress={goVideo}
          />
        </View>

        {/* Transform (image + prompt) as a full-width highlight */}
        <TouchableOpacity activeOpacity={0.9} onPress={goImage} style={styles.wideCard}>
          <View style={styles.wideIcon}>
            <LinearGradient colors={Gradients.purple} style={styles.wideIconFill}>
              <Ionicons name="color-wand" size={20} color={Colors.white} />
            </LinearGradient>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.wideTitle}>Transform an Image</Text>
            <Text style={styles.wideDesc}>Upload a photo, add a prompt, reimagine it.</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={Colors.textSecondary} />
        </TouchableOpacity>

        {/* Why AnimationStation */}
        <SectionHeader title="Why AnimationStation" />
        <View style={styles.techRow}>
          <TechCard
            gradient={Gradients.blue}
            icon="cube"
            title="Advanced AI Models"
            desc="Cutting-edge models for unmatched results."
          />
          <TechCard
            gradient={Gradients.purple}
            icon="flash"
            title="Supercharged"
            desc="Blazing-fast generation, superb quality."
          />
          <TechCard
            gradient={Gradients.teal}
            icon="shield-checkmark"
            title="Secure & Private"
            desc="Your creations stay yours."
          />
        </View>

        {splash ? (
          <View style={styles.splashFooter}>
            <TouchableOpacity
              style={styles.dontShowRow}
              onPress={splash.onToggleDontShow}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: splash.dontShowAgain }}
            >
              <Ionicons
                name={splash.dontShowAgain ? 'checkbox' : 'square-outline'}
                size={20}
                color={splash.dontShowAgain ? Colors.accentCyan : Colors.textSecondary}
              />
              <Text style={styles.dontShowText}>Do not display at next login</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.9} onPress={splash.onDismiss} style={styles.continueBtn}>
              <LinearGradient
                colors={Gradients.primary}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.continueFill}
              >
                <Text style={styles.continueText}>Continue to app</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function SectionHeader({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {actionLabel && onAction ? (
        <TouchableOpacity onPress={onAction} hitSlop={8}>
          <Text style={styles.sectionAction}>{actionLabel} ›</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function FeatureBig({
  gradient,
  icon,
  title,
  desc,
  tag,
  onPress,
}: {
  gradient: readonly [string, string, ...string[]];
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  desc: string;
  tag: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.bigCard} onPress={onPress}>
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.bigCardGlow}
      />
      <View style={styles.bigIcon}>
        <Ionicons name={icon} size={22} color={Colors.white} />
      </View>
      <Text style={styles.bigTitle}>{title}</Text>
      <Text style={styles.bigDesc}>{desc}</Text>
      <View style={styles.tagPill}>
        <Ionicons name="sparkles" size={11} color={Colors.textPrimary} />
        <Text style={styles.tagText}>{tag}</Text>
      </View>
    </Pressable>
  );
}

function TechCard({
  gradient,
  icon,
  title,
  desc,
}: {
  gradient: readonly [string, string, ...string[]];
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  desc: string;
}) {
  return (
    <View style={styles.techCard}>
      <LinearGradient colors={gradient} style={styles.techIcon}>
        <Ionicons name={icon} size={18} color={Colors.white} />
      </LinearGradient>
      <Text style={styles.techTitle}>{title}</Text>
      <Text style={styles.techDesc}>{desc}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.lg,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceGlass,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    top: 9,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.accentCyan,
  },
  avatarBtn: { width: 40, height: 40 },
  avatarRing: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInner: {
    width: 34,
    height: 34,
    borderRadius: Radius.full,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: { flexDirection: 'row', marginBottom: Spacing.xl },
  heroCopy: { flex: 1, paddingRight: Spacing.sm },
  heroLine: {
    fontSize: 34,
    lineHeight: 38,
    fontWeight: Typography.fontWeightHeavy,
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  heroSub: {
    marginTop: Spacing.md,
    color: Colors.textSecondary,
    fontSize: Typography.fontSizeMD,
    lineHeight: 20,
  },
  ctaWrap: { marginTop: Spacing.lg, alignSelf: 'flex-start', borderRadius: Radius.full, ...Shadow_cta() },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 14,
    paddingHorizontal: 22,
    borderRadius: Radius.full,
  },
  ctaText: {
    color: Colors.textInverse,
    fontWeight: Typography.fontWeightBold,
    fontSize: Typography.fontSizeMD,
  },
  orbWrap: { width: 96, alignItems: 'center', justifyContent: 'center' },
  orbGlow: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    opacity: 0.35,
  },
  orb: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
    marginTop: Spacing.sm,
  },
  sectionTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightBold,
  },
  sectionAction: { color: Colors.accentCyan, fontSize: Typography.fontSizeSM, fontWeight: '600' },
  rowCards: { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.md },
  bigCard: {
    flex: 1,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    minHeight: 150,
  },
  bigCardGlow: { position: 'absolute', top: -30, right: -30, width: 90, height: 90, borderRadius: 45, opacity: 0.5 },
  bigIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceGlass,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  bigTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightBold,
    marginBottom: 4,
  },
  bigDesc: { color: Colors.textSecondary, fontSize: Typography.fontSizeXS, lineHeight: 16, flex: 1 },
  tagPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: Spacing.sm,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceGlass,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tagText: { color: Colors.textPrimary, fontSize: 10, fontWeight: '600' },
  wideCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.sm,
  },
  wideIcon: { width: 44, height: 44 },
  wideIconFill: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wideTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.fontSizeMD,
    fontWeight: Typography.fontWeightBold,
  },
  wideDesc: { color: Colors.textSecondary, fontSize: Typography.fontSizeXS, marginTop: 2 },
  techRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  techCard: {
    flex: 1,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  techIcon: {
    width: 34,
    height: 34,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  techTitle: { color: Colors.textPrimary, fontSize: Typography.fontSizeSM, fontWeight: '700' },
  techDesc: { color: Colors.textSecondary, fontSize: 11, lineHeight: 14, marginTop: 2 },
  splashFooter: { marginTop: Spacing.xl, gap: Spacing.md },
  dontShowRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, alignSelf: 'center' },
  dontShowText: { color: Colors.textSecondary, fontSize: Typography.fontSizeSM },
  continueBtn: { borderRadius: Radius.full, overflow: 'hidden' },
  continueFill: { paddingVertical: 15, alignItems: 'center', borderRadius: Radius.full },
  continueText: {
    color: Colors.textInverse,
    fontWeight: Typography.fontWeightBold,
    fontSize: Typography.fontSizeMD,
  },
});

// Small helper so the CTA glow lives with the token system without importing the
// Shadow object name into the stylesheet literal above.
function Shadow_cta() {
  return {
    shadowColor: Colors.accentCyan,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 8,
  };
}
