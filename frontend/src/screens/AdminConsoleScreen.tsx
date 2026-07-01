import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  ActivityIndicator,
  Switch,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import axios from 'axios';
import { BASE_URL } from '../config/api';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { RootStackParams } from '../navigation';

type Props = { navigation: NativeStackNavigationProp<RootStackParams, 'AdminConsole'> };

type AdminTier = 'FREE' | 'BASIC' | 'PREMIUM';

interface AdminUser {
  id: string;
  username: string;
  email: string;
  verified: boolean;
  tier: AdminTier;
  credits: number;
  tryOnCount?: number;
  createdAt: string;
}

interface Stats {
  userCount: number;
  jobCount: number;
  completedJobs: number;
  subscriberCount: number;
  totalCreditsOutstanding: number;
}

export default function AdminConsoleScreen({ navigation }: Props) {
  const [apiKey, setApiKey] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const adminApi = axios.create({
    baseURL: BASE_URL,
    headers: { 'x-admin-key': apiKey },
  });

  async function authenticate() {
    if (!apiKey.trim()) {
      Alert.alert('Error', 'Please enter the admin API key');
      return;
    }
    setLoading(true);
    try {
      const [usersRes, statsRes] = await Promise.all([
        adminApi.get<AdminUser[]>('/admin/users'),
        adminApi.get<Stats>('/admin/stats'),
      ]);
      setUsers(usersRes.data);
      setStats(statsRes.data);
      setAuthenticated(true);
    } catch {
      Alert.alert('Authentication Failed', 'Invalid admin API key');
    } finally {
      setLoading(false);
    }
  }

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [usersRes, statsRes] = await Promise.all([
        adminApi.get<AdminUser[]>('/admin/users'),
        adminApi.get<Stats>('/admin/stats'),
      ]);
      setUsers(usersRes.data);
      setStats(statsRes.data);
    } catch {
      Alert.alert('Error', 'Failed to refresh data');
    } finally {
      setRefreshing(false);
    }
  }, [apiKey]);

  async function toggleVerified(user: AdminUser) {
    try {
      const { data } = await adminApi.patch(`/admin/user/${user.id}/verify`, {
        verified: !user.verified,
      });
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, verified: data.verified } : u)),
      );
    } catch {
      Alert.alert('Error', 'Failed to update user');
    }
  }

  async function changeTier(user: AdminUser, tier: AdminTier) {
    try {
      const { data } = await adminApi.patch(`/admin/user/${user.id}/subscription`, { tier });
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, tier: data.tier } : u)));
    } catch {
      Alert.alert('Error', 'Failed to update tier');
    }
  }

  function showTierOptions(user: AdminUser) {
    Alert.alert(`Tier (current: ${user.tier})`, 'Choose new tier', [
      { text: 'Free', onPress: () => changeTier(user, 'FREE') },
      { text: 'Basic', onPress: () => changeTier(user, 'BASIC') },
      { text: 'Premium', onPress: () => changeTier(user, 'PREMIUM') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function adjustCredits(user: AdminUser, amount: number) {
    try {
      const { data } = await adminApi.patch(`/admin/user/${user.id}/credits`, {
        amount,
        reason: amount > 0 ? 'Admin credit grant' : 'Admin credit deduction',
      });
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, credits: data.credits } : u)));
    } catch {
      Alert.alert('Error', 'Failed to adjust credits');
    }
  }

  async function deleteUser(user: AdminUser) {
    Alert.alert(
      'Delete User',
      `Are you sure you want to delete ${user.username}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await adminApi.delete(`/admin/user/${user.id}`);
              setUsers((prev) => prev.filter((u) => u.id !== user.id));
              if (stats) setStats({ ...stats, userCount: stats.userCount - 1 });
            } catch {
              Alert.alert('Error', 'Failed to delete user');
            }
          },
        },
      ],
    );
  }

  function showCreditsOptions(user: AdminUser) {
    Alert.alert('Adjust Credits', `Current: ${user.credits}`, [
      { text: '+10 Credits', onPress: () => adjustCredits(user, 10) },
      { text: '+50 Credits', onPress: () => adjustCredits(user, 50) },
      { text: '-10 Credits', onPress: () => adjustCredits(user, -10) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function renderUser({ item }: { item: AdminUser }) {
    return (
      <View style={styles.userCard}>
        <View style={styles.userHeader}>
          <Text style={styles.username}>{item.username}</Text>
          <View style={styles.badgeRow}>
            <TouchableOpacity
              style={[
                styles.subscriptionBadge,
                item.tier !== 'FREE' ? styles.subActive : styles.subInactive,
              ]}
              onPress={() => showTierOptions(item)}
            >
              <Text style={styles.subscriptionText}>{item.tier}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.creditsBadge} onPress={() => showCreditsOptions(item)}>
              <Text style={styles.creditsText}>{item.credits} credits</Text>
            </TouchableOpacity>
          </View>
        </View>
        <Text style={styles.email}>{item.email}</Text>
        <Text style={styles.date}>Joined: {new Date(item.createdAt).toLocaleDateString()}</Text>
        <View style={styles.userActions}>
          <View style={styles.verifyRow}>
            <Text style={styles.verifyLabel}>Verified:</Text>
            <Switch
              value={item.verified}
              onValueChange={() => toggleVerified(item)}
              trackColor={{ false: Colors.gray400, true: Colors.black }}
              thumbColor={Colors.white}
            />
          </View>
          <TouchableOpacity style={styles.deleteButton} onPress={() => deleteUser(item)}>
            <Text style={styles.deleteText}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!authenticated) {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        {/* The auth field is vertically centered; padding behavior lifts it (and
            the Access Console button) clear of the keyboard on smaller iPhones. */}
        <View style={styles.authContainer}>
          <Text style={styles.title}>Admin Console</Text>
          <Text style={styles.subtitle}>Enter your admin API key to continue</Text>
          <TextInput
            style={styles.input}
            placeholder="Admin API Key"
            placeholderTextColor={Colors.gray400}
            value={apiKey}
            onChangeText={setApiKey}
            secureTextEntry
            autoCapitalize="none"
          />
          <TouchableOpacity
            style={[styles.primaryButton, loading && styles.disabled]}
            onPress={authenticate}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <Text style={styles.primaryButtonText}>Access Console</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Admin Console</Text>
        <TouchableOpacity onPress={() => setAuthenticated(false)}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {stats && (
        <View style={styles.statsContainer}>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>{stats.userCount}</Text>
            <Text style={styles.statLabel}>Users</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>{stats.subscriberCount}</Text>
            <Text style={styles.statLabel}>Subscribers</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>{stats.completedJobs}</Text>
            <Text style={styles.statLabel}>Jobs Done</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>{stats.totalCreditsOutstanding}</Text>
            <Text style={styles.statLabel}>Credits</Text>
          </View>
        </View>
      )}

      <Text style={styles.sectionTitle}>Users ({users.length})</Text>

      <FlatList
        data={users}
        keyExtractor={(item) => item.id}
        renderItem={renderUser}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListEmptyComponent={<Text style={styles.emptyText}>No users found</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.gray100,
  },
  backButton: {
    position: 'absolute',
    top: 60,
    left: Spacing.md,
    zIndex: 10,
  },
  backText: {
    fontSize: Typography.fontSizeMD,
    color: Colors.textPrimary,
  },
  authContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  title: {
    fontSize: Typography.fontSizeXXL,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: Typography.fontSizeMD,
    color: Colors.gray600,
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    fontSize: Typography.fontSizeMD,
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.gray200,
  },
  primaryButton: {
    backgroundColor: Colors.black,
    borderRadius: Radius.md,
    padding: Spacing.md,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: Colors.white,
    fontSize: Typography.fontSizeMD,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.6,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingTop: 60,
    paddingBottom: Spacing.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.gray200,
  },
  headerTitle: {
    fontSize: Typography.fontSizeLG,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  logoutText: {
    fontSize: Typography.fontSizeMD,
    color: Colors.gray600,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    marginBottom: Spacing.sm,
  },
  statBox: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: Typography.fontSizeXL,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  statLabel: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray600,
  },
  sectionTitle: {
    fontSize: Typography.fontSizeMD,
    fontWeight: '600',
    color: Colors.gray600,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  list: {
    padding: Spacing.md,
    paddingTop: 0,
  },
  userCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.gray200,
  },
  userHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  username: {
    fontSize: Typography.fontSizeMD,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  email: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray600,
    marginBottom: Spacing.xs,
  },
  date: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray400,
    marginBottom: Spacing.sm,
  },
  userActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.gray100,
    paddingTop: Spacing.sm,
  },
  verifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  verifyLabel: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray600,
    marginRight: Spacing.sm,
  },
  deleteButton: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  deleteText: {
    fontSize: Typography.fontSizeSM,
    color: '#dc2626',
  },
  subscriptionBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.sm,
  },
  subActive: {
    backgroundColor: '#22c55e',
  },
  subInactive: {
    backgroundColor: Colors.gray400,
  },
  creditsBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.sm,
    backgroundColor: '#3b82f6',
  },
  creditsText: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.white,
  },
  subscriptionText: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.white,
  },
  emptyText: {
    textAlign: 'center',
    color: Colors.gray400,
    marginTop: Spacing.xl,
  },
});
