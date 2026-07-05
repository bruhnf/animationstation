import type { Creation } from '../types';

// Fields needed to decide whether — and from which image — a creation can be
// sent to the "Make Video" workflow. Kept minimal so feed/profile payloads
// (which are Creation-shaped) all satisfy it.
type AnimatableJob = Pick<Creation, 'kind' | 'resultImageUrl' | 'resultImage2Url'>;

/**
 * The image URL to hand off to the Make Video (image-to-video) workflow for a
 * given creation, or null if it can't be animated.
 *
 * A VIDEO creation is already a clip — there's nothing to animate — so it
 * returns null. For an image creation we animate the primary result, falling
 * back to the second result if the primary is missing. `kind` is absent on old
 * payloads and treated as IMAGE (matches the rest of the app).
 */
export function animatableImageUrl(job: AnimatableJob): string | null {
  if (job.kind === 'VIDEO') return null;
  return job.resultImageUrl || job.resultImage2Url || null;
}

/** Whether a creation can be sent to the Make Video workflow. */
export function canMakeVideo(job: AnimatableJob): boolean {
  return animatableImageUrl(job) !== null;
}
