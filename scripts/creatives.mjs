// Creative-first views: gallery ("קריאייטיבים חזקים") and weekly Top 10. Pure string rendering, no deps.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const TEST_MAX = 14;     // days: <= 14 => "במבחן"
export const WINNER_MIN = 90;   // days: >= 90 => "ותיקה · מנצחת" (same as the Meta bot's `stage`)
const FMT = { image: 'תמונה', video: 'וידאו', carousel: 'קרוסלה', unknown: 'לא תועד' };
const SRC_LABEL = { meta: 'Meta', tiktok: 'TikTok', organic: 'אורגני', youtube: 'YouTube', instagram: 'Instagram', facebook: 'Facebook' };
const plat = (it) => it.plat || it.source;
const CTYPE = { creator: 'יוצר / UGC', partnership: 'שיתוף פעולה מסומן', organic: 'אורגני' };
const PHASE = {
  test: ['במבחן', 'ריצה קצרה (עד 14 ימים) – עדיין נבדקת'],
  running: ['בינונית', '15–89 ימים'],
  winner: ['ותיקה · מנצחת', '90+ ימים – המפרסם ממשיך לשלם עליה'],
  organic: ['אורגני', 'פוסט אורגני, לא מודעה ממומנת'],
  na: ['משך לא ידוע', ''],
};

export function loadJson(root, rel, fallback) {
  const p = join(root, rel);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback;
}

export function phaseOf(it) {
  if (it.source !== 'meta') return 'organic';
  const STAGE = { 'במבחן': 'test', 'בינונית': 'running', 'ותיקה/מנצחת': 'winner' };
  if (it.stage && STAGE[it.stage]) return STAGE[it.stage];   // the bot's stage is the source of truth
  const d = it.days_active;
  if (d == null) return 'na';
  return d <= TEST_MAX ? 'test' : d >= WINNER_MIN ? 'winner' : 'running';
}

export function makeRenderer({ esc, brandName, srcTag, link, section, daysTo, specs = {} }) {
  const specOf = (it) => { const ids = [it.library_id, ...(String(it.post_url || it.video_url || '').match(/\d{15,}/g) || [])].filter(Boolean); for (const k of ids) if (specs[k]) return specs[k]; return null; };
  const specLinks = (sp) => sp ? `<div class="cr-specs">${sp.map((x) => `<a class="spec-tag" href="/specs/${esc(x.file.replace(/\.html$/, ''))}" target="_blank" rel="noopener">📄 ${esc(x.label)}</a>`).join('')}</div>` : '';
  const compact = (v) => {
    if (v == null || v === '') return '';
    const n = Number(String(v).replace(/,/g, ''));
    if (!Number.isFinite(n)) return esc(v);
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return String(n);
  };
  const oneLine = (s, n = 140) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };
  const platChip = (it) => `<span class="chip plat-${esc(plat(it))}">${esc(SRC_LABEL[plat(it)] || plat(it))}</span>`;

  function media(it, { big = false } = {}) {
    const ph = phaseOf(it);
    const days = it.source === 'meta' && it.days_active != null ? `<span class="cr-days"><b>${it.days_active}</b><small>ימים</small></span>`
      : it.source !== 'meta' && it.days_since_posted != null ? `<span class="cr-days"><small>לפני</small><b>${it.days_since_posted}</b><small>ימים</small></span>` : '';
    const phLabel = ph === 'organic' ? (CTYPE[it.ctype] || 'אורגני') : PHASE[ph][0];
    const phase = `<span class="cr-phase ph-${ph}">${phLabel}${it.status === 'inactive' ? ' · הופסקה' : ''}</span>`;
    const fmt = `<span class="cr-fmt">${FMT[it.format] || FMT.unknown}</span>`;
    const inner = it.image
      ? `<img src="/${esc(it.image)}" alt="${esc(`${brandName(it.brand)} – ${oneLine(it.hook || it.copy_text, 60)}`)}" loading="lazy" decoding="async">`
      : `<div class="cr-ph"><div class="cr-ph-ic" aria-hidden="true">🖼</div><b>אין תמונה זמינה</b>${it.library_url || it.post_url ? `<a href="${esc(it.library_url || it.post_url)}" target="_blank" rel="noopener noreferrer" data-stop>${it.source === 'meta' ? 'צפייה בספריית המודעות' : 'צפייה בפוסט'} ↗</a>` : ''}</div>`;
    return `<div class="cr-media${big ? ' big' : ''}" role="button" tabindex="0" aria-label="הגדלה">${inner}${days}${phase}${fmt}</div>`;
  }

  function facts(it) {
    const f = [];
    if (it.offer) f.push(`<li class="f-offer"><small>הצעה</small>${esc(oneLine(it.offer, 90))}</li>`);
    if (it.cta) f.push(`<li><small>CTA</small>${esc(it.cta)}</li>`);
    if (it.variants_count != null) f.push(`<li><small>גרסאות</small><b dir="ltr">${it.variants_count}</b></li>`);
    else if (it.multiple_versions) f.push(`<li><small>גרסאות</small>מרובות</li>`);
    if (it.source !== 'meta') {
      if (it.views != null) f.push(`<li><small>צפיות</small><b dir="ltr">${compact(it.views)}</b></li>`);
      if (it.likes != null) f.push(`<li><small>לייקים</small><b dir="ltr">${compact(it.likes)}</b></li>`);
      if (it.comments != null) f.push(`<li><small>תגובות</small><b dir="ltr">${compact(it.comments)}</b></li>`);
      if (it.shares != null) f.push(`<li><small>שיתופים</small><b dir="ltr">${compact(it.shares)}</b></li>`);
    }
    return f.length ? `<ul class="cr-facts">${f.join('')}</ul>` : '';
  }

  function detail(it) {
    const fam = it.copy_scope === 'family' ? ' (טקסט ברמת משפחת קריאייטיב)' : '';
    const rows = [
      ['משך ריצה', it.days_active != null ? `${it.days_active} ימים${it.start_date ? ` (מ-${it.start_date.split('-').reverse().join('.')})` : ''}` : (it.source === 'meta' ? `לא ידוע${it.days_since_start != null ? ` · ${it.days_since_start} ימים מאז ההתחלה` : ''}` : '')],
      ['שלב', it.source === 'meta' ? (it.stage || 'לא ידוע') : ''],
      ['פלטפורמה', it.source === 'meta' ? (it.platform || 'לא ידוע') : it.platform], ['פורמט', FMT[it.format]], ['שפה', it.language || it.copy_language],
      ['הצעה' + fam, it.offer], ['CTA' + fam, it.cta],
      ['גרסאות', it.variants_count ?? (it.multiple_versions ? 'מרובות (מספר לא ידוע)' : '')],
      ['הוק', it.hook], ['קופי' + fam, it.copy_text], ['תרגום הקופי', it.copy_text_he], ['הערות קריאייטיב', it.creative_notes],
      ['תאריך פרסום', it.post_date],
    ].filter(([, v]) => v !== '' && v != null);
    const src = it.library_url || it.post_url;
    return `<div class="lb-detail" hidden><h3>${esc(brandName(it.brand))}</h3><div class="lb-chips">${platChip(it)}<span class="tag">${esc(phaseOf(it) === 'organic' ? (CTYPE[it.ctype] || 'אורגני') : PHASE[phaseOf(it)][0])}</span></div>
      <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      ${it.copy_scope === 'family' ? `<p class="lb-caveat">הקופי, ההצעה וה-CTA מופיעים ברמת משפחת הקריאייטיב כפי שתועדו בדוח – לא אומתו פר-מודעה.${it.copy_note ? ' ' + esc(it.copy_note) + '.' : ''}</p>` : ''}
      ${it.source === 'meta' ? '<p class="lb-caveat">מעורבות (לייקים/הוצאה) אינה מוצגת בספריית המודעות.</p>' : ''}
      ${it.landing_url ? `<a class="lb-src" href="${esc(it.landing_url)}" target="_blank" rel="noopener noreferrer">דף נחיתה ↗</a> ` : ''}
      ${src ? `<a class="lb-src" href="${esc(src)}" target="_blank" rel="noopener noreferrer">${it.source === 'meta' ? 'צפייה במודעה בספריית Meta' : 'צפייה בפוסט המקורי'} ↗</a>` : ''}</div>`;
  }

  function card(it, { size = '', rank, basis } = {}) {
    const ph = phaseOf(it);
    const hook = it.hook || oneLine(it.copy_text, 110);
    const src = it.library_url || it.post_url;
    const sp = specOf(it);
    return `<article class="cr ${size}" data-spec="${sp ? 1 : 0}" data-id="${esc(it.id)}" data-source="${esc(it.source)}" data-plat="${esc(plat(it))}" data-format="${esc(it.format)}" data-phase="${ph}" data-brand="${esc(it.brand)}" data-run="${it.days_active ?? -1}" data-variants="${it.variants_count ?? 0}" data-views="${Number(String(it.views ?? '').replace(/,/g, '')) || 0}" data-start="${esc(it.start_date || it.post_date || '')}">
      ${rank ? `<span class="t10-rank" aria-label="מקום ${rank}">${rank}</span>` : ''}
      ${media(it, { big: size === 'lg' })}
      <div class="cr-body">
        <div class="cr-badges">${platChip(it)}${it.source === 'meta' && it.platform ? `<span class="brand-tag">${it.platform === 'Facebook + Instagram' ? 'FB + IG' : esc(it.platform)}</span>` : ''}<span class="brand-tag">${esc(brandName(it.brand))}</span></div>
        ${specLinks(sp)}
        ${basis ? `<p class="cr-basis">${esc(basis)}</p>` : ''}
        ${hook ? `<p class="cr-hook">${esc(oneLine(hook, 120))}</p>` : ''}
        ${facts(it)}
        ${it.creative_notes ? `<p class="cr-note">${esc(oneLine(it.creative_notes, size === 'lg' ? 220 : 130))}</p>` : ''}
        ${src ? `<a class="cr-src" href="${esc(src)}" target="_blank" rel="noopener noreferrer">${it.source === 'meta' ? 'המודעה בספריית Meta' : 'הפוסט המקורי'} ↗</a>` : ''}
      </div>${detail(it)}</article>`;
  }

  const lightbox = `<div id="lb" class="lb" role="dialog" aria-modal="true" aria-label="תצוגת קריאייטיב" hidden>
    <div class="lb-in"><button class="lb-x" type="button" aria-label="סגירה" data-lb-close>✕</button>
    <button class="lb-nav lb-prev" type="button" aria-label="הקודם" data-lb-prev>›</button><button class="lb-nav lb-next" type="button" aria-label="הבא" data-lb-next>‹</button>
    <div class="lb-img"></div><div class="lb-meta"></div></div></div>`;

  // ---------- gallery ----------
  function galleryPanel({ creatives, brands, scanDate, asof }) {
    const items = creatives.items || [];
    const ads = items.filter((i) => i.source === 'meta');
    const withImg = items.filter((i) => i.image).length;
    const winners = ads.filter((i) => phaseOf(i) === 'winner').sort((a, b) => b.days_active - a.days_active);
    const tests = ads.filter((i) => phaseOf(i) === 'test').sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''));
    const newWeek = ads.filter((i) => i.start_date && asof && (new Date(asof) - new Date(i.start_date)) / 86400000 <= 7).sort((a, b) => b.start_date.localeCompare(a.start_date));
    const legendPh = `<div class="cr-legend"><span><i class="ph-dot ph-test"></i><b>במבחן</b> עד ${TEST_MAX} ימים</span><span><i class="ph-dot ph-running"></i><b>בינונית</b> ${TEST_MAX + 1}–${WINNER_MIN - 1}</span><span><i class="ph-dot ph-winner"></i><b>ותיקה · מנצחת</b> ${WINNER_MIN}+ ימים (מפרסם שממשיך לשלם = כנראה עובדת)</span><span><i class="ph-dot ph-organic"></i><b>אורגני</b> לא ממומן</span></div>`;
    if (!items.length) {
      return section('creatives', 'קריאייטיבים חזקים', `<div class="cr-empty"><div class="cr-empty-ic" aria-hidden="true">🖼</div><h3>הגלריה ממתינה לנכסים</h3>
        <p>כאן יופיעו הקריאייטיבים עצמם (תמונה / פריים), עם ימי ריצה, פורמט, הצעה ו-CTA – מסוננים לפי פלטפורמה, פורמט וסטטוס (במבחן / ותיקה).</p>
        <p class="fine">הנכסים נאספים לתיקייה <code dir="ltr">/workspace/social/creatives/{meta,tiktok,organic}/index.json</code> ומיובאים עם <code dir="ltr">node scripts/import-creatives.mjs</code>. עד אז לא מוצגים נתונים מומצאים.</p></div>${legendPh}`);
    }
    const strip = (title, sub, arr, id) => arr.length ? `<div class="strip" id="${id}"><div class="strip-head"><h3>${title}</h3><p class="fine">${sub}</p></div><div class="strip-row cr-list">${arr.slice(0, 10).map((i) => card(i, { size: 'sm' })).join('')}</div></div>` : '';
    const opt = (arr) => arr.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
    const brandOpts = [...new Set(items.map((i) => i.brand))].map((b) => [b, brandName(b)]).sort((a, b) => a[1].localeCompare(b[1]));
    const sel = (id, label, options) => `<label class="sel"><span>${label}</span><select id="${id}"><option value="">הכל</option>${opt(options)}</select></label>`;
    const org = items.length - ads.length;
    const stats = `<div class="cr-stats"><div><b dir="ltr">${items.length}</b><span>קריאייטיבים בגלריה (${withImg} עם תמונה)</span></div><div><b dir="ltr">${ads.length}</b><span>מודעות Meta ממומנות</span></div><div><b dir="ltr">${org}</b><span>פוסטים אורגניים / יוצרים</span></div><div><b dir="ltr">${winners.length}</b><span>מודעות ותיקות (${WINNER_MIN}+ ימים)</span></div><div><b dir="ltr">${tests.length}</b><span>מודעות במבחן (עד ${TEST_MAX} ימים)</span></div><div><b dir="ltr">${newWeek.length}</b><span>התחילו ב-7 הימים האחרונים</span></div></div>`;
    const noAds = ads.length ? '' : `<div class="callout soon"><b>קריאייטיבי Meta ממומנים – בדרך.</b> הרצועות ״מנצחות מוכחות״ ו״בדיקות חדשות״ ייפתחו כשייובאו מודעות Meta עם תאריכי התחלה. עד אז הגלריה מציגה רק תוכן אורגני / יוצרים (TikTok, YouTube, Instagram) – אלה אינם מודעות ממומנות ואין להם ״ימי ריצה״.</div>`;
    const missing = items.length - withImg;
    return section('creatives', 'קריאייטיבים חזקים', `
      <details class="howto"><summary>איך קוראים את הגלריה</summary><p class="scope">הקריאייטיבים עצמם – לפי ותק ריצה. מודעה ממומנת שרצה זמן רב = המפרסם ממשיך לשלם עליה, ולכן היא מועמדת ל״מנצחת״. מודעה קצרה (עד ${TEST_MAX} ימים) = ככל הנראה במבחן. נכון ל-${esc(asof || scanDate)}; ימי ריצה מתאריך ההתחלה בהנחה שהמודעה פעילה. אין נתוני הוצאה או מעורבות למודעות Meta בישראל.</p>${legendPh}</details>
      ${noAds}${stats}
      ${strip('מנצחות מוכחות – הריצות הארוכות ביותר', `${WINNER_MIN}+ ימים פעילות`, winners, 'strip-winners')}
      ${strip('בדיקות חדשות', newWeek.length ? 'התחילו ב-7 הימים האחרונים' : `קצרות (עד ${TEST_MAX} ימים) – מועמדות ל״במבחן״`, newWeek.length ? newWeek : tests, 'strip-tests')}
      <h3 class="gal-h">כל הקריאייטיבים</h3>
      <div class="cr-filters" role="group" aria-label="סינון קריאייטיבים">
        ${sel('f-source', 'פלטפורמה', [...new Set(items.map(plat))].map((k) => [k, k === 'meta' ? 'Meta (ממומן)' : `${SRC_LABEL[k] || k} (אורגני)`]))}
        ${sel('f-format', 'פורמט', [['image', 'תמונה'], ['video', 'וידאו'], ['carousel', 'קרוסלה'], ['unknown', 'לא תועד']])}
        ${sel('f-phase', 'סטטוס', [['test', 'במבחן'], ['running', 'בינונית'], ['winner', 'ותיקה · מנצחת'], ['na', 'משך לא ידוע'], ['organic', 'אורגני / יוצר']])}
        ${sel('f-brand', 'מותג', brandOpts)}
        <label class="sel"><span>מיון</span><select id="f-sort"><option value="days">ימי ריצה – מהארוך</option><option value="days-asc">ימי ריצה – מהקצר</option><option value="new">הכי חדש</option><option value="variants">מספר גרסאות</option><option value="views">צפיות (אורגני)</option></select></label>
        <label class="chk"><input type="checkbox" id="f-img"> רק עם תמונה</label>
        <label class="chk"><input type="checkbox" id="f-spec"> עם אפיון</label>
        <span class="cr-count fine" id="cr-count" aria-live="polite"></span>
      </div>
      <div class="cr-grid cr-list" id="cr-grid">${items.map((i) => card(i)).join('')}</div>
      <p class="more-wrap"><button type="button" class="fbtn more" id="cr-more" hidden>הצג עוד</button></p>
      <p class="cr-none fine" id="cr-none" hidden>אין קריאייטיבים התואמים לסינון.</p>
      ${missing ? `<p class="fine">${missing} פריטים ללא תמונה זמינה מוצגים עם מקום שמור וקישור למקור – לא נוצרה תמונה חלופית.</p>` : ''}`);
  }

  // ---------- top 10 ----------
  function top10Panel({ top10, creatives, brands, scanDate }) {
    const weeks = Object.values(top10.weeks || {}).sort((a, b) => a.key.localeCompare(b.key));
    const fmtD = (d) => d.split('-').reverse().join('.');
    if (!weeks.length) {
      const ph = Array.from({ length: 10 }, (_, k) => `<div class="t10-empty"><span class="t10-rank">${k + 1}</span><div class="cr-ph"><div class="cr-ph-ic" aria-hidden="true">🖼</div><b>ממתין לנתונים</b></div></div>`).join('');
      return section('top10', 'Top 10 – עשרת המובילים השבוע', `<p class="scope">סטוריבורד שבועי של עשר המודעות המובילות: הקריאייטיב עצמו + מדדים מובילים. יתמלא אוטומטית אחרי ייבוא הקריאייטיבים (<code dir="ltr">node scripts/import-creatives.mjs</code>).</p><div class="t10-grid">${ph}</div>`);
    }
    const latest = weeks[weeks.length - 1];
    const block = (w, on) => {
      const empty = Math.max(0, 10 - w.items.length);
      const basisOf = (i, s) => (i.basis === 'likes' ? `לייקים ${compact(i.likes)}` : `צפיות ${compact(i.views)}`);
      const org = (w.strips || []).map((s) => `<h3 class="gal-h">${esc(s.title)}</h3><p class="fine">${esc(s.basis)}. אורגני – אינו חלק מדירוג המודעות הממומנות.</p><div class="strip-row cr-list">${s.items.map((i) => card(i, { size: 'sm', rank: i.rank, basis: 'דירוג לפי: ' + basisOf(i, s) })).join('')}</div>`).join('');
      return `<div class="t10-week" data-week="${esc(w.key)}"${on ? '' : ' hidden'}>
        ${w.items.length ? '' : '<div class="cr-empty"><div class="cr-empty-ic" aria-hidden="true">🖼</div><h3>דירוג מודעות Meta ממתין לנכסים</h3><p>עשרת המודעות הממומנות יופיעו כאן כשיובאו קריאייטיבי Meta עם תאריכי התחלה. מתחת – תוכן אורגני מוביל, מסומן בנפרד.</p></div>'}
        <div class="t10-cards cr-list t10-grid"${w.items.length ? '' : ' hidden'}>${w.items.map((i) => card(i, { size: 'lg', rank: i.rank, basis: `דירוג לפי: ותק ${i.days_active} ימים${i.variants_count != null ? ` · ${i.variants_count} גרסאות` : ''}` })).join('')}${(w.items.length ? Array.from({ length: empty }, (_, k) => `<div class="t10-empty"><span class="t10-rank">${w.items.length + k + 1}</span><div class="cr-ph"><div class="cr-ph-ic" aria-hidden="true">🖼</div><b>אין מספיק מודעות עדיין</b></div></div>`) : []).join('')}</div>
        ${org}<p class="fine">צילום מצב שנוצר ב-${esc(fmtD(w.asof))}.</p></div>`;
    };
    const weekSel = weeks.length > 1 ? `<label class="sel"><span>שבוע</span><select id="t10-week">${[...weeks].reverse().map((w) => `<option value="${esc(w.key)}">שבוע ${w.week} · ${fmtD(w.start)}–${fmtD(w.end)}</option>`).join('')}</select></label>` : '';
    return section('top10', 'Top 10 – עשרת המובילים השבוע', `
      <div class="t10-head"><div><span class="t10-weeklabel">שבוע ${latest.week} · ${fmtD(latest.start)}–${fmtD(latest.end)}</span><p class="fine">נכון ל-${esc(fmtD(latest.asof))}</p></div>${weekSel}</div>
      <div class="callout t10-method"><b>מודעות Meta ממומנות – איך מדורגים?</b> ${esc(latest.method)}</div>
      ${weeks.slice().reverse().map((w, k) => block(w, k === 0)).join('')}`);
  }

  return { galleryPanel, top10Panel, card, lightbox, specOf };
}
