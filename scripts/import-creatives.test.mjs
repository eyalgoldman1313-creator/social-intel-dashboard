import test from 'node:test';
import assert from 'node:assert/strict';
import { brandId, carryForward, lookupPrev, mergeAliases, mergeImported, prevIndex, retainUnimported, applyWeek, METHOD, LEGACY_RANK_NOTE, normStatus, NOT_SEEN_NOTE, hasDriveLinks } from './import-creatives.mjs';

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
