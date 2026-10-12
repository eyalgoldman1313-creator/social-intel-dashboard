// Single source for every "last updated" date on the dashboard. Nothing is hardcoded:
//   updated = latest of (data timestamps: creatives.generatedAt/asof, latest Top 10 week, winnerChanges,
//             last git commit touching data/ or public/creatives) – never later than the build time.
// All dates are shown in Israel time (Asia/Jerusalem), day-first: DD.MM.YYYY.
import { execSync } from 'node:child_process';
const TZ = 'Asia/Jerusalem';
const parts = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((p) => [p.type, p.value]));
export const fmtIL = (d) => { const p = parts(new Date(d)); return `${p.day}.${p.month}.${p.year}`; };
export const fmtILTime = (d) => { const p = parts(new Date(d)); return `${p.hour}:${p.minute}`; };
// YYYY-MM-DD (a calendar date, no time) -> DD.MM.YYYY without timezone shifting
export const fmtDay = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? String(s).split('-').reverse().join('.') : s ? fmtIL(s) : '');
// calendar dates are taken as noon Israel time so they never roll over to another day
const toTs = (v) => { if (!v) return null; const s = String(v); const t = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(s + 'T12:00:00+03:00') : Date.parse(s); return Number.isFinite(t) ? t : null; };

export function dataTimestamps({ root, data, creatives, top10 }) {
  const out = [];
  const add = (src, v) => { const t = toTs(v); if (t) out.push({ src, t }); };
  add('creatives.generatedAt', creatives?.generatedAt); add('creatives.asof', creatives?.asof);
  const weeks = Object.values(top10?.weeks || {}).sort((a, b) => a.key.localeCompare(b.key)); const lw = weeks[weeks.length - 1];
  if (lw) { add('top10.asof', lw.asof); add('top10.generatedAt', lw.generatedAt); }
  for (const c of data?.winnerChanges || []) add('winnerChanges', c.date);
  for (const s of data?.scans || []) add('scan ' + s.id, s.id);
  try { add('git data commit', execSync('git log -1 --format=%cI -- data public/creatives public/mailers', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()); } catch {}
  return out;
}
export function siteDates(ctx, now = new Date()) {
  const ts = dataTimestamps(ctx).filter((x) => x.t <= now.getTime() + 60000);
  const latest = ts.length ? ts.reduce((a, b) => (b.t > a.t ? b : a)) : { src: 'build (no data timestamps)', t: now.getTime() };
  return { built: now, updated: new Date(latest.t), updatedSrc: latest.src, label: 'עדכון שבועי', stamps: ts };
}
