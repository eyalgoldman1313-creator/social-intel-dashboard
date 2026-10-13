// Drive link check (no Drive access needed at build): every Google Drive/Docs link in the built site is
// looked up in data/drive-names.json (file names cached from Drive).
//   FAIL  link points to a file whose name starts with '[גרסה' (previous/old version) or '[הוחלפה' (replaced)
//   WARN  link id not in the cache (refresh the cache with the Drive connector)
// node scripts/check-drive-links.mjs [distDir]   – exit 1 on any outdated link.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OLD = /^\[(גרסה|הוחלפה)/;
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.html?$/.test(f) ? [p] : []; });
export function checkDriveLinks(dist = join(root, 'dist')) {
  const cache = JSON.parse(readFileSync(join(root, 'data/drive-names.json'), 'utf8')).names || {};
  const uses = new Map();
  for (const f of existsSync(dist) ? walk(dist) : []) {
    const h = readFileSync(f, 'utf8');
    for (const m of h.matchAll(/https:\/\/(?:docs|drive)\.google\.com\/[^"'<>\s)]+/g)) {
      const id = (m[0].match(/\/(?:d|folders)\/([-\w]{20,})/) || m[0].match(/[?&]id=([-\w]{20,})/) || [])[1];
      if (!id) continue;
      if (!uses.has(id)) uses.set(id, new Set()); uses.get(id).add(f.slice(dist.length + 1));
    }
  }
  const outdated = [], unknown = [];
  for (const [id, files] of uses) {
    const name = cache[id];
    if (name == null) unknown.push({ id, files: [...files] });
    else if (OLD.test(name)) outdated.push({ id, name, files: [...files] });
  }
  return { total: uses.size, outdated, unknown };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = checkDriveLinks(process.argv[2] ? join(process.cwd(), process.argv[2]) : undefined);
  console.log(`drive links: ${r.total} files linked · ${r.outdated.length} outdated · ${r.unknown.length} not in cache`);
  for (const o of r.outdated) console.log(`  ✗ ${o.id} "${o.name}" in ${o.files.slice(0, 3).join(', ')}`);
  for (const u of r.unknown) console.log(`  ? ${u.id} in ${u.files.slice(0, 3).join(', ')} – add its name to data/drive-names.json`);
  if (r.outdated.length) process.exit(1);
}
