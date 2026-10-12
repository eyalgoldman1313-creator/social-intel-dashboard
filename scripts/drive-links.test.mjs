import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { driveUrls, loadDriveLinks, makeRenderer } from './creatives.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const real = JSON.parse(readFileSync(join(root, 'data/drive-links.json'), 'utf8'));
const { card } = makeRenderer({ esc, brandName: (id) => id, section: () => '', driveLinks: real });

test('the committed map keeps the real card ids and Drive URLs', () => {
  const row = real['meta-1287638459563997'];
  assert.equal(typeof row.spec, 'string');
  assert.equal(typeof row.script, 'string');
  assert.match(row.spec, /^https:\/\/drive\.google\.com\//);
  assert.match(row.script, /^https:\/\/drive\.google\.com\//);
  const specs = Object.values(real).filter((v) => v && v.spec).length;
  const scripts = Object.values(real).filter((v) => v && v.script).length;
  assert.ok(specs >= 94, `expected the real spec links, got ${specs}`);
  assert.ok(scripts >= 39, `expected the real script links, got ${scripts}`);
});

test('a real card renders both pills under the Meta link and in the lightbox', () => {
  const html = card({
    id: 'meta-1287638459563997',
    source: 'meta',
    brand: 'goom',
    format: 'video',
    library_url: 'https://www.facebook.com/ads/library/?id=1287638459563997',
  });
  const body = html.slice(0, html.indexOf('class="lb-detail"'));
  const detail = html.slice(html.indexOf('class="lb-detail"'));
  assert.ok(body.indexOf('המודעה בספריית Meta') < body.indexOf('מסמך אפיון'));
  assert.ok(body.indexOf('מסמך אפיון') < body.indexOf('תסריט'));
  assert.match(body, /href="https:\/\/drive\.google\.com\/file\/d\/1w5u7oze2f4XUeeMCgxoCk6Sdtpi_rRsK\/view"/);
  assert.match(body, /target="_blank"/);
  assert.match(body, /rel="noopener noreferrer"/);
  assert.match(body, /class="drv-pill drv-spec"/);
  assert.match(body, /class="drv-pill drv-script"/);
  assert.match(body, /dir="rtl"/);
  assert.ok(detail.indexOf('צפייה במודעה בספריית Meta') < detail.indexOf('מסמך אפיון'));
});

test('a missing field is omitted; a missing id renders nothing', () => {
  const specOnly = card({ id: 'meta-1849819722546965', source: 'meta', brand: 'wondersteva', format: 'image', library_url: 'https://www.facebook.com/ads/library/?id=1849819722546965' });
  assert.match(specOnly, /מסמך אפיון/);
  assert.doesNotMatch(specOnly, /drv-script/);
  const none = card({ id: 'meta-not-in-the-file', source: 'meta', brand: 'goom', format: 'image', library_url: 'https://www.facebook.com/ads/library/?id=1' });
  assert.doesNotMatch(none, /cr-drive/);
  assert.match(none, /המודעה בספריית Meta/);
});

test('file URL wins over inline; inline fills a gap; bad URLs are dropped', () => {
  assert.equal(driveUrls({ id: 'meta-1287638459563997', spec_url: 'https://drive.google.com/inline' }, real).spec, real['meta-1287638459563997'].spec);
  assert.deepEqual(driveUrls({ id: 'new-card', spec_url: 'https://drive.google.com/ok', script_url: 'javascript:alert(1)' }, {}), {
    spec: 'https://drive.google.com/ok', script: '',
  });
  assert.deepEqual(driveUrls({ id: 'nope' }, {}), { spec: '', script: '' });
});

test('loadDriveLinks tolerates a missing or empty file and reads a map', () => {
  const dir = mkdtempSync(join(tmpdir(), 'drive-root-'));
  try {
    assert.deepEqual(loadDriveLinks(dir), {});
    mkdirSync(join(dir, 'data'));
    writeFileSync(join(dir, 'data/drive-links.json'), ' \n');
    assert.deepEqual(loadDriveLinks(dir), {});
    writeFileSync(join(dir, 'data/drive-links.json'), '{}\n');
    assert.deepEqual(loadDriveLinks(dir), {});
    writeFileSync(join(dir, 'data/drive-links.json'), '[]');
    assert.deepEqual(loadDriveLinks(dir), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(loadDriveLinks(root)['meta-1287638459563997'].spec, real['meta-1287638459563997'].spec);
});
