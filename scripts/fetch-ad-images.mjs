// Recover missing creative images from the PUBLIC ad libraries and store them in the repo (never hotlink).
//   node scripts/fetch-ad-images.mjs [--source meta|google] [--limit N]
// Meta: facebook.com/ads/library/?id=<id> – reads the ad snapshot (original_image_url / video_preview_image_url)
//       and downloads it right away (the fbcdn URL is signed and expires within days).
// Google: adstransparency.google.com creative page – screenshots the rendered creative.
// Writes public/creatives/<source>/<slug>.webp and updates data/creatives.json + data/top10.json.
// Needs Playwright locally (npm i --no-save playwright && npx playwright install chromium); not used at build time.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const ONLY = opt('--source'); const LIMIT = Number(opt('--limit') || 1e9);
const CACHE = join(root, '.cache/ad-images'); mkdirSync(CACHE, { recursive: true });
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const FMT = { VIDEO: 'video', IMAGE: 'image', CAROUSEL: 'carousel', DCO: 'image', DPA: 'carousel' };

const cpath = join(root, 'data/creatives.json');
const data = JSON.parse(readFileSync(cpath, 'utf8'));
const todo = data.items.filter((i) => !i.image && i.library_id && ['meta', 'google'].includes(i.source) && (!ONLY || i.source === ONLY))
  .sort((a, b) => (b.days_active ?? -1) - (a.days_active ?? -1)).slice(0, LIMIT);
console.log(`missing images: ${todo.length}`);
if (!todo.length) process.exit(0);

let chromium; try { ({ chromium } = await import('playwright')); } catch { console.error('playwright not installed – see header'); process.exit(2); }
const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'en-US', viewport: { width: 1280, height: 1400 }, deviceScaleFactor: 1.5 });
const un = (s) => s.replace(/\\\//g, '/').replace(/\\u0025/g, '%').replace(/\\u0026/g, '&');

async function meta(it) {
  const id = it.library_id, out = join(CACHE, `meta-${id}.jpg`);
  if (existsSync(out)) return { file: out };
  const p = await ctx.newPage(); const blobs = [];
  p.on('response', async (r) => { try { const t = await r.text(); if (t.includes(id) && t.includes('display_format')) blobs.push(t); } catch {} });
  try {
    await p.goto(`https://www.facebook.com/ads/library/?id=${id}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    for (let k = 0; k < 12 && !blobs.length; k++) await p.waitForTimeout(1000);
    const all = blobs.join('\n'); let i = all.indexOf(`"ad_archive_id":"${id}"`); if (i < 0) i = all.indexOf(id);
    let seg = all.slice(i, i + 60000); if (!/(original_image_url|video_preview_image_url)":"https/.test(seg)) seg = all.slice(Math.max(0, i - 60000), i + 60000);
    const g = (k) => { const m = seg.match(new RegExp(`"${k}":"(https:[^"]+)"`)); return m ? un(m[1]) : null; };
    const url = g('original_image_url') || g('video_preview_image_url') || g('resized_image_url');
    const fmt = FMT[(seg.match(/"display_format":"(\w+)"/) || [])[1]] || null;
    if (!url) return { err: blobs.length ? 'snapshot has no media url' : 'no snapshot data (blocked / removed ad?)' };
    const r = await ctx.request.get(url); if (!r.ok()) return { err: `download ${r.status()}` };
    writeFileSync(out, await r.body()); return { file: out, fmt };
  } catch (e) { return { err: String(e.message).slice(0, 120) }; } finally { await p.close(); }
}
async function google(it) {
  const out = join(CACHE, `google-${it.library_id}.png`);
  if (existsSync(out)) return { file: out };
  if (!it.library_url) return { err: 'no library_url' };
  const p = await ctx.newPage();
  try {
    await p.goto(it.library_url, { waitUntil: 'domcontentloaded', timeout: 45000 }); await p.waitForFunction(() => [...document.querySelectorAll('creative')].some((e) => { const r = e.getBoundingClientRect(); return r.width > 60 && r.height > 40; }), null, { timeout: 25000 }).catch(() => {}); await p.waitForTimeout(2500);
    const clip = await p.evaluate(() => { for (const e of document.querySelectorAll('creative .creative-container, creative')) { const r = e.getBoundingClientRect(); if (r.width > 60 && r.height > 40 && r.x > 0 && r.x + r.width < 1280) return { x: r.x, y: r.y, width: r.width, height: r.height }; } return null; });
    if (!clip) return { err: 'no visible creative (removed / region-limited?)' };
    await p.screenshot({ path: out, clip }); return { file: out };
  } catch (e) { return { err: String(e.message).slice(0, 120) }; } finally { await p.close(); }
}

const res = {}; const q = [...todo];
await Promise.all(Array.from({ length: 4 }, async () => { while (q.length) { const it = q.shift(); res[it.id] = await (it.source === 'meta' ? meta(it) : google(it)); } }));
await b.close();

let fixed = 0; const fails = [];
for (const it of todo) {
  const r = res[it.id];
  if (!r?.file) { fails.push(`${it.id}\t${it.library_url}\t${r?.err}`); continue; }
  const rel = `creatives/${it.source}/${slug(it.library_id)}.webp`;
  const c = spawnSync('python3', [join(root, 'scripts/img_compress.py'), r.file, join(root, 'public', rel), '900', '150']);
  if (c.status !== 0) { fails.push(`${it.id}\t${it.library_url}\tdownload was not a valid image (deleted from cache, rerun)`); spawnSync('rm', ['-f', r.file]); continue; }
  it.image = rel; it.imageMissing = false; it.image_source = it.source === 'meta' ? 'meta-ad-library' : 'google-ads-transparency';
  if (r.fmt && (!it.format || it.format === 'unknown')) it.format = r.fmt;
  fixed++;
}
writeFileSync(cpath, JSON.stringify(data, null, 1) + '\n');
// keep Top 10 snapshots in sync (images only; ranking is not recomputed)
const tpath = join(root, 'data/top10.json');
if (existsSync(tpath)) {
  const byId = new Map(data.items.map((i) => [i.id, i])); const t = JSON.parse(readFileSync(tpath, 'utf8'));
  for (const w of Object.values(t.weeks || {})) for (const arr of [w.items, w.niche, ...(w.strips || []).map((s) => s.items)]) for (const x of arr || []) { const s = byId.get(x.id); if (s?.image && !x.image) { x.image = s.image; x.imageMissing = false; if (x.format === 'unknown') x.format = s.format; } }
  writeFileSync(tpath, JSON.stringify(t, null, 1) + '\n');
}
writeFileSync(join(root, 'data/missing-images.tsv'), 'id\tlibrary_url\treason\n' + fails.join('\n') + (fails.length ? '\n' : ''));
console.log(`fixed ${fixed}, still missing ${fails.length} (data/missing-images.tsv)`);
