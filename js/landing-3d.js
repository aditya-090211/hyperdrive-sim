// The landing page's 3D stage, loaded by js/landing.js (see there for when). The robot CAD stands on its plinth in
// the red Driver Area at the venue; the three .stage sections each hold a camera key (hero, robot close-up, the field
// from above) and scrolling moves the camera between them. Nothing is shown until the robot, the field and the venue
// are built and compiled; the first frame then matches the poster underneath and cross-fades over it.
// "Open the simulator" and "Start scouting" fly the camera to that page's opening shot, hand the last frame over
// (sessionStorage) and navigate, so the next page starts from the same picture.
import * as THREE from 'three';
import { loadRobotModel, buildRobotVisual } from './robot-model.js';
import { stacked } from './layout.js';
import { gpuTier, prCap, createGovernor, compileAll } from './governor.js';
import { buildArena, buildPlinth, daylight, cloneDivision, SUN_DIR, HERO, HERO_YAW, homeShot } from './arena.js';
import { COLORS, IN, TEAMS } from './config.js';

// the scouting app opens on a straight-down view of the ALPHA field
const SCOUT_SHOT = { pos: [0.01, 5.4, -0.6], tgt: [0, 0, 0.05], fov: 42, film: 0 };

export async function start({ reduce }) {
  const canvas = document.getElementById('stage');
  const mobile = window.matchMedia('(max-width: 767px)').matches || /Mobi|Android/i.test(navigator.userAgent);
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' }); } catch { return; }
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const tier = mobile ? 'low' : gpuTier(renderer);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.02, 90);
  const gov = createGovernor({ key: 'landing', start: tier === 'low' ? 0.8 : 1, onChange: () => resize() });
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setPixelRatio(prCap(tier) * gov.scale);
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
  };
  resize(); window.addEventListener('resize', resize);
  daylight(scene, renderer);

  // late-afternoon sun from over the main terraces, sky fill, and a low warm rim on the robot
  scene.add(new THREE.HemisphereLight(0xd3e2f5, 0x6d6152, 0.95));
  const sun = new THREE.DirectionalLight(0xffdcb4, 2.5);
  sun.position.copy(SUN_DIR).multiplyScalar(9); sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 });
  const shadowSize = tier === 'low' ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.01;
  scene.add(sun, sun.target);
  const rim = new THREE.SpotLight(0xffb27a, 3.5, 6, 0.6, 0.8, 1.6); rim.position.set(HERO.x - 1.1, 0.9, HERO.z + 1.4); rim.target.position.copy(HERO); scene.add(rim, rim.target);

  const plinth = buildPlinth(); plinth.position.copy(HERO); scene.add(plinth);
  const model = await loadRobotModel();
  const hero = buildRobotVisual(model, { squadCol: COLORS.red, number: '009' });
  scene.add(hero.root);

  // ----- camera keys, one per stage section; narrow screens pull back and raise the subject
  const START = (t) => ({ x: (t.startX - 72) * IN, z: t.squad === 'red' ? (6 - 72) * IN : (138 - 72) * IN, yaw: t.squad === 'red' ? -Math.PI / 2 : Math.PI / 2 });
  const s0 = START(TEAMS[0]);
  const KEYS = [
    { pos: [0.95, 0.44, HERO.z - 1.2], tgt: [0.04, 0.19, HERO.z + 0.18], fov: 30, film: -0.2, robot: 'plinth', yaw: null, arm: 'idle' },
    { pos: [1.3, 0.52, HERO.z - 0.62], tgt: [0.0, 0.12, HERO.z + 0.02], fov: 30, film: 0.3, robot: 'plinth', yaw: -2.0, arm: 0.85 },
    { pos: [3.0, 2.7, 3.5], tgt: [-0.2, -0.3, -0.2], fov: 38, film: -0.16, robot: 'field', yaw: s0.yaw, arm: 0 },
  ];
  const secs = [...document.querySelectorAll('[data-key]')];
  let centres = [];
  const measure = () => { centres = secs.map((s) => { const r = s.getBoundingClientRect(); return r.top + window.scrollY + r.height / 2; }); };
  let target = 0, cur = 0;
  const readScroll = () => {
    const mid = window.scrollY + window.innerHeight / 2;
    let f = 0;
    for (let i = 0; i < centres.length; i++) {
      if (mid >= centres[i]) f = i;
      if (i + 1 < centres.length && mid >= centres[i] && mid < centres[i + 1]) f = i + (mid - centres[i]) / (centres[i + 1] - centres[i]);
    }
    target = Math.max(0, Math.min(KEYS.length - 1, f));
  };
  measure(); readScroll(); cur = target;
  window.addEventListener('scroll', readScroll, { passive: true });
  window.addEventListener('resize', () => { measure(); readScroll(); });
  new ResizeObserver(() => { measure(); readScroll(); }).observe(document.body);

  // ----- the field (both divisions), the venue and the other robots
  // the landing page only shows the field, so it skips the physics engine (2 MB) entirely
  const { buildField, loadFieldModel } = await import('./field.js');
  const fieldModel = await loadFieldModel();
  // buildField merges every static mesh already in the scene, so lift the robot and plinth out while it runs
  scene.remove(hero.root, plinth);
  const before = new Set(scene.children);
  const F = buildField(scene, null, renderer, fieldModel);
  for (const s of ['red', 'blue']) F.stations[s].sync?.();
  const bravo = cloneDivision(scene, scene.children.filter((o) => !before.has(o)));
  scene.add(hero.root, plinth);
  const robotAt = (t, num, parent) => {
    const v = buildRobotVisual(model, { squadCol: t.squad === 'red' ? COLORS.red : COLORS.blue, number: num });
    const p = START(t); v.root.position.set(p.x, 0, p.z); v.root.rotation.y = p.yaw; parent.add(v.root);
  };
  TEAMS.slice(1).forEach((t) => robotAt(t, t.number, scene));
  TEAMS.forEach((t, i) => robotAt(t, ['1201', '1730', '2049', '2210'][i], bravo));
  const arena = buildArena(scene, { crowd: tier === 'high' });
  arena.setScore(0, 0, '2:30', 'OVERDRIVE 009');

  // ----- leaving: fly to the next page's opening shot, hand over the frame, navigate
  const lookAt = new THREE.Vector3();
  let leave = null;
  const onScreen = new Set();   // stage sections on screen (see the end)
  let raf = 0;
  const leaveTo = (dest) => {
    if (leave) return;
    const sh = dest === 'sim' ? homeShot(window.innerWidth, window.innerHeight, 0, camera.filmGauge) : SCOUT_SHOT;
    leave = {
      dest, t: 0, start: performance.now(), D: reduce.matches ? 0.01 : 1.5, yaw0: hero.root.rotation.y, p0: hero.root.position.clone(),
      from: { pos: camera.position.clone(), tgt: lookAt.clone(), fov: camera.fov, film: camera.filmOffset },
      to: { pos: new THREE.Vector3(...sh.pos), tgt: new THREE.Vector3(...sh.tgt), fov: sh.fov, film: sh.film },   // homeShot's lens shift is already in mm
    };
    document.body.classList.add('leaving');
    wake();
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
  // the clock (idle spin, arm, camera sway) starts once the stage has replaced the poster, so the first frame matches it
  let t = 0, last = performance.now(), yawAuto = HERO_YAW, shown = false;
  let lastPose = '';
  renderer.shadowMap.autoUpdate = false;
  const keyPose = (k, out) => {
    out.pos.set(...k.pos); out.tgt.set(...k.tgt); out.fov = k.fov; out.film = k.film;
    if (stacked()) { v1.subVectors(out.pos, out.tgt).multiplyScalar(1.55); out.pos.copy(out.tgt).add(v1); out.tgt.y -= v1.length() * 0.13; out.fov = k.fov + 8; out.film = 0; }
    return out;
  };
  const A = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() }, B = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
  const filmMM = (film, fov) => film * camera.filmGauge * 2 * Math.tan(fov * Math.PI / 360) * Math.min(camera.aspect, 2.2);

  // each stage section's copy drifts up and dims as the camera leaves it, so two blocks are never on screen at full strength
  const copies = secs.map((s) => s.querySelector('.copy'));
  let drifting = false;
  const driftCopy = () => {
    const on = !stacked() && !reduce.matches && !leave;
    if (!on) { if (drifting) { for (const c of copies) { c.style.opacity = ''; c.style.transform = ''; } drifting = false; } return; }
    drifting = true;
    for (let k = 0; k < copies.length; k++) {
      const d = cur - k, o = Math.max(0, 1 - Math.max(0, Math.abs(d) - 0.12) * 3);
      const op = o.toFixed(3), tr = `translate3d(0, ${(-d * 32).toFixed(1)}px, 0)`;
      if (copies[k].style.opacity !== op) copies[k].style.opacity = op;
      if (copies[k].style.transform !== tr) copies[k].style.transform = tr;
    }
  };
  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const live = shown && !reduce.matches;
    if (live) t += dt;
    cur = reduce.matches ? target : cur + (target - cur) * (1 - Math.exp(-dt * 4));
    const i = Math.min(KEYS.length - 2, Math.floor(cur)), f = ease(Math.max(0, Math.min(1, cur - i)));
    keyPose(KEYS[i], A); keyPose(KEYS[i + 1], B);
    tP.lerpVectors(A.pos, B.pos, f); lookAt.lerpVectors(A.tgt, B.tgt, f);
    let fov = lerp(A.fov, B.fov, f), filmOut = filmMM(lerp(A.film, B.film, f), fov);
    if (!leave) { tP.x += Math.sin(t * 0.17) * 0.03; tP.y += Math.sin(t * 0.23) * 0.018; }

    if (live) yawAuto += dt * 0.18;
    const yawK = (k) => (k.yaw === null ? yawAuto : k.yaw);
    const ka = KEYS[i], kb = KEYS[i + 1];
    const pa = ka.robot === 'plinth' ? plinthTop : fieldSpot, pb = kb.robot === 'plinth' ? plinthTop : fieldSpot;
    hero.root.position.lerpVectors(pa, pb, f);
    if (pa !== pb) hero.root.position.y += Math.sin(Math.PI * f) * 0.5;
    const ya = yawK(ka); let yb = yawK(kb); yb = ya + Math.atan2(Math.sin(yb - ya), Math.cos(yb - ya));
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
    if (pose !== lastPose) { renderer.shadowMap.needsUpdate = true; lastPose = pose; }
    if (live) { plinth.userData.ticks.rotation.y += dt * 0.06; arena.update(dt); }
    // a straight-down view would look through the canopy: hide it on the way to Scout
    arena.setBeams(leave?.dest !== 'scout');

    renderer.render(scene, camera);
    if (!shown) {
      shown = true;
      // this frame is the poster's picture: fade the canvas in over it once it is on screen
      requestAnimationFrame(() => document.body.classList.add('stage-on'));
    }
    if (leave && leave.t >= leave.D && !leave.gone) { leave.gone = true; handOff(leave.dest); }
    gov.frame(dt);
    wake();
  }
  function wake() {
    if (raf || document.hidden || (!onScreen.size && !leave)) return;
    raf = requestAnimationFrame(frame);
  }
  // compile every shader off the main thread before the first frame, instead of stalling the page
  await compileAll(renderer, scene, camera);
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); document.body.classList.remove('stage-on'); });
  // render only while a stage section is on screen (the solid pages cover the canvas) and the tab is visible
  const vis = new IntersectionObserver((es) => { for (const e of es) (e.isIntersecting ? onScreen.add(e.target) : onScreen.delete(e.target)); wake(); });
  secs.forEach((s) => vis.observe(s));
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else wake(); });
}
