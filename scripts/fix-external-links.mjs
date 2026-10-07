// External links: add target="_blank" rel="noopener noreferrer"; normalize Meta Ad Library URLs.
// Library: fixLinks(html) -> { html, links, fb }. CLI (idempotent, in place): node scripts/fix-external-links.mjs <folder> [...]
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = /^https?:\/\/(social-intel-dashboard[^/]*\.vercel\.app)(\/|$)/i;
export const fbLib = (id) => `https://www.facebook.com/ads/library/?active_status=all&amp;ad_type=all&amp;country=ALL&amp;id=${id}&amp;media_type=all`;
export function normalizeUrl(href) {
  const m = href.match(/^https?:\/\/(?:www\.|m\.)?facebook\.com\/ads\/library\/?\?(.*)$/i);
  if (!m) return href;
  const id = m[1].replace(/&amp;/g, '&').split('&').map((p) => p.split('=')).find(([k]) => k === 'id')?.[1];
  return id ? fbLib(id) : href;
}
export function fixLinks(html) {
  let links = 0, fb = 0;
  const out = html.replace(/<a\b[^>]*>/gi, (tag) => {
    const hm = tag.match(/\shref\s*=\s*(["'])(.*?)\1/i);
    if (!hm || !/^https?:\/\//i.test(hm[2]) || SELF.test(hm[2])) return tag;
    let t = tag;
    const nu = normalizeUrl(hm[2]);
    if (nu !== hm[2]) { t = t.replace(hm[0], ` href=${hm[1]}${nu}${hm[1]}`); fb++; }
    t = t.replace(/\s(target|rel)\s*=\s*(["']).*?\2/gi, '').replace(/^<a\b/i, '<a target="_blank" rel="noopener noreferrer"');
    if (t !== tag) links++;
    return t;
  });
  return { html: out, links, fb };
}
function walk(dir) { return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.html') ? [p] : []; }); }
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let L = 0, F = 0, files = 0;
  for (const d of process.argv.slice(2)) for (const p of walk(d)) {
    const src = readFileSync(p, 'utf8'); const r = fixLinks(src);
    if (r.html !== src) { writeFileSync(p, r.html); files++; L += r.links; F += r.fb; }
  }
  console.log(`changed files: ${files}, links fixed: ${L}, FB library URLs normalized: ${F}`);
}
