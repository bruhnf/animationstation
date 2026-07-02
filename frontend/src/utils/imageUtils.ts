import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';

// Minimum source dimensions before we warn that creation quality may suffer.
// The backend scales the longest side down to 1024px for the AI model, so a
// source already below that gives the model less detail than it expects; a
// very narrow short side usually means a cropped sliver or a screenshot strip.
export const MIN_RECOMMENDED_LONG_SIDE = 1024;
export const MIN_RECOMMENDED_SHORT_SIDE = 500;

/**
 * True when a picked image is small enough that the AI result will likely
 * disappoint. Unknown dimensions (picker didn't report them) never warn.
 */
export function isLowResolution(width?: number | null, height?: number | null): boolean {
  if (!width || !height) return false;
  return (
    Math.max(width, height) < MIN_RECOMMENDED_LONG_SIDE ||
    Math.min(width, height) < MIN_RECOMMENDED_SHORT_SIDE
  );
}

/**
 * Non-blocking low-resolution confirm. Resolves true if the user wants to
 * proceed with the photo anyway, false to pick a different one.
 */
export function confirmLowResolution(kind: 'clothing' | 'body'): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Low-Resolution Photo',
      kind === 'clothing'
        ? 'This photo is smaller than we recommend, so the result may look blurry or lose detail. A sharper, higher-resolution photo works best.'
        : 'This photo is smaller than we recommend, so your results may look blurry. A sharper photo taken in good light works best.',
      [
        { text: 'Choose Different Photo', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Use Anyway', onPress: () => resolve(true) },
      ],
      // Android: back-button/outside-tap dismisses the alert without pressing
      // a button. Without onDismiss the promise would never settle and the
      // upload flow would hang forever.
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/**
 * Process an image for upload:
 * - Converts HEIF/HEIC to JPEG (iOS default format not supported by all backends)
 * - Resizes large images to reasonable dimensions while preserving aspect ratio
 * - Compresses to reduce upload size
 */
export async function processImageForUpload(
  uri: string,
  options?: {
    maxWidth?: number;
    maxHeight?: number;
    compress?: number;
  },
): Promise<{ uri: string; type: string; name: string }> {
  const { maxWidth = 2048, maxHeight = 2048, compress = 0.85 } = options ?? {};

  // ImageManipulator is unreliable with remote http(s) URIs on iOS (it can throw
  // outright), which broke animating a creation result via "Make Video" — the
  // source there is a presigned S3 URL, not a local file. Download remote URIs
  // to a local cache file first; local file://content:// URIs pass straight
  // through unchanged. The temp file is cleaned up in `finally`.
  let workingUri = uri;
  let tempDownloadUri: string | null = null;
  if (/^https?:\/\//i.test(uri)) {
    const dest = `${FileSystem.cacheDirectory}upload_src_${Date.now()}.img`;
    const dl = await FileSystem.downloadAsync(uri, dest);
    if (dl.status !== 200) {
      throw new Error(`Failed to download image for processing (HTTP ${dl.status})`);
    }
    workingUri = dl.uri;
    tempDownloadUri = dl.uri;
  }

  try {
    return await resizeLocalImage(workingUri, maxWidth, maxHeight, compress);
  } finally {
    if (tempDownloadUri) {
      FileSystem.deleteAsync(tempDownloadUri, { idempotent: true }).catch(() => {});
    }
  }
}

// Resize + JPEG-convert a LOCAL image uri. Split out so processImageForUpload
// can guarantee a local source first (see the remote-download path above).
async function resizeLocalImage(
  uri: string,
  maxWidth: number,
  maxHeight: number,
  compress: number,
): Promise<{ uri: string; type: string; name: string }> {
  // Get original image dimensions
  const imageInfo = await ImageManipulator.manipulateAsync(uri, [], {});
  const originalWidth = imageInfo.width;
  const originalHeight = imageInfo.height;

  // Calculate resize dimensions to fit within max bounds while preserving aspect ratio
  let resizeWidth = originalWidth;
  let resizeHeight = originalHeight;

  if (originalWidth > maxWidth || originalHeight > maxHeight) {
    const widthRatio = maxWidth / originalWidth;
    const heightRatio = maxHeight / originalHeight;
    const ratio = Math.min(widthRatio, heightRatio);

    resizeWidth = Math.round(originalWidth * ratio);
    resizeHeight = Math.round(originalHeight * ratio);
  }

  // Resize and convert to JPEG
  const result = await ImageManipulator.manipulateAsync(
    uri,
    resizeWidth !== originalWidth || resizeHeight !== originalHeight
      ? [{ resize: { width: resizeWidth, height: resizeHeight } }]
      : [],
    {
      compress,
      format: ImageManipulator.SaveFormat.JPEG,
    },
  );

  return {
    uri: result.uri,
    type: 'image/jpeg',
    name: `photo_${Date.now()}.jpg`,
  };
}

/**
 * Download an image from a URL to the device's camera roll/gallery
 */
export async function downloadImageToGallery(
  imageUrl: string,
  filename?: string,
): Promise<{ success: boolean; message: string }> {
  try {
    // Request permission to access media library
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      return {
        success: false,
        message: 'Permission to access photo library was denied',
      };
    }

    // Generate filename
    const name = filename ?? `Transform_${Date.now()}.jpg`;
    const fileUri = FileSystem.cacheDirectory + name;

    // Download the image
    const downloadResult = await FileSystem.downloadAsync(imageUrl, fileUri);

    if (downloadResult.status !== 200) {
      return {
        success: false,
        message: 'Failed to download image',
      };
    }

    // Save to camera roll
    const asset = await MediaLibrary.createAssetAsync(downloadResult.uri);

    // Try to add to an "AnimationStation" album
    try {
      const album = await MediaLibrary.getAlbumAsync('AnimationStation');
      if (album) {
        await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
      } else {
        await MediaLibrary.createAlbumAsync('AnimationStation', asset, false);
      }
    } catch {
      // Album creation might fail on some devices, but the image is still saved
    }

    // Clean up cache file
    try {
      await FileSystem.deleteAsync(downloadResult.uri, { idempotent: true });
    } catch {
      // Ignore cleanup errors
    }

    return {
      success: true,
      message: 'Image saved to gallery',
    };
  } catch (error) {
    console.error('Download error:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to save image',
    };
  }
}

/**
 * Download multiple images to gallery
 */
export async function downloadMultipleImages(
  images: { url: string; label: string }[],
): Promise<{ success: boolean; message: string }> {
  try {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      return {
        success: false,
        message: 'Permission to access photo library was denied',
      };
    }

    let savedCount = 0;
    for (const image of images) {
      const result = await downloadImageToGallery(
        image.url,
        `Transform_${image.label.replace(/\s/g, '')}_${Date.now()}.jpg`,
      );
      if (result.success) savedCount++;
    }

    if (savedCount === images.length) {
      return {
        success: true,
        message: `${savedCount} image${savedCount > 1 ? 's' : ''} saved to gallery`,
      };
    } else if (savedCount > 0) {
      return {
        success: true,
        message: `${savedCount} of ${images.length} images saved`,
      };
    } else {
      return {
        success: false,
        message: 'Failed to save images',
      };
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to save images',
    };
  }
}

/**
 * Share an image using the native share sheet
 */
export async function shareImage(imageUrl: string): Promise<void> {
  try {
    const filename = `Transform_${Date.now()}.jpg`;
    const fileUri = FileSystem.cacheDirectory + filename;

    // Download to cache first
    const downloadResult = await FileSystem.downloadAsync(imageUrl, fileUri);

    if (downloadResult.status !== 200) {
      Alert.alert('Error', 'Failed to prepare image for sharing');
      return;
    }

    // Share the image
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(downloadResult.uri, {
        mimeType: 'image/jpeg',
        dialogTitle: 'Share Creation Result',
      });
    } else {
      Alert.alert('Error', 'Sharing is not available on this device');
    }

    // Clean up
    try {
      await FileSystem.deleteAsync(downloadResult.uri, { idempotent: true });
    } catch {
      // Ignore cleanup errors
    }
  } catch (error) {
    console.error('Share error:', error);
    Alert.alert('Error', 'Failed to share image');
  }
}
