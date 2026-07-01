import React, { useEffect, useState } from 'react';
import {
  Image,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StyleProp,
  ImageStyle,
  ViewStyle,
} from 'react-native';
import { Colors, Typography } from '../constants/theme';
import { classifyImageProbe } from '../utils/imageFailure';

interface RetryableImageProps {
  uri: string;
  style?: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center';
  accessibilityLabel?: string;
  // How many automatic retries before showing the tap-to-reload fallback.
  maxRetries?: number;
}

// A drop-in <Image> for remote (presigned-S3) result photos that self-heals a
// transient first-load failure. A plain <Image> that misses its one load
// attempt stays blank forever (it caches the failure on the instance and there's
// no retry), which is exactly the "blank white box, but the same URL loads fine
// in the modal/profile" bug seen on the TryOn result screen.
//
// On error we remount the native image view by bumping a key (NOT by adding a
// cache-bust query param — that would invalidate the S3 presigned-URL
// signature). After maxRetries we show a tap-to-reload control so the user is
// never stuck on a silent blank.
export default function RetryableImage({
  uri,
  style,
  resizeMode = 'cover',
  accessibilityLabel,
  maxRetries = 2,
}: RetryableImageProps) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState<false | 'transient' | 'permanent'>(false);

  // Reset retry state when the source changes (e.g. a recycled FlatList cell).
  useEffect(() => {
    setAttempt(0);
    setFailed(false);
  }, [uri]);

  // The native onError carries no HTTP status, so a dead reference (object
  // deleted from S3 → 404, or expired/denied URL → 403) looks identical to a
  // network blip. Probe with a 1-byte ranged GET to find out which it is, and
  // stop offering a "Tap to reload" that can never work. The Range header is
  // not part of the presigned-URL signature, so it doesn't invalidate it.
  async function probePermanence() {
    let status: number | null = null;
    try {
      const res = await fetch(uri, { headers: { Range: 'bytes=0-0' } });
      status = res.status;
    } catch {
      status = null; // network error — treat as transient
    }
    if (classifyImageProbe(status) === 'permanent') {
      setFailed('permanent');
    }
  }

  function handleError() {
    setAttempt((prev) => {
      if (prev < maxRetries) {
        // Small backoff before remounting to re-attempt the load.
        const next = prev + 1;
        setTimeout(() => setAttempt(next), 300 * next);
        return prev;
      }
      if (__DEV__) {
        // Surface a recurring backend/S3 issue without spamming on every retry.

        console.warn('[RetryableImage] gave up loading image after retries:', uri.split('?')[0]);
      }
      setFailed('transient');
      void probePermanence();
      return prev;
    });
  }

  if (failed === 'permanent') {
    // The object behind this URL is gone (or the URL can never authorize) —
    // a retry button would be a lie. Show a quiet, non-interactive notice.
    return (
      <View
        style={[style as StyleProp<ViewStyle>, styles.fallback]}
        accessibilityLabel="Image unavailable"
      >
        <Text style={styles.fallbackText}>Image unavailable</Text>
      </View>
    );
  }

  if (failed === 'transient') {
    return (
      <TouchableOpacity
        style={[style as StyleProp<ViewStyle>, styles.fallback]}
        onPress={() => {
          setFailed(false);
          setAttempt((a) => a + 1);
        }}
        accessibilityRole="button"
        accessibilityLabel="Reload image"
        activeOpacity={0.7}
      >
        <Text style={styles.fallbackText}>Tap to reload</Text>
      </TouchableOpacity>
    );
  }

  return (
    <Image
      key={`${uri}#${attempt}`}
      source={{ uri }}
      style={style}
      resizeMode={resizeMode}
      onError={handleError}
      accessibilityLabel={accessibilityLabel}
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: Colors.gray100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackText: {
    color: Colors.gray600,
    fontSize: Typography.fontSizeSM,
    fontWeight: Typography.fontWeightSemiBold,
  },
});
