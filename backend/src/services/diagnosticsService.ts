/**
 * Diagnostics aggregator for the admin dashboard's "Diagnostics" tab.
 *
 * Goal: one call that paints a complete operational picture so a problem can be
 * triaged in seconds instead of an SSH session — process health, dependency
 * latency, BullMQ queue depth + recent worker failures, which external
 * integrations are actually wired up on THIS box, creation throughput/failures over
 * the last 24h, and the credit economy over the last 7 days.
 *
 * Every section is wrapped so a single failing probe (e.g. Redis down) degrades
 * that one card to an error string rather than 500-ing the whole endpoint — the
 * dashboard must stay useful precisely when something is broken.
 */
import os from 'os';
import { Queue } from 'bullmq';
import prisma from '../lib/prisma';
import { connection, transformQueue } from '../queue/transformQueue';
import { appleNotificationQueue } from '../queue/appleNotificationQueue';
import { env } from '../config/env';
import { getSentryStatus, SentryStatus } from './sentryService';

const PROBE_TIMEOUT_MS = 2500;
const STUCK_PROCESSING_MINUTES = 30;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer!));
}

const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

interface DependencyHealth {
  up: boolean;
  latencyMs: number;
  error?: string;
}

async function probePostgres(): Promise<DependencyHealth> {
  const start = Date.now();
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, PROBE_TIMEOUT_MS);
    return { up: true, latencyMs: Date.now() - start };
  } catch (e) {
    return { up: false, latencyMs: Date.now() - start, error: (e as Error).message };
  }
}

async function probeRedis(): Promise<DependencyHealth> {
  const start = Date.now();
  try {
    const reply = await withTimeout(connection.ping(), PROBE_TIMEOUT_MS);
    return { up: reply === 'PONG', latencyMs: Date.now() - start };
  } catch (e) {
    return { up: false, latencyMs: Date.now() - start, error: (e as Error).message };
  }
}

interface QueueSnapshot {
  name: string;
  ok: boolean;
  counts?: Record<string, number>;
  recentFailures?: Array<{
    jobId: string;
    failedReason: string;
    attemptsMade: number;
    timestamp: string | null;
  }>;
  error?: string;
}

async function snapshotQueue(queue: Queue, includeFailures: boolean): Promise<QueueSnapshot> {
  try {
    const counts = await withTimeout(queue.getJobCounts(), PROBE_TIMEOUT_MS);
    const snapshot: QueueSnapshot = { name: queue.name, ok: true, counts };
    if (includeFailures) {
      const failed = await withTimeout(queue.getFailed(0, 5), PROBE_TIMEOUT_MS);
      snapshot.recentFailures = failed.map((j) => ({
        jobId: String((j.data as { jobId?: string })?.jobId ?? j.id ?? 'unknown'),
        failedReason: (j.failedReason ?? '').slice(0, 300),
        attemptsMade: j.attemptsMade ?? 0,
        timestamp: j.timestamp ? new Date(j.timestamp).toISOString() : null,
      }));
    }
    return snapshot;
  } catch (e) {
    return { name: queue.name, ok: false, error: (e as Error).message };
  }
}

// Which external integrations are actually configured on THIS box. Booleans only
// — never the secret values. Instantly answers "why is feature X dead here?"
function integrationsStatus(): Record<string, boolean> {
  return {
    grok: Boolean(env.grok.apiKey),
    s3: Boolean(env.aws.accessKeyId && env.aws.secretAccessKey && env.aws.s3Bucket),
    appleServerApi: Boolean(
      env.apple.serverApiKeyId && env.apple.serverApiIssuerId && env.apple.serverApiKeyPath,
    ),
    emailSmtp: Boolean(env.email.smtpHost),
    awsSesCreds: Boolean(env.aws.accessKeyId && env.aws.secretAccessKey),
    cloudwatchLogs: Boolean(process.env.CLOUDWATCH_LOG_GROUP),
    sentry: getSentryStatus().enabled,
  };
}

// Effective config flags worth seeing at a glance when diagnosing env drift
// between the dev and prod boxes.
function configFlags() {
  return {
    nodeEnv: env.nodeEnv,
    appUrl: env.appUrl,
    appleEnvironment: env.apple.environment,
    refreshTokenRotation: env.refreshTokenRotation,
    logLevel: process.env.LOG_LEVEL || (env.isDev ? 'debug' : 'info'),
    allowedOriginsCount: env.allowedOrigins.length,
  };
}

async function jobStats24h() {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const stuckBefore = new Date(Date.now() - STUCK_PROCESSING_MINUTES * 60 * 1000);
    const [byStatus, stuckProcessing, recentFailures] = await Promise.all([
      prisma.creation.groupBy({
        by: ['status'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      // Jobs wedged in PROCESSING well past any reasonable run time — the single
      // best signal that the worker or Grok pipeline has stalled.
      prisma.creation.count({
        where: { status: 'PROCESSING', updatedAt: { lt: stuckBefore } },
      }),
      prisma.creation.findMany({
        where: { status: 'FAILED', createdAt: { gte: since } },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: { id: true, userId: true, errorMessage: true, updatedAt: true },
      }),
    ]);
    const counts: Record<string, number> = { PENDING: 0, PROCESSING: 0, COMPLETE: 0, FAILED: 0 };
    for (const row of byStatus) counts[row.status] = row._count._all;
    return {
      ok: true,
      windowHours: 24,
      counts,
      stuckProcessing,
      recentFailures: recentFailures.map((f) => ({
        jobId: f.id,
        userId: f.userId,
        errorMessage: (f.errorMessage ?? '').slice(0, 300),
        at: f.updatedAt.toISOString(),
      })),
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function economy7d() {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [byType, outstanding] = await Promise.all([
      prisma.creditTransaction.groupBy({
        by: ['type'],
        where: { createdAt: { gte: since } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.user.aggregate({ _sum: { credits: true } }),
    ]);
    const byTypeMap: Record<string, { sum: number; count: number }> = {};
    for (const row of byType) {
      byTypeMap[row.type] = { sum: row._sum.amount ?? 0, count: row._count._all };
    }
    return {
      ok: true,
      windowDays: 7,
      byType: byTypeMap,
      creditsOutstanding: outstanding._sum.credits ?? 0,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export interface Diagnostics {
  generatedAt: string;
  system: {
    hostname: string;
    pid: number;
    nodeVersion: string;
    uptimeSeconds: number;
    platform: string;
    nodeOptions: string | null;
    memoryMb: { rss: number; heapUsed: number; heapTotal: number; external: number };
    hostMemoryMb: { total: number; free: number };
    loadAvg: number[];
  };
  dependencies: { postgres: DependencyHealth; redis: DependencyHealth };
  queues: QueueSnapshot[];
  integrations: Record<string, boolean>;
  config: ReturnType<typeof configFlags>;
  jobs24h: Awaited<ReturnType<typeof jobStats24h>>;
  economy: Awaited<ReturnType<typeof economy7d>>;
  sentry: SentryStatus;
}

export async function collectDiagnostics(): Promise<Diagnostics> {
  const memory = process.memoryUsage();
  const [postgres, redis, creation, apple, jobs24h, economy] = await Promise.all([
    probePostgres(),
    probeRedis(),
    snapshotQueue(transformQueue, true),
    snapshotQueue(appleNotificationQueue, false),
    jobStats24h(),
    economy7d(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    system: {
      hostname: os.hostname(),
      pid: process.pid,
      nodeVersion: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      platform: `${os.platform()} ${os.release()}`,
      nodeOptions: process.env.NODE_OPTIONS ?? null,
      memoryMb: {
        rss: mb(memory.rss),
        heapUsed: mb(memory.heapUsed),
        heapTotal: mb(memory.heapTotal),
        external: mb(memory.external),
      },
      hostMemoryMb: { total: mb(os.totalmem()), free: mb(os.freemem()) },
      loadAvg: os.loadavg().map((n) => Math.round(n * 100) / 100),
    },
    dependencies: { postgres, redis },
    queues: [creation, apple],
    integrations: integrationsStatus(),
    config: configFlags(),
    jobs24h,
    economy,
    sentry: getSentryStatus(),
  };
}
