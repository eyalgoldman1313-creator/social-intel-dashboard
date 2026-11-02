import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { imageSize, blankReason, checkImages, reportImages } from './check-images.mjs';

function vp8({ width, height, bytes = 30 }) {
  const buf = Buffer.alloc(bytes);
  buf.write('RIFF', 0);
  buf.write('WEBP', 8);
  buf.write('VP8 ', 12);
  buf[20] = 0x9d; buf[21] = 0x01; buf[22] = 0x2a;
  buf.writeUInt16LE(width & 0x3fff, 23);
  buf.writeUInt16LE(height & 0x3fff, 25);
  return buf;
}

test('imageSize reads a VP8 WebP header', () => {
  const dim = imageSize(vp8({ width: 672, height: 32 }));
  assert.equal(dim.width, 672);
  assert.equal(dim.height, 32);
  assert.equal(dim.height <= 40, true);
  assert.ok(dim.width > dim.height);
});

test('blankReason warns on a sub-1KB or very short creative', () => {
  const dir = mkdtempSync(join(tmpdir(), 'blank-'));
  try {
    const short = join(dir, 'short.webp');
    const tall = join(dir, 'tall.webp');
    writeFileSync(short, vp8({ width: 900, height: 25, bytes: 104 }));
    writeFileSync(tall, vp8({ width: 400, height: 500, bytes: 2048 }));
    const why = blankReason(short);
    assert.match(why, /104B/);
    assert.match(why, /900×25/);
    assert.equal(blankReason(tall), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function imageRoot(bytes) {
  const dir = mkdtempSync(join(tmpdir(), 'imgcheck-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(join(dir, 'public/creatives/meta'), { recursive: true });
  writeFileSync(join(dir, 'public/creatives/meta/a.webp'), Buffer.alloc(bytes));
  writeFileSync(join(dir, 'data/creatives.json'), JSON.stringify({
    items: [{ id: 'meta-a', source: 'meta', image: 'creatives/meta/a.webp' }],
  }));
  return dir;
}

test('--strict fails a sub-1KB image and passes a 5KB image', () => {
  const tiny = imageRoot(300);
  const ok = imageRoot(5000);
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
