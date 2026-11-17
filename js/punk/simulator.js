// simulator.js: poster page script (moved out of the HTML so the site's Content-Security-Policy allows it)
// three.js (~650 KB) is imported after first paint (see startRobot) so the cards paint and
// animate in without waiting for it to download and compile
var THREE;
// contents list, squares, deep links and wheel/swipe/keys: js/punk/cards-nav.js
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
    var h = sc.querySelector('.tiles');
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
  var introEnd = 0;                                    // when the current card's paste-and-scribble intro finishes
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); introEnd = Math.max(introEnd, performance.now() + ms); }
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
    titles: { 'Practise the match. Scout the field.': 'Start: practise the match, scout the field' },
    slugs: { 'Practise the match. Scout the field.': 'start', '03 Overdrive Scout': 'scout' }
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

  /* ---- the robot: same model as the home page, drawn at ~10 frames a second ---- */
  var holder = document.getElementById('robot');
  var renderer, scene3, camera, rig, head, gear, eyes = [], pupils = [], decalTex, decalCanvas, ok = false;

  function placeRobot() {
    var w = deck.clientWidth, h = deck.clientHeight, mode = scenes[cur].getAttribute('data-robot');
    var narrow = w < 760, x, y, s;
    if (mode === 'center') { x = 0.5; y = narrow ? 0.6 : 0.6; s = Math.min(w * 0.78, h * 0.44); }
    else if (narrow) { x = 0.76; y = 1; s = Math.min(w * 0.4, 170); y = (h - s * 0.5 - 70) / h; }
    else if (mode === 'right') { x = 0.78; y = 0.52; s = Math.min(w * 0.36, h * 0.6); }
    else if (mode === 'left') { x = 0.22; y = 0.52; s = Math.min(w * 0.36, h * 0.6); }
    else { x = 0.9; y = 0.2; s = Math.min(w * 0.17, h * 0.3); }
    holder.style.left = (x * 100).toFixed(1) + '%';
    holder.style.top = (y * 100).toFixed(1) + '%';
    holder.style.width = s.toFixed(0) + 'px';
    holder.style.transform = 'translate(-50%,-50%) rotate(' + rnd(-9, 9).toFixed(1) + 'deg)';
    if (ok) { renderer.setSize(s, s, false); renderer.render(scene3, camera); }
  }

  function gearGeometry(teeth, rTip, rRoot, rHole, depth) {
    var s = new THREE.Shape(), step = Math.PI * 2 / teeth;
    var prof = [[0.00, rRoot], [0.14, rTip], [0.42, rTip], [0.56, rRoot]];
    for (var i = 0; i < teeth; i++) for (var j = 0; j < prof.length; j++) {
      var a = (i + prof[j][0]) * step, r = prof[j][1];
      if (i === 0 && j === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    s.closePath();
    var hole = new THREE.Path(); hole.absarc(0, 0, rHole, 0, Math.PI * 2, true); s.holes.push(hole);
    var g = new THREE.ExtrudeGeometry(s, { depth: depth, bevelEnabled: false, curveSegments: 48 });
    g.translate(0, 0, -depth / 2);
    return g;
  }
  function drawDecal() {
    if (!decalCanvas) return;
    var c = decalCanvas.getContext('2d');
    c.clearRect(0, 0, 256, 128);
    c.fillStyle = '#121013'; c.font = '104px Anton, Impact, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('009', 128, 70);
    if (decalTex) decalTex.needsUpdate = true;
  }
  function build() {
    var col = function (n) { return new THREE.Color(cssCol(root, n)); };
    var ramp = new THREE.DataTexture(new Uint8Array([70, 150, 215, 255]), 4, 1, THREE.RedFormat);
    ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.generateMipmaps = false; ramp.needsUpdate = true;
    var toon = function (n) { return new THREE.MeshToonMaterial({ color: col(n), gradientMap: ramp }); };
    var flat = function (n) { return new THREE.MeshBasicMaterial({ color: col(n) }); };

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    holder.appendChild(renderer.domElement);
    scene3 = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 0, 4.1 / Math.tan(15 * Math.PI / 180));
    scene3.add(new THREE.AmbientLight(0xffffff, 0.62 * Math.PI));
    var key = new THREE.DirectionalLight(0xffffff, 0.85 * Math.PI); key.position.set(-4, 6, 8); scene3.add(key);

    rig = new THREE.Group(); scene3.add(rig);
    gear = new THREE.Mesh(gearGeometry(10, 3.3, 2.7, 1.95, 0.55), toon('--acid')); gear.position.z = -1.0; rig.add(gear);
    var hub = new THREE.Mesh(new THREE.CylinderGeometry(1.95, 1.95, 0.3, 48), toon('--ink'));
    hub.rotation.x = Math.PI / 2; hub.position.z = -1.1; rig.add(hub);
    head = new THREE.Group(); head.position.z = 0.35; rig.add(head);
    var paper = toon('--paper'), ink = toon('--ink'), sky = toon('--sky');
    head.add(new THREE.Mesh(new THREE.BoxGeometry(2.7, 2.15, 2.0), paper));
    var visor = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.86, 0.24), ink); visor.position.set(0, 0.22, 0.95); head.add(visor);
    [-0.56, 0.56].forEach(function (x) {
      var eye = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.08, 40), flat('--fuchsia'));
      eye.rotation.x = Math.PI / 2; eye.position.set(x, 0.22, 1.09); head.add(eye); eyes.push(eye);
      var pupil = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 24), flat('--paper'));
      pupil.rotation.x = Math.PI / 2; pupil.position.set(x, 0.22, 1.14); pupil.userData.x0 = x; head.add(pupil); pupils.push(pupil);
    });
    for (var i = -2; i <= 2; i++) {
      var bar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.34, 0.08), ink); bar.position.set(i * 0.27, -0.62, 1.0); head.add(bar);
    }
    [-1, 1].forEach(function (s) {
      var ear = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.32, 10), sky);
      ear.rotation.z = Math.PI / 2; ear.position.set(s * 1.5, 0.1, 0); head.add(ear);
      var nut = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.16, 6), ink);
      nut.rotation.z = Math.PI / 2; nut.position.set(s * 1.72, 0.1, 0); head.add(nut);
    });
    var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 10), ink);
    mast.position.set(0.7, 1.45, 0); mast.rotation.z = -0.2; head.add(mast);
    var bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), flat('--fuchsia')); bulb.position.set(0.79, 1.9, 0); head.add(bulb);
    var neck = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 0.6, 20), ink); neck.position.set(0, -1.3, -0.1); head.add(neck);
    decalCanvas = document.createElement('canvas'); decalCanvas.width = 256; decalCanvas.height = 128;
    decalTex = new THREE.CanvasTexture(decalCanvas); decalTex.colorSpace = THREE.SRGBColorSpace; drawDecal();
    var decal = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.31), new THREE.MeshBasicMaterial({ map: decalTex, transparent: true }));
    decal.position.set(-0.85, 0.86, 1.005); decal.rotation.z = 0.06; head.add(decal);
    ok = true;
  }

  var tx = 0, ty = 0, lx = 0, ly = 0, lastMove = -1e9;
  window.addEventListener('pointermove', function (e) {
    var r = holder.getBoundingClientRect();
    tx = Math.max(-1, Math.min(1, (e.clientX - r.left - r.width / 2) / (window.innerWidth / 2)));
    ty = Math.max(-1, Math.min(1, (e.clientY - r.top - r.height / 2) / (window.innerHeight / 2)));
    lastMove = performance.now();
  }, { passive: true });
  function pose(x, y, k, t) {
    lx += (x - lx) * k; ly += (y - ly) * k;
    head.rotation.set(ly * 0.5, lx * 0.78, -lx * 0.07);
    rig.rotation.set(ly * 0.14, lx * 0.22, 0);
    for (var i = 0; i < pupils.length; i++) {
      pupils[i].position.x = pupils[i].userData.x0 + lx * 0.12;
      pupils[i].position.y = 0.22 - ly * 0.11;
    }
    gear.rotation.z = t * 0.00025;
    head.position.y = Math.sin(t * 0.0016) * 0.08;
    var blink = (t % 4300) < 200 ? 0.12 : 1;
    for (var j = 0; j < eyes.length; j++) eyes[j].scale.z = blink;
  }
  function frame(t) {
    rafId = requestAnimationFrame(frame);
    var x = tx, y = ty;
    if (t - lastMove > 3500) { x = Math.sin(t * 0.0007) * 0.75; y = Math.sin(t * 0.0011 + 1) * 0.4; }
    pose(x, y, 0.1, t);
    renderer.render(scene3, camera);
  }

  var rafId = 0;
  function noRobot() { ok = false; holder.innerHTML = '<img src="/assets/punk/logo.png" alt="">'; }
  /* robot: fetch three.js once the first card has painted, then build and start in separate tasks */
  function startRobot() {
    import('/lib/three.module.js').then(function (m) {
      THREE = m;
      setTimeout(function () {
        try { build(); } catch (err) { noRobot(); return; }
        var s = parseFloat(holder.style.width) || holder.clientWidth;
        renderer.setSize(s, s, false);
        var go = function () {
          if (reduce) { pose(0.25, -0.1, 1, 0); renderer.render(scene3, camera); }
          else if (!rafId) rafId = requestAnimationFrame(frame);
        };
        // compile the shaders in the background (KHR_parallel_shader_compile) instead of inside the first frame
        if (renderer.compileAsync) renderer.compileAsync(scene3, camera).then(go, go); else setTimeout(go, 0);
      }, 0);
    }, noRobot);
  }
  var idle = window.requestIdleCallback || function (f) { return setTimeout(f, 1); };
  function whenLoaded(f) { if (document.readyState === 'complete') f(); else window.addEventListener('load', f, { once: true }); }
  // after load and after the first frame has actually been presented (two rAFs), on an idle slot
  // after load, once the first card's intro has played (so the download and compile don't fight it), on an idle slot
  whenLoaded(function () {
    setTimeout(function () { idle(startRobot, { timeout: 300 }); }, Math.max(0, introEnd - performance.now()));
  });
  // stop drawing while the tab is hidden; pick up again when it comes back
  document.addEventListener('visibilitychange', function () {
    if (!ok || reduce) return;
    if (document.hidden) { cancelAnimationFrame(rafId); rafId = 0; }
    else if (!rafId) rafId = requestAnimationFrame(frame);
  });

  /* ---- start (on the card the URL names, if any) ---- */
  if (nav.start) { scenes[0].classList.remove('active'); cur = nav.start; scenes[cur].classList.add('active'); }
  dress(scenes[cur]);
  chrome();
  placeRobot();
  focusable();
  var rq = false;                                       // at most one re-layout per frame while the window is dragged
  window.addEventListener('resize', function () {
    if (rq) return; rq = true;
    requestAnimationFrame(function () { rq = false; placeRobot(); focusable(); });
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawDecal);
})();
