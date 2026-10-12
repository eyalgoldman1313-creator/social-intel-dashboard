// Date health check. Run by build.mjs (warnings) and standalone: node scripts/check-dates.mjs [--strict]
// Warns when: the latest data timestamp is stale (> STALE_DAYS old), a "last updated" date is hardcoded in
// the templates, one-time-scan wording is back, or the built header disagrees with the derived date.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteDates, fmtIL } from './dates.mjs';
export const STALE_DAYS = 8; // weekly update + 1 day grace
const root0 = join(dirname(fileURLToPath(import.meta.url)), '..');
export function checkDates({ root = root0, data, sd }) {
  const w = [];
  const age = (sd.built - sd.updated) / 86400000;
  if (age > STALE_DAYS) w.push(`stale: latest data is ${fmtIL(sd.updated)} (${Math.floor(age)} days before build) – weekly update missing?`);
  const files = [...readdirSync(join(root, 'scripts')).filter((f) => /\.mjs$/.test(f) && !/test|check-dates|dates\.mjs/.test(f)).map((f) => 'scripts/' + f),
    ...readdirSync(join(root, 'public')).filter((f) => f.endsWith('.js')).map((f) => 'public/' + f)];
  for (const f of files) readFileSync(join(root, f), 'utf8').split('\n').forEach((l, i) => {
    if (/(עודכן|עדכון אחרון|last updated|נכון ל-)[^\n]{0,30}\d{1,2}\.\d{1,2}\.20\d\d/i.test(l)) w.push(`hardcoded date: ${f}:${i + 1}`);
    if (/חד-פעמית/.test(l)) w.push(`one-time-scan wording: ${f}:${i + 1}`);
  });
  const d = data || JSON.parse(readFileSync(join(root, 'data/data.json'), 'utf8'));
  for (const [k, v] of [['site.scanType', d.site?.scanType], ...(d.scans || []).map((s) => [`scans[${s.id}].statusLabel`, s.statusLabel])])
    if (/חד-פעמית/.test(v || '')) w.push(`one-time-scan wording in data.json ${k}`);
  const idx = join(root, 'dist/index.html');
  if (existsSync(idx)) { const m = readFileSync(idx, 'utf8').match(/data-updated>([^<]+)</); if (m && m[1] !== fmtIL(sd.updated) && Date.now() - sd.built < 3600e3) w.push(`dist header shows ${m[1]}, expected ${fmtIL(sd.updated)} – rebuild`); }
  return w;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const L = (p, f) => (existsSync(join(root0, p)) ? JSON.parse(readFileSync(join(root0, p), 'utf8')) : f);
  const data = L('data/data.json', {}); const sd = siteDates({ root: root0, data, creatives: L('data/creatives.json', {}), top10: L('data/top10.json', {}) });
  console.log(`updated ${fmtIL(sd.updated)} (from ${sd.updatedSrc}); stamps: ${sd.stamps.length}`);
  const w = checkDates({ data, sd }); w.forEach((x) => console.log('! ' + x)); if (!w.length) console.log('dates OK');
  if (process.argv.includes('--strict') && w.length) process.exit(1);
}
