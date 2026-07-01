import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import api from '../config/api';
import { useUserStore } from '../store/useUserStore';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { PRIVACY_POLICY_URL } from '../constants/legal';
import { getAiConsentCopy } from './aiConsentCopy';

const XAI_PRIVACY_URL = 'https://x.ai/legal/privacy-policy';

interface Props {
  visible: boolean;
  // Called after the user taps "I Agree and Continue" and the server has
  // persisted the consent. The caller can immediately retry the action that
  // triggered the modal (e.g. submit the creation).
  onAgree: () => void;
  // Called when the user dismisses without agreeing.
  onCancel: () => void;
  // Which AI flow triggered the modal. Drives the disclosure copy so it
  // accurately describes what is sent — Apple 5.1.1(i)/5.1.2(i) requires the
  // consent text to match the actual data sent for THIS feature. 'video'
  // produces a video, not a still image.
  mode?: 'tryon' | 'video';
}

// Explicit opt-in dialog required by App Store Review Guidelines 5.1.1(i) /
// 5.1.2(i). Names the third-party AI processor (xAI / Grok Imagine), lists
// exactly what data is sent, and persists the user's affirmative consent on
// the server so the generation submit endpoint can refuse pre-consent requests.
export default function AiConsentModal({ visible, onAgree, onCancel, mode = 'tryon' }: Props) {
  const insets = useSafeAreaInsets();
  const updateUser = useUserStore((s) => s.updateUser);
  const [submitting, setSubmitting] = useState(false);
  const copy = getAiConsentCopy(mode);

  async function handleAgree() {
    setSubmitting(true);
    try {
      const { data } = await api.post<{ aiProcessingConsentAt: string }>('/profile/me/ai-consent');
      updateUser({ aiProcessingConsentAt: data.aiProcessingConsentAt });
      onAgree();
    } catch {
      Alert.alert('Could not save consent', 'Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.header}>
            <Text style={styles.title}>Allow AI Processing?</Text>
            <TouchableOpacity onPress={onCancel} accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={Colors.black} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            <Text style={styles.paragraph}>
              {`${copy.actionPhrase} `}
              <Text style={styles.bold}>xAI, Inc.</Text>, operator of the Grok Imagine API:
            </Text>

            <View style={styles.bulletList}>
              {copy.bullets.map((b) => (
                <View style={styles.bulletRow} key={b}>
                  <Ionicons name="ellipse" size={6} color={Colors.black} style={styles.bullet} />
                  <Text style={styles.bulletText}>{b}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.paragraph}>
              Your close-up profile photo is <Text style={styles.bold}>never</Text> sent to xAI — it
              is used only as your in-app profile picture.
            </Text>

            <Text style={styles.paragraph}>
              {`${copy.outputPhrase} `}
              <Text
                style={styles.link}
                onPress={() => WebBrowser.openBrowserAsync(XAI_PRIVACY_URL)}
              >
                Privacy Policy
              </Text>
              . Our full{' '}
              <Text
                style={styles.link}
                onPress={() => WebBrowser.openBrowserAsync(PRIVACY_POLICY_URL)}
              >
                Privacy Policy
              </Text>{' '}
              describes how we store and protect this data on our infrastructure.
            </Text>

            <Text style={styles.paragraph}>
              You can revoke this consent anytime in{' '}
              <Text style={styles.bold}>Settings → Privacy &amp; Data</Text>.
            </Text>
          </ScrollView>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton]}
              onPress={onCancel}
              disabled={submitting}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.agreeButton, submitting && styles.agreeButtonDisabled]}
              onPress={handleAgree}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color={Colors.white} />
              ) : (
                <Text style={styles.agreeButtonText}>I Agree and Continue</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    padding: Spacing.lg,
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  title: {
    fontSize: Typography.fontSizeXL,
    fontWeight: Typography.fontWeightBold,
    color: Colors.black,
  },
  body: { marginBottom: Spacing.md },
  paragraph: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray800,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  bold: { fontWeight: Typography.fontWeightBold, color: Colors.black },
  link: { color: Colors.black, textDecorationLine: 'underline' },
  bulletList: { marginBottom: Spacing.md, marginLeft: Spacing.xs },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: Spacing.xs,
    gap: Spacing.sm,
  },
  bullet: { marginTop: 7 },
  bulletText: { fontSize: Typography.fontSizeSM, color: Colors.gray800, lineHeight: 20, flex: 1 },
  buttonRow: { flexDirection: 'row', gap: Spacing.sm },
  button: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: { backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.gray200 },
  cancelButtonText: {
    color: Colors.gray800,
    fontWeight: Typography.fontWeightSemiBold,
    fontSize: Typography.fontSizeMD,
  },
  agreeButton: { backgroundColor: Colors.black },
  agreeButtonDisabled: { backgroundColor: Colors.gray400 },
  agreeButtonText: {
    color: Colors.white,
    fontWeight: Typography.fontWeightBold,
    fontSize: Typography.fontSizeMD,
  },
});
