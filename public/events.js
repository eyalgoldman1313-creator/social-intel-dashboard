/* Commerce calendar. Classic script: window.CommerceEvents.
   Dates are ISO (YYYY-MM-DD). The visible window is 120 days from
   the civil date in Asia/Jerusalem, so past events drop off without a rebuild. */
(function (root) {
  var WINDOW_DAYS = 120;
  var TYPES = { sale: 'מבצע', holiday: 'חג', season: 'עונה' };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function isIso(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var p = s.split('-').map(Number);
    var dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return dt.getUTCFullYear() === p[0] && dt.getUTCMonth() === p[1] - 1 && dt.getUTCDate() === p[2];
  }

  function addDays(iso, n) {
    var p = iso.split('-').map(Number);
    var dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
  }

  function daysBetween(from, to) {
    var a = from.split('-').map(Number);
    var b = to.split('-').map(Number);
    var ua = Date.UTC(a[0], a[1] - 1, a[2]);
    var ub = Date.UTC(b[0], b[1] - 1, b[2]);
    return Math.round((ub - ua) / 86400000);
  }

  function israelToday(now) {
    var fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return fmt.format(now || new Date());
  }

  function endOf(ev) { return ev.end || ev.start; }

  function formatDay(iso) {
    var p = iso.split('-');
    return Number(p[2]) + '.' + Number(p[1]) + '.' + p[0];
  }

  function formatRange(start, end) {
    if (!end || end === start) return formatDay(start);
    var a = start.split('-');
    var b = end.split('-');
    var ad = Number(a[2]);
    var bd = Number(b[2]);
    var am = Number(a[1]);
    var bm = Number(b[1]);
    if (a[0] === b[0] && a[1] === b[1]) return ad + '–' + bd + '.' + bm + '.' + b[0];
    if (a[0] === b[0]) return ad + '.' + am + '–' + bd + '.' + bm + '.' + b[0];
    return formatDay(start) + '–' + formatDay(end);
  }

  function validate(events) {
    var errors = [];
    if (!Array.isArray(events)) return ['events.json must be an array'];
    events.forEach(function (ev, i) {
      var where = 'events[' + i + ']';
      if (!ev || typeof ev !== 'object') { errors.push(where + ' is not an object'); return; }
      if (typeof ev.name !== 'string' || !ev.name.trim()) errors.push(where + ' missing name');
      if (!isIso(ev.start)) errors.push(where + ' bad start');
      if (ev.end != null && ev.end !== '' && !isIso(ev.end)) errors.push(where + ' bad end');
      if (isIso(ev.start) && isIso(ev.end) && ev.end < ev.start) errors.push(where + ' end before start');
      if (ev.type !== 'sale' && ev.type !== 'holiday' && ev.type !== 'season') errors.push(where + ' bad type');
      if (ev.relevance !== 'high' && ev.relevance !== 'medium' && ev.relevance !== 'low') errors.push(where + ' bad relevance');
      if (ev.note != null && typeof ev.note !== 'string') errors.push(where + ' note must be a string');
    });
    return errors;
  }

  function phaseOf(ev, today) {
    var multi = !!(ev.end && ev.end > ev.start);
    if (multi && today >= ev.start && today <= ev.end) return 'ongoing';
    var days = daysBetween(today, ev.start);
    if (days <= 0) return 'today';
    if (days === 1) return 'tomorrow';
    return 'upcoming';
  }

  function decorate(ev, today) {
    var phase = phaseOf(ev, today);
    var days = daysBetween(today, ev.start);
    var dateLabel = formatRange(ev.start, ev.end && ev.end !== ev.start ? ev.end : null);
    var lead;
    var phrase;
    var copy;
    if (phase === 'ongoing') {
      lead = 'עכשיו';
      phrase = 'מתקיים עכשיו';
      copy = ev.name;
    } else if (phase === 'today') {
      lead = 'היום';
      phrase = 'היום';
      copy = ev.name;
    } else if (phase === 'tomorrow') {
      lead = 'מחר';
      phrase = 'מחר';
      copy = ev.name;
    } else {
      lead = String(days);
      phrase = days + ' ימים';
      copy = 'ימים ל' + ev.name;
    }
    return {
      name: ev.name,
      start: ev.start,
      end: ev.end || null,
      type: ev.type,
      typeLabel: TYPES[ev.type] || ev.type,
      relevance: ev.relevance,
      note: ev.note || '',
      phase: phase,
      days: days,
      dateLabel: dateLabel,
      lead: lead,
      phrase: phrase,
      copy: copy
    };
  }

  function visible(events, today) {
    var day = today || israelToday(new Date());
    var until = addDays(day, WINDOW_DAYS);
    return events.filter(function (ev) {
      if (!ev || !isIso(ev.start)) return false;
      if (ev.end != null && ev.end !== '' && !isIso(ev.end)) return false;
      var end = endOf(ev);
      if (end < day) return false;
      if (ev.start > until) return false;
      return true;
    }).sort(function (a, b) {
      var ar = a.relevance === 'low' ? 1 : 0;
      var br = b.relevance === 'low' ? 1 : 0;
      if (ar !== br) return ar - br;
      if (a.start !== b.start) return a.start < b.start ? -1 : 1;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    }).map(function (ev) { return decorate(ev, day); });
  }

  function spoken(ev) {
    var base;
    if (ev.phase === 'ongoing') base = 'מתקיים עכשיו, ' + ev.name + ', ' + ev.dateLabel + ', ' + ev.typeLabel;
    else if (ev.phase === 'today') base = 'היום, ' + ev.name + ', ' + ev.dateLabel + ', ' + ev.typeLabel;
    else if (ev.phase === 'tomorrow') base = 'מחר, ' + ev.name + ', ' + ev.dateLabel + ', ' + ev.typeLabel;
    else base = ev.days + ' ימים ל' + ev.name + ', ' + ev.dateLabel + ', ' + ev.typeLabel;
    if (ev.relevance === 'low') base += ', רלוונטיות נמוכה';
    return base;
  }

  function chip(ev) {
    var sub = ev.phase === 'ongoing'
      ? 'מתקיים עכשיו · <bdi dir="ltr">' + esc(ev.dateLabel) + '</bdi>'
      : '<bdi dir="ltr">' + esc(ev.dateLabel) + '</bdi>';
    var word = ev.phase === 'upcoming' ? '' : ' is-word';
    var tip = ev.note ? ' title="' + esc(ev.note) + '"' : '';
    return '<div class="event" role="listitem" data-type="' + esc(ev.type) + '" data-relevance="' + esc(ev.relevance) + '"' + tip + '>' +
      '<span class="event-days' + word + '" aria-hidden="true">' + esc(ev.lead) + '</span>' +
      '<span class="event-copy" aria-hidden="true">' + esc(ev.copy) + '<small>' + sub + '</small></span>' +
      '<span class="visually-hidden">' + esc(spoken(ev)) + '</span>' +
      '</div>';
  }

  function pill(ev) {
    var when = ev.phase === 'ongoing' ? 'מתקיים עכשיו' : ev.phrase;
    var tip = ev.note ? ' title="' + esc(ev.note) + '"' : '';
    var extra = ev.relevance === 'low' ? ', רלוונטיות נמוכה' : '';
    return '<div class="event-pill" role="listitem" data-type="' + esc(ev.type) + '" data-relevance="' + esc(ev.relevance) + '"' + tip + '>' +
      '<span class="pill-when">' + esc(when) + '</span>' +
      '<span class="pill-name">' + esc(ev.name) + '</span>' +
      '<span class="pill-date" dir="ltr">' + esc(ev.dateLabel) + '</span>' +
      '<span class="visually-hidden">' + esc(ev.typeLabel + extra) + '</span>' +
      '</div>';
  }

  function renderBoard(events, today, opts) {
    var list = visible(events, today);
    var featured = (opts && opts.featured) || 3;
    if (featured < 2) featured = 2;
    if (featured > 3) featured = 3;
    if (!list.length) {
      return '<p class="event-empty" role="status">אין אירועים ב-120 הימים הקרובים</p>';
    }
    var nonLow = 0;
    for (var i = 0; i < list.length; i++) if (list[i].relevance !== 'low') nonLow++;
    var chipCount = nonLow === 0 ? Math.min(featured, list.length) : Math.min(featured, nonLow);
    var head = list.slice(0, chipCount).map(chip).join('');
    var rest = list.slice(chipCount);
    var strip = '';
    if (rest.length) {
      strip = '<div class="event-strip" role="region" tabindex="0" aria-label="אירועים נוספים ב-120 הימים הקרובים">' +
        '<div class="event-track"><div class="event-set" role="list">' + rest.map(pill).join('') + '</div></div></div>';
    }
    return '<div class="events" role="list" aria-label="האירועים הקרובים">' + head + '</div>' + strip;
  }

  var MARQUEE_SPEED = 40;

  function marqueeMode(contentWidth, containerWidth, reduceMotion) {
    if (!(contentWidth > containerWidth + 1)) return 'fit';
    if (reduceMotion) return 'scroll';
    return 'marquee';
  }

  function stripLabel(mode) {
    var base = 'אירועים נוספים ב-120 הימים הקרובים';
    if (mode === 'marquee') return base + '. הרצועה נעה לבד ונעצרת במעבר, במגע או במיקוד.';
    if (mode === 'scroll') return base + '. אפשר לגלול אופקית.';
    return base;
  }

  function syncPause(strip) {
    var track = strip.querySelector('.event-track');
    if (!track) return;
    var pause = strip._pause || {};
    var paused = !!(pause.hover || pause.focus || pause.touch);
    if (strip.classList.contains('is-marquee')) track.style.animationPlayState = paused ? 'paused' : 'running';
  }

  function layoutStrip(strip) {
    var track = strip.querySelector('.event-track');
    var set = track && track.querySelector('.event-set:not([data-clone])');
    if (!track || !set) return;
    var reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { reduce = false; }
    var contentWidth = set.offsetWidth;
    var containerWidth = strip.clientWidth;
    var mode = marqueeMode(contentWidth, containerWidth, reduce);
    var key = mode + ':' + contentWidth + ':' + containerWidth;
    if (strip.getAttribute('data-marquee-key') === key) return;
    strip.setAttribute('data-marquee-key', key);
    var old = track.querySelector('[data-clone]');
    if (old) old.parentNode.removeChild(old);
    strip.classList.remove('is-marquee', 'is-scrollable', 'is-fit');
    track.style.removeProperty('--marquee-shift');
    track.style.removeProperty('--marquee-duration');
    track.style.animationPlayState = '';
    if (mode === 'fit') {
      strip.classList.add('is-fit');
      strip.setAttribute('aria-label', stripLabel('fit'));
      return;
    }
    if (mode === 'scroll') {
      strip.classList.add('is-scrollable');
      strip.setAttribute('aria-label', stripLabel('scroll'));
      return;
    }
    var copy = set.cloneNode(true);
    copy.setAttribute('aria-hidden', 'true');
    copy.removeAttribute('role');
    copy.setAttribute('data-clone', '');
    track.appendChild(copy);
    var gap = parseFloat(window.getComputedStyle(track).columnGap);
    if (!isFinite(gap)) gap = 0;
    var shift = set.offsetWidth + gap;
    track.style.setProperty('--marquee-shift', shift + 'px');
    track.style.setProperty('--marquee-duration', (shift / MARQUEE_SPEED) + 's');
    strip.classList.add('is-marquee');
    strip.setAttribute('aria-label', stripLabel('marquee'));
    syncPause(strip);
  }

  var motionWatch = false;

  function mountBoard(root) {
    if (!root || !root.querySelectorAll) return;
    var strips = root.querySelectorAll('.event-strip');
    for (var i = 0; i < strips.length; i++) setupStrip(strips[i]);
    if (motionWatch || !window.matchMedia) return;
    motionWatch = true;
    var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    var onChange = function () {
      var nodes = document.querySelectorAll('.event-strip');
      for (var n = 0; n < nodes.length; n++) {
        nodes[n].removeAttribute('data-marquee-key');
        layoutStrip(nodes[n]);
      }
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
  }

  function setupStrip(strip) {
    layoutStrip(strip);
    if (strip.getAttribute('data-marquee-bound') === '1') return;
    strip.setAttribute('data-marquee-bound', '1');
    strip._pause = { hover: false, focus: false, touch: false };
    strip.addEventListener('pointerenter', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      strip._pause.hover = true;
      syncPause(strip);
    });
    strip.addEventListener('pointerleave', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      strip._pause.hover = false;
      syncPause(strip);
    });
    strip.addEventListener('pointerdown', function () {
      strip._pause.touch = true;
      syncPause(strip);
    });
    function endTouch() {
      strip._pause.touch = false;
      syncPause(strip);
    }
    strip.addEventListener('pointerup', endTouch);
    strip.addEventListener('pointercancel', endTouch);
    strip.addEventListener('focusin', function () {
      strip._pause.focus = true;
      syncPause(strip);
    });
    strip.addEventListener('focusout', function (e) {
      if (!strip.contains(e.relatedTarget)) {
        strip._pause.focus = false;
        syncPause(strip);
      }
    });
    if (typeof ResizeObserver !== 'undefined') {
      var observer = new ResizeObserver(function () { layoutStrip(strip); });
      observer.observe(strip);
    }
  }

  function renderCards(events, today) {
    var list = visible(events, today);
    if (!list.length) return '<p class="event-empty" role="status">אין אירועים ב-120 הימים הקרובים</p>';
    return list.map(function (ev) {
      var when = ev.phase === 'ongoing' ? 'מתקיים עכשיו' : ev.phrase;
      var tip = ev.note ? '<p class="fine">' + esc(ev.note) + '</p>' : '';
      var word = ev.phase === 'upcoming' ? '' : ' is-word';
      var low = ev.relevance === 'low' ? ' · רלוונטיות נמוכה' : '';
      return '<article class="ev-card" data-type="' + esc(ev.type) + '" data-relevance="' + esc(ev.relevance) + '">' +
        '<div class="ev-n' + word + '" aria-hidden="true">' + esc(ev.lead) + '</div>' +
        '<div><h4>' + esc(ev.name) + '</h4>' +
        '<p class="ev-date" dir="ltr">' + esc(ev.dateLabel) + '</p>' +
        '<p class="fine">' + esc(when) + ' · ' + esc(ev.typeLabel) + low + '</p>' + tip + '</div></article>';
    }).join('');
  }

  root.CommerceEvents = {
    WINDOW_DAYS: WINDOW_DAYS,
    israelToday: israelToday,
    addDays: addDays,
    daysBetween: daysBetween,
    formatRange: formatRange,
    validate: validate,
    visible: visible,
    renderBoard: renderBoard,
    renderCards: renderCards,
    marqueeMode: marqueeMode,
    mountBoard: mountBoard
  };
})(typeof window !== 'undefined' ? window : this);
