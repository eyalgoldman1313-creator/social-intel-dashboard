// Import creative assets produced by the research bots into the dashboard.
//   node scripts/import-creatives.mjs [srcDir] [--asof YYYY-MM-DD]
// srcDir (default /workspace/social/creatives or $CREATIVES_SRC) holds meta/ tiktok/ organic/ , each with index.json
// Output (committed to git, consumed by scripts/build.mjs – no network or deps at build time):
//   public/creatives/<source>/<slug>.webp   (compressed, <= 150KB each)
//   data/creatives.json                      (normalized items)
//   data/top10.json                          (weekly snapshots keyed by ISO week; past weeks are kept)
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { rankTop10, nicheIds } from './creatives.mjs';
const md5 = (s) => createHash('md5').update(s).digest('hex').slice(0, 8);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : null; };
const asofArg = flag('--asof');
const SRC = resolve(args[0] || process.env.CREATIVES_SRC || '/workspace/social/creatives');
const MAX_KB = 150, MAX_W = 900;
const SOURCES = ['meta', 'tiktok', 'organic'];
const brands = JSON.parse(readFileSync(join(root, 'data/data.json'), 'utf8')).brands;

// ---------- helpers ----------
const jerusalemToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
const asof = asofArg || jerusalemToday();
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
const ALIAS = { 'wonders-teva': 'wondersteva', 'gmila-luuf': 'trygmila', 'fill-it': 'fillit', fillitvitamins: 'fillit', 'fill-it': 'fillit', 'fill it': 'fillit', luuf: 'trygmila', tryluuf: 'trygmila', gmila: 'trygmila', 'gmila / luuf': 'trygmila', harmony: 'by-harmony', byharmony: 'by-harmony', smiley: 'try-smiley', trysmiley: 'try-smiley', woof: 'mywoof', wonders: 'wondersteva', 'wonders teva': 'wondersteva' };
function brandId(raw) {
  const r0 = str(raw).toLowerCase(); const r = ALIAS[r0] || r0; if (!r) return '';
  const hit = brands.find((b) => [b.id, b.name, b.heName, b.domain].filter(Boolean).some((x) => x.toLowerCase() === r || r.replace(/^www\./, '').startsWith(x.toLowerCase())));
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

// ---------- read + normalize ----------
const warnings = [];
const items = [];
for (const source of SOURCES) {
  const dir = join(SRC, source), idx = join(dir, 'index.json');
  if (!existsSync(idx)) { console.log(`- ${source}: no index.json (skipped)`); continue; }
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
      platform: source === 'meta' ? (str(r.platform) === 'שניהם' ? 'Facebook + Instagram' : str(r.platform)) : (str(r.platform) || ({ tiktok: 'TikTok', organic: 'אורגני' })[source]),
      plat: source === 'meta' ? 'meta' : (({ youtube: 'youtube', instagram: 'instagram', ig: 'instagram', facebook: 'facebook', fb: 'facebook', tiktok: 'tiktok' })[str(r.platform).toLowerCase()] || source),
      format: normFormat(r.format) !== 'unknown' ? normFormat(r.format) : (['tiktok', 'youtube'].includes(str(r.platform).toLowerCase()) || source === 'tiktok' ? 'video' : 'unknown'), start_date: normDate(r.start_date), post_date: normDate(r.post_date), days_active: days,
      status: normStatus(r.status), copy_text: str(r.copy_text), cta: str(r.cta), offer: str(r.offer), hook: str(r.hook),
      language: str(r.language), days_since_posted: numOrNull(r.days_since_posted),
      creative_notes: str(r.creative_notes), library_url: str(r.library_url) || (source === 'meta' && libId ? `https://www.facebook.com/ads/library/?id=${libId}` : ''),
      post_url: str(r.post_url ?? r.video_url ?? r.url), ctype: source === 'meta' ? 'paid' : (({ 'אורגני': 'organic', organic: 'organic', 'יוצר': 'creator', creator: 'creator', ugc: 'creator', 'שיתוף': 'partnership', partnership: 'partnership', 'שיתוף פעולה': 'partnership' })[str(r.type).trim().toLowerCase()] || 'organic'), variants_count: numOrNull(r.variants_count), family: str(r.family),
      views: r.views ?? null, likes: r.likes ?? null, comments: r.comments ?? null, shares: r.shares ?? null, followers: r.followers ?? null,
      stage: str(r.stage) || null, days_since_start: numOrNull(r.days_since_start), multiple_versions: !!r.multiple_versions,
      copy_scope: str(r.copy_scope), copy_note: str(r.copy_note), copy_text_he: str(r.copy_text_he), copy_language: str(r.copy_language),
      landing_url: str(r.landing_url) ? (/^https?:\/\//i.test(str(r.landing_url)) ? str(r.landing_url) : 'https://' + str(r.landing_url)) : '',
      data_notes: str(r.data_notes), engagement: r.engagement ?? null,
      image: null, imageMissing: true,
    };
    const f = str(r.file ?? r.image);
    if (f) {
      const inFile = [resolve(dir, f), resolve(dir, str(r.brand_slug), f)].find((x) => existsSync(x) && statSync(x).isFile()) || resolve(dir, f);
      if (existsSync(inFile) && /\.(png|jpe?g|webp|gif|avif)$/i.test(inFile)) {
        const out = join(root, 'public/creatives', source, `${fname}.webp`);
        const ok = compress(inFile, out);
        if (ok) { it.image = `creatives/${source}/${fname}.${ok === 'copied' ? extname(inFile).slice(1).toLowerCase() : 'webp'}`; it.imageMissing = false; withImg++; }
      } else warnings.push(`${id}: image file missing or unsupported (${f})`);
    } else warnings.push(`${id}: no file`);
    items.push(it);
  });
  console.log(`- ${source}: ${raw.length} items, ${withImg} with image`);
}

// ---------- write creatives.json ----------
items.sort((a, b) => a.source.localeCompare(b.source) || (b.days_active ?? -1) - (a.days_active ?? -1));
writeFileSync(join(root, 'data/creatives.json'), JSON.stringify({ generatedAt: new Date().toISOString(), asof, items }, null, 1) + '\n');

// ---------- weekly Top 10 snapshot ----------
const wk = isoWeek(asof);
const METHOD = 'דירוג לפי ותק הריצה (ימים פעילה) כמדד לביצועים, כי נתוני הוצאה/מעורבות אינם זמינים למודעות Meta בישראל. שוברי שוויון: מספר גרסאות/שכפולים. עד 2 קריאייטיבים לכל מותג, משפחה אחת נספרת פעם אחת. קריאייטיבים עם תמונה מדורגים לפני כאלה בלי תמונה. ותק הוא אינדיקציה, לא הוכחה לרווחיות.';
const top = rankTop10(items);
const niche = rankTop10(items, { brandIds: nicheIds(brands) });
const byEng = (a, b) => (numOrNull(b.views) ?? -1) - (numOrNull(a.views) ?? -1) || (numOrNull(b.likes) ?? -1) - (numOrNull(a.likes) ?? -1);
const topBy = (arr, basis) => arr.filter((i) => i.image && (numOrNull(i.views) != null || numOrNull(i.likes) != null)).sort(byEng).slice(0, 5).map((it, k) => ({ rank: k + 1, basis: numOrNull(it.views) != null ? 'views' : 'likes', ...it }));
const strips = [
  { key: 'tiktok', title: 'TikTok – אורגני / יוצרים (לא מודעות ממומנות)', basis: 'דירוג לפי צפיות בפוסט', items: topBy(items.filter((i) => i.source === 'tiktok')) },
  { key: 'other', title: 'YouTube / Instagram / Facebook – אורגני (לא מודעות)', basis: 'דירוג לפי צפיות (ואם אין – לייקים)', items: topBy(items.filter((i) => i.source === 'organic')) },
].filter((s) => s.items.length);
const tpath = join(root, 'data/top10.json');
const prev = existsSync(tpath) ? JSON.parse(readFileSync(tpath, 'utf8')) : { weeks: {} };
prev.weeks[wk.key] = { key: wk.key, week: wk.week, start: wk.start, end: wk.end, asof, generatedAt: new Date().toISOString(), method: METHOD, basis: 'ותק ריצה (ימים פעילה), אח״כ מספר גרסאות', items: top, niche, nicheBrands: nicheIds(brands), strips };
writeFileSync(tpath, JSON.stringify(prev, null, 1) + '\n');
console.log(`top10 ${wk.key}: niche ${niche.length}, ${top.length} ads (${top.filter((t) => t.image).length} with image), organic strips ${strips.map((s) => s.key + ':' + s.items.length).join(' ')}`);
if (warnings.length) console.log('warnings:\n  ' + warnings.slice(0, 40).join('\n  ') + (warnings.length > 40 ? `\n  …+${warnings.length - 40}` : ''));
const unknown = [...new Set(items.map((i) => i.brand).filter((b) => !brands.some((x) => x.id === b)))];
if (unknown.length) console.log('! brands not in data.json (shown by raw name):', unknown.join(', '));
