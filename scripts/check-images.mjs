// Image health check for every card on every tab. Run by build.mjs; `--strict` exits 1 on any problem.
// Flags: (1) cards without an image, (2) remote/expiring image URLs (fbcdn, scontent, cdninstagram, tiktokcdn,
// googlesyndication, any http URL – these are signed and expire), (3) local paths whose file is missing.
import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BLANK_BYTES = 1024;
const BLANK_HEIGHT = 40;

// Width/height from a file header. Null when the container isn't recognized.
export function imageSize(buf) {
  if (!buf || buf.length < 10) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf.length >= 24) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf.length >= 10) return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const kind = buf.toString('ascii', 12, 16);
    if (kind === 'VP8 ') {
      const head = buf.subarray(0, Math.min(buf.length, 40));
      const start = head.indexOf(Buffer.from([0x9d, 0x01, 0x2a]));
      if (start >= 0 && buf.length >= start + 7) return { width: buf.readUInt16LE(start + 3) & 0x3fff, height: buf.readUInt16LE(start + 5) & 0x3fff };
    }
    if (kind === 'VP8L' && buf.length >= 25 && buf[20] === 0x2f) {
      const bits = buf[21] | (buf[22] << 8) | (buf[23] << 16) | (buf[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8X' && buf.length >= 30) return { width: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)), height: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o + 8 < buf.length) {
      if (buf[o] !== 0xff) { o++; continue; }
      const marker = buf[o + 1];
      const len = buf.readUInt16BE(o + 2);
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { height: buf.readUInt16BE(o + 5), width: buf.readUInt16BE(o + 7) };
      }
      if (len < 2) break;
      o += 2 + len;
    }
  }
  return null;
}
function sniff(path) {
  const size = statSync(path).size;
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(Math.min(size, 65536));
    const n = readSync(fd, buf, 0, buf.length, 0);
    return { size, buf: buf.subarray(0, n) };
  } finally { closeSync(fd); }
}
// Warning only: under 1KB, or a readable height of 40px or less (blank / spacer frames).
export function blankReason(file) {
  let sniffed;
  try { sniffed = sniff(file); } catch { return ''; }
  const dim = imageSize(sniffed.buf);
  const tiny = sniffed.size > 0 && sniffed.size < BLANK_BYTES;
  const short = !!(dim && dim.height <= BLANK_HEIGHT);
  if (!tiny && !short) return '';
  const parts = [];
  if (tiny) parts.push(`${sniffed.size}B`);
  if (short) parts.push(`${dim.width}×${dim.height}`);
  return parts.join(' ');
}
export function checkImages(r = root) {
  const load = (p, f) => (existsSync(join(r, p)) ? JSON.parse(readFileSync(join(r, p), 'utf8')) : f);
  const cr = load('data/creatives.json', { items: [] }).items;
  const t = load('data/top10.json', { weeks: {} });
  const lw = Object.values(t.weeks || {}).sort((a, b) => a.key.localeCompare(b.key)).pop();
  const groups = { creatives: cr, top10: lw ? [...(lw.items || []), ...(lw.niche || []), ...(lw.strips || []).flatMap((s) => s.items)] : [] };
  const out = {};
  for (const [tab, arr] of Object.entries(groups)) {
    const o = { total: arr.length, missing: [], remote: [], broken: [], blank: [] };
    for (const it of arr) {
      const img = it.image;
      if (!img) o.missing.push(it);
      else if (/^https?:|^\/\//i.test(img)) o.remote.push(it);
      else if (!existsSync(join(r, 'public', img))) o.broken.push(it);
      else {
        const why = blankReason(join(r, 'public', img));
        if (why) o.blank.push({ id: it.id, image: img, reason: why });
      }
    }
    out[tab] = o;
  }
  return out;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const res = checkImages(); let bad = 0;
  for (const [tab, o] of Object.entries(res)) {
    const bySrc = {}; for (const it of o.missing) bySrc[it.source] = (bySrc[it.source] || 0) + 1;
    console.log(`${tab}: ${o.total} cards · missing ${o.missing.length} ${JSON.stringify(bySrc)} · remote ${o.remote.length} · broken ${o.broken.length} · blank ${o.blank.length}`);
    for (const it of [...o.remote, ...o.broken]) console.log(`  ! ${it.id} ${it.image}`);
    for (const it of o.blank) console.warn(`  ~ blank ${it.id} ${it.image} (${it.reason})`);
    if (process.argv.includes('-v')) for (const it of o.missing) console.log(`  - ${it.id} ${it.days_active ?? ''}d ${it.library_url || it.post_url || ''}`);
    bad += o.missing.length + o.remote.length + o.broken.length;
  }
  if (bad) console.log('fix: node scripts/fetch-ad-images.mjs  (recovers from Meta Ad Library / Google Ads Transparency into public/creatives)');
  if (process.argv.includes('--strict') && bad) process.exit(1);
}
