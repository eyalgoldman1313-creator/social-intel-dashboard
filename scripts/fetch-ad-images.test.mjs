import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  atomicWriteJson, selectTodo, mergeMissingTsv, syncTop10, assignRecovered,
  dropBlankCache, cliOptions, idsFromFile, localImageFile, isBlankFile,
} from './fetch-ad-images.mjs';

test('atomicWriteJson writes full JSON and leaves no tmp file', () => {
  const d = mkdtempSync(join(tmpdir(), 'fai-'));
  try {
    const p = join(d, 'x.json');
    atomicWriteJson(p, { a: 1 });
    assert.deepEqual(JSON.parse(readFileSync(p, 'utf8')), { a: 1 });
    assert.deepEqual(readdirSync(d), ['x.json']);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('selectTodo treats a blank local image as missing, and skips a real one', () => {
  const pub = mkdtempSync(join(tmpdir(), 'pub-'));
  try {
    mkdirSync(join(pub, 'creatives/meta'), { recursive: true });
    writeFileSync(join(pub, 'creatives/meta/b.webp'), Buffer.alloc(300));
    writeFileSync(join(pub, 'creatives/meta/ok.webp'), Buffer.alloc(5000));
    const items = [
      { id: 'a', source: 'meta', library_id: '1', image: null, days_active: 5 },
      { id: 'b', source: 'meta', library_id: '2', image: '/creatives/meta/b.webp', days_active: 9 },
      { id: 'c', source: 'google', library_id: 'cr3', image: null, days_active: 1 },
      { id: 'd', source: 'organic', image: null, library_id: '9', days_active: 99 },
      { id: 'e', source: 'meta', library_id: '4', image: 'creatives/meta/ok.webp', days_active: 50 },
      { id: 'f', source: 'google', library_id: '5', image: 'https://cdn.example/x.jpg', days_active: 40 },
      { id: 'g', source: 'meta', library_id: '6', image: 'creatives/meta/gone.webp', days_active: 3 },
    ];
    assert.equal(isBlankFile(localImageFile(pub, '/creatives/meta/b.webp')), true);
    assert.equal(isBlankFile(localImageFile(pub, 'creatives/meta/ok.webp')), false);
    assert.deepEqual(selectTodo(items, { publicDir: pub }).map((i) => i.id), ['b', 'a', 'g', 'c']);
    assert.deepEqual(selectTodo(items, { publicDir: pub, includeBlank: false }).map((i) => i.id), ['a', 'g', 'c']);
    assert.deepEqual(selectTodo(items, { publicDir: pub, only: 'google' }).map((i) => i.id), ['c']);
    assert.deepEqual(selectTodo(items, { publicDir: pub, limit: 1 }).map((i) => i.id), ['b']);
    assert.deepEqual(selectTodo(items, { publicDir: pub, ids: new Set(['c']) }).map((i) => i.id), ['c']);
    assert.deepEqual(selectTodo(items, { publicDir: pub, ids: ['g'] }).map((i) => i.id), ['g']);
  } finally {
    rmSync(pub, { recursive: true, force: true });
  }
});

test('mergeMissingTsv keeps rows not attempted, replaces attempted ones, drops recovered', () => {
  const prev = 'id\tlibrary_url\treason\nx\tu\told\ny\tu\told\n';
  const items = [{ id: 'x', image: null }, { id: 'y', image: '/ok.webp' }, { id: 'z', image: null }];
  const args = { items, attempted: new Set(['y', 'z']), fails: ['z\tu\tnew'] };
  const out = mergeMissingTsv(prev, args);
  assert.match(out, /x\tu\told/);
  assert.match(out, /z\tu\tnew/);
  assert.doesNotMatch(out, /^y\t/m);
  assert.equal(mergeMissingTsv(out, args), out);
});

test('syncTop10 copies a recovered image and clears a rejected blank only for touched ids', () => {
  const t = {
    weeks: {
      w: {
        items: [{ id: 'a', image: null, format: 'unknown' }, { id: 'b', image: 'creatives/meta/b.webp' }],
        niche: [{ id: 'a', image: 'old.webp' }],
        strips: [{ items: [{ id: 'a', image: null }] }],
      },
    },
  };
  syncTop10(t, [
    { id: 'a', image: 'creatives/meta/a.webp', format: 'video' },
    { id: 'b', image: null, imageMissing: true },
  ]);
  assert.equal(t.weeks.w.items[0].image, 'creatives/meta/a.webp');
  assert.equal(t.weeks.w.items[0].format, 'video');
  assert.equal(t.weeks.w.niche[0].image, 'creatives/meta/a.webp');
  assert.equal(t.weeks.w.strips[0].items[0].image, 'creatives/meta/a.webp');
  assert.equal(t.weeks.w.items[1].image, 'creatives/meta/b.webp');
  syncTop10(t, [{ id: 'b', image: null, imageMissing: true }], { touched: new Set(['b']) });
  assert.equal(t.weeks.w.items[1].image, null);
  assert.equal(t.weeks.w.items[1].imageMissing, true);
  assert.equal(t.weeks.w.items[0].image, 'creatives/meta/a.webp');
});

test('assignRecovered stores a real image and drops a blank that matches the card path', () => {
  const ok = { id: 'a', source: 'meta', format: 'unknown', image: null };
  assert.deepEqual(assignRecovered(ok, { rel: 'creatives/meta/a.webp', fmt: 'video', compressStatus: 0 }), { ok: true });
  assert.equal(ok.image, 'creatives/meta/a.webp');
  assert.equal(ok.image_source, 'meta-ad-library');
  assert.equal(ok.format, 'video');

  const blank = { id: 'b', source: 'google', image: 'creatives/google/b.webp', image_source: 'google-ads-transparency' };
  const rejected = assignRecovered(blank, { rel: 'creatives/google/b.webp', blank: '300B', compressStatus: 0 });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'blank');
  assert.equal(blank.image, null);
  assert.equal(blank.imageMissing, true);
  assert.equal(blank.image_source, undefined);

  const invalid = { id: 'c', source: 'meta', image: 'keep.webp' };
  assert.equal(assignRecovered(invalid, { rel: 'creatives/meta/c.webp', compressStatus: 1 }).reason, 'invalid');
  assert.equal(invalid.image, 'keep.webp');
});

test('dropBlankCache deletes a sub-1KB cache file and keeps a 5KB file', () => {
  const d = mkdtempSync(join(tmpdir(), 'cache-'));
  try {
    const tiny = join(d, 'tiny.jpg');
    const ok = join(d, 'ok.jpg');
    writeFileSync(tiny, Buffer.alloc(300));
    writeFileSync(ok, Buffer.alloc(5000));
    assert.equal(dropBlankCache(tiny), true);
    assert.equal(dropBlankCache(ok), false);
    assert.deepEqual(readdirSync(d), ['ok.jpg']);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('cli options skip flag-looking values and read an ids file', () => {
  const o = cliOptions(['--check', '--limit', '3', '--source', 'google', '--batch', '0', '--concurrency', 'nope']);
  assert.equal(o.only, 'google');
  assert.equal(o.limit, 3);
  assert.equal(o.batch, 1);
  assert.equal(o.concurrency, 4);
  assert.equal(o.includeBlank, true);
  assert.equal(cliOptions([]).includeBlank, true);
  const dir = mkdtempSync(join(tmpdir(), 'ids-'));
  try {
    const file = join(dir, 'ids.txt');
    writeFileSync(file, 'a\nb\n');
    assert.deepEqual(idsFromFile(['--ids', 'x, y']), ['x', 'y']);
    assert.deepEqual(idsFromFile(['--ids-file', file]), ['a', 'b']);
    assert.deepEqual(idsFromFile(['--ids', 'z', '--ids-file', file]), ['z']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
