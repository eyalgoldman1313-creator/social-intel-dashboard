#!/usr/bin/env node
// sync-drive.mjs – keep the dashboard in step with the Drive analysis folders.
//
//   node scripts/sync-drive.mjs --kind mailers|ads|videos|all [--check] [--dir /workspace/drivesync]
//
// Drive is NOT called from here (no credentials on the build box). Inputs:
//   data/drive-listings.json   cached listing of the Drive folders (refresh with the Drive connector: list_folder on
//                              every folder in kinds.<kind>.folders, then rewrite the files[] arrays + fetchedAt)
//   <dir>/<kind>/<fileId>.html files downloaded with the Drive connector (DownloadFile) – only needed for imports
// What it does: lists every current analysis in the cached listing (skips "[גרסה…]"/"[הוחלפה…]" copies, folders,
// images), compares with the dashboard (specs.json mailers[].drive_id, specs.json items[*][].drive_id, drive-links.json),
// imports whatever is missing AND downloaded (spec page into specs/, mailer screenshot into public/mailers/*.webp,
// entry into data/specs.json), and reports the rest as gaps. --check: import nothing, exit 1 on any gap.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KINDS = ['mailers', 'ads', 'videos'];
const read = (p, d) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch { return d; } };
const isCurrent = (f) => !/^\s*\[/.test(f.name) && f.mime !== 'application/vnd.google-apps.folder' && !/^image\//.test(f.mime || '') && /html|\.html?$|^אפיון|^תסריט|ניתוח/.test(`${f.mime} ${f.name}`);

export function driveGaps(kinds = KINDS) {
  const listings = read('data/drive-listings.json', null);
  if (!listings) return { fetchedAt: null, gaps: [], error: 'data/drive-listings.json missing' };
  const specs = read('data/specs.json', { items: {}, mailers: [] });
  const links = read('data/drive-links.json', {});
  const known = new Set();
  for (const m of specs.mailers || []) if (m.drive_id) known.add(m.drive_id);
  for (const arr of Object.values(specs.items || {})) for (const s of arr) if (s.drive_id) known.add(s.drive_id);
  for (const v of Object.values(links)) for (const u of Object.values(v || {})) { const m = String(u).match(/\/d\/([\w-]{20,})/); if (m) known.add(m[1]); }
  const gaps = [];
  for (const k of kinds) for (const f of listings.kinds?.[k]?.files || []) if (isCurrent(f) && !known.has(f.id)) gaps.push({ kind: k, ...f });
  return { fetchedAt: listings.fetchedAt, gaps };
}

// ---------- parsing helpers ----------
const strip = (h) => h.replace(/data:image\/[^"')]+/g, '').replace(/<(style|script)[\s\S]*?<\/\1>/g, '').replace(/<\/?(bdi|span|b|mark|strong|em|i|a)\b[^>]*>/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const section = (h, n) => { const m = h.match(new RegExp(`<h3 id="s${n}">[\\s\\S]*?</h3>([\\s\\S]*?)(?=<h3|</section>)`)); return m ? strip(m[1]) : ''; };
const short = (s, n = 70) => { s = s.split(/(?<=[.;])\s|\s[–—]\s/)[0].trim().replace(/;$/, ''); return s.length > n ? s.slice(0, n - 1).trim() + '…' : s; };
const slug = (b) => b.toLowerCase().replace(/[^a-z0-9]+/g, '');

function importMailer(f, html) {
  const specs = read('data/specs.json', { items: {}, mailers: [] });
  const txt = strip(html);
  const known = new Map((specs.mailers || []).map((m) => [slug(m.brand), m.brand]));
  const rawBrand = (html.match(/<h1>[^<]*<bdi>([^<]+)<\/bdi>/) || [])[1] || (f.name.match(/\|\s*([^|]+?)\s*\|/) || [])[1] || 'Unknown';
  const brand = known.get(slug(rawBrand)) || rawBrand.trim();
  const dm = txt.match(/תאריך המייל:\s*(\d{1,2})\.(\d{1,2})\.(\d{4})(?:,\s*([\d:]+))?/);
  if (!dm) throw new Error(`no mail date in ${f.id}`);
  const [dd, mm, yyyy] = [dm[1].padStart(2, '0'), dm[2].padStart(2, '0'), dm[3]];
  const score = (txt.match(/ציון:\s*([\d.]+)\s*\/\s*10/) || [])[1] || '';
  const subj = (section(html, 3).match(/"([^"]+)"/) || [])[1] || (html.match(/<h1>[\s\S]*?–\s*([^<]+)<\/h1>/) || [])[1] || f.name;
  let base = `mailer-${slug(brand)}-${yyyy}-${mm}-${dd}`;
  for (let i = 0; fs.existsSync(path.join(ROOT, 'specs', base + '.html')); i++) base = `mailer-${slug(brand)}-${yyyy}-${mm}-${dd}${'bcdefg'[i]}`;
  fs.writeFileSync(path.join(ROOT, 'specs', base + '.html'), html);
  const img = html.match(/data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)/);
  let imgPath = '';
  if (img) {
    const tmp = path.join('/tmp', `${base}.${img[1]}`);
    fs.writeFileSync(tmp, Buffer.from(img[2], 'base64'));
    fs.mkdirSync(path.join(ROOT, 'public/mailers'), { recursive: true });
    execFileSync('python3', [path.join(ROOT, 'scripts/img_compress.py'), tmp, path.join(ROOT, 'public/mailers', base + '.webp'), '900', '150']);
    imgPath = `/mailers/${base}.webp`;
  }
  const entry = { brand, title: `${subj.trim()} (${+dd}.${+mm})`, file: base + '.html', score, date: `${dd}.${mm}.${yyyy}`, ...(dm[4] ? { time: dm[4] } : {}), img: imgPath,
    offer: short(section(html, 8)) || 'אין הצעה', hook: short(section(html, 6)), cta: short(section(html, 11)), drive_id: f.id };
  specs.mailers = [entry, ...(specs.mailers || [])].sort((a, b) => b.date.split('.').reverse().join('').localeCompare(a.date.split('.').reverse().join('')) || String(b.time || '').localeCompare(String(a.time || '')));
  fs.writeFileSync(path.join(ROOT, 'data/specs.json'), JSON.stringify(specs, null, 2) + '\n');
  return `${entry.file} (${brand}, ${entry.date}${dm[4] ? ' ' + dm[4] : ''}, ${score}/10)`;
}

function importAdSpec(f, html, kind) {
  const specs = read('data/specs.json', { items: {}, mailers: [] });
  const id = (html.match(/[?&]id=(\d{12,20})/) || html.match(/\b(\d{15,19})\b/) || [])[1];
  if (!id) throw new Error(`no ad id found in ${f.id} – add it by hand`);
  const brand = (f.name.match(/\|\s*([^|]+?)\s*\|/) || [])[1] || 'x';
  const plat = /tiktok/i.test(f.name) ? 'tiktok' : /google/i.test(f.name) ? 'google' : 'meta';
  const script = /^תסריט/.test(f.name);
  const suffix = kind === 'videos' ? (script ? '-video-nully' : '-video-spec') : '';
  const file = `${plat}-${slug(brand).replace(/^$/, 'x')}-${id}${suffix}.html`;
  fs.writeFileSync(path.join(ROOT, 'specs', file), html);
  const label = script ? 'תסריט ל-Nully' : kind === 'videos' ? 'אפיון וידאו' : 'אפיון';
  const arr = (specs.items[id] ||= []);
  const ex = arr.find((s) => s.file === file);
  if (ex) ex.drive_id = f.id; else arr.push({ label, file, drive_id: f.id });
  fs.writeFileSync(path.join(ROOT, 'data/specs.json'), JSON.stringify(specs, null, 2) + '\n');
  return `${file} → card ${id}`;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const kind = opt('--kind', 'all'), check = args.includes('--check'), dir = opt('--dir', '/workspace/drivesync');
  const kinds = kind === 'all' ? KINDS : [kind];
  if (!kinds.every((k) => KINDS.includes(k))) { console.error('usage: --kind mailers|ads|videos|all [--check] [--dir DIR]'); process.exit(2); }
  const { fetchedAt, gaps, error } = driveGaps(kinds);
  if (error) { console.error(error); process.exit(2); }
  console.log(`Drive listing cached ${fetchedAt}; kinds: ${kinds.join(', ')}`);
  if (check) {
    for (const g of gaps) console.log(`GAP ${g.kind}: ${g.id}  ${g.name}`);
    console.log(gaps.length ? `✗ ${gaps.length} Drive analysis file(s) not on the dashboard` : '✓ no gaps');
    process.exit(gaps.length ? 1 : 0);
  }
  let left = 0;
  for (const g of gaps) {
    const p = path.join(dir, g.kind, `${g.id}.html`);
    if (!fs.existsSync(p)) { left++; console.log(`GAP ${g.kind}: ${g.id}  ${g.name}  → download it to ${p} (Drive connector DownloadFile) and re-run`); continue; }
    try { console.log(`+ ${g.kind}: ${g.kind === 'mailers' ? importMailer(g, fs.readFileSync(p, 'utf8')) : importAdSpec(g, fs.readFileSync(p, 'utf8'), g.kind)}`); }
    catch (e) { left++; console.log(`GAP ${g.kind}: ${g.id}  ${g.name}  → ${e.message}`); }
  }
  console.log(left ? `✗ ${left} gap(s) remain` : '✓ dashboard matches the cached Drive listing');
  process.exit(left ? 1 : 0);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
