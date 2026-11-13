// Recover missing creative images from the PUBLIC ad libraries and store them in the repo (never hotlink).
//   node scripts/fetch-ad-images.mjs [--source meta|google] [--limit N] [--scroll N]
//                                    [--storage-state FILE]
// Meta: group missing cards by brand and open
//   facebook.com/ads/library/?view_all_page_id=<page id>  (most recent, active and all).
//   Sniff network bodies for "ad_archive_id":"<id>" plus original_image_url /
//   video_preview_image_url (video ads prefer the preview frame). Every wanted id for
//   that brand is matched in one pass. Page ids live in data/meta-page-ids.json.
//   ?id=<library id> is only a fallback: Facebook now loads the advertiser feed there
//   and the id appears as deeplinkAdID, so that URL alone reports "snapshot has no media url".
//   An anonymous session stops around 30 cards per load. A logged-in Playwright
//   storageState (META_STORAGE_STATE or --storage-state) can paginate further.
//   Never commit that file.
// Google: adstransparency.google.com creative page – screenshots the rendered creative.
// Writes public/creatives/<source>/<slug>.webp and updates data/creatives.json + data/top10.json.
// Downloads are compressed, blank frames are rejected, and creatives/top10/the failure
// list are saved atomically so a re-run resumes from cards that already have a real image.
// A recovered image is display-only: it does not change Top 10 rank (days, then variants).
// Needs Playwright locally (npm i --no-save playwright && npx playwright install chromium); not used at build time.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { blankReason } from './check-images.mjs';
import {
  ANON_CARD_CAP, REASON, absorbArchiveBody, atomicWriteJson, browseUrls, bucketByBrand,
  groupMetaByBrand, idFallbackDecision, idLibraryUrl, loadPageMap, mergeMissingTsv, storageStateOption,
} from './meta-page-harvest.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const BATCH_SAVE = 20;
const SCROLL_DEFAULT = 60;

function opt(argv, name) {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  const v = argv[i + 1];
  if (v == null || String(v).startsWith('--')) return null;
  return v;
}

async function main() {
  const args = process.argv.slice(2);
  const ONLY = opt(args, '--source');
  const LIMIT = Number(opt(args, '--limit') || 1e9);
  const SCROLL_CAP = Number(opt(args, '--scroll') || SCROLL_DEFAULT);
  const statePath = storageStateOption(args, process.env);
  const CACHE = join(root, '.cache/ad-images');
  mkdirSync(CACHE, { recursive: true });

  const cpath = join(root, 'data/creatives.json');
  const tpath = join(root, 'data/top10.json');
  const tsv = join(root, 'data/missing-images.tsv');
  const data = JSON.parse(readFileSync(cpath, 'utf8'));
  const todo = data.items.filter((i) => !i.image && i.library_id && ['meta', 'google'].includes(i.source) && (!ONLY || i.source === ONLY))
    .sort((a, b) => (b.days_active ?? -1) - (a.days_active ?? -1)).slice(0, LIMIT);
  console.log(`missing images: ${todo.length}`);
  if (!todo.length) return;

  let pageMap = {};
  try { pageMap = loadPageMap(JSON.parse(readFileSync(join(root, 'data/meta-page-ids.json'), 'utf8'))); }
  catch (e) { console.warn(`meta page ids: ${String(e.message).slice(0, 160)}`); }
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { console.error('playwright not installed – see header'); process.exit(2); }

  let storageState = null;
  if (statePath) {
    if (existsSync(statePath)) {
      storageState = statePath;
      console.log('Meta: using logged-in storage state (Playwright reads it locally; this script does not copy or commit it)');
    } else console.warn(`Meta: storage state not found; continuing anonymous (~${ANON_CARD_CAP} cards per page)`);
  } else if (!ONLY || ONLY === 'meta') {
    console.log(`Meta: anonymous session, about ${ANON_CARD_CAP} cards per page. Set META_STORAGE_STATE or --storage-state <file> to paginate further.`);
  }

  const b = await chromium.launch();
  const ctx = await b.newContext({
    locale: 'en-US', viewport: { width: 1280, height: 1400 }, deviceScaleFactor: 1.5,
    ...(storageState ? { storageState } : {}),
  });

  let fixed = 0;
  let sinceSave = 0;
  const fails = [];
  const attempted = new Set();
  let stop = false;

  function saveProgress() {
    atomicWriteJson(cpath, data);
    if (existsSync(tpath)) {
      const t = JSON.parse(readFileSync(tpath, 'utf8'));
      const byId = new Map(data.items.map((i) => [i.id, i]));
      for (const w of Object.values(t.weeks || {})) {
        for (const arr of [w.items, w.niche, ...(w.strips || []).map((s) => s.items)]) {
          for (const x of arr || []) {
            const s = byId.get(x.id);
            if (s?.image && !x.image) {
              x.image = s.image;
              x.imageMissing = false;
              delete x.imageMissingReason;
              if (x.format === 'unknown') x.format = s.format;
            }
          }
        }
      }
      atomicWriteJson(tpath, t);
    }
    const still = new Set(data.items.filter((i) => !i.image).map((i) => i.id));
    const prev = existsSync(tsv) ? readFileSync(tsv, 'utf8') : '';
    const text = mergeMissingTsv(prev, { stillIds: still, attempted, fails });
    const tmp = `${tsv}.tmp-${process.pid}`;
    writeFileSync(tmp, text);
    renameSync(tmp, tsv);
    sinceSave = 0;
    console.log(`saved: ${fixed} fixed, ${fails.length} failed, ${attempted.size} attempted`);
  }
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, () => { stop = true; console.log(`${sig}: saving progress…`); saveProgress(); });
  }

  function dropBlank(file) {
    if (file && existsSync(file) && blankReason(file)) { rmSync(file, { force: true }); return true; }
    return false;
  }
  function note(ok) {
    if (!ok) return;
    if (++sinceSave >= BATCH_SAVE) saveProgress();
  }
  function applyFile(it, r) {
    attempted.add(it.id);
    if (!r?.file) { fails.push(`${it.id}\t${it.library_url || ''}\t${r?.err || 'no file'}`); return false; }
    const rel = `creatives/${it.source}/${slug(it.library_id)}.webp`;
    const dest = join(root, 'public', rel);
    mkdirSync(dirname(dest), { recursive: true });
    const c = spawnSync('python3', [join(root, 'scripts/img_compress.py'), r.file, dest, '900', '150']);
    if (c.status !== 0) {
      fails.push(`${it.id}\t${it.library_url || ''}\tdownload was not a valid image (deleted from cache, rerun)`);
      rmSync(r.file, { force: true });
      return false;
    }
    const blank = blankReason(dest);
    if (blank) {
      fails.push(`${it.id}\t${it.library_url || ''}\tblank image (${blank}) – not stored`);
      rmSync(dest, { force: true });
      rmSync(r.file, { force: true });
      return false;
    }
    it.image = rel;
    it.imageMissing = false;
    delete it.imageMissingReason;
    it.image_source = it.source === 'meta' ? 'meta-ad-library' : 'google-ads-transparency';
    if (r.fmt && (!it.format || it.format === 'unknown')) it.format = r.fmt;
    fixed++;
    return true;
  }
  async function downloadMeta(it, mediaUrl) {
    const out = join(CACHE, `meta-${it.library_id}.jpg`);
    if (dropBlank(out)) { /* blank cache is not a hit */ }
    if (existsSync(out)) return { file: out };
    try {
      const r = await ctx.request.get(mediaUrl, { timeout: 30000 });
      if (!r.ok()) return { err: `download ${r.status()}` };
      writeFileSync(out, await r.body());
      if (dropBlank(out)) return { err: 'blank image (download under 1KB or ≤ 40px tall)' };
      return { file: out };
    } catch (e) { return { err: String(e.message).slice(0, 120) }; }
  }

  async function harvestGroup(group) {
    const pending = group.items.filter((it) => it && !it.image && it.library_id);
    if (!pending.length || stop) return;
    const want = new Set(pending.map((it) => String(it.library_id)));
    const byLid = new Map(pending.map((it) => [String(it.library_id), it]));
    const found = new Map();
    const drained = new Set();
    let archiveBodies = 0;
    console.log(`\n=== ${group.brand || '(no brand)'} pages ${(group.pageIds || []).join(',') || '—'} : want ${want.size} ===`);

    const drain = async () => {
      for (const [id, hit] of [...found]) {
        if (stop) return;
        const it = byLid.get(id);
        if (!it || it.image || drained.has(id)) continue;
        drained.add(id);
        const got = await downloadMeta(it, hit.url);
        note(applyFile(it, { ...got, fmt: hit.fmt || null }));
      }
    };

    const p = await ctx.newPage();
    p.on('response', async (r) => {
      try {
        const t = await r.text();
        if (t.includes('ad_archive_id')) archiveBodies++;
        absorbArchiveBody(t, want, found);
      } catch { /* body already consumed, or not text */ }
    });
    try {
      for (const pageId of group.pageIds || []) {
        if (found.size >= want.size || stop) break;
        for (const url of browseUrls(pageId)) {
          if (found.size >= want.size || stop) break;
          try {
            await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await p.waitForTimeout(3500);
            let stable = 0;
            let last = found.size;
            for (let i = 0; i < SCROLL_CAP && found.size < want.size && stable < 6 && !stop; i++) {
              await p.mouse.wheel(0, 8000);
              await p.waitForTimeout(800);
              if (found.size === last) stable++;
              else { stable = 0; last = found.size; }
            }
            console.log(`  ${url.includes('relevancy_monthly_grouped') ? 'recent' : 'default'} ${url.includes('active_status=active') ? 'active' : 'all'}: found ${found.size}/${want.size}`);
          } catch (e) { console.warn(`  browse failed: ${String(e.message).slice(0, 120)}`); }
        }
      }
      if (!storageState && found.size < want.size && (group.pageIds || []).length) {
        console.log(`  anonymous cap ~${ANON_CARD_CAP} cards per load; remaining ids need a logged-in storage state or were not in this page`);
      }
      await drain();

      let misses = 0;
      for (const it of pending) {
        if (stop || it.image) continue;
        const id = String(it.library_id);
        if (found.has(id)) { await drain(); continue; }
        if (!(group.pageIds || []).length && misses === 0) console.log(`  no page id for ${group.brand}; ?id= fallback only`);
        if (idFallbackDecision(misses) !== 'try') {
          attempted.add(it.id);
          fails.push(`${it.id}\t${it.library_url || ''}\t${(group.pageIds || []).length ? REASON.notInBrowse : REASON.noPage}`);
          continue;
        }
        const before = archiveBodies;
        try {
          await p.goto(idLibraryUrl(id), { waitUntil: 'domcontentloaded', timeout: 60000 });
          for (let k = 0; k < 12 && !found.has(id) && !stop; k++) await p.waitForTimeout(1000);
        } catch (e) {
          misses++;
          attempted.add(it.id);
          fails.push(`${it.id}\t${it.library_url || ''}\t${String(e.message).slice(0, 120)}`);
          continue;
        }
        if (found.has(id)) { misses = 0; await drain(); continue; }
        misses++;
        attempted.add(it.id);
        fails.push(`${it.id}\t${it.library_url || ''}\t${archiveBodies > before ? REASON.noMedia : REASON.noSnapshot}`);
      }
      await drain();
    } finally { await p.close().catch(() => {}); }
    saveProgress();
  }

  async function google(it) {
    const out = join(CACHE, `google-${it.library_id}.png`);
    if (dropBlank(out)) { /* blank cache is not a hit */ }
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
      if (dropBlank(out)) return { err: 'blank image (screenshot under 1KB or ≤ 40px tall)' };
      return { file: out };
    } catch (e) { return { err: String(e.message).slice(0, 120) }; }
    finally { await p.close(); }
  }

  try {
    const metaTodo = todo.filter((i) => i.source === 'meta');
    const googleTodo = todo.filter((i) => i.source === 'google');
    if (metaTodo.length) {
      const { groups, unmapped } = groupMetaByBrand(metaTodo, pageMap);
      for (const group of [...groups, ...bucketByBrand(unmapped)]) {
        if (stop) break;
        await harvestGroup(group);
      }
    }
    const q = [...googleTodo];
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (q.length && !stop) {
        const it = q.shift();
        if (!it) break;
        note(applyFile(it, await google(it)));
      }
    }));
  } finally {
    await b.close().catch(() => {});
    saveProgress();
  }
  console.log(`fixed ${fixed}, still missing ${fails.length} (data/missing-images.tsv)${stop ? ' – interrupted, re-run to continue' : ''}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
