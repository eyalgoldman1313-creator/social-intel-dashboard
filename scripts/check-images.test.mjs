import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { imageSize, blankReason } from './check-images.mjs';

// Built in memory. The old assertions read public/creatives files that later
// recoveries replaced, so a passing run no longer depended on those bytes.
function vp8Webp({ width, height, bytes }) {
  const buf = Buffer.alloc(bytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(bytes - 8, 4);
  buf.write('WEBP', 8);
  buf.write('VP8 ', 12);
  const start = 20;
  buf[start] = 0x9d;
  buf[start + 1] = 0x01;
  buf[start + 2] = 0x2a;
  buf.writeUInt16LE(width, start + 3);
  buf.writeUInt16LE(height, start + 5);
  return buf;
}

test('imageSize reads a VP8 WebP header', () => {
  const buf = vp8Webp({ width: 200, height: 32, bytes: 64 });
  const dim = imageSize(buf);
  assert.equal(dim.height <= 40, true);
  assert.ok(dim.width > dim.height);
});

test('blankReason warns on a sub-1KB or very short creative', () => {
  const dir = mkdtempSync(join(tmpdir(), 'blank-img-'));
  try {
    const short = join(dir, 'short.webp');
    writeFileSync(short, vp8Webp({ width: 200, height: 32, bytes: 104 }));
    const why = blankReason(short);
    assert.match(why, /104B/);
    assert.match(why, /×/);
    const tall = join(dir, 'tall.jpg');
    const jpeg = Buffer.alloc(1200, 0);
    jpeg[0] = 0xff; jpeg[1] = 0xd8;
    jpeg[2] = 0xff; jpeg[3] = 0xc0;
    jpeg.writeUInt16BE(11, 4);
    jpeg[6] = 8;
    jpeg.writeUInt16BE(100, 7);
    jpeg.writeUInt16BE(80, 9);
    writeFileSync(tall, jpeg);
    assert.equal(blankReason(tall), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
