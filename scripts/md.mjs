// Minimal markdown -> HTML (headings, paragraphs, nested ul/ol, **bold**, `code`). No deps.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const latin = (s) => String(s).replace(/[A-Za-z][A-Za-z0-9.'/+\-]*(?:[ ][A-Za-z0-9][A-Za-z0-9.'/+\-]*)*/g, (m) => '\u0001' + m + '\u0002');
const inline = (s) => esc(latin(s)).replace(/\u0001/g, '<bdi>').replace(/\u0002/g, '</bdi>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
export function mdToHtml(md) {
  const out = []; const stack = []; let para = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const closeTo = (lvl) => { while (stack.length > lvl) out.push(`</li></${stack.pop()}>`); };
  for (const line of md.split('\n')) {
    const m = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (m) {
      flush(); const lvl = Math.floor(m[1].length / 2) + 1; const tag = /\d/.test(m[2]) ? 'ol' : 'ul';
      if (stack.length < lvl) { while (stack.length < lvl) { stack.push(tag); out.push(`<${tag}><li>`); } out[out.length - 1] = out[out.length - 1]; out.push(''); }
      else { closeTo(lvl); out.push('</li><li>'); }
      out.push(inline(m[3]));
    } else if (h) { flush(); closeTo(0); out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); }
    else if (!line.trim()) { flush(); closeTo(0); }
    else { if (stack.length) out.push(' ' + inline(line.trim())); else para.push(line.trim()); }
  }
  flush(); closeTo(0);
  return out.join('').replace(/<li><\/li><li>/g, '<li>');
}
