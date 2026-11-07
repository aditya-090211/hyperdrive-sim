// Overdrive 009 landing page. The robot CAD stands on its plinth in the red Driver Area at the IIT Bombay Open Air
// Theatre; scrolling moves the camera through the venue. "Open the simulator" and "Start scouting" fly the camera to
// the exact opening shot of that page, hand the last frame over (sessionStorage) and navigate, so the next page
// starts from the same picture. The robot loads first; the field, physics engine and venue stream in behind it,
// which also warms the browser cache for the simulator.
import * as THREE from 'three';
import { loadRobotModel, buildRobotVisual } from './robot-model.js';
import { stacked } from './layout.js';
import { gpuTier, prCap, createGovernor, compileAll } from './governor.js';
import { buildArena, buildPlinth, daylight, cloneDivision, SUN_DIR, HERO, HERO_YAW, homeShot } from './arena.js';
import { COLORS, IN, TEAMS } from './config.js';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
const canvas = document.getElementById('stage');
const loaderBar = document.getElementById('loader-bar');
const setLoad = (p) => { if (loaderBar) loaderBar.style.width = `${p}%`; if (p >= 100) document.getElementById('loader')?.classList.add('done'); };

const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 }) : null;
document.querySelectorAll('.reveal').forEach((el) => (io ? io.observe(el) : el.classList.add('in')));


// the scouting app opens on a straight-down view of the ALPHA field
const SCOUT_SHOT = { pos: [0.01, 5.4, -0.6], tgt: [0, 0, 0.05], fov: 42, film: 0 };

async function main() {
  // let the page paint its copy (and the poster) before creating the GPU context, which blocks the main thread
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const mobile = window.matchMedia('(max-width: 767px)').matches || /Mobi|Android/i.test(navigator.userAgent);
  // no separate "is WebGL available" probe: a throwaway context costs as much as the real one (over a second on some laptops)
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); } catch { document.body.classList.add('no-3d'); setLoad(100); return; }
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const tier = mobile ? 'low' : gpuTier(renderer);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.02, 90);
  // the venue is a backdrop behind sharp text: on integrated GPUs it renders at 80% so scrolling holds 60 fps
  const gov = createGovernor({ key: 'landing', start: tier === 'low' ? 0.8 : 1, onChange: () => resize() });
  const resize = () => {
    renderer.setPixelRatio(prCap(tier) * gov.scale);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / Math.max(1, window.innerHeight); camera.updateProjectionMatrix();
  };
  resize(); window.addEventListener('resize', resize);
  daylight(scene, renderer);

  // late-afternoon sun from over the main terraces, sky fill, and a low warm rim on the robot
  scene.add(new THREE.HemisphereLight(0xd3e2f5, 0x6d6152, 0.95));
  const sun = new THREE.DirectionalLight(0xffdcb4, 2.5);
  sun.position.copy(SUN_DIR).multiplyScalar(9); sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 });
  sun.shadow.mapSize.set(tier === 'low' ? 1024 : 2048, tier === 'low' ? 1024 : 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.01;
  scene.add(sun, sun.target);
  const rim = new THREE.SpotLight(0xffb27a, 3.5, 6, 0.6, 0.8, 1.6); rim.position.set(HERO.x - 1.1, 0.9, HERO.z + 1.4); rim.target.position.copy(HERO); scene.add(rim, rim.target);

  const plinth = buildPlinth(); plinth.position.copy(HERO); scene.add(plinth);
  setLoad(15);
  const model = await loadRobotModel();
  setLoad(40);
  const hero = buildRobotVisual(model, { squadCol: COLORS.red, number: '009' });
  scene.add(hero.root);

  // ----- camera keys, one per section; narrow screens pull back and raise the subject
  const START = (t) => ({ x: (t.startX - 72) * IN, z: t.squad === 'red' ? (6 - 72) * IN : (138 - 72) * IN, yaw: t.squad === 'red' ? -Math.PI / 2 : Math.PI / 2 });
  const s0 = START(TEAMS[0]);
  const KEYS = [
    { pos: [0.95, 0.44, HERO.z - 1.2], tgt: [0.04, 0.19, HERO.z + 0.18], fov: 30, film: -0.2, robot: 'plinth', yaw: null, arm: 'idle' },
    { pos: [0.98, 0.4, HERO.z - 0.62], tgt: [0.0, 0.19, HERO.z + 0.02], fov: 30, film: -0.2, robot: 'plinth', yaw: 0.95, arm: 0.85 },
    { pos: [3.0, 2.7, 3.5], tgt: [-0.2, -0.3, -0.2], fov: 38, film: 0.2, robot: 'field', yaw: s0.yaw, arm: 0 },
    { ...SCOUT_SHOT, film: -0.18, robot: 'field', yaw: s0.yaw, arm: 0 },
    { pos: [-8.5, 3.6, -6.0], tgt: [4.8, 0.4, 1.5], fov: 44, film: 0, robot: 'field', yaw: s0.yaw, arm: 0.2 },
  ];
  const secs = [...document.querySelectorAll('[data-sec]')];
  let target = 0, cur = 0;
  const readScroll = () => {
    const mid = window.scrollY + window.innerHeight / 2;
    let f = 0;
    for (let i = 0; i < secs.length; i++) {
      const c = secs[i].offsetTop + secs[i].offsetHeight / 2;
      if (mid >= c) f = i;
      if (i + 1 < secs.length) { const n = secs[i + 1].offsetTop + secs[i + 1].offsetHeight / 2; if (mid >= c && mid < n) f = i + (mid - c) / (n - c); }
    }
    target = Math.max(0, Math.min(secs.length - 1, f));
    const near = Math.round(target);
    document.body.classList.toggle('at-right', !!secs[near]?.classList.contains('right'));
    document.body.classList.toggle('at-center', !!secs[near]?.classList.contains('center'));
    document.body.classList.toggle('past-hero', target > 0.6);
  };
  window.addEventListener('scroll', readScroll, { passive: true }); window.addEventListener('resize', readScroll); readScroll();
  cur = target;

  // ----- the field (both divisions), the venue and the other robots stream in after the hero is on screen
  let arena = null, fieldReady = false;
  (async () => {
    try {
      // the landing page only shows the field, so it skips the physics engine (2 MB) entirely
      const { buildField, loadFieldModel } = await import('./field.js');
      setLoad(55);
      const fieldModel = await loadFieldModel();
      setLoad(80);
      // buildField merges every static mesh already in the scene, so lift the robot and plinth out while it runs
      scene.remove(hero.root, plinth);
      const before = new Set(scene.children);
      let added = [];
      try {
        const F = buildField(scene, null, renderer, fieldModel);
        for (const s of ['red', 'blue']) F.stations[s].sync?.();
        added = scene.children.filter((o) => !before.has(o));
      } finally { scene.add(hero.root, plinth); }
      const bravo = cloneDivision(scene, added);
      const robotAt = (t, num, parent) => {
        const v = buildRobotVisual(model, { squadCol: t.squad === 'red' ? COLORS.red : COLORS.blue, number: num });
        const p = START(t); v.root.position.set(p.x, 0, p.z); v.root.rotation.y = p.yaw; parent.add(v.root);
      };
      TEAMS.slice(1).forEach((t) => robotAt(t, t.number, scene));
      TEAMS.forEach((t, i) => robotAt(t, ['1201', '1730', '2049', '2210'][i], bravo));
      arena = buildArena(scene, { crowd: !mobile });
      arena.setScore(0, 0, '2:30', 'OVERDRIVE 009');
      // compile the venue's shaders off the main thread while the last frame stays up, instead of stalling the page
      paused = true; gov.hold(4);
      await compileAll(renderer, scene, camera);
      paused = false;
      fieldReady = true; venueChanged = true;
    } catch (e) { console.warn('venue', e); }
    setLoad(100);
    // the live venue is drawn: the still poster over it can fade away (next frame, so this frame is on screen)
    requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('venue-ready')));
  })();

  // ----- leaving: fly to the next page's opening shot, hand over the frame, navigate
  const lookAt = new THREE.Vector3();
  let leave = null;
  const leaveTo = (dest) => {
    if (leave) return;
    const sh = dest === 'sim' ? homeShot(window.innerWidth, window.innerHeight, 0, camera.filmGauge) : SCOUT_SHOT;
    leave = {
      dest, t: 0, start: performance.now(), D: reduce.matches ? 0.01 : 1.5, yaw0: hero.root.rotation.y, p0: hero.root.position.clone(),
      from: { pos: camera.position.clone(), tgt: lookAt.clone(), fov: camera.fov, film: camera.filmOffset },
      to: { pos: new THREE.Vector3(...sh.pos), tgt: new THREE.Vector3(...sh.tgt), fov: sh.fov, film: sh.film },   // homeShot's lens shift is already in mm
    };
    document.body.classList.add('leaving');
    // the move is timed by the clock; if frames stall (background tab) still go after it should have finished
    setTimeout(() => { if (leave && !leave.gone) { leave.t = leave.D; leave.gone = true; renderer.render(scene, camera); handOff(leave.dest); } }, leave.D * 1000 + 600);
  };
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-go]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault(); leaveTo(a.dataset.go === 'scout' ? 'scout' : 'sim');
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) { leave = null; document.body.classList.remove('leaving'); } });
  const handOff = (dest) => {
    try {
      const w = Math.min(1600, canvas.width), c = document.createElement('canvas');
      c.width = w; c.height = Math.round(canvas.height * w / canvas.width);
      c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
      sessionStorage.setItem('od.handoff', JSON.stringify({ dest, at: Date.now(), img: c.toDataURL('image/jpeg', 0.82) }));
    } catch { /* too big or storage blocked: the next page just loads normally */ }
    location.href = `/${dest}`;
  };

  // ----- frame loop
  const ease = (x) => x * x * (3 - 2 * x);
  const easeIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const lerp = (a, b, k) => a + (b - a) * k;
  const v1 = new THREE.Vector3(), tP = new THREE.Vector3();
  const plinthTop = new THREE.Vector3(HERO.x, HERO.y + 0.05, HERO.z), fieldSpot = new THREE.Vector3(s0.x, 0, s0.z);
  let t = 0, last = performance.now(), yawAuto = HERO_YAW, paused = false;
  let lastPose = '', venueChanged = true;
  renderer.shadowMap.autoUpdate = false;
  const narrow = stacked;
  const keyPose = (k, out) => {
    out.pos.set(...k.pos); out.tgt.set(...k.tgt); out.fov = k.fov; out.film = k.film;
    if (narrow()) { v1.subVectors(out.pos, out.tgt).multiplyScalar(1.55); out.pos.copy(out.tgt).add(v1); out.tgt.y -= v1.length() * 0.13; out.fov = k.fov + 8; out.film = 0; }
    return out;
  };
  const A = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() }, B = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
  const filmMM = (film, fov) => film * camera.filmGauge * 2 * Math.tan(fov * Math.PI / 360) * Math.min(camera.aspect, 2.2);
  // a 12 × 12 grid of slim columns, coloured from warm grey to the accent by how often the cell was scored from
  const HN = 12, HC = 0.3, HCOUNT = HN * HN;
  const heat = new THREE.InstancedMesh(new THREE.BoxGeometry(HC * 0.78, 1, HC * 0.78).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, roughness: 0.45, metalness: 0.1 }), HCOUNT);
  const heatH = [], heatXZ = [], cLo = new THREE.Color(0x8a8378), cHi = new THREE.Color(0xe2531b), hc = new THREE.Color();
  for (let i = 0; i < HCOUNT; i++) {
    const x = ((i % HN) - (HN - 1) / 2) * HC, z = (((i / HN) | 0) - (HN - 1) / 2) * HC;
    const h = 0.4 * Math.exp(-((x * x + z * z) / 1.1)) + 0.28 * Math.exp(-(((x + 1.2) ** 2 + (z + 1.2) ** 2) / 0.3)) + 0.28 * Math.exp(-(((x - 1.2) ** 2 + (z - 1.2) ** 2) / 0.3));
    heatXZ.push([x, z]); heatH.push(0.015 + h);
    heat.setColorAt(i, hc.copy(cLo).lerp(cHi, Math.min(1, h / 0.38)));
  }
  heat.visible = false; scene.add(heat);
  const hm = new THREE.Matrix4();

  // each section's copy drifts up and dims as the camera leaves it, so two blocks are never on screen at full strength
  const copies = secs.map((sct) => sct.querySelector('.copy'));
  let drifting = false;
  const driftCopy = () => {
    const on = !narrow() && !reduce.matches && !leave;
    if (!on) { if (drifting) { for (const c of copies) { c.style.opacity = ''; c.style.transform = ''; } drifting = false; } return; }
    drifting = true;
    for (let k = 0; k < copies.length; k++) {
      const d = cur - k, o = Math.max(0, 1 - Math.max(0, Math.abs(d) - 0.1) * 3.2);
      const op = o.toFixed(3), tr = `translate3d(0, ${(-d * 32).toFixed(1)}px, 0)`;
      if (copies[k].style.opacity !== op) copies[k].style.opacity = op;
      if (copies[k].style.transform !== tr) copies[k].style.transform = tr;
    }
  };
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    cur = reduce.matches ? target : cur + (target - cur) * (1 - Math.exp(-dt * 4));
    // without the field there is nowhere to drive to: the robot stays on its plinth
    const keys = fieldReady ? KEYS : KEYS.map((k) => ({ ...k, robot: 'plinth' }));
    const i = Math.min(keys.length - 2, Math.floor(cur)), f = ease(Math.max(0, Math.min(1, cur - i)));
    keyPose(keys[i], A); keyPose(keys[i + 1], B);
    tP.lerpVectors(A.pos, B.pos, f); lookAt.lerpVectors(A.tgt, B.tgt, f);
    let fov = lerp(A.fov, B.fov, f), filmOut = filmMM(lerp(A.film, B.film, f), fov);
    if (!reduce.matches && !leave) { tP.x += Math.sin(t * 0.17) * 0.03; tP.y += Math.sin(t * 0.23) * 0.018; }

    if (!reduce.matches) yawAuto += dt * 0.18;
    const yawK = (k) => (k.yaw === null ? yawAuto : k.yaw);
    const ka = keys[i], kb = keys[i + 1];
    const pa = ka.robot === 'plinth' ? plinthTop : fieldSpot, pb = kb.robot === 'plinth' ? plinthTop : fieldSpot;
    hero.root.position.lerpVectors(pa, pb, f);
    if (pa !== pb) hero.root.position.y += Math.sin(Math.PI * f) * 0.5;
    let ya = yawK(ka), yb = yawK(kb); yb = ya + Math.atan2(Math.sin(yb - ya), Math.cos(yb - ya));
    hero.root.rotation.y = lerp(ya, yb, f);
    const armK = (k) => (k.arm === 'idle' ? (0.5 - 0.5 * Math.cos(t * Math.PI * 2 / 9)) * 0.7 : k.arm);
    let arm = lerp(armK(ka), armK(kb), f);

    if (leave) {
      // fly to the destination's opening shot; for the simulator the robot also settles back on its plinth
      leave.t = (now - leave.start) / 1000;
      const k = easeIO(Math.min(1, leave.t / leave.D));
      tP.lerpVectors(leave.from.pos, leave.to.pos, k); lookAt.lerpVectors(leave.from.tgt, leave.to.tgt, k);
      fov = lerp(leave.from.fov, leave.to.fov, k); filmOut = lerp(leave.from.film, leave.to.film, k);
      if (leave.dest === 'sim') {
        const back = leave.p0.distanceTo(plinthTop) > 0.1;
        hero.root.position.lerpVectors(leave.p0, plinthTop, k); if (back) hero.root.position.y += Math.sin(Math.PI * k) * 0.4;
        const goal = HERO_YAW + Math.round((leave.yaw0 - HERO_YAW) / (Math.PI * 2)) * Math.PI * 2;
        hero.root.rotation.y = lerp(leave.yaw0, goal, k);
        arm *= 1 - k;
      }
    }
    driftCopy();
    camera.position.copy(tP); camera.lookAt(lookAt);
    camera.fov = fov; camera.filmOffset = filmOut; camera.updateProjectionMatrix();
    hero.pose(arm, -0.17 + Math.max(0, arm) * 0.5, 0);
    // the venue is static: redraw the shadow map only when the hero robot (the one thing that moves) has moved
    const pose = `${hero.root.position.x.toFixed(4)},${hero.root.position.y.toFixed(4)},${hero.root.position.z.toFixed(4)},${hero.root.rotation.y.toFixed(3)},${arm.toFixed(3)}`;
    if (pose !== lastPose || venueChanged) { renderer.shadowMap.needsUpdate = true; lastPose = pose; venueChanged = false; }
    plinth.userData.ticks.rotation.y += dt * 0.06;

    // section 3: the scouting heat map rises out of the field
    const heatK = leave?.dest === 'scout' ? 0 : Math.max(0, 1 - Math.abs(cur - 3) * 1.4);
    heat.visible = fieldReady && heatK > 0.01;
    if (heat.visible) {
      for (let j = 0; j < HCOUNT; j++) { hm.makeScale(1, Math.max(0.001, heatH[j] * heatK), 1).setPosition(heatXZ[j][0], 0.01, heatXZ[j][1]); heat.setMatrixAt(j, hm); }
      heat.instanceMatrix.needsUpdate = true; heat.material.opacity = 0.72 * Math.min(1, heatK * 1.5);
    }
    if (arena) { arena.update(dt); arena.setBeams(!(cur > 2.6 && cur < 3.4) && leave?.dest !== 'scout'); }

    if (!paused) renderer.render(scene, camera);
    if (leave && leave.t >= leave.D && !leave.gone) { leave.gone = true; handOff(leave.dest); }
    gov.frame(dt);
    requestAnimationFrame(frame);
  }
  await compileAll(renderer, scene, camera);
  requestAnimationFrame(frame);
  window.__landing = { scene, camera, hero, renderer, leaveTo, KEYS };   // handy for debugging in the console
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); document.body.classList.add('no-3d'); });
}

main().catch((e) => { console.error(e); document.body.classList.add('no-3d'); setLoad(100); });
