// HYPERDRIVE "November update" reel: 30 s, 1080x1920, every change since the 21 Oct ad, cut to an 85 BPM grid
// ("Remember the Name", Fort Minor, added in Instagram from about 0:22.4 so beat 0 is the first chorus downbeat).
// Built on the cine.js pipeline (film grade, accumulated motion blur, the real simulator's physics shots) plus:
//   void shots: particle swarm -> new robot CAD, scan reveal, exploded view with callouts;
//   the official field CAD assembling from a wireframe wave;
//   the IIT Bombay Open Air Theatre venue (arena.js) at golden hour, also used to relight the physics shots;
//   the new website / Overdrive Scout as screen panes floating over the venue; an end card on the plinth.
import * as THREE from 'three';
import { buildArena, buildPlinth, daylight, cloneDivision, SUN_DIR, HERO, HERO_YAW } from '../js/arena.js';
import { loadRobotModel, buildRobotVisual } from '../js/robot-model.js';
import { COLORS, WALL } from '../js/config.js';

const BPM = 85, BEAT = 60 / BPM;
const FPS = 30, W = 1080, H = 1920, TOTAL = 900;          // 30.0 s
const bf = (b) => Math.round(b * BEAT * FPS);
const DEG = Math.PI / 180;
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sat = (v) => clamp(v, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => 1 - Math.pow(1 - sat(t), 3);
const easeIn = (t) => Math.pow(sat(t), 3);
const easeIO = (t) => { t = sat(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const B = (b) => b * BEAT;
const noise1 = (t, s = 0) => Math.sin(t * 1.7 + s) * 0.5 + Math.sin(t * 2.9 + s * 1.3) * 0.3 + Math.sin(t * 5.3 + s * 2.1) * 0.2;
let sd = 1206; const rnd = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
const OD = new THREE.Color(0xe2531b);

// ---------------------------------------------------------------- the cut list (b = start beat)
// sim shots: shot + t = in-point on cine.js's reel timeline, k = playback speed. mode: how the shot is lit.
const CUTS = [
  { b: 0, c: 'hook' },                                      // particles -> the NRL-2026 robot, scan reveal
  { b: 2, c: 'explode', hit: 1 },                           // exploded view + callouts, slams back on 6
  { b: 6, shot: 'grab', t: 7.17 - BEAT / 2, k: 1, hit: 1 }, // the geared claw closes on 6.5
  { b: 7, shot: 'lift', t: 7.84, k: 1 },
  { b: 8, c: 'field', hit: 1 },                             // the field CAD assembles out of a wireframe wave
  { b: 12, c: 'venue', hit: 2 },                            // golden hour: crane up over ALPHA and BRAVO
  { b: 16, shot: 'launch', t: 2.60, k: 1.2, hit: 1 },       // verse: the action
  { b: 17, shot: 'flyby', t: 6.4, k: 0.99 },
  { b: 18, shot: 'spin', t: 21.0, k: 1.2, hit: 1 },
  { b: 19, shot: 'drift', t: 23.5, k: 1.15 },
  { b: 20.12, shot: 'slowmo', t: 8.75, k: 1 },                    // the CORE lands on the pole about beat 21
  { b: 22, shot: 'station', t: 12.067 - BEAT, k: 1, hit: 1 },   // docks on 23
  { b: 25, shot: 'spin', t: 21.0, k: 1.2 },
  { b: 25.5, shot: 'flyby', t: 6.5, k: 1.2 },
  { b: 26, shot: 'wheel', t: 29.4, k: 1.6 },
  { b: 26.5, shot: 'arena', t: 13.6, k: 1.25, hit: 1 },
  { b: 28, c: 'web', hit: 1 },                              // the new site, Scout, sign-in
  { b: 36, c: 'end', hit: 2 },
  { b: TOTAL / FPS / BEAT },
];
const START_OF = Object.fromEntries(CUTS.filter((c) => c.c).map((c) => [c.c, c.b]));

let C, sim, game, scene, camera, renderer;
const P = {};                       // particles
const scan = { uCut: { value: 10 }, uBand: { value: 0.03 } };
const sweep = { uR: { value: 100 }, uBand: { value: 0.9 }, uLift: { value: 0.35 } };
let hero, plinth, heroParts = [];
const VEN = { objs: [], lights: [] };
const DARK = {};
let mode = null, hidden = null, keep = new Set();
const panes = {};
const upEvents = [];
let lastCam = null;

// ======================================================================= init
async function init() {
  while (!window.__cine || !window.cineReady) await new Promise((r) => setTimeout(r, 50));
  C = window.__cine; sim = C.sim; game = C.game; scene = C.scene; camera = C.camera; renderer = C.renderer;
  await Promise.all(['400 100px "Instrument Serif"', 'italic 400 100px "Instrument Serif"', '500 30px "Martian Mono"', '400 30px "Instrument Sans"', '500 30px "Instrument Sans"'].map((f) => document.fonts.load(f)));
  DARK.bg = scene.background; DARK.fog = scene.fog; DARK.env = scene.environment; DARK.envI = scene.environmentIntensity ?? 1;

  // ----- the venue: sky, haze, terraces, canopy, stage, the BRAVO field
  const before = new Set(scene.children);
  daylight(scene, renderer);
  VEN.bg = scene.background; VEN.fog = scene.fog; VEN.env = scene.environment; VEN.envI = 0.8;
  for (const s of ['red', 'blue']) sim.field.stations[s].sync();
  const arena = buildArena(scene, { crowd: true });
  arena.setScore?.(0, 0, '2:30', 'OVERDRIVE 009');
  const model = await loadRobotModel('../assets/');
  const bravo = cloneDivision(scene, sim.fieldObjects);
  [['1201', 0], ['1730', 1], ['2049', 2], ['2210', 3]].forEach(([num, i]) => {
    const r = sim.robots[i], p = r.startPose();
    const v = buildRobotVisual(model, { squadCol: r.squad === 'red' ? COLORS.red : COLORS.blue, number: num });
    v.root.position.set(p.x, 0, p.z); v.root.rotation.y = p.yaw; bravo.add(v.root);
  });
  // daylight: sky fill, low sun over the terraces, a warm rim for the hero
  const hemi = new THREE.HemisphereLight(0xd3e2f5, 0x6d6152, 0.95);
  const sun = new THREE.DirectionalLight(0xffdcb4, 2.6);
  sun.position.copy(SUN_DIR).multiplyScalar(9); sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -4.5, right: 4.5, top: 4.5, bottom: -4.5, near: 1, far: 22 });
  sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.01;
  const rim = new THREE.SpotLight(0xffb27a, 3.5, 6, 0.6, 0.8, 1.6); rim.position.set(HERO.x - 1.1, 0.9, HERO.z + 1.4); rim.target.position.copy(HERO);
  scene.add(hemi, sun, sun.target, rim, rim.target);
  VEN.lights = [hemi, sun, rim]; VEN.sun = sun; VEN.rim = rim;
  VEN.objs = scene.children.filter((o) => !before.has(o) && !o.isLight && o !== sun.target && o !== rim.target);
  VEN.arena = arena;
  scene.background = DARK.bg; scene.fog = DARK.fog; scene.environment = DARK.env;

  // ----- the hero: the NRL-2026 robot on the home-screen plinth (visual only)
  plinth = buildPlinth(); plinth.position.copy(HERO); scene.add(plinth);
  hero = buildRobotVisual(model, { squadCol: COLORS.red, number: '009' });
  hero.root.position.set(HERO.x, HERO.y + 0.05, HERO.z); hero.root.rotation.y = HERO_YAW;
  hero.pose(0, -0.17, 0, 0);
  scene.add(hero.root);
  heroLook(hero.root);

  buildParticles();
  scanShader(hero.root);
  buildExplode();
  buildFieldFx();
  await buildPanes();
  buildPresent();
  scene.add(camera);
  keep = new Set([hero.root, plinth, P.points, C.dust, camera, ...C.beams.map((l) => l.userData.beam)]);
  window.__cineLook = cineLook;
  window.__up = { VEN, P, sweep, scan, hero, plinth, panes };
  window.upReady = true;
}

// same material treatment cine.js gives the simulator's robots, for the plinth robot
function heroLook(root) {
  const done = new Set();
  root.traverse((o) => {
    if (!o.isMesh || done.has(o.material) || !o.material.isMeshStandardMaterial) return;
    const m = o.material; done.add(m);
    const c = m.color, lum = (c.r + c.g + c.b) / 3;
    const isHex = (hex) => { const t = new THREE.Color(hex); return Math.abs(c.r - t.r) + Math.abs(c.g - t.g) + Math.abs(c.b - t.b) < 0.01; };
    if (isHex(COLORS.red)) { c.setRGB(0.24, 0.012, 0.016); m.metalness = 0.45; m.roughness = 0.42; m.envMapIntensity = 0.7; }
    else if (m.transparent) { m.roughness = 0.08; m.metalness = 0; m.envMapIntensity = 1.6; m.opacity = 0.42; }
    else if (Math.abs(c.r - c.g) < 0.05 && Math.abs(c.g - c.b) < 0.06 && lum > 0.55) { m.metalness = 0.9; m.roughness = 0.34; m.envMapIntensity = 0.85; m.color.setRGB(0.8, 0.81, 0.84); }
    else if (lum < 0.16) { m.metalness = 0.55; m.roughness = 0.42; m.envMapIntensity = 0.9; }
    else if (Math.abs(c.r - c.g) < 0.06 && lum > 0.25) { m.metalness = 0.85; m.roughness = 0.4; m.envMapIntensity = 0.8; }
    else { m.metalness = 0.0; m.roughness = 0.62; m.envMapIntensity = 0.4; m.color.multiplyScalar(0.7); }
  });
}

// ======================================================================= modes: void (black studio), field (field only), venue
function setMode(m) {
  if (m === mode) return;
  if (hidden) { hidden.forEach((o) => { o.visible = true; }); hidden = null; }
  mode = m;
  const venue = m === 'venue';
  for (const o of VEN.objs) o.visible = venue;
  for (const l of VEN.lights) l.visible = venue || (m === 'field' && l !== VEN.rim);
  scene.background = venue ? VEN.bg : new THREE.Color(0x000000);
  scene.fog = venue ? VEN.fog : null;
  scene.environment = venue ? VEN.env : DARK.env;
  scene.environmentIntensity = venue ? VEN.envI : DARK.envI;
  camera.near = venue ? 0.02 : 0.01; camera.far = venue ? 160 : 40; camera.updateProjectionMatrix();
  if (m === 'void' || m === 'field') {
    hidden = [];
    const fieldSet = new Set(m === 'field' ? [...sim.fieldObjects, P.wire] : []);
    for (const o of scene.children) if (o.visible && !o.isLight && !keep.has(o) && !fieldSet.has(o) && !(o.parent === scene && o.type === 'Object3D')) { hidden.push(o); o.visible = false; }
  }
  P.wire.visible = m === 'field';
}
function heroVisible(on) { hero.root.visible = on; plinth.visible = on; }

// relight cine.js's own physics shots for the venue (called per motion-blur sample)
function cineLook(name, ts, cam) {
  if (mode !== 'venue') return cam;
  VEN.lights[0].intensity = 0.95; VEN.sun.intensity = 2.6;
  C.lightsOff(); C.leds(0); C.lights.amb.intensity = 0;
  C.bloom.strength = 0.18; C.bloom.threshold = 1.6; C.bloom.radius = 0.4;
  C.grade.uniforms.exposure.value = 0.98; C.grade.uniforms.streak.value = 0;
  VEN.rim.intensity = 0;
  return { ...cam, aperture: Math.min(cam.aperture, 0.012) };
}

// ======================================================================= particles (swarm into the robot)
const N = 64000;
function buildParticles() {
  const g = new THREE.BufferGeometry();
  const f32 = (k) => new Float32Array(N * k);
  P.from = f32(3); P.to = f32(3); P.cA = f32(3); P.cB = f32(3); P.r = f32(4);
  for (let i = 0; i < N; i++) { P.r[i * 4] = rnd(); P.r[i * 4 + 1] = rnd(); P.r[i * 4 + 2] = rnd(); P.r[i * 4 + 3] = 0.55 + rnd() * 0.9; }
  g.setAttribute('position', new THREE.BufferAttribute(P.to, 3));
  for (const [k, a] of [['aFrom', P.from], ['aTo', P.to], ['aCA', P.cA], ['aCB', P.cB]]) g.setAttribute(k, new THREE.BufferAttribute(a, 3));
  g.setAttribute('aR', new THREE.BufferAttribute(P.r, 4));
  const u = P.u = {
    uP: { value: 0 }, uSpread: { value: 0.4 }, uSwirl: { value: 0 }, uVortex: { value: 0 }, uCenter: { value: V(0, 0.1, 0) },
    uTime: { value: 0 }, uSize: { value: 0.003 }, uScale: { value: H * 0.5 }, uAlpha: { value: 1 }, uGain: { value: 0.8 }, uCut: { value: -10 }, uBurst: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: `attribute vec3 aFrom; attribute vec3 aTo; attribute vec3 aCA; attribute vec3 aCB; attribute vec4 aR;
      uniform float uP, uSpread, uSwirl, uVortex, uTime, uSize, uScale, uAlpha, uCut, uBurst; uniform vec3 uCenter;
      varying vec3 vC; varying float vA;
      float e3(float x){ x = clamp(x, 0., 1.); return x < .5 ? 4.*x*x*x : 1. - pow(-2.*x + 2., 3.) / 2.; }
      void main(){
        float q = e3((uP - aR.x * uSpread) / (1. - uSpread));
        vec3 p = mix(aFrom, aTo, q);
        float mid = sin(3.14159 * q);
        vec3 d = p - uCenter;
        float ang = uVortex * (1. - q) * (0.55 + aR.y);
        float cs = cos(ang), sn = sin(ang);
        d.xz = vec2(cs * d.x - sn * d.z, sn * d.x + cs * d.z);
        p = uCenter + d;
        float ph = aR.z * 6.2832;
        p += vec3(sin(uTime * 1.9 + ph * 3.1), cos(uTime * 1.6 + ph * 2.3), sin(uTime * 1.3 + ph * 1.7)) * uSwirl * (mid + 0.12) * (0.4 + aR.y);
        p += normalize(d + vec3(0.0001)) * uBurst * (0.3 + aR.y);
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uSize * aR.w * uScale / -mv.z, 1.0, 10.0);
        vC = mix(aCA, aCB, q);
        vA = uAlpha * (0.55 + 0.45 * aR.w) * smoothstep(uCut - 0.012, uCut + 0.004, p.y);
      }`,
    fragmentShader: `uniform float uGain; varying vec3 vC; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.08, d); gl_FragColor = vec4(vC * a * vA * uGain, 1.); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  P.points = new THREE.Points(g, mat);
  P.points.frustumCulled = false; P.points.renderOrder = 8; P.points.userData.volumetric = true; P.points.visible = false;
  scene.add(P.points);
  P.geo = g;
}
function surfaceSampler(roots) {
  const tris = []; let total = 0;
  const a = V(0, 0, 0), b = V(0, 0, 0), c = V(0, 0, 0);
  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      const pos = o.geometry.attributes.position, idx = o.geometry.index;
      const n = idx ? idx.count / 3 : pos.count / 3;
      const m = [].concat(o.material)[0];
      const col = m.color ? m.color.clone() : new THREE.Color(1, 1, 1);
      for (let t = 0; t < n; t++) {
        const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
        const area = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
        if (area <= 0) continue;
        total += area; tris.push([total, a.clone(), b.clone(), c.clone(), col]);
      }
    });
  }
  return (out, cols, start, count) => {
    for (let i = start; i < start + count; i++) {
      const r = rnd() * total;
      let lo = 0, hi = tris.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (tris[m][0] < r) lo = m + 1; else hi = m; }
      const [, p0, p1, p2, col] = tris[lo];
      let u = rnd(), v = rnd(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
      out[i * 3] = p0.x + (p1.x - p0.x) * u + (p2.x - p0.x) * v;
      out[i * 3 + 1] = p0.y + (p1.y - p0.y) * u + (p2.y - p0.y) * v;
      out[i * 3 + 2] = p0.z + (p1.z - p0.z) * u + (p2.z - p0.z) * v;
      cols[i * 3] = 0.4 + 0.6 * Math.min(1, col.r * 1.4); cols[i * 3 + 1] = 0.38 + 0.6 * Math.min(1, col.g * 1.4); cols[i * 3 + 2] = 0.36 + 0.6 * Math.min(1, col.b * 1.4);
    }
  };
}
function setSwarm() {
  // from: a loose shell round the plinth, cream with every 7th point in the Overdrive orange
  const c = V(HERO.x, HERO.y + 0.2, HERO.z);
  for (let i = 0; i < N; i++) {
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u), r = lerp(0.45, 1.7, Math.pow(rnd(), 0.6));
    P.from[i * 3] = c.x + Math.cos(th) * s * r; P.from[i * 3 + 1] = c.y + u * r * 0.6; P.from[i * 3 + 2] = c.z + Math.sin(th) * s * r;
    const o = i % 7 === 0;
    P.cA.set(o ? [OD.r * 1.6, OD.g * 1.6, OD.b * 1.6] : [0.95, 0.93, 0.89], i * 3);
  }
  hero.root.updateMatrixWorld(true);
  surfaceSampler([hero.root])(P.to, P.cB, 0, N);
  for (const k of ['aFrom', 'aTo', 'aCA', 'aCB']) P.geo.attributes[k].needsUpdate = true;
}

// scan reveal: the hero is cut at a rising height with a hot edge
function scanShader(root) {
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    for (const m of [].concat(o.material)) {
      if (m.userData.scan) continue;
      m.userData.scan = true;
      const std = m.isMeshStandardMaterial;
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uCut = scan.uCut; sh.uniforms.uBand = scan.uBand;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vScanW;')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvScanW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vScanW; uniform float uCut; uniform float uBand;')
          .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vScanW.y > uCut) discard;');
        if (std) sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.5, 0.25) * 2.2 * smoothstep(uBand, 0.0, uCut - vScanW.y);');
      };
      m.customProgramCacheKey = () => 'upscan';
      m.needsUpdate = true;
    }
  });
}

// ======================================================================= exploded view
function buildExplode() {
  const root = hero.root;
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const centre = V(0.02, 0.08, 0);
  root.traverse((o) => {
    if (!o.isMesh || o === hero.plate || !o.geometry) return;
    o.geometry.computeBoundingBox(); o.geometry.computeBoundingSphere();
    const cw = o.geometry.boundingBox.getCenter(V(0, 0, 0)).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
    const dir = cw.clone().sub(centre); if (dir.length() < 1e-4) dir.set(0, 1, 0);
    dir.normalize(); dir.y += 0.45; dir.normalize();
    // the moving groups fly as units so the callouts stay on them
    let grp = 'chassis'; for (let p = o.parent; p && p !== root; p = p.parent) for (const [k, g] of Object.entries(hero.g)) if (g === p) grp = k;
    heroParts.push({ o, grp, base: o.position.clone(), rot: o.rotation.clone(), dir, dist: 0.05 + rnd() * 0.08, axis: V(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), spin: (rnd() - 0.5) * 1.6 });
  });
}
function setExplode(amt, t) {
  const q = new THREE.Quaternion(), pq = new THREE.Quaternion();
  hero.root.updateMatrixWorld(true);
  const rootQ = hero.root.getWorldQuaternion(new THREE.Quaternion());
  for (const p of heroParts) {
    p.o.position.copy(p.base); p.o.rotation.copy(p.rot);
    if (amt <= 0) continue;
    const dW = p.dir.clone().applyQuaternion(rootQ).multiplyScalar(p.dist * amt);
    p.o.parent.getWorldQuaternion(pq);
    p.o.position.add(dW.applyQuaternion(pq.invert()));
    q.setFromAxisAngle(p.axis, p.spin * amt * (1 + 0.12 * Math.sin(t * 3)));
    p.o.quaternion.premultiply(q);
  }
}
// callout anchors: the world-space centre of a representative part of each group
function groupCentre(grp) {
  const box = new THREE.Box3(), tmp = new THREE.Box3();
  let any = false;
  for (const p of heroParts) if (p.grp === grp) { tmp.copy(p.o.geometry.boundingBox).applyMatrix4(p.o.matrixWorld); if (any) box.union(tmp); else { box.copy(tmp); any = true; } }
  return box.getCenter(V(0, 0, 0));
}
function biggestChassisPart(nameRe) {
  const p = heroParts.find((x) => x.o.userData.names?.some((n) => nameRe.test(n)));
  return p;
}

// ======================================================================= field build: a wireframe wave that drops into solid CAD
function sweepPatch(m, wire) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.uniforms.uR = sweep.uR; sh.uniforms.uBand = sweep.uBand; sh.uniforms.uLift = sweep.uLift;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSwW; uniform float uR; uniform float uBand; uniform float uLift;')
      .replace('#include <project_vertex>', wire
        ? `vec4 swW = modelMatrix * vec4(transformed, 1.0);
           float swD = length(swW.xz) - uR;
           swW.y += uLift * smoothstep(0.0, uBand, swD);
           vSwW = swW.xyz; vSwW.y = swD;
           vec4 mvPosition = viewMatrix * swW; gl_Position = projectionMatrix * mvPosition;`
        : '#include <project_vertex>\nvSwW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vSwW; uniform float uR; uniform float uBand;');
    if (wire) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vSwW.y < 0.0 || vSwW.y > uBand * 1.6) discard;')
        .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.rgb *= (1.0 - smoothstep(uBand * 0.6, uBand * 1.6, vSwW.y)) * (0.35 + 1.4 * smoothstep(0.12, 0.0, vSwW.y));');
    } else {
      sh.fragmentShader = sh.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nfloat swD = length(vSwW.xz) - uR; if (swD > 0.0) discard;');
      // a NaN from a degenerate CAD normal spreads through the bloom chain as black blocks: drop those pixels
      sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\nif (any(isnan(gl_FragColor)) || any(isinf(gl_FragColor))) gl_FragColor = vec4(0.0);');
      if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.45, 0.2) * 1.1 * smoothstep(0.025, 0.0, -swD);');
    }
  };
  const k = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => (k ? k() : '') + (wire ? '|swW' : '|swS');
  m.needsUpdate = true;
}
function buildFieldFx() {
  const done = new Set();
  const wireMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.5, 0.26).multiplyScalar(1.3), wireframe: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
  sweepPatch(wireMat, true);
  P.wire = new THREE.Group(); P.wire.visible = false; scene.add(P.wire);
  for (const root of sim.fieldObjects) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      for (const m of [].concat(o.material)) if (m && !done.has(m) && !m.userData.scan) { done.add(m); sweepPatch(m, false); }
      if (o.geometry.attributes.position.count > 6) {
        const w = new THREE.Mesh(o.geometry, wireMat); w.matrixAutoUpdate = false; w.matrix.copy(o.matrixWorld); w.renderOrder = 7; w.userData.volumetric = true; w.frustumCulled = false;
        P.wire.add(w);
      }
    });
  }
}

// ======================================================================= website panes
const PANES = [
  ['landing', 'landing-desk.png'], ['sim', 'sim-phone.png'], ['sform', 'scout-form-phone.png'], ['sdata', 'scout-data-phone.png'],
  ['spicks', 'scout-picks-phone.png'], ['signin', 'signin-desk.png'], ['sdesk', 'scout-data-desk.png'], ['lphone', 'landing-phone.png'], ['simdesk', 'sim-desk.png'],
];
async function buildPanes() {
  const loader = new THREE.TextureLoader();
  P.panes = new THREE.Group(); P.panes.position.y = -0.058; camera.add(P.panes);
  await Promise.all(PANES.map(async ([key, file]) => {
    const tex = await loader.loadAsync(`shots/${file}`);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
    const aspect = tex.image.width / tex.image.height, phone = aspect < 1;
    const h = phone ? 0.5 : 0.5 / aspect, w = h * aspect;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, size: { value: new THREE.Vector2(w, h) }, rad: { value: phone ? 0.034 : 0.008 }, bez: { value: phone ? 0.008 : 0.0016 }, op: { value: 1 }, lum: { value: 1.75 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D map; uniform vec2 size; uniform float rad, bez, op, lum; varying vec2 vUv;
        float sdR(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
        void main(){
          vec2 p = (vUv - 0.5) * size;
          float d = sdR(p, size * 0.5, rad);
          float aa = 0.0009;
          float outer = 1.0 - smoothstep(-aa, aa, d);
          if (outer <= 0.0) discard;
          // screen inset by the bezel; the bezel is ink with a hairline cream edge
          vec2 inner = size - 2.0 * bez;
          float di = sdR(p, inner * 0.5, max(rad - bez, 0.002));
          vec2 suv = (p / inner) + 0.5;
          vec3 scr = texture2D(map, suv).rgb * lum;
          vec3 ink = vec3(0.012, 0.013, 0.015);
          float edge = smoothstep(-0.0016, -0.0004, d) * 0.55;
          vec3 c = mix(scr, ink, smoothstep(-aa, aa, di));
          c = mix(c, vec3(0.85, 0.82, 0.76), edge);
          gl_FragColor = vec4(c, outer * op);
        }`,
      transparent: true, depthWrite: true, toneMapped: false,
    });
    const g = new THREE.PlaneGeometry(w + (phone ? 0.016 : 0.0032), h + (phone ? 0.016 : 0.0032));
    mat.uniforms.size.value.set(w + (phone ? 0.016 : 0.0032), h + (phone ? 0.016 : 0.0032));
    const m = new THREE.Mesh(g, mat); m.visible = false; m.renderOrder = 5;
    panes[key] = { m, w, h, phone };
    P.panes.add(m);
  }));
}
// place a pane in camera space; opacity 0 hides it
function pane(key, x, y, z, ry = 0, rx = 0, op = 1, s = 1, rz = 0) {
  const p = panes[key];
  p.m.visible = op > 0.001;
  p.m.position.set(x, y, z); p.m.rotation.set(rx, ry, rz); p.m.scale.setScalar(s * 0.86);
  p.m.material.uniforms.op.value = op;
}

// ======================================================================= present: zoom blur, chromatic split, grain, flash
function buildPresent() {
  const vs = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';
  P.present = new THREE.ShaderMaterial({
    uniforms: { tex: { value: null }, time: { value: 0 }, vig: { value: 0.42 }, grain: { value: 0.028 }, ca: { value: 0.0008 }, fade: { value: 0 }, flash: { value: 0 }, zoom: { value: 0 }, dark: { value: 0 } },
    vertexShader: vs,
    fragmentShader: `uniform sampler2D tex; uniform float time, vig, grain, ca, fade, flash, zoom, dark; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + time * 43.1) * 43758.5453); }
      vec3 sampleZ(vec2 uv){
        vec2 d = uv - 0.5; vec3 c = vec3(0.);
        for (int i = 0; i < 14; i++) { float s = 1.0 - zoom * float(i) / 13.0; vec2 q = 0.5 + d * s;
          c.r += texture2D(tex, 0.5 + (q - 0.5) * (1.0 - ca * 5.0)).r; c.g += texture2D(tex, q).g; c.b += texture2D(tex, 0.5 + (q - 0.5) * (1.0 + ca * 5.0)).b; }
        return c / 14.0; }
      void main(){ vec2 d = vUv - 0.5; float r = length(d * vec2(0.5625, 1.));
        vec3 c = sampleZ(vUv);
        c *= 1.0 - vig * smoothstep(0.25, 0.78, r);
        // a soft scrim behind the type at the top and the bottom third
        c *= 1.0 - dark * (smoothstep(0.62, 0.95, vUv.y) * 0.55 + smoothstep(0.5, 0.12, vUv.y) * 0.6);
        c += (h(vUv * vec2(1080., 1920.)) - 0.5) * grain;
        c = mix(c, vec3(1.0, 0.97, 0.92), flash);
        c *= 1.0 - fade;
        gl_FragColor = vec4(c, 1.); }`,
    depthTest: false, depthWrite: false,
  });
}

// ======================================================================= custom shots
const HV = (x, y, z) => { // hero-local -> world (x forward, y up, z right)
  const c = Math.cos(HERO_YAW), s = Math.sin(HERO_YAW);
  return V(HERO.x + x * c + z * s, HERO.y + 0.05 + y, HERO.z - x * s + z * c);
};
function resetFx() {
  P.points.visible = false; scan.uCut.value = 10; sweep.uR.value = 100;
  setExplode(0, 0);
  for (const k of Object.keys(panes)) panes[k].m.visible = false;
}
function enterCustom(name) {
  resetFx();
  if (name === 'hook') { setMode('void'); heroVisible(true); setSwarm(); }
  if (name === 'explode') { setMode('void'); heroVisible(true); }
  if (name === 'field') { setMode('field'); heroVisible(false); sim.robots.forEach((r) => { r.root.visible = false; }); C.fresh(); }
  if (name === 'venue') { setMode('venue'); heroVisible(true); sim.robots.forEach((r) => { r.root.visible = true; }); C.fresh(); C.syncVisuals(); }
  if (name === 'web') { setMode('venue'); heroVisible(true); }
  if (name === 'end') { setMode('venue'); heroVisible(true); }
}
function studio(key, rimA, fill, amb = 0.05) {
  const Lt = C.lights; const tg = HV(0.02, 0.1, 0);
  C.aim(Lt.key, HV(0.5, 2.2, -0.9), tg, key, 0xfff0dd);
  C.aim(Lt.rim2, HV(-1.0, 0.7, 0.8), tg, rimA, 0xffc6a0);
  C.aim(Lt.rim, HV(-0.9, 1.4, -0.9), tg, rimA * 0.7, 0xd8e2f4);
  C.aim(Lt.fill, HV(1.2, 0.4, 1.0), tg, fill, 0xb4c4e0);
  Lt.amb.intensity = amb;
}
function customSample(name, ts) {
  const Lt = C.lights;
  C.lightsOff(); C.leds(0); Lt.amb.intensity = 0.03;
  C.bloom.strength = 0.3; C.bloom.threshold = 1.2; C.bloom.radius = 0.5;
  C.grade.uniforms.exposure.value = 0.88; C.grade.uniforms.streak.value = 0;
  const u = P.u;
  u.uTime.value = ts; u.uBurst.value = 0; u.uSize.value = 0.003; u.uCut.value = -10; u.uAlpha.value = 1; u.uSwirl.value = 0; u.uVortex.value = 0; u.uGain.value = 0.8;
  let pos, tgt, fov = 36, ap = 0.003, fpt = null, shake = 0;
  const t0 = B(START_OF[name]), t = ts - t0;

  if (name === 'hook') {
    // one orbit: the swarm closes into the robot (beat 0 -> 1.3), then the scan cuts it out of the light (1.3 -> 2)
    const T = t / B(2);
    const a = lerp(-0.55, 0.12, easeIO(T)), R = lerp(1.3, 1.0, easeIO(T));
    pos = HV(Math.cos(a) * R, lerp(0.42, 0.26, easeIO(T)), Math.sin(a) * R); tgt = HV(0.02, 0.17, 0); fov = 36; fpt = HV(0.02, 0.1, 0); ap = 0.003;
    P.points.visible = true;
    u.uCenter.value.copy(HV(0, 0.12, 0));
    u.uP.value = sat(t / B(1.35)); u.uSpread.value = 0.45; u.uVortex.value = 6.5; u.uSwirl.value = 0.05; u.uSize.value = 0.0034;
    u.uAlpha.value = sat(t / 0.2); u.uGain.value = 0.95;
    scan.uCut.value = HERO.y - 0.01;
    C.bloom.strength = 0.55; C.bloom.threshold = 0.55;
    const k = sat((t - B(1.2)) / B(0.75));
    if (k > 0) {
      scan.uCut.value = lerp(HERO.y + 0.03, HERO.y + 0.36, easeIO(k));
      u.uCut.value = scan.uCut.value; u.uSwirl.value = 0.004;
      studio(0.5 * ease(k), 0.75 * ease(k), 0.3 * ease(k), 0.02 + 0.03 * ease(k));
    }
    if (t < 0.25) shake = 0.004 * (1 - t / 0.25);
  }
  if (name === 'explode') {
    // out on beat 2, drifts apart while the camera orbits, slams back together on beat 6
    const outA = ease(t / 0.2), back = easeIn((t - B(3.55)) / B(0.45));
    const amt = t < B(3.55) ? outA * (1 + 0.15 * sat((t - 0.2) / 2.2)) : 1.15 * (1 - back);
    setExplode(amt, ts);
    const a = lerp(0.55, -0.35, easeIO(t / B(4))), R = lerp(1.3, 1.15, easeIO(t / B(4)));
    pos = HV(Math.cos(a) * R, lerp(0.5, 0.38, t / B(4)), Math.sin(a) * R); tgt = HV(0.0, 0.2, 0); fov = 38; fpt = HV(0, 0.12, 0); ap = 0.002;
    studio(0.45, 0.75, 0.3, 0.04);
    if (t >= B(4) - 1 / FPS) shake = 0.008;
    if (t < 0.18) shake = 0.006 * (1 - t / 0.18);
  }
  if (name === 'field') {
    // a radial wave from the field centre: wireframe hovers ahead of it and drops into the solid CAD behind it
    sweep.uR.value = lerp(0.35, 3.0, ease(t / B(2.8)));
    sweep.uBand.value = 0.8; sweep.uLift.value = 0.18;
    const T = t / B(4);
    const a = lerp(-2.35, -1.75, easeIO(T)), R = lerp(3.0, 3.9, easeIO(T));
    pos = V(Math.cos(a) * R, lerp(2.4, 3.3, easeIO(T)), Math.sin(a) * R); tgt = V(0, lerp(0.0, -0.15, T), 0); fov = 48; fpt = V(0, 0, 0); ap = 0.0;
    // the build is lit like a black studio: one big soft key from above, cool rims
    C.aim(Lt.key, V(-0.6, 4.2, -1.2), V(0, 0, 0), 1.7, 0xfff2e2);
    C.aim(Lt.rim2, V(2.8, 1.4, 2.6), V(0, 0, 0), 1.1, 0xd4e0ff);
    C.aim(Lt.fill, V(-3, 1.2, 2), V(0, 0, 0), 0.8, 0xc0cce0);
    Lt.amb.intensity = 0.2;
    VEN.lights[0].intensity = 0.55; VEN.sun.intensity = 2.2;
    C.bloom.strength = 0.22; C.bloom.threshold = 1.2;
    C.grade.uniforms.exposure.value = 1.0;
    if (t < 0.2) shake = 0.01 * (1 - t / 0.2);
  }
  if (name === 'venue') {
    // crane: from a low pass over the ALPHA wall up and back until both divisions, the stage and the terraces are in
    const T = t / B(4);
    const k = easeIO(T), k2 = ease(T * 1.15);
    const up = ease(T * 1.4);
    pos = V(lerp(-2.6, -9.0, k), lerp(1.0, 6.2, up), lerp(-2.2, -9.6, k));
    tgt = V(lerp(2.5, 4.4, k), lerp(0.2, 0.2, k), lerp(0.8, 2.4, k)); fov = lerp(40, 46, k); fpt = tgt; ap = 0;
    C.grade.uniforms.exposure.value = 0.98; C.bloom.strength = 0.18; C.bloom.threshold = 1.6;
    VEN.lights[0].intensity = 0.95; VEN.sun.intensity = 2.6;
    if (t < 0.25) shake = 0.012 * (1 - t / 0.25);
  }
  if (name === 'web') {
    // the screens float in front of a slow, blurred move over the venue
    const T = t / B(8);
    pos = V(lerp(-0.7, 0.7, T), 3.3, lerp(-2.3, -2.0, T)); tgt = V(lerp(-0.2, 0.2, T), 0, 0.5); fov = 36;
    fpt = null; ap = 0.06;
    C.grade.uniforms.exposure.value = 0.5; C.bloom.strength = 0.15; C.bloom.threshold = 1.6;
    webPanes(t);
    C.bokeh.uniforms.maxblur.value = 0.022; P.webBlur = true;
    // focus on the pane plane
    return { pos, tgt, fov, focus: P.webFocus || 1.2, aperture: ap, shake: 0 };
  }
  if (name === 'end') {
    const T = t / B(6.5);
    const a = -Math.PI / 2 + 0.55 - 0.25 * easeIO(T);
    const d = lerp(1.45, 1.6, easeIO(T));
    pos = V(HERO.x + Math.cos(a) * d, HERO.y + lerp(0.5, 0.58, T), HERO.z + Math.sin(a) * d);
    tgt = V(HERO.x - 0.02, HERO.y - 0.12, HERO.z + 0.05); fov = 42; fpt = HV(0, 0.12, 0); ap = 0.014;
    VEN.rim.intensity = 4;
    C.grade.uniforms.exposure.value = 0.92; C.bloom.strength = 0.18; C.bloom.threshold = 1.6;
    if (t < 0.25) shake = 0.008 * (1 - t / 0.25);
  }
  if (name !== 'end') VEN.rim.intensity = name === 'venue' || name === 'web' ? 0 : 3.5;
  if (shake) pos = pos.clone().add(V(noise1(ts * 9, 1) * shake, noise1(ts * 9, 7) * shake, noise1(ts * 9, 13) * shake));
  return { pos, tgt, fov, focus: fpt ? pos.distanceTo(fpt) : pos.distanceTo(tgt), aperture: ap };
}

// screen choreography (t = seconds since beat 28)
function webPanes(t) {
  const b = t / BEAT;                                  // beats into the cut
  const inn = (b0, d = 0.45) => ease((b - b0) / d), out = (b1, d = 0.35) => easeIn((b - b1) / d);
  for (const k of Object.keys(panes)) panes[k].m.visible = false;
  let focus = 1.2;
  // 28: the landing page swings in from depth
  if (b < 1.9) {
    const k = inn(0, 0.5), o = out(1.5, 0.4);
    pane('landing', lerp(0.0, -0.05, k) - 0.7 * o, lerp(-0.05, 0.075, k) + 0.1 * o, lerp(-3.2, -1.15, k) - 0.4 * o, lerp(0.55, -0.12, k) + 0.6 * o, 0.05 * (1 - k), sat(k * 3) * (1 - o));
    focus = lerp(3.2, 1.15, k);
  }
  // 29.5: the simulator's home screen on a phone
  if (b >= 1.5 && b < 2.5) {
    const k = inn(1.5, 0.35), o = out(2.15, 0.3);
    pane('sim', lerp(0.5, 0.02, k) - 0.6 * o, 0.04, -1.1, lerp(-0.5, 0.1, k) + 0.5 * o, 0, sat(k * 3) * (1 - o));
    focus = 1.1;
  }
  // 30, 30.5, 31: Overdrive Scout, three phones fanning out
  if (b >= 2 && b < 4.2) {
    const keys = ['sform', 'sdata', 'spicks'];
    keys.forEach((key, i) => {
      const k = inn(2 + i * 0.5, 0.4), o = out(3.75, 0.35);
      const x = (i - 1) * 0.255, z = i === 1 ? -1.18 : -1.3, ry = (1 - i) * 0.32;
      pane(key, lerp(x + 0.35, x, k), lerp(-0.35, 0.05, k) + 0.5 * o * (i - 1), lerp(z - 0.6, z, k) + 1.6 * o, ry + (1 - k) * -0.6, 0, sat(k * 3) * (1 - sat(o * 1.4)), 0.92);
    });
    focus = 1.22;
  }
  // 32: sign-in, one account
  if (b >= 4 && b < 5.8) {
    const k = inn(4, 0.45), o = out(5.4, 0.35);
    pane('signin', 0.0, lerp(-0.45, 0.08, k), lerp(-1.6, -1.15, k) - 0.5 * o, lerp(-0.25, 0.1, k), lerp(-0.35, 0.0, k), sat(k * 3) * (1 - o));
    focus = 1.15;
  }
  // 33.5 -> 36: every screen in a 3x3 grid pushing towards the lens, then rushing past it into the end card
  if (b >= 5.5) {
    const keys = ['lphone', 'sdesk', 'sform', 'simdesk', 'landing', 'spicks', 'sim', 'signin', 'sdata'];
    const k = inn(5.5, 0.5), rush = easeIn((b - 7.3) / 0.7);
    const z = lerp(-2.9, -1.75, easeIO((b - 5.5) / 1.8)) + 2.6 * rush;
    keys.forEach((key, i) => {
      const cx = (i % 3) - 1, cy = 1 - Math.floor(i / 3);
      const spread = 1 + 1.4 * rush;
      const d = 0.06 * Math.sin(i * 1.7 + b * 0.8);
      pane(key, cx * 0.47 * spread, cy * 0.47 * spread + d, z - Math.abs(cx) * 0.12, -cx * 0.22, cy * 0.08, sat(k * 2 - Math.abs(cx) * 0.3 - (cy + 1) * 0.15) * (z < -0.12 ? 1 : 0));
    });
    focus = -z;
  }
  P.webFocus = focus;
}

function renderCustom(name, outT, fx) {
  const { renderer: rd, accRT, accMat, quad, quadScene, quadCam, bokeh } = C;
  const SAMPLES = C.SAMPLES, SHUTTER = C.SHUTTER;
  rd.setRenderTarget(accRT); rd.setClearColor(0x000000, 1); rd.clear(); rd.setRenderTarget(null);
  for (let s = 0; s < SAMPLES; s++) {
    const ts = outT + (s / (SAMPLES - 1)) * SHUTTER / FPS;
    C.syncVisuals();
    if (name === 'hook' || name === 'explode') heroVisible(true);
    const cam = customSample(name, ts);
    camera.position.copy(cam.pos); camera.fov = cam.fov * (1 - fx.punch); camera.updateProjectionMatrix(); camera.lookAt(cam.tgt); camera.updateMatrixWorld(true);
    bokeh.uniforms.focus.value = cam.focus; bokeh.uniforms.aperture.value = cam.aperture; bokeh.uniforms.maxblur.value = name === 'web' ? 0.024 : 0.012;
    C.updateDust(ts);
    C.composer.render();
    accMat.uniforms.tex.value = C.composer.readBuffer.texture; accMat.uniforms.w.value = 1 / SAMPLES;
    quad.material = accMat; rd.setRenderTarget(accRT); rd.autoClear = false; rd.render(quadScene, quadCam); rd.autoClear = true;
  }
}

// ======================================================================= typography
// [id, from beat, to beat, kind]: 'card' rises in, 'word' slams, 'end' stays
const TEXT = [
  ['tHook', 0.15, 1.9, 'card'],
  ['tRobot', 2.1, 5.7, 'card'],
  ['wGrip', 6.5, 6.97, 'word'], ['wLift', 7.0, 7.95, 'word'],
  ['tField', 8.2, 9.9, 'card'], ['tField2', 10.0, 11.9, 'card'],
  ['tVenue', 12.25, 13.95, 'card'], ['tVenue2', 14.0, 15.9, 'card'],
  ['tStation', 23.0, 24.9, 'card'],
  ['tArena', 26.75, 27.9, 'card'],
  ['tWeb', 28.25, 29.9, 'card'], ['tScout', 30.0, 31.9, 'card'], ['tAcct', 32.1, 33.4, 'card'], ['tPwa', 33.6, 35.7, 'card'],
  ['eTop', 36.6, 99, 'end'], ['eWord', 37.0, 99, 'end'], ['eSub', 37.5, 99, 'end'], ['eUrl', 38.0, 99, 'end'], ['eTeam', 38.5, 99, 'end'],
];
const CALL = [
  // id, group (or chassis part), screen side, label offset, show from beat
  ['c0', 'end', 1, 2.5], ['c1', 'armUpper', -1, 3.0], ['c2', 'wheelFL', 1, 3.5], ['c3', 'chassis', -1, 4.0],
];
function typography(outT) {
  const b = outT / BEAT;
  for (const [id, b0, b1, kind] of TEXT) {
    const el = $(id);
    if (b < b0 || b > b1) { el.style.opacity = 0; continue; }
    const tin = (b - b0) * BEAT, tout = (b1 - b) * BEAT;
    if (kind === 'word') {
      const a = ease(tin / 0.08), o = ease(tout / 0.07);
      el.style.opacity = Math.min(a, o);
      el.style.transform = `translateY(${(1 - o) * -24}px) scale(${1 + (1 - a) * 0.18})`;
      el.style.filter = `blur(${(1 - a) * 10 + (1 - o) * 8}px)`;
    } else {
      const a = ease(tin / (kind === 'end' ? 0.35 : 0.22)), o = kind === 'end' ? 1 : ease(tout / 0.1);
      el.style.opacity = Math.min(a, o);
      // lines rise in under a mask-like blur; the mono label leads the serif by a hair
      el.style.transform = `translateY(${(1 - a) * 34 + (1 - o) * -14}px)`;
      el.style.filter = `blur(${(1 - a) * 9 + (1 - o) * 6}px)`;
    }
  }
  const u = $('eUrl'); if (b >= 38) u.style.transform += ` scale(${0.97 + 0.03 * ease((b - 38) * BEAT / 0.35)})`;
  // score pop above the pole the CORE lands on
  const pop = $('pop');
  const land = upEvents.find((e) => e.type === 'land');
  if (land && outT >= land.out && b < 21.95) {
    const k = outT - land.out;
    const pp = land.pos ? land.pos.clone().add(V(0, 0.18, 0)).project(camera) : V(0, 0.3, 0);
    pop.style.left = `${clamp((pp.x * 0.5 + 0.5) * W - 110, 90, 700)}px`; pop.style.top = `${clamp((0.5 - pp.y * 0.5) * H - 300 - k * 40, 360, 1200)}px`;
    pop.style.opacity = sat(Math.min(k / 0.06, (B(21.95) - outT) / 0.1));
    pop.style.transform = `scale(${1 + Math.max(0, 0.3 - k * 2)})`; pop.style.filter = `blur(${Math.max(0, 0.12 - k) * 40}px)`;
  } else pop.style.opacity = 0;
  // exploded-view callouts: a hairline from the part to its label
  const svg = $('co');
  let lines = '';
  for (const [id, grp, side, bs] of CALL) {
    const el = $(id);
    const on = b >= bs && b < 5.55 && mode === 'void';
    if (!on) { el.style.opacity = 0; continue; }
    const a = ease((b - bs) * BEAT / 0.18), o = ease((5.55 - b) * BEAT / 0.1);
    const pw = grp === 'chassis' ? HV(-0.08, 0.06, -0.05) : groupCentre(grp);
    if (grp === 'chassis') { // follow the battery / chassis plate as it flies
      const part = heroParts.find((p) => p.grp === 'chassis' && p.o.geometry.boundingSphere?.radius > 0.08);
      if (part) { pw.copy(part.o.geometry.boundingSphere.center).applyMatrix4(part.o.matrixWorld); }
    }
    const pp = pw.clone().project(camera);
    const x = (pp.x * 0.5 + 0.5) * W, y = (0.5 - pp.y * 0.5) * H;
    const lx = side > 0 ? Math.min(1000, x + 150) : Math.max(80, x - 150), ly = y - 120;
    const tx = side > 0 ? lx + 14 : lx - 14;
    const len = a;
    lines += `<circle cx="${x}" cy="${y}" r="${5 * a}" opacity="${o}"/><line x1="${x}" y1="${y}" x2="${lerp(x, lx, len)}" y2="${lerp(y, ly, len)}" opacity="${o}"/>`
      + `<line x1="${lx}" y1="${ly}" x2="${lerp(lx, lx + side * 60, a)}" y2="${ly}" opacity="${o * a}"/>`;
    el.style.opacity = Math.min(a, o);
    const lw = el.offsetWidth || 300;
    el.style.left = side > 0 ? `${Math.min(tx + 60, W - 40 - lw)}px` : 'auto';
    el.style.right = side > 0 ? 'auto' : `${Math.min(W - tx + 60, W - 40 - lw)}px`;
    el.style.textAlign = side > 0 ? 'left' : 'right';
    el.style.top = `${ly - 20}px`;
    el.style.transform = `translateX(${(1 - a) * side * -12}px)`;
  }
  svg.innerHTML = lines;
}

// ======================================================================= frame
let cutIdx = -1, editT = 0;
window.UP_FRAMES = TOTAL;
window.UP_BEATS = { bpm: BPM, cuts: CUTS.filter((c) => c.shot || c.c).map((c) => ({ b: c.b, frame: bf(c.b), out: bf(c.b) / FPS, what: c.shot || c.c, hit: c.hit || 0 })) };
window.upEvents = upEvents;
window.renderUpFrame = (f) => {
  let i = CUTS.length - 2;
  while (i > 0 && f < bf(CUTS[i].b)) i--;
  const c = CUTS[i];
  const outT = f / FPS, lf = f - bf(c.b);
  if (i !== cutIdx) {
    cutIdx = i;
    if (c.shot) {
      resetFx(); setMode('venue'); heroVisible(false);
      sim.robots.forEach((r) => { r.root.visible = true; });
      C.seekCut(c); editT = c.t;
    } else enterCustom(c.c);
    upEvents.push({ type: 'cut', what: c.shot || c.c, out: outT, hit: c.hit || 0 });
  }
  const punch = (c.hit === 2 ? 0.1 : c.hit ? 0.07 : 0.035) * Math.max(0, 1 - lf / 5);
  const flash = (c.hit === 2 ? 0.42 : c.hit ? 0.28 : 0.08) * Math.max(0, 1 - lf / (c.hit ? 4 : 2));
  if (c.shot) {
    const nEv = C.events.length;
    C.pipeFrame(editT, c.k, true, { punch, flash: 0, fade: 0, outT, card: false });
    for (let k = nEv; k < C.events.length; k++) {
      const e = { ...C.events[k], out: outT + (C.events[k].t - editT) / c.k };
      if (e.type === 'land' && C.S.ring3) { const p = C.S.ring3.pos(); e.pos = V(p.x, p.y, p.z); }
      upEvents.push(e);
    }
    editT += c.k / FPS;
    lastCam = { pos: camera.position.clone(), fov: camera.fov };
  } else {
    renderCustom(c.c, outT, { punch });
  }
  const pm = P.present.uniforms;
  pm.tex.value = C.accRT.texture; pm.time.value = outT;
  pm.flash.value = flash;
  pm.zoom.value = (c.hit ? 0.045 : 0.018) * Math.max(0, 1 - lf / 4);
  pm.ca.value = 0.0007 + (c.hit ? 0.0035 : 0.0012) * Math.max(0, 1 - lf / 4);
  pm.fade.value = f >= TOTAL - 14 ? (f - (TOTAL - 14)) / 14 : f < 3 ? 1 - f / 3 : 0;
  const b = outT / BEAT;
  const textOn = TEXT.some(([, b0, b1, k]) => k !== 'word' && b >= b0 && b <= b1);
  pm.dark.value = textOn && mode === 'venue' ? 0.55 : textOn ? 0.25 : 0;
  C.quad.material = P.present; renderer.setRenderTarget(null); renderer.render(C.quadScene, C.quadCam);
  typography(outT);
  return { f, cut: i, what: c.shot || c.c };
};
// debugging: a still from any camera in any mode
window.upStill = (m, pos, tgt, fov = 40) => {
  resetFx(); setMode(m); heroVisible(m !== 'field');
  const { renderer: rd, accRT, accMat, quad, quadScene, quadCam, bokeh } = C;
  rd.setRenderTarget(accRT); rd.setClearColor(0, 1); rd.clear(); rd.setRenderTarget(null);
  C.syncVisuals(); C.lightsOff(); C.lights.amb.intensity = 0;
  camera.position.set(...pos); camera.fov = fov; camera.updateProjectionMatrix(); camera.lookAt(...tgt); camera.updateMatrixWorld(true);
  bokeh.uniforms.aperture.value = 0;
  C.grade.uniforms.exposure.value = 0.98; C.bloom.strength = 0.18; C.bloom.threshold = 1.6;
  C.composer.render();
  accMat.uniforms.tex.value = C.composer.readBuffer.texture; accMat.uniforms.w.value = 1;
  quad.material = accMat; rd.setRenderTarget(accRT); rd.render(quadScene, quadCam);
  const pm = P.present.uniforms; pm.tex.value = accRT.texture; pm.flash.value = 0; pm.zoom.value = 0; pm.fade.value = 0; pm.dark.value = 0;
  C.quad.material = P.present; rd.setRenderTarget(null); rd.render(quadScene, quadCam);
  return true;
};

init().catch((e) => { console.error('update init', e); window.upError = String(e && e.stack || e); });
