import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { imageSize, blankReason } from './check-images.mjs';

test('imageSize reads a VP8 WebP header', () => {
  const buf = readFileSync('public/creatives/google/cr18387200511133614081.webp');
  const dim = imageSize(buf);
  assert.equal(dim.height <= 40, true);
  assert.ok(dim.width > dim.height);
});

test('blankReason warns on a sub-1KB or very short creative', () => {
  const why = blankReason('public/creatives/google/cr04520190647948279809.webp');
  assert.match(why, /104B/);
  assert.match(why, /×/);
  const tall = blankReason('public/creatives/organic/mayven-18210118.webp');
  assert.equal(tall, '');
});
