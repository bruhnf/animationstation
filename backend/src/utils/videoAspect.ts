// Grok Imagine video supports a fixed set of output aspect ratios. We must pass
// the one that matches the SOURCE image, otherwise Grok renders the source into
// a mismatched frame and the content comes back squished/distorted (the docs
// default `aspect_ratio` to 16:9, which stretches our portrait creation/body
// photos). This maps an arbitrary source width×height to the nearest supported
// ratio. Pure (no I/O) so it's unit-tested.
//
// https://docs.x.ai/developers/model-capabilities/video/generation
export const GROK_VIDEO_ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
] as const;

export type GrokVideoAspectRatio = (typeof GROK_VIDEO_ASPECT_RATIOS)[number];

const RATIO_VALUE: Record<GrokVideoAspectRatio, number> = {
  '1:1': 1,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
  '3:2': 3 / 2,
  '2:3': 2 / 3,
};

/**
 * Nearest supported Grok video aspect ratio to a source image's dimensions.
 * Falls back to '3:4' (our portrait default) when dimensions are missing/invalid.
 */
export function nearestVideoAspectRatio(
  width?: number | null,
  height?: number | null,
): GrokVideoAspectRatio {
  if (!width || !height || width <= 0 || height <= 0) return '3:4';
  const target = width / height;
  let best: GrokVideoAspectRatio = '3:4';
  let bestDiff = Infinity;
  for (const r of GROK_VIDEO_ASPECT_RATIOS) {
    const diff = Math.abs(RATIO_VALUE[r] - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = r;
    }
  }
  return best;
}
