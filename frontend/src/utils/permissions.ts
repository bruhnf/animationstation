/**
 * Photo library SAVE permission helper.
 *
 * App Store Review Guideline 5.1.1(iv): once the user denies a permission
 * in the iOS system dialog, the app MUST NOT ask them to reconsider with
 * messages like "Please allow access." Apple's sanctioned pattern is:
 *
 *   1. Request the permission (iOS shows its system dialog the first time).
 *   2. If denied, show ONE informational notice with a link to iOS Settings.
 *      The user changes their mind there — not in our app.
 *   3. Never re-prompt or persuade.
 *
 * Scope of this file:
 * - Only the SAVE flow is here, because writing to the user's photo gallery
 *   via `MediaLibrary.createAssetAsync` genuinely requires a permission.
 * - The READ flow (picking a photo to upload) does NOT need a permission
 *   gate, because `expo-image-picker`'s `launchImageLibraryAsync` uses
 *   PHPickerViewController on iOS 14+. PHPicker runs out-of-process and
 *   only hands the app the specific photos the user picks — no library
 *   permission required. Requesting one would be unnecessary friction
 *   and over-collection per Apple's HIG.
 */
import { Alert, Linking } from 'react-native';
import * as MediaLibrary from 'expo-media-library';

/**
 * Ensure the app can SAVE to the photo library (e.g. to write a downloaded
 * creation into the user's gallery via MediaLibrary.createAssetAsync).
 * Returns true if granted, false if denied. When denied, shows a single
 * Apple-compliant Settings prompt and returns false so the caller can bail.
 *
 * @param rationale Short clause completing "AnimationStation uses your photo library to ___."
 *                  Example: "to save your creations to your gallery".
 */
export async function ensurePhotoLibrarySavePermission(rationale: string): Promise<boolean> {
  const { status } = await MediaLibrary.requestPermissionsAsync();
  if (status === 'granted') return true;
  presentSettingsNotice(rationale);
  return false;
}

// ---- internals ------------------------------------------------------------

/**
 * Single informational alert shown after a denial. Wording is intentionally
 * neutral — it states the consequence and the recovery path (Settings) and
 * does NOT ask the user to reconsider. Two buttons: Cancel and Open Settings.
 */
function presentSettingsNotice(rationale: string): void {
  Alert.alert(
    'Photo Library Access',
    `AnimationStation uses your photo library ${rationale}. You can enable access in iOS Settings.`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Open Settings',
        onPress: () => {
          // Linking.openSettings() routes the user to this app's iOS Settings
          // page, where they can toggle Photos access. iOS handles the rest;
          // we do not poll or re-prompt afterward.
          Linking.openSettings().catch(() => {
            // openSettings can reject on some unusual configurations (e.g.
            // restricted devices). Silent catch — there is nothing we can do
            // and surfacing an error would frustrate the user further.
          });
        },
      },
    ],
    { cancelable: true },
  );
}
