(function () {
  var panels = Array.prototype.slice.call(document.querySelectorAll('.panel'));
  var links = Array.prototype.slice.call(document.querySelectorAll('[data-go]'));
  function show(id) {
    if (!document.getElementById(id) || !document.getElementById(id).classList.contains('panel')) id = 'overview';
    panels.forEach(function (p) { p.classList.toggle('on', p.id === id); });
    links.forEach(function (l) { l.classList.toggle('on', l.getAttribute('data-go') === id); });
    var on = document.querySelector('.tabs a.on');
    if (on && on.scrollIntoView) on.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
  function fromHash() { show((location.hash || '#overview').slice(1)); }
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

  // live countdowns (client clock, Israel date)
  document.querySelectorAll('[data-days]').forEach(function (el) {
    var d = new Date(el.getAttribute('data-days') + 'T00:00:00+03:00');
    var n = Math.ceil((d - new Date()) / 86400000);
    el.textContent = n > 0 ? n : 0;
  });
})();
