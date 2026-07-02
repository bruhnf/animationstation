/**
 * Centralized Logging Service
 *
 * Log Levels (in order of severity):
 * - error: Application errors, exceptions, failed operations
 * - warn: Warnings, deprecations, suspicious activity
 * - info: Key business events, state changes, successful operations
 * - http: HTTP request/response logging
 * - debug: Detailed debugging information (verbose in dev)
 *
 * Log Files (production):
 * - logs/combined-%DATE%.log: All logs, rotated daily, 14-day retention
 * - logs/error-%DATE%.log: Error-only logs, rotated daily, 30-day retention
 * - logs/app.log: Current combined log (symlink for easy tailing)
 *
 * Usage:
 *   import { logger, createChildLogger } from './services/logger';
 *
 *   logger.info('User registered', { userId: '123', email: 'user@example.com' });
 *   logger.error('Payment failed', { error: err.message, userId: '123' });
 *
 *   // Child logger with context
 *   const log = createChildLogger('GrokService');
 *   log.info('API call started', { endpoint: '/imagine' });
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import WinstonCloudWatch from 'winston-cloudwatch';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { env } from '../config/env';

// Log directory - in production this should be a mounted volume
const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs');

// Custom log levels with colors
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'cyan',
};

winston.addColors(colors);

// Determine log level based on environment
const getLogLevel = (): string => {
  const envLevel = process.env.LOG_LEVEL;
  if (envLevel) return envLevel;
  return env.isDev ? 'debug' : 'info';
};

// Format for console output (development) - pretty and readable
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, service, correlationId, ...meta }) => {
    const svc = service ? `[${service}]` : '';
    const corrId = correlationId ? `(${String(correlationId).slice(0, 8)})` : '';
    const metaStr = Object.keys(meta).length
      ? `\n  ${JSON.stringify(meta, null, 2).replace(/\n/g, '\n  ')}`
      : '';
    return `${timestamp} ${level} ${svc}${corrId}: ${message}${metaStr}`;
  }),
);

// Format for file output (production) - JSON for easy parsing
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

// Create transports array based on environment
const transports: winston.transport[] = [];

// Console transport - always enabled
transports.push(
  new winston.transports.Console({
    format: env.isDev ? consoleFormat : fileFormat,
  }),
);

// File transports - enabled in production or if LOG_TO_FILE is set
if (!env.isDev || process.env.LOG_TO_FILE === 'true') {
  // Combined log - all levels
  transports.push(
    new DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '50m',
      maxFiles: '14d',
      format: fileFormat,
      zippedArchive: true,
    }),
  );

  // Error log - errors only, kept longer
  transports.push(
    new DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '50m',
      maxFiles: '30d',
      level: 'error',
      format: fileFormat,
      zippedArchive: true,
    }),
  );
}

// AWS CloudWatch Logs transport — additive. Only enabled when CLOUDWATCH_LOG_GROUP
// is set in the env, so dev environments and untriaged deployments don't ship logs.
//
// The transport uses the `animationstation-log-shipper` IAM user's credentials, which are
// scoped to `logs:PutLogEvents` on `/animationstation/*` log groups only. Credentials are
// passed explicitly so they remain separate from the backend's S3 credentials —
// least privilege per service.
//
// Stream name uses the host short hostname so multi-instance deployments each get
// their own stream. winston-cloudwatch will create the stream if it doesn't exist.
//
// If shipping fails (network, throttling, transient AWS error), the transport
// retries internally. We swallow `error` events so a CloudWatch outage cannot
// crash the backend or block writes to the console/file transports.
const cwLogGroup = process.env.CLOUDWATCH_LOG_GROUP;
if (cwLogGroup) {
  const cwAccessKeyId = process.env.CLOUDWATCH_AWS_ACCESS_KEY_ID;
  const cwSecretAccessKey = process.env.CLOUDWATCH_AWS_SECRET_ACCESS_KEY;
  const cwRegion = process.env.CLOUDWATCH_AWS_REGION || 'us-east-1';

  if (!cwAccessKeyId || !cwSecretAccessKey) {
    console.warn(
      '[logger] CLOUDWATCH_LOG_GROUP is set but credentials are missing. CloudWatch shipping disabled.',
    );
  } else {
    // winston-cloudwatch 6.x runs on AWS SDK v3, which requires credentials to
    // be nested under `credentials: { ... }` — passing top-level awsAccessKeyId
    // / awsSecretKey to the library is silently ignored by v3 and the SDK
    // falls back to the default credentials chain (process env, ~/.aws, IMDS),
    // which would pick up the unrelated S3 keys already in backend/.env.
    // Use the awsOptions escape hatch so the v3 shape is honored.
    const cwTransport = new WinstonCloudWatch({
      logGroupName: cwLogGroup,
      logStreamName: `${os.hostname().slice(0, 16)}-${env.nodeEnv}`,
      awsOptions: {
        credentials: {
          accessKeyId: cwAccessKeyId,
          secretAccessKey: cwSecretAccessKey,
        },
        region: cwRegion,
      },
      jsonMessage: true,
      // Batch up to 20 messages or 5 seconds before flushing. Reduces PutLogEvents
      // calls (and therefore AWS cost + throttling risk) while keeping logs near
      // real-time for debugging.
      messageFormatter: ({ level, message, ...meta }) =>
        JSON.stringify({ level, message, ...meta }),
    });

    // Don't crash on CloudWatch failures.
    cwTransport.on('error', (err: Error) => {
      console.error('[logger] CloudWatch transport error:', err.message);
    });

    transports.push(cwTransport);
  }
}

// Create the main logger instance
export const logger = winston.createLogger({
  level: getLogLevel(),
  levels,
  defaultMeta: {
    service: 'creation-api',
    env: env.nodeEnv,
  },
  transports,
  // Don't exit on handled exceptions
  exitOnError: false,
});

// Log unhandled exceptions and rejections
logger.exceptions.handle(
  new winston.transports.Console({ format: consoleFormat }),
  new DailyRotateFile({
    dirname: LOG_DIR,
    filename: 'exceptions-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxFiles: '30d',
    format: fileFormat,
  }),
);

logger.rejections.handle(
  new winston.transports.Console({ format: consoleFormat }),
  new DailyRotateFile({
    dirname: LOG_DIR,
    filename: 'rejections-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxFiles: '30d',
    format: fileFormat,
  }),
);

/**
 * Create a child logger with a specific service name
 * Useful for module-specific logging
 */
export function createChildLogger(serviceName: string): winston.Logger {
  return logger.child({ service: serviceName });
}

/**
 * One-way hash a sensitive identifier for safe logging. Use this when you
 * want to correlate log lines that involve the same value (e.g. a User.id
 * surfaced via a StoreKit appAccountToken) without writing the raw value
 * to disk where it could be enumerated by a log reader. Returns a short
 * 12-char hex prefix of SHA-256, which is enough to correlate but not
 * enough to reverse to the original.
 */
export function hashForLog(value: string | null | undefined): string | null {
  if (!value) return null;
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

/**
 * Create a logger with correlation ID for request tracing
 * Use in middleware to attach to request context
 */
export function createRequestLogger(correlationId: string, userId?: string): winston.Logger {
  return logger.child({
    correlationId,
    ...(userId && { userId }),
  });
}

// ============================================
// Specialized logging functions
// ============================================

/**
 * Log external API calls (Grok, S3, etc.)
 */
export function logExternalCall(
  service: string,
  operation: string,
  details: {
    url?: string;
    method?: string;
    statusCode?: number;
    durationMs?: number;
    success: boolean;
    error?: string;
    requestId?: string;
    [key: string]: unknown;
  },
): void {
  const level = details.success ? 'info' : 'error';
  logger.log(level, `External API: ${service}.${operation}`, {
    service: `external:${service}`,
    operation,
    ...details,
  });
}

/**
 * Log authentication events
 */
export function logAuth(
  event:
    | 'login'
    | 'logout'
    | 'signup'
    | 'token_refresh'
    | 'password_reset'
    | 'verification'
    | 'failed_login',
  details: {
    userId?: string;
    email?: string;
    ip?: string;
    userAgent?: string;
    success: boolean;
    reason?: string;
    [key: string]: unknown;
  },
): void {
  const level = details.success ? 'info' : 'warn';
  logger.log(level, `Auth: ${event}`, {
    service: 'auth',
    event,
    ...details,
  });
}

/**
 * Log job processing events
 */
export function logJob(
  event: 'queued' | 'started' | 'completed' | 'failed' | 'retrying',
  details: {
    jobId: string;
    jobType: string;
    userId?: string;
    durationMs?: number;
    attempt?: number;
    error?: string;
    [key: string]: unknown;
  },
): void {
  const level = event === 'failed' ? 'error' : event === 'retrying' ? 'warn' : 'info';
  logger.log(level, `Job: ${details.jobType}.${event}`, {
    service: 'queue',
    event,
    ...details,
  });
}

/**
 * Log database operations (mainly errors)
 */
export function logDatabase(
  operation: string,
  details: {
    model?: string;
    success: boolean;
    durationMs?: number;
    error?: string;
    [key: string]: unknown;
  },
): void {
  if (!details.success) {
    logger.error(`Database: ${operation} failed`, {
      service: 'database',
      operation,
      ...details,
    });
  } else if (details.durationMs && details.durationMs > 1000) {
    // Log slow queries
    logger.warn(`Database: ${operation} slow query`, {
      service: 'database',
      operation,
      ...details,
    });
  }
}

/**
 * Log file/upload operations
 */
export function logUpload(
  operation: 'started' | 'completed' | 'failed' | 'deleted',
  details: {
    userId?: string;
    fileType?: string;
    fileName?: string;
    fileSize?: number;
    s3Key?: string;
    success: boolean;
    error?: string;
    [key: string]: unknown;
  },
): void {
  const level = details.success ? 'info' : 'error';
  logger.log(level, `Upload: ${operation}`, {
    service: 'upload',
    operation,
    ...details,
  });
}

/**
 * Log security events
 */
export function logSecurity(
  event:
    | 'suspicious_location'
    | 'rate_limit'
    | 'invalid_token'
    | 'unauthorized'
    | 'admin_access'
    | 'refresh_token_reuse'
    | 'refresh_token_grace_recovery',
  details: {
    userId?: string;
    ip?: string;
    path?: string;
    reason?: string;
    [key: string]: unknown;
  },
): void {
  logger.warn(`Security: ${event}`, {
    service: 'security',
    event,
    ...details,
  });
}

/**
 * Log application lifecycle events
 */
export function logApp(
  event: 'startup' | 'shutdown' | 'config_loaded' | 'dependency_connected' | 'dependency_error',
  details: {
    component?: string;
    version?: string;
    message?: string;
    [key: string]: unknown;
  },
): void {
  const level = event === 'dependency_error' ? 'error' : 'info';
  logger.log(level, `App: ${event}`, {
    service: 'app',
    event,
    ...details,
  });
}

// Export types for TypeScript
export type Logger = winston.Logger;
