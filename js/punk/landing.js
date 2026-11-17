// landing.js: poster page script (moved out of the HTML so the site's Content-Security-Policy allows it)
// three.js (~650 KB) is imported after first paint (see startRobot) so the title and lettering
// paint without waiting for it to download and compile
var THREE;

(function () {
  var root = document.documentElement;
  var poster = document.getElementById('poster');
  var word = document.getElementById('word');
  var stage = document.getElementById('stage');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var deck = document.getElementById('deck');
  root.classList.add('js');   // shows the paper link tags on the lettering (see .js .pages in index.html)

  /* ---- fit the name wall to wall ---- */
  function fitTitle() {
    var cs = getComputedStyle(poster);
    var avail = poster.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    root.style.setProperty('--ts', '100px');
    var w = word.getBoundingClientRect().width || 420;
    var size = Math.min(avail * 0.97 / w * 100, Math.min(poster.clientHeight, window.innerHeight) * 0.4);
    root.style.setProperty('--ts', size.toFixed(1) + 'px');
  }
  fitTitle();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { fitTitle(); resize(); });

  /* ---- 3D robot head on a gear ---- */
  var renderer, scene, camera, rig, head, gear, eyes = [], pupils = [], decalTex, decalCanvas;
  var ok = false;

  function fallback() {
    var img = document.createElement('img');
    img.src = '/assets/punk/logo.png'; img.alt = ''; img.className = 'fallback';
    stage.appendChild(img);
  }

  function toonRamp() {
    var data = new Uint8Array([70, 150, 215, 255]);
    var t = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  }

  function gearGeometry(teeth, rTip, rRoot, rHole, depth) {
    var s = new THREE.Shape();
    var step = Math.PI * 2 / teeth;
    var prof = [[0.00, rRoot], [0.14, rTip], [0.42, rTip], [0.56, rRoot]];
    for (var i = 0; i < teeth; i++) {
      for (var j = 0; j < prof.length; j++) {
        var a = (i + prof[j][0]) * step, r = prof[j][1];
        var x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (i === 0 && j === 0) s.moveTo(x, y); else s.lineTo(x, y);
      }
    }
    s.closePath();
    var hole = new THREE.Path();
    hole.absarc(0, 0, rHole, 0, Math.PI * 2, true);
    s.holes.push(hole);
    var g = new THREE.ExtrudeGeometry(s, { depth: depth, bevelEnabled: false, curveSegments: 48 });
    g.translate(0, 0, -depth / 2);
    return g;
  }

  function drawDecal() {
    if (!decalCanvas) return;
    var c = decalCanvas.getContext('2d');
    c.clearRect(0, 0, 256, 128);
    c.fillStyle = '#121013';
    c.font = '104px Anton, Impact, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('009', 128, 70);
    if (decalTex) decalTex.needsUpdate = true;
  }

  function build() {
    var css = getComputedStyle(root);
    var col = function (n) { return new THREE.Color(css.getPropertyValue(n).trim()); };
    var ramp = toonRamp();
    var toon = function (n) { return new THREE.MeshToonMaterial({ color: col(n), gradientMap: ramp }); };
    var flat = function (n) { return new THREE.MeshBasicMaterial({ color: col(n) }); };

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute('aria-hidden', 'true');
    stage.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    scene.add(new THREE.AmbientLight(0xffffff, 0.62 * Math.PI));
    var key = new THREE.DirectionalLight(0xffffff, 0.85 * Math.PI);
    key.position.set(-4, 6, 8);
    scene.add(key);

    rig = new THREE.Group();
    scene.add(rig);

    // gear, ten teeth like the logo
    gear = new THREE.Mesh(gearGeometry(10, 3.3, 2.7, 1.95, 0.55), toon('--acid'));
    gear.position.z = -1.0;
    rig.add(gear);
    var hub = new THREE.Mesh(new THREE.CylinderGeometry(1.95, 1.95, 0.3, 48), toon('--ink'));
    hub.rotation.x = Math.PI / 2; hub.position.z = -1.1;
    rig.add(hub);

    head = new THREE.Group();
    head.position.z = 0.35;
    rig.add(head);

    var paper = toon('--paper'), ink = toon('--ink'), sky = toon('--sky');

    head.add(new THREE.Mesh(new THREE.BoxGeometry(2.7, 2.15, 2.0), paper));

    var visor = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.86, 0.24), ink);
    visor.position.set(0, 0.22, 0.95);
    head.add(visor);

    [-0.56, 0.56].forEach(function (x) {
      var eye = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.08, 40), flat('--fuchsia'));
      eye.rotation.x = Math.PI / 2;
      eye.position.set(x, 0.22, 1.09);
      head.add(eye); eyes.push(eye);
      var pupil = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 24), flat('--paper'));
      pupil.rotation.x = Math.PI / 2;
      pupil.position.set(x, 0.22, 1.14);
      pupil.userData.x0 = x;
      head.add(pupil); pupils.push(pupil);
    });

    // mouth grille
    for (var i = -2; i <= 2; i++) {
      var bar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.34, 0.08), ink);
      bar.position.set(i * 0.27, -0.62, 1.0);
      head.add(bar);
    }

    // ear bolts
    [-1, 1].forEach(function (s) {
      var ear = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.32, 10), sky);
      ear.rotation.z = Math.PI / 2;
      ear.position.set(s * 1.5, 0.1, 0);
      head.add(ear);
      var nut = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.16, 6), ink);
      nut.rotation.z = Math.PI / 2;
      nut.position.set(s * 1.72, 0.1, 0);
      head.add(nut);
    });

    // antenna
    var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 10), ink);
    mast.position.set(0.7, 1.45, 0);
    mast.rotation.z = -0.2;
    head.add(mast);
    var bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), flat('--fuchsia'));
    bulb.position.set(0.79, 1.9, 0);
    head.add(bulb);

    // neck
    var neck = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 0.6, 20), ink);
    neck.position.set(0, -1.3, -0.1);
    head.add(neck);

    // 009 stencilled on the forehead
    decalCanvas = document.createElement('canvas');
    decalCanvas.width = 256; decalCanvas.height = 128;
    decalTex = new THREE.CanvasTexture(decalCanvas); decalTex.colorSpace = THREE.SRGBColorSpace;
    drawDecal();
    var decal = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.31),
      new THREE.MeshBasicMaterial({ map: decalTex, transparent: true }));
    decal.position.set(-0.85, 0.86, 1.005);
    decal.rotation.z = 0.06;
    head.add(decal);

    ok = true;
  }

  /* the 009 sticker: in its old bottom-right corner beside the deck when the deck's text and buttons fit to its
     left, otherwise lifted to sit just above the deck */
  var num = poster.querySelector('.num'), acts = deck && deck.querySelector('.acts');
  function placeNum() {
    if (!deck || !num) return;
    deck.style.paddingRight = '';
    var stacked = getComputedStyle(deck).gridRowStart !== '4', foot, beside;
    function fits() {
      foot = num.offsetWidth + parseFloat(getComputedStyle(num).right) - parseFloat(getComputedStyle(poster).paddingRight) + 24;
      return !stacked && deck.clientWidth - foot >= acts.offsetWidth + 22 + 290;
    }
    poster.classList.remove('num-small');
    beside = fits();
    if (!beside && !stacked && poster.clientWidth >= 700) {   // a slightly smaller sticker often makes room
      poster.classList.add('num-small');
      beside = fits();                                        // (if not, the smaller sticker still covers less when lifted)
    }
    poster.classList.toggle('num-beside', beside);
    if (beside) deck.style.paddingRight = foot + 'px';
    var lift = beside || stacked ? 0 : Math.round(poster.getBoundingClientRect().bottom - deck.getBoundingClientRect().top);
    poster.style.setProperty('--deck-h', lift + 'px');
  }

  function resize() {
    fitTitle();
    placeNum();
    var w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    stageRect = null;
    computeLayout(w, h);
    drawLettering();
    stage.style.setProperty('--rx', geom.cx + 'px');
    stage.style.setProperty('--ry', geom.cy + 'px');
    stage.style.setProperty('--rr', geom.R + 'px');
    if (!ok) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    var halfWorld = 3.3 * h / (2 * geom.R); // gear tip radius (3.3 world units) lands on geom.R pixels
    camera.position.set(0, 0, halfWorld / Math.tan(camera.fov * Math.PI / 360));
    camera.updateProjectionMatrix();
    var wpp = 2 * halfWorld / h;
    rig.position.set((geom.cx - w / 2) * wpp, -(geom.cy - h / 2) * wpp, 0);
    if (reduce) renderer.render(scene, camera);
  }

  /* ---- pointer tracking ---- */
  var tx = 0, ty = 0, lastMove = -1e9;
  var stageRect = null;                                  // cached; dropped on resize and on scroll (short landscape screens scroll)
  window.addEventListener('scroll', function () { stageRect = null; }, { passive: true });
  function onPointer(e) {
    var r = stageRect || (stageRect = stage.getBoundingClientRect());
    var cx = r.left + (geom.cx || r.width / 2), cy = r.top + (geom.cy || r.height / 2);
    tx = Math.max(-1, Math.min(1, (e.clientX - cx) / (window.innerWidth / 2)));
    ty = Math.max(-1, Math.min(1, (e.clientY - cy) / (window.innerHeight / 2)));
    lastMove = performance.now();
    if (reduce && ok) { pose(tx, ty, 1, 0); renderer.render(scene, camera); }
  }
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('pointerdown', onPointer, { passive: true });

  var lx = 0, ly = 0;
  function pose(x, y, k, t) {
    lx += (x - lx) * k; ly += (y - ly) * k;
    head.rotation.y = lx * 0.78;
    head.rotation.x = ly * 0.5;
    head.rotation.z = -lx * 0.07;
    rig.rotation.y = lx * 0.22;
    rig.rotation.x = ly * 0.14;
    for (var i = 0; i < pupils.length; i++) {
      pupils[i].position.x = pupils[i].userData.x0 + lx * 0.12;
      pupils[i].position.y = 0.22 - ly * 0.11;
    }
    if (t) {
      gear.rotation.z = t * 0.00025;
      head.position.y = Math.sin(t * 0.0016) * 0.08;
      var blink = (t % 4300) < 130 ? 0.12 : 1;
      for (var j = 0; j < eyes.length; j++) eyes[j].scale.z = blink; // local z is screen-vertical after the x rotation
    }
  }

  function frame(t) {
    var x = tx, y = ty;
    if (t - lastMove > 3500) { // nobody home: look around on its own
      x = Math.sin(t * 0.0007) * 0.75;
      y = Math.sin(t * 0.0011 + 1) * 0.4;
    }
    pose(x, y, 0.085, t);
    renderer.render(scene, camera);
  }

  /* ---- contour lettering: each nav word is stretched to fill a region whose
          edges follow the robot's outline on one side and a wavy line on the other ---- */
  var WORDS = [
    { key: 'simulator', label: 'SIMULATOR', color: '--sky' },
    { key: 'about',     label: 'ABOUT US',  color: '--paper' },
    { key: 'robot',     label: 'OUR ROBOT', color: '--fuchsia' }
  ];
  var letterCanvas = document.getElementById('lettering');
  var lctx = letterCanvas.getContext('2d');
  var hits = document.getElementById('hits');
  var geom = { cx: 0, cy: 0, R: 1, w: 0, h: 0, regions: {} };
  var hot = null;
  function cssCol(n) { return getComputedStyle(root).getPropertyValue(n).trim(); }

  function makeSprite(label, color) {
    var font = '200px Anton, Impact, "Arial Narrow", sans-serif';
    var c = document.createElement('canvas'), x = c.getContext('2d');
    x.font = font;
    var m = x.measureText(label);
    var asc = Math.ceil(m.actualBoundingBoxAscent || 150);
    var desc = Math.ceil(m.actualBoundingBoxDescent || 0);
    c.width = Math.ceil(m.width) + 4;
    c.height = asc + desc + 2;
    x = c.getContext('2d');
    x.font = font; x.fillStyle = color; x.textBaseline = 'alphabetic';
    x.fillText(label, 2, asc + 1);
    return c;
  }
  function buildSprites() {
    WORDS.forEach(function (wd) {
      wd.sprite = makeSprite(wd.label, cssCol(wd.color));
      wd.spriteInk = makeSprite(wd.label, cssCol('--ink'));
      wd.aspect = wd.sprite.width / wd.sprite.height;
    });
  }
  buildSprites();

  function computeLayout(w, h) {
    var ts = parseFloat(getComputedStyle(root).getPropertyValue('--ts')) || 100;
    var m = ts * 0.2;              // strip of the stage that sits under the title
    var INF = 1e9, sin = Math.sin;
    var a = w / 2, cx, cy, R, g, regs = {};
    function region(x0, x1, topFn, botFn) {
      var n = Math.max(12, Math.round((x1 - x0) / 3)), top = [], bot = [];
      for (var i = 0; i <= n; i++) {
        var x = x0 + (x1 - x0) * i / n, t = topFn(x), b = botFn(x);
        if (b < t + 8) b = t + 8;
        top.push([cx + x, cy + t]); bot.push([cx + x, cy + b]);
      }
      return { top: top, bot: bot };
    }
    var circT = function (x) { return Math.abs(x) < g ? -Math.sqrt(g * g - x * x) : INF; };
    var circB = function (x) { return Math.abs(x) < g ? Math.sqrt(g * g - x * x) : -INF; };

    if (w >= h * 1.8) {
      /* wide: SIMULATOR upper left and OUR ROBOT upper right taper over the gear's
         shoulders; ABOUT US runs underneath with its top edge cupping the gear */
      var b = h / 2;
      cx = a; cy = 0.9 * b; R = 0.56 * b; g = R + 0.07 * b;
      var yT = -cy + m, floor = 0.14 * b;
      var aw = Math.min(a - 10, 2.7 * b);
      var amp = 0.022 * b, k = 5 / b;
      var inner = 0.9 * g;
      var hS = Math.min(floor - yT, (aw - inner) / WORDS[0].aspect * 2.1);
      var hR = Math.min(floor - yT, (aw - inner) / WORDS[2].aspect * 2.1);
      regs.simulator = region(-aw, -inner,
        function (x) { return yT + amp * sin(x * k); },
        function (x) { return Math.min(yT + hS + amp * sin(x * k + 2), circT(x)); });
      var drop = 0.2 * b; // OUR ROBOT sits lower than SIMULATOR, beside the gear rather than over its shoulder
      regs.robot = region(1.12 * g, aw,
        function (x) { return yT + drop + amp * sin(x * k + 1); },
        function (x) { return yT + drop + hR + amp * sin(x * k + 4); });
      var yA = floor + 0.06 * b;
      regs.about = region(Math.max(-aw, -1.75 * g), 1.0 * g,
        function (x) { return Math.max(circB(x), yA + amp * sin(x * k + 3)); },
        function (x) { return h - cy - 0.14 * b - amp + amp * sin(x * k + 5); });
    } else {
      /* tall: SIMULATOR arches over the gear, ABOUT US cups it from below,
         OUR ROBOT rides the wave under that (leaving the corner for the 009 sticker) */
      var avail = h - m;
      R = Math.min(0.6 * a, 0.24 * avail); g = R * 1.1;
      var free = Math.max(60, avail - 2 * g);
      var tS = 0.28 * free, tA = 0.28 * free, tR = 0.27 * free, gap = 0.05 * free;   // room under OUR ROBOT for its tag
      cx = a; cy = m + tS + g;
      var xw = Math.min(a - 8, 2.4 * g);
      var amp2 = 0.07 * tA, k2 = 2 * Math.PI / (1.3 * xw);
      var sideS = -g + Math.min(0.9 * tS, 0.75 * g);
      var sideA = g - Math.min(0.9 * tA, 0.75 * g);
      regs.simulator = region(-xw, xw,
        function (x) { return -g - tS + amp2 + amp2 * sin(x * k2); },
        function (x) { return Math.min(circT(x), sideS); });
      regs.about = region(-xw, xw,
        function (x) { return Math.max(circB(x), sideA); },
        function (x) { return g + tA + amp2 * sin(x * k2 + 2); });
      regs.robot = region(-xw, xw * 0.3,
        function (x) { return g + tA + gap + amp2 * sin(x * k2 + 2); },
        function (x) { return g + tA + gap + tR - amp2 + amp2 * sin(x * k2 + 4.5); });
    }
    geom = { cx: cx, cy: cy, R: R, w: w, h: h, regions: regs };

    hits.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    WORDS.forEach(function (wd) {
      var r = regs[wd.key];
      var pts = r.top.concat(r.bot.slice().reverse()).map(function (p) {
        return p[0].toFixed(1) + ',' + p[1].toFixed(1);
      }).join(' ');
      hits.querySelector('a[data-key="' + wd.key + '"] polygon').setAttribute('points', pts);
    });
    placeTags(w >= h * 1.8);
  }

  /* paper tags naming each block of lettering as a link: pinned to an edge of its region, clamped inside the
     stage; a spot that would cover the robot head, its name tag, the 009 sticker or another tag gives way to the
     next spot in the list */
  var robby = stage.querySelector('.robby');
  function placeTags(wide) {
    // [edge, position along it, then a shift in half-widths / half-heights of the tag]
    var spots = wide
      ? { simulator: [['bot', 0.3, 0, 0.7]], about: [['bot', 0, -0.9, -0.8]], robot: [['bot', 0.25, 0, 0.7]] }
      : { simulator: [['bot', 0.08, 0.6, 0.5]],
          about: [['top', 0.95, -0.6, -0.2], ['bot', 1, -1, -0.75], ['bot', 0, 1, -0.75]],
          robot: [['bot', 0.45, 0, 0.75], ['bot', 0, 1, 0.75]] };
    var R = geom.R, sx = stage.offsetLeft, sy = stage.offsetTop;
    function box(el) { return { x: el.offsetLeft - sx + el.offsetWidth / 2, y: el.offsetTop - sy + el.offsetHeight / 2, hw: el.offsetWidth / 2, hh: el.offsetHeight / 2 }; }
    var avoid = [];
    if (robby) avoid.push({ x: geom.cx, y: geom.cy + R * 0.74, hw: robby.offsetWidth / 2, hh: robby.offsetHeight / 2 });
    if (num && getComputedStyle(num).display !== 'none') avoid.push(box(num));
    function clear(x, y, hw, hh) {
      var dx = Math.max(Math.abs(x - geom.cx) - hw, 0), dy = Math.max(Math.abs(y - geom.cy) - hh, 0);
      if (Math.sqrt(dx * dx + dy * dy) < 0.8 * R) return false;                          // over the head
      return avoid.every(function (b) { return Math.abs(x - b.x) >= hw + b.hw || Math.abs(y - b.y) >= hh + b.hh; });
    }
    Array.prototype.forEach.call(document.querySelectorAll('#pages a'), function (aEl) {
      var key = aEl.getAttribute('data-key'), r = geom.regions[key], list = spots[key];
      if (!r || !list) return;
      var hw = (aEl.offsetWidth || 120) / 2 + 6, hh = (aEl.offsetHeight || 40) / 2 + 4, x, y, first;
      for (var i = 0; i < list.length; i++) {
        var s = list[i], edge = r[s[0]], p = edge[Math.round((edge.length - 1) * s[1])];
        x = Math.max(hw, Math.min(geom.w - hw, p[0] + s[2] * hw));
        y = Math.max(hh, Math.min(geom.h - hh, p[1] + s[3] * hh));
        if (!first) first = [x, y];
        if (clear(x, y, hw - 6, hh - 4)) { first = null; break; }
      }
      if (first) { x = first[0]; y = first[1]; }                                        // nothing clear: first choice
      avoid.push({ x: x, y: y, hw: hw - 6, hh: hh - 4 });
      aEl.style.setProperty('--x', x.toFixed(1) + 'px');
      aEl.style.setProperty('--y', y.toFixed(1) + 'px');
    });
  }

  function drawLettering() {
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5), w = geom.w, h = geom.h;
    var pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (letterCanvas.width !== pw || letterCanvas.height !== ph) { letterCanvas.width = pw; letterCanvas.height = ph; }
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, pw, ph);
    var ink = cssCol('--ink');
    WORDS.forEach(function (wd) {
      var r = geom.regions[wd.key];
      if (!r) return;
      var col = cssCol(wd.color), on = hot === wd.key, i;
      // the cell
      lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lctx.beginPath();
      for (i = 0; i < r.top.length; i++) lctx[i ? 'lineTo' : 'moveTo'](r.top[i][0], r.top[i][1]);
      for (i = r.bot.length - 1; i >= 0; i--) lctx.lineTo(r.bot[i][0], r.bot[i][1]);
      lctx.closePath();
      lctx.fillStyle = on ? col : ink;
      lctx.fill();
      lctx.lineJoin = 'round';
      lctx.lineWidth = Math.max(2, geom.R * 0.028);
      lctx.strokeStyle = col;
      lctx.stroke();
      // the word, drawn as thin vertical slices each stretched to the cell's height there
      var spr = on ? wd.spriteInk : wd.sprite;
      if (!spr) return;
      var n = r.top.length - 1, inset = Math.max(1, Math.round(n * 0.03)), cnt = n - 2 * inset;
      var sw = spr.width / cnt, sh = spr.height, pad = 0.13;
      for (i = 0; i < cnt; i++) {
        var j = i + inset;
        var t0 = r.top[j], t1 = r.top[j + 1], b0 = r.bot[j], b1 = r.bot[j + 1];
        var T0 = t0[1] + (b0[1] - t0[1]) * pad, B0 = t0[1] + (b0[1] - t0[1]) * (1 - pad);
        var T1 = t1[1] + (b1[1] - t1[1]) * pad;
        var dx = t1[0] - t0[0];
        var sx = i * sw, sww = Math.min(sw + 1, spr.width - sx);
        lctx.setTransform(dpr * dx / sw, dpr * (T1 - T0) / sw, 0, dpr * (B0 - T0) / sh, dpr * t0[0], dpr * T0);
        lctx.drawImage(spr, sx, 0, sww, sh, 0, 0, sww, sh);
      }
    });
  }

  var setHot = function (v) { return function () { if (hot !== v) { hot = v; drawLettering(); } }; };
  Array.prototype.forEach.call(hits.querySelectorAll('a'), function (aEl) {   // pointer targets
    var key = aEl.getAttribute('data-key');
    aEl.addEventListener('pointerenter', setHot(key));
    aEl.addEventListener('pointerleave', setHot(null));
  });
  // keyboard and screen readers use the plain links in #pages; focusing one lights up and outlines its region
  Array.prototype.forEach.call(document.querySelectorAll('#pages a'), function (aEl) {
    var key = aEl.getAttribute('data-key');
    var hit = hits.querySelector('a[data-key="' + key + '"]');
    aEl.addEventListener('focus', function () { hit.classList.add('focus'); setHot(key)(); });
    aEl.addEventListener('blur', function () { hit.classList.remove('focus'); setHot(null)(); });
  });

  resize();
  var resizeQueued = false;
  window.addEventListener('resize', function () {      // at most one re-layout per frame while the window is dragged
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(function () { resizeQueued = false; resize(); });
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { buildSprites(); drawDecal(); resize(); });

  /* robot: fetch three.js once the poster has painted, then build, compile and start in separate
     tasks so no single one blocks input for long */
  var rafId = 0;
  function loop(t) { rafId = requestAnimationFrame(loop); frame(t); }
  function startRobot() {
    import('/lib/three.module.js').then(function (m) {
      THREE = m;
      setTimeout(function () {
        try {
          build();
        } catch (err) {
          ok = false;
          if (renderer && renderer.domElement.parentNode) stage.removeChild(renderer.domElement);
          fallback();
          return;
        }
        resize();
        var go = function () {
          if (reduce) { pose(0.25, -0.1, 1, 0); renderer.render(scene, camera); }
          else if (!rafId) rafId = requestAnimationFrame(loop);
        };
        // compile the shaders in the background (KHR_parallel_shader_compile) instead of inside the first frame
        if (renderer.compileAsync) renderer.compileAsync(scene, camera).then(go, go); else setTimeout(go, 0);
      }, 0);
    }, fallback);
  }
  var idle = window.requestIdleCallback || function (f) { return setTimeout(f, 1); };
  function whenLoaded(f) { if (document.readyState === 'complete') f(); else window.addEventListener('load', f, { once: true }); }
  // after load and after the first frame has actually been presented (two rAFs), on an idle slot
  whenLoaded(function () { requestAnimationFrame(function () { requestAnimationFrame(function () { idle(startRobot, { timeout: 300 }); }); }); });

  // stop drawing while the tab is hidden; pick up again when it comes back
  document.addEventListener('visibilitychange', function () {
    if (!ok || reduce) return;
    if (document.hidden) { cancelAnimationFrame(rafId); rafId = 0; }
    else if (!rafId) rafId = requestAnimationFrame(loop);
  });
})();
