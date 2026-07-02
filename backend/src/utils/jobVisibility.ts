import type { CreationKind } from '@prisma/client';

type JobInputFields = {
  kind?: CreationKind | null;
  sourceImageUrl?: string | null;
  refImage1Url?: string | null;
  refImage2Url?: string | null;
};

/**
 * Strip a creation job's INPUT photos when the viewer is NOT the owner.
 *
 * Every public surface (feed, public profile, job-status for a shared post,
 * saved looks) must only ever expose RESULTS, never the inputs a user fed in:
 *  - IMAGE creation: the inputs are the user's PRIVATE body photo (`sourceImageUrl`)
 *    and the clothing item they photographed. Body photos are deliberately kept
 *    private (omitted from public profiles), so leaking them through a job grid
 *    is a privacy breach.
 *  - VIDEO: the source image (`sourceImageUrl`) IS the intended public poster /
 *    thumbnail, so it stays. The optional 2nd "transition" image
 *    (`refImage1Url`) and `refImage2Url` are private inputs and are
 *    stripped.
 *
 * Owners always get everything back. Pure function (no I/O) so it's unit-tested
 * and reusable by every read path.
 */
export function stripNonOwnerJobInputs<T extends JobInputFields>(job: T, isOwner: boolean): T {
  if (isOwner) return job;
  if (job.kind === 'VIDEO') {
    return { ...job, refImage1Url: null, refImage2Url: null };
  }
  return { ...job, sourceImageUrl: null, refImage1Url: null, refImage2Url: null };
}
