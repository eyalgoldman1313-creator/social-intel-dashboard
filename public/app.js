(function () {
  var panels = Array.prototype.slice.call(document.querySelectorAll('.panel'));
  var links = Array.prototype.slice.call(document.querySelectorAll('[data-go]'));
  var DEFAULT = 'top10';
  function show(id) {
    var el = id ? document.getElementById(id) : null;
    var panel = el && el.classList.contains('panel') ? el : null;
    var scroll = null;
    // #regulatory is a subsection inside המלצות ליישום, not its own tab.
    if (id === 'regulatory' && el) { panel = el.closest('.panel'); scroll = el; }
    if (panel && panel.id === 'limits') scroll = panel;
    if (!panel) panel = document.getElementById(DEFAULT);
    var pid = panel.id;
    panels.forEach(function (p) { p.classList.toggle('on', p.id === pid); });
    links.forEach(function (l) { l.classList.toggle('on', l.getAttribute('data-go') === pid); });
    var on = document.querySelector('.tabs a.on');
    if (on && on.scrollIntoView) on.scrollIntoView({ inline: 'center', block: 'nearest' });
    if (scroll && scroll.scrollIntoView) scroll.scrollIntoView({ behavior: 'smooth', block: 'start' });
    syncOpenPanel();
  }
  function parseMediaHash() {
    var raw = '';
    try { raw = decodeURIComponent((location.hash || '').replace(/^#/, '')); }
    catch (e) { raw = (location.hash || '').replace(/^#/, ''); }
    var m = raw.match(/^([A-Za-z0-9_-]+)(?:\/(all|video|image))?$/);
    if (!m) return { id: raw, media: null };
    return { id: m[1], media: m[2] || null };
  }
  function fromHash() { show(parseMediaHash().id); }
  links.forEach(function (l) {
    l.addEventListener('click', function (e) {
      e.preventDefault();
      var id = l.getAttribute('data-go');
      history.replaceState(null, '', '#' + id);
      show(id);
      var t = document.querySelector('.tabs');
      if (t) window.scrollTo({ top: t.offsetTop - 2, behavior: 'smooth' });
    });
  });
  var hashLock = false;
  window.addEventListener('hashchange', function () {
    hashLock = true;
    try { fromHash(); } finally { hashLock = false; }
  });
  fromHash();

  // Arrow keys follow the tablist DOM order (RTL: ArrowLeft = next, ArrowRight = previous).
  document.addEventListener('keydown', function (e) {
    var key = e.key;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return;
    if (document.body.classList.contains('lb-open')) return;
    var cur = e.target && e.target.closest ? e.target.closest('.tabs a[role="tab"]') : null;
    if (!cur) return;
    var list = Array.prototype.slice.call(document.querySelectorAll('.tabs a[role="tab"]'));
    var i = list.indexOf(cur);
    if (i < 0) return;
    var n = i;
    if (key === 'Home') n = 0;
    else if (key === 'End') n = list.length - 1;
    else {
      var forward = document.documentElement.getAttribute('dir') === 'rtl' ? key === 'ArrowLeft' : key === 'ArrowRight';
      n = (i + (forward ? 1 : -1) + list.length) % list.length;
    }
    e.preventDefault();
    var dest = list[n];
    var go = dest.getAttribute('data-go');
    history.replaceState(null, '', '#' + go);
    show(go);
    dest.focus();
  });

  // generic filter buttons
  function wire(attr, apply) {
    document.querySelectorAll('[' + attr + ']').forEach(function (b) {
      b.addEventListener('click', function () {
        b.parentNode.querySelectorAll('.fbtn').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        apply(b.getAttribute(attr));
      });
    });
  }
  wire('data-filter', function (v) {
    document.querySelectorAll('#cards .card').forEach(function (c) { c.style.display = v === 'all' || c.dataset.group === v ? '' : 'none'; });
  });
  wire('data-tfilter', function (v) {
    document.querySelectorAll('#obs tbody tr').forEach(function (r) { r.style.display = v === 'all' || r.dataset.group === v ? '' : 'none'; });
  });
  wire('data-pfilter', function (v) {
    document.querySelectorAll('#acts tbody tr').forEach(function (r) { r.style.display = v === 'all' || r.dataset.pr === v ? '' : 'none'; });
  });

  // inline "go to tab" links (e.g. from Meta tab to gallery)
  document.querySelectorAll('a[data-go]:not(.tabs a)').forEach(function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); var id = a.getAttribute('data-go'); history.replaceState(null, '', '#' + id); show(id); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  });

  // ---- creatives gallery: filter + sort ----
  var grid = document.getElementById('cr-grid');
  var $ = function (id) { return document.getElementById(id); };
  var PAGE = 24, shown = PAGE;
  function applyGallery(reset) {
    if (!grid) return;
    if (reset === true) shown = PAGE;
    var mv = 'all';
    var mp = grid.closest('.panel');
    if (mp) { var mb = mp.querySelector('.media-filter [aria-checked="true"]'); if (mb) mv = mb.getAttribute('data-media-value') || 'all'; }
    var f = { source: $('f-source').value, format: $('f-format').value, phase: $('f-phase').value, brand: $('f-brand').value, img: $('f-img').checked, spec: $('f-spec') && $('f-spec').checked, sort: $('f-sort').value, media: mv };
    var cards = Array.prototype.slice.call(grid.querySelectorAll('.cr'));
    cards.sort(function (a, b) {
      var A = a.dataset, B = b.dataset;
      if (f.sort === 'days-asc') return (+A.run || 0) - (+B.run || 0);
      if (f.sort === 'new') return (B.start || '').localeCompare(A.start || '');
      if (f.sort === 'variants') return (+B.variants) - (+A.variants);
      if (f.sort === 'views') return (+B.views) - (+A.views);
      return ((+B.run) - (+A.run)) || ((+B.views) - (+A.views));
    });
    var n = 0;
    cards.forEach(function (c) {
      grid.appendChild(c);
      var d = c.dataset;
      var ok = (f.media === 'all' || d.media === f.media) && (!f.source || d.plat === f.source) && (!f.format || d.format === f.format) && (!f.phase || d.phase === f.phase) && (!f.brand || d.brand === f.brand) && (!f.img || c.querySelector('.cr-media img')) && (!f.spec || d.spec === '1');
      if (ok) n++;
      c.style.display = ok && n <= shown ? '' : 'none';
    });
    var more = $('cr-more');
    if (more) { more.hidden = n <= shown; more.textContent = 'הצג עוד (' + Math.min(PAGE, n - shown) + ' מתוך ' + (n - shown) + ' נוספים)'; }
    var cnt = $('cr-count'); if (cnt) cnt.textContent = Math.min(n, shown) + ' מתוך ' + n;
    var none = $('cr-none'); if (none) none.hidden = n > 0;
  }
  ['f-source', 'f-format', 'f-phase', 'f-brand', 'f-img', 'f-spec', 'f-sort'].forEach(function (id) { var el = $(id); if (el) el.addEventListener('change', function () { applyGallery(true); }); });
  if ($('cr-more')) $('cr-more').addEventListener('click', function () { shown += PAGE; applyGallery(); });
  applyGallery();
  document.querySelectorAll('[data-go-brand]').forEach(function (b) {
    b.addEventListener('click', function () {
      if ($('f-brand')) { $('f-brand').value = b.getAttribute('data-go-brand'); applyGallery(true); }
      history.replaceState(null, '', '#creatives'); show('creatives'); window.scrollTo({ top: 0 });
    });
  });
  var wsel = $('t10-week');
  if (wsel) wsel.addEventListener('change', function () {
    document.querySelectorAll('.t10-week').forEach(function (w) { w.hidden = w.getAttribute('data-week') !== wsel.value; });
    var lbl = wsel.options[wsel.selectedIndex].text; var el = document.querySelector('.t10-weeklabel'); if (el) el.textContent = lbl;
    var panel = wsel.closest('.panel');
    if (panel && panel.querySelector('.media-filter')) { updateCounts(panel); updateEmpty(panel); }
  });

  // ---- lightbox ----
  var lb = $('lb'), cur = null, list = [];
  function visibleIn(card) {
    var host = card.closest('.cr-list');
    return Array.prototype.slice.call(host.querySelectorAll('.cr')).filter(function (c) { return c.style.display !== 'none' && !c.hidden; });
  }
  function openLb(card) {
    cur = card; list = visibleIn(card);
    var img = card.querySelector('.cr-media img');
    lb.querySelector('.lb-img').innerHTML = img ? '<img alt="' + (img.alt || '') + '" src="' + img.getAttribute('src') + '">' : '<div class="cr-ph"><div class="cr-ph-ic">🖼</div><b>אין תמונה זמינה</b></div>';
    lb.querySelector('.lb-meta').innerHTML = card.querySelector('.lb-detail').innerHTML;
    lb.hidden = false; document.body.classList.add('lb-open');
    lb.querySelector('.lb-x').focus();
  }
  function closeLb() { lb.hidden = true; document.body.classList.remove('lb-open'); if (cur) { var m = cur.querySelector('.cr-media'); if (m) m.focus(); } }
  function step(d) { var i = list.indexOf(cur); if (i < 0 || !list.length) return; openLb(list[(i + d + list.length) % list.length]); }
  if (lb) {
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-stop]')) return;
      var m = e.target.closest('.cr-media'); if (m) { openLb(m.closest('.cr')); return; }
      if (e.target.closest('[data-lb-close]') || e.target === lb || e.target.classList.contains('lb-in')) closeLb();
      else if (e.target.closest('[data-lb-prev]')) step(-1);
      else if (e.target.closest('[data-lb-next]')) step(1);
    });
    document.addEventListener('keydown', function (e) {
      if (lb.hidden) { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('cr-media')) { e.preventDefault(); openLb(e.target.closest('.cr')); } return; }
      if (e.key === 'Escape') closeLb(); else if (e.key === 'ArrowLeft') step(1); else if (e.key === 'ArrowRight') step(-1);
    });
  }

  // live countdowns (client clock, Israel date)
  document.querySelectorAll('[data-days]').forEach(function (el) {
    var d = new Date(el.getAttribute('data-days') + 'T00:00:00+03:00');
    var n = Math.ceil((d - new Date()) / 86400000);
    el.textContent = n > 0 ? n : 0;
  });

  // Media-type filter (הכל / וידאו / תמונה) for every panel that lists creative cards.
  // Injected for any current or future section that renders .cr[data-media=video|image].
  var MF_KEY = 'media-filter-v1';
  function mfMap() { try { return JSON.parse(localStorage.getItem(MF_KEY)) || {}; } catch (e) { return {}; } }
  function loadMedia(id) { var v = mfMap()[id]; return v === 'video' || v === 'image' ? v : 'all'; }
  function saveMedia(id, mv) {
    try {
      var m = mfMap();
      if (!mv || mv === 'all') delete m[id]; else m[id] = mv;
      localStorage.setItem(MF_KEY, JSON.stringify(m));
    } catch (e) {}
  }
  function writeMediaHash(id, mv) {
    if (hashLock || !id) return;
    if (!location.hash && (!mv || mv === 'all')) return;
    var h = '#' + id + (mv && mv !== 'all' ? '/' + mv : '');
    if (location.hash !== h) history.replaceState(null, '', h);
  }
  function ancestorHidden(el) {
    var p = el.parentElement;
    while (p) { if (p.hidden) return true; p = p.parentElement; }
    return false;
  }
  function mediaCounts(panel) {
    var grid = panel.querySelector('#cr-grid');
    var nodes = grid ? grid.querySelectorAll('.cr') : panel.querySelectorAll('.cr');
    var n = { all: 0, video: 0, image: 0 };
    Array.prototype.forEach.call(nodes, function (c) {
      if (!grid && ancestorHidden(c)) return;
      n.all++;
      if (c.dataset.media === 'video' || c.dataset.media === 'image') n[c.dataset.media]++;
    });
    return n;
  }
  function updateCounts(panel) {
    var n = mediaCounts(panel);
    var labels = { all: 'הכל', video: 'וידאו', image: 'תמונה' };
    Array.prototype.forEach.call(panel.querySelectorAll('.media-filter [data-media-value]'), function (b) {
      var k = b.getAttribute('data-media-value');
      var num = n[k] || 0;
      var s = b.querySelector('.mf-n');
      if (s) s.textContent = '(' + num + ')';
      b.setAttribute('aria-label', (labels[k] || k) + ', ' + num);
    });
  }
  function updateEmpty(panel) {
    var on = panel.querySelector('.media-filter [aria-checked="true"]');
    var mv = on ? on.getAttribute('data-media-value') : 'all';
    Array.prototype.forEach.call(panel.querySelectorAll('[data-media-empty]'), function (msg) {
      var list = msg.previousElementSibling;
      if (!list || !list.classList.contains('cr-list') || ancestorHidden(list) || mv === 'all') { msg.hidden = true; return; }
      var cards = list.querySelectorAll('.cr');
      if (!cards.length) { msg.hidden = true; return; }
      var any = Array.prototype.some.call(cards, function (c) { return !c.hidden && c.style.display !== 'none'; });
      msg.hidden = any;
    });
  }
  function setMedia(panel, mv, opts) {
    if (!panel) return;
    if (mv !== 'video' && mv !== 'image') mv = 'all';
    var group = panel.querySelector('.media-filter');
    if (!group) return;
    Array.prototype.forEach.call(group.querySelectorAll('[role="radio"]'), function (b) {
      var on = b.getAttribute('data-media-value') === mv;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    saveMedia(panel.id, mv);
    panel.setAttribute('data-media-on', mv);
    var grid = panel.querySelector('#cr-grid');
    Array.prototype.forEach.call(panel.querySelectorAll('.cr'), function (c) {
      if (grid && grid.contains(c)) return;
      c.hidden = !(mv === 'all' || c.dataset.media === mv);
    });
    if (grid) applyGallery(!!(opts && opts.resetGallery));
    updateEmpty(panel);
    updateCounts(panel);
    if (panel.classList.contains('on') && (!opts || opts.writeHash !== false)) writeMediaHash(panel.id, mv);
  }
  function onMediaKey(e) {
    var key = e.key;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].indexOf(key) < 0) return;
    var group = e.currentTarget;
    var btns = Array.prototype.slice.call(group.querySelectorAll('[role="radio"]'));
    var i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    e.stopPropagation();
    var rtl = document.documentElement.getAttribute('dir') === 'rtl';
    var n = i;
    if (key === 'Home') n = 0;
    else if (key === 'End') n = btns.length - 1;
    else {
      var forward = key === 'ArrowDown' || key === (rtl ? 'ArrowLeft' : 'ArrowRight');
      var back = key === 'ArrowUp' || key === (rtl ? 'ArrowRight' : 'ArrowLeft');
      if (forward) n = (i + 1) % btns.length;
      else if (back) n = (i - 1 + btns.length) % btns.length;
    }
    var panel = group.closest('.panel');
    setMedia(panel, btns[n].getAttribute('data-media-value'), { resetGallery: true });
    btns[n].focus();
  }
  function ensureFilters() {
    Array.prototype.forEach.call(document.querySelectorAll('.panel'), function (panel) {
      if (panel.querySelector('.media-filter')) return;
      if (!panel.querySelector('.cr[data-media="video"], .cr[data-media="image"]')) return;
      var bar = document.createElement('div');
      bar.className = 'media-filter';
      bar.setAttribute('role', 'radiogroup');
      bar.setAttribute('aria-label', 'סינון לפי סוג מדיה');
      [['all', 'הכל'], ['video', 'וידאו'], ['image', 'תמונה']].forEach(function (pair, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'mf-btn';
        b.setAttribute('role', 'radio');
        b.setAttribute('data-media-value', pair[0]);
        b.setAttribute('aria-checked', i === 0 ? 'true' : 'false');
        b.tabIndex = i === 0 ? 0 : -1;
        b.appendChild(document.createTextNode(pair[1] + ' '));
        var s = document.createElement('span');
        s.className = 'mf-n';
        s.setAttribute('aria-hidden', 'true');
        s.textContent = '(0)';
        b.appendChild(s);
        b.addEventListener('click', function () { setMedia(panel, pair[0], { resetGallery: true }); });
        bar.appendChild(b);
      });
      bar.addEventListener('keydown', onMediaKey);
      var head = panel.querySelector(':scope > .panel-head');
      if (head) head.insertAdjacentElement('afterend', bar);
      else panel.insertBefore(bar, panel.firstChild);
      Array.prototype.forEach.call(panel.querySelectorAll('.cr-list'), function (list) {
        if (list.id === 'cr-grid') return;
        var p = document.createElement('p');
        p.className = 'media-empty';
        p.setAttribute('data-media-empty', '');
        p.setAttribute('aria-live', 'polite');
        p.hidden = true;
        p.textContent = 'אין פריטים מסוג זה.';
        list.insertAdjacentElement('afterend', p);
      });
      updateCounts(panel);
    });
  }
  function syncOpenPanel() {
    var panel = document.querySelector('.panel.on');
    if (!panel || !panel.querySelector('.media-filter')) return;
    var parts = parseMediaHash();
    var mv = (parts.id === panel.id && parts.media) ? parts.media : loadMedia(panel.id);
    setMedia(panel, mv, { resetGallery: true, writeHash: !hashLock });
  }
  ensureFilters();
  syncOpenPanel();
})();
