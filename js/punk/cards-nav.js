// cards-nav.js: the shared way round the card-by-card poster pages (/simulator, /about, /robot).
// Each page keeps its own cards, wipe and go(n); this adds what makes them easy to get around:
//   - a CONTENTS sticker in the bottom bar that lists every card by title and jumps straight to it
//   - clickable squares with the card titles as names and tooltips
//   - a stable slug per card: the URL hash follows the card you are on, and /about#sponsors opens that card
//   - wheel / trackpad and swipe input, one flick = one card, scrolling inside a tall card first
//   - the keys (arrows, Page Up/Down, Space, Home, End)
// Styles: /css/punk-cards.css.

function slugify(s) {
  return String(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function cardsNav(o) {
  var scenes = o.scenes, deck = o.deck, reduce = o.reduce, n = scenes.length;
  var cur = o.cur, go = o.go, busy = o.busy || function () { return false; };

  /* ---- titles and slugs, keyed like robot.js's STEPS: data-step, else aria-label ---- */
  function key(sc) { return sc.getAttribute('data-step') || sc.getAttribute('aria-label') || ''; }
  var titles = scenes.map(function (sc) {
    var k = key(sc);
    return (o.titles && o.titles[k]) || (sc.getAttribute('aria-label') || '').replace(/^\d+\s+/, '');
  });
  var used = {};
  var slugs = scenes.map(function (sc, i) {
    var k = key(sc), label = (sc.getAttribute('aria-label') || '').replace(/^\d+\s+/, '');
    var s = sc.getAttribute('data-slug') || (o.slugs && o.slugs[k]) || slugify((o.slug && o.slug(label)) || label);
    if (!s) s = 'card-' + (i + 1);
    if (document.getElementById(s)) s = 'card-' + s;      // never the id of an element, so the browser never scrolls to it
    while (used[s]) s += '-' + (i + 1);
    used[s] = true;
    return s;
  });
  function fromHash() {
    var h = decodeURIComponent((location.hash || '').slice(1)).toLowerCase();
    return h ? slugs.indexOf(h) : -1;
  }
  var start = Math.max(0, fromHash());

  /* ---- squares ---- */
  var dots = o.dots, pager = o.pager;
  scenes.forEach(function (sc, i) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'dot';
    b.setAttribute('aria-label', (i + 1) + ': ' + titles[i]);
    b.title = (i + 1) + '. ' + titles[i];
    b.addEventListener('click', function () { jump(i); });
    dots.appendChild(b);
  });

  /* ---- contents: a disclosure button plus a list of links ---- */
  var btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'toc-btn';
  btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'toc');
  btn.innerHTML = '<span class="ico" aria-hidden="true"></span><span class="lbl">CONTENTS</span>';
  var panel = document.createElement('div');
  panel.className = 'toc'; panel.id = 'toc'; panel.hidden = true;
  panel.innerHTML = '<p class="toc-h" id="toc-h">Jump to a card <span>' + n + ' cards</span></p><div class="toc-scroll"><ol aria-labelledby="toc-h"></ol></div>';
  var list = panel.querySelector('ol'), scroller = panel.querySelector('.toc-scroll');
  var links = scenes.map(function (sc, i) {
    var li = document.createElement('li'), a = document.createElement('a');
    a.href = '#' + slugs[i];
    a.innerHTML = '<span class="n" aria-hidden="true">' + (i < 9 ? '0' : '') + (i + 1) + '</span><span class="t"></span><span class="here" aria-hidden="true"></span>';
    a.querySelector('.t').textContent = titles[i];
    a.addEventListener('click', function (e) { e.preventDefault(); close(false); jump(i, true); });
    li.appendChild(a); list.appendChild(li);
    return a;
  });
  pager.appendChild(btn);
  pager.appendChild(panel);

  function isOpen() { return !panel.hidden; }
  function open() {
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    var a = links[cur()];
    scroller.scrollTop = Math.max(0, a.offsetTop - scroller.clientHeight / 2 + a.offsetHeight / 2);
    a.focus({ preventScroll: true });
  }
  function close(refocus) {
    if (!isOpen()) return;
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (refocus) btn.focus({ preventScroll: true });
  }
  btn.addEventListener('click', function () { if (isOpen()) close(true); else open(); });
  panel.addEventListener('keydown', function (e) {
    var i = links.indexOf(document.activeElement), k = e.key, t = -1;
    if (k === 'ArrowDown') t = Math.min(n - 1, i + 1);
    else if (k === 'ArrowUp') t = Math.max(0, i - 1);
    else if (k === 'Home') t = 0;
    else if (k === 'End') t = n - 1;
    if (t < 0) return;
    e.preventDefault();
    links[t].focus({ preventScroll: true });
    var a = links[t];
    if (a.offsetTop < scroller.scrollTop) scroller.scrollTop = a.offsetTop;
    else if (a.offsetTop + a.offsetHeight > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = a.offsetTop + a.offsetHeight - scroller.clientHeight;
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen()) { e.preventDefault(); close(true); }
  });
  document.addEventListener('pointerdown', function (e) {
    if (isOpen() && !panel.contains(e.target) && !btn.contains(e.target)) close(false);
  });
  panel.addEventListener('focusout', function (e) {     // tabbing out of the list closes it
    var to = e.relatedTarget;
    if (to && !panel.contains(to) && to !== btn) close(false);
  });

  /* ---- jumping ---- */
  var focusTo = -1, retry = 0;
  function jump(i, focusCard) {
    clearTimeout(retry);
    if (i === cur()) { if (focusCard) focusHead(); return; }
    if (busy()) { retry = setTimeout(function () { jump(i, focusCard); }, 120); return; }   // mid-wipe: go once it lands
    focusTo = focusCard ? i : -1;
    go(i);
  }
  function focusHead() {
    var h = scenes[cur()].querySelector('.tiles');
    if (!h) return;
    h.setAttribute('tabindex', '-1');
    h.focus({ preventScroll: true });
  }

  /* called by the page every time a card is shown */
  function update(c) {
    Array.prototype.forEach.call(dots.children, function (d, i) {
      if (i === c) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current');
    });
    links.forEach(function (a, i) {
      if (i === c) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
    if (focusTo === c) focusHead();
    focusTo = -1;
    var url = location.pathname + location.search + (c ? '#' + slugs[c] : '');
    if (url !== location.pathname + location.search + location.hash) {
      try { history.replaceState(history.state, '', url); } catch (err) {}
    }
  }
  window.addEventListener('hashchange', function () {
    var i = fromHash();
    if (i >= 0) jump(i);
  });

  /* ---- input ---- */
  function inner() { return scenes[cur()].querySelector('.inner'); }
  function canScroll(dir) {
    var el = inner();
    if (!el) return false;
    if (dir > 0) return el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    return el.scrollTop > 1;
  }
  function typing(t) {
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }
  function inSiteBar(t) { return !!(t && t.closest && t.closest('.sn')); }   // the site nav bar and its phone menu

  // wheel and trackpad: a gesture is a run of wheel events with no gap over 250 ms (a trackpad flick keeps
  // sending them while it coasts). Each gesture moves at most one card, and a gesture that scrolled the
  // card never also flips it, so you stop at the bottom of a tall card and flick again to move on.
  // On top of that, nothing moves for 900 ms after a move, even if the events came in bursts with gaps.
  var lastWheel = 0, spent = false, acc = 0, lockUntil = 0;
  window.addEventListener('wheel', function (e) {
    if (e.ctrlKey || isOpen() || inSiteBar(e.target)) return;   // pinch-zoom, or scrolling the contents list / site menu
    var t = e.timeStamp || performance.now();             // when the input happened, so a janky frame does not split a flick
    if (t - lastWheel > 250 && t > lockUntil) { spent = false; acc = 0; }
    lastWheel = t;
    var dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? deck.clientHeight : 1);
    if (spent || Math.abs(dy) < Math.abs(e.deltaX)) return;
    var dir = dy > 0 ? 1 : -1;
    if (canScroll(dir)) { spent = true; return; }        // the browser scrolls the card itself
    acc += dy;
    if (Math.abs(acc) < 30) return;
    spent = true;
    if (!busy()) { lockUntil = t + 900; go(cur() + dir); }
  }, { passive: true });

  // swipe: up/down moves a card unless the swipe scrolled the card; sideways always moves a card
  var ty0 = null, tx0 = 0, st0 = 0;
  window.addEventListener('touchstart', function (e) {
    ty0 = null;
    if (e.touches.length !== 1 || isOpen()) return;
    var t = e.target;
    if (t.closest && t.closest('input, select, textarea, .toc, .pager, .sn')) return;
    ty0 = e.touches[0].clientY; tx0 = e.touches[0].clientX; st0 = inner() ? inner().scrollTop : 0;
  }, { passive: true });
  window.addEventListener('touchcancel', function () { ty0 = null; }, { passive: true });
  window.addEventListener('touchend', function (e) {
    if (ty0 === null) return;
    var dy = ty0 - e.changedTouches[0].clientY, dx = tx0 - e.changedTouches[0].clientX;
    ty0 = null;
    if (busy()) return;
    if (Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(dx) * 1.2) {
      var dir = dy > 0 ? 1 : -1;
      if (Math.abs((inner() ? inner().scrollTop : 0) - st0) > 2 || canScroll(dir)) return;
      go(cur() + dir);
    } else if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.2) go(cur() + (dx > 0 ? 1 : -1));
  }, { passive: true });

  // keys: Up/Down/Page/Space scroll a tall card first, then move; Left/Right always move
  window.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isOpen() || typing(e.target) || inSiteBar(e.target)) return;
    var k = e.key;
    var vert = k === 'ArrowDown' || k === 'ArrowUp' || k === 'PageDown' || k === 'PageUp' || k === ' ';
    var dir = (k === 'ArrowDown' || k === 'ArrowRight' || k === 'PageDown' || k === ' ') ? 1 : (k === 'ArrowUp' || k === 'ArrowLeft' || k === 'PageUp') ? -1 : 0;
    if (k === ' ' && e.target !== document.body) dir = 0;    // Space on a button presses it
    if (dir) {
      e.preventDefault();
      if (vert && canScroll(dir)) {
        var el = inner();
        el.scrollBy({ top: dir * (k.indexOf('Page') === 0 || k === ' ' ? el.clientHeight * 0.85 : 60), behavior: reduce ? 'auto' : 'smooth' });
      } else jump(cur() + dir);
    }
    else if ((k === 'Home' || k === 'End') && !(e.target.classList && e.target.classList.contains('inner'))) {   // a focused tall card keeps Home/End for itself
      e.preventDefault(); jump(k === 'Home' ? 0 : n - 1);
    }
  });

  deck.scrollTop = 0;
  return { start: start, update: update, slugs: slugs, titles: titles };
}
