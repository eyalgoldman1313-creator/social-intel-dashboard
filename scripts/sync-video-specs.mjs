// Re-runnable: scan the video characterizer output and register specs in data/specs.json.
// Usage: node scripts/sync-video-specs.mjs [/workspace/social/video-specs]
// Picks <brand>/<id>_spec[-v2].html and <id>_script_nully[-v2].html (prefers -v2), copies into specs/,
// and appends 'אפיון' + 'תסריט ל-Nully' badges to items[<id>] without touching other entries (e.g. image ad specs).
// 19-digit ids = TikTok videos (matched via post_url); 15-16 digits = Meta library ids (matched via library_id).
import { readFileSync, writeFileSync, readdirSync, statSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2] || '/workspace/social/video-specs';
const SKIP = new Set(['pilot', 'fullrun']);
const specsPath = join(root, 'data/specs.json');
const specs = JSON.parse(readFileSync(specsPath, 'utf8'));
const creatives = JSON.parse(readFileSync(join(root, 'data/creatives.json'), 'utf8')).items;
const known = new Set(creatives.flatMap((i) => [i.library_id, ...(String(i.post_url || i.video_url || '').match(/\d{15,}/g) || [])]).filter(Boolean));
const pick = (dir, id, kind) => [`${id}_${kind}-v2.html`, `${id}_${kind}.html`].find((f) => existsSync(join(dir, f)));
let n = 0; const unmatched = []; const done = [];
for (const brand of readdirSync(src).filter((d) => !SKIP.has(d) && statSync(join(src, d)).isDirectory())) {
  const dir = join(src, brand);
  const ids = [...new Set(readdirSync(dir).map((f) => f.match(/^(\d{15,})_(spec|script_nully)(-v2)?\.html$/)?.[1]).filter(Boolean))];
  for (const id of ids) {
    const prefix = id.length >= 19 ? `tiktok-${brand}-${id}` : `meta-${brand}-${id}-video`;
    const add = [];
    for (const [kind, suffix, label] of [['spec', 'spec', 'אפיון'], ['script_nully', 'nully', 'תסריט ל-Nully']]) {
      const f = pick(dir, id, kind); if (!f) continue;
      const out = `${prefix}-${suffix}.html`;
      copyFileSync(join(dir, f), join(root, 'specs', out));
      add.push({ label, file: out });
    }
    const files = new Set(add.map((a) => a.file));
    const others = (specs.items[id] || []).filter((e) => !files.has(e.file));
    if (others.some((e) => e.label === 'אפיון')) add.forEach((a) => { if (a.label === 'אפיון') a.label = 'אפיון וידאו'; });
    specs.items[id] = [...(specs.items[id] || []).filter((e) => !files.has(e.file)), ...add];
    n++; done.push(`${brand}/${id}`);
    if (!known.has(id)) unmatched.push(`${brand}/${id}`);
  }
}
writeFileSync(specsPath, JSON.stringify(specs, null, 1) + '\n');
console.log(`synced ${n} videos`); console.log('unmatched (no card in creatives.json):', unmatched.length ? unmatched.join(', ') : 'none');
