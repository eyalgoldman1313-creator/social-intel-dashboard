// Static site generator: data/data.json -> dist/*.html  (zero dependencies)
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRenderer, loadJson } from './creatives.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const data = JSON.parse(readFileSync(join(root, 'data/data.json'), 'utf8'));
const creatives = loadJson(root, 'data/creatives.json', { items: [] });
const specs = loadJson(root, 'data/specs.json', { items: {}, mailers: [] });
const top10 = loadJson(root, 'data/top10.json', { weeks: {} });

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, 'public'), dist, { recursive: true });
// spec pages: copy specs/*.html to dist/specs/, injecting a small back-to-dashboard bar (content untouched)
{
  const sd = join(root, 'specs');
  if (existsSync(sd)) {
    mkdirSync(join(dist, 'specs'), { recursive: true });
    const bar = '<div style="position:sticky;top:0;z-index:9999;background:#0f172a;color:#fff;font:600 14px Heebo,Arial,sans-serif;padding:8px 16px;display:flex;gap:16px;align-items:center;direction:rtl"><a href="/#creatives" style="color:#fff;text-decoration:none">→ חזרה ללוח המודיעין</a><a href="/#mailers" style="color:#cbd5e1;text-decoration:none">מיילרים</a><span style="opacity:.6;font-weight:400">דף אפיון</span></div>';
    for (const f of readdirSync(sd).filter((f) => f.endsWith('.html'))) {
      let h = readFileSync(join(sd, f), 'utf8');
      h = /<body[^>]*>/i.test(h) ? h.replace(/<body[^>]*>/i, (m) => m + bar) : bar + h;
      if (!/name="robots"/.test(h)) h = h.replace(/<head[^>]*>/i, (m) => m + '<meta name="robots" content="noindex, nofollow">');
      writeFileSync(join(dist, 'specs', f), h);
    }
  }
}

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n) => Number(n).toLocaleString('en-US');
const brandById = Object.fromEntries(data.brands.map((b) => [b.id, b]));
const docUrl = (id) => `https://docs.google.com/document/d/${id}/edit`;
const PLAT = data.platforms;
const GROUP_LABEL = { niche: 'נישה', reference: 'רפרנס' };
const PLATFORM_LABEL = { meta: 'Meta', tiktok: 'TikTok', google: 'Google', organic: 'אורגני', instagram: 'Instagram', general: 'כללי' };

const chip = (p) => `<span class="chip plat-${esc(p)}">${esc(PLATFORM_LABEL[p] || p)}</span>`;
const srcTag = (p, text) => `<span class="src plat-${esc(p)}-t">מקור: ${esc(text || PLAT[p]?.source || p)}</span>`;
const bdi = (s) => `<bdi>${esc(s)}</bdi>`;
const brandName = (id) => esc(brandById[id]?.name || id);
const groupBadge = (g) => `<span class="badge g-${g}">${GROUP_LABEL[g]}</span>`;
const link = (href, text) => `<a class="doclink" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(text)} ↗</a>`;
const fullDoc = (id, text = 'למסמך המלא') => link(docUrl(id), text);

function daysTo(dateStr, from = new Date()) {
  const a = new Date(dateStr + 'T00:00:00+03:00');
  return Math.ceil((a - from) / 86400000);
}

// horizontal bar chart (RTL: bars grow from the right edge)
function bars({ items, max, unit = '', title, source, note }) {
  const m = max ?? Math.max(...items.map((i) => i.value), 1);
  const rows = items.map((i) => {
    const pct = Math.max(0.8, (i.value / m) * 100);
    const g = i.group || 'niche';
    return `<div class="bar-row"><div class="bar-label">${i.label}</div>
      <div class="bar-track"><div class="bar-fill g-${g}" style="width:${pct.toFixed(1)}%"></div></div>
      <div class="bar-val" dir="ltr">${esc(i.display ?? num(i.value))}${unit ? `<small>${esc(unit)}</small>` : ''}${i.delta ? ` <em class="delta">${esc(i.delta)}</em>` : ''}</div></div>`;
  }).join('');
  return `<figure class="chart">${title ? `<figcaption><b>${esc(title)}</b>${source || ''}</figcaption>` : ''}
    <div class="bars">${rows}</div>${note ? `<p class="fine">${note}</p>` : ''}</figure>`;
}

function legend() {
  return `<div class="legend"><span><i class="dot g-niche"></i>נישה (משקל גבוה)</span><span><i class="dot g-reference"></i>רפרנס (משקל נמוך)</span></div>`;
}

function stack({ title, source, segments, total, note }) {
  const t = total ?? segments.reduce((a, s) => a + s.value, 0);
  const segs = segments.map((s, k) => `<div class="seg s${k}" style="width:${((s.value / t) * 100).toFixed(2)}%" title="${esc(s.label)}: ${s.value}"><span dir="ltr">${s.value}</span></div>`).join('');
  const leg = segments.map((s, k) => `<span><i class="dot s${k}"></i>${esc(s.label)} <b dir="ltr">${s.value}</b> <small dir="ltr">(${Math.round((s.value / t) * 100)}%)</small></span>`).join('');
  return `<figure class="chart"><figcaption><b>${esc(title)}</b>${source || ''}</figcaption><div class="stack">${segs}</div><div class="legend">${leg}</div>${note ? `<p class="fine">${note}</p>` : ''}</figure>`;
}

function section(id, title, inner, { docs = '' } = {}) {
  return `<section class="panel" id="${id}" data-tab="${id}"><div class="panel-head"><h2>${title}</h2><div class="panel-docs">${docs}</div></div>${inner}</section>`;
}

const notesList = (arr) => `<ul class="notes">${arr.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;

// ---------- renderers ----------
function render(scan, prev, { isLatest, scans }) {
  const D = scan.drive;
  const brands = data.brands;
  const niche = brands.filter((b) => b.group === 'niche');
  const ref = brands.filter((b) => b.group === 'reference');
  const delta = (platform, id, key) => {
    const a = scan[platform]?.brandStats?.[id]?.[key];
    const b = prev?.[platform]?.brandStats?.[id]?.[key];
    if (a == null || b == null || a === b) return undefined;
    return (a - b > 0 ? '+' : '') + num(a - b) + ' מהסריקה הקודמת';
  };

  // ----- header & exec summary -----
  const events = data.events.map((e) => {
    const d = daysTo(e.start);
    return `<div class="event" data-start="${e.start}"><span class="event-days" data-days="${e.start}">${d > 0 ? d : 0}</span><span>ימים ל${esc(e.title)}<small dir="ltr">${esc(e.label)}</small></span></div>`;
  }).join('');

  const takeaways = scan.summary.takeaways.map((t, i) => `<li class="take"><span class="take-n">${i + 1}</span><div>${chip(t.platform)}<p>${esc(t.text)}</p></div></li>`).join('');
  const actions = scan.summary.actions.map((a) => `<li class="act"><span class="act-n">${a.rank}</span><div><h4>${esc(a.title)}</h4><p><b>למה:</b> ${esc(a.why)}</p><div class="tags"><span class="tag pr-${esc(a.priority)}">עדיפות: ${esc(a.priority)}</span><span class="tag">מאמץ: ${esc(a.effort)}</span>${a.platforms.map(chip).join('')}</div></div></li>`).join('');

  const scanSwitch = scans.length > 1
    ? `<nav class="scans" aria-label="סריקות">${scans.map((s) => `<a href="${s.id === scans[scans.length - 1].id ? '/' : `/archive/${s.id}/`}"${s.id === scan.id ? ' aria-current="page"' : ''}>${esc(s.date)}</a>`).join('')}</nav>` : '';

  const header = `<header class="top">
    <div class="top-in">
      <div><p class="eyebrow">${esc(data.site.subtitle)}</p><h1>${esc(data.site.title)}</h1>
      <p class="updated"><span class="live"></span> עודכן לאחרונה: <b>${esc(scan.date)}</b> / ${esc(scan.statusLabel)}${isLatest ? '' : ' · <b>ארכיון</b>'}</p>
      ${scanSwitch}</div>
      <div class="events">${events}</div>
    </div></header>`;

  const summary = `<section class="summary" id="status" aria-labelledby="status-h">
    <div class="summary-in"><h2 id="status-h">תמונת מצב</h2>
    <div class="summary-grid"><div><h3>7 מסקנות מרכזיות</h3><ol class="takes">${takeaways}</ol></div>
    <div><h3>5 פעולות מומלצות לפי עדיפות</h3><ol class="acts">${actions}</ol></div></div>
    <p class="fine">המלצות = הסקה על בסיס תצפיות בדוחות, לא תוצאות שנמדדו. סריקה חד-פעמית; ראו ״מגבלות וכיסוי״.</p></div></section>`;

  // ----- overview -----
  const nicheMeta = niche.map((b) => scan.meta.brandStats[b.id]);
  const advertisersMeta = nicheMeta.filter((m) => m.active || m.results > 0).length;
  const kpi = (n, t, s) => `<div class="kpi"><div class="kpi-n" dir="ltr">${n}</div><div class="kpi-t">${t}</div>${s ? `<div class="kpi-s">${s}</div>` : ''}</div>`;
  const mostRes = niche.filter((b) => !scan.meta.brandStats[b.id].inflated).reduce((a, b) => (scan.meta.brandStats[b.id].results > scan.meta.brandStats[a.id].results ? b : a));
  const longest = [...niche].reduce((a, b) => ((scan.meta.brandStats[b.id].longestDays || 0) > (scan.meta.brandStats[a.id].longestDays || 0) ? b : a));
  const topTik = brands.filter((b) => !scan.tiktok.brandStats[b.id].none).reduce((a, b) => (scan.tiktok.brandStats[b.id].topViews > scan.tiktok.brandStats[a.id].topViews ? b : a));
  const topFb = brands.filter((b) => scan.organic.brandStats[b.id]?.fbFollowers).reduce((a, b) => (scan.organic.brandStats[b.id].fbFollowers > scan.organic.brandStats[a.id].fbFollowers ? b : a));
  const ncv = scan.meta.nicheCreatives;
  const kpis = `<div class="kpis">
    ${kpi(String(brands.length), 'אתרים בסריקה', `${niche.length} נישה · ${ref.length} רפרנס`)}
    ${kpi(`${advertisersMeta}/${niche.length}`, 'מתחרי נישה מפרסמים ב-Meta', 'בכל השפות, ' + scan.date)}
    ${kpi('~' + num(scan.meta.brandStats[mostRes.id].results), `תוצאות Meta של ${mostRes.name}`, 'התאמת טקסט, לא ספירת מודעות')}
    ${kpi('~' + scan.meta.brandStats[longest.id].longestDays, 'ימי ריצה – המודעה הוותיקה בנישה', `${longest.name}, Meta`)}
    ${kpi(`${ncv.image} / ${ncv.video}`, `תמונה·קרוסלה / וידאו (מתוך ${ncv.total})`, `~${Math.round((ncv.image / ncv.total) * 100)}% / ~${Math.round((ncv.video / ncv.total) * 100)}%`)}
    ${kpi(num(scan.google.nicheCoverage.total), 'מודעות גוגל באתרי הנישה', `מתועדות ${scan.google.nicheCoverage.documented} (~${scan.google.nicheCoverage.documentedPct}%)`)}
    ${kpi(scan.tiktok.brandStats[topTik.id].topViewsLabel, 'צפיות בפוסט המוביל ב-TikTok', `${topTik.name} · אורגני`)}
    ${kpi(Math.round(scan.organic.brandStats[topFb.id].fbFollowers / 1000) + 'K', `עוקבי פייסבוק ${topFb.name}`, 'הגדול בנישה')}
  </div>`;

  const cell = (v, cls = '') => `<td class="${cls}" dir="ltr">${v}</td>`;
  const matrixRows = brands.map((b) => {
    const m = scan.meta.brandStats[b.id] || {};
    const t = scan.tiktok.brandStats[b.id] || {};
    const g = scan.google.brandStats[b.id] || {};
    const o = scan.organic.brandStats[b.id] || {};
    return `<tr class="grp-${b.group}"><th scope="row">${bdi(b.name)} ${groupBadge(b.group)}</th>
      ${cell(m.resultsLabel || (m.results > 0 ? '~' + num(m.results) : '0'), m.results || m.resultsLabel ? '' : 'zero')}
      ${cell(t.none ? '—' : num(t.followers), t.none ? 'zero' : '')}
      ${cell(g.notFound ? 'לא נמצא' : g.total ? (g.approx ? '~' : '') + num(g.total) : '0', g.total ? '' : 'zero')}
      ${cell(o.fbFollowers ? num(o.fbFollowers) : o.fbUnavailable ? 'לא זמין' : o.fbNotFound ? 'לא נמצא' : '—', o.fbFollowers ? '' : 'zero')}
      <td class="ig">בהמשך</td></tr>`;
  }).join('');
  const matrix = `<div class="tablewrap"><table class="matrix"><caption>מטריצת נוכחות – מספר מודעות ועוקבים לכל מתחרה ופלטפורמה ${srcTag('general', 'דוחות ההשוואה בדרייב')}</caption>
    <thead><tr><th>מתחרה</th><th>Meta<small>תוצאות מודעות</small></th><th>TikTok<small>עוקבים (אורגני)</small></th><th>Google<small>מודעות</small></th><th>פייסבוק<small>עוקבים</small></th><th>Instagram</th></tr></thead><tbody>${matrixRows}</tbody></table></div>`;

  const overviewDocs = `<div class="doc-grid">
    ${['meta', 'tiktok', 'google', 'organic'].map((p) => `<div class="doc-card">${chip(p)}<div>${fullDoc(D.comparative[p], 'דוח השוואתי')}${link(D.folders[p], 'תיקייה')}</div></div>`).join('')}
  </div>`;

  const overview = section('overview', 'סקירה כללית', `${summary}${kpis}${matrix}
    <h3>מה בסריקה</h3>
    <ul class="notes"><li>7 אתרי נישה (משקל גבוה מאוד) ו-6 אתרי רפרנס מחוץ לנישה (משקל נמוך – טרנדים, מבצעים עונתיים, פורמטים).</li>
    <li>4 פלטפורמות נותחו: Meta (מודעות), TikTok (אורגני בלבד), Google (שקיפות מודעות), נראות אורגנית (פייסבוק, YouTube, פיד אינסטגרם מוטמע).</li>
    <li>היקף: מודעות ותוכן נותחו בכל שפה ובכל מדינה (לא רק עברית) – עודכן ב-04.10.2026.</li>
    <li>אינסטגרם עדיין <b>בהמשך</b> – ההתחברות לא הושלמה.</li></ul>
    <h3>הדוחות המלאים בדרייב</h3>${overviewDocs}`);

  // ----- creatives-first panels -----
  const CR = makeRenderer({ esc, brandName, section, specs: specs.items || {} });
  const mailers = specs.mailers || [];
  const mailersPanel = section('mailers', 'מיילרים', mailers.length ? `<p class="scope">ניתוחי מיילים שיווקיים של מתחרים – כל ניתוח נפתח כדף באתר.</p><div class="mailer-grid">${mailers.map((m) => `<a class="mailer-card" href="/specs/${esc(m.file.replace(/\.html$/, ''))}" target="_blank" rel="noopener"><span class="brand-tag">${esc(m.brand)}</span><h3>${esc(m.title)}</h3><span class="spec-tag">📄 ניתוח המייל ←</span></a>`).join('')}</div>` : '<p class="fine">אין עדיין ניתוחי מיילרים.</p>');
  const creativesPanel = CR.galleryPanel({ creatives, brands, scanDate: scan.date, asof: creatives.asof });
  const top10Panel = CR.top10Panel({ top10, creatives, brands, scanDate: scan.date });
  const galleryHint = (txt) => `<p class="gal-link"><a href="#creatives" data-go="creatives">🖼 ${txt} ←</a></p>`;

  // ----- Meta -----
  const ms = scan.meta.brandStats;
  const metaResultsItems = [...niche, ...ref].filter((b) => ms[b.id].results > 0 && !ms[b.id].inflated).sort((a, b) => ms[b.id].results - ms[a.id].results).map((b) => ({ label: bdi(b.name), value: ms[b.id].results, display: '~' + num(ms[b.id].results), group: b.group, delta: delta('meta', b.id, 'results') }));
  const inflatedMeta = [...niche, ...ref].filter((b) => ms[b.id].inflated).map((b) => `<span class="pill">${bdi(b.name)} ${esc(ms[b.id].resultsLabel)}</span>`).join('');
  const longestItems = [...niche, ...ref].filter((b) => ms[b.id].longestDays).sort((a, b) => ms[b.id].longestDays - ms[a.id].longestDays).map((b) => ({ label: bdi(b.name), value: ms[b.id].longestDays, display: '~' + ms[b.id].longestDays, group: b.group }));
  const maxRun = Math.ceil(Math.max(210, ...[...niche, ...ref].map((b) => ms[b.id].longestDays || 0)) / 50) * 50 + 20;
  const dotRows = [...niche, ...ref].filter((b) => ms[b.id].runDays).sort((a, b) => ms[b.id].longestDays - ms[a.id].longestDays).map((b) => `<div class="dot-row"><div class="bar-label">${bdi(b.name)}</div><div class="dot-track">${ms[b.id].runDays.map((d) => `<i class="adot g-${b.group}" style="right:${(d / maxRun) * 100}%" title="${d} ימים"></i>`).join('')}</div><div class="bar-val" dir="ltr">${ms[b.id].runDays.length}</div></div>`).join('');
  const dotChart = `<figure class="chart"><figcaption><b>משך ריצה של כל קריאייטיב שנדגם (ימים)</b>${srcTag('meta', 'Meta Ad Library')}</figcaption>
    <div class="dots">${dotRows}</div><div class="dot-row axis-row"><div></div><div class="axis">${[0, 100, 200, 300, 400, 500, 600].filter((v) => v < maxRun).map((v) => `<span style="right:${(v / maxRun) * 100}%">${v}</span>`).join('')}</div><div class="bar-val">&nbsp;</div></div>
    <p class="fine">כל נקודה = קריאייטיב/משפחה אחת בדוח המותג. ימי ריצה מתאריך ההתחלה עד 04.10.2026 בהנחה שהמודעה פעילה. העמודה השמאלית = מספר קריאייטיבים במדגם.</p></figure>`;
  const nc = scan.meta.nicheCreatives;
  const formatSplit = stack({ title: `פורמט בנישה – ${nc.total} יחידות ניתוח`, source: srcTag('meta', 'Meta Ad Library · ספירה בדוח ההשוואתי'), segments: [{ label: 'תמונה / כרטיס / קרוסלה', value: nc.image }, { label: 'וידאו', value: nc.video }, { label: 'לא תועד', value: nc.fmtUnknown }], total: nc.total });
  const perBrandFmt = niche.filter((b) => ms[b.id].image != null).map((b) => ({ label: bdi(b.name), segs: [ms[b.id].image, ms[b.id].video] }));
  const perBrandStack = `<figure class="chart"><figcaption><b>תמונה / וידאו לפי מתחרה (נישה)</b>${srcTag('meta', 'Meta Ad Library')}</figcaption><div class="bars">${perBrandFmt.map((r) => `<div class="bar-row"><div class="bar-label">${r.label}</div><div class="bar-track mini-stack"><div class="seg s0" style="width:${(r.segs[0] / (r.segs[0] + r.segs[1])) * 100}%"><span dir="ltr">${r.segs[0]}</span></div><div class="seg s1" style="width:${(r.segs[1] / (r.segs[0] + r.segs[1])) * 100}%"><span dir="ltr">${r.segs[1]}</span></div></div><div class="bar-val" dir="ltr">${r.segs[0] + r.segs[1]}</div></div>`).join('')}</div><div class="legend"><span><i class="dot s0"></i>תמונה/קרוסלה</span><span><i class="dot s1"></i>וידאו</span></div></figure>`;
  const ctaSplit = stack({ title: 'CTA בנישה: רך מול ישיר', source: srcTag('meta', 'Meta Ad Library'), segments: [{ label: 'רך (Learn more / See details / Sign up)', value: nc.ctaSoft }, { label: 'ישיר (Shop / Order now)', value: nc.ctaDirect }, { label: 'מעורב / לא נראה', value: nc.ctaMixed + nc.ctaUnknown }], total: nc.total });
  const signals = bars({ title: `מאפיינים ב-${nc.total} יחידות הניתוח בנישה (קריאייטיבים / משפחות)`, source: srcTag('meta', 'Meta Ad Library · ספירה שלנו בדוח'), max: nc.total, items: [
    { label: 'הצעה כספית / משלוח חינם בקופי', value: nc.withOffer, display: `${nc.withOffer} (~${Math.round((nc.withOffer / nc.total) * 100)}%)` },
    { label: 'מבוססי יוצרים / לקוחות (UGC, עדויות)', value: nc.ugc, display: `~${nc.ugc}` },
    { label: 'מזכירים משלוח חינם', value: nc.freeShipping },
    { label: 'מומחה / מייסד מסביר', value: nc.expert, display: `~${nc.expert}` },
    { label: 'טענת מספר לקוחות', value: nc.customerClaim },
    { label: 'מבצע חג / עונתי (סוכות)', value: nc.holiday },
    { label: 'שימור (מנוי / נאמנות / אפליקציה)', value: nc.retention },
    { label: 'מתנה ברכישה', value: nc.gift },
    { label: 'ריטרגטינג עגלה נטושה', value: nc.retargeting },
    { label: 'ניסיון / החזר כספי (מסגור ״חודש ניסיון״; התחייבות להחזר: 0)', value: nc.trial }] });
  const topics = bars({ title: 'נושאי הצורך ב-40 הקריאייטיבים העבריים הראשונים (מודעה יכולה לשלב כמה)', source: srcTag('meta', 'Meta Ad Library'), max: 10, items: scan.meta.needTopics.map((t) => ({ label: esc(t.label), value: t.count, display: (t.approx ? '~' : '') + (t.note || t.count) })) });
  const offerTiers = `<ul class="offers">${scan.meta.offerTiers.map((o) => `<li>${groupBadge(o.group)} ${esc(o.text)}</li>`).join('')}</ul>`;
  const metaBrandDocs = brands.map((b) => link(docUrl(D.perBrand[b.id].meta), b.name)).join('');
  const metaPanel = section('meta', 'Meta – מודעות ממומנות', `
    ${galleryHint('לראות את הקריאייטיבים עצמם – גלריה, ותק ריצה ו-Top 10')}
    <p class="scope">${esc(scan.meta.scope)}</p>${legend()}
    <div class="grid2">
      ${bars({ title: 'תוצאות Meta לפי מפרסם', source: srcTag('meta', 'Meta Ad Library'), items: metaResultsItems, note: `<b>התאמת טקסט – לא ספירת מודעות; אין להשוות נפחים בין מותגים.</b> לא מוצגים בגרף (מנופח): ${inflatedMeta}` })}
      ${bars({ title: 'הריצה הארוכה ביותר (ימים)', source: srcTag('meta', 'Meta Ad Library'), items: longestItems, max: maxRun })}
    </div>
    ${dotChart}
    <div class="grid2">${formatSplit}${ctaSplit}</div>
    <div class="grid2">${perBrandStack}${signals}</div>
    <div class="grid2">${topics}<figure class="chart"><figcaption><b>רמות הצעה שנצפו</b>${srcTag('meta', 'Meta Ad Library')}</figcaption>${offerTiers}</figure></div>
    <h3>הערות שיטה</h3>${notesList(scan.meta.notes)}
    <h3>דוחות לפי מתחרה</h3><div class="links">${metaBrandDocs}</div>`,
    { docs: fullDoc(D.comparative.meta) + link(D.folders.meta, 'תיקיית Meta') });

  // ----- TikTok -----
  const ts = scan.tiktok.brandStats;
  const tikBrands = [...niche, ...ref].filter((b) => !ts[b.id].none);
  const followers = bars({ title: 'עוקבים', source: srcTag('tiktok', 'TikTok · פרופילים ציבוריים'), items: [...tikBrands].sort((a, b) => ts[b.id].followers - ts[a.id].followers).map((b) => ({ label: bdi(b.name), value: ts[b.id].followers, group: b.group, delta: delta('tiktok', b.id, 'followers') })) });
  const topViews = bars({ title: 'צפיות בפוסט המוביל', source: srcTag('tiktok', 'TikTok · אורגני'), items: [...tikBrands].sort((a, b) => ts[b.id].topViews - ts[a.id].topViews).map((b) => ({ label: bdi(b.name), value: ts[b.id].topViews, display: ts[b.id].topViewsLabel, group: b.group })) });
  const medians = bars({ title: 'חציון צפיות בפוסטים שנדגמו', source: srcTag('tiktok', 'TikTok · אורגני'), items: [...tikBrands].sort((a, b) => ts[b.id].medianViews - ts[a.id].medianViews).map((b) => ({ label: bdi(b.name), value: ts[b.id].medianViews, group: b.group })) });
  const sampleRows = tikBrands.map((b) => `<tr class="grp-${b.group}"><th scope="row">${bdi(b.name)} ${groupBadge(b.group)}</th><td dir="ltr">${num(ts[b.id].sample)}</td><td dir="ltr">${num(ts[b.id].selected)}</td><td dir="ltr">${ts[b.id].analysed}</td><td dir="ltr">${esc(ts[b.id].lastPost)}</td><td class="txt">${esc(ts[b.id].formats)}${ts[b.id].note ? `<br><small>${esc(ts[b.id].note)}</small>` : ''}</td></tr>`).join('');
  const sampleTable = `<div class="tablewrap"><table class="matrix"><caption>גודל מדגם לכל מותג ${srcTag('tiktok', 'TikTok · אורגני')}</caption><thead><tr><th>מותג</th><th>מדגם (פוסטים)</th><th>נבחרו (30%)</th><th>נותחו ויזואלית</th><th>פוסט אחרון</th><th>פורמטים דומיננטיים</th></tr></thead><tbody>${sampleRows}</tbody></table></div>
    <p class="fine">trygmila – לא נמצא חשבון. סכום מדגמי הנישה בטבלה: ${num(niche.reduce((a, b) => a + ts[b.id].sample, 0))} פוסטים; רפרנס: ${num(ref.filter((b) => !ts[b.id].none).reduce((a, b) => a + ts[b.id].sample, 0))} (חישוב מהטבלה).</p>`;
  const sound = stack({ title: 'סאונד ב-21 הפוסטים המובילים בנישה (3 לכל מותג)', source: srcTag('tiktok', 'TikTok · נספח יוצרים'), segments: [{ label: 'צליל מקורי', value: scan.tiktok.soundStat.original }, { label: 'סאונד אחר', value: scan.tiktok.soundStat.total - scan.tiktok.soundStat.original }], total: scan.tiktok.soundStat.total });
  const codes = `<div class="tablewrap"><table class="matrix"><caption>קודי יוצרים והנחות שנצפו ${srcTag('tiktok', 'TikTok · נספח יוצרים')}</caption><thead><tr><th>מותג</th><th>קוד</th><th>הצעה</th></tr></thead><tbody>${scan.tiktok.creatorCodes.map((c) => `<tr><th scope="row">${bdi(brandById[c.brand].name)}</th><td dir="ltr"><code>${esc(c.code)}</code></td><td class="txt">${esc(c.offer)}</td></tr>`).join('')}</tbody></table></div>
    <h4>סימוני שיתוף ממומן שנצפו</h4>${notesList(scan.tiktok.paidPartnership)}`;
  const tiktokPanel = section('tiktok', 'TikTok – תוכן אורגני בלבד', `
    <div class="callout warn"><b>חשוב:</b> אלה פוסטים אורגניים, לא מודעות ממומנות מאומתות. ספריית המודעות של TikTok לא מכסה ישראל. קריאייטיב אורגני חזק מצביע על כיוון, אך אינו הוכחה לביצועי מודעות.</div>
    ${galleryHint('לראות את הפוסטים המובילים (פריימים) בגלריה')}
    <p class="scope">${esc(scan.tiktok.scope)}</p>${legend()}
    <div class="grid2">${followers}${topViews}</div>
    ${medians}
    ${sampleTable}
    <div class="grid2">${sound}<figure class="chart"><figcaption><b>יוצרים</b>${srcTag('tiktok', 'TikTok · נספח יוצרים')}</figcaption><p class="big-stat"><b dir="ltr">${scan.tiktok.creatorsFound.brandsWithCreators}/${scan.tiktok.creatorsFound.nicheBrands}</b> מותגי נישה עם קריאייטיב יוצרים/UGC שנמצא בחיפוש הציבורי (goom, ecosupp, fillit, mayven, mycospring). ל-by-harmony ול-mycolivia לא נמצאו יוצרים עצמאיים.</p></figure></div>
    ${codes}
    <h3>דפוסים חוצי מותגים</h3>${notesList(scan.tiktok.patterns)}
    <h3>הערות שיטה</h3>${notesList(scan.tiktok.notes)}
    <h3>דוחות לפי מתחרה</h3><div class="links">${brands.map((b) => link(docUrl(D.perBrand[b.id].tiktok), b.name)).join('')}</div>`,
    { docs: fullDoc(D.comparative.tiktok) + fullDoc(D.extra.tiktokCreators.id, D.extra.tiktokCreators.label) + link(D.folders.tiktok, 'תיקיית TikTok') });

  // ----- Google -----
  const gs = scan.google.brandStats;
  const gBrands = [...niche, ...ref].filter((b) => gs[b.id].total > 0);
  const gTotals = bars({ title: 'סה״כ מודעות במרכז השקיפות של גוגל', source: srcTag('google', 'Google Ads Transparency Center'), items: [...gBrands].sort((a, b) => gs[b.id].total - gs[a.id].total).map((b) => ({ label: bdi(b.name), value: gs[b.id].total, display: (gs[b.id].approx ? '~' : '') + num(gs[b.id].total), group: b.group })), note: `<b>mywoof:</b> לא נמצאה תוצאה לישראל.` });
  const fmtNiche = niche.map((b) => ({ b, g: gs[b.id] }));
  const fmtStack = `<figure class="chart"><figcaption><b>פילוח פורמטים – אתרי נישה</b>${srcTag('google', 'Google Ads Transparency Center')}</figcaption><div class="bars">${fmtNiche.map(({ b, g }) => { const t = g.image + g.text + g.video; return `<div class="bar-row"><div class="bar-label">${bdi(b.name)}</div><div class="bar-track mini-stack">${[['image', 's0'], ['text', 's1'], ['video', 's2']].map(([k, c]) => g[k] ? `<div class="seg ${c}" style="width:${(g[k] / t) * 100}%"><span dir="ltr">${g[k]}</span></div>` : '').join('')}</div><div class="bar-val" dir="ltr">${g.total}${g.formatSumMismatch ? '<sup>*</sup>' : ''}</div></div>`; }).join('')}</div>
    <div class="legend"><span><i class="dot s0"></i>תמונה</span><span><i class="dot s1"></i>טקסט / חיפוש</span><span><i class="dot s2"></i>וידאו</span></div>
    <p class="fine">* EcoSupp: סה״כ 86 בדוח, אך סכום הפורמטים 97 – אי-התאמה בדוח המקור, מוצג כפי שהוא. אחוז טקסט: Mayven 94%, Mycolivia 76%, Fill It 64%, Harmony 61%.</p></figure>`;
  const cov = scan.google.nicheCoverage;
  const covRows = niche.map((b) => `<tr><th scope="row">${bdi(b.name)}</th><td dir="ltr">${gs[b.id].total}</td><td dir="ltr">${gs[b.id].target}</td><td dir="ltr">${gs[b.id].checked}</td><td dir="ltr">${gs[b.id].documented}</td><td dir="ltr">${gs[b.id].withCopy}</td><td dir="ltr">${gs[b.id].searchHits}</td></tr>`).join('');
  const covTable = `<div class="tablewrap"><table class="matrix"><caption>כיסוי המדגם בגוגל – אתרי נישה ${srcTag('google', 'Google Ads Transparency Center')}</caption><thead><tr><th>אתר</th><th>סה״כ מודעות</th><th>יעד 30%</th><th>נבדקו</th><th>מתועדות</th><th>עם קופי קריא</th><th>חיפוש אורגני (הופעות)</th></tr></thead><tbody>${covRows}<tr class="sum"><th scope="row">סה״כ נישה</th><td dir="ltr">${cov.total}</td><td dir="ltr">${cov.target}</td><td dir="ltr">${cov.checked} (${cov.checkedPct}%)</td><td dir="ltr">${cov.documented} (${cov.documentedPct}%)</td><td dir="ltr">${cov.withCopy}</td><td>—</td></tr></tbody></table></div>`;
  const covBar = bars({ title: 'כיסוי מול יעד ה-30% באתרי הנישה', source: srcTag('google', 'Google Ads Transparency Center'), max: cov.target, items: [{ label: 'יעד (30%)', value: cov.target, group: 'reference' }, { label: 'נבדקו', value: cov.checked, display: `${cov.checked} (${cov.checkedPct}%)` }, { label: 'מתועדות בפועל', value: cov.documented, display: `${cov.documented} (~${cov.documentedPct}%)` }] });
  const landing = `<div class="tablewrap"><table class="matrix"><caption>זווית במודעות והצעה בדף הנחיתה ${srcTag('google', 'Google Ads + דפי נחיתה')}</caption><thead><tr><th>אתר</th><th>זווית במודעות</th><th>הצעה / דף נחיתה</th></tr></thead><tbody>${niche.map((b) => `<tr><th scope="row">${bdi(b.name)}</th><td class="txt">${esc(gs[b.id].angle)}</td><td class="txt">${esc(gs[b.id].landing)}</td></tr>`).join('')}</tbody></table></div>`;
  const shipBars = bars({ title: 'סף משלוח חינם באתר (₪)', source: srcTag('google', 'דפי נחיתה'), max: 600, items: scan.google.freeShippingThresholds.map((t) => ({ label: bdi(brandById[t.brand].name), value: t.value, display: '₪' + t.value })), note: 'EcoSupp ו-Mayven: ללא סף מוצג.' });
  const googlePanel = section('google', 'Google – מודעות ושקיפות', `
    <div class="callout warn"><b>כיסוי נמוך:</b> רק ${cov.documented} מודעות מתועדות מתוך יעד של ${cov.target} באתרי הנישה (~${cov.documentedPct}%). המסקנות כיווניות. אין תאריך first-shown ולכן אין משך ריצה.</div>
    <p class="scope">${esc(scan.google.scope)}</p>${legend()}
    <div class="grid2">${gTotals}${fmtStack}</div>
    <div class="grid2">${covBar}${shipBars}</div>
    ${covTable}${landing}
    <h3>רמזי אד-טק (מקוד מקור ציבורי)</h3>${notesList(scan.google.adTech)}
    <h3>הערות ומגבלות</h3>${notesList(scan.google.notes)}
    <h3>דוחות לפי מתחרה</h3><div class="links">${brands.map((b) => link(docUrl(D.perBrand[b.id].google), b.name)).join('')}</div>`,
    { docs: fullDoc(D.comparative.google) + link(D.folders.google, 'תיקיית Google') });

  // ----- Organic -----
  const os = scan.organic.brandStats;
  const fbItems = [...niche, ...ref].filter((b) => os[b.id]?.fbFollowers).sort((a, b) => os[b.id].fbFollowers - os[a.id].fbFollowers).map((b) => ({ label: bdi(b.name), value: os[b.id].fbFollowers, group: b.group }));
  const ytItems = [...niche, ...ref].filter((b) => os[b.id]?.ytSubs).sort((a, b) => os[b.id].ytSubs - os[a.id].ytSubs).map((b) => ({ label: bdi(b.name), value: os[b.id].ytSubs, group: b.group }));
  const recItems = [...niche, ...ref].filter((b) => os[b.id]?.fbRecPct != null).sort((a, b) => os[b.id].fbRecPct - os[a.id].fbRecPct).map((b) => ({ label: bdi(b.name), value: os[b.id].fbRecPct, display: `${os[b.id].fbRecPct}% (${num(os[b.id].fbReviews)})`, group: b.group }));
  const organicPanel = section('organic', 'נראות אורגנית', `
    <div class="grid2"><div class="callout soon"><b>אינסטגרם – בהמשך.</b> ניתוח פרופילי אינסטגרם (10 פרופילים) עדיין לא בוצע – ההתחברות לא הושלמה. אין כאן נתונים מאינסטגרם מעבר לפיד מוטמע באתר GOOM.</div>
    <div class="callout warn"><b>מדגם פייסבוק קטן:</b> 2–5 פוסטים לדף, ללא תאריכים – לא מדד ביצועים.</div></div>
    <p class="scope">${esc(scan.organic.scope)}</p>${legend()}
    <div class="grid2">${bars({ title: 'עוקבי פייסבוק', source: srcTag('organic', 'פייסבוק'), items: fbItems, note: 'Fill It: הדף אינו זמין · Smiley, Woof: לא נמצא דף רשמי.' })}
    ${bars({ title: 'אחוז המלצות בדף פייסבוק (ומספר ביקורות)', source: srcTag('organic', 'פייסבוק'), max: 100, items: recItems })}</div>
    <div class="grid2">${bars({ title: 'מנויי YouTube', source: srcTag('organic', 'YouTube'), items: ytItems, note: 'נותחו 5 ערוצים; למותגים אחרים לא נמצא ערוץ / לא נותח.' })}
    <figure class="chart"><figcaption><b>קצב פרסום – GOOM (פיד אינסטגרם מוטמע)</b>${srcTag('organic', 'פיד IG מוטמע באתר')}</figcaption><p class="big-stat"><b dir="ltr">~5.5</b> פוסטים בחודש · חציון 22 לייקים · נותחו 30 מתוך 100 פוסטים</p></figure></div>
    <h3>מה בלט</h3>${notesList(scan.organic.highlights)}
    <h3>הערות ומגבלות</h3>${notesList(scan.organic.notes)}
    <h3>דוחות לפי מתחרה</h3><div class="links">${brands.map((b) => link(docUrl(D.perBrand[b.id].organic), b.name)).join('')}</div>`,
    { docs: fullDoc(D.comparative.organic) + fullDoc(D.extra.organicBlockers.id, D.extra.organicBlockers.label) + link(D.folders.organic, 'תיקיית נראות אורגנית') });

  // ----- Competitors -----
  const cards = brands.map((b) => {
    const c = scan.brandCards[b.id];
    const docs = D.perBrand[b.id];
    return `<article class="card" data-group="${b.group}"><header><div><h3>${bdi(b.name)} <small>${esc(b.heName)}</small></h3><a class="domain" dir="ltr" href="https://${esc(b.domain)}/" target="_blank" rel="noopener noreferrer">${esc(b.domain)}</a></div>${groupBadge(b.group)}</header>
      <p class="cat">${esc(b.category)}</p>
      <ul class="nums">${c.numbers.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      <dl><dt>הצעות</dt><dd>${esc(c.offers)}</dd><dt>הוקים</dt><dd>${esc(c.hooks)}</dd><dt>יוצרים</dt><dd>${esc(c.creators)}</dd><dt class="risk">סיכונים</dt><dd class="risk">${esc(c.risks)}</dd></dl>
      <p class="take-line"><b>בשורה התחתונה:</b> ${esc(c.takeaway)}</p>
      ${creatives.items.some((i) => i.brand === b.id) ? `<button type="button" class="fbtn cr-go" data-go-brand="${esc(b.id)}">🖼 הקריאייטיבים של ${bdi(b.name)} (${creatives.items.filter((i) => i.brand === b.id).length})</button>` : ''}
      <div class="links sm">${['meta', 'tiktok', 'google', 'organic'].map((p) => link(docUrl(docs[p]), PLATFORM_LABEL[p])).join('')}</div></article>`;
  }).join('');
  const compPanel = section('competitors', 'מתחרים', `
    <div class="filters" role="group" aria-label="סינון"><button class="fbtn on" data-filter="all">הכל (13)</button><button class="fbtn" data-filter="niche">נישה (7)</button><button class="fbtn" data-filter="reference">רפרנס (6)</button></div>
    <div class="cards" id="cards">${cards}</div>
    <p class="fine">מספרים בכרטיסים לקוחים מהדוחות; מקור כל נתון מצוין לפי פלטפורמה (Meta / Google / TikTok / פייסבוק). נישה = משקל גבוה; רפרנס = השראה לטרנדים בלבד.</p>`);

  // ----- Seasonality -----
  const S = scan.seasonality;
  const eventCards = data.events.map((e) => `<div class="ev-card"><div class="ev-n" data-days="${e.start}">${Math.max(daysTo(e.start), 0)}</div><div><h4>${esc(e.title)}</h4><p dir="ltr" class="ev-date">${esc(e.label)}</p><p class="fine">ימים מהיום</p></div></div>`).join('');
  const obsRows = S.observed.map((o) => `<tr class="grp-${o.group}" data-group="${o.group}"><th scope="row">${bdi(brandById[o.brand].name)} ${groupBadge(o.group)}</th><td>${esc(o.event)}</td><td class="txt">${esc(o.text)}</td><td>${chip(o.platform)}</td></tr>`).join('');
  const seasonPanel = section('trends', 'מגמות ועונתיות', `
    <div class="ev-cards">${eventCards}</div>
    <h3>תוכנית עונתית מומלצת</h3>
    <ol class="timeline">${S.plan.map((p) => `<li><b>${esc(p.when)}</b><span>${esc(p.what)}</span></li>`).join('')}</ol>
    <h3>מבצעים עונתיים שנצפו אצל מתחרים</h3>
    <div class="filters" role="group"><button class="fbtn on" data-tfilter="all">הכל</button><button class="fbtn" data-tfilter="niche">נישה</button><button class="fbtn" data-tfilter="reference">רפרנס</button></div>
    <div class="tablewrap"><table class="matrix" id="obs"><thead><tr><th>מותג</th><th>אירוע</th><th>מה נצפה</th><th>מקור</th></tr></thead><tbody>${obsRows}</tbody></table></div>
    <p class="fine">${esc(S.note)} בלאק פריידיי: אף מותג לא פרסם עדיין (במדגם).</p>
    <h3>מגמות שוק</h3>${notesList(S.trends)}`,
    { docs: fullDoc(D.comparative.meta, 'Meta – מגמות') + fullDoc(D.comparative.google, 'Google – מגמות') });

  // ----- Actions -----
  const actRows = scan.actionsFull.map((a) => `<tr data-pr="${esc(a.priority)}"><th scope="row" dir="ltr">${esc(a.id)}</th><td class="txt"><b>${esc(a.title)}</b><br><small>על בסיס: ${esc(a.basis)}</small></td><td><span class="tag pr-${esc(a.priority)}">${esc(a.priority)}</span></td><td>${esc(a.effort)}</td><td>${esc(a.when)}</td><td>${chip(a.platform)}</td></tr>`).join('');
  const actionsPanel = section('actions', 'המלצות ליישום', `
    <p class="scope">רשימת פעולות לחנות של אייל (תוסף תזונה נישתי, Shopify). עדיפות מבוססת על הדוחות; <b>הערכת המאמץ היא שלנו</b> (לא מהדוחות). ספי תקציב ו-KPI ייקבעו לפי מחיר המוצר והמרווח (לא ידועים).</p>
    <div class="filters" role="group"><button class="fbtn on" data-pfilter="all">הכל</button><button class="fbtn" data-pfilter="גבוהה">עדיפות גבוהה</button><button class="fbtn" data-pfilter="בינונית">בינונית</button><button class="fbtn" data-pfilter="נמוכה">נמוכה</button></div>
    <div class="tablewrap"><table class="matrix" id="acts"><thead><tr><th>#</th><th>פעולה</th><th>עדיפות</th><th>מאמץ</th><th>מתי</th><th>פלטפורמה</th></tr></thead><tbody>${actRows}</tbody></table></div>
    <p class="fine">⚠ כל טענת בריאות במודעה צריכה בדיקה רגולטורית – ראו ״סיכונים רגולטוריים״.</p>`,
    { docs: fullDoc(D.comparative.meta, 'Meta – המלצות') + fullDoc(D.comparative.tiktok, 'TikTok – המלצות') + fullDoc(D.comparative.google, 'Google – המלצות') });

  // ----- Regulatory -----
  const R = scan.regulatory;
  const regRows = R.observed.map((o) => `<tr><th scope="row">${bdi(brandById[o.brand].name)} ${groupBadge(brandById[o.brand].group)}</th><td class="txt">${esc(o.claim)}</td><td><span class="tag lv">${esc(o.level)}</span></td><td>${chip(o.platform)}</td></tr>`).join('');
  const regPanel = section('regulatory', 'סיכונים רגולטוריים – טענות בריאות', `
    <div class="callout warn">${esc(R.intro)}</div>
    <div class="tablewrap"><table class="matrix"><caption>טענות שנצפו אצל מתחרים – לא להעתיק</caption><thead><tr><th>מתחרה</th><th>טענה / פרקטיקה</th><th>רמת סיכון</th><th>מקור</th></tr></thead><tbody>${regRows}</tbody></table></div>
    <h3>כללי עבודה בטוחים יותר לחנות של אייל</h3>${notesList(R.guidelines)}`,
    { docs: fullDoc(D.comparative.tiktok, 'TikTok – סיכונים') + fullDoc(D.comparative.meta, 'Meta') + fullDoc(D.comparative.google, 'Google') });

  // ----- Limitations -----
  const stClass = (s) => (s === 'בהמשך' ? 'soon' : s.includes('~20') || s.includes('חלקי') || s.includes('אורגני בלבד') ? 'part' : 'info');
  const limCards = scan.limitations.map((l) => `<article class="lim"><header><h3>${l.platform === 'instagram' ? 'Instagram' : esc(PLATFORM_LABEL[l.platform] || l.platform)}</h3><span class="status st-${stClass(l.status)}">${esc(l.status)}</span></header><dl><dt>מה נותח</dt><dd>${esc(l.analysed)}</dd><dt>מה לא / מגבלות</dt><dd>${esc(l.missing)}</dd></dl></article>`).join('');
  const limPanel = section('limits', 'מגבלות וכיסוי', `
    <p class="scope">הלוח מציג רק מספרים שמופיעים בדוחות. כשנתון לא נמצא – הוא לא מוצג. קהל משוער, זווית וטון הם הסקה. אין נתוני תקציב.</p>
    <div class="lim-grid">${limCards}</div>
    <h3>הוספת סריקה שבועית</h3>
    <p>הנתונים נמצאים בקובץ אחד: <code dir="ltr">data/data.json</code>. כדי להוסיף שבוע, מוסיפים אובייקט חדש בסוף המערך <code dir="ltr">scans</code> (מעתיקים את האחרון ומעדכנים). הלוח יציג את הסריקה האחרונה, יסמן שינויים (Δ) לעומת הקודמת, וישמור ארכיון.</p>
    ${scans.length > 1 ? `<p>סריקות זמינות: ${scans.map((s) => `<a href="${s.id === scans[scans.length - 1].id ? '/' : `/archive/${s.id}/`}">${esc(s.date)}</a>`).join(' · ')}</p>` : '<p class="fine">כרגע קיימת סריקה אחת (סריקה חד-פעמית ראשונה).</p>'}`);

  const tabs = [['creatives', 'קריאייטיבים חזקים'], ['top10', 'Top 10 השבוע'], ['mailers', 'מיילרים'], ['overview', 'סקירה כללית'], ['meta', 'Meta'], ['tiktok', 'TikTok'], ['google', 'Google'], ['organic', 'נראות אורגנית'], ['competitors', 'מתחרים'], ['trends', 'מגמות ועונתיות'], ['actions', 'המלצות ליישום'], ['regulatory', 'סיכונים רגולטוריים'], ['limits', 'מגבלות וכיסוי']];
  const nav = `<nav class="tabs" aria-label="סעיפים"><div class="tabs-in" role="tablist">${tabs.map(([id, t], i) => `<a href="#${id}" role="tab" data-go="${id}" class="${i === 0 ? 'on ' : ''}${i < 2 ? 'hot' : ''}">${t}</a>`).join('')}</div></nav>`;

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light">
<title>${esc(data.site.title)} · ${esc(scan.date)}</title>
<meta name="description" content="דשבורד מנהלים בעברית: ניתוח מתחרים בנישת תוספי התזונה – Meta, TikTok, Google, נראות אורגנית.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700;800&display=swap">
<link rel="stylesheet" href="/style.css">
<script>document.documentElement.classList.add('js')</script>
</head>
<body>
${header}
<main>
${nav}
<div class="panels">
${creativesPanel}
${top10Panel}
${mailersPanel}
${overview}
${metaPanel}
${tiktokPanel}
${googlePanel}
${organicPanel}
${compPanel}
${seasonPanel}
${actionsPanel}
${regPanel}
${limPanel}
</div>
${CR.lightbox}
</main>
<footer class="foot"><p>סריקה ראשונה: ${esc(scan.date)} · מקורות ציבוריים, קריאה בלבד · ללא מעקב וללא עוגיות · מבוסס על דוחות Google Drive (ראו ״למסמך המלא״ בכל סעיף).</p></footer>
<script src="/app.js" defer></script>
</body></html>`;
}

// ---------- write pages ----------
const scans = data.scans;
const latest = scans[scans.length - 1];
const prevOf = (i) => (i > 0 ? scans[i - 1] : null);
writeFileSync(join(dist, 'index.html'), render(latest, prevOf(scans.length - 1), { isLatest: true, scans }));
scans.slice(0, -1).forEach((s, i) => {
  const dir = join(dist, 'archive', s.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), render(s, prevOf(i), { isLatest: false, scans }));
});
console.log(`built ${scans.length} scan page(s) → dist/`);
