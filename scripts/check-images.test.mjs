import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageSize, blankReason, checkImages, reportImages } from './check-images.mjs';

// Frozen fixtures. Real files under public/creatives are replaced by fetch-ad-images.
const fx = (n) => fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url));

test('imageSize reads a VP8 WebP header', () => {
  const dim = imageSize(readFileSync(fx('blank-short-vp8.webp')));
  assert.equal(dim.height <= 40, true);
  assert.ok(dim.width > dim.height);
  assert.equal(dim.width, 672);
  assert.equal(dim.height, 32);
});

test('blankReason warns on a sub-1KB or very short creative', () => {
  const why = blankReason(fx('blank-104b.webp'));
  assert.equal(statSync(fx('blank-104b.webp')).size, 104);
  assert.match(why, /104B/);
  assert.match(why, /×/);
  assert.ok(statSync(fx('normal.webp')).size > 1024);
  assert.equal(blankReason(fx('normal.webp')), '');
  assert.equal(blankReason(fx('does-not-exist.webp')), 'missing');
});

function imageRoot(fixtureName) {
  const dir = mkdtempSync(join(tmpdir(), 'imgcheck-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(join(dir, 'public/creatives/meta'), { recursive: true });
  writeFileSync(join(dir, 'public/creatives/meta/a.webp'), readFileSync(fx(fixtureName)));
  writeFileSync(join(dir, 'data/creatives.json'), JSON.stringify({
    items: [{ id: 'meta-a', source: 'meta', image: 'creatives/meta/a.webp' }],
  }));
  return dir;
}

test('--strict fails a sub-1KB image and passes a 5KB image', () => {
  const tiny = imageRoot('blank-104b.webp');
  const ok = imageRoot('normal.webp');
  try {
    const bad = checkImages(tiny);
    assert.equal(bad.creatives.blank.length, 1);
    assert.equal(bad.creatives.blank[0].id, 'meta-a');
    const strictBad = reportImages(bad, { strict: true });
    assert.equal(strictBad.bad, 0);
    assert.equal(strictBad.exitCode, 1);

    const good = checkImages(ok);
    assert.equal(good.creatives.blank.length, 0);
    assert.equal(good.creatives.missing.length, 0);
    assert.equal(reportImages(good, { strict: true }).exitCode, 0);
    assert.equal(reportImages(bad, { strict: false }).exitCode, 0);
  } finally {
    rmSync(tiny, { recursive: true, force: true });
    rmSync(ok, { recursive: true, force: true });
  }
});
