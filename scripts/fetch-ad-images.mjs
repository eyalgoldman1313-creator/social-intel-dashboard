// Recover missing creative images from the PUBLIC ad libraries and store them in the repo (never hotlink).
//   node scripts/fetch-ad-images.mjs [--source meta|google] [--limit N] [--ids id1,id2 | --ids-file F]
//                                    [--batch N] [--include-blank] [--concurrency N]
// Meta: facebook.com/ads/library/?id=<id> – reads the ad snapshot (original_image_url / video_preview_image_url)
//       and downloads it right away (the fbcdn URL is signed and expires within days).
// Google: adstransparency.google.com creative page – screenshots the rendered creative.
// Writes public/creatives/<source>/<slug>.webp and updates data/creatives.json + data/top10.json.
// Progress is saved every --batch items (default 25) with atomic writes, and on SIGINT/SIGTERM, so an
// interrupted run keeps what it recovered; re-running skips items that already have a usable image.
// A local image under 1KB or ≤ 40px tall is treated as missing (same as no image). --include-blank is
// accepted and is the default. A blank file in the download cache is deleted and never reused.
// A recovered image is display-only: it does not change Top 10 rank (days, then variants).
// Needs Playwright locally (npm i --no-save playwright && npx playwright install chromium); not used at build time.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { blankReason } = await import(pathToFileURL(join(root, 'scripts/check-images.mjs')).href);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const FMT = { VIDEO: 'video', IMAGE: 'image', CAROUSEL: 'carousel', DCO: 'image', DPA: 'carousel' };

export function atomicWriteJson(path, obj) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(obj, null, 1) + '\n');
  renameSync(tmp, path); // same directory → atomic on POSIX
}

// A file that exists and is under 1KB or ≤ 40px tall. A missing path is not "blank" — the caller
// treats a missing file as a missing image separately.
export function isBlankFile(file) {
  return !!file && existsSync(file) && !!blankReason(file);
}

export function dropBlankCache(file) {
  if (!isBlankFile(file)) return false;
  rmSync(file, { force: true });
  return true;
}

// Local repo path for a card image. Remote URLs are not files. A leading slash is stripped so
// join() does not discard publicDir (POSIX join('/pub', '/creatives/a.webp') === '/creatives/a.webp').
export function localImageFile(publicDir, image) {
  if (!image || /^https?:/i.test(image) || /^\/\//.test(image)) return null;
  const rel = String(image).replace(/^\/+/, '');
  if (!rel || rel.split('/').includes('..')) return null;
  return join(publicDir, rel);
}

// True when the card should be fetched: no image, a remote URL is left alone, a missing local
// file is missing, and a blank local file is missing too (unless includeBlank is turned off).
export function imageNeedsFetch(it, publicDir, { includeBlank = true } = {}) {
  if (!it || !it.image) return true;
  if (/^https?:/i.test(it.image) || /^\/\//.test(it.image)) return false;
  const file = localImageFile(publicDir, it.image);
  if (!file || !existsSync(file)) return true;
  return includeBlank && isBlankFile(file);
}

export function selectTodo(items, { only = null, ids = null, includeBlank = true, limit = Infinity, publicDir = join(root, 'public') } = {}) {
  const want = ids ? new Set(ids) : null;
  const capped = Number.isFinite(limit) ? limit : Infinity;
  return (items || [])
    .filter((i) => i && i.library_id && ['meta', 'google'].includes(i.source) && (!only || i.source === only) && (!want || want.has(i.id)))
    .filter((i) => imageNeedsFetch(i, publicDir, { includeBlank }))
    .sort((a, b) => (b.days_active ?? -1) - (a.days_active ?? -1))
    .slice(0, capped);
}

function optOf(argv, name) {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  const v = argv[i + 1];
  if (v == null || String(v).startsWith('--')) return null;
  return v;
}
function numOpt(argv, name, fallback, min) {
  const raw = optOf(argv, name);
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(min, n) : fallback;
}
// --include-blank is accepted. Blanks are already included: a blank image is a missing image.
export function cliOptions(argv) {
  return {
    only: optOf(argv, '--source'),
    limit: numOpt(argv, '--limit', Infinity, 0),
    batch: numOpt(argv, '--batch', 25, 1),
    concurrency: numOpt(argv, '--concurrency', 4, 1),
    includeBlank: true,
    ids: optOf(argv, '--ids') ? optOf(argv, '--ids').split(',').map((s) => s.trim()).filter(Boolean) : null,
  };
}
export function idsFromFile(argv, read = readFileSync) {
  const inline = optOf(argv, '--ids');
  if (inline) return inline.split(',').map((s) => s.trim()).filter(Boolean);
  const file = optOf(argv, '--ids-file');
  if (!file) return null;
  return read(file, 'utf8').split(/\s+/).filter(Boolean);
}

// Copy recovered images into every stored Top 10 week (display only, no re-rank).
// `touched` limits the walk to this run. A touched card whose image was rejected is cleared
// so a deleted blank is not left behind in the snapshot.
export function syncTop10(t, items, { touched = null } = {}) {
  const byId = new Map((items || []).map((i) => [i.id, i]));
  for (const w of Object.values(t?.weeks || {})) {
    for (const arr of [w.items, w.niche, ...(w.strips || []).map((s) => s.items)]) {
      for (const x of arr || []) {
        if (touched && !touched.has(x.id)) continue;
        const s = byId.get(x.id);
        if (!s) continue;
        if (s.image && x.image !== s.image) {
          x.image = s.image;
          x.imageMissing = false;
          if (x.format === 'unknown') x.format = s.format;
        } else if (touched && !s.image && s.imageMissing && x.image) {
          x.image = null;
          x.imageMissing = true;
        }
      }
    }
  }
  return t;
}

export function mergeMissingTsv(prevText, { items, attempted, fails }) {
  const still = new Set((items || []).filter((i) => !i.image).map((i) => i.id));
  const done = attempted || new Set();
  const keep = String(prevText || '').split('\n').slice(1).filter((l) => l && !done.has(l.split('\t')[0]) && still.has(l.split('\t')[0]));
  const rows = [...keep, ...(fails || [])];
  return 'id\tlibrary_url\treason\n' + rows.join('\n') + (rows.length ? '\n' : '');
}

// What to do with a compressed file. Blank output is not stored.
export function assignRecovered(it, { rel, fmt = null, blank = '', compressStatus = 0 } = {}) {
  if (compressStatus !== 0) return { ok: false, reason: 'invalid' };
  if (blank) {
    if (it.image === rel) { it.image = null; it.imageMissing = true; delete it.image_source; }
    return { ok: false, reason: 'blank' };
  }
  it.image = rel;
  it.imageMissing = false;
  it.image_source = it.source === 'meta' ? 'meta-ad-library' : 'google-ads-transparency';
  if (fmt && (!it.format || it.format === 'unknown')) it.format = fmt;
  return { ok: true };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = cliOptions(args);
  const ids = idsFromFile(args);
  const CACHE = join(root, '.cache/ad-images');
  mkdirSync(CACHE, { recursive: true });
  const cpath = join(root, 'data/creatives.json');
  const tpath = join(root, 'data/top10.json');
  const tsv = join(root, 'data/missing-images.tsv');
  const data = JSON.parse(readFileSync(cpath, 'utf8'));
  const todo = selectTodo(data.items, { only: opt.only, ids, includeBlank: opt.includeBlank, limit: opt.limit });
  console.log(`to fetch: ${todo.length}`);
  if (!todo.length) return;

  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { console.error('playwright not installed – see header'); process.exit(2); }
  const b = await chromium.launch();
  const ctx = await b.newContext({ locale: 'en-US', viewport: { width: 1280, height: 1400 }, deviceScaleFactor: 1.5 });
  const un = (s) => s.replace(/\\\//g, '/').replace(/\\u0025/g, '%').replace(/\\u0026/g, '&');

  async function meta(it) {
    const id = it.library_id;
    const out = join(CACHE, `meta-${id}.jpg`);
    if (dropBlankCache(out)) { /* blank cache is not a hit */ }
    if (existsSync(out)) return { file: out };
    const p = await ctx.newPage();
    const blobs = [];
    p.on('response', async (r) => { try { const t = await r.text(); if (t.includes(id) && t.includes('display_format')) blobs.push(t); } catch { /* ignore body read errors */ } });
    try {
      await p.goto(`https://www.facebook.com/ads/library/?id=${id}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      for (let k = 0; k < 12 && !blobs.length; k++) await p.waitForTimeout(1000);
      const all = blobs.join('\n');
      let i = all.indexOf(`"ad_archive_id":"${id}"`);
      if (i < 0) i = all.indexOf(id);
      let seg = all.slice(i, i + 60000);
      if (!/(original_image_url|video_preview_image_url)":"https/.test(seg)) seg = all.slice(Math.max(0, i - 60000), i + 60000);
      const g = (k) => { const m = seg.match(new RegExp(`"${k}":"(https:[^"]+)"`)); return m ? un(m[1]) : null; };
      const url = g('original_image_url') || g('video_preview_image_url') || g('resized_image_url');
      const fmt = FMT[(seg.match(/"display_format":"(\w+)"/) || [])[1]] || null;
      if (!url) return { err: blobs.length ? 'snapshot has no media url' : 'no snapshot data (blocked / removed ad?)' };
      const r = await ctx.request.get(url);
      if (!r.ok()) return { err: `download ${r.status()}` };
      writeFileSync(out, await r.body());
      if (dropBlankCache(out)) return { err: 'blank image (download under 1KB or ≤ 40px tall)' };
      return { file: out, fmt };
    } catch (e) { return { err: String(e.message).slice(0, 120) }; }
    finally { await p.close(); }
  }
  async function google(it) {
    const out = join(CACHE, `google-${it.library_id}.png`);
    if (dropBlankCache(out)) { /* blank cache is not a hit */ }
    if (existsSync(out)) return { file: out };
    if (!it.library_url) return { err: 'no library_url' };
    const p = await ctx.newPage();
    try {
      await p.goto(it.library_url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForFunction(() => [...document.querySelectorAll('creative')].some((e) => { const r = e.getBoundingClientRect(); return r.width > 60 && r.height > 40; }), null, { timeout: 25000 }).catch(() => {});
      await p.waitForTimeout(2500);
      const clip = await p.evaluate(() => {
        for (const e of document.querySelectorAll('creative .creative-container, creative')) {
          const r = e.getBoundingClientRect();
          if (r.width > 60 && r.height > 40 && r.x > 0 && r.x + r.width < 1280) return { x: r.x, y: r.y, width: r.width, height: r.height };
        }
        return null;
      });
      if (!clip) return { err: 'no visible creative (removed / region-limited?)' };
      await p.screenshot({ path: out, clip });
      if (dropBlankCache(out)) return { err: 'blank image (screenshot under 1KB or ≤ 40px tall)' };
      return { file: out };
    } catch (e) { return { err: String(e.message).slice(0, 120) }; }
    finally { await p.close(); }
  }

  let fixed = 0;
  let pending = 0;
  const fails = [];
  const attempted = new Set();
  const save = () => {
    atomicWriteJson(cpath, data);
    if (existsSync(tpath)) atomicWriteJson(tpath, syncTop10(JSON.parse(readFileSync(tpath, 'utf8')), data.items, { touched: attempted }));
    const text = mergeMissingTsv(existsSync(tsv) ? readFileSync(tsv, 'utf8') : '', { items: data.items, attempted, fails });
    const tmp = `${tsv}.tmp-${process.pid}`;
    writeFileSync(tmp, text);
    renameSync(tmp, tsv);
    pending = 0;
    console.log(`saved: ${fixed} fixed, ${fails.length} failed, ${attempted.size}/${todo.length} done`);
  };
  let stopping = false;
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, () => {
      stopping = true;
      console.log(`${sig}: saving progress…`);
      save();
    });
  }

  const apply = (it, r) => {
    attempted.add(it.id);
    if (!r?.file) { fails.push(`${it.id}\t${it.library_url}\t${r?.err || 'no file'}`); return; }
    const rel = `creatives/${it.source}/${slug(it.library_id)}.webp`;
    const out = join(root, 'public', rel);
    const c = spawnSync('python3', [join(root, 'scripts/img_compress.py'), r.file, out, '900', '150']);
    const blank = c.status === 0 ? blankReason(out) : '';
    const decision = assignRecovered(it, { rel, fmt: r.fmt, blank, compressStatus: c.status });
    if (!decision.ok && decision.reason === 'invalid') {
      fails.push(`${it.id}\t${it.library_url}\tdownload was not a valid image (deleted from cache, rerun)`);
      rmSync(r.file, { force: true });
      return;
    }
    if (!decision.ok) {
      fails.push(`${it.id}\t${it.library_url}\tblank image (${blank}) – not stored`);
      rmSync(r.file, { force: true });
      rmSync(out, { force: true });
      return;
    }
    fixed++;
  };
  const q = [...todo];
  try {
    await Promise.all(Array.from({ length: opt.concurrency }, async () => {
      while (q.length && !stopping) {
        const it = q.shift();
        if (!it) break;
        apply(it, await (it.source === 'meta' ? meta(it) : google(it)));
        if (++pending >= opt.batch) save();
      }
    }));
  } finally {
    await b.close().catch(() => {});
    save();
  }
  console.log(`fixed ${fixed}, still missing ${fails.length} of this run (data/missing-images.tsv)${stopping ? ' – interrupted, re-run to continue' : ''}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
