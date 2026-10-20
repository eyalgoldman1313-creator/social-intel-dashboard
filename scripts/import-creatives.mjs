// Import creative assets produced by the research bots into the dashboard.
//   node scripts/import-creatives.mjs [srcDir] [--asof YYYY-MM-DD]
// srcDir (default /workspace/social/creatives or $CREATIVES_SRC) holds meta/ tiktok/ organic/ , each with index.json
// Output (committed to git, consumed by scripts/build.mjs – no network or deps at build time):
//   public/creatives/<source>/<slug>.webp   (compressed, <= 150KB each)
//   data/creatives.json                      (normalized items)
//   data/top10.json                          (weekly snapshots keyed by ISO week; past weeks are kept)
// image_source and a known format are copied from the previous data/creatives.json (including alias merges).
// A run that does not read meta/index.json (organic-only) keeps Meta/Google items as they are and does not
// reorder the sponsored Top 10. Week 2026-W42 keeps the ranking it was given under the old image-first rule.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { rankTop10, nicheIds, entryReason } from './creatives.mjs';
const md5 = (s) => createHash('md5').update(s).digest('hex').slice(0, 8);

export const METHOD = 'דירוג לפי ותק הריצה (ימים פעילה) כמדד לביצועים, כי נתוני הוצאה/מעורבות אינם זמינים למודעות Meta בישראל. שוברי שוויון: מספר גרסאות/שכפולים. עד 2 קריאייטיבים לכל מותג, משפחה אחת נספרת פעם אחת. התמונה משמשת לתצוגה בלבד ואינה משפיעה על הדירוג. ותק הוא אינדיקציה, לא הוכחה לרווחיות.';
export const BASIS = 'ותק ריצה (ימים פעילה), אח״כ מספר גרסאות';
export const LEGACY_RANK_NOTE = 'הדירוג בשבוע זה חושב לפי הכלל הישן: קריאייטיב עם תמונה דורג לפני קריאייטיב בלי תמונה.';
const LEGACY_WEEKS = new Set(['2026-W42']);

// Previous creatives.json, keyed by id and by source:library_id. Alias ids fill gaps only.
export function prevIndex(items) {
  const by = new Map();
  const put = (k, p) => { if (k && !by.has(k)) by.set(k, p); };
  for (const p of items || []) {
    if (!p || typeof p !== 'object') continue;
    put(p.id, p);
    if (p.source && p.library_id) put(`${p.source}:${p.library_id}`, p);
  }
  for (const p of items || []) {
    if (!p || !p.source) continue;
    for (const a of p.alias_ids || []) put(`${p.source}:${a}`, p);
  }
  return by;
}
export function prevMatches(by, it) {
  if (!by || !it) return [];
  const hits = [];
  const push = (p) => { if (p && !hits.includes(p)) hits.push(p); };
  push(by.get(it.id));
  if (it.library_id) push(by.get(`${it.source}:${it.library_id}`));
  for (const a of it.alias_ids || []) push(by.get(`${it.source}:${a}`));
  return hits;
}
export function lookupPrev(by, it) {
  return prevMatches(by, it)[0] || null;
}
// Keep image_source (display provenance) and a known format. A fresh import has neither.
// `prev` may be one record or a list (the card itself, then alias rows).
export function carryForward(it, prev) {
  if (!it || !prev) return it;
  const list = Array.isArray(prev) ? prev : [prev];
  for (const row of list) {
    if (!row) continue;
    if (!it.image_source && row.image_source && it.image) it.image_source = row.image_source;
    if ((!it.format || it.format === 'unknown') && row.format && row.format !== 'unknown') it.format = row.format;
  }
  return it;
}
export function mergeAliases(items) {
  const merged = [];
  const alias = new Map();
  for (const it of items) for (const a of it.alias_ids || []) alias.set(`${it.source}:${a}`, it);
  for (let k = items.length - 1; k >= 0; k--) {
    const it = items[k];
    const main = alias.get(`${it.source}:${it.library_id}`);
    if (main && main !== it) {
      if (!main.image && it.image) { main.image = it.image; main.imageMissing = false; }
      if (!main.image_source && it.image_source && (main.image || it.image)) main.image_source = it.image_source;
      if ((!main.format || main.format === 'unknown') && it.format && it.format !== 'unknown') main.format = it.format;
      merged.push([it.library_id, main.library_id]);
      items.splice(k, 1);
    }
  }
  for (const it of items) if (!it.alias_ids?.length) delete it.alias_ids;
  return merged;
}
// Sources that were not in this run stay as stored, image_source included.
export function retainUnimported(items, prevItems, importedSources) {
  const ids = new Set(items.map((i) => i.id));
  for (const old of prevItems || []) {
    if (!old || importedSources.has(old.source) || ids.has(old.id)) continue;
    items.push(old);
    ids.add(old.id);
  }
  return items;
}
export function mergeImported(newItems, prevItems, importedSources) {
  const by = prevIndex(prevItems);
  for (const it of newItems) carryForward(it, prevMatches(by, it));
  mergeAliases(newItems);
  retainUnimported(newItems, prevItems, importedSources);
  return newItems;
}
// Rewrite sponsored Top 10 only when this run read Meta. Organic/TikTok refresh their own strips.
// 2026-W42 already ranked with the old image-first rule; leave that order in place and keep the note.
export function applyWeek(prevDoc, wk, { items, brands, imported, strips, now, prevCreatives }) {
  const doc = prevDoc && typeof prevDoc === 'object' ? prevDoc : {};
  if (!doc.weeks) doc.weeks = {};
  const weeks = doc.weeks;
  const had = weeks[wk.key];
  const existing = had ? structuredClone(had) : {
    key: wk.key, week: wk.week, start: wk.start, end: wk.end, asof: wk.asof, generatedAt: now,
    method: METHOD, basis: BASIS, items: [], niche: [], nicheBrands: nicheIds(brands), strips: [],
  };
  const legacy = LEGACY_WEEKS.has(wk.key) && (existing.items || []).length > 0;
  if (legacy) existing.note = existing.note || LEGACY_RANK_NOTE;
  const rankSponsored = imported.has('meta') && !legacy;
  if (rankSponsored) {
    const top = rankTop10(items);
    const niche = rankTop10(items, { brandIds: nicheIds(brands) });
    const priorKey = Object.keys(weeks).filter((k) => k < wk.key).sort().pop();
    const prior = priorKey ? weeks[priorKey] : null;
    const prevTopIds = new Set((prior?.items || []).map((i) => i.id));
    const by = prevIndex(prevCreatives || []);
    const entered = {};
    for (const it of top) {
      const reason = entryReason(it, { prevTopIds, prevItem: lookupPrev(by, it), weekStart: wk.start, weekEnd: wk.end });
      if (reason) entered[it.id] = reason;
    }
    existing.key = wk.key; existing.week = wk.week; existing.start = wk.start; existing.end = wk.end;
    existing.asof = wk.asof; existing.generatedAt = now;
    existing.method = METHOD; existing.basis = BASIS;
    existing.items = top; existing.niche = niche; existing.nicheBrands = nicheIds(brands);
    if (Object.keys(entered).length) existing.entered = entered;
    else delete existing.entered;
    existing.strips = (strips || []).filter((s) => s.items && s.items.length);
  } else {
    const stripList = [...(existing.strips || [])];
    const put = (s) => {
      if (!s || !s.items || !s.items.length) return;
      const i = stripList.findIndex((x) => x.key === s.key);
      if (i >= 0) stripList[i] = s; else stripList.push(s);
    };
    const list = strips || [];
    if (imported.has('tiktok')) put(list.find((s) => s.key === 'tiktok'));
    if (imported.has('organic')) put(list.find((s) => s.key === 'other'));
    existing.strips = stripList;
  }
  weeks[wk.key] = existing;
  return doc;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_KB = 150, MAX_W = 900;
const SOURCES = ['meta', 'tiktok', 'organic', 'google'];
let brands = [];

// ---------- helpers ----------
const jerusalemToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
const toDate = (s) => new Date(s + 'T00:00:00Z');
const iso = (d) => d.toISOString().slice(0, 10);
function normDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
function isoWeek(dateStr) {
  const d = toDate(dateStr); const day = (d.getUTCDay() + 6) % 7; // Mon=0
  const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - day);
  const thu = new Date(mon); thu.setUTCDate(mon.getUTCDate() + 3);
  const y = thu.getUTCFullYear(); const jan4 = new Date(Date.UTC(y, 0, 4)); const j = (jan4.getUTCDay() + 6) % 7;
  const w1 = new Date(jan4); w1.setUTCDate(jan4.getUTCDate() - j);
  const week = 1 + Math.round((mon - w1) / (7 * 86400000));
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
  return { key: `${y}-W${String(week).padStart(2, '0')}`, week, start: iso(mon), end: iso(sun) };
}
const FORMATS = { image: 'image', static: 'image', 'תמונה': 'image', photo: 'image', video: 'video', 'וידאו': 'video', 'סרטון': 'video', carousel: 'carousel', 'קרוסלה': 'carousel' };
const normFormat = (v) => FORMATS[String(v || '').trim().toLowerCase()] || FORMATS[String(v || '').trim()] || 'unknown';
function normStatus(v) {
  const s = String(v || '').trim().toLowerCase();
  if (['active', 'פעיל', 'פעילה', 'running'].includes(s)) return 'active';
  if (['inactive', 'לא פעיל', 'לא פעילה', 'stopped', 'paused', 'ended'].includes(s)) return 'inactive';
  return 'unknown';
}
const numOrNull = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
const str = (v) => (v == null ? '' : String(v).trim());
const ALIAS = { 'wonders-teva': 'wondersteva', 'gmila-luuf': 'trygmila', 'fill-it': 'fillit', fillitvitamins: 'fillit', 'fill-it': 'fillit', 'fill it': 'fillit', luuf: 'trygmila', tryluuf: 'trygmila', gmila: 'trygmila', 'gmila / luuf': 'trygmila', harmony: 'by-harmony', byharmony: 'by-harmony', smiley: 'try-smiley', trysmiley: 'try-smiley', woof: 'mywoof', wonders: 'wondersteva', 'wonders teva': 'wondersteva', trypups: 'pups' };
export function brandId(raw, brandList = brands) {
  const r0 = str(raw).toLowerCase(); const r = ALIAS[r0] || r0; if (!r) return '';
  const hit = brandList.find((b) => [b.id, b.name, b.heName, b.domain].filter(Boolean).some((x) => x.toLowerCase() === r || r.replace(/^www\./, '').startsWith(x.toLowerCase())));
  return hit ? hit.id : r;
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || createHash('md5').update(s).digest('hex').slice(0, 10);

function compress(inFile, outFile) {
  mkdirSync(dirname(outFile), { recursive: true });
  if (existsSync(outFile) && statSync(outFile).mtimeMs >= statSync(inFile).mtimeMs) return true; // already compressed
  const r = spawnSync('python3', [join(root, 'scripts/img_compress.py'), inFile, outFile, String(MAX_W), String(MAX_KB)], { encoding: 'utf8' });
  if (r.status === 0) return true;
  if (r.status === 3 && statSync(inFile).size <= MAX_KB * 1024 && /\.(jpe?g|png|webp)$/i.test(inFile)) { copyFileSync(inFile, outFile.replace(/\.webp$/, extname(inFile))); return 'copied'; }
  console.warn('  ! compress failed:', inFile, (r.stderr || '').split('\n').slice(-2).join(' '));
  return false;
}

function download(url, out) {
  mkdirSync(dirname(out), { recursive: true });
  const r = spawnSync('curl', ['-fsSL', '--max-time', '30', '-A', 'Mozilla/5.0', '-o', out, url]);
  return r.status === 0 && existsSync(out) && statSync(out).size > 1000;
}

function runImport() {
  const args = process.argv.slice(2);
  const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : null; };
  const asofArg = flag('--asof');
  const SRC = resolve(args[0] || process.env.CREATIVES_SRC || '/workspace/social/creatives');
  brands = JSON.parse(readFileSync(join(root, 'data/data.json'), 'utf8')).brands;
  const asof = asofArg || jerusalemToday();
  const prevPath = join(root, 'data/creatives.json');
  const prevDoc = existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, 'utf8')) : { items: [] };
  const prevItems = Array.isArray(prevDoc.items) ? prevDoc.items : [];
  const prevBy = prevIndex(prevItems);
  const imported = new Set();

// ---------- read + normalize ----------
const warnings = [];
const items = [];
for (const source of SOURCES) {
  const dir = join(SRC, source), idx = join(dir, 'index.json');
  if (!existsSync(idx)) { console.log(`- ${source}: no index.json (skipped)`); continue; }
  imported.add(source);
  let raw = JSON.parse(readFileSync(idx, 'utf8'));
  if (!Array.isArray(raw)) raw = raw.items || raw.creatives || raw.ads || raw.posts || [];
  let withImg = 0;
  raw.forEach((r, n) => {
    const libId = str(r.library_id ?? r.ad_id ?? r.post_id ?? r.id);
    const start = normDate(r.start_date ?? r.post_date);
    let days = numOrNull(r.days_active);
    const fname = libId ? slug(libId) : `${slug(str(r.brand_slug || r.brand))}-${md5(str(r.file ?? r.post_url ?? r.video_url ?? n))}`;
    const id = `${source}-${fname}`;
    const it = {
      id, source, brand: brandId(r.brand_slug || r.brand), brandRaw: str(r.brand), library_id: libId || null,
      platform: source === 'meta' ? (str(r.platform) === 'שניהם' ? 'Facebook + Instagram' : str(r.platform)) : (str(r.platform) || ({ tiktok: 'TikTok', organic: 'אורגני', google: 'Google' })[source]),
      plat: source === 'meta' ? 'meta' : (({ youtube: 'youtube', instagram: 'instagram', ig: 'instagram', facebook: 'facebook', fb: 'facebook', tiktok: 'tiktok' })[str(r.platform).toLowerCase()] || source),
      format: normFormat(r.format) !== 'unknown' ? normFormat(r.format) : (['tiktok', 'youtube'].includes(str(r.platform).toLowerCase()) || source === 'tiktok' ? 'video' : 'unknown'), start_date: normDate(r.start_date), post_date: normDate(r.post_date), days_active: days,
      status: normStatus(r.status), copy_text: str(r.copy_text), cta: str(r.cta), offer: str(r.offer), hook: str(r.hook),
      language: str(r.language), days_since_posted: numOrNull(r.days_since_posted),
      creative_notes: str(r.creative_notes), library_url: str(r.library_url) || (source === 'meta' && libId ? `https://www.facebook.com/ads/library/?id=${libId}` : ''),
      post_url: str(r.post_url ?? r.video_url ?? r.url), ctype: source === 'meta' || source === 'google' ? 'paid' : (({ 'אורגני': 'organic', organic: 'organic', 'יוצר': 'creator', creator: 'creator', ugc: 'creator', 'שיתוף': 'partnership', partnership: 'partnership', 'שיתוף פעולה': 'partnership' })[str(r.type).trim().toLowerCase()] || 'organic'), variants_count: numOrNull(r.variants_count), family: str(r.family),
      views: r.views ?? null, likes: r.likes ?? null, comments: r.comments ?? null, shares: r.shares ?? null, followers: r.followers ?? null,
      stage: str(r.stage) || null, days_since_start: numOrNull(r.days_since_start), multiple_versions: !!r.multiple_versions,
      copy_scope: str(r.copy_scope), copy_note: str(r.copy_note), copy_text_he: str(r.copy_text_he), copy_language: str(r.copy_language),
      landing_url: str(r.landing_url) ? (/^https?:\/\//i.test(str(r.landing_url)) ? str(r.landing_url) : 'https://' + str(r.landing_url)) : '',
      data_notes: str(r.data_notes), engagement: r.engagement ?? null,
      image: null, imageMissing: true,
      alias_ids: (Array.isArray(r.alias_ids) ? r.alias_ids : []).map(str).filter(Boolean),
    };
    const f = str(r.file ?? r.image);
    const remote = [r.image_url, r.thumbnail_url, r.video_preview_image_url, r.original_image_url, /^https?:/i.test(f) ? f : null].map(str).find((u) => /^https?:\/\//i.test(u));
    const kept = ['webp', 'jpg', 'jpeg', 'png'].map((e) => `creatives/${source}/${fname}.${e}`).find((x) => existsSync(join(root, 'public', x)));
    if (f && !/^https?:/i.test(f)) {
      const inFile = [resolve(dir, f), resolve(dir, str(r.brand_slug), f), resolve(dir, 'img', f)].find((x) => existsSync(x) && statSync(x).isFile()) || resolve(dir, f);
      if (existsSync(inFile) && /\.(png|jpe?g|webp|gif|avif)$/i.test(inFile)) {
        const out = join(root, 'public/creatives', source, `${fname}.webp`);
        const ok = compress(inFile, out);
        if (ok) { it.image = `creatives/${source}/${fname}.${ok === 'copied' ? extname(inFile).slice(1).toLowerCase() : 'webp'}`; it.imageMissing = false; withImg++; }
      } else warnings.push(`${id}: image file missing or unsupported (${f})`);
    }
    // Never hotlink: remote CDN URLs (fbcdn/scontent/googlesyndication, all signed + expiring) are downloaded
    // at ingest and stored in the repo. Then fall back to a copy already recovered earlier (fetch-ad-images.mjs).
    if (!it.image && remote) {
      const tmp = join(root, '.cache/ingest', `${source}-${fname}.img`);
      if (download(remote, tmp)) { const ok = compress(tmp, join(root, 'public/creatives', source, `${fname}.webp`)); if (ok === true) { it.image = `creatives/${source}/${fname}.webp`; it.imageMissing = false; withImg++; } }
      else warnings.push(`${id}: remote image download failed (${remote.slice(0, 80)})`);
    }
    if (!it.image && kept) { it.image = kept; it.imageMissing = false; withImg++; }
    if (!it.image) warnings.push(`${id}: no image – run scripts/fetch-ad-images.mjs`);
    if (r.image_source && !it.image_source) it.image_source = str(r.image_source);
    carryForward(it, prevMatches(prevBy, it));
    items.push(it);
  });
  console.log(`- ${source}: ${raw.length} items, ${withImg} with image`);
}

// ---------- aliases: an ad id listed in another entry's alias_ids is the same ad – keep one card ----------
for (const [from, to] of mergeAliases(items)) console.log(`- alias ${from} merged into ${to}`);
retainUnimported(items, prevItems, imported);

// ---------- write creatives.json ----------
items.sort((a, b) => a.source.localeCompare(b.source) || (b.days_active ?? -1) - (a.days_active ?? -1));
writeFileSync(prevPath, JSON.stringify({ generatedAt: new Date().toISOString(), asof, items }, null, 1) + '\n');

// ---------- weekly Top 10 snapshot ----------
const wk = { ...isoWeek(asof), asof };
const byEng = (a, b) => (numOrNull(b.views) ?? -1) - (numOrNull(a.views) ?? -1) || (numOrNull(b.likes) ?? -1) - (numOrNull(a.likes) ?? -1);
const topBy = (arr) => arr.filter((i) => i.image && (numOrNull(i.views) != null || numOrNull(i.likes) != null)).sort(byEng).slice(0, 5).map((it, k) => ({ rank: k + 1, basis: numOrNull(it.views) != null ? 'views' : 'likes', ...it }));
const strips = [
  { key: 'tiktok', title: 'TikTok – אורגני / יוצרים (לא מודעות ממומנות)', basis: 'דירוג לפי צפיות בפוסט', items: topBy(items.filter((i) => i.source === 'tiktok')) },
  { key: 'other', title: 'YouTube / Instagram / Facebook – אורגני (לא מודעות)', basis: 'דירוג לפי צפיות (ואם אין – לייקים)', items: topBy(items.filter((i) => i.source === 'organic')) },
];
const tpath = join(root, 'data/top10.json');
const prev = existsSync(tpath) ? JSON.parse(readFileSync(tpath, 'utf8')) : { weeks: {} };
applyWeek(prev, wk, { items, brands, imported, strips, now: new Date().toISOString(), prevCreatives: prevItems });
writeFileSync(tpath, JSON.stringify(prev, null, 1) + '\n');
const snap = prev.weeks[wk.key];
const ranked = imported.has('meta') && !LEGACY_WEEKS.has(wk.key);
console.log(`top10 ${wk.key}: ${ranked ? `niche ${snap.niche.length}, ${snap.items.length} ads (${snap.items.filter((t) => t.image).length} with image)` : 'sponsored ranking left unchanged'}${imported.has('organic') || imported.has('tiktok') ? `, strips ${snap.strips.map((s) => s.key + ':' + s.items.length).join(' ')}` : ''}`);
if (warnings.length) console.log('warnings:\n  ' + warnings.slice(0, 40).join('\n  ') + (warnings.length > 40 ? `\n  …+${warnings.length - 40}` : ''));
const unknown = [...new Set(items.map((i) => i.brand).filter((b) => !brands.some((x) => x.id === b)))];
if (unknown.length) console.log('! brands not in data.json (shown by raw name):', unknown.join(', '));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runImport();
