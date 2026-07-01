import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors } from '../constants/theme';
import type { RootStackParams } from '../navigation';
import { useConfigStore } from '../store/useConfigStore';

interface Props {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
}

// Full-screen "create an account" prompt rendered in place of the Profile and
// Inbox tabs for guest (anonymous) sessions. The browsable surfaces (Home feed,
// public profiles, comments) stay open; these account-bound tabs convert.
export default function GuestPromptScreen({
  icon = 'person-circle-outline',
  title,
  subtitle,
}: Props) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { signupCreditGrant, signupCreditsOffer } = useConfigStore();
  const signupCta = signupCreditsOffer
    ? `Sign Up — Get ${signupCreditGrant} Free Credits`
    : 'Sign Up';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Ionicons name={icon} size={72} color={Colors.gray400} />
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => navigation.navigate('Auth', { screen: 'Signup' })}
        >
          <Text style={styles.primaryButtonText}>{signupCta}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate('Auth', { screen: 'Login' })}>
          <Text style={styles.secondaryLink}>Already have an account? Log in</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surface },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginTop: 20,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: Colors.gray600,
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 21,
  },
  primaryButton: {
    backgroundColor: Colors.black,
    borderRadius: 28,
    paddingVertical: 15,
    paddingHorizontal: 28,
    marginTop: 28,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  primaryButtonText: { color: Colors.white, fontWeight: '700', fontSize: 15 },
  secondaryLink: { color: Colors.gray600, marginTop: 18, fontSize: 14, fontWeight: '600' },
});
