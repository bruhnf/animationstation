/**
 * Functional tests for the low-resolution upload guard (1.0.17 A3).
 * The expo modules imageUtils imports are mocked — only the pure decision
 * logic and the Alert-driven confirm flow are under test.
 */
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  downloadAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));
jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: jest.fn(),
  createAssetAsync: jest.fn(),
  getAlbumAsync: jest.fn(),
  addAssetsToAlbumAsync: jest.fn(),
  createAlbumAsync: jest.fn(),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));

import { Alert, AlertButton } from 'react-native';
import {
  isLowResolution,
  confirmLowResolution,
  MIN_RECOMMENDED_LONG_SIDE,
  MIN_RECOMMENDED_SHORT_SIDE,
} from '../imageUtils';

describe('isLowResolution', () => {
  it('never warns when dimensions are unknown (picker did not report them)', () => {
    expect(isLowResolution(undefined, undefined)).toBe(false);
    expect(isLowResolution(null, 800)).toBe(false);
    expect(isLowResolution(800, 0)).toBe(false);
  });

  it('passes a typical camera photo', () => {
    expect(isLowResolution(3024, 4032)).toBe(false);
  });

  it('passes exactly-at-threshold images (boundary)', () => {
    expect(isLowResolution(MIN_RECOMMENDED_LONG_SIDE, MIN_RECOMMENDED_SHORT_SIDE)).toBe(false);
    expect(isLowResolution(MIN_RECOMMENDED_SHORT_SIDE, MIN_RECOMMENDED_LONG_SIDE)).toBe(false);
  });

  it('warns when the longest side is below the AI processing target', () => {
    expect(isLowResolution(MIN_RECOMMENDED_LONG_SIDE - 1, MIN_RECOMMENDED_SHORT_SIDE)).toBe(true);
    expect(isLowResolution(640, 480)).toBe(true);
  });

  it('warns on a sliver crop: long enough, but the short side is tiny', () => {
    expect(isLowResolution(4000, MIN_RECOMMENDED_SHORT_SIDE - 1)).toBe(true);
  });

  it('is orientation-independent', () => {
    expect(isLowResolution(800, 1200)).toBe(isLowResolution(1200, 800));
  });
});

describe('confirmLowResolution', () => {
  const pressButton = (label: string) => {
    (Alert.alert as jest.Mock).mockImplementationOnce((_t, _m, buttons: AlertButton[]) => {
      const btn = buttons.find((b) => b.text === label);
      btn?.onPress?.();
    });
  };

  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('resolves true when the user chooses Use Anyway', async () => {
    pressButton('Use Anyway');
    await expect(confirmLowResolution('clothing')).resolves.toBe(true);
  });

  it('resolves false when the user chooses a different photo', async () => {
    pressButton('Choose Different Photo');
    await expect(confirmLowResolution('body')).resolves.toBe(false);
  });

  it('resolves false when the alert is dismissed without a button (Android back tap)', async () => {
    (Alert.alert as jest.Mock).mockImplementationOnce(
      (_t, _m, _buttons, options?: { onDismiss?: () => void }) => {
        options?.onDismiss?.();
      },
    );
    await expect(confirmLowResolution('clothing')).resolves.toBe(false);
  });
});
