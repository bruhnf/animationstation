// Serves website/ over HTTP and proxies /api/* to a running backend, so the
// browser sees the same same-origin layout production does (the backend serves
// the static site at the root, and auth.js hardcodes API_BASE = '/api').
//
// Locally the backend can't serve website/ itself: index.ts resolves it as
// path.join(__dirname, '../website'), which only lands on the real directory
// inside the container, where the site is bind-mounted to /app/website.
//
// Optional hooks:
//   feedFixture  — answer GET /api/feed with this payload instead of proxying,
//                  so a test can pin the exact media a post renders.
//   mediaDir     — directory served at /testmedia/*, for fixture video files.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEBSITE_DIR = path.resolve(HERE, '../../website');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Straight pass-through to the backend. Keeps method, headers, and body intact
// so Authorization survives (the guest-claim path depends on it).
function proxy(req, res, body, apiTarget) {
  const target = new URL(req.url, apiTarget);
  const headers = { ...req.headers, host: target.host };
  delete headers['accept-encoding']; // don't negotiate compression we'd have to undo

  const upstream = http.request(
    { hostname: target.hostname, port: target.port, path: target.pathname + target.search, method: req.method, headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `proxy failed: ${err.message}` }));
  });
  if (body.length) upstream.write(body);
  upstream.end();
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
    res.end(buf);
  });
}

export async function startSite({ apiTarget = 'http://localhost:3000', feedFixture = null, mediaDir = null } = {}) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);

    if (feedFixture && pathname === '/api/feed') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(feedFixture));
      return;
    }

    if (mediaDir && pathname.startsWith('/testmedia/')) {
      const name = path.basename(pathname);
      serveFile(res, path.join(mediaDir, name));
      return;
    }

    if (pathname.startsWith('/api/')) {
      proxy(req, res, await readBody(req), apiTarget);
      return;
    }

    // Static site. '/' -> index.html; extensionless -> .html (express `extensions`).
    let rel = pathname === '/' ? '/index.html' : pathname;
    if (!path.extname(rel)) rel += '.html';
    const filePath = path.join(WEBSITE_DIR, rel);
    // Never serve outside website/.
    if (!filePath.startsWith(WEBSITE_DIR)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    serveFile(res, filePath);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
