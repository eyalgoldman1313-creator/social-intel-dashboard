import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brandId, carryForward, lookupPrev, mergeAliases, mergeImported, prevIndex, retainUnimported, applyWeek, METHOD, LEGACY_RANK_NOTE, normStatus, NOT_SEEN_NOTE, hasDriveLinks, preservedCardWarning } from './import-creatives.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GOOM_TIKTOKS = ['tiktok-goom-d178017e', 'tiktok-goom-f965b98f', 'tiktok-goom-730268ad'];
const link = (id) => `https://drive.google.com/file/d/${id}/view`;

test('carryForward keeps image_source and a known format', () => {
  const prev = prevIndex([
    { id: 'meta-1', source: 'meta', library_id: '1', image_source: 'meta-ad-library', format: 'video', image: 'creatives/meta/1.webp' },
  ]);
  const fresh = { id: 'meta-1', source: 'meta', library_id: '1', format: 'unknown', image: 'creatives/meta/1.webp', imageMissing: false };
  carryForward(fresh, lookupPrev(prev, fresh));
  assert.equal(fresh.image_source, 'meta-ad-library');
  assert.equal(fresh.format, 'video');

  const explicit = { id: 'meta-1', source: 'meta', library_id: '1', format: 'image', image: 'creatives/meta/1.webp', image_source: 'bot' };
  carryForward(explicit, lookupPrev(prev, explicit));
  assert.equal(explicit.format, 'image');
  assert.equal(explicit.image_source, 'bot');

  const noImage = { id: 'meta-1', source: 'meta', library_id: '1', format: 'unknown', image: null };
  carryForward(noImage, lookupPrev(prev, noImage));
  assert.equal(noImage.image_source, undefined);
  assert.equal(noImage.format, 'video');
});

test('alias merge keeps image_source from the folded row and from prevById', () => {
  const prevItems = [
    { id: 'meta-111', source: 'meta', library_id: '111', format: 'video', image: 'creatives/meta/111.webp', image_source: 'meta-ad-library' },
    { id: 'meta-222', source: 'meta', library_id: '222', format: 'unknown', image: null },
  ];
  const incoming = [
    { id: 'meta-222', source: 'meta', library_id: '222', format: 'unknown', image: null, alias_ids: ['111'], imageMissing: true },
    { id: 'meta-111', source: 'meta', library_id: '111', format: 'unknown', image: 'creatives/meta/111.webp', imageMissing: false },
  ];
  mergeImported(incoming, prevItems, new Set(['meta']));
  assert.equal(incoming.length, 1);
  assert.equal(incoming[0].id, 'meta-222');
  assert.equal(incoming[0].image, 'creatives/meta/111.webp');
  assert.equal(incoming[0].image_source, 'meta-ad-library');
  assert.equal(incoming[0].format, 'video');
  assert.deepEqual(incoming[0].alias_ids, ['111']);

  const onlyMain = [{ id: 'meta-222', source: 'meta', library_id: '222', format: 'unknown', image: 'creatives/meta/222.webp', alias_ids: ['111'], imageMissing: false }];
  mergeImported(onlyMain, prevItems, new Set(['meta']));
  assert.equal(onlyMain[0].image_source, 'meta-ad-library');
  assert.equal(onlyMain[0].format, 'video');
});

test('mergeAliases copies provenance onto the surviving card', () => {
  const items = [
    { id: 'meta-main', source: 'meta', library_id: '2', format: 'unknown', image: null, alias_ids: ['1'], imageMissing: true },
    { id: 'meta-alias', source: 'meta', library_id: '1', format: 'carousel', image: 'creatives/meta/1.webp', image_source: 'meta-ad-library', imageMissing: false },
  ];
  const log = mergeAliases(items);
  assert.deepEqual(log, [['1', '2']]);
  assert.equal(items.length, 1);
  assert.equal(items[0].image_source, 'meta-ad-library');
  assert.equal(items[0].format, 'carousel');
  assert.equal(items[0].imageMissing, false);
});

test('an organic-only import keeps Meta image_source and does not reorder sponsored Top 10', () => {
  const prevItems = [
    { id: 'meta-9', source: 'meta', brand: 'goom', status: 'active', days_active: 10, image: 'creatives/meta/9.webp', image_source: 'meta-ad-library', format: 'image' },
    { id: 'google-1', source: 'google', image: 'creatives/google/1.webp', image_source: 'google-ads-transparency', format: 'image' },
    { id: 'organic-old', source: 'organic', image: 'creatives/organic/old.webp', views: 5 },
  ];
  const organic = [{ id: 'organic-new', source: 'organic', image: 'creatives/organic/new.webp', views: 50, likes: 3, format: 'image', imageMissing: false }];
  const items = mergeImported(organic.map((i) => ({ ...i })), prevItems, new Set(['organic']));
  const meta = items.find((i) => i.id === 'meta-9');
  const google = items.find((i) => i.id === 'google-1');
  assert.equal(meta.image_source, 'meta-ad-library');
  assert.equal(google.image_source, 'google-ads-transparency');
  assert.ok(items.some((i) => i.id === 'organic-new'));
  assert.equal(items.some((i) => i.id === 'organic-old'), false);

  const sponsored = [
    { rank: 1, id: 'meta-low', brand: 'a', days_active: 5 },
    { rank: 2, id: 'meta-high', brand: 'b', days_active: 500 },
  ];
  const doc = { weeks: { '2026-W43': { key: '2026-W43', week: 43, start: '2026-10-19', end: '2026-10-25', asof: '2026-10-19', method: 'old', basis: 'old', items: sponsored, niche: [{ id: 'meta-low' }], strips: [] } } };
  const before = JSON.stringify(doc.weeks['2026-W43'].items);
  const nicheBefore = JSON.stringify(doc.weeks['2026-W43'].niche);
  applyWeek(doc, { key: '2026-W43', week: 43, start: '2026-10-19', end: '2026-10-25', asof: '2026-10-19' }, {
    items, brands: [{ id: 'goom', group: 'niche' }], imported: new Set(['organic']),
    strips: [{ key: 'other', title: 'אורגני', basis: 'צפיות', items: [{ rank: 1, id: 'organic-new', basis: 'views' }] }],
    now: '2026-10-19T00:00:00.000Z', prevCreatives: prevItems,
  });
  assert.equal(JSON.stringify(doc.weeks['2026-W43'].items), before);
  assert.equal(JSON.stringify(doc.weeks['2026-W43'].niche), nicheBefore);
  assert.equal(doc.weeks['2026-W43'].method, 'old');
  assert.equal(doc.weeks['2026-W43'].strips[0].items[0].id, 'organic-new');
});

test('a Meta import ranks without image preference and records why a row entered', () => {
  const prevCreatives = [
    { id: 'meta-data', source: 'meta', library_id: 'data', days_active: null, status: 'unknown', format: 'video' },
    { id: 'meta-long', source: 'meta', library_id: 'long', days_active: 100, status: 'active' },
  ];
  const items = [
    { id: 'meta-data', source: 'meta', brand: 'goom', status: 'active', days_active: 400, variants_count: 1, format: 'unknown', image: 'creatives/meta/data.webp', start_date: '2025-01-01' },
    { id: 'meta-short', source: 'meta', brand: 'mayven', status: 'active', days_active: 30, variants_count: 8, image: 'creatives/meta/short.webp', start_date: '2026-10-20' },
    { id: 'meta-long', source: 'meta', brand: 'smiley', status: 'active', days_active: 120, variants_count: 0, image: null, start_date: '2025-06-01' },
  ];
  mergeImported(items, prevCreatives, new Set(['meta']));
  assert.equal(items.find((i) => i.id === 'meta-data').format, 'video');
  assert.equal(items.find((i) => i.id === 'meta-data').image_source, undefined);

  const doc = { weeks: { '2026-W42': { key: '2026-W42', items: [{ id: 'meta-long' }] } } };
  applyWeek(doc, { key: '2026-W43', week: 43, start: '2026-10-19', end: '2026-10-25', asof: '2026-10-19' }, {
    items, brands: [], imported: new Set(['meta']), strips: [], now: '2026-10-19T03:00:00.000Z', prevCreatives,
  });
  const week = doc.weeks['2026-W43'];
  assert.equal(week.method, METHOD);
  assert.match(week.method, /התמונה משמשת לתצוגה בלבד ואינה משפיעה על הדירוג/);
  assert.deepEqual(week.items.map((i) => i.id), ['meta-data', 'meta-long', 'meta-short']);
  assert.equal(week.entered['meta-data'].reason, 'data');
  assert.equal(week.entered['meta-data'].label, 'נכנסה בעקבות השלמת נתונים');
  assert.equal(week.entered['meta-short'].reason, 'started');
  assert.equal(week.entered['meta-long'], undefined);
});

test('week 2026-W42 keeps its sponsored order and gains the legacy note', () => {
  const itemsOrder = [{ id: 'meta-img', days_active: 10, image: 'a.webp' }, { id: 'meta-plain', days_active: 900 }];
  const doc = { weeks: { '2026-W42': { key: '2026-W42', week: 42, start: '2026-10-12', end: '2026-10-18', items: itemsOrder, niche: [{ id: 'meta-img' }], method: 'old image rule', strips: [] } } };
  const frozen = JSON.stringify(itemsOrder);
  applyWeek(doc, { key: '2026-W42', week: 42, start: '2026-10-12', end: '2026-10-18', asof: '2026-10-12' }, {
    items: [{ id: 'meta-plain', source: 'meta', brand: 'a', status: 'active', days_active: 900 }],
    brands: [], imported: new Set(['meta']), strips: [], now: '2026-10-19T00:00:00.000Z', prevCreatives: [],
  });
  assert.equal(JSON.stringify(doc.weeks['2026-W42'].items), frozen);
  assert.equal(doc.weeks['2026-W42'].method, 'old image rule');
  assert.equal(doc.weeks['2026-W42'].note, LEGACY_RANK_NOTE);
});

test('retainUnimported does not duplicate rows from a source that was read', () => {
  const prev = [{ id: 'meta-1', source: 'meta' }, { id: 'organic-1', source: 'organic' }];
  const items = [{ id: 'meta-1', source: 'meta', image_source: 'meta-ad-library' }];
  retainUnimported(items, prev, new Set(['meta']));
  assert.deepEqual(items.map((i) => i.id), ['meta-1', 'organic-1']);
  assert.equal(items[1].status, undefined);
});

test('a card with Drive links is kept when its scan omits it; a card without links is dropped', () => {
  const spec = 'https://drive.google.com/file/d/1daBm53fcn4dxAV5LdZAIYVhxcVrvgV9o/view';
  const script = 'https://drive.google.com/file/d/1UAQqwqqUAHWSPOnO2WUgxmXUZjK5ND_0/view';
  const driveLinks = {
    'tiktok-goom-d178017e': { spec, script },
    'meta-linked': { spec },
    'tiktok-empty': {},
  };
  const prev = [
    { id: 'tiktok-goom-d178017e', source: 'tiktok', status: 'active', post_url: 'https://www.tiktok.com/@goom.co.il/video/7521365051526155527', views: 3100000, data_notes: 'קיים' },
    { id: 'tiktok-plain', source: 'tiktok', status: 'active' },
    { id: 'tiktok-empty', source: 'tiktok', status: 'active' },
    { id: 'meta-linked', source: 'meta', status: 'active', days_active: 200, brand: 'goom' },
    { id: 'meta-plain', source: 'meta', status: 'active', days_active: 10, brand: 'a' },
    { id: 'organic-inline', source: 'organic', status: 'active', spec_url: spec },
  ];
  const items = [{ id: 'tiktok-other', source: 'tiktok', status: 'active' }];
  const warned = [];
  retainUnimported(items, prev, new Set(['tiktok', 'meta', 'organic']), {
    driveLinks,
    warn: (kept) => warned.push(...kept.map((i) => i.id)),
  });
  assert.deepEqual(driveLinks['tiktok-goom-d178017e'], { spec, script });
  const tik = items.find((i) => i.id === 'tiktok-goom-d178017e');
  assert.equal(tik.status, 'unknown');
  assert.equal(tik.views, 3100000);
  assert.equal(tik.post_url, prev[0].post_url);
  assert.match(tik.data_notes, new RegExp(NOT_SEEN_NOTE));
  assert.match(tik.data_notes, /קיים/);
  assert.equal(items.filter((i) => i.id === 'tiktok-goom-d178017e').length, 1);
  assert.equal(items.some((i) => i.id === 'tiktok-plain' || i.id === 'tiktok-empty'), false);
  const meta = items.find((i) => i.id === 'meta-linked');
  assert.equal(meta.status, 'inactive');
  assert.match(meta.data_notes, new RegExp(NOT_SEEN_NOTE));
  assert.equal(items.some((i) => i.id === 'meta-plain'), false);
  const org = items.find((i) => i.id === 'organic-inline');
  assert.equal(org.status, 'unknown');
  assert.equal(hasDriveLinks(org, {}), true);
  assert.deepEqual(warned.sort(), ['meta-linked', 'organic-inline', 'tiktok-goom-d178017e']);

  const second = items.filter((i) => i.id !== 'tiktok-goom-d178017e');
  retainUnimported(second, items, new Set(['tiktok']), { driveLinks, warn: () => {} });
  const again = second.find((i) => i.id === 'tiktok-goom-d178017e');
  assert.equal(again.data_notes.split(NOT_SEEN_NOTE).length - 1, 1);
});

test('the default warning names each preserved Drive-linked card', () => {
  const lines = [];
  const orig = console.warn;
  console.warn = (s) => lines.push(String(s));
  try {
    retainUnimported(
      [],
      [{ id: 'tiktok-goom-d178017e', source: 'tiktok', status: 'active', spec_url: 'https://drive.google.com/file/d/abc123/view' }],
      new Set(['tiktok']),
    );
  } finally {
    console.warn = orig;
  }
  const text = lines.join('\n');
  assert.match(text, /Drive links/);
  assert.match(text, /tiktok-goom-d178017e/);
  assert.match(text, /status unknown/);
});

test('several Drive-linked cards from one brand are all kept, with one warning listing every id', () => {
  const driveLinks = {
    'tiktok-goom-d178017e': { spec: link('spec-d178'), script: link('script-d178') },
    'tiktok-goom-f965b98f': { spec: link('spec-f965') },
    'tiktok-goom-730268ad': { script: link('script-7302') },
    'tiktok-goom-inline': {},
  };
  const prev = [
    { id: 'tiktok-goom-d178017e', source: 'tiktok', brand: 'goom', status: 'active', views: 3100000, post_url: 'https://www.tiktok.com/@goom.co.il/video/7521365051526155527' },
    { id: 'tiktok-goom-d178017e', source: 'tiktok', brand: 'goom', status: 'active', views: 1 },
    { id: 'tiktok-goom-plain', source: 'tiktok', brand: 'goom', status: 'active', views: 10 },
    { id: 'tiktok-goom-f965b98f', source: 'tiktok', brand: 'goom', status: 'active', views: 900000, spec_url: '' },
    { id: 'tiktok-goom-730268ad', source: 'tiktok', brand: 'goom', status: 'active', views: 420000 },
    { id: 'tiktok-goom-inline', source: 'tiktok', brand: 'goom', status: 'active', script_url: link('script-inline') },
  ];
  const items = [{ id: 'tiktok-goom-still', source: 'tiktok', brand: 'goom', status: 'active' }];
  const calls = [];
  retainUnimported(items, prev, new Set(['tiktok']), {
    driveLinks,
    warn: (kept) => calls.push(preservedCardWarning(kept).join('\n')),
  });
  assert.equal(calls.length, 1);
  for (const id of [...GOOM_TIKTOKS, 'tiktok-goom-inline']) {
    assert.equal(items.filter((i) => i.id === id).length, 1, id);
    assert.match(calls[0], new RegExp(id));
    assert.equal(items.find((i) => i.id === id).status, 'unknown');
  }
  assert.equal(items.filter((i) => i.id === 'tiktok-goom-d178017e')[0].views, 3100000);
  assert.equal(items.some((i) => i.id === 'tiktok-goom-plain'), false);
  assert.equal(driveLinks['tiktok-goom-d178017e'].spec, link('spec-d178'));
  assert.equal(driveLinks['tiktok-goom-d178017e'].script, link('script-d178'));
  assert.equal(hasDriveLinks(prev[3], driveLinks), true);
  assert.equal(hasDriveLinks({ id: 'tiktok-goom-730268ad' }, driveLinks), true);
  assert.equal(hasDriveLinks(prev[5], driveLinks), true);
});

test('only omitted cards that have a Drive link survive a mixed scan', () => {
  const driveLinks = {
    'tiktok-goom-d178017e': { spec: link('spec-d178'), script: link('script-d178') },
    'meta-goom-linked': { script: link('script-meta') },
  };
  const prev = [
    { id: 'tiktok-goom-d178017e', source: 'tiktok', brand: 'goom', status: 'active' },
    { id: 'tiktok-goom-unlinked', source: 'tiktok', brand: 'goom', status: 'active' },
    { id: 'tiktok-other-unlinked', source: 'tiktok', brand: 'mayven', status: 'active' },
    { id: 'meta-goom-linked', source: 'meta', brand: 'goom', status: 'active', days_active: 80 },
    { id: 'meta-goom-unlinked', source: 'meta', brand: 'goom', status: 'active', days_active: 90 },
    { id: 'organic-kept', source: 'organic', brand: 'goom', status: 'active' },
  ];
  const items = [];
  retainUnimported(items, prev, new Set(['tiktok', 'meta']), { driveLinks, warn: () => {} });
  assert.deepEqual(items.map((i) => i.id).sort(), ['meta-goom-linked', 'organic-kept', 'tiktok-goom-d178017e']);
  assert.equal(items.find((i) => i.id === 'meta-goom-linked').status, 'inactive');
  assert.equal(items.find((i) => i.id === 'tiktok-goom-d178017e').status, 'unknown');
  assert.equal(items.find((i) => i.id === 'organic-kept').status, 'active');
  assert.equal(driveLinks['meta-goom-linked'].script, link('script-meta'));
});

test('regression fixture: the three GOOM TikToks dropped on 09.11 are all preserved', () => {
  const driveLinks = {
    'tiktok-goom-d178017e': {
      spec: 'https://drive.google.com/file/d/1daBm53fcn4dxAV5LdZAIYVhxcVrvgV9o/view',
      script: 'https://drive.google.com/file/d/1UAQqwqqUAHWSPOnO2WUgxmXUZjK5ND_0/view',
    },
    'tiktok-goom-f965b98f': {
      spec: 'https://drive.google.com/file/d/1rmYOSH2YkMlmYUJ7nH4Ql233WCfUysXb/view',
      script: 'https://drive.google.com/file/d/19UUbCTGUMzz_ChnJ-ldN__0AHaaAJYEc/view',
    },
    'tiktok-goom-730268ad': {
      spec: 'https://drive.google.com/file/d/1nQyG_otTWAece_tK8J3iG5Z9s1BGFzWF/view',
      script: 'https://drive.google.com/file/d/1NBSwlyvYWbdHUicGsLmOzIRq1eHvaFrA/view',
    },
  };
  const before = JSON.stringify(driveLinks);
  const prev = GOOM_TIKTOKS.map((id, n) => ({
    id, source: 'tiktok', brand: 'goom', status: 'active', views: 1000 + n,
    post_url: `https://www.tiktok.com/@goom.co.il/video/${n}`,
  }));
  prev.push(
    { id: 'tiktok-goom-unlinked', source: 'tiktok', brand: 'goom', status: 'active' },
    { id: 'tiktok-goom-new', source: 'tiktok', brand: 'goom', status: 'active', alias_ids: ['d178017e'], library_id: '999' },
  );
  const items = [prev[4]];
  const calls = [];
  mergeImported(items, prev, new Set(['tiktok']), {
    driveLinks,
    warn: (kept) => calls.push(kept.map((i) => i.id)),
  });
  assert.deepEqual(calls, [GOOM_TIKTOKS]);
  for (const id of GOOM_TIKTOKS) {
    const hit = items.filter((i) => i.id === id);
    assert.equal(hit.length, 1);
    assert.equal(hit[0].status, 'unknown');
    assert.match(hit[0].data_notes, new RegExp(NOT_SEEN_NOTE));
  }
  assert.equal(items.some((i) => i.id === 'tiktok-goom-unlinked'), false);
  assert.equal(items.filter((i) => i.id === 'tiktok-goom-new').length, 1);
  assert.equal(JSON.stringify(driveLinks), before);
});

test('dry run against current creatives: omitting the three GOOM TikToks keeps all of them', () => {
  const creatives = JSON.parse(readFileSync(join(root, 'data/creatives.json'), 'utf8'));
  const driveLinks = JSON.parse(readFileSync(join(root, 'data/drive-links.json'), 'utf8'));
  const linksBefore = JSON.stringify(driveLinks);
  const prev = creatives.items;
  const stored = {};
  for (const id of GOOM_TIKTOKS) {
    const hits = prev.filter((i) => i.id === id);
    assert.equal(hits.length, 1, id);
    assert.equal(hits[0].source, 'tiktok');
    assert.equal(hits[0].brand, 'goom');
    assert.ok(driveLinks[id].spec && driveLinks[id].script, id);
    stored[id] = { status: hits[0].status, data_notes: hits[0].data_notes };
  }
  const incoming = prev.filter((i) => i.source === 'tiktok' && !GOOM_TIKTOKS.includes(i.id)).map((i) => structuredClone(i));
  const calls = [];
  mergeImported(incoming, prev, new Set(['tiktok']), {
    driveLinks,
    warn: (kept) => calls.push(kept.map((i) => i.id)),
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice().sort(), GOOM_TIKTOKS.slice().sort());
  for (const id of GOOM_TIKTOKS) {
    const hits = incoming.filter((i) => i.id === id);
    assert.equal(hits.length, 1, id);
    assert.equal(hits[0].status, 'unknown');
    const original = prev.find((i) => i.id === id);
    assert.equal(original.status, stored[id].status);
    assert.equal(original.data_notes, stored[id].data_notes);
  }
  assert.equal(JSON.stringify(driveLinks), linksBefore);
});

test('an alias merge is not undone when the folded card has Drive links', () => {
  const prev = [
    { id: 'meta-alias', source: 'meta', library_id: '1', status: 'active', spec_url: 'https://drive.google.com/file/d/abc123/view' },
    { id: 'meta-main', source: 'meta', library_id: '2', status: 'active' },
  ];
  const items = [
    { id: 'meta-main', source: 'meta', library_id: '2', alias_ids: ['1'], format: 'unknown', image: null },
    { id: 'meta-alias', source: 'meta', library_id: '1', format: 'image', image: 'a.webp' },
  ];
  mergeImported(items, prev, new Set(['meta']), { warn: () => {} });
  assert.deepEqual(items.map((i) => i.id), ['meta-main']);
  assert.equal(items[0].status, undefined);
});

test('trypups alias imports Google items under brand pups', () => {
  const pups = { id: 'pups', name: 'Pups', heName: 'try-pups', domain: 'trypups.com', group: 'reference' };
  assert.equal(brandId('trypups', [pups]), 'pups');
  assert.equal(brandId('TryPups', [pups]), 'pups');
  assert.equal(brandId('Pups', [pups]), 'pups');
  assert.equal(brandId('trypups.com', [pups]), 'pups');
  assert.equal(brandId('trypups', []), 'pups');
  assert.equal(brandId('try-pups', []), 'pups');
});

test('brand matching ignores punctuation and compares a domain stem in both directions', () => {
  const pups = { id: 'pups', name: 'Pups', heName: 'try-pups', domain: 'trypups.com', group: 'reference' };
  assert.equal(brandId({ brand: 'try-pups', brand_slug: 'trypups' }, [pups]), 'pups');
  assert.equal(brandId({ brand_slug: 'not-a-brand', brand: 'Pups' }, [pups]), 'pups');
  const acme = { id: 'acme', name: 'Acme', heName: 'אקמי', domain: 'tryacme.com' };
  assert.equal(brandId('try-acme', [acme]), 'acme');
  assert.equal(brandId('tryacme.com', [acme]), 'acme');
  assert.equal(brandId({ brand: 'Try Acme', brand_slug: 'try-acme' }, [acme]), 'acme');
  assert.equal(brandId('notacme', [acme]), 'notacme');
  const fill = { id: 'fillit', name: 'Fill It', heName: 'פיל-איט', domain: 'fillitvitamins.com' };
  assert.equal(brandId('פיל איט', [fill]), 'fillit');
  assert.equal(brandId('fill it', []), 'fillit');
});

test('normStatus maps הופסקה and נעלמה to inactive', () => {
  assert.equal(normStatus('הופסקה'), 'inactive');
  assert.equal(normStatus('נעלמה'), 'inactive');
  assert.equal(normStatus('הופסק'), 'inactive');
  assert.equal(normStatus('מושהית'), 'inactive');
  assert.equal(normStatus('מושהה'), 'inactive');
  assert.equal(normStatus('פעיל'), 'active');
  assert.equal(normStatus('paused'), 'inactive');
  assert.equal(normStatus('something else'), 'unknown');
});

test('applyWeek tags a returning active ad as resumed, not data', () => {
  const prevCreatives = [
    { id: 'meta-back', source: 'meta', library_id: 'back', days_active: null, status: 'inactive' },
  ];
  const items = [
    { id: 'meta-back', source: 'meta', brand: 'mycolivia', status: 'active', days_active: 235, variants_count: 1, start_date: '2026-03-12' },
  ];
  const doc = { weeks: {} };
  applyWeek(doc, { key: '2026-W44', week: 44, start: '2026-10-26', end: '2026-11-01', asof: '2026-10-26' }, {
    items, brands: [], imported: new Set(['meta']), strips: [], now: '2026-10-26T00:00:00.000Z', prevCreatives,
  });
  assert.equal(doc.weeks['2026-W44'].entered['meta-back'].reason, 'resumed');
  assert.equal(doc.weeks['2026-W44'].entered['meta-back'].label, 'חזרה לפעילות');
});

test('an inactive flag from an older week does not keep tagging resumed', () => {
  const doc = {
    weeks: {
      '2026-W40': { key: '2026-W40', items: [{ id: 'meta-x', status: 'inactive', days_active: 10 }] },
      '2026-W43': { key: '2026-W43', items: [{ id: 'meta-x', status: 'active', days_active: 20 }] },
    },
  };
  applyWeek(doc, { key: '2026-W44', week: 44, start: '2026-10-26', end: '2026-11-01', asof: '2026-10-26' }, {
    items: [{ id: 'meta-x', source: 'meta', brand: 'a', status: 'active', days_active: 30, start_date: '2025-01-01' }],
    brands: [], imported: new Set(['meta']), strips: [], now: '2026-10-26T00:00:00.000Z',
    prevCreatives: [{ id: 'meta-x', source: 'meta', status: 'active', days_active: 30 }],
  });
  assert.equal(doc.weeks['2026-W44'].entered, undefined);
});
