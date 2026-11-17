// about.js: poster page script (moved out of the HTML so the site's Content-Security-Policy allows it)
// contents list, squares, deep links (#sponsors) and wheel/swipe/keys: js/punk/cards-nav.js
import { cardsNav } from '/js/punk/cards-nav.js';

(function () {
  var root = document.documentElement;
  var deck = document.getElementById('deck');
  var scenes = Array.prototype.slice.call(document.querySelectorAll('.scene'));
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var cur = 0, busy = false, lockUntil = 0;
  function cssCol(el, n) { return getComputedStyle(el).getPropertyValue(n).trim(); }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  /* ---- headlines: one pasted square per letter ---- */
  scenes.forEach(function (sc) {
  Array.prototype.forEach.call(sc.querySelectorAll('.tiles'), function (h) {
    var text = h.getAttribute('data-tiles');
    h.setAttribute('aria-label', text.replace(/ \| /g, ' '));
    var i = 0, last = -1;
    text.split(' ').forEach(function (w) {
      if (w === '|') { var br = document.createElement('span'); br.className = 'brk'; h.appendChild(br); return; }
      var word = document.createElement('span');
      word.className = 'word'; word.setAttribute('aria-hidden', 'true');
      w.split('').forEach(function (ch) {
        var c;
        do { c = Math.floor(Math.random() * 5); } while (c === last);
        last = c;
        var t = document.createElement('span');
        t.className = 'tile c' + c;
        t.style.setProperty('--i', i++);
        t.style.setProperty('--r', rnd(-7, 7).toFixed(1) + 'deg');
        t.style.setProperty('--spin', rnd(-90, 90).toFixed(0) + 'deg');
        var b = document.createElement('b');
        b.textContent = ch;
        t.appendChild(b); word.appendChild(t);
      });
      h.appendChild(word);
    });
  });
  });

  /* ---- marker scribble: a fat zigzag that covers a w x h box ---- */
  function zigzag(w, h, passes) {
    var d = '', pad = 10;
    for (var i = 0; i <= passes; i++) {
      var y = h * i / passes + rnd(-h / passes * 0.2, h / passes * 0.2);
      var x = (i % 2 ? w + pad : -pad) + rnd(-6, 6);
      d += (i ? ' L ' : 'M ') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    return d;
  }

  /* draw (or rub out) a scribble in a handful of held frames, on timers rather than a smooth tween */
  function stepDash(path, from, to, n, ms, sched) {
    for (var k = 0; k <= n; k++) (function (k) {
      sched(function () { path.style.strokeDashoffset = (from + (to - from) * k / n).toFixed(3); }, ms * k / n);
    })(k);
  }

  /* ---- scribble-then-erase reveal for every block on a card ---- */
  var timers = [];
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function dress(sc) {
    timers.forEach(clearTimeout); timers = [];
    Array.prototype.forEach.call(sc.querySelectorAll('.scr'), function (x) { x.parentNode.removeChild(x); });
    var tl = sc.querySelectorAll('.tile'), rvs = sc.querySelectorAll('.rv');
    Array.prototype.forEach.call(tl, function (t) { t.classList.remove('off', 'big'); });
    Array.prototype.forEach.call(rvs, function (el) { el.classList.remove('off'); });
    if (reduce) return;
    // letters get pasted on one at a time
    var gapMs = Math.min(42, 900 / tl.length);
    Array.prototype.forEach.call(tl, function (t, i) {
      t.classList.add('off');
      later(function () { t.classList.remove('off'); t.classList.add('big'); }, 150 + i * gapMs);
      later(function () { t.classList.remove('big'); }, 150 + i * gapMs + 90);
    });
    // every other block is scribbled over, then the scribble is rubbed out to leave it behind
    var base = 250 + tl.length * gapMs * 0.6;
    Array.prototype.forEach.call(rvs, function (el, i) {
      var w = el.offsetWidth + 16, h = el.offsetHeight + 10;
      var passes = Math.max(2, Math.round(h / 30));
      var svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('class', 'scr');
      svg.setAttribute('width', w); svg.setAttribute('height', h);
      var p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('d', zigzag(w, h, passes));
      p.setAttribute('pathLength', '1');
      p.setAttribute('stroke-width', (h / passes * 1.55).toFixed(1));
      svg.appendChild(p);
      el.classList.add('off');
      el.appendChild(svg);
      var d = base + i * 120;
      later(function () { stepDash(p, 1.01, 0, 16, 230, later); }, d);
      later(function () { el.classList.remove('off'); }, d + 270);
      later(function () { stepDash(p, 0, -1.01, 16, 230, later); }, d + 340);
      later(function () { if (svg.parentNode) svg.parentNode.removeChild(svg); }, d + 640);
    });
  }

  /* ---- full-screen wipe ---- */
  var wipe = document.getElementById('wipe'), wipePath = wipe.querySelector('path');
  function wipeSetup(color) {
    var w = deck.clientWidth, h = deck.clientHeight, passes = 7;
    wipe.setAttribute('width', w); wipe.setAttribute('height', h);
    wipePath.setAttribute('d', zigzag(w, h, passes));
    wipePath.setAttribute('pathLength', '1');
    wipePath.setAttribute('stroke-width', (h / passes * 1.7).toFixed(0));
    wipePath.style.stroke = color;
  }
  function wipeAnim(from, to, ms) { stepDash(wipePath, from, to, 30, ms, function (f, t) { setTimeout(f, t); }); }

  /* ---- pager ---- */
  var dots = document.getElementById('dots'), count = document.getElementById('count'), announce = document.getElementById('announce');
  var prev = document.getElementById('prev'), next = document.getElementById('next');
  var nav = cardsNav({
    scenes: scenes, deck: deck, dots: dots, pager: dots.parentNode, reduce: reduce,
    go: function (n) { go(n); }, cur: function () { return cur; }, busy: function () { return busy; },
    slugs: { 'We are Overdrive': 'overdrive', 'Sponsors and contact': 'sponsors', 'BDASC outreach': 'outreach' }
  });
  function chrome() {
    count.textContent = (cur + 1) + '/' + scenes.length;
    prev.disabled = cur === 0; next.disabled = cur === scenes.length - 1;
    nav.update(cur);
  }
  prev.addEventListener('click', function () { go(cur - 1); });
  next.addEventListener('click', function () { go(cur + 1); });

  function show(n) {
    var had = scenes[cur].contains(document.activeElement);  // focus was on a link in the card that is leaving
    scenes[cur].classList.remove('active', 'leaving');
    cur = n;
    var sc = scenes[cur];
    sc.querySelector('.inner').scrollTop = 0;
    dress(sc);
    sc.classList.add('active');
    chrome();
    placeRobot();
    focusable();
    announce.textContent = 'Card ' + (cur + 1) + ' of ' + scenes.length + ': ' + sc.getAttribute('aria-label');
    if (had) { var h = sc.querySelector('.tiles'); h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }
  /* a card taller than the screen scrolls inside itself, so it has to be reachable from the keyboard */
  function focusable() {
    var el = scenes[cur].querySelector('.inner');
    if (el.scrollHeight > el.clientHeight + 2) el.setAttribute('tabindex', '0'); else el.removeAttribute('tabindex');
  }

  function go(n) {
    if (busy || n === cur || n < 0 || n >= scenes.length) return;
    if (reduce) { show(n); return; }
    busy = true;
    scenes[cur].classList.add('leaving');           // letters fall off
    wipeSetup(cssCol(scenes[n], '--pop'));
    setTimeout(function () {
      wipeAnim(1.01, 0, 400);                         // scribble the screen out
      setTimeout(function () {
        show(n);
        wipeAnim(0, -1.01, 400);                      // and rub it away
        setTimeout(function () { busy = false; lockUntil = performance.now() + 250; }, 420);
      }, 420);
    }, 220);
  }

  /* input (wheel, keys, swipe; never a scrolling page) lives in cards-nav.js */

  /* ---- photos: a marker outline is scrawled round each photo when its card comes up ---- */
  function wobblyRect(w, h, j) {
    var pts = [], n = 7, i;
    for (i = 0; i < n; i++) pts.push([w * i / n + rnd(-j, j), rnd(-j, j)]);
    for (i = 0; i < n; i++) pts.push([w + rnd(-j, j), h * i / n + rnd(-j, j)]);
    for (i = 0; i < n; i++) pts.push([w - w * i / n + rnd(-j, j), h + rnd(-j, j)]);
    for (i = 0; i < n; i++) pts.push([rnd(-j, j), h - h * i / n + rnd(-j, j)]);
    pts.push([pts[0][0] + 14, pts[0][1] + rnd(-j, j)]);           // overshoot the start, like a pen that didn't stop
    return 'M ' + pts.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' L ');
  }
  function scrawl(fig, k) {
    var old = fig.querySelector('.scrawl'); if (old) old.parentNode.removeChild(old);
    var pad = 22, w = fig.offsetWidth + pad * 2, h = fig.offsetHeight + pad * 2;
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'scrawl'); svg.setAttribute('width', w); svg.setAttribute('height', h);
    var sc = fig.closest('.scene');
    [[cssCol(sc, '--pop'), 4.5, 9, 6], [cssCol(sc, '--fg'), 2.2, 16, 12]].forEach(function (s, i) {
      var p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('d', wobblyRect(w - s[3] * 2, h - s[3] * 2, 5));
      p.setAttribute('transform', 'translate(' + s[3] + ' ' + s[3] + ')');
      p.setAttribute('pathLength', '1');
      p.style.stroke = s[0]; p.style.strokeWidth = s[1];
      svg.appendChild(p);
      if (reduce) p.style.strokeDashoffset = 0;
      else p.style.animation = 'scrawl-in .55s cubic-bezier(.3, .7, .4, 1) ' + (700 + k * 200 + i * 260) + 'ms both';
    });
    fig.appendChild(svg);
  }
  function placeRobot() {          // the deck calls this whenever a card is shown; here it dresses the photos
    Array.prototype.forEach.call(scenes[cur].querySelectorAll('.snap'), scrawl);
  }

  /* ---- start (on the card the URL names, if any) ---- */
  if (nav.start) { scenes[0].classList.remove('active'); cur = nav.start; scenes[cur].classList.add('active'); }
  dress(scenes[cur]);
  chrome();
  placeRobot();
  focusable();
  var rq = false;
  window.addEventListener('resize', function () {
    if (rq) return; rq = true;
    requestAnimationFrame(function () { rq = false; placeRobot(); focusable(); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.snap img'), function (img) {
    if (!img.complete) img.addEventListener('load', function () { if (img.closest('.scene') === scenes[cur]) placeRobot(); });
  });
})();
