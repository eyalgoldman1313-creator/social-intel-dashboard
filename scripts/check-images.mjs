// Image health check for every card on every tab. Run by build.mjs; `--strict` exits 1 on any problem.
// Flags: (1) cards without an image, (2) remote/expiring image URLs (fbcdn, scontent, cdninstagram, tiktokcdn,
// googlesyndication, any http URL – these are signed and expire), (3) local paths whose file is missing.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export function checkImages(r = root) {
  const load = (p, f) => (existsSync(join(r, p)) ? JSON.parse(readFileSync(join(r, p), 'utf8')) : f);
  const cr = load('data/creatives.json', { items: [] }).items;
  const t = load('data/top10.json', { weeks: {} });
  const lw = Object.values(t.weeks || {}).sort((a, b) => a.key.localeCompare(b.key)).pop();
  const groups = { creatives: cr, top10: lw ? [...(lw.items || []), ...(lw.niche || []), ...(lw.strips || []).flatMap((s) => s.items)] : [] };
  const out = {};
  for (const [tab, arr] of Object.entries(groups)) {
    const o = { total: arr.length, missing: [], remote: [], broken: [] };
    for (const it of arr) {
      const img = it.image;
      if (!img) o.missing.push(it);
      else if (/^https?:|^\/\//i.test(img)) o.remote.push(it);
      else if (!existsSync(join(r, 'public', img))) o.broken.push(it);
    }
    out[tab] = o;
  }
  return out;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const res = checkImages(); let bad = 0;
  for (const [tab, o] of Object.entries(res)) {
    const bySrc = {}; for (const it of o.missing) bySrc[it.source] = (bySrc[it.source] || 0) + 1;
    console.log(`${tab}: ${o.total} cards · missing ${o.missing.length} ${JSON.stringify(bySrc)} · remote ${o.remote.length} · broken ${o.broken.length}`);
    for (const it of [...o.remote, ...o.broken]) console.log(`  ! ${it.id} ${it.image}`);
    if (process.argv.includes('-v')) for (const it of o.missing) console.log(`  - ${it.id} ${it.days_active ?? ''}d ${it.library_url || it.post_url || ''}`);
    bad += o.missing.length + o.remote.length + o.broken.length;
  }
  if (bad) console.log('fix: node scripts/fetch-ad-images.mjs  (recovers from Meta Ad Library / Google Ads Transparency into public/creatives)');
  if (process.argv.includes('--strict') && bad) process.exit(1);
}
