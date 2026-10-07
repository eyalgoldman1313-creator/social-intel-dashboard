(function () {
  var panels = Array.prototype.slice.call(document.querySelectorAll('.panel'));
  var links = Array.prototype.slice.call(document.querySelectorAll('[data-go]'));
  function show(id) {
    if (!document.getElementById(id) || !document.getElementById(id).classList.contains('panel')) id = 'creatives';
    panels.forEach(function (p) { p.classList.toggle('on', p.id === id); });
    links.forEach(function (l) { l.classList.toggle('on', l.getAttribute('data-go') === id); });
    var on = document.querySelector('.tabs a.on');
    if (on && on.scrollIntoView) on.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
  function fromHash() { show((location.hash || '#creatives').slice(1)); }
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
  window.addEventListener('hashchange', fromHash);
  fromHash();

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
    var f = { source: $('f-source').value, format: $('f-format').value, phase: $('f-phase').value, brand: $('f-brand').value, img: $('f-img').checked, spec: $('f-spec') && $('f-spec').checked, sort: $('f-sort').value };
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
      var ok = (!f.source || d.plat === f.source) && (!f.format || d.format === f.format) && (!f.phase || d.phase === f.phase) && (!f.brand || d.brand === f.brand) && (!f.img || c.querySelector('.cr-media img')) && (!f.spec || d.spec === '1');
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
  });

  // ---- lightbox ----
  var lb = $('lb'), cur = null, list = [];
  function visibleIn(card) {
    var host = card.closest('.cr-list');
    return Array.prototype.slice.call(host.querySelectorAll('.cr')).filter(function (c) { return c.style.display !== 'none'; });
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
})();
