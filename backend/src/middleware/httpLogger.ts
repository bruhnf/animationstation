/**
 * HTTP Request Logging Middleware
 *
 * Features:
 * - Assigns unique correlation ID to each request
 * - Logs request start and completion
 * - Tracks response time
 * - Attaches logger to request for use in handlers
 * - Masks sensitive data in logs
 */

import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger, createRequestLogger, Logger } from '../services/logger';

// Extend Express Request to include our logger
declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      log: Logger;
      startTime: number;
    }
  }
}

// Paths to skip detailed logging (health checks, static files)
const SKIP_PATHS = ['/health', '/healthz', '/ready', '/favicon.ico'];

// Sensitive fields to mask in logs
const SENSITIVE_FIELDS = ['password', 'passwordHash', 'token', 'refreshToken', 'apiKey', 'secret'];

/**
 * Mask sensitive data in objects
 */
function maskSensitive(obj: Record<string, unknown>): Record<string, unknown> {
  if (!obj || typeof obj !== 'object') return obj;

  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_FIELDS.some((field) => key.toLowerCase().includes(field.toLowerCase()))) {
      masked[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      masked[key] = maskSensitive(value as Record<string, unknown>);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

/**
 * Get client IP from request (handles proxies)
 */
function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

/**
 * Main HTTP logging middleware
 */
export function httpLogger(req: Request, res: Response, next: NextFunction): void {
  // Skip logging for certain paths
  if (SKIP_PATHS.some((path) => req.path.startsWith(path))) {
    req.correlationId = uuidv4();
    req.log = createRequestLogger(req.correlationId);
    req.startTime = Date.now();
    return next();
  }

  // Generate correlation ID (or use one from headers for distributed tracing)
  const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4();
  req.correlationId = correlationId;
  req.startTime = Date.now();

  // Create request-scoped logger with correlation ID and user ID (if available)
  const userId = (req as Request & { user?: { id: string } }).user?.id;
  req.log = createRequestLogger(correlationId, userId);

  // Add correlation ID to response headers for tracing
  res.setHeader('x-correlation-id', correlationId);

  // Log request start
  const requestLog = {
    method: req.method,
    path: req.path,
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
    ip: getClientIp(req),
    userAgent: req.headers['user-agent']?.slice(0, 100), // Truncate long UAs
    contentLength: req.headers['content-length'],
    userId,
  };

  logger.http('Request started', {
    service: 'http',
    correlationId,
    ...requestLog,
  });

  // Log request body for non-GET requests (masked)
  if (req.method !== 'GET' && req.body && Object.keys(req.body).length > 0) {
    logger.debug('Request body', {
      service: 'http',
      correlationId,
      body: maskSensitive(req.body),
    });
  }

  // Capture response
  const originalSend = res.send;
  let responseBody: unknown;

  res.send = function (body): Response {
    responseBody = body;
    return originalSend.call(this, body);
  };

  // Log response on finish
  res.on('finish', () => {
    const durationMs = Date.now() - req.startTime;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'http';

    const responseLog = {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
      contentLength: res.getHeader('content-length'),
      userId,
    };

    logger.log(level, 'Request completed', {
      service: 'http',
      correlationId,
      ...responseLog,
    });

    // Log error response bodies for debugging
    if (res.statusCode >= 400 && responseBody) {
      try {
        const body = typeof responseBody === 'string' ? JSON.parse(responseBody) : responseBody;
        logger.debug('Error response body', {
          service: 'http',
          correlationId,
          body: maskSensitive(body),
        });
      } catch {
        // Not JSON, log as-is (truncated)
        logger.debug('Error response body', {
          service: 'http',
          correlationId,
          body: String(responseBody).slice(0, 500),
        });
      }
    }
  });

  next();
}

/**
 * Error logging middleware - use after routes
 */
export function errorLogger(err: Error, req: Request, res: Response, next: NextFunction): void {
  const durationMs = req.startTime ? Date.now() - req.startTime : 0;

  logger.error('Request error', {
    service: 'http',
    correlationId: req.correlationId,
    method: req.method,
    path: req.path,
    durationMs,
    error: err.message,
    stack: err.stack,
    userId: (req as Request & { user?: { id: string } }).user?.id,
  });

  next(err);
}
