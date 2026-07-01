// Shared Prisma error guards. Dependency-free (no @prisma/client import) so
// pure unit tests can exercise callers without dragging in the client.

/**
 * True when err is a Prisma P2002 unique-constraint violation.
 *
 * Used to close the check-then-create race: two concurrent requests can both
 * pass a uniqueness pre-check, after which the loser hits the DB unique index.
 * Callers translate that into the same 409 the pre-check would have returned
 * (or idempotent success, e.g. comment likes / verify-receipt) instead of a 500.
 */
export function isUniqueConstraintError(err: unknown): boolean {
  return (
    !!err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002'
  );
}
