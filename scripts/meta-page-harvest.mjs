// Pure helpers for the Meta Ad Library page harvest. No network, no Playwright.
// Facebook's ?id=<library id> deeplink now loads the advertiser feed; the id shows up as
// deeplinkAdID and not as "ad_archive_id". Recovery sniffs view_all_page_id responses.
import { writeFileSync, renameSync } from 'node:fs';

// Logged-out Ad Library stops around this many cards per page load. Scrolling does not
// pass it. A logged-in Playwright storageState (never commit the file) lifts the cap.
export const ANON_CARD_CAP = 30;

// After this many ?id= deeplinks in a row return no snapshot, stop. The deeplink is
// broken for the session; further loads repeat the same miss.
export const ID_FALLBACK_MISS_LIMIT = 3;

export const GRID_ONLY_REASON = 'grid-only';

export const DISPLAY_FORMAT = { VIDEO: 'video', IMAGE: 'image', CAROUSEL: 'carousel', DCO: 'image', DPA: 'carousel' };

export const REASON = {
  noMedia: 'snapshot has no media url',
  noSnapshot: 'no snapshot data (blocked / removed ad?)',
  notInBrowse: 'not in page browse (anonymous ~30-card cap / inactive / not loaded)',
  noPage: 'no meta page id for brand',
};

export function atomicWriteJson(path, obj) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(obj, null, 1) + '\n');
  renameSync(tmp, path);
}

// --storage-state PATH wins over META_STORAGE_STATE. Returns a path only; callers
// pass it to Playwright and must not print or commit the file.
export function storageStateOption(argv = [], env = {}) {
  const i = argv.indexOf('--storage-state');
  if (i >= 0) {
    const v = argv[i + 1];
    if (v && !String(v).startsWith('--')) return String(v);
  }
  const fromEnv = env.META_STORAGE_STATE;
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim();
  return null;
}

export function idFallbackDecision(consecutiveMisses, limit = ID_FALLBACK_MISS_LIMIT) {
  return consecutiveMisses < limit ? 'try' : 'skip';
}

export function unescapeFb(s) {
  return String(s ?? '')
    .replace(/\\u0025/gi, '%')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"');
}

// Video ads prefer the preview frame. Still ads prefer the original, then a preview, then a resize.
export function pickMediaUrl(fields, displayFormat) {
  const video = fields?.video_preview_image_url || null;
  const original = fields?.original_image_url || null;
  const resized = fields?.resized_image_url || null;
  if (String(displayFormat || '').toUpperCase() === 'VIDEO') return video || original || resized || null;
  return original || video || resized || null;
}

function fieldUrl(seg, key) {
  const m = seg.match(new RegExp(`"${key}"\\s*:\\s*"(https:[^"]+)"`));
  return m ? m[1] : null;
}

// Pull every "ad_archive_id":"<id>" in one payload. Each id's media is read only up to the
// next id, so a card without a URL cannot inherit the next card's preview. `want` is a Set
// of library ids (strings). Ids already in `found` are left as-is. Pass the same Map through
// every response of a brand to match all wanted ids in one pass.
export function harvestFromText(text, want, found = new Map()) {
  const t = unescapeFb(text);
  const matches = [...t.matchAll(/"ad_archive_id"\s*:\s*"(\d+)"/g)];
  for (let i = 0; i < matches.length; i++) {
    const id = matches[i][1];
    if (want && !want.has(id)) continue;
    if (found.has(id)) continue;
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : Math.min(t.length, start + 100000);
    const seg = t.slice(start, end);
    const displayFormat = (seg.match(/"display_format"\s*:\s*"(\w+)"/) || [])[1] || null;
    const url = pickMediaUrl({
      original_image_url: fieldUrl(seg, 'original_image_url'),
      video_preview_image_url: fieldUrl(seg, 'video_preview_image_url'),
      resized_image_url: fieldUrl(seg, 'resized_image_url'),
    }, displayFormat);
    if (url) found.set(id, { url, displayFormat, fmt: DISPLAY_FORMAT[displayFormat] || null });
  }
  return found;
}

// Ignore bodies that are not archive snapshots (images, scripts, deeplink shells).
export function absorbArchiveBody(body, want, found = new Map()) {
  const t = String(body ?? '');
  if (!t.includes('ad_archive_id')) return found;
  if (!t.includes('original_image_url') && !t.includes('video_preview_image_url') && !t.includes('resized_image_url')) return found;
  return harvestFromText(t, want, found);
}

export function pageLibraryUrl(pageId, { status = 'all', country = 'IL', recent = true } = {}) {
  const sort = recent ? '&sort_data[direction]=desc&sort_data[mode]=relevancy_monthly_grouped' : '';
  return `https://www.facebook.com/ads/library/?active_status=${status}&ad_type=all&country=${country}&media_type=all&search_type=page&view_all_page_id=${pageId}${sort}`;
}

// Most recent first (active and all), then the default sort. One brand walks these in order
// and stops once every wanted id has a media URL.
export function browseUrls(pageId) {
  const urls = [];
  for (const recent of [true, false]) {
    for (const status of ['all', 'active']) urls.push(pageLibraryUrl(pageId, { status, recent }));
  }
  return urls;
}

export function idLibraryUrl(id) {
  return `https://www.facebook.com/ads/library/?id=${encodeURIComponent(id)}`;
}

// `doc` is either { pages: { brand: id | id[] } } or a flat brand→id map.
export function loadPageMap(doc) {
  const table = doc && doc.pages && typeof doc.pages === 'object' ? doc.pages : (doc && typeof doc === 'object' ? doc : {});
  const out = {};
  for (const [k, v] of Object.entries(table)) {
    if (!k || k.startsWith('_') || k === 'source' || k === 'pages') continue;
    const ids = (Array.isArray(v) ? v : [v]).map((x) => String(x ?? '').trim()).filter((x) => /^\d{5,}$/.test(x));
    if (ids.length) out[k] = ids;
  }
  return out;
}

export function pageIdsFor(pageMap, brand) {
  if (!pageMap || brand == null || brand === '') return null;
  if (pageMap[brand]?.length) return pageMap[brand];
  const lower = String(brand).toLowerCase();
  if (lower !== brand && pageMap[lower]?.length) return pageMap[lower];
  return null;
}

// Smallest brand first so a short page finishes (and is saved) before a 1,000-ad page.
export function groupMetaByBrand(items, pageMap) {
  const groups = new Map();
  const unmapped = [];
  for (const it of items || []) {
    if (!it || it.source !== 'meta') continue;
    const pageIds = pageIdsFor(pageMap, it.brand);
    if (!pageIds) { unmapped.push(it); continue; }
    const key = it.brand;
    if (!groups.has(key)) groups.set(key, { brand: key, pageIds, items: [] });
    groups.get(key).items.push(it);
  }
  return {
    groups: [...groups.values()].sort((a, b) => a.items.length - b.items.length || String(a.brand).localeCompare(String(b.brand))),
    unmapped,
  };
}

export function bucketByBrand(items) {
  const by = new Map();
  for (const it of items || []) {
    const brand = it?.brand || '';
    if (!by.has(brand)) by.set(brand, []);
    by.get(brand).push(it);
  }
  return [...by.entries()].map(([brand, list]) => ({ brand, pageIds: [], items: list }));
}

// Keep failure rows for cards this run has not touched, and for cards that are still missing.
// `fails` replaces any previous row for an id attempted now.
export function mergeMissingTsv(prevText, { stillIds, attempted, fails }) {
  const still = stillIds instanceof Set ? stillIds : new Set(stillIds || []);
  const done = attempted instanceof Set ? attempted : new Set(attempted || []);
  const keep = String(prevText || '').split('\n').slice(1).filter((l) => {
    if (!l) return false;
    const id = l.split('\t')[0];
    return !done.has(id) && still.has(id);
  });
  const rows = [...keep, ...(fails || [])];
  return 'id\tlibrary_url\treason\n' + rows.join('\n') + (rows.length ? '\n' : '');
}
