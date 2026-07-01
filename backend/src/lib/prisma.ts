import { PrismaClient } from '@prisma/client';

// Prisma's default connection pool size is num_physical_cpus * 2 + 1 — only ~5
// on the 2-vCPU box. Under concurrency (the feed fires several queries per
// request) those 5 connections become the bottleneck: requests queue for a
// connection while CPU/RAM sit idle (confirmed by load test — ~4s feed latency
// with the box <50% busy). Make the pool size tunable via DB_CONNECTION_LIMIT
// (default 15), kept well under Postgres' max_connections (default 100) so
// multiple app instances still fit.
const CONNECTION_LIMIT = Math.max(1, parseInt(process.env.DB_CONNECTION_LIMIT ?? '15', 10));

function withConnectionLimit(url: string | undefined): string | undefined {
  if (!url) return url;
  if (/[?&]connection_limit=/.test(url)) return url; // respect an explicit override in DATABASE_URL
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}connection_limit=${CONNECTION_LIMIT}`;
}

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
  datasources: { db: { url: withConnectionLimit(process.env.DATABASE_URL) } },
});

export default prisma;
