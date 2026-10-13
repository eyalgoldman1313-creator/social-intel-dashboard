/**
 * Builds data/events.json.
 * Jewish holidays come from @hebcal/core (Israel). Civil and school dates
 * are fixed Gregorian rules or published Ministry of Education calendars.
 * The site build does not import this module.
 *
 *   node scripts/resolve-events.mjs --write
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HebrewCalendar, gematriya } from '@hebcal/core';

const SEED_FROM = '2026-09-26';
const SEED_THROUGH = '2027-10-31';

const JEWISH_RULES = [
  {
    match: (d) => /^Sukkot /.test(d),
    name: 'סוכות',
    type: 'holiday',
    relevance: 'high',
    blurb: 'חג הסוכות בישראל, בלי ערב החג.'
  },
  {
    match: (d) => d === 'Shmini Atzeret',
    name: 'שמיני עצרת',
    type: 'holiday',
    relevance: 'medium',
    blurb: 'שמיני עצרת ושמחת תורה בישראל.'
  },
  {
    match: (d) => d.startsWith('Chanukah:'),
    name: 'חנוכה',
    type: 'holiday',
    relevance: 'high',
    blurb: 'חנוכה, מהנר הראשון עד היום השמיני.'
  },
  {
    match: (d) => d === 'Tu BiShvat',
    name: 'ט״ו בשבט',
    type: 'holiday',
    relevance: 'medium',
    blurb: 'ט״ו בשבט, ראש השנה לאילנות.'
  },
  {
    match: (d) => d === 'Family Day',
    name: 'יום המשפחה',
    type: 'holiday',
    relevance: 'high',
    blurb: 'יום המשפחה בישראל, ל׳ בשבט.'
  },
  {
    match: (d) => d === 'Purim' || d === 'Shushan Purim',
    name: 'פורים',
    type: 'holiday',
    relevance: 'high',
    blurb: 'פורים ושושן פורים. תשפ״ז שנה מעוברת (אדר ב׳). בתי הספר בחופשה ב-23–24.3.2027.'
  },
  {
    match: (d) => /^Pesach /.test(d) && !d.includes('Sheni'),
    name: 'פסח',
    type: 'holiday',
    relevance: 'high',
    blurb: 'פסח בישראל, שבעה ימים, בלי ערב פסח ובלי פסח שני.'
  },
  {
    match: (d) => d === 'Yom HaShoah',
    name: 'יום השואה',
    type: 'holiday',
    relevance: 'medium',
    blurb: 'יום הזיכרון לשואה ולגבורה. לא לפרסם מבצע.'
  },
  {
    match: (d) => d === 'Yom HaZikaron',
    name: 'יום הזיכרון',
    type: 'holiday',
    relevance: 'medium',
    blurb: 'יום הזיכרון לחללי מערכות ישראל. לא לפרסם מבצע.'
  },
  {
    match: (d) => d === "Yom HaAtzma'ut",
    name: 'יום העצמאות',
    type: 'sale',
    relevance: 'high',
    blurb: 'יום העצמאות. יום קניות מרכזי, ובתי הספר לא לומדים.'
  },
  {
    match: (d) => d === 'Lag BaOmer',
    name: 'ל״ג בעומר',
    type: 'holiday',
    relevance: 'medium',
    blurb: 'ל״ג בעומר.'
  },
  {
    match: (d) => d === 'Shavuot',
    name: 'שבועות',
    type: 'holiday',
    relevance: 'medium',
    blurb: 'שבועות בישראל, יום אחד. בתי הספר בחופשה ב-10–11.6.2027.'
  },
  {
    match: (d) => d.startsWith('Rosh Hashana') && !d.includes('LaBehemot'),
    name: 'ראש השנה',
    type: 'holiday',
    relevance: 'high',
    blurb: 'ראש השנה, שני ימים, בלי ערב החג.'
  },
  {
    match: (d) => d === 'Yom Kippur',
    name: 'יום כיפור',
    type: 'holiday',
    relevance: 'medium',
    blurb: 'יום כיפור. לא לפרסם מבצע.'
  }
];

function pad(n) { return String(n).padStart(2, '0'); }

function iso(year, month, day) {
  return year + '-' + pad(month) + '-' + pad(day);
}

export function addDays(isoDate, n) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function daysBetween(from, to) {
  const [ay, am, ad] = from.split('-').map(Number);
  const [by, bm, bd] = to.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

function formatDay(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return Number(d) + '.' + Number(m) + '.' + y;
}

function formatSpan(start, end) {
  if (!end || end === start) return formatDay(start);
  return formatDay(start) + '–' + formatDay(end);
}

function gregIso(ev) {
  // abs2greg() is local midnight of the civil day. UTC fields are the
  // previous day anywhere east of UTC (Asia/Jerusalem included).
  const d = ev.getDate().greg();
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function nthWeekday(year, month, weekday, n) {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((weekday - firstDow + 7) % 7) + (n - 1) * 7;
  return iso(year, month, day);
}

function inSeed(ev) {
  const end = ev.end || ev.start;
  return end >= SEED_FROM && ev.start <= SEED_THROUGH;
}

function record(partial) {
  const row = {
    name: partial.name,
    start: partial.start,
    type: partial.type,
    relevance: partial.relevance,
    note: partial.note
  };
  if (partial.end && partial.end !== partial.start) row.end = partial.end;
  if (partial.disambiguator) row.disambiguator = partial.disambiguator;
  return row;
}

function cluster(items) {
  const sorted = [...items].sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
  const groups = [];
  for (const item of sorted) {
    const last = groups[groups.length - 1];
    if (!last || daysBetween(last[last.length - 1].iso, item.iso) > 14) groups.push([item]);
    else last.push(item);
  }
  return groups;
}

function jewishEvents() {
  const raw = HebrewCalendar.calendar({
    start: new Date(2026, 7, 1),
    end: new Date(2027, 10, 30),
    il: true,
    noMinorFast: true,
    noRoshChodesh: true,
    noSpecialShabbat: true,
    sedrot: false,
    omer: false,
    candlelighting: false
  });
  const rows = [];
  for (const rule of JEWISH_RULES) {
    const hits = raw.filter((ev) => rule.match(ev.getDesc())).map((ev) => ({
      iso: gregIso(ev),
      hebrew: ev.getDate().renderGematriya(),
      year: gematriya(ev.getDate().getFullYear())
    }));
    for (const group of cluster(hits)) {
      const start = group[0].iso;
      const end = group[group.length - 1].iso;
      const hebrew = group[0].hebrew === group[group.length - 1].hebrew
        ? group[0].hebrew
        : group[0].hebrew + ' – ' + group[group.length - 1].hebrew;
      rows.push(record({
        name: rule.name,
        start,
        end,
        type: rule.type,
        relevance: rule.relevance,
        disambiguator: group[0].year,
        note: rule.blurb + ' לפי Hebcal לישראל: ' + hebrew + ' (' + formatSpan(start, end) + ').'
      }));
    }
  }
  return rows;
}

/**
 * School weeks around Tu BiShvat. The Ministry of Education does not publish
 * one national report-card day; schools issue them a few days before or after.
 * Friday/Saturday: the previous Sunday through the following Thursday.
 * Sunday–Thursday: that Sunday–Thursday week.
 */
export function reportCardWindow(tuBishvatIso) {
  const [y, m, d] = tuBishvatIso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const sunday = addDays(tuBishvatIso, -dow);
  const end = dow >= 5 ? addDays(tuBishvatIso, (4 - dow + 7) % 7) : addDays(sunday, 4);
  return { start: sunday, end };
}

function reportCardEvent(tuBishvatIso) {
  const window = reportCardWindow(tuBishvatIso);
  return record({
    name: 'תעודות מחצית',
    start: window.start,
    end: window.end,
    type: 'season',
    relevance: 'high',
    note: 'אין תאריך ארצי אחד של משרד החינוך. בתי הספר מחלקים תעודות מחצית בימי הלימודים שלפני או אחרי ט״ו בשבט (לפי Hebcal, ' + formatDay(tuBishvatIso) + '). החלון הוא ימי א׳–ה׳ שמקיפים את התאריך.'
  });
}

function fluSeason(year) {
  const lastFeb = new Date(Date.UTC(year + 1, 2, 0)).getUTCDate();
  return {
    start: iso(year, 11, 1),
    end: iso(year + 1, 2, lastFeb)
  };
}

function civilEvents() {
  const rows = [];
  for (const year of [2026, 2027]) {
    const thanksgiving = nthWeekday(year, 11, 4, 4);
    const blackFriday = addDays(thanksgiving, 1);
    const cyberMonday = addDays(blackFriday, 3);
    rows.push(
      record({
        name: 'ליל כל הקדושים',
        start: iso(year, 10, 31),
        type: 'holiday',
        relevance: 'low',
        disambiguator: String(year),
        note: '31 באוקטובר. בישראל זה נישתי, ורלוונטיות נמוכה למותג מיקוד ורוגע לילדים.'
      }),
      record({
        name: 'יום הרווקים',
        start: iso(year, 11, 11),
        type: 'sale',
        relevance: 'high',
        disambiguator: String(year),
        note: 'Singles Day, 11.11. יום מבצעי אונליין.'
      }),
      record({
        name: 'בלאק פריידיי',
        start: blackFriday,
        type: 'sale',
        relevance: 'high',
        disambiguator: String(year),
        note: 'יום שישי שאחרי חג ההודיה בארה״ב (' + formatDay(thanksgiving) + '). שיא מבצעי הקניות.'
      }),
      record({
        name: 'סייבר מאנדיי',
        start: cyberMonday,
        type: 'sale',
        relevance: 'high',
        disambiguator: String(year),
        note: 'יום שני שאחרי בלאק פריידיי. מבצעי אונליין.'
      }),
      record({
        name: 'חג המולד',
        start: iso(year, 12, 25),
        type: 'holiday',
        relevance: 'low',
        disambiguator: String(year),
        note: '25 בדצמבר. רלוונטיות נמוכה בישראל למותג הזה.'
      }),
      record({
        name: 'סילבסטר',
        start: iso(year, 12, 31),
        type: 'holiday',
        relevance: 'low',
        disambiguator: String(year),
        note: '31 בדצמבר, ערב השנה האזרחית. רלוונטיות נמוכה.'
      })
    );
    const flu = fluSeason(year);
    rows.push(record({
      name: 'עונת השפעת',
      start: flu.start,
      end: flu.end,
      type: 'season',
      relevance: 'high',
      disambiguator: String(year),
      note: 'נובמבר עד פברואר. עונת שפעת ושינוי שגרה אצל ילדים.'
    }));
  }

  rows.push(
    record({
      name: 'השנה החדשה',
      start: '2027-01-01',
      type: 'holiday',
      relevance: 'medium',
      note: '1 בינואר. פתיחת השנה האזרחית.'
    }),
    record({
      name: 'יום האהבה',
      start: '2027-02-14',
      type: 'holiday',
      relevance: 'low',
      note: '14 בפברואר. רלוונטיות נמוכה למותג לילדים.'
    }),
    record({
      name: 'יום האישה הבינלאומי',
      start: '2027-03-08',
      type: 'holiday',
      relevance: 'low',
      note: '8 במרץ. רלוונטיות נמוכה למותג הזה.'
    }),
    record({
      name: 'יום הבריאות העולמי',
      start: '2027-04-07',
      type: 'season',
      relevance: 'medium',
      note: '7 באפריל, יום הבריאות העולמי.'
    }),
    record({
      name: 'יום האם הבינלאומי',
      start: nthWeekday(2027, 5, 0, 2),
      type: 'holiday',
      relevance: 'medium',
      note: 'יום ראשון השני של מאי. נפרד מיום המשפחה בישראל.'
    }),
    // Ministry of Education תשפ״ז. Hanukkah vacation is Sunday 6.12.2026
    // through Saturday 12.12.2026; school resumes 13.12.2026.
    // Sources: meyda.education.gov.il daycare calendar (06.12.2026),
    // mako, edugo, shemesh.
    record({
      name: 'חופשת חנוכה',
      start: '2026-12-06',
      end: '2026-12-12',
      type: 'season',
      relevance: 'high',
      note: 'בתי הספר: ראשון 6.12.2026 עד שבת 12.12.2026. חזרה ללימודים 13.12.2026. לפי לוח משרד החינוך תשפ״ז (meyda.education.gov.il, וגם mako, edugo ו-shemesh).'
    }),
    record({
      name: 'חופשת פסח',
      start: '2027-04-13',
      end: '2027-04-28',
      type: 'season',
      relevance: 'high',
      note: 'בתי הספר: 13–28.4.2027, חזרה ללימודים 29.4.2027. לפי לוחות תשפ״ז ב-mako, edugo ו-shemesh. מעונות יום חרדיים בלוח המשרד יוצאים ב-19.4.'
    }),
    record({
      name: 'חופש גדול',
      start: '2027-06-21',
      end: '2027-08-31',
      type: 'season',
      relevance: 'high',
      note: 'תיכונים מסיימים ב-20.6.2027 (החופש מ-21.6). גנים ויסודי מסיימים ב-30.6.2027 (החופש מ-1.7). הטווח עד 31.8.2027. לפי edugo ו-mako על לוח תשפ״ז.'
    }),
    record({
      name: 'פתיחת שנת הלימודים',
      start: '2027-09-01',
      type: 'season',
      relevance: 'high',
      note: '1.9.2027, יום רביעי, לפי הנוהג של פתיחה ב-1 בספטמבר כפי ש-mako מציין לתשפ״ח. חוזר מנכ״ל לתשפ״ח עוד לא פורסם. מעונות יום חרדיים בלוח המשרד נפתחים ב-3.9.2027.'
    })
  );
  return rows;
}

function disambiguate(rows) {
  const counts = new Map();
  for (const row of rows) counts.set(row.name, (counts.get(row.name) || 0) + 1);
  return rows.map((row) => {
    const next = { ...row };
    if (counts.get(row.name) > 1 && row.disambiguator) next.name = row.name + ' ' + row.disambiguator;
    delete next.disambiguator;
    return next;
  });
}

export function resolveEvents() {
  const jewish = jewishEvents();
  const tu = jewish.find((ev) => ev.name === 'ט״ו בשבט');
  if (!tu) throw new Error('Hebcal did not return Tu BiShvat inside the seed window');
  const rows = disambiguate([...jewish, reportCardEvent(tu.start), ...civilEvents()].filter(inSeed));
  rows.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return rows.map((row) => {
    const out = { name: row.name, start: row.start };
    if (row.end) out.end = row.end;
    out.type = row.type;
    out.relevance = row.relevance;
    if (row.note) out.note = row.note;
    return out;
  });
}

if (process.argv.includes('--write')) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const events = resolveEvents();
  writeFileSync(join(root, 'data/events.json'), JSON.stringify(events, null, 2) + '\n');
}
