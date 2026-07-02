/**
 * Content-moderation strike tracking.
 *
 * When the creation worker hits a terminal CONTENT_MODERATED failure (xAI/Grok
 * refused to generate the image — i.e. a revealing/sexual/banned-content
 * attempt), it calls `recordModerationStrike(userId, jobId)`. That increments the
 * user's lifetime `moderationBlockCount`, stamps `lastModerationBlockAt`, and —
 * on every Nth strike (see utils/moderationStrike) — emails the admin allowlist
 * so repeat offenders surface without anyone watching logs.
 *
 * Fully best-effort: the worker invokes this fire-and-forget, and every failure
 * here is caught and logged so strike bookkeeping can never affect job handling.
 *
 * Per-event detail (which jobs, when) already lives in Creation rows (status
 * FAILED + the moderation errorMessage), so this only adds the cheap aggregate
 * needed for admin display + threshold alerting — no separate audit table.
 */
import prisma from '../lib/prisma';
import { env } from '../config/env';
import { sendModerationStrikeAlert } from './emailService';
import { createChildLogger } from './logger';
import { shouldAlertOnStrike } from '../utils/moderationStrike';
import { adminDashboardUrl } from '../utils/adminUrl';

const log = createChildLogger('ModerationService');

// Returns the user's new lifetime strike count, or null when bookkeeping
// failed (callers use the count for the warn-vs-no-refund grace decision and
// must treat null as "count unknown").
export async function recordModerationStrike(
  userId: string,
  jobId?: string,
): Promise<number | null> {
  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        moderationBlockCount: { increment: 1 },
        lastModerationBlockAt: new Date(),
      },
      select: { id: true, username: true, email: true, moderationBlockCount: true },
    });

    log.warn('Recorded content-moderation strike', {
      userId,
      jobId,
      count: user.moderationBlockCount,
    });

    if (shouldAlertOnStrike(user.moderationBlockCount) && env.adminEmails.length > 0) {
      const adminUrl = adminDashboardUrl(env.appUrl);
      await Promise.allSettled(
        env.adminEmails.map((email) =>
          sendModerationStrikeAlert(email, {
            userId: user.id,
            username: user.username,
            email: user.email,
            count: user.moderationBlockCount,
            adminUrl,
          }),
        ),
      );
      log.warn('Moderation strike alert sent', {
        userId,
        count: user.moderationBlockCount,
        alertedEmails: env.adminEmails,
      });
    }
    return user.moderationBlockCount;
  } catch (err) {
    log.error('Failed to record moderation strike', {
      userId,
      jobId,
      error: (err as Error).message,
    });
    return null;
  }
}
