// Drive link check (no Drive access needed at build): every Google Drive/Docs link in the built site is
// looked up in data/drive-names.json (file names cached from Drive).
//   FAIL  link points to a file whose name starts with '[גרסה' (previous/old version) or '[הוחלפה' (replaced)
//   WARN  link id not in the cache (refresh the cache with the Drive connector)
// node scripts/check-drive-links.mjs [distDir]   – exit 1 on any outdated link.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OLD = /^\[(גרסה|הוחלפה)/;
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.html?$/.test(f) ? [p] : []; });
// Flags such as `--check` are not a build directory. The first other argument is.
export function distFromArgv(argv, cwd = process.cwd()) {
  const pos = (argv || []).filter((a) => a && !String(a).startsWith('--'));
  return pos[0] ? resolve(cwd, pos[0]) : undefined;
}
export function checkDriveLinks(dist = join(root, 'dist')) {
  if (!existsSync(dist) || !statSync(dist).isDirectory()) {
    console.error(`check-drive-links: dist not found: ${dist}`);
    process.exitCode = 2;
    return { total: 0, outdated: [], unknown: [], missingDist: true };
  }
  const cache = JSON.parse(readFileSync(join(root, 'data/drive-names.json'), 'utf8')).names || {};
  const uses = new Map();
  for (const f of walk(dist)) {
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
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = checkDriveLinks(distFromArgv(process.argv.slice(2)));
  if (r.missingDist) process.exit(2);
  console.log(`drive links: ${r.total} files linked · ${r.outdated.length} outdated · ${r.unknown.length} not in cache`);
  for (const o of r.outdated) console.log(`  ✗ ${o.id} "${o.name}" in ${o.files.slice(0, 3).join(', ')}`);
  for (const u of r.unknown) console.log(`  ? ${u.id} in ${u.files.slice(0, 3).join(', ')} – add its name to data/drive-names.json`);
  if (r.outdated.length) process.exit(1);
}
