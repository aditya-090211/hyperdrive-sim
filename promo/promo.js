// Deterministic promo-reel director: renders the real simulator frame by frame (30 fps, 1080x1920).
import * as THREE from 'three';
import { createWorld, qrot } from '../js/physics.js';
import { buildField, loadFieldModel } from '../js/field.js';
import { loadRobotModel, Robot } from '../js/robot.js';
import { Game } from '../js/game.js';
import { TEAMS, ROBOT, wx, wz, IN } from '../js/config.js';

// seeded randomness so every render is identical
let seed = 20261010;
Math.random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

const W = 1080, H = 1920, FPS = 30, STEP = 1 / 240;
const DEG = Math.PI / 180;
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 3));
const easeIO = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// ---------------------------------------------------------------- overlay animation helpers
function show(id, t, t0, t1, { dIn = 0.35, dOut = 0.3, from = 'up', dist = 60 } = {}) {
  const el = $(id);
  const a = ease((t - t0) / dIn), b = ease((t1 - t) / dOut);
  const k = Math.min(a, b);
  el.style.opacity = t < t0 || t > t1 ? 0 : k;
  const off = (1 - k) * dist;
  const tr = el.dataset.base || '';
  if (from === 'up') el.style.transform = `${tr} translateY(${off}px)`;
  else if (from === 'left') el.style.transform = `${tr} translateX(${-off}px)`;
  else if (from === 'scale') el.style.transform = `${tr} scale(${1 + (1 - k) * 0.35})`;
  else if (from === 'slam') { const s = t - t0 < dIn ? 1 + (1 - a) * 0.9 : 1; el.style.transform = `${tr} scale(${s})`; el.style.filter = `blur(${(1 - a) * 14}px)`; }
  return k;
}
function bar(id, t, t0, t1) {
  const el = $(id);
  el.style.opacity = t < t0 || t > t1 ? 0 : Math.min(1, (t1 - t) / 0.25);
  el.style.transform = `scaleX(${ease((t - t0) / 0.45)})`;
}

// ---------------------------------------------------------------- boot
const events = [];
let sim, game, camera, renderer, scene;

async function boot() {
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  $('view').appendChild(renderer.domElement);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e13);
  scene.fog = new THREE.Fog(0x0b0e13, 8, 20);
  camera = new THREE.PerspectiveCamera(50, W / H, 0.02, 60);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x30302a, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 2.1);
  sun.position.set(2.5, 6, 1.8); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -2.6, right: 2.6, top: 2.6, bottom: -2.6, near: 1, far: 14 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.01;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xc8d4ff, 0.55); fill.position.set(-3, 4, -2.5); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffd9a0, 0.6); rim.position.set(0, 2.5, -5); scene.add(rim);

  const { world, events: ev } = await createWorld();
  sim = {
    world, events: ev, scene, renderer, camera, simTime: 0, showLabels: false, showGuides: false,
    audio: { beep() {}, buzzer() {} }, hud: { toast() {} },
    owners: new Map(),
    registerCollider(c, info) { this.owners.set(c.handle, info); },
    registerBody(body, colliders, info) { for (const c of colliders) this.owners.set(c.handle, info); },
    unregisterBody(body) {
      const n = body.numColliders();
      for (let i = 0; i < n; i++) { const h = body.collider(i).handle; this.owners.delete(h); for (const r of this.robots || []) { r.contacts.delete(h); r.pairContacts.delete(h); } }
    },
  };
  sim.field = buildField(scene, world, renderer, await loadFieldModel('../assets/'));
  sim.registerCollider(sim.field.floorCollider, { type: 'floor' });
  for (const s of ['red', 'blue']) for (const c of sim.field.stations[s].colliders) sim.registerCollider(c, { type: 'station', station: sim.field.stations[s] });
  const model = await loadRobotModel('../assets/');
  sim.robots = TEAMS.map((t) => new Robot(sim, t, model));
  game = sim.game = new Game(sim);
  sim.stationBodies = ['red', 'blue'].flatMap((s) => [sim.field.stations[s].deckBody, ...sim.field.stations[s].ramps.map((r) => r.body)]);
  await document.fonts.ready;
  window.__promo = { sim, game, state, camera };
  window.promoReady = true;
}

function physics(dt) {
  const n = Math.round(dt / STEP);
  for (let i = 0; i < n; i++) {
    for (const b of sim.stationBodies) { b.resetForces(false); b.resetTorques(false); }
    for (const r of sim.robots) r.step(STEP);
    sim.world.step(sim.events);
    sim.events.drainCollisionEvents((h1, h2, started) => {
      for (const [a, b] of [[h1, h2], [h2, h1]]) {
        const info = sim.owners.get(a); if (!info || info.type !== 'robot') continue;
        const r = info.robot; let set = r.pairContacts.get(b);
        if (started) { if (!set) { set = new Set(); r.pairContacts.set(b, set); } set.add(a); } else if (set) { set.delete(a); if (!set.size) r.pairContacts.delete(b); }
        const k = r.pairContacts.get(b)?.size || 0; if (k) r.contacts.set(b, k); else r.contacts.delete(b);
      }
    });
    sim.simTime += STEP;
  }
  game.update(dt);
  for (const r of sim.robots) { r.sync(); r.label.visible = false; }
  for (const c of game.cores) c.sync();
  for (const p of game.payloads) p.sync();
  for (const s of ['red', 'blue']) sim.field.stations[s].sync();
}

// ---------------------------------------------------------------- choreography helpers
const R = () => sim.robots;
function park(r, x, z, yaw) { r.teleport(x, z, yaw); r.cmd = { throttle: 0, turn: 0, arm: 0 }; }
function setArm(r, deg) { r.theta = r.thetaTarget = deg * DEG; r.updateMechColliders(); }
function openGrip(r) { r.releaseCore(false); r.gripClosed = false; r.finger = r.fingerTarget = ROBOT.fingerOpen; }
function freshField() {
  game.mode = 'match'; game.reset();
  sim.robots.forEach((r) => { r.contacts = new Map(); r.pairContacts = new Map(); });
  game.start();
}
// drive so that the hold point reaches a target (x, z) along the robot's heading; returns remaining distance
function approach(r, tx, tz, maxThrottle = 0.22) {
  const h = r.toWorld(r.holdLocal());
  const fwd = qrot(r.body.rotation(), { x: 1, y: 0, z: 0 });
  const along = (tx - h.x) * fwd.x + (tz - h.z) * fwd.z;
  const lat = -(tx - h.x) * fwd.z + (tz - h.z) * fwd.x;
  const v = r.body.linvel(); const vf = v.x * fwd.x + v.z * fwd.z;
  let th = clamp(along * 3.2 - vf * 0.9, -maxThrottle, maxThrottle);
  if (Math.abs(along) > 0.003 && Math.abs(th) < 0.075) th = Math.sign(along) * 0.075; // stay above the gearbox-hold deadband
  if (Math.abs(along) <= 0.003) th = 0;
  r.cmd.throttle = th;
  r.cmd.turn = clamp(lat * 6, -0.25, 0.25);
  return along;
}
function project(p) {
  const v = new THREE.Vector3(p.x, p.y, p.z).project(camera);
  return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, behind: v.z > 1 };
}

// ---------------------------------------------------------------- scenes (seconds)
const SC = { A: [0, 3], B: [3, 6.5], C: [6.5, 10], D: [10, 13.5], E: [13.5, 16.5], F: [16.5, 20] };
const state = {};
const POLE_C = { x: 0, z: wz(48) };       // red high pole at the centre of the red line
const STN = () => sim.field.stations.red;

function enter(name) {
  const [r1, r2, b1, b2] = R();
  if (name === 'A') {
    freshField();
  }
  if (name === 'B') {
    freshField();
    // Red 1 lines up behind the red spike-mark CORE at (48, 88)
    state.coreB = game.cores.find((c) => c.color === 'red' && Math.abs(c.pos().x - wx(48)) < 0.01 && c.pos().z > 0);
    const cp = state.coreB.pos();
    setArm(r1, ROBOT.armMin); openGrip(r1);
    park(r1, cp.x, cp.z - r1.holdLocal().x - 0.15, -Math.PI / 2);
    park(r2, wx(84), wz(6), -Math.PI / 2); park(b1, wx(84), wz(138), Math.PI / 2); park(b2, wx(60), wz(138), Math.PI / 2);
    state.gripped = false;
  }
  if (name === 'C') {
    freshField();
    // two red COREs already stacked on the pole, Red 1 carries the third
    game.addCore('red', 'red', { x: POLE_C.x, y: 0.024, z: POLE_C.z });
    game.addCore('red', 'red', { x: POLE_C.x, y: 0.056, z: POLE_C.z });
    setArm(r1, 60);
    park(r1, POLE_C.x, POLE_C.z - r1.holdLocal().x - 0.13, -Math.PI / 2);
    const c = game.addCore('red', 'red', r1.toWorld(r1.holdLocal()));
    r1.finger = r1.fingerTarget = ROBOT.fingerOpen; r1.gripClosed = false;
    r1.attachCore(c); r1.gripClosed = true; r1.fingerTarget = r1.finger = ROBOT.fingerHold;
    state.coreC = c; state.released = false; state.scoredAt = null;
    park(r2, wx(84), wz(6), -Math.PI / 2); park(b1, wx(84), wz(138), Math.PI / 2); park(b2, wx(60), wz(138), Math.PI / 2);
  }
  if (name === 'D') {
    freshField();
    const P = (sq, type) => sim.field.poles.filter((p) => p.squad === sq && p.type === type);
    // a match in progress: some COREs already scored
    P('red', 'high').forEach((p, i) => { if (i < 2) game.addCore('red', 'red', { x: p.x, y: 0.024, z: p.z }); });
    game.addCore('red', 'red', { x: P('red', 'star')[0].x, y: 0.024, z: P('red', 'star')[0].z });
    P('blue', 'high').forEach((p, i) => { if (i < 2) game.addCore('blue', 'blue', { x: p.x, y: 0.024, z: p.z }); });
    park(r1, wx(60), wz(30), -Math.PI / 2 + 0.25); park(r2, wx(100), wz(26), -Math.PI / 2 - 0.35);
    park(b1, wx(80), wz(112), Math.PI / 2 + 0.3); park(b2, wx(40), wz(118), Math.PI / 2 - 0.2);
    sim.robots.forEach((r) => setArm(r, 30));
    for (let i = 0; i < 3; i++) game.placeCore('red');
    for (let i = 0; i < 3; i++) game.placeCore('blue');
  }
  if (name === 'E') {
    freshField();
    game.time = 121;  // LEVEL UP
    const st = STN();
    setArm(r1, 10);
    park(r1, st.cx, 0.9, Math.PI / 2);      // at the foot of the ramp, facing the station
    park(r2, wx(84), wz(6), -Math.PI / 2); park(b1, wx(84), wz(138), Math.PI / 2); park(b2, wx(60), wz(138), Math.PI / 2);
    state.docked = null;
  }
  if (name === 'F') {
    freshField();
    sim.robots.forEach((r) => setArm(r, 21.2));
  }
}

function direct(name, t, lt, dt) {
  const [r1, r2, b1, b2] = R();
  // ---------------- A: hook
  if (name === 'A') {
    const go = lt > 0.15 && lt < 1.75;
    r1.cmd = { throttle: go ? 0.6 : 0, turn: go ? 0.05 : 0, arm: lt > 0.4 && lt < 1.0 ? 1 : 0 };
    r2.cmd = { throttle: go ? 0.6 : 0, turn: go ? -0.08 : 0, arm: lt > 0.6 && lt < 1.1 ? 1 : 0 };
    // blue robots hold their side (avoids a head-on crash in the shared lanes)
    b1.cmd = { throttle: lt > 0.3 && lt < 1.0 ? 0.35 : 0, turn: lt > 0.3 && lt < 1.0 ? 0.45 : 0, arm: lt > 0.5 && lt < 1.0 ? 1 : 0 };
    b2.cmd = { throttle: lt > 0.3 && lt < 1.0 ? 0.35 : 0, turn: lt > 0.3 && lt < 1.0 ? -0.45 : 0, arm: lt > 0.5 && lt < 1.0 ? 1 : 0 };
    const k = easeIO(lt / 3);
    const pos = lerp3([0.0, 0.11, 0.25], [1.15, 1.45, 1.55], k);
    const tgt = lerp3([-0.25, 0.1, -1.35], [-0.1, 0.0, -0.75], k);
    return { pos, tgt, fov: lerp(46, 52, k) };
  }
  // ---------------- B: pickup
  if (name === 'B') {
    const cp = state.coreB.pos();
    if (!state.gripped) {
      const d = approach(r1, cp.x, cp.z, 0.16);
      if (lt > 0.9 && Math.abs(d) < 0.006 && r1.speed() < 0.03) {
        r1.cmd = { throttle: 0, turn: 0, arm: 0 };
        r1.toggleGrip();
        state.gripped = !!r1.heldCore;
        if (state.gripped) events.push({ t, type: 'grip' });
      }
    } else {
      r1.cmd = { throttle: 0, turn: 0, arm: lt > 1.9 ? 0.75 : 0 };
      if (lt > 2.6) r1.cmd.throttle = -0.12;
    }
    // front three-quarter view of the gripper, slowly orbiting
    const a = 0.75 - lt * 0.12;
    const p = r1.toWorld({ x: 0.2 + Math.cos(a) * 0.62, y: 0.27 + lt * 0.025, z: Math.sin(a) * 0.62 });
    const tg = r1.toWorld({ x: 0.18, y: 0.07 + Math.min(lt, 3) * 0.012, z: 0 });
    return { pos: [p.x, p.y, p.z], tgt: [tg.x, tg.y, tg.z], fov: 40 };
  }
  // ---------------- C: score on the pole
  if (name === 'C') {
    if (!state.released) {
      const d = approach(r1, POLE_C.x, POLE_C.z, 0.14);
      if (lt > 1.0 && Math.abs(d) < 0.004 && r1.speed() < 0.02) {
        r1.cmd = { throttle: 0, turn: 0, arm: 0 };
        r1.toggleGrip();
        state.released = true; state.releasedAt = t;
        events.push({ t, type: 'release' });
      }
    } else {
      r1.cmd = { throttle: t - state.releasedAt > 0.9 ? -0.15 : 0, turn: 0, arm: 0 };
      if (!state.scoredAt && state.coreC.scored === 'pole' && Math.abs(state.coreC.body.linvel().y) < 0.02) { state.scoredAt = t; events.push({ t, type: 'score' }); }
    }
    const k = easeIO(lt / 3.5);
    const pos = lerp3([0.62, 0.24, -0.2], [0.46, 0.3, -0.32], k);
    return { pos, tgt: [0.0, 0.07, -0.66], fov: 38 };
  }
  // ---------------- D: full field
  if (name === 'D') {
    r1.cmd = { throttle: 0.5, turn: 0.18, arm: 0 };
    r2.cmd = { throttle: 0.45, turn: -0.22, arm: 0 };
    b1.cmd = { throttle: 0.5, turn: -0.15, arm: 0 };
    b2.cmd = { throttle: 0.42, turn: 0.2, arm: 0 };
    const a = Math.PI * 0.5 + 0.35 - lt * 0.09;
    const pos = [Math.cos(a) * 3.0, 6.0 - lt * 0.12, Math.sin(a) * 3.0];
    return { pos, tgt: [0, -0.15, 0.05], fov: 50 };
  }
  // ---------------- E: space station
  if (name === 'E') {
    const st = STN();
    const z = r1.body.translation().z;
    r1.cmd = { throttle: lt > 0.3 && z > 0.07 ? 0.62 : 0, turn: 0, arm: 0 };
    if (!state.docked && r1.stationState === 'dock') { state.docked = t; events.push({ t, type: 'dock' }); }
    // track the robot up the ramp from the field side
    const k = easeIO(lt / 3);
    const rz = r1.body.translation().z;
    const pos = [st.cx + lerp(1.0, 0.85, k), lerp(0.3, 0.46, k), rz - 0.35];
    return { pos, tgt: [st.cx, 0.1, rz - 0.05], fov: 46 };
  }
  // ---------------- F: end card
  const a = 0.9 + lt * 0.1;
  return { pos: [Math.cos(a) * 4.2, 3.4, Math.sin(a) * 4.2], tgt: [0, -0.2, 0], fov: 50 };
}

function overlay(t) {
  // global shades
  $('shadeTop').style.opacity = t < SC.F[0] ? 1 : 0.35;
  $('shadeBot').style.opacity = 1;
  const tick = $('tick'); tick.style.opacity = t > 0.4 && t < SC.F[0] ? 0.9 : 0; tick.firstElementChild.style.width = `${(t / SC.F[0]) * 100}%`;
  // flash on cuts
  let fl = 0;
  for (const c of [SC.B[0], SC.C[0], SC.D[0], SC.E[0], SC.F[0]]) { const d = t - c; if (d >= 0 && d < 0.18) fl = Math.max(fl, (1 - d / 0.18) * 0.55); }
  const d0 = t - 0.62; if (d0 >= 0 && d0 < 0.22) fl = Math.max(fl, (1 - d0 / 0.22) * 0.7);
  $('flash').style.opacity = fl;
  // A
  show('a-eye', t, 0.2, 2.85, { from: 'up' });
  show('a-logo', t, 0.62, 2.85, { from: 'slam', dIn: 0.28 });
  show('a-sub', t, 1.15, 2.85, { from: 'up' });
  // B
  bar('b-bar', t, 3.15, 6.35); show('b-head', t, 3.2, 6.35, { from: 'left' }); show('b-cap', t, 3.55, 6.35, { from: 'up', dist: 30 });
  // C
  bar('c-bar', t, 6.65, 9.85); show('c-head', t, 6.7, 9.85, { from: 'left' }); show('c-cap', t, 7.05, 9.85, { from: 'up', dist: 30 });
  const pop = $('c-pop');
  if (state.scoredAt && t >= state.scoredAt && t < SC.C[1]) {
    const k = (t - state.scoredAt);
    const p = project({ x: POLE_C.x, y: 0.15, z: POLE_C.z });
    pop.style.opacity = clamp(Math.min(k / 0.12, (1.8 - k) / 0.4), 0, 1);
    pop.style.left = `${p.x - 75}px`; pop.style.top = `${Math.max(760, p.y - 190 - k * 60)}px`;
    pop.style.transform = `scale(${1 + Math.max(0, 0.6 - k * 3)})`;
  } else pop.style.opacity = 0;
  // D
  const sb = $('d-sb'); sb.dataset.base = 'translateX(-50%)';
  show('d-sb', t, 10.1, 13.35, { from: 'up', dist: 40 });
  show('d-head', t, 10.3, 13.35, { from: 'left' }); show('d-cap', t, 10.65, 13.35, { from: 'up', dist: 30 });
  if (t >= SC.D[0] && t < SC.D[1]) {
    $('d-rs').textContent = game.score.red.total; $('d-bs').textContent = game.score.blue.total;
    const s = Math.ceil(150 - 37 - (t - SC.D[0])); $('d-clk').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  // E
  bar('e-bar', t, 13.65, 16.35); show('e-head', t, 13.7, 16.35, { from: 'left' }); show('e-cap', t, 14.05, 16.35, { from: 'up', dist: 30 });
  const lvl = $('e-lvl'); lvl.style.left = '84px'; lvl.style.top = '1290px';
  show('e-lvl', t, 13.6, 15.0, { from: 'scale' });
  const dock = $('e-dock'); dock.style.left = '84px'; dock.style.top = '1290px';
  if (state.docked) show('e-dock', t, Math.max(state.docked, 15.05), 16.35, { from: 'scale' }); else dock.style.opacity = 0;
  // F
  $('endShade').style.opacity = clamp((t - 16.5) / 0.5, 0, 1);
  show('f-logo', t, 16.7, 20.5, { from: 'slam', dIn: 0.3 });
  show('f-sub', t, 17.1, 20.5, { from: 'up', dist: 40 });
  const url = $('f-url'); url.dataset.base = 'translateX(-50%)';
  show('f-url', t, 17.45, 20.5, { from: 'scale' });
  show('f-feat', t, 17.85, 20.5, { from: 'up', dist: 30 });
  show('f-bio', t, 18.3, 20.5, { from: 'up', dist: 20 });
}

// ---------------------------------------------------------------- frame API (called by the renderer)
let current = null;
window.renderFrame = (f) => {
  const t = f / FPS, dt = 1 / FPS;
  const name = Object.keys(SC).find((k) => t >= SC[k][0] && t < SC[k][1]) || 'F';
  if (name !== current) { current = name; enter(name); }
  const lt = t - SC[name][0];
  const cam = direct(name, t, lt, dt);
  // slow motion while the released ring falls onto the pole
  const slow = name === 'C' && state.released && t - state.releasedAt < 0.75;
  physics(slow ? dt * 0.25 : dt);
  camera.position.set(...cam.pos); camera.fov = cam.fov; camera.updateProjectionMatrix(); camera.lookAt(...cam.tgt);
  for (const s of ['red', 'blue']) sim.field.trifrons[s].group.rotation.y = t * 0.5;
  overlay(t);
  renderer.render(scene, camera);
  return { t, name };
};
window.promoEvents = events;
window.promoState = () => ({ scene: current, gripped: state.gripped, released: state.released, scoredAt: state.scoredAt, docked: state.docked, coreC: state.coreC && state.coreC.scored });
boot();
