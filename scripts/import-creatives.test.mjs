import test from 'node:test';
import assert from 'node:assert/strict';
import { carryForward, lookupPrev, mergeAliases, mergeImported, prevIndex, retainUnimported, applyWeek, METHOD, LEGACY_RANK_NOTE } from './import-creatives.mjs';

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
});
