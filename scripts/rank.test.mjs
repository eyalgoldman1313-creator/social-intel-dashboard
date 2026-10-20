import test from 'node:test';
import assert from 'node:assert/strict';
import { rankTop10, entryReason, ENTRY_DATA_LABEL, makeRenderer } from './creatives.mjs';

const ad = (over) => ({ source: 'meta', status: 'active', days_active: 10, variants_count: 0, brand: 'a', family: '', image: null, ...over });

test('rankTop10 orders by run days, then variants, and ignores images', () => {
  const withImage = ad({ id: 'short', brand: 'a', days_active: 40, variants_count: 9, image: 'creatives/meta/short.webp' });
  const noImage = ad({ id: 'long', brand: 'b', days_active: 200, variants_count: 0, image: null });
  const tieMoreVariants = ad({ id: 'tie-hi', brand: 'c', days_active: 80, variants_count: 4, image: null });
  const tieFewerVariants = ad({ id: 'tie-lo', brand: 'd', days_active: 80, variants_count: 1, image: 'creatives/meta/tie.webp' });
  const ranked = rankTop10([withImage, tieFewerVariants, noImage, tieMoreVariants]);
  assert.deepEqual(ranked.map((i) => i.id), ['long', 'tie-hi', 'tie-lo', 'short']);
  assert.deepEqual(ranked.map((i) => i.rank), [1, 2, 3, 4]);
});

test('rankTop10 keeps two per brand and one per family', () => {
  const items = [
    ad({ id: 'a1', brand: 'a', family: 'fam', days_active: 300 }),
    ad({ id: 'a2', brand: 'a', family: 'fam', days_active: 290 }),
    ad({ id: 'a3', brand: 'a', family: 'other', days_active: 280 }),
    ad({ id: 'a4', brand: 'a', family: '', days_active: 270 }),
    ad({ id: 'b1', brand: 'b', family: 'fam', days_active: 260 }),
    ad({ id: 'c1', brand: 'c', family: '', days_active: 10, image: 'x.webp' }),
  ];
  const ranked = rankTop10(items);
  assert.deepEqual(ranked.map((i) => i.id), ['a1', 'a3', 'b1', 'c1']);
});

test('rankTop10 skips inactive ads, ads without days, and non-Meta rows', () => {
  const items = [
    ad({ id: 'off', status: 'inactive', days_active: 999 }),
    ad({ id: 'nodays', days_active: null }),
    ad({ id: 'org', source: 'organic', days_active: 999 }),
    ad({ id: 'ok', days_active: 12, brand: 'z' }),
  ];
  assert.deepEqual(rankTop10(items).map((i) => i.id), ['ok']);
  assert.deepEqual(rankTop10(items, { brandIds: ['missing'] }), []);
  assert.deepEqual(rankTop10(items, { brandIds: ['z'] }).map((i) => i.id), ['ok']);
});

test('entryReason distinguishes a new start from data completion', () => {
  const week = { weekStart: '2026-10-19', weekEnd: '2026-10-25' };
  const started = entryReason(
    { id: 'meta-new', source: 'meta', start_date: '2026-10-20' },
    { ...week, prevTopIds: [], prevItem: null },
  );
  assert.deepEqual(started, { reason: 'started' });

  const completed = entryReason(
    { id: 'meta-old', source: 'meta', start_date: '2025-03-12' },
    { ...week, prevTopIds: ['meta-kept'], prevItem: { id: 'meta-old', days_active: null, status: 'unknown' } },
  );
  assert.equal(completed.reason, 'data');
  assert.equal(completed.label, ENTRY_DATA_LABEL);
  assert.equal(ENTRY_DATA_LABEL, 'נכנסה בעקבות השלמת נתונים');

  const absent = entryReason(
    { id: 'meta-found', source: 'meta', start_date: '2025-02-15' },
    { ...week, prevTopIds: [], prevItem: null },
  );
  assert.equal(absent.reason, 'data');

  const climbed = entryReason(
    { id: 'meta-climbed', source: 'meta', start_date: '2025-08-12' },
    { ...week, prevTopIds: [], prevItem: { days_active: 400, status: 'active' } },
  );
  assert.equal(climbed, null);

  const already = entryReason(
    { id: 'meta-kept', source: 'meta', start_date: '2025-01-01', alias_ids: ['999'] },
    { ...week, prevTopIds: ['meta-999'], prevItem: null },
  );
  assert.equal(already, null);
});

test('Top 10 cards show the data-completion tag and a legacy-week note', () => {
  const esc = (s) => String(s ?? '');
  const { card, top10Panel } = makeRenderer({ esc, brandName: (id) => id, srcTag: () => '', link: () => '', section: (_id, _title, body) => body });
  const html = card({ id: 'meta-1', source: 'meta', brand: 'goom', format: 'image', days_active: 10 }, { rank: 1, entryLabel: ENTRY_DATA_LABEL });
  assert.match(html, /class="brand-tag t10-entered" dir="rtl"/);
  assert.match(html, /נכנסה בעקבות השלמת נתונים/);
  const startedCard = card({ id: 'meta-2', source: 'meta', brand: 'goom', format: 'image' }, { entryLabel: '' });
  assert.doesNotMatch(startedCard, /t10-entered/);

  const week = {
    key: '2026-W42', week: 42, start: '2026-10-12', end: '2026-10-18', asof: '2026-10-12',
    method: 'כלל ישן', note: 'הדירוג בשבוע זה חושב לפי הכלל הישן: קריאייטיב עם תמונה דורג לפני קריאייטיב בלי תמונה.',
    items: [{ id: 'meta-1', source: 'meta', brand: 'goom', format: 'image', days_active: 10, rank: 1 }],
    entered: { 'meta-1': { reason: 'data', label: ENTRY_DATA_LABEL } },
    niche: [], strips: [],
  };
  const panel = top10Panel({ top10: { weeks: { '2026-W42': week } }, creatives: { items: [] }, brands: [], scanDate: '12.10.2026' });
  assert.match(panel, /הדירוג בשבוע זה חושב לפי הכלל הישן/);
  assert.match(panel, /dir="rtl"/);
  assert.match(panel, /t10-entered/);
  assert.match(panel, /התמונה משמשת לתצוגה בלבד ואינה משפיעה על הדירוג/);
});
