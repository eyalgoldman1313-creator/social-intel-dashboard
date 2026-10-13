// "Pending" wording check: warns when the dashboard says a platform is בהמתנה / בהמשך / not connected / not analysed
// although the data for it actually exists (creatives.json posts, brandStats, limitations).
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLAT = {
  instagram: { re: /אינסטגרם|Instagram|\bIG\b/, has: (c, s) => c.filter((i) => i.plat === 'instagram').length + Object.values(s.organic?.brandStats || {}).filter((b) => b.igFollowers).length },
  facebook: { re: /פייסבוק|Facebook/, has: (c, s) => c.filter((i) => i.plat === 'facebook').length + Object.values(s.organic?.brandStats || {}).filter((b) => b.fbFollowers).length },
  tiktok: { re: /טיקטוק|TikTok/, has: (c) => c.filter((i) => i.source === 'tiktok').length },
  youtube: { re: /יוטיוב|YouTube/, has: (c) => c.filter((i) => i.plat === 'youtube').length },
};
const PENDING = /בהמתנה|ממתין לסריקה|בהמשך|ההתחברות לא הושלמה|התחברות לא הושלמה|טרם נותח|עדיין לא (?:נותח|בוצע)|לא נותח/;
export function checkPending({ html = existsSync(join(root, 'dist/index.html')) ? readFileSync(join(root, 'dist/index.html'), 'utf8') : '' } = {}) {
  const c = JSON.parse(readFileSync(join(root, 'data/creatives.json'), 'utf8')).items;
  const d = JSON.parse(readFileSync(join(root, 'data/data.json'), 'utf8')); const s = d.scans[d.scans.length - 1];
  const warns = [];
  for (const l of s.limitations || []) if (/בהמשך|בהמתנה/.test(l.status) && PLAT[l.platform]?.has(c, s)) warns.push(`limitations[${l.platform}].status="${l.status}" but ${PLAT[l.platform].has(c, s)} data points exist`);
  // block-level scan of the built page: a pending word within 60 characters of a platform name
  const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<\/?(?:p|li|div|td|th|h\d|dd|dt|article|section|figcaption)\b[^>]*>/g, '\n').replace(/<[^>]+>/g, ' ');
  for (const block of text.split('\n')) {
    const m = block.match(PENDING); if (!m) continue;
    const win = block.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60);
    for (const [p, cfg] of Object.entries(PLAT)) if (cfg.re.test(win) && cfg.has(c, s)) warns.push(`page says pending for ${p} but data exists: "${win.replace(/\s+/g, ' ').trim()}"`);
  }
  return [...new Set(warns)];
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { const w = checkPending(); w.forEach((x) => console.log('! ' + x)); if (!w.length) console.log('pending wording OK'); }
