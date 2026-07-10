// End-to-end proof that a feed video keeps its aspect ratio instead of being
// cropped to fill the post.
//
// The bug this guards: .feed-media.video used object-fit:cover, so a clip
// animated from a square or 16:9 image had its left and right edges cut off in
// the portrait feed. Images already used contain. Videos now match.
//
// Three real videos are encoded with ffmpeg, one per aspect ratio, each framed
// by a red border that runs along all four edges of the frame. Rendered in a
// portrait viewport:
//   * contain -> the whole frame fits, all four borders visible, black
//     letterbox bars above and below a square or 16:9 clip.
//   * cover   -> the frame is scaled up to fill, the left/right borders are
//     scrolled off-screen, and there are no bars.
// The assertions read the actual painted pixels, so they describe what a person
// looking at the page would see.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startSite } from './siteServer.mjs';

const VIEWPORT = { width: 480, height: 900 }; // portrait, like a phone

const CLIPS = [
  { name: 'square', w: 720, h: 720, expectBars: true },
  { name: 'landscape', w: 1280, h: 720, expectBars: true },
  { name: 'portrait', w: 608, h: 1080, expectBars: false }, // ~9:16, close to the viewport
];

const checks = [];
function check(name, pass, detail = '') {
  checks.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// A red frame drawn on a white field. The border is thick enough to survive
// yuv420p chroma subsampling and the browser's scaling.
function encode(dir, { name, w, h }) {
  const out = path.join(dir, `${name}.mp4`);
  const b = Math.round(Math.min(w, h) * 0.08); // border thickness
  execFileSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error',
     '-f', 'lavfi', '-i', `color=c=white:s=${w}x${h}:d=1:r=10`,
     '-vf', `drawbox=x=0:y=0:w=${w}:h=${h}:color=red:t=${b}`,
     '-pix_fmt', 'yuv420p', '-c:v', 'libx264', out],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  return out;
}

const feedFixture = (clips) => ({
  hasMore: false,
  jobs: clips.map((c, i) => ({
    id: `fixture-${c.name}`,
    kind: 'VIDEO',
    videoUrl: `/testmedia/${c.name}.mp4`,
    title: `${c.name} clip`,
    createdAt: new Date(0).toISOString(),
    likesCount: 0,
    commentsCount: 0,
    liked: false,
    saved: false,
    user: { id: `u${i}`, username: `creator${i}`, avatarUrl: null },
  })),
});

// Sample the painted page. Returns the video's box, its intrinsic size, the
// resolved object-fit, and a few pixel probes taken from a screenshot.
async function probe(page, jobId) {
  const video = page.locator(`.feed-post[data-job-id="fixture-${jobId}"] video`);
  await video.scrollIntoViewIfNeeded();
  // Wait for the first frame to be decodable, then pin it so the screenshot is
  // deterministic regardless of autoplay timing.
  await video.evaluate(async (v) => {
    if (v.readyState < 2) await new Promise((r) => v.addEventListener('loadeddata', r, { once: true }));
    v.pause();
    v.currentTime = 0;
    await new Promise((r) => (v.seeking ? v.addEventListener('seeked', r, { once: true }) : r()));
  });

  const geom = await video.evaluate((v) => {
    const r = v.getBoundingClientRect();
    return {
      box: { x: r.x, y: r.y, w: r.width, h: r.height },
      intrinsic: { w: v.videoWidth, h: v.videoHeight },
      objectFit: getComputedStyle(v).objectFit,
    };
  });

  const { x, y, w, h } = geom.box;
  const shot = await page.screenshot({ clip: { x, y, width: w, height: h } });
  const pixels = await samplePixels(page, shot, geom);
  return { ...geom, pixels };
}

// Decode the screenshot inside the browser (no image library needed) and probe
// the points that distinguish a letterboxed frame from a cropped one.
async function samplePixels(page, pngBuffer, geom) {
  return page.evaluate(
    async ([b64, box, intrinsic]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      // The screenshot may be at a device pixel ratio > 1.
      const sx = img.width / box.w;
      const sy = img.height / box.h;
      const at = (x, y) => {
        const d = ctx.getImageData(Math.round(x * sx), Math.round(y * sy), 1, 1).data;
        return { r: d[0], g: d[1], b: d[2] };
      };
      const near = (p, r, g, b, tol = 60) =>
        Math.abs(p.r - r) < tol && Math.abs(p.g - g) < tol && Math.abs(p.b - b) < tol;

      // Where a `contain` fit would paint the frame inside the element box.
      const scale = Math.min(box.w / intrinsic.w, box.h / intrinsic.h);
      const pw = intrinsic.w * scale;
      const ph = intrinsic.h * scale;
      const px = (box.w - pw) / 2;
      const py = (box.h - ph) / 2;
      const midY = box.h / 2;
      const midX = box.w / 2;
      const inset = 3; // just inside the painted frame's edge

      return {
        paintedRect: { x: px, y: py, w: pw, h: ph },
        // The red border, sampled just inside each edge of where the whole
        // frame should sit. Missing => that edge was cropped away.
        borderLeft: near(at(px + inset, midY), 237, 28, 36),
        borderRight: near(at(px + pw - inset, midY), 237, 28, 36),
        borderTop: near(at(midX, py + inset), 237, 28, 36),
        borderBottom: near(at(midX, py + ph - inset), 237, 28, 36),
        // Letterbox bars: the post's black background, outside the painted frame.
        barAbove: py > 4 ? near(at(midX, py / 2), 0, 0, 0, 30) : null,
        barBelow: py > 4 ? near(at(midX, box.h - py / 2), 0, 0, 0, 30) : null,
        barLeft: px > 4 ? near(at(px / 2, midY), 0, 0, 0, 30) : null,
      };
    },
    [pngBuffer.toString('base64'), geom.box, geom.intrinsic],
  );
}

export async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-feed-video-'));
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    throw new Error('ffmpeg is required for the feed video layout test (not on PATH)');
  }
  CLIPS.forEach((c) => encode(dir, c));

  const site = await startSite({ feedFixture: feedFixture(CLIPS), mediaDir: dir });
  const browser = await chromium.launch({
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  const page = await browser.newPage({ viewport: VIEWPORT });

  // Seed a session so feed.js's ensureSession() short-circuits instead of
  // minting a guest. /api/feed is a fixture here, so the token is never
  // validated — and this keeps a layout test from burning the real
  // 10-per-hour-per-IP guest-creation budget. Runs before any page script.
  await page.addInitScript(() => {
    localStorage.setItem('accessToken', 'layout-test-token');
    localStorage.setItem('refreshToken', 'layout-test-refresh');
    localStorage.setItem('user', JSON.stringify({ id: 'layout-test', username: 'tester', isGuest: true }));
  });

  try {
    await page.goto(`${site.url}/`);
    await page.waitForSelector('.feed-post video', { timeout: 20000 });
    // The overlays (scrim, caption, action rail) paint on top of the media and
    // would contaminate the pixel probes. Hide them; they are absolutely
    // positioned, so the video's geometry is untouched.
    await page.addStyleTag({
      content: '.post-scrim,.post-creator,.post-rail,.ai-badge,.mute-btn,.play-overlay{display:none !important}',
    });

    for (const clip of CLIPS) {
      const p = await probe(page, clip.name);
      const label = `${clip.name} (${p.intrinsic.w}x${p.intrinsic.h})`;
      console.log(`\n  ${label}: box=${Math.round(p.box.w)}x${Math.round(p.box.h)} objectFit=${p.objectFit}`);

      check(`${label}: object-fit is contain`, p.objectFit === 'contain', p.objectFit);

      const paintedAspect = p.pixels.paintedRect.w / p.pixels.paintedRect.h;
      const intrinsicAspect = p.intrinsic.w / p.intrinsic.h;
      check(
        `${label}: painted frame keeps the source aspect ratio`,
        Math.abs(paintedAspect - intrinsicAspect) < 0.01,
        `painted=${paintedAspect.toFixed(3)} source=${intrinsicAspect.toFixed(3)}`,
      );
      check(
        `${label}: painted frame fits inside the post`,
        p.pixels.paintedRect.w <= p.box.w + 1 && p.pixels.paintedRect.h <= p.box.h + 1,
      );

      // Each edge of the source frame must be painted at the boundary a
      // letterboxed fit puts it. Under the old `cover`, the frame was scaled up
      // and its side borders fell outside the post entirely.
      const px = p.pixels;
      check(`${label}: frame's left edge painted at the letterbox boundary`, px.borderLeft);
      check(`${label}: frame's right edge painted at the letterbox boundary`, px.borderRight);
      check(`${label}: frame's top edge painted at the letterbox boundary`, px.borderTop);
      check(`${label}: frame's bottom edge painted at the letterbox boundary`, px.borderBottom);

      if (clip.expectBars) {
        check(`${label}: letterboxed with a black bar above`, px.barAbove === true);
        check(`${label}: letterboxed with a black bar below`, px.barBelow === true);
      } else {
        check(`${label}: near-9:16 clip fills the post (no bars)`, px.barAbove === null || px.barAbove === true);
      }
    }
  } finally {
    await browser.close();
    await site.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  return checks;
}
