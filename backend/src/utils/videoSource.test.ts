/**
 * Unit tests for AI Video source selection. Pure → no env/DB/HTTP.
 * Run with: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectVideoSources } from './videoSource';

// Minimal stand-in for a multer file (selectVideoSources only checks presence).
const fakeFile = (name = 'pic.jpg') =>
  ({ originalname: name, buffer: Buffer.alloc(0) }) as Express.Multer.File;

test('camera-roll photo in req.files.photo[0] → primary photo (the .fields contract)', () => {
  const r = selectVideoSources({}, { photo: [fakeFile()] });
  assert.ok(r.primary && r.primary.file);
  assert.equal(r.second, null);
});

test('REGRESSION: a .single upload leaves req.files undefined → NO primary detected', () => {
  // multer .single('photo') populates req.file and leaves req.files undefined.
  // selectVideoSources reads req.files, so it correctly finds nothing — which is
  // why the route MUST use .fields (uploadVideoSources). This pins that contract.
  const r = selectVideoSources(
    {
      /* no body source */
    },
    undefined,
  );
  assert.equal(r.primary, null);
});

test('creation + body-photo sources come from the body', () => {
  assert.deepEqual(selectVideoSources({ sourceJobId: 'job-1' }, undefined).primary, {
    sourceJobId: 'job-1',
  });
  assert.deepEqual(selectVideoSources({ bodyPhoto: 'full' }, undefined).primary, {
    bodyPhoto: 'full',
  });
  assert.deepEqual(selectVideoSources({ bodyPhoto: 'medium' }, undefined).primary, {
    bodyPhoto: 'medium',
  });
});

test('invalid / blank body-source values are ignored', () => {
  assert.equal(selectVideoSources({ bodyPhoto: 'avatar' }, undefined).primary, null);
  assert.equal(selectVideoSources({ sourceJobId: '   ' }, undefined).primary, null);
  assert.equal(
    selectVideoSources({ sourceJobId: 42 as unknown as string }, undefined).primary,
    null,
  );
});

test('within a slot, file beats sourceJobId beats bodyPhoto', () => {
  const r = selectVideoSources({ sourceJobId: 'j', bodyPhoto: 'full' }, { photo: [fakeFile()] });
  assert.ok(r.primary?.file);
  assert.equal(r.primary?.sourceJobId, undefined);
});

test('the optional second/transition image is read from the *2 fields', () => {
  assert.ok(
    selectVideoSources({}, { photo: [fakeFile()], photo2: [fakeFile('b.jpg')] }).second?.file,
  );
  assert.deepEqual(selectVideoSources({ bodyPhoto: 'full', sourceJobId2: 'j2' }, undefined), {
    primary: { bodyPhoto: 'full' },
    second: { sourceJobId: 'j2' },
  });
});

test('no source at all → both slots null', () => {
  assert.deepEqual(selectVideoSources({}, {}), { primary: null, second: null });
  assert.deepEqual(selectVideoSources(undefined, undefined), { primary: null, second: null });
});
