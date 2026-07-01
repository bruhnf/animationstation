import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { env } from '../config/env';
import { getS3ObjectBytes, keyFromUrl } from '../services/s3Service';
import { presignTryOnJob, presignAvatarOnly } from '../services/imageUrlService';
import { escapeHtml } from '../utils/htmlEscape';
import { createChildLogger } from '../services/logger';

const log = createChildLogger('ShareRoutes');

// Public, unauthenticated share surface for a single try-on result.
//
// A try-on is shareable ONLY when it is COMPLETE and NOT private — exactly the
// same visibility rule as the public feed, so this exposes nothing that wasn't
// already public. Private or missing jobs return 404 (indistinguishable, so we
// don't leak which ids exist). jobIds are unguessable UUIDs.
//
// Three endpoints:
//   GET /api/share/:jobId        -> JSON (the app + the web page consume this)
//   GET /api/share/:jobId/image  -> result image bytes, STABLE url (no expiry)
//                                   so social-link scrapers' og:image keeps working
//   GET /t/:jobId                -> server-rendered HTML w/ OpenGraph/Twitter meta

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PublicJob {
  id: string;
  kind: 'IMAGE' | 'VIDEO';
  title: string | null;
  resultFullBodyUrl: string | null;
  resultMediumUrl: string | null;
  bodyPhotoUrl: string | null;
  clothingPhoto1Url: string | null;
  videoUrl: string | null;
  isPrivate: boolean;
  status: string;
  createdAt: Date;
  likesCount: number;
  user: { username: string; firstName: string | null; avatarUrl: string | null };
}

// Poster image key for a job: a try-on's result, or a video's source image.
function posterKey(job: PublicJob): string | null {
  return job.resultFullBodyUrl ?? job.resultMediumUrl ?? job.bodyPhotoUrl ?? null;
}

async function loadShareableJob(jobId: string): Promise<PublicJob | null> {
  if (!UUID_RE.test(jobId)) return null;
  const job = await prisma.tryOnJob.findFirst({
    where: { id: jobId, status: 'COMPLETE', isPrivate: false },
    select: {
      id: true,
      kind: true,
      title: true,
      resultFullBodyUrl: true,
      resultMediumUrl: true,
      bodyPhotoUrl: true,
      clothingPhoto1Url: true,
      videoUrl: true,
      isPrivate: true,
      status: true,
      createdAt: true,
      likesCount: true,
      user: { select: { username: true, firstName: true, avatarUrl: true } },
    },
  });
  return job;
}

function displayName(user: { username: string; firstName: string | null }): string {
  return user.firstName?.trim() || user.username;
}

// App Store link when the numeric Apple id is configured, else the marketing site.
function appStoreUrl(): string {
  return env.apple.appAppleId > 0
    ? `https://apps.apple.com/app/id${env.apple.appAppleId}`
    : env.websiteUrl;
}

// ---------------------------------------------------------------------------
// JSON + image proxy — mounted at /api/share
// ---------------------------------------------------------------------------
const apiRouter = Router();

apiRouter.get('/:jobId', async (req: Request, res: Response) => {
  const job = await loadShareableJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'This content is not available.' });
    return;
  }

  const [presigned, presignedUser] = await Promise.all([
    presignTryOnJob(job),
    presignAvatarOnly(job.user),
  ]);
  res.setHeader('Cache-Control', 'public, max-age=120');
  res.json({
    id: job.id,
    createdAt: job.createdAt,
    likesCount: job.likesCount,
    author: {
      username: job.user.username,
      displayName: displayName(job.user),
      avatarUrl: presignedUser.avatarUrl,
    },
    resultFullBodyUrl: presigned.resultFullBodyUrl,
    resultMediumUrl: presigned.resultMediumUrl,
    // Stable, non-expiring URLs the client can render or hand to a native share sheet.
    shareUrl: `${env.appUrl}/t/${job.id}`,
    imageUrl: `${env.appUrl}/api/share/${job.id}/image`,
  });
});

apiRouter.get('/:jobId/image', async (req: Request, res: Response) => {
  const job = await loadShareableJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }

  // Prefer the full-body result; allow ?view=medium; fall back to whichever
  // exists; for a VIDEO use its poster (the source image).
  const preferMedium = req.query.view === 'medium';
  const primary = preferMedium ? job.resultMediumUrl : job.resultFullBodyUrl;
  const fallback = preferMedium ? job.resultFullBodyUrl : job.resultMediumUrl;
  const key = primary ?? fallback ?? posterKey(job);
  if (!key) {
    res.status(404).json({ error: 'NO_IMAGE' });
    return;
  }

  try {
    const { body, contentType } = await getS3ObjectBytes(keyFromUrl(key));
    res.setHeader('Content-Type', contentType);
    // Long cache: result images are immutable once a job COMPLETEs.
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(body);
  } catch (err) {
    log.warn('Share image fetch failed', {
      jobId: job.id,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(502).json({ error: 'IMAGE_UNAVAILABLE' });
  }
});

// Stable byte-proxy for a VIDEO result's .mp4 (mirrors the image proxy) so the
// share page and og:video have a non-expiring URL.
apiRouter.get('/:jobId/video', async (req: Request, res: Response) => {
  const job = await loadShareableJob(req.params.jobId);
  if (!job || !job.videoUrl) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }
  try {
    const { body, contentType } = await getS3ObjectBytes(keyFromUrl(job.videoUrl));
    res.setHeader('Content-Type', contentType || 'video/mp4');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(body);
  } catch (err) {
    log.warn('Share video fetch failed', {
      jobId: job.id,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(502).json({ error: 'VIDEO_UNAVAILABLE' });
  }
});

// ---------------------------------------------------------------------------
// Server-rendered share page with OG/Twitter meta — mounted at /t
// ---------------------------------------------------------------------------
const pageRouter = Router();

pageRouter.get('/:jobId', async (req: Request, res: Response) => {
  const job = await loadShareableJob(req.params.jobId);
  const appUrl = env.appUrl;
  const site = env.websiteUrl;
  const store = appStoreUrl();

  if (!job) {
    res.status(404).type('html').send(notFoundPage(site, store));
    return;
  }

  const name = escapeHtml(displayName(job.user));
  // The user-authored caption, when present, leads the title/description so the
  // shared link preview reflects what the user named their look. Escaped — it's
  // arbitrary user text dropped into HTML/meta attributes.
  const caption = job.title ? escapeHtml(job.title) : '';
  const title = caption
    ? `${caption} · ${name}'s creation · AnimationStation`
    : `${name}'s AI creation · AnimationStation`;
  const desc = caption
    ? `${caption} — an AI creation made with AnimationStation.`
    : 'See this AI creation made with AnimationStation — generate AI images and videos.';
  const imageUrl = `${appUrl}/api/share/${job.id}/image`;
  const canonical = `${appUrl}/t/${job.id}`;
  const videoUrl =
    job.kind === 'VIDEO' && job.videoUrl ? `${appUrl}/api/share/${job.id}/video` : '';

  res.setHeader('Cache-Control', 'public, max-age=300');
  res
    .type('html')
    .send(sharePage({ title, desc, imageUrl, videoUrl, canonical, name, caption, site, store }));
});

function sharePage(p: {
  title: string;
  desc: string;
  imageUrl: string;
  videoUrl: string;
  canonical: string;
  name: string;
  caption: string;
  site: string;
  store: string;
}): string {
  const media = p.videoUrl
    ? `<video controls playsinline poster="${p.imageUrl}" src="${p.videoUrl}" style="display:block;width:100%;height:auto;"></video>`
    : `<img src="${p.imageUrl}" alt="${p.name}'s AI creation" loading="eager">`;
  const videoMeta = p.videoUrl
    ? `<meta property="og:type" content="video.other">
<meta property="og:video" content="${p.videoUrl}">
<meta property="og:video:type" content="video/mp4">
<meta name="twitter:player:stream" content="${p.videoUrl}">`
    : `<meta property="og:type" content="website">`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${p.title}</title>
<meta name="description" content="${p.desc}">
<link rel="canonical" href="${p.canonical}">
${videoMeta}
<meta property="og:site_name" content="AnimationStation">
<meta property="og:title" content="${p.title}">
<meta property="og:description" content="${p.desc}">
<meta property="og:image" content="${p.imageUrl}">
<meta property="og:url" content="${p.canonical}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${p.title}">
<meta name="twitter:description" content="${p.desc}">
<meta name="twitter:image" content="${p.imageUrl}">
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #fff; color: #111; display: flex; min-height: 100vh; align-items: center; justify-content: center; padding: 24px; }
  .card { width: 100%; max-width: 420px; text-align: center; }
  .badge { display: inline-block; font-size: 12px; font-weight: 700; letter-spacing: .5px;
    background: #111; color: #fff; border-radius: 999px; padding: 5px 12px; margin-bottom: 16px; }
  .imgwrap { position: relative; border-radius: 18px; overflow: hidden; background: #f2f2f2; box-shadow: 0 6px 24px rgba(0,0,0,.12); }
  .imgwrap img { display: block; width: 100%; height: auto; }
  .ai { position: absolute; left: 10px; bottom: 10px; background: rgba(0,0,0,.6); color: #fff;
    font-size: 12px; font-weight: 600; border-radius: 999px; padding: 4px 10px; }
  h1 { font-size: 20px; margin: 18px 0 6px; }
  p.sub { color: #666; margin: 0 0 22px; font-size: 15px; }
  a.cta { display: inline-block; background: #111; color: #fff; text-decoration: none; font-weight: 700;
    border-radius: 999px; padding: 14px 26px; }
  a.link { display: block; margin-top: 16px; color: #888; font-size: 13px; text-decoration: none; }
</style>
</head>
<body>
  <div class="card">
    <div class="badge">${p.videoUrl ? '✨ AI VIDEO' : '✨ AI IMAGE'}</div>
    <div class="imgwrap">
      ${media}
      <span class="ai">✨ AI-generated</span>
    </div>
    <h1>${p.caption || `${p.name}'s creation`}</h1>
    <p class="sub">${p.caption ? `${p.name}'s creation · ` : ''}Made with AnimationStation — generate AI images and videos.</p>
    <a class="cta" href="${p.store}">Get the app</a>
    <a class="link" href="${p.site}">animationstation.bruhnfreeman.com</a>
  </div>
</body>
</html>`;
}

function notFoundPage(site: string, store: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Content not available · AnimationStation</title>
<style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#fff;color:#111;
  display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px}
  a.cta{display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:700;border-radius:999px;padding:14px 26px;margin-top:18px}</style>
</head><body><div>
  <h1>This content isn't available</h1>
  <p style="color:#666">It may be private or no longer exist.</p>
  <a class="cta" href="${store}">Get AnimationStation</a>
  <p style="margin-top:14px"><a href="${site}" style="color:#888;font-size:13px">animationstation.bruhnfreeman.com</a></p>
</div></body></html>`;
}

export default apiRouter;
export { pageRouter };
