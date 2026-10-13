import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { HebrewCalendar } from '@hebcal/core';
import { reportCardWindow, resolveEvents } from './resolve-events.mjs';

// 13.10.2026 12:00 UTC is still 13.10.2026 in Israel. Tests must not follow the host clock.
const FIXED_NOW = Date.parse('2026-10-13T12:00:00Z');
mock.timers.enable({ apis: ['Date'], now: FIXED_NOW });

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = {};
sandbox.window = sandbox;
vm.runInNewContext(readFileSync(join(root, 'public/events.js'), 'utf8'), sandbox);
const CE = sandbox.CommerceEvents;
const events = JSON.parse(readFileSync(join(root, 'data/events.json'), 'utf8'));

const TODAY = '2026-10-12';

function byName(name) {
  const found = events.find((ev) => ev.name === name);
  assert.ok(found, 'missing event ' + name);
  return found;
}

function hebcalRange(match, from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return HebrewCalendar.calendar({
    start: new Date(fy, fm - 1, fd),
    end: new Date(ty, tm - 1, td),
    il: true,
    noMinorFast: true,
    noRoshChodesh: true,
    noSpecialShabbat: true,
    sedrot: false,
    omer: false,
    candlelighting: false
  }).filter((ev) => match(ev.getDesc())).map((ev) => {
    const d = ev.getDate().greg();
    const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return { iso, hebrewDay: ev.getDate().getDate(), desc: ev.getDesc() };
  });
}

test('injected now is 13 Oct 2026 in Israel, independent of the host clock', () => {
  assert.equal(new Date().toISOString(), '2026-10-13T12:00:00.000Z');
  assert.equal(CE.israelToday(), '2026-10-13');
  const visible = CE.visible(events);
  assert.deepEqual(visible.slice(0, 3).map((e) => e.name), ['עונת השפעת', 'יום הרווקים', 'בלאק פריידיי']);
  assert.equal(visible.find((e) => e.name === 'בלאק פריידיי').days, 45);
  assert.equal(CE.addDays(CE.israelToday(), 120), '2027-02-10');
  assert.equal(visible.find((e) => e.name === 'יום המשפחה').days, 117);
});

test('seed matches the Hebcal resolver and covers through Oct 2027', () => {
  assert.deepEqual(events, resolveEvents());
  assert.equal(CE.validate(events).length, 0);
  const starts = events.map((e) => e.start).sort();
  assert.ok(starts[0] <= '2026-10-03');
  assert.ok(starts[starts.length - 1] >= '2027-10-01');
  for (const type of ['sale', 'holiday', 'season']) {
    assert.ok(events.some((e) => e.type === type));
  }
  for (const relevance of ['high', 'medium', 'low']) {
    assert.ok(events.some((e) => e.relevance === relevance));
  }
  assert.equal(events.some((e) => e.name.startsWith('תחילת ה')), false);
});

test('retail relevance and the added parent seasons', () => {
  assert.equal(byName('ליל כל הקדושים 2026').relevance, 'low');
  assert.equal(byName('חג המולד').relevance, 'low');
  assert.equal(byName('יום האהבה').relevance, 'low');
  assert.equal(byName('סילבסטר').relevance, 'low');
  assert.equal(byName('יום הרווקים').relevance, 'high');
  assert.equal(byName('בלאק פריידיי').relevance, 'high');
  assert.equal(byName('סייבר מאנדיי').relevance, 'high');
  assert.equal(byName('עונת השפעת').start, '2026-11-01');
  assert.equal(byName('עונת השפעת').end, '2027-02-28');
  assert.equal(byName('עונת השפעת').type, 'season');
  assert.equal(byName('חופשת חנוכה').start, '2026-12-06');
  assert.equal(byName('חופשת חנוכה').end, '2026-12-12');
  assert.equal(byName('תעודות מחצית').relevance, 'high');
  assert.equal(byName('יום המשפחה').relevance, 'high');
});

test('Jewish dates are the Israel dates Hebcal returns', () => {
  const chanukah = hebcalRange((d) => d.startsWith('Chanukah:'), '2026-12-01', '2026-12-20');
  assert.equal(byName('חנוכה').start, chanukah[0].iso);
  assert.equal(byName('חנוכה').end, chanukah[chanukah.length - 1].iso);
  assert.equal(byName('חנוכה').start, '2026-12-04');
  assert.equal(byName('חנוכה').end, '2026-12-12');

  const tu = hebcalRange((d) => d === 'Tu BiShvat', '2027-01-01', '2027-02-01');
  assert.equal(tu.length, 1);
  assert.equal(byName('ט״ו בשבט').start, tu[0].iso);
  assert.equal(byName('ט״ו בשבט').end, undefined);
  assert.equal(tu[0].hebrewDay, 15);

  const family = hebcalRange((d) => d === 'Family Day', '2027-02-01', '2027-02-20');
  assert.equal(family.length, 1);
  assert.equal(family[0].hebrewDay, 30);
  assert.equal(byName('יום המשפחה').start, family[0].iso);
  assert.equal(byName('יום המשפחה').start, '2027-02-07');

  const pesach = hebcalRange((d) => /^Pesach /.test(d) && !d.includes('Sheni'), '2027-04-01', '2027-05-01');
  assert.equal(byName('פסח').start, pesach[0].iso);
  assert.equal(byName('פסח').end, pesach[pesach.length - 1].iso);
  assert.equal(byName('פסח').start, '2027-04-22');
  assert.equal(byName('פסח').end, '2027-04-28');

  const purim = hebcalRange((d) => d === 'Purim' || d === 'Shushan Purim', '2027-03-01', '2027-04-01');
  assert.equal(byName('פורים').start, purim[0].iso);
  assert.equal(byName('פורים').end, purim[purim.length - 1].iso);

  const cards = reportCardWindow(tu[0].iso);
  assert.equal(byName('תעודות מחצית').start, cards.start);
  assert.equal(byName('תעודות מחצית').end, cards.end);
  assert.equal(cards.start, '2027-01-17');
  assert.equal(cards.end, '2027-01-28');

  assert.equal(byName('בלאק פריידיי').start, '2026-11-27');
  assert.equal(byName('סייבר מאנדיי').start, '2026-11-30');
  assert.equal(byName('יום הרווקים').start, '2026-11-11');
  assert.equal(byName('יום העצמאות').start, '2027-05-12');
  assert.equal(byName('יום האם הבינלאומי').start, '2027-05-09');
  assert.equal(byName('שבועות').start, '2027-06-11');
  assert.equal(byName('ראש השנה').start, '2027-10-02');
  assert.equal(byName('ראש השנה').end, '2027-10-03');
  assert.ok(events.some((e) => e.start >= '2027-10-01' && e.start <= '2027-10-31'));
});

test('120-day window keeps lows out of the leading chips', () => {
  const visible = CE.visible(events, TODAY);
  const names = visible.map((e) => e.name);
  assert.deepEqual(names.slice(0, 3), ['עונת השפעת', 'יום הרווקים', 'בלאק פריידיי']);
  assert.ok(names.includes('חנוכה'));
  assert.ok(names.includes('חופשת חנוכה'));
  assert.ok(names.includes('תעודות מחצית'));
  assert.ok(names.includes('יום המשפחה'));
  assert.ok(names.includes('ליל כל הקדושים 2026'));
  assert.equal(names.includes('ליל כל הקדושים 2027'), false);
  assert.equal(names.some((n) => n.startsWith('סוכות')), false);
  assert.equal(names.some((n) => n.startsWith('שמיני עצרת')), false);
  assert.equal(names.includes('יום האהבה'), false);
  assert.equal(names.includes('פסח'), false);
  assert.equal(CE.addDays(TODAY, 120), '2027-02-09');
  const family = visible.find((e) => e.name === 'יום המשפחה');
  assert.equal(family.days, 118);
  const firstLow = names.findIndex((n) => events.find((e) => e.name === n).relevance === 'low');
  assert.ok(firstLow >= 3);
  assert.ok(names.slice(0, firstLow).every((n) => events.find((e) => e.name === n).relevance !== 'low'));
  assert.ok(names.slice(firstLow).every((n) => events.find((e) => e.name === n).relevance === 'low'));
  assert.ok(names.indexOf('ליל כל הקדושים 2026') > names.indexOf('בלאק פריידיי'));
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

  const flu = on('2026-11-15').find((e) => e.name === 'עונת השפעת');
  assert.equal(flu.phase, 'ongoing');
  assert.equal(flu.phrase, 'מתקיים עכשיו');
});

test('date ranges stay day-first across months', () => {
  assert.equal(CE.formatRange('2026-12-04', '2026-12-12'), '4–12.12.2026');
  assert.equal(CE.formatRange('2027-03-28', '2027-04-04'), '28.3–4.4.2027');
  assert.equal(CE.formatRange('2026-12-31', '2027-01-01'), '31.12.2026–1.1.2027');
  assert.equal(CE.formatRange('2026-11-27', null), '27.11.2026');
});

test('header chips skip low relevance unless nothing else is in the window', () => {
  const html = CE.renderBoard(events, TODAY, { featured: 3 });
  const stripAt = html.indexOf('class="event-strip"');
  const chips = html.slice(0, stripAt);
  assert.match(chips, /ימים לעונת השפעת/);
  assert.match(chips, /ימים ליום הרווקים/);
  assert.match(chips, /ימים לבלאק פריידיי/);
  assert.doesNotMatch(chips, /ליל כל הקדושים/);
  assert.match(html.slice(stripAt), /data-relevance="low"/);
  assert.match(html.slice(stripAt), /ליל כל הקדושים 2026/);
  assert.match(html.slice(stripAt), /רלוונטיות נמוכה/);
  assert.equal((html.match(/class="event"/g) || []).length, 3);
  assert.ok((html.match(/class="event-pill"/g) || []).length >= 5);
  assert.match(html, /class="event-track"/);
  assert.equal((html.match(/class="event-set"/g) || []).length, 1);
  assert.equal(CE.marqueeMode(480, 480, false), 'fit');
  assert.equal(CE.marqueeMode(900, 360, false), 'marquee');
  assert.equal(CE.marqueeMode(900, 360, true), 'scroll');

  const narrow = CE.renderBoard(events, TODAY, { featured: 2 });
  assert.equal((narrow.match(/class="event"/g) || []).length, 2);
  assert.doesNotMatch(narrow.slice(0, narrow.indexOf('class="event-strip"')), /ליל כל הקדושים/);

  const mixed = [
    { name: 'מוקדם', start: '2026-10-13', type: 'holiday', relevance: 'low' },
    { name: 'מאוחר', start: '2026-12-01', type: 'sale', relevance: 'high' }
  ];
  assert.deepEqual(CE.visible(mixed, TODAY).map((e) => e.name), ['מאוחר', 'מוקדם']);
  const one = CE.renderBoard(mixed, TODAY, { featured: 3 });
  assert.equal((one.match(/class="event"/g) || []).length, 1);
  assert.match(one, /data-relevance="low"/);
  assert.match(one.slice(one.indexOf('class="event-strip"')), /מוקדם/);

  const onlyLow = [
    { name: 'א', start: '2026-10-20', type: 'holiday', relevance: 'low' },
    { name: 'ב', start: '2026-10-21', type: 'holiday', relevance: 'low' },
    { name: 'ג', start: '2026-10-22', type: 'holiday', relevance: 'low' }
  ];
  const lows = CE.renderBoard(onlyLow, TODAY, { featured: 3 });
  assert.equal((lows.match(/class="event"/g) || []).length, 3);
  assert.equal((lows.match(/data-relevance="low"/g) || []).length, 3);
});
