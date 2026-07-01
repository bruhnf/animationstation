import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Image,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import api from '../config/api';
import { useUserStore } from '../store/useUserStore';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { AuthStackParams } from '../navigation';
import UploadTipsSheet from '../components/UploadTipsSheet';
import { isLowResolution, confirmLowResolution } from '../utils/imageUtils';

type Props = { navigation: NativeStackNavigationProp<AuthStackParams, 'OnboardingPhoto'> };

type PhotoSlot = 'avatar' | 'fullBody' | 'medium';

interface SlotInfo {
  key: PhotoSlot;
  endpoint: string;
  label: string;
  description: string;
  hint: string;
}

const SLOTS: SlotInfo[] = [
  {
    key: 'avatar',
    endpoint: '/upload/avatar',
    label: 'Close-Up',
    description: 'Profile Photo',
    hint: 'Face and shoulders. Used as your profile picture.',
  },
  {
    key: 'fullBody',
    endpoint: '/upload/full-body',
    label: 'Full Body',
    description: 'Head to Toe · recommended',
    hint: 'Stand back about 6 feet. This is the primary photo for your creations.',
  },
  {
    key: 'medium',
    endpoint: '/upload/medium-body',
    label: 'Medium',
    description: 'Waist Up · optional',
    hint: 'From waist up. Optional — adds a second view. One photo is enough to start.',
  },
];

export default function OnboardingPhotoScreen({ navigation }: Props) {
  const [photos, setPhotos] = useState<Record<PhotoSlot, string | null>>({
    avatar: null,
    fullBody: null,
    medium: null,
  });
  const [uploading, setUploading] = useState<PhotoSlot | null>(null);
  const [tipsVisible, setTipsVisible] = useState(false);
  const updateUser = useUserStore((s) => s.updateUser);

  async function pickAndUpload(slot: SlotInfo) {
    // No permission request — launchImageLibraryAsync uses PHPickerViewController
    // on iOS 14+, which is permission-less. See ProfileScreen for context.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: slot.key === 'avatar',
      aspect: slot.key === 'avatar' ? [1, 1] : undefined,
      quality: 0.85,
    });

    if (result.canceled || !result.assets[0]) return;

    // Source photos set the quality ceiling for every future creation, so warn on
    // low-res sources up front. The avatar is display-only — never AI input.
    if (
      slot.key !== 'avatar' &&
      isLowResolution(result.assets[0].width, result.assets[0].height) &&
      !(await confirmLowResolution('body'))
    ) {
      return;
    }

    setUploading(slot.key);
    try {
      const asset = result.assets[0];
      const formData = new FormData();
      formData.append('photo', {
        uri: asset.uri,
        type: asset.mimeType ?? 'image/jpeg',
        name: `${slot.key}.jpg`,
      } as unknown as Blob);

      const { data } = await api.post<{ url: string; photos: Record<string, string> }>(
        slot.endpoint,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );

      setPhotos((prev) => ({ ...prev, [slot.key]: asset.uri }));

      if (slot.key === 'avatar') updateUser({ avatarUrl: data.url });
      if (slot.key === 'fullBody') updateUser({ fullBodyUrl: data.url });
      if (slot.key === 'medium') updateUser({ mediumBodyUrl: data.url });
    } catch {
      Alert.alert('Upload Failed', 'Could not upload photo. Please try again.');
    } finally {
      setUploading(null);
    }
  }

  function handleFinish() {
    const hasBodyPhoto = photos.fullBody || photos.medium;
    if (!hasBodyPhoto) {
      Alert.alert(
        'No Photos',
        'For the best experience, upload at least a full body or medium (waist-up) photo. You can do this anytime from your profile.',
        [
          { text: 'Upload Now', style: 'cancel' },
          { text: 'Skip for Now', onPress: () => navigation.navigate('Login') },
        ],
      );
    } else {
      navigation.navigate('Login');
    }
  }

  const hasAny = Object.values(photos).some(Boolean);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.inner}>
      <Text style={styles.title}>Set Up Your Profile</Text>
      <Text style={styles.subtitle}>
        Upload photos of yourself to use in your creations. The more photos you provide, the better
        your results.
      </Text>

      <View style={styles.consentBox}>
        <Text style={styles.consentText}>
          Your photos are securely stored and processed by AI to generate your creations. You can
          remove them at any time from Settings. By uploading, you consent to this processing per
          our Privacy Policy.
        </Text>
      </View>

      <TouchableOpacity style={styles.tipsRow} onPress={() => setTipsVisible(true)}>
        <Text style={styles.tipsLink}>📸 Tips for photos that get the best results</Text>
      </TouchableOpacity>

      {SLOTS.map((slot) => (
        <View key={slot.key} style={styles.slotCard}>
          <TouchableOpacity
            style={styles.photoPlaceholder}
            onPress={() => pickAndUpload(slot)}
            disabled={uploading === slot.key}
          >
            {uploading === slot.key ? (
              <ActivityIndicator color={Colors.gray400} />
            ) : photos[slot.key] ? (
              <Image source={{ uri: photos[slot.key]! }} style={styles.photoPreview} />
            ) : (
              <View style={styles.plusContainer}>
                <Text style={styles.plusIcon}>+</Text>
              </View>
            )}
          </TouchableOpacity>
          <View style={styles.slotInfo}>
            <Text style={styles.slotLabel}>{slot.label}</Text>
            <Text style={styles.slotDescription}>{slot.description}</Text>
            <Text style={styles.slotHint}>{slot.hint}</Text>
          </View>
        </View>
      ))}

      <TouchableOpacity
        style={[styles.primaryButton, !hasAny && styles.outlineButton]}
        onPress={handleFinish}
      >
        <Text style={[styles.primaryButtonText, !hasAny && styles.outlineButtonText]}>
          {hasAny ? 'Done' : 'Skip for Now'}
        </Text>
      </TouchableOpacity>

      {!hasAny && (
        <Text style={styles.skipNote}>
          You can upload photos anytime from your Profile. A full body or medium photo is
          recommended for the best creations.
        </Text>
      )}

      <UploadTipsSheet visible={tipsVisible} kind="body" onClose={() => setTipsVisible(false)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.white },
  inner: { padding: Spacing.xl, paddingTop: Spacing.xxl },
  title: {
    fontSize: Typography.fontSizeXXL,
    fontWeight: Typography.fontWeightBold,
    color: Colors.black,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: Typography.fontSizeMD,
    color: Colors.gray600,
    lineHeight: 22,
    marginBottom: Spacing.lg,
  },
  consentBox: {
    backgroundColor: Colors.gray100,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.xl,
    borderLeftWidth: 3,
    borderLeftColor: Colors.gray400,
  },
  consentText: {
    fontSize: Typography.fontSizeSM,
    color: Colors.gray600,
    lineHeight: 20,
  },
  tipsRow: { marginBottom: Spacing.lg, marginTop: -Spacing.sm },
  tipsLink: {
    fontSize: Typography.fontSizeSM,
    color: Colors.black,
    fontWeight: Typography.fontWeightSemiBold,
  },
  slotCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.lg,
    gap: Spacing.md,
  },
  photoPlaceholder: {
    width: 90,
    height: 110,
    borderRadius: Radius.md,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: Colors.gray200,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: Colors.gray100,
    flexShrink: 0,
  },
  photoPreview: { width: '100%', height: '100%', resizeMode: 'cover' },
  plusContainer: { alignItems: 'center', justifyContent: 'center' },
  plusIcon: { fontSize: 28, color: Colors.gray400 },
  slotInfo: { flex: 1 },
  slotLabel: {
    fontSize: Typography.fontSizeLG,
    fontWeight: Typography.fontWeightSemiBold,
    color: Colors.black,
  },
  slotDescription: { fontSize: Typography.fontSizeSM, color: Colors.gray600, marginTop: 2 },
  slotHint: {
    fontSize: Typography.fontSizeXS,
    color: Colors.gray400,
    marginTop: 4,
    lineHeight: 16,
  },
  primaryButton: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.lg,
  },
  outlineButton: { backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.gray200 },
  primaryButtonText: {
    color: Colors.black,
    fontWeight: Typography.fontWeightSemiBold,
    fontSize: Typography.fontSizeMD,
  },
  outlineButtonText: { color: Colors.gray600 },
  skipNote: {
    fontSize: Typography.fontSizeXS,
    color: Colors.gray400,
    textAlign: 'center',
    marginTop: Spacing.md,
    lineHeight: 18,
  },
});
