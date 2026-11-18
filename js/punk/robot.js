// robot.js: poster page script (moved out of the HTML so the site's Content-Security-Policy allows it)
// three.js and the CAD are lazy-loaded by robot-3d.js once the model is near the viewport
import { loadKit, toonify, disposeAll } from '/js/punk/robot-3d.js';
// contents list, squares, deep links (#fbd-standing) and wheel/swipe/keys: js/punk/cards-nav.js
import { cardsNav } from '/js/punk/cards-nav.js';
var THREE, loadRobotModel, buildRobotVisual, TRAY;


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
  var dots = document.getElementById('dots'), count = document.getElementById('count');
  var prev = document.getElementById('prev'), next = document.getElementById('next');
  // the robot is Aryan everywhere you pick a card; keyed like STEPS (data-step, else aria-label)
  var nav = cardsNav({
    scenes: scenes, deck: deck, dots: dots, pager: dots.parentNode, reduce: reduce,
    go: function (n) { go(n); }, cur: function () { return cur; }, busy: function () { return busy; },
    titles: {
      'Meet Aryan': 'Meet Aryan',
      'Drive system': "Aryan's drive system",
      'Arm': "Aryan's arm",
      'Grabber': "Aryan's grabber",
      'Cargo tray': "Aryan's cargo tray",
      'Electronics': "Aryan's electronics",
      'By the numbers': 'Aryan by the numbers',
      'Free body diagram: standing still': 'Free body diagram: Aryan standing still',
      'Free body diagram: flat out': 'Free body diagram: Aryan flat out',
      'Free body diagram: arm holding a CORE': "Free body diagram: Aryan's arm holding a CORE",
      'Free body diagram: on the Space Station': 'Free body diagram: Aryan on the Space Station',
      'Fixing the grabber': "Fixing Aryan's grabber",
      'Spec sheet': "Aryan's spec sheet"
    },
    slugs: {
      'Meet Aryan': 'aryan',
      'Drive system': 'drive',
      'Arm': 'arm-design',                 // plain "arm" is an element id on the page
      'Cargo tray': 'tray',
      'By the numbers': 'numbers',
      'Free body diagram: standing still': 'fbd-standing',
      'Free body diagram: flat out': 'fbd-flat-out',
      'Free body diagram: arm holding a CORE': 'fbd-arm',
      'Free body diagram: on the Space Station': 'fbd-space-station',
      'Fixing the grabber': 'grabber-fix',
      'Spec sheet': 'specs'
    },
    // any free body diagram card added later still gets an fbd-... slug
    slug: function (label) { var m = /^free body diagram:\s*(.+)$/i.exec(label); return m ? 'fbd-' + m[1] : ''; }
  });
  function chrome() {
    count.textContent = (cur + 1) + '/' + scenes.length;
    prev.disabled = cur === 0; next.disabled = cur === scenes.length - 1;
    nav.update(cur);
  }
  prev.addEventListener('click', function () { go(cur - 1); });
  next.addEventListener('click', function () { go(cur + 1); });

  function show(n) {
    scenes[cur].classList.remove('active', 'leaving');
    cur = n;
    var sc = scenes[cur];
    sc.querySelector('.inner').scrollTop = 0;
    dress(sc);
    sc.classList.add('active');
    chrome();
    placeRobot();
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

  /* input (wheel, keys, swipe; never a scrolling page; a tall card scrolls first) lives in cards-nav.js */

  /* ---- boil: re-seed the wobble a few times a second so lines never sit still ---- */
  var noise = document.getElementById('boilNoise'), seed = 1;

  /* ---- the robot in the middle: the team's real CAD (assets/aryan.json + aryan.bin, from OVERDRIVE_009_FINAL_ROBOT_v3.step; the simulator drives the NRL kit robot, not this one),
          drawn in flat toon shading to sit with the poster look. Drag to turn it. ---- */
  var holder = document.getElementById('robot');
  var arrow = document.getElementById('arrow'), aInk = arrow.querySelector('.a-ink'), aCol = arrow.querySelector('.a-col');
  // one entry per card, keyed by the card's data-step (or its aria-label): where the model turns to,
  // and which part the arrow points at. Cards with data-side="full" hide the model instead.
  var STEP0 = { yaw: -0.65, pitch: 0.36, part: null };
  var STEPS = {
    'Meet Aryan': STEP0,
    'Drive system': { yaw: -0.95, pitch: 0.22, part: 'wheel' },
    'Arm': { yaw: -1.35, pitch: 0.28, part: 'arm' },
    'Grabber': { yaw: -0.45, pitch: 0.40, part: 'grabber' },
    'Cargo tray': { yaw: 2.55, pitch: 0.75, part: 'tray' },
    'Electronics': { yaw: -1.9, pitch: 0.85, part: 'hub' },
    'Fixing the grabber': { yaw: 0.35, pitch: 0.3, part: 'grabber' },
    'Spec sheet': STEP0
  };
  function isFull(sc) { return sc.getAttribute('data-side') === 'full'; }
  function step() {
    var sc = scenes[cur];
    if (!sc || isFull(sc)) return STEP0;
    return STEPS[sc.getAttribute('data-step') || sc.getAttribute('aria-label')] || STEP0;
  }
  var renderer, scene3, camera, bot, hero = null, markers = {}, ok = false, dead = false;
  var lastSize = 0, ac = null;   // ac: cached arrow measurements
  var yaw = -0.65, pitch = 0.36, tyaw = yaw, tpitch = pitch, dragging = false, touched = false, lastFrame = 0, arrowTimer = null;
  var onScreen = true, raf = 0, posterEl = holder.querySelector('.poster');

  function sizeRobot() {
    var w = deck.clientWidth, h = deck.clientHeight, s;
    if (w < 760) { s = Math.min(w * 0.84, h * 0.38); holder.style.top = (62 + s / 2) + 'px'; }
    else { s = Math.min(w * 0.38, h * 0.66); holder.style.top = '51%'; }
    holder.style.left = '50%';
    holder.style.width = s.toFixed(0) + 'px';
    s = Math.round(s);
    if (ok && s !== lastSize) { lastSize = s; renderer.setSize(s, s, false); draw(); }   // redraw at once so the canvas is never left blank
  }

  function placeRobot() {            // called every time a card is shown
    sizeRobot(); ac = null;
    var st = step(), full = isFull(scenes[cur]);
    holder.style.visibility = full ? 'hidden' : '';       // full-width cards (diagrams) get the whole screen
    holder.tabIndex = full ? -1 : 0;
    if (full && document.activeElement === holder) holder.blur();
    loop();
    touched = false;
    tyaw = st.yaw + Math.PI * 2 * Math.round((yaw - st.yaw) / (Math.PI * 2));
    tpitch = st.pitch;
    clearTimeout(arrowTimer);
    aInk.style.strokeDashoffset = aCol.style.strokeDashoffset = 1.01;
    aCol.style.stroke = cssCol(scenes[cur], '--pop');
    if (reduce) { yaw = tyaw; pitch = tpitch; if (ok && !full) draw(); }
    if (!st.part || !hero) return;
    if (reduce) { aInk.style.strokeDashoffset = aCol.style.strokeDashoffset = 0; return; }
    arrowTimer = setTimeout(function () {
      var sched = function (f, t) { setTimeout(f, t); };
      stepDash(aInk, 1.01, 0, 24, 330, sched); stepDash(aCol, 1.01, 0, 24, 330, sched);
    }, 950);
  }

  function marker(name, parent, x, y, z) {
    var o = new THREE.Object3D(); o.position.set(x, y, z); parent.add(o); markers[name] = o;
  }

  function build() {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    var phone = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 760;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, phone ? 1.5 : 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute('aria-hidden', 'true');
    holder.appendChild(renderer.domElement);
    scene3 = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    scene3.add(new THREE.AmbientLight(0xffffff, 0.7 * Math.PI));
    var key = new THREE.DirectionalLight(0xffffff, 0.85 * Math.PI); key.position.set(-5, 9, 7); scene3.add(key);
    bot = new THREE.Group(); scene3.add(bot);
    ok = true;
    lastSize = 0; sizeRobot();
  }

  // load the CAD, restyle it, and fit it to the frame
  function loadCad() {
    return loadRobotModel('/assets/', 'aryan').then(function (model) {
      if (dead) return;
      hero = buildRobotVisual(model, { squadCol: new THREE.Color(cssCol(root, '--fuchsia')), number: '009', shadows: false });
      toonify(THREE, hero.root);                    // flat toon shading instead of the sim's metal
      hero.pose(0);
      // CAD frame: metres, +X forward, +Y up. Turn it so the front faces the camera, scale it up, and centre it.
      var inner = new THREE.Group();
      inner.rotation.y = -Math.PI / 2;
      inner.add(hero.root);
      var box = new THREE.Box3().setFromObject(inner), size = new THREE.Vector3(), mid = new THREE.Vector3();
      box.getSize(size); box.getCenter(mid);
      var S = 5.6 / Math.max(size.x, size.y, size.z);
      inner.scale.setScalar(S);
      inner.position.set(-mid.x * S, 2.0 - mid.y * S, -mid.z * S);
      bot.add(inner);
      // the parts each card talks about, in the CAD's own coordinates
      var P = model.meta.pivots, th0 = model.meta.armAngle0Deg * Math.PI / 180, L = model.meta.armLinkLength;
      marker('wheel', hero.g.wheelFL, 0, 0, -0.03);
      marker('arm', hero.g.armUpper, L * 0.5 * Math.cos(th0), L * 0.5 * Math.sin(th0), 0);
      marker('grabber', hero.g.end, P.holdPoint[0], P.holdPoint[1], P.holdPoint[2]);
      marker('tray', hero.g.chassis, -0.093, 0.19, 0.052);    // v3 CAD: the printed cargo bay, rear right of centre
      marker('hub', hero.g.chassis, -0.06, 0.1, -0.03);       // v3 CAD: the HEXA hub board on the top plate, under the bay's left edge
      placeRobot();
      draw();
      if (posterEl && posterEl.parentNode) posterEl.parentNode.removeChild(posterEl);   // the real model is on screen: drop the still
      holder.setAttribute('aria-busy', 'false');
    });
  }

  var v3 = null;
  function draw() {
    var t = performance.now();
    bot.rotation.y = yaw;
    var D = 17.5;
    camera.position.set(0, 2.0 + Math.sin(pitch) * D, Math.cos(pitch) * D);
    camera.lookAt(0, 2.0, 0);
    if (hero) hero.pose(0.12 + (reduce ? 0 : Math.sin(t * 0.0012) * 0.06));   // the arm breathes; the parallelogram keeps the claw level
    renderer.render(scene3, camera);
    updateArrow();
  }

  /* arrow from the notes to the part being talked about; re-aimed every frame so it follows the model */
  function updateArrow() {
    var st = step();
    if (!st.part || !markers[st.part]) return;
    if (!v3) v3 = new THREE.Vector3();
    markers[st.part].getWorldPosition(v3); v3.project(camera);
    if (!ac) {                                   // measure the page once per card, not once per frame
      var hr = holder.getBoundingClientRect(), dr = deck.getBoundingClientRect();
      var head = scenes[cur].querySelector('.tiles').getBoundingClientRect();
      var narrow = deck.clientWidth < 760, sx, sy;
      if (narrow) { sx = head.left - dr.left + Math.min(head.width, 220) + 14; sy = head.top - dr.top + 8; }
      else if (scenes[cur].getAttribute('data-side') === 'right') { sx = dr.width - (dr.right - head.left) - 26; sy = head.top - dr.top + head.height / 2; }
      else {
        var last = scenes[cur].querySelector('.tiles .word:last-of-type').getBoundingClientRect();
        sx = Math.max(last.right, head.left + 60) - dr.left + 22; sy = last.top - dr.top + last.height / 2;
      }
      ac = { hx: hr.left - dr.left, hy: hr.top - dr.top, hw: hr.width, hh: hr.height, sx: sx, sy: sy, tx: -1e9, ty: -1e9 };
    }
    var tx = ac.hx + (v3.x * 0.5 + 0.5) * ac.hw, ty = ac.hy + (-v3.y * 0.5 + 0.5) * ac.hh;
    if (Math.abs(tx - ac.tx) + Math.abs(ty - ac.ty) < 0.4) return;   // target has not moved: leave the arrow alone
    ac.tx = tx; ac.ty = ty;
    var sx = ac.sx, sy = ac.sy;
    var rc = ac.hw * 0.075;
    var dx = tx - sx, dy = ty - sy, len = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / len, uy = dy / len;
    var ex = tx - ux * (rc + 8), ey = ty - uy * (rc + 8);
    var bend = (cur % 2 ? -1 : 1) * len * 0.16;
    var cx = (sx + ex) / 2 - uy * bend, cy = (sy + ey) / 2 + ux * bend;
    var ax = ex - cx, ay = ey - cy, al = Math.sqrt(ax * ax + ay * ay) || 1; ax /= al; ay /= al;
    var hs = Math.max(14, ac.hw * 0.045), c = Math.cos(0.5), s = Math.sin(0.5);
    var h1x = ex - (ax * c - ay * s) * hs, h1y = ey - (ax * s + ay * c) * hs;
    var h2x = ex - (ax * c + ay * s) * hs, h2y = ey - (-ax * s + ay * c) * hs;
    var f = function (n) { return n.toFixed(1); };
    var d = 'M ' + f(sx) + ' ' + f(sy) + ' Q ' + f(cx) + ' ' + f(cy) + ' ' + f(ex) + ' ' + f(ey) +
      ' M ' + f(h1x) + ' ' + f(h1y) + ' L ' + f(ex) + ' ' + f(ey) + ' L ' + f(h2x) + ' ' + f(h2y) +
      ' M ' + f(tx + rc) + ' ' + f(ty) + ' A ' + f(rc) + ' ' + f(rc * 0.85) + ' 0 1 1 ' + f(tx + rc * 0.9) + ' ' + f(ty - rc * 0.35);
    aInk.setAttribute('d', d); aCol.setAttribute('d', d);
  }

  /* render only while the model is near the viewport, the tab is visible and the card shows it.
     Reduced motion: no loop at all (no auto-spin, no breathing), it redraws on demand. */
  function wanted() { return ok && !dead && onScreen && !document.hidden && !isFull(scenes[cur]) && !reduce; }
  function loop() {
    if (wanted()) { if (!raf) raf = requestAnimationFrame(frame); }
    else if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }
  function nudge() { if (ok && !dead && reduce) draw(); }
  function frame(t) {
    raf = 0;
    if (!wanted()) return;
    raf = requestAnimationFrame(frame);
    lastFrame = t;
    if (!dragging) {
      if (!step().part && !touched) tyaw += 0.008;       // nothing to point at: turn slowly on the spot
      yaw += (tyaw - yaw) * 0.1; pitch += (tpitch - pitch) * 0.1;
    }
    draw();
  }
  function clampPitch(p) { return Math.max(-0.12, Math.min(1.25, p)); }

  /* drag to orbit. touch-action: pan-y, so a vertical swipe on the model still flips the card;
     a sideways drag turns the model and is kept from flipping the card. */
  var px = 0, py = 0, dragDist = 0;
  holder.addEventListener('pointerdown', function (e) {
    dragging = true; touched = true; px = e.clientX; py = e.clientY; dragDist = 0;
    try { holder.setPointerCapture(e.pointerId); } catch (err) {}
  });
  holder.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    dragDist += Math.abs(e.clientX - px);
    yaw += (e.clientX - px) * 0.011;
    if (e.pointerType !== 'touch') pitch = clampPitch(pitch + (e.clientY - py) * 0.007);
    px = e.clientX; py = e.clientY; tyaw = yaw; tpitch = pitch;
    nudge();
  });
  var endDrag = function () { dragging = false; };
  holder.addEventListener('pointerup', endDrag); holder.addEventListener('pointercancel', endDrag);
  holder.addEventListener('touchend', function (e) { if (dragDist > 8) e.stopPropagation(); }, { passive: true });

  /* keyboard: arrow keys turn and tilt the model while it has focus (Shift for bigger steps) */
  holder.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var a = e.shiftKey ? 0.6 : 0.2, k = e.key;
    if (k === 'ArrowLeft') tyaw -= a;
    else if (k === 'ArrowRight') tyaw += a;
    else if (k === 'ArrowUp') tpitch = clampPitch(tpitch + a * 0.6);
    else if (k === 'ArrowDown') tpitch = clampPitch(tpitch - a * 0.6);
    else return;
    e.preventDefault(); e.stopPropagation();          // keep the card pager from also taking the key
    touched = true;
    if (reduce) { yaw = tyaw; pitch = tpitch; nudge(); }
  });

  function fallback() {
    ok = false;
    if (renderer && renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    holder.innerHTML = '<img src="/assets/punk/logo.png" alt="">';
    holder.removeAttribute('aria-busy');
  }

  /* lazy start: three.js + the CAD are only fetched once the model is near the viewport */
  var started = false;
  function start3d() {
    if (started || dead) return;
    started = true;
    holder.setAttribute('aria-busy', 'true');
    loadKit().then(function (k) {
      if (dead) return;
      THREE = k.THREE; loadRobotModel = k.loadRobotModel; buildRobotVisual = k.buildRobotVisual; TRAY = k.TRAY;
      build();
      return loadCad();
    }).then(loop).catch(function (err) { if (!dead) { console.warn('robot model:', err); fallback(); } });
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      onScreen = es[es.length - 1].isIntersecting;
      if (onScreen) start3d();
      loop();
    }, { rootMargin: '25% 0px' }).observe(holder);
  } else start3d();
  document.addEventListener('visibilitychange', loop);
  window.addEventListener('pagehide', function () {    // navigating away: give the GPU memory back
    dead = true; ok = false; loop();
    disposeAll(scene3, renderer);
    renderer = scene3 = hero = bot = null; markers = {};
  });
  window.addEventListener('pageshow', function (e) {   // restored from the back/forward cache: build it again
    if (!e.persisted || !dead) return;
    dead = false; started = false;
    if (posterEl && !posterEl.parentNode) holder.insertBefore(posterEl, holder.firstChild);
    if (onScreen) start3d();
  });

  /* ---- start (on the card the URL names, if any) ---- */
  if (nav.start) { scenes[0].classList.remove('active'); cur = nav.start; scenes[cur].classList.add('active'); }
  dress(scenes[cur]);
  chrome();
  placeRobot();
  window.addEventListener('resize', function () { ac = null; sizeRobot(); });
  deck.addEventListener('scroll', function () { ac = null; }, true);
})();
