import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = {};
sandbox.window = sandbox;
vm.runInNewContext(readFileSync(join(root, 'public/events.js'), 'utf8'), sandbox);
const CE = sandbox.CommerceEvents;
const events = JSON.parse(readFileSync(join(root, 'data/events.json'), 'utf8'));

const TODAY = '2026-10-12';

test('seed passes the schema and covers Oct 2026 through Jun 2027', () => {
  assert.equal(CE.validate(events).length, 0);
  const starts = events.map((e) => e.start).sort();
  assert.ok(starts[0] <= '2026-10-03');
  assert.ok(starts[starts.length - 1] >= '2027-06-21');
  for (const type of ['sale', 'holiday', 'season']) {
    assert.ok(events.some((e) => e.type === type));
  }
});

test('anchor dates match the verified calendar', () => {
  const byName = Object.fromEntries(events.map((e) => [e.name, e]));
  assert.equal(byName['בלאק פריידיי'].start, '2026-11-27');
  assert.equal(byName['סייבר מאנדיי'].start, '2026-11-30');
  assert.equal(byName['חנוכה'].start, '2026-12-04');
  assert.equal(byName['חנוכה'].end, '2026-12-12');
  assert.equal(byName['ליל כל הקדושים'].start, '2026-10-31');
  assert.equal(byName['יום הרווקים'].start, '2026-11-11');
  assert.equal(byName['חג המולד'].start, '2026-12-25');
  assert.equal(byName['השנה החדשה'].start, '2027-01-01');
  assert.equal(byName['ט״ו בשבט'].start, '2027-01-22');
  assert.equal(byName['ט״ו בשבט'].end, '2027-01-23');
  assert.equal(byName['יום המשפחה'].start, '2027-02-07');
  assert.equal(byName['יום האהבה'].start, '2027-02-14');
  assert.equal(byName['פורים'].start, '2027-03-23');
  assert.equal(byName['פורים'].end, '2027-03-24');
  assert.equal(byName['פסח'].start, '2027-04-22');
  assert.equal(byName['פסח'].end, '2027-04-28');
  assert.equal(byName['יום העצמאות'].start, '2027-05-12');
  assert.equal(byName['יום האם הבינלאומי'].start, '2027-05-09');
  assert.equal(byName['שבועות'].start, '2027-06-11');
});

test('120-day window on 12 Oct 2026 keeps near events and drops past and far ones', () => {
  const names = CE.visible(events, TODAY).map((e) => e.name);
  assert.deepEqual(names.slice(0, 3), ['ליל כל הקדושים', 'יום הרווקים', 'בלאק פריידיי']);
  assert.ok(names.includes('חנוכה'));
  assert.ok(names.includes('יום המשפחה'));
  assert.equal(names.includes('סוכות'), false);
  assert.equal(names.includes('שמיני עצרת'), false);
  assert.equal(names.includes('יום האהבה'), false);
  assert.equal(names.includes('פסח'), false);
  assert.equal(CE.addDays(TODAY, 120), '2027-02-09');
  const family = CE.visible(events, TODAY).find((e) => e.name === 'יום המשפחה');
  assert.equal(family.days, 118);
  assert.ok(names.every((n, i, arr) => i === 0 || events.find((e) => e.name === arr[i - 1]).start <= events.find((e) => e.name === n).start));
});

test('wording: countdown, tomorrow, today, and an ongoing range', () => {
  const on = (day) => CE.visible(events, day);
  const bf = on('2026-10-12').find((e) => e.name === 'בלאק פריידיי');
  assert.equal(bf.phrase, '46 ימים');
  assert.equal(bf.lead, '46');
  assert.equal(bf.copy, 'ימים לבלאק פריידיי');
  assert.equal(bf.dateLabel, '27.11.2026');

  const eve = on('2026-11-26').find((e) => e.name === 'בלאק פריידיי');
  assert.equal(eve.phase, 'tomorrow');
  assert.equal(eve.phrase, 'מחר');

  const day = on('2026-11-27').find((e) => e.name === 'בלאק פריידיי');
  assert.equal(day.phase, 'today');
  assert.equal(day.phrase, 'היום');
  assert.equal(on('2026-11-28').some((e) => e.name === 'בלאק פריידיי'), false);

  const hanukkah = on('2026-12-08').find((e) => e.name === 'חנוכה');
  assert.equal(hanukkah.phase, 'ongoing');
  assert.equal(hanukkah.phrase, 'מתקיים עכשיו');
  assert.equal(hanukkah.dateLabel, '4–12.12.2026');
  assert.equal(on('2026-12-12').find((e) => e.name === 'חנוכה').phase, 'ongoing');
  assert.equal(on('2026-12-13').some((e) => e.name === 'חנוכה'), false);
});

test('date ranges stay day-first across months', () => {
  assert.equal(CE.formatRange('2026-12-04', '2026-12-12'), '4–12.12.2026');
  assert.equal(CE.formatRange('2027-03-28', '2027-04-04'), '28.3–4.4.2027');
  assert.equal(CE.formatRange('2026-12-31', '2027-01-01'), '31.12.2026–1.1.2027');
  assert.equal(CE.formatRange('2026-11-27', null), '27.11.2026');
});

test('header keeps three chips and puts the rest in the strip', () => {
  const html = CE.renderBoard(events, TODAY, { featured: 3 });
  assert.match(html, /ימים לליל כל הקדושים/);
  assert.match(html, /ימים ליום הרווקים/);
  assert.match(html, /ימים לבלאק פריידיי/);
  assert.match(html, /class="event-strip"/);
  assert.match(html, /חנוכה/);
  assert.equal((html.match(/class="event"/g) || []).length, 3);
  assert.ok((html.match(/class="event-pill"/g) || []).length >= 5);
  const narrow = CE.renderBoard(events, TODAY, { featured: 2 });
  assert.equal((narrow.match(/class="event"/g) || []).length, 2);
});
