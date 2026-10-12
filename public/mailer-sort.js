/* Mailer toolbar helpers. Classic script: window.MailerSort.
   Dates are day-first (DD.MM.YYYY). Missing score/date sort last in every direction. */
(function (root) {
  function fold(s) {
    try { return String(s).toLocaleLowerCase('he'); }
    catch (e) { return String(s).toLowerCase(); }
  }
  function trim(s) {
    return String(s == null ? '' : s).replace(/^\s+|\s+$/g, '');
  }
  function parseScore(raw) {
    if (typeof raw === 'number') return isFinite(raw) ? raw : null;
    if (raw == null) return null;
    var s = trim(raw).replace(/\u00a0/g, ' ');
    if (!s) return null;
    var m = s.match(/-?\d+(?:[.,]\d+)?/);
    if (!m) return null;
    var n = Number(m[0].replace(',', '.'));
    return isFinite(n) ? n : null;
  }
  function validDate(y, m, d) {
    if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }
  /* Numeric yyyymmdd, or null when the value is missing or not a real date. */
  function parseDateKey(raw) {
    if (raw == null) return null;
    var s = trim(raw);
    if (!s) return null;
    var y, m, d, iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) {
      y = +iso[1]; m = +iso[2]; d = +iso[3];
    } else {
      var dmy = s.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?!\d)/);
      if (!dmy) return null;
      d = +dmy[1]; m = +dmy[2]; y = +dmy[3];
      if (y < 100) y += 2000;
    }
    if (!validDate(y, m, d)) return null;
    return y * 10000 + m * 100 + d;
  }
  function normalizeSort(sort) {
    if (sort === 'date-asc' || sort === 'date-desc' || sort === 'score-asc' || sort === 'score-desc') return sort;
    return 'date-desc';
  }
  function competitorOptions(brands) {
    var counts = Object.create(null);
    var order = [];
    var i, name, key;
    for (i = 0; i < brands.length; i++) {
      name = trim(brands[i]);
      if (!name) continue;
      key = fold(name);
      if (!counts[key]) {
        counts[key] = { name: name, count: 0 };
        order.push(key);
      }
      counts[key].count++;
    }
    order.sort(function (a, b) {
      return counts[a].name.localeCompare(counts[b].name, 'he', { sensitivity: 'base', numeric: true });
    });
    var out = [];
    for (i = 0; i < order.length; i++) out.push(counts[order[i]]);
    return out;
  }
  function matchBrand(cardBrand, selected) {
    var want = fold(trim(selected));
    if (!want) return true;
    return fold(trim(cardBrand)) === want;
  }
  /* Stable: equal values keep original index. Null/NaN always last. */
  function mailerOrder(items, sortKey) {
    var key = normalizeSort(sortKey);
    var byScore = key.indexOf('score') === 0;
    var asc = key.slice(-3) === 'asc';
    var copy = items.map(function (it, i) {
      return { item: it, index: it.index == null ? i : it.index };
    });
    copy.sort(function (a, b) {
      var av = byScore ? a.item.score : a.item.date;
      var bv = byScore ? b.item.score : b.item.date;
      var aMiss = av == null || av !== av;
      var bMiss = bv == null || bv !== bv;
      if (aMiss || bMiss) {
        if (aMiss && bMiss) return a.index - b.index;
        return aMiss ? 1 : -1;
      }
      if (av !== bv) {
        if (asc) return av < bv ? -1 : 1;
        return av > bv ? -1 : 1;
      }
      return a.index - b.index;
    });
    return copy.map(function (c) { return c.item; });
  }
  function formatMailerHash(sort, brand) {
    var parts = ['mailers'];
    var s = normalizeSort(sort);
    var b = trim(brand);
    if (s !== 'date-desc') parts.push('s-' + s);
    if (b) parts.push('b-' + encodeURIComponent(b));
    return '#' + parts.join('/');
  }
  function parseMailerHash(hash) {
    var raw = String(hash || '').replace(/^#/, '');
    var bits = raw.split('/');
    var mailerInHash = false;
    var sort = null;
    var brand = null;
    for (var i = 1; i < bits.length; i++) {
      var bit = bits[i];
      try { bit = decodeURIComponent(bit); } catch (e) {}
      if (bit.slice(0, 2) === 's-') { mailerInHash = true; sort = bit.slice(2); }
      else if (bit.slice(0, 2) === 'b-') { mailerInHash = true; brand = bit.slice(2); }
    }
    return { mailerInHash: mailerInHash, sort: sort, brand: brand };
  }
  root.MailerSort = {
    parseScore: parseScore,
    parseDateKey: parseDateKey,
    normalizeSort: normalizeSort,
    competitorOptions: competitorOptions,
    matchBrand: matchBrand,
    mailerOrder: mailerOrder,
    formatMailerHash: formatMailerHash,
    parseMailerHash: parseMailerHash
  };
})(typeof window !== 'undefined' ? window : this);
