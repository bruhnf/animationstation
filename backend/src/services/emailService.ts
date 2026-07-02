import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { createChildLogger, logExternalCall } from './logger';
import { escapeHtml } from '../utils/htmlEscape';

const log = createChildLogger('EmailService');

function createTransport() {
  // If SMTP not configured, skip email sending
  if (!env.email.smtpHost || !env.email.smtpUser) {
    log.warn('SMTP not configured - emails will be logged only');
    return null;
  }
  log.info('SMTP transport configured', { host: env.email.smtpHost, port: env.email.smtpPort });
  return nodemailer.createTransport({
    host: env.email.smtpHost,
    port: env.email.smtpPort,
    secure: env.email.smtpPort === 465,
    auth: { user: env.email.smtpUser, pass: env.email.smtpPass },
  });
}

const transport = createTransport();

async function sendMail(options: { from: string; to: string; subject: string; html: string }) {
  if (!transport) {
    // Log email when SMTP not configured
    log.info('Email (no SMTP)', {
      to: options.to,
      subject: options.subject,
      contentPreview: options.html.replace(/<[^>]*>/g, '').substring(0, 100),
    });
    return;
  }

  const startTime = Date.now();
  try {
    // Friendly sender display name; options.from is the bare SES_FROM_ADDRESS.
    await transport.sendMail({ ...options, from: `"AnimationStation" <${options.from}>` });
    logExternalCall('smtp', 'sendMail', {
      durationMs: Date.now() - startTime,
      success: true,
      to: options.to,
      subject: options.subject,
    });
  } catch (err: unknown) {
    logExternalCall('smtp', 'sendMail', {
      durationMs: Date.now() - startTime,
      success: false,
      to: options.to,
      subject: options.subject,
      error: (err as Error).message,
    });
    throw err;
  }
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const url = `${env.appUrl}/api/auth/verify/${token}`;
  await sendMail({
    from: env.email.fromAddress,
    to,
    subject: 'Verify your AnimationStation account',
    html: `
      <h2>Welcome to AnimationStation!</h2>
      <p>Click the link below to verify your email address. This link expires in 24 hours.</p>
      <a href="${url}" style="background:#000;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">Verify Email</a>
      <p>Or copy this link: ${url}</p>
      <p>If you didn't create an AnimationStation account, you can safely ignore this email.</p>
    `,
  });
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  // Must be a real https link to the WEBSITE reset page. The old
  // `animationstation://reset-password` deep link was a dead end twice over: mail clients
  // refuse to hyperlink custom schemes (the "button" rendered as inert dark
  // text), and neither the app nor the website had a screen to handle it.
  // The web page works in every mail client on every device, and posts to the
  // same-environment API (js/auth.js derives the API base from the hostname).
  const url = `${env.websiteUrl}/reset-password.html?token=${encodeURIComponent(token)}`;
  await sendMail({
    from: env.email.fromAddress,
    to,
    subject: 'Reset your AnimationStation password',
    html: `
      <h2>Password Reset</h2>
      <p>Click the button below to choose a new password. This link expires in 1 hour.</p>
      <a href="${url}" style="background:#000;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">Reset Password</a>
      <p>Or copy this link: ${url}</p>
      <p>If you didn't request a password reset, you can safely ignore this email.</p>
    `,
  });
}

export async function sendS3OrphanAlert(
  to: string,
  orphanedObjects: number,
  affectedUserIds: string[],
  adminUrl: string,
): Promise<void> {
  const userList = affectedUserIds
    .slice(0, 20)
    .map((id) => `<li><code>${id}</code></li>`)
    .join('');
  const more =
    affectedUserIds.length > 20 ? `<p>…and ${affectedUserIds.length - 20} more.</p>` : '';
  await sendMail({
    from: env.email.fromAddress,
    to,
    subject: `[AnimationStation] S3 orphan scan: ${orphanedObjects} stale object${orphanedObjects === 1 ? '' : 's'} found`,
    html: `
      <h2>S3 Orphan Scan — Action Needed</h2>
      <p>The weekly S3 orphan scan found <strong>${orphanedObjects} object${orphanedObjects === 1 ? '' : 's'}</strong>
      across <strong>${affectedUserIds.length} deleted user${affectedUserIds.length === 1 ? '' : 's'}</strong>
      that are no longer referenced in the database.</p>
      <h3>Affected user IDs</h3>
      <ul>${userList}</ul>
      ${more}
      <p>
        <a href="${adminUrl}" style="background:#000;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">
          Open Admin Dashboard → S3 Orphans
        </a>
      </p>
      <p style="color:#888;font-size:12px;">
        To delete these objects, open the Admin Dashboard, go to the Storage tab, and click "Delete Orphans".
        Or call <code>DELETE /api/admin/s3/orphan-cleanup</code> with your admin key.
      </p>
    `,
  });
}

export async function sendGuestAbuseAlert(
  to: string,
  data: {
    windowHours: number;
    totalGuests: number;
    topIps: { ip: string; count: number }[];
    globalThreshold: number;
    perIpThreshold: number;
    adminUrl: string;
  },
): Promise<void> {
  const ipRows = data.topIps
    .map(
      (r) =>
        `<li><code>${r.ip}</code> — ${r.count} guest sign-up${r.count === 1 ? '' : 's'}${
          r.count >= data.perIpThreshold ? ' <strong>⚠ over per-IP threshold</strong>' : ''
        }</li>`,
    )
    .join('');
  await sendMail({
    from: env.email.fromAddress,
    to,
    subject: `[AnimationStation] Unusual guest sign-up volume: ${data.totalGuests} in ${data.windowHours}h`,
    html: `
      <h2>Guest Sign-up Spike — Possible Credit Farming</h2>
      <p>In the last <strong>${data.windowHours} hours</strong>, <strong>${data.totalGuests}</strong>
      anonymous guest accounts were created (each is granted free creation credits).</p>
      <p>Thresholds: global ≥ ${data.globalThreshold} / window, or ≥ ${data.perIpThreshold} from any single IP.</p>
      ${data.topIps.length ? `<h3>Top source IPs</h3><ul>${ipRows}</ul>` : ''}
      <p>If this looks organic (a launch, press mention, etc.) no action is needed. If one source is
      farming free creations, consider tightening the <code>/auth/guest</code> rate limit or enabling
      iOS DeviceCheck.</p>
      <p>
        <a href="${data.adminUrl}" style="background:#000;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">
          Open Admin Dashboard
        </a>
      </p>
      <p style="color:#888;font-size:12px;">You're receiving this because guest sign-up thresholds were crossed. Repeat alerts are throttled.</p>
    `,
  });
}

export async function sendReferralAbuseAlert(
  to: string,
  data: {
    windowDays: number;
    totalRewarded: number;
    topReferrers: { referrerId: string; count: number }[];
    globalThreshold: number;
    perReferrerThreshold: number;
    adminUrl: string;
  },
): Promise<void> {
  const rows = data.topReferrers
    .map(
      (r) =>
        `<li><code>${r.referrerId}</code> — ${r.count} rewarded referral${r.count === 1 ? '' : 's'}${
          r.count >= data.perReferrerThreshold
            ? ' <strong>⚠ over per-referrer threshold</strong>'
            : ''
        }</li>`,
    )
    .join('');
  await sendMail({
    from: env.email.fromAddress,
    to,
    subject: `[AnimationStation] Unusual referral volume: ${data.totalRewarded} rewarded in ${data.windowDays}d`,
    html: `
      <h2>Referral Spike — Possible Credit Farming</h2>
      <p>In the last <strong>${data.windowDays} days</strong>, <strong>${data.totalRewarded}</strong>
      referrals were rewarded (each pays free credits to both sides).</p>
      <p>Thresholds: global ≥ ${data.globalThreshold} / window, or ≥ ${data.perReferrerThreshold} from any single referrer.</p>
      ${data.topReferrers.length ? `<h3>Top referrers</h3><ul>${rows}</ul>` : ''}
      <p>The per-referrer cap (Admin → Settings) withholds a referrer's payout past its limit, but a
      ring of accounts can still spread referrals around. If this looks like farming, lower the referral
      reward / cap, or pause the program (set the reward to 0).</p>
      <p>
        <a href="${data.adminUrl}" style="background:#000;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">
          Open Admin Dashboard
        </a>
      </p>
      <p style="color:#888;font-size:12px;">You're receiving this because referral thresholds were crossed. Repeat alerts are throttled.</p>
    `,
  });
}

export async function sendQueueHealthAlert(
  to: string,
  data: {
    reasons: string[];
    queues: {
      name: string;
      waiting: number;
      active: number;
      delayed: number;
      failed: number;
      backlog: number;
    }[];
    backlogThreshold: number;
    failedThreshold: number;
    adminUrl: string;
  },
): Promise<void> {
  const rows = data.queues
    .map(
      (q) =>
        `<tr><td><code>${q.name}</code></td><td>${q.backlog}${q.backlog >= data.backlogThreshold ? ' ⚠' : ''}</td>` +
        `<td>${q.waiting}</td><td>${q.active}</td><td>${q.delayed}</td>` +
        `<td>${q.failed}${q.failed >= data.failedThreshold ? ' ⚠' : ''}</td></tr>`,
    )
    .join('');
  await sendMail({
    from: env.email.fromAddress,
    to,
    subject: `[AnimationStation] Queue health alert: ${data.reasons.join('; ')}`,
    html: `
      <h2>BullMQ Queue Health Alert</h2>
      <p>${data.reasons.map((r) => `<strong>${r}</strong>`).join('<br>')}</p>
      <p>Thresholds: backlog ≥ ${data.backlogThreshold}, failed ≥ ${data.failedThreshold}.</p>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">
        <tr><th>Queue</th><th>Backlog</th><th>Waiting</th><th>Active</th><th>Delayed</th><th>Failed</th></tr>
        ${rows}
      </table>
      <p>A growing <strong>backlog</strong> means jobs arrive faster than they finish (Grok slow/down, worker stalled, or a genuine launch spike). A <strong>failed</strong> spike means jobs are erroring. Check the worker + Grok status.</p>
      <p>
        <a href="${data.adminUrl}" style="background:#000;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">
          Open Admin Dashboard → Diagnostics
        </a>
      </p>
      <p style="color:#888;font-size:12px;">Repeat alerts are throttled.</p>
    `,
  });
}

export async function sendModerationStrikeAlert(
  to: string,
  data: {
    userId: string;
    username: string;
    email: string | null;
    count: number;
    adminUrl: string;
  },
): Promise<void> {
  await sendMail({
    from: env.email.fromAddress,
    to,
    subject: `[AnimationStation] Repeat content-moderation blocks: ${data.username} (${data.count})`,
    html: `
      <h2>Repeat Content-Moderation Blocks — Review Needed</h2>
      <p>User <strong>${data.username}</strong>${data.email ? ` (${data.email})` : ''} has now had
      <strong>${data.count}</strong> creation generation${data.count === 1 ? '' : 's'} blocked by the AI
      provider's content policy — typically attempts to generate revealing, sexual, or otherwise
      banned imagery.</p>
      <p>User ID: <code>${data.userId}</code></p>
      <p>A single block can be a borderline-clothing false positive, but a repeating pattern is a
      strong signal of deliberate banned-content attempts. Review the account and, if warranted,
      warn, suspend, or delete it.</p>
      <p>
        <a href="${data.adminUrl}" style="background:#000;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">
          Open Admin Dashboard → Users
        </a>
      </p>
      <p style="color:#888;font-size:12px;">You're receiving this because a user crossed a content-moderation strike threshold. Repeat alerts fire only on further multiples of the threshold.</p>
    `,
  });
}

// Admin heads-up when a new user finishes email verification — the moment a
// real, reachable account exists. Guests and raw (unverified) signups are
// noise, so this fires only from verifyEmail. Email-only for now — SMS
// alerting is pending toll-free registration approval.
export async function sendNewUserAlert(
  to: string,
  data: {
    userId: string;
    username: string;
    email: string | null;
    signupPath: 'guest_conversion' | 'direct';
    totalUsers: number;
    verifiedUsers: number;
    adminUrl: string;
  },
): Promise<void> {
  const pathLabel =
    data.signupPath === 'guest_conversion'
      ? 'Guest conversion — tried the app before signing up'
      : 'Direct sign-up';
  await sendMail({
    from: env.email.fromAddress,
    to,
    subject: `[AnimationStation] New user: ${data.username}`,
    html: `
      <h2>🎉 New Verified User</h2>
      <ul>
        <li>Username: <strong>${escapeHtml(data.username)}</strong></li>
        ${data.email ? `<li>Email: ${escapeHtml(data.email)}</li>` : ''}
        <li>Path: ${pathLabel}</li>
        <li>User ID: <code>${escapeHtml(data.userId)}</code></li>
      </ul>
      <p>Real accounts now: <strong>${data.totalUsers}</strong> (${data.verifiedUsers} verified).</p>
      <p>
        <a href="${data.adminUrl}" style="background:#000;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">
          Open Admin Dashboard → Users
        </a>
      </p>
      <p style="color:#888;font-size:12px;">You're receiving this because a user completed email verification. One email per new user.</p>
    `,
  });
}

// Admin alert for EVERY creation generation failure (terminal error, full
// moderation block, or a partial moderation block on a job that still
// completed). Email-only for now — SMS alerting is pending toll-free
// registration approval (see TODOS §2).
export async function sendGenerationFailureAlert(
  to: string,
  data: {
    jobId: string;
    userId?: string | null;
    kind: 'moderated' | 'partial_moderation' | 'partial_error' | 'error';
    detail: string;
    attempts?: number;
    refunded?: boolean;
    adminUrl: string;
  },
): Promise<void> {
  const kindLabel =
    data.kind === 'error'
      ? 'Generation error'
      : data.kind === 'moderated'
        ? 'Content-moderation block (all perspectives)'
        : data.kind === 'partial_error'
          ? 'Transient error (partial — job completed with survivors, credit refunded)'
          : 'Content-moderation block (partial — job still completed)';
  await sendMail({
    from: env.email.fromAddress,
    to,
    subject: `[AnimationStation] Generation failed: ${kindLabel}`,
    html: `
      <h2>Creation Generation Failure</h2>
      <p><strong>${kindLabel}</strong></p>
      <ul>
        <li>Job ID: <code>${escapeHtml(data.jobId)}</code></li>
        ${data.userId ? `<li>User ID: <code>${escapeHtml(data.userId)}</code></li>` : ''}
        ${data.attempts !== undefined ? `<li>Attempts made: ${data.attempts}</li>` : ''}
        ${data.refunded !== undefined ? `<li>Credit refunded: ${data.refunded ? 'yes' : 'no'}</li>` : ''}
      </ul>
      <p style="white-space:pre-wrap;"><strong>Detail:</strong> ${escapeHtml(data.detail)}</p>
      <p>A partial moderation block usually means one perspective tripped the AI provider's filter
      while the other passed with the same clothing photo — often a false positive. An all-perspectives
      block or repeated errors deserve a closer look.</p>
      <p>
        <a href="${data.adminUrl}" style="background:#000;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">
          Open Admin Dashboard
        </a>
      </p>
      <p style="color:#888;font-size:12px;">You're receiving this because a creation generation failed. One email per terminal failure / partial block.</p>
    `,
  });
}

export async function sendSuspiciousLoginAlert(
  to: string,
  city: string,
  country: string,
  timestamp: Date,
): Promise<void> {
  await sendMail({
    from: env.email.fromAddress,
    to,
    subject: 'Unusual login detected on your AnimationStation account',
    html: `
      <h2>Unusual Login Detected</h2>
      <p>We detected a login to your AnimationStation account from an unusual location:</p>
      <ul>
        <li><strong>Location:</strong> ${city}, ${country}</li>
        <li><strong>Time:</strong> ${timestamp.toUTCString()}</li>
      </ul>
      <p>If this was you, no action is needed. If you don't recognize this login, please change your password immediately.</p>
    `,
  });
}
