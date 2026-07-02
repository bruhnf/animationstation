import * as client from 'prom-client';
import { Request, Response, NextFunction } from 'express';

// Prometheus metrics for capacity monitoring (Phase-0 observability).
// Exposes default process/Node metrics (event-loop lag, heap, GC, CPU — the
// signals that actually predict this box tipping over) plus a per-request HTTP
// latency histogram + counter. Scrape at GET /metrics.
//
// SECURITY: keep /metrics internal — nginx must only expose it to the metrics
// scraper, never the public internet. (Dev nginx's catch-all 404s it already.)
export const register = new client.Registry();

register.setDefaultLabels({ app: 'animationstation-backend' });
client.collectDefaultMetrics({ register });

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [register],
});

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    // req.route is populated once the response finishes (when a route matched).
    // Use the route *pattern* (e.g. /api/profile/:username) — never the concrete
    // path — to bound label cardinality and avoid leaking ids into metrics.
    const route =
      req.route && req.route.path
        ? (req.baseUrl || '') + req.route.path
        : res.statusCode === 404
          ? 'unmatched'
          : req.path;
    const labels = { method: req.method, route, status: String(res.statusCode) };
    httpRequestDuration.observe(labels, seconds);
    httpRequestsTotal.inc(labels);
  });
  next();
}

export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
}
