import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = {};
sandbox.window = sandbox;
vm.runInNewContext(readFileSync(join(root, 'public/mailer-sort.js'), 'utf8'), sandbox);
const MS = sandbox.MailerSort;

test('parseScore accepts decimals, comma decimals, and n/10 labels', () => {
  assert.equal(MS.parseScore('6'), 6);
  assert.equal(MS.parseScore('5.5'), 5.5);
  assert.equal(MS.parseScore('5,5'), 5.5);
  assert.equal(MS.parseScore('6/10'), 6);
  assert.equal(MS.parseScore('5.5/10'), 5.5);
  assert.equal(MS.parseScore('5,5 / 10'), 5.5);
  assert.equal(MS.parseScore('  8 '), 8);
  assert.equal(MS.parseScore(8), 8);
  assert.equal(MS.parseScore(5.5), 5.5);
  assert.equal(MS.parseScore(0), 0);
  assert.equal(MS.parseScore('ציון 7.5 מתוך 10'), 7.5);
});

test('parseScore treats blanks and non-numeric labels as missing', () => {
  for (const v of ['', '   ', null, undefined, '—', 'אין', 'N/A', NaN, 'אין ציון']) {
    assert.equal(MS.parseScore(v), null);
  }
});

test('parseDateKey reads day-first dates and ISO dates', () => {
  assert.equal(MS.parseDateKey('12.10.2026'), 20261012);
  assert.equal(MS.parseDateKey('09.10.2026'), 20261009);
  assert.equal(MS.parseDateKey('9.10.2026'), 20261009);
  assert.equal(MS.parseDateKey('12/10/2026'), 20261012);
  assert.equal(MS.parseDateKey('12-10-2026'), 20261012);
  assert.equal(MS.parseDateKey('  04.10.2026 '), 20261004);
  assert.equal(MS.parseDateKey('2026-10-13'), 20261013);
  assert.equal(MS.parseDateKey('2026-10-13T08:00:00'), 20261013);
  assert.equal(MS.parseDateKey('12.10.26'), 20261012);
});

test('parseDateKey rejects missing and impossible dates', () => {
  for (const v of ['', null, undefined, 'אין', '6/10', '31.02.2026', '00.10.2026', '12.13.2026', '32.01.2026']) {
    assert.equal(MS.parseDateKey(v), null);
  }
});

test('missing values sort last in every direction and ties keep original order', () => {
  const items = [
    { id: 'a', score: 6, date: 20261012, index: 0 },
    { id: 'b', score: null, date: 20261011, index: 1 },
    { id: 'c', score: 8, date: null, index: 2 },
    { id: 'd', score: 8, date: 20261008, index: 3 },
    { id: 'e', score: 5.5, date: 20261008, index: 4 },
    { id: 'f', score: null, date: null, index: 5 }
  ];
  const ids = (key) => MS.mailerOrder(items, key).map((x) => x.id);
  assert.deepEqual(ids('date-desc'), ['a', 'b', 'd', 'e', 'c', 'f']);
  assert.deepEqual(ids('date-asc'), ['d', 'e', 'b', 'a', 'c', 'f']);
  assert.deepEqual(ids('score-desc'), ['c', 'd', 'a', 'e', 'b', 'f']);
  assert.deepEqual(ids('score-asc'), ['e', 'a', 'c', 'd', 'b', 'f']);
  assert.deepEqual(ids('nope'), ids('date-desc'));
});

test('competitor options come from the data, with counts, skipping blanks', () => {
  const opts = MS.competitorOptions(['Fill It', 'Mayven', '', 'fill it', 'Smiley', null, '  EcoSupp  ']);
  assert.equal(opts.map((o) => o.name).join('|'), 'EcoSupp|Fill It|Mayven|Smiley');
  assert.equal(opts.find((o) => o.name === 'Fill It').count, 2);
  assert.equal(MS.matchBrand('fill it', 'Fill It'), true);
  assert.equal(MS.matchBrand('Mayven', ''), true);
  assert.equal(MS.matchBrand('Mayven', 'Smiley'), false);
});

test('hash round-trips sort and brand, including spaces and slashes', () => {
  assert.equal(MS.formatMailerHash('date-desc', ''), '#mailers');
  assert.equal(MS.formatMailerHash('score-asc', ''), '#mailers/s-score-asc');
  const spaced = MS.formatMailerHash('date-desc', 'Fill It');
  assert.equal(spaced, '#mailers/b-Fill%20It');
  const parsed = MS.parseMailerHash(spaced);
  assert.equal(parsed.mailerInHash, true);
  assert.equal(parsed.sort, null);
  assert.equal(parsed.brand, 'Fill It');
  const both = MS.formatMailerHash('date-asc', 'a/b');
  assert.equal(MS.parseMailerHash(both).brand, 'a/b');
  assert.equal(MS.parseMailerHash(both).sort, 'date-asc');
  const he = MS.formatMailerHash('score-desc', 'מותג חדש');
  assert.equal(MS.parseMailerHash(he).brand, 'מותג חדש');
  assert.equal(MS.parseMailerHash('#mailers').mailerInHash, false);
});

test('current mailer data sorts and lists every competitor', () => {
  const specs = JSON.parse(readFileSync(join(root, 'data/specs.json'), 'utf8'));
  const items = (specs.mailers || []).map((m, index) => ({
    index,
    brand: m.brand,
    score: MS.parseScore(m.score),
    date: MS.parseDateKey(m.date),
    title: m.title
  }));
  assert.ok(items.length > 0);
  const byDate = MS.mailerOrder(items, 'date-desc');
  let prev = Infinity;
  for (const it of byDate) {
    if (it.date == null) { prev = null; continue; }
    assert.ok(prev == null || it.date <= prev);
    prev = it.date;
  }
  assert.equal(byDate.at(-1).date == null || byDate.every((it) => it.date != null) || byDate.at(-1).date == null, true);
  const dated = byDate.filter((it) => it.date != null);
  const missing = byDate.filter((it) => it.date == null);
  assert.deepEqual(byDate.slice(dated.length), missing);
  const opts = MS.competitorOptions(items.map((it) => it.brand));
  const total = opts.reduce((n, o) => n + o.count, 0);
  assert.equal(total, items.filter((it) => String(it.brand || '').trim()).length);
  assert.ok(opts.some((o) => o.name === 'Fill It' && o.count >= 1));
});
