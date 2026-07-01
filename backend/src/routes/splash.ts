import { Router, Request, Response } from 'express';
import { getActiveSplash, splashImageUrl, readSplashBytes } from '../services/splashService';
import { createChildLogger } from '../services/logger';

const log = createChildLogger('Splash');

// Public, unauthenticated splash/announcement endpoints. The splash is shown
// before/over everything else in the app (including to guests), and the image
// is loaded by a plain <Image> tag with no auth header, so both endpoints are
// deliberately open. Nothing user-specific or sensitive is served here.
const router = Router();

// Is there a splash to show right now? The app calls this on every launch. Any
// error degrades to "no splash" — it must never block app startup.
router.get('/', async (_req: Request, res: Response) => {
  try {
    const splash = await getActiveSplash();
    if (!splash) {
      res.json({ active: false });
      return;
    }
    res.json({
      active: true,
      id: splash.id,
      imageUrl: splashImageUrl(splash),
      publishedAt: splash.publishedAt,
    });
  } catch (err) {
    log.warn('getActiveSplash failed — returning no splash', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.json({ active: false });
  }
});

// The splash image bytes (streamed from S3). ETag = splash id so replaced images
// bust caches and unchanged ones revalidate cheaply.
router.get('/image', async (req: Request, res: Response) => {
  try {
    const splash = await getActiveSplash();
    if (!splash) {
      res.status(404).json({ error: 'No active splash' });
      return;
    }
    const etag = `"${splash.id}"`;
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    const { body, contentType } = await readSplashBytes(splash);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('ETag', etag);
    res.send(body);
  } catch (err) {
    log.warn('splash image fetch failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(404).json({ error: 'No active splash' });
  }
});

export default router;
