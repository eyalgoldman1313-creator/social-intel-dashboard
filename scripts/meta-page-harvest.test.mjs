import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANON_CARD_CAP, ID_FALLBACK_MISS_LIMIT, DISPLAY_FORMAT, REASON,
  absorbArchiveBody, atomicWriteJson, browseUrls, bucketByBrand, groupMetaByBrand,
  harvestFromText, idFallbackDecision, idLibraryUrl, loadPageMap, mergeMissingTsv,
  pageLibraryUrl, pickMediaUrl, storageStateOption,
} from './meta-page-harvest.mjs';

const fixture = (name) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/meta-archive', name), 'utf8');

test('page ids from the 2026-11-09 weekly report resolve for dashboard brands', () => {
  const doc = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../data/meta-page-ids.json'), 'utf8'));
  const map = loadPageMap(doc);
  const expected = {
    'by-harmony': ['102186029483059'],
    goom: ['396912320162563'],
    ecosupp: ['243398382424270'],
    mycolivia: ['417738974917024'],
    mayven: ['974772839382498'],
    'fill-it': ['105361191456167'],
    fillit: ['105361191456167'],
    mycospring: ['115500990575877'],
    tevakid: ['1038897489313207', '1178357192019181'],
    smiley: ['513544668500952'],
    'try-smiley': ['513544668500952'],
    'wonders-teva': ['270180559520184'],
    wondersteva: ['270180559520184'],
    woof: ['1212873028583372'],
    mywoof: ['1212873028583372'],
    craftly: ['614814515040347'],
    'gmila-luuf': ['1275507125655970'],
    trygmila: ['1275507125655970'],
    pups: ['1147664088422193'],
  };
  assert.deepEqual(map, expected);
  assert.equal(map.softella, undefined);
  assert.equal(map.source, undefined);
});

test('fixture payloads match every wanted id in one pass and prefer the video preview', () => {
  const want = new Set(['111', '222', '333', '444', '555', '777', '999001']);
  const found = new Map();
  absorbArchiveBody(fixture('image-and-video.json'), want, found);
  absorbArchiveBody(fixture('second-page.json'), want, found);
  absorbArchiveBody(fixture('deeplink-only.txt'), want, found);

  assert.equal(found.get('111').url, 'https://scontent.example/111-original.jpg');
  assert.equal(found.get('111').fmt, 'image');
  assert.equal(found.get('222').url, 'https://scontent.example/222-preview.jpg');
  assert.equal(found.get('222').fmt, 'video');
  assert.equal(found.get('222').displayFormat, 'VIDEO');
  // 333's segment stops at the next archive id, so it does not take 444's resized URL.
  assert.equal(found.get('333').url, 'https://scontent.example/333-original-only.jpg');
  assert.equal(found.get('444').url, 'https://scontent.example/444-resized.jpg');
  assert.equal(found.get('444').fmt, DISPLAY_FORMAT.CAROUSEL);
  assert.equal(found.has('555'), false);
  assert.equal(found.has('999'), false);
  assert.equal(found.get('777').url, 'https://scontent.example/777.jpg');
  assert.equal(found.get('777').fmt, 'image');
  // The broken deeplink exposes the id as deeplinkAdID, not ad_archive_id.
  assert.equal(found.has('999001'), false);
  assert.equal(found.size, 5);
});

test('escaped network text unescapes archive ids and query separators', () => {
  const found = harvestFromText(fixture('escaped-feed.txt'), new Set(['555', '666']));
  assert.equal(found.get('555').url, 'https://scontent.xx/a.jpg?w=100&h=200');
  assert.equal(found.get('666').url, 'https://scontent.xx/preview.jpg');
  assert.equal(found.get('666').fmt, 'video');
});

test('a deeplink shell with no media urls is not a snapshot', () => {
  const found = absorbArchiveBody('{"deeplinkAdID":111,"route":"ads"}', new Set(['111']));
  assert.equal(found.size, 0);
  assert.equal(REASON.noMedia, 'snapshot has no media url');
});

test('video preview wins only for video ads', () => {
  const fields = {
    original_image_url: 'https://cdn.example/original.jpg',
    video_preview_image_url: 'https://cdn.example/preview.jpg',
    resized_image_url: 'https://cdn.example/resized.jpg',
  };
  assert.equal(pickMediaUrl(fields, 'VIDEO'), fields.video_preview_image_url);
  assert.equal(pickMediaUrl(fields, 'IMAGE'), fields.original_image_url);
  assert.equal(pickMediaUrl({ resized_image_url: fields.resized_image_url }, 'IMAGE'), fields.resized_image_url);
  assert.equal(pickMediaUrl({}, 'VIDEO'), null);
});

test('brand groups use the page map and leave unknown brands unmapped', () => {
  const map = loadPageMap({ pages: { pups: '1147664088422193', goom: ['396912320162563'], softella: 'nope' } });
  const items = [
    { source: 'meta', brand: 'pups', library_id: '1' },
    { source: 'meta', brand: 'pups', library_id: '2' },
    { source: 'meta', brand: 'Goom', library_id: '3' },
    { source: 'meta', brand: 'softella', library_id: '4' },
    { source: 'google', brand: 'pups', library_id: '5' },
  ];
  const { groups, unmapped } = groupMetaByBrand(items, map);
  assert.deepEqual(groups.map((g) => g.brand), ['Goom', 'pups']);
  assert.deepEqual(groups[0].pageIds, ['396912320162563']);
  assert.equal(groups[0].items.length, 1);
  assert.equal(groups[1].items.length, 2);
  assert.deepEqual(unmapped.map((i) => i.library_id), ['4']);
  assert.equal(bucketByBrand(unmapped)[0].pageIds.length, 0);
});

test('browse urls open the page feed, most recent, active and all', () => {
  const urls = browseUrls('1147664088422193');
  assert.equal(urls.length, 4);
  assert.match(urls[0], /view_all_page_id=1147664088422193/);
  assert.match(urls[0], /active_status=all/);
  assert.match(urls[0], /country=IL/);
  assert.match(urls[0], /sort_data\[mode\]=relevancy_monthly_grouped/);
  assert.match(urls[1], /active_status=active/);
  assert.match(urls[1], /relevancy_monthly_grouped/);
  assert.equal(/sort_data/.test(urls[2]), false);
  assert.match(urls[2], /active_status=all/);
  assert.equal(pageLibraryUrl('1', { status: 'active', recent: true }).includes('search_type=page'), true);
  assert.equal(idLibraryUrl('978041034902288'), 'https://www.facebook.com/ads/library/?id=978041034902288');
  assert.equal(ANON_CARD_CAP, 30);
});

test('id deeplink fallback stops after repeated misses', () => {
  assert.equal(idFallbackDecision(0), 'try');
  assert.equal(idFallbackDecision(ID_FALLBACK_MISS_LIMIT - 1), 'try');
  assert.equal(idFallbackDecision(ID_FALLBACK_MISS_LIMIT), 'skip');
});

test('storage state comes from the flag or env and is only a path', () => {
  assert.equal(storageStateOption(['--storage-state', '/tmp/session.json'], { META_STORAGE_STATE: '/tmp/env.json' }), '/tmp/session.json');
  assert.equal(storageStateOption(['--source', 'meta'], { META_STORAGE_STATE: '  /tmp/env.json  ' }), '/tmp/env.json');
  assert.equal(storageStateOption(['--storage-state'], { META_STORAGE_STATE: '' }), null);
  assert.equal(storageStateOption(['--limit', '5'], {}), null);
});

test('progress tsv keeps untouched misses and drops rows that were recovered', () => {
  const prev = 'id\tlibrary_url\treason\nold\thttp://old\tprevious\nkept\thttp://kept\tstill missing\ndone\thttp://done\told fail\n';
  const text = mergeMissingTsv(prev, {
    stillIds: new Set(['old', 'kept']),
    attempted: new Set(['old', 'done']),
    fails: ['old\thttp://old\tnot in page browse (anonymous ~30-card cap / inactive / not loaded)'],
  });
  assert.match(text, /^id\tlibrary_url\treason\n/);
  assert.match(text, /kept\thttp:\/\/kept\tstill missing/);
  assert.equal(text.includes('previous'), false);
  assert.equal(text.includes('http://done'), false);
  assert.match(text, /old\thttp:\/\/old\tnot in page browse/);
});

test('atomic json replace leaves a complete file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meta-harvest-'));
  const path = join(dir, 'creatives.json');
  try {
    atomicWriteJson(path, { items: [{ id: 'meta-1', imageMissingReason: 'grid-only' }] });
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(parsed.items[0].id, 'meta-1');
    assert.equal(readFileSync(path, 'utf8').endsWith('\n'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
