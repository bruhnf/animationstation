import type { TryOnKind } from '@prisma/client';

type JobInputFields = {
  kind?: TryOnKind | null;
  bodyPhotoUrl?: string | null;
  clothingPhoto1Url?: string | null;
  clothingPhoto2Url?: string | null;
};

/**
 * Strip a try-on job's INPUT photos when the viewer is NOT the owner.
 *
 * Every public surface (feed, public profile, job-status for a shared post,
 * saved looks) must only ever expose RESULTS, never the inputs a user fed in:
 *  - IMAGE try-on: the inputs are the user's PRIVATE body photo (`bodyPhotoUrl`)
 *    and the clothing item they photographed. Body photos are deliberately kept
 *    private (omitted from public profiles), so leaking them through a job grid
 *    is a privacy breach.
 *  - VIDEO: the source image (`bodyPhotoUrl`) IS the intended public poster /
 *    thumbnail, so it stays. The optional 2nd "transition" image
 *    (`clothingPhoto1Url`) and `clothingPhoto2Url` are private inputs and are
 *    stripped.
 *
 * Owners always get everything back. Pure function (no I/O) so it's unit-tested
 * and reusable by every read path.
 */
export function stripNonOwnerJobInputs<T extends JobInputFields>(job: T, isOwner: boolean): T {
  if (isOwner) return job;
  if (job.kind === 'VIDEO') {
    return { ...job, clothingPhoto1Url: null, clothingPhoto2Url: null };
  }
  return { ...job, bodyPhotoUrl: null, clothingPhoto1Url: null, clothingPhoto2Url: null };
}
