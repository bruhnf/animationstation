// Browse the Discover feed AS A GUEST and report, per card, whether the input
// thumbnails (bodyPhotoUrl / clothingPhoto1Url) are present alongside the AI
// result. Reproduces the "feed thumbnails missing on most cards" report: a
// guest owns no feed posts, so any non-owner input-stripping shows up here.
//
// Usage:  node scripts/feedGuestCheck.mjs [baseApiUrl]
//   default: https://api-dev.tryon-mirror.ai/api
//   prod:    node scripts/feedGuestCheck.mjs https://api.tryon-mirror.ai/api

const BASE = process.argv[2] || 'https://api-dev.tryon-mirror.ai/api';

const guest = await fetch(`${BASE}/auth/guest`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ deviceId: 'feed-check-' + Math.random().toString(36).slice(2) }),
}).then((r) => r.json());

const token = guest.accessToken || guest.token;
if (!token) {
  console.error('Could not mint a guest token:', guest);
  process.exit(1);
}

const feed = await fetch(`${BASE}/feed?page=1`, {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json());

const jobs = feed.jobs || [];
let missBody = 0;
let missCloth = 0;
for (const j of jobs) {
  const isVideo = j.kind === 'VIDEO';
  const hasResult = !!(j.resultFullBodyUrl || j.resultMediumUrl || j.videoUrl);
  const hasBody = !!j.bodyPhotoUrl;
  const hasCloth = !!j.clothingPhoto1Url;
  if (!hasBody) missBody++;
  if (!hasCloth && !isVideo) missCloth++;
  console.log(
    `${j.id.slice(0, 8)}  kind=${(j.kind || 'IMAGE').padEnd(5)}  result=${hasResult ? 'Y' : 'N'}  bodyThumb=${hasBody ? 'Y' : '—'}  clothingThumb=${hasCloth ? 'Y' : '—'}`,
  );
}
console.log(
  `\n${jobs.length} feed cards | missing body thumb: ${missBody} | missing clothing thumb: ${missCloth}`,
);
