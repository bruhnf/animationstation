import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Linking,
  Platform,
  Switch,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import api from '../config/api';
import { useUserStore } from '../store/useUserStore';
import * as WebBrowser from 'expo-web-browser';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import Constants from 'expo-constants';
import { Colors, Typography, Spacing } from '../constants/theme';
import { RootStackParams } from '../navigation';
import { MANAGE_SUBSCRIPTIONS_URL, restorePurchases } from '../services/iap';
import { PRIVACY_POLICY_URL, SUPPORT_EMAIL, TERMS_OF_SERVICE_URL } from '../constants/legal';
import { getSplashLocalState, setSplashLocalState } from '../utils/splash';

type SettingsNavProp = NativeStackNavigationProp<RootStackParams, 'Settings'>;

export default function SettingsScreen() {
  const navigation = useNavigation<SettingsNavProp>();
  const { user, logout, refreshUser } = useUserStore();
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // Announcement (splash) preference for the CURRENTLY published splash.
  // null = no splash is published right now (row shows a hint instead of a
  // switch). A newly published splash always shows at least once regardless
  // of this setting — it only opts out of re-showing the current one.
  const [splashId, setSplashId] = useState<string | null>(null);
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/splash');
        if (cancelled || !data?.active || !data.id) return;
        const stored = await getSplashLocalState();
        if (cancelled) return;
        setSplashId(data.id);
        setShowSplash(!(stored && stored.id === data.id && stored.dismissed));
      } catch {
        // Offline — leave the row in its "no announcement" state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleToggleSplash(value: boolean) {
    if (!splashId) return;
    setShowSplash(value);
    const stored = await getSplashLocalState();
    const base =
      stored && stored.id === splashId ? stored : { id: splashId, seenCount: 1, dismissed: false };
    await setSplashLocalState({ ...base, dismissed: !value });
  }

  async function handleRestorePurchases() {
    setRestoring(true);
    try {
      const { restoredCount } = await restorePurchases();
      await refreshUser();
      Alert.alert(
        restoredCount > 0 ? 'Purchases Restored' : 'No Purchases Found',
        restoredCount > 0
          ? `Restored ${restoredCount} purchase${restoredCount === 1 ? '' : 's'}.`
          : 'We did not find any prior purchases for this Apple ID.',
      );
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not restore purchases.');
    } finally {
      setRestoring(false);
    }
  }

  function handleManageSubscription() {
    Linking.openURL(MANAGE_SUBSCRIPTIONS_URL).catch(() =>
      Alert.alert('Could not open', 'Open the App Store app and go to your account settings.'),
    );
  }

  function handleLogout() {
    Alert.alert('Log Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: logout },
    ]);
  }

  function handleDeleteAccount() {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account, all photos, creations, and personal data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete My Account',
          style: 'destructive',
          onPress: async () => {
            setDeletingAccount(true);
            try {
              await api.delete('/profile/me');
              await logout();
            } catch {
              Alert.alert(
                'Error',
                'Could not delete account. Please try again or contact support.',
              );
            } finally {
              setDeletingAccount(false);
            }
          },
        },
      ],
    );
  }

  const [exporting, setExporting] = useState(false);

  async function handleExportData() {
    Alert.alert(
      'Export Your Data',
      'A JSON file containing your profile, creation history, location records, credit transactions, and other account data will be generated. You can save it or share it with another app.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Export',
          onPress: async () => {
            setExporting(true);
            try {
              const { data } = await api.get('/profile/me/export', { responseType: 'json' });
              const filename = `animationstation-export-${user?.username ?? 'me'}-${new Date().toISOString().slice(0, 10)}.json`;
              const fileUri = `${FileSystem.documentDirectory}${filename}`;
              await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(data, null, 2), {
                encoding: FileSystem.EncodingType.UTF8,
              });
              const canShare = await Sharing.isAvailableAsync();
              if (canShare) {
                await Sharing.shareAsync(fileUri, {
                  mimeType: 'application/json',
                  dialogTitle: 'Save your AnimationStation data export',
                  UTI: 'public.json',
                });
              } else {
                Alert.alert('Saved', `Export written to ${fileUri}`);
              }
            } catch {
              Alert.alert('Error', 'Could not export your data. Please try again later.');
            } finally {
              setExporting(false);
            }
          },
        },
      ],
    );
  }

  function handleRevokeAiConsent() {
    Alert.alert(
      'Revoke AI Processing Consent',
      "Future creations will be blocked until you re-confirm consent. Existing creations are kept and aren't affected. You can re-grant consent the next time you tap Generate.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete('/profile/me/ai-consent');
              await refreshUser();
              Alert.alert('Done', 'AI processing consent has been revoked.');
            } catch {
              Alert.alert('Error', 'Could not revoke consent. Please try again.');
            }
          },
        },
      ],
    );
  }

  function handleContactSupport() {
    const subject = `AnimationStation Support — v${Constants.expoConfig?.version ?? ''}`;
    const body = `\n\n---\nUsername: @${user?.username ?? ''}\nTier: ${user?.tier ?? 'FREE'}\nApp version: ${Constants.expoConfig?.version ?? ''}\nPlatform: ${Platform.OS}`;
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    Linking.openURL(url).catch(() =>
      Alert.alert('Could not open mail app', `Please email us at ${SUPPORT_EMAIL}.`),
    );
  }

  function handleDeletePhotos() {
    Alert.alert(
      'Delete All Photos',
      'This will remove all your saved photos and they will no longer be available for new creations. Creations already generated will not be affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Photos',
          style: 'destructive',
          onPress: async () => {
            try {
              await Promise.all([
                api.delete('/upload/avatar').catch(() => {}),
                api.delete('/upload/full-body').catch(() => {}),
                api.delete('/upload/medium-body').catch(() => {}),
              ]);
              Alert.alert('Done', 'Your photos have been removed.');
            } catch {
              Alert.alert('Error', 'Some photos could not be removed.');
            }
          },
        },
      ],
    );
  }

  return (
    <ScrollView style={styles.container}>
      <SectionHeader label="Account" />
      <SettingRow label="Email" value={user?.email ?? undefined} />
      <SettingRow label="Username" value={`@${user?.username}`} />
      <SettingRow label="Tier" value={user?.tier ?? 'FREE'} />
      <SettingRow label="Credits" value={String(user?.credits ?? 0)} />
      <SettingButton
        label="Change Password"
        onPress={() => navigation.navigate('ChangePassword')}
      />

      <SectionHeader label="Invite & Earn" />
      <SettingButton label="Invite Friends" onPress={() => navigation.navigate('Referral')} />

      <SectionHeader label="Subscription" />
      <SettingButton
        label={restoring ? 'Restoring…' : 'Restore Purchases'}
        onPress={handleRestorePurchases}
        disabled={restoring}
      />
      {Platform.OS === 'ios' ? (
        <SettingButton label="Manage Subscription" onPress={handleManageSubscription} />
      ) : null}

      <SectionHeader label="Privacy & Data" />
      <SettingButton label="Blocked Users" onPress={() => navigation.navigate('BlockedUsers')} />
      <SettingRow
        label="AI Processing Consent"
        value={user?.aiProcessingConsentAt ? 'Granted' : 'Not granted'}
      />
      {user?.aiProcessingConsentAt ? (
        <SettingButton label="Revoke AI Processing Consent" onPress={handleRevokeAiConsent} />
      ) : null}
      <SettingButton label="Delete All Photos" onPress={handleDeletePhotos} />
      <SettingButton
        label={exporting ? 'Exporting…' : 'Export My Data (GDPR/CCPA)'}
        onPress={handleExportData}
        disabled={exporting}
      />

      <SectionHeader label="Announcements" />
      {splashId ? (
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Show Announcement at Launch</Text>
          <Switch
            value={showSplash}
            onValueChange={handleToggleSplash}
            trackColor={{ true: Colors.black, false: undefined }}
          />
        </View>
      ) : (
        <SettingRow label="Current Announcement" value="None" />
      )}

      <SectionHeader label="Help" />
      <SettingButton label="Contact Support" onPress={handleContactSupport} />

      <SectionHeader label="Legal" />
      <SettingButton
        label="Privacy Policy"
        onPress={() => WebBrowser.openBrowserAsync(PRIVACY_POLICY_URL)}
      />
      <SettingButton
        label="Terms of Service"
        onPress={() => WebBrowser.openBrowserAsync(TERMS_OF_SERVICE_URL)}
      />

      {user?.isAdmin ? (
        <>
          <SectionHeader label="Admin" />
          <SettingButton
            label="Admin Console"
            onPress={() => navigation.navigate('AdminConsole')}
          />
        </>
      ) : null}

      <SectionHeader label="Session" />
      <SettingButton label="Log Out" onPress={handleLogout} />

      <View style={styles.dangerSection}>
        <SectionHeader label="Danger Zone" danger />
        <SettingButton
          label={deletingAccount ? 'Deleting...' : 'Delete Account'}
          danger
          onPress={handleDeleteAccount}
          disabled={deletingAccount}
        />
      </View>

      <Text style={styles.version}>
        AnimationStation v{Constants.expoConfig?.version ?? ''}
        {Constants.expoConfig?.ios?.buildNumber ? ` (${Constants.expoConfig.ios.buildNumber})` : ''}
      </Text>
    </ScrollView>
  );
}

function SectionHeader({ label, danger }: { label: string; danger?: boolean }) {
  return <Text style={[styles.sectionHeader, danger && styles.dangerText]}>{label}</Text>;
}

function SettingRow({ label, value }: { label: string; value?: string }) {
  return (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Text style={styles.settingValue}>{value ?? '—'}</Text>
    </View>
  );
}

function SettingButton({
  label,
  onPress,
  danger,
  disabled,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.settingButton, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.settingButtonText, danger && styles.dangerText]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surface },
  sectionHeader: {
    fontSize: Typography.fontSizeSM,
    fontWeight: Typography.fontWeightSemiBold,
    color: Colors.gray400,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
    backgroundColor: Colors.gray100,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderColor: Colors.gray100,
  },
  settingLabel: { fontSize: Typography.fontSizeMD, color: Colors.textPrimary },
  settingValue: { fontSize: Typography.fontSizeMD, color: Colors.gray600 },
  settingButton: { padding: Spacing.md, borderBottomWidth: 1, borderColor: Colors.gray100 },
  settingButtonText: { fontSize: Typography.fontSizeMD, color: Colors.textPrimary },
  dangerSection: { marginTop: Spacing.xl },
  dangerText: { color: Colors.danger },
  disabled: { opacity: 0.5 },
  version: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray400,
    textAlign: 'center',
    padding: Spacing.xl,
  },
});
