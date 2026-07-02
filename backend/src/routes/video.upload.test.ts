/**
 * Integration test for the AI Video upload layer: the REAL multer middleware
 * (`uploadVideoSources`, `.fields([photo, photo2])`) + the REAL source selection
 * (`selectVideoSources`), exercised over HTTP via supertest.
 *
 * This is the layer that broke in prod: the route used `.single('photo')` (→
 * req.file) while the controller read `req.files.photo`, so camera-roll uploads
 * were silently dropped and the request 400'd with NO_SOURCE. If the middleware
 * regresses to `.single` (or the field names drift), these tests fail.
 *
 * No DB / Redis / Grok — only the upload middleware + the pure selector.
 * Run with: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { uploadVideoSources } from '../middleware/uploadMiddleware';
import { selectVideoSources, VideoRequestFiles } from '../utils/videoSource';

// Mirror the real video route's upload layer, then report what the controller
// would see from selectVideoSources.
function makeApp() {
  const app = express();
  app.post('/video', uploadVideoSources, (req, res) => {
    const kind = (s: ReturnType<typeof selectVideoSources>['primary']) =>
      s ? (s.file ? 'photo' : s.sourceJobId ? 'transform' : 'body') : null;
    const { primary, second } = selectVideoSources(
      req.body,
      req.files as VideoRequestFiles | undefined,
    );
    res.json({ primary: kind(primary), second: kind(second) });
  });
  return app;
}

const jpeg = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const attachPhoto = (r: request.Test, field: string, name: string) =>
  r.attach(field, jpeg(), { filename: name, contentType: 'image/jpeg' });

test('camera-roll photo upload is seen as the primary source (real .fields parsing)', async () => {
  const res = await attachPhoto(request(makeApp()).post('/video'), 'photo', 'a.jpg');
  assert.equal(res.status, 200);
  assert.equal(res.body.primary, 'photo');
  assert.equal(res.body.second, null);
});

test('photo + photo2 → both slots detected', async () => {
  let r = request(makeApp()).post('/video');
  r = attachPhoto(r, 'photo', 'a.jpg');
  r = attachPhoto(r, 'photo2', 'b.jpg');
  const res = await r;
  assert.equal(res.body.primary, 'photo');
  assert.equal(res.body.second, 'photo');
});

test('photo (primary) + sourceJobId2 body field (transition) → photo + creation', async () => {
  const res = await attachPhoto(
    request(makeApp()).post('/video').field('sourceJobId2', 'job-9'),
    'photo',
    'a.jpg',
  );
  assert.equal(res.body.primary, 'photo');
  assert.equal(res.body.second, 'transform');
});

test('body-field-only source (no upload) → detected', async () => {
  const res = await request(makeApp()).post('/video').field('bodyPhoto', 'full');
  assert.equal(res.status, 200);
  assert.equal(res.body.primary, 'body');
});

test('no source at all → primary null (controller would return 400 NO_SOURCE)', async () => {
  const res = await request(makeApp()).post('/video');
  assert.equal(res.body.primary, null);
});

test('a non-image upload is rejected by the file filter (415)', async () => {
  const res = await request(makeApp())
    .post('/video')
    .attach('photo', Buffer.from('hello'), { filename: 'x.txt', contentType: 'text/plain' });
  assert.equal(res.status, 415);
});
