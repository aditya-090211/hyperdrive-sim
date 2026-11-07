// The IIT Bombay venue as a backdrop, with a match being played on both division fields. Used behind the sign-in
// page, and (rendered once by tools/render-stadium.cjs) as the still behind Scout and the legal pages.
// The match is choreographed, not simulated: robots follow looping routes between their start zones and the poles,
// the LED wall counts down and the score ticks up, and the crowd reacts. No physics runs here.
import * as THREE from 'three';
import { loadRobotModel, buildRobotVisual } from './robot-model.js';
import { buildArena, daylight, cloneDivision, SUN_DIR, DIV_DX } from './arena.js';
import { COLORS, IN, TEAMS } from './config.js';
import { gpuTier, prCap, createGovernor, compileAll } from './governor.js';

// closed routes in field coordinates (metres) for Red 1, Red 2, Blue 1, Blue 2: start zone → poles → back
const ROUTES = [
  [[-0.3, -1.6], [-0.35, -0.95], [0.25, -0.55], [0.6, 0.15], [0.05, 0.45], [-0.55, -0.15], [-0.75, -0.9]],
  [[0.3, -1.6], [0.75, -1.1], [0.9, -0.3], [0.35, 0.3], [-0.2, -0.2], [0.05, -0.95]],
  [[0.3, 1.6], [0.35, 0.95], [-0.25, 0.55], [-0.6, -0.15], [-0.05, -0.45], [0.55, 0.15], [0.75, 0.9]],
  [[-0.3, 1.6], [-0.75, 1.1], [-0.9, 0.3], [-0.35, -0.3], [0.2, 0.2], [-0.05, 0.95]],
];
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export async function createStadium(canvas, { mobile = false, crowd = true, assets = 'assets/', onProgress = () => {} } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const tier = mobile ? 'low' : gpuTier(renderer);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 90);
  const gov = createGovernor({ key: 'stadium', start: tier === 'low' ? 0.8 : 1, onChange: () => resize() });
  const resize = () => {
    renderer.setPixelRatio(prCap(tier) * gov.scale);
    renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
    camera.aspect = (canvas.clientWidth || window.innerWidth) / Math.max(1, canvas.clientHeight || window.innerHeight); camera.updateProjectionMatrix();
  };
  resize(); window.addEventListener('resize', resize);
  daylight(scene, renderer);
  scene.add(new THREE.HemisphereLight(0xd3e2f5, 0x6d6152, 0.95));
  const sun = new THREE.DirectionalLight(0xffdcb4, 2.5);
  sun.position.copy(SUN_DIR).multiplyScalar(12).add(new THREE.Vector3(DIV_DX / 2, 0, 0)); sun.target.position.set(DIV_DX / 2, 0, 0);
  sun.castShadow = true; Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 6, bottom: -6, near: 1, far: 30 });
  sun.shadow.mapSize.set(tier === 'low' ? 1024 : 2048, tier === 'low' ? 1024 : 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  onProgress(10);
  // a backdrop only needs the field's looks, so no physics engine is loaded here
  const [{ buildField, loadFieldModel }, model] = await Promise.all([import('./field.js'), loadRobotModel(assets)]);
  onProgress(40);
  const fieldModel = await loadFieldModel(assets);
  onProgress(70);
  const before = new Set(scene.children);
  const F = buildField(scene, null, renderer, fieldModel);
  for (const s of ['red', 'blue']) F.stations[s].sync?.();
  const fieldObjs = scene.children.filter((o) => !before.has(o));
  const bravo = cloneDivision(scene, fieldObjs);
  const arena = buildArena(scene, { crowd: crowd && !mobile });
  onProgress(90);

  // robots on both fields, each on its own route (BRAVO runs the same plays half a lap behind)
  const numbers = [['009', '1002', '2001', '2002'], ['1201', '1730', '2049', '2210']];
  const bots = [];
  for (const [d, parent] of [[0, scene], [1, bravo]]) {
    TEAMS.forEach((t, i) => {
      const v = buildRobotVisual(model, { squadCol: t.squad === 'red' ? COLORS.red : COLORS.blue, number: numbers[d][i], shadows: d === 0 });
      const curve = new THREE.CatmullRomCurve3(ROUTES[i].map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal', 0.5);
      parent.add(v.root);
      bots.push({ v, curve, len: curve.getLength(), u: d * 0.5 + i * 0.13, speed: 0.42 + ((i * 7 + d * 3) % 5) * 0.035, spin: 0 });
    });
  }
  void IN;

  // the match clock and score on the LED wall
  let clock = 150, red = 0, blue = 0, nextScore = 3;
  const tan = new THREE.Vector3(), pos = new THREE.Vector3();
  const step = (dt, t) => {
    for (const b of bots) {
      b.u = (b.u + (b.speed * dt) / b.len) % 1;
      b.curve.getPointAt(b.u, pos); b.curve.getTangentAt(b.u, tan);
      b.v.root.position.set(pos.x, 0, pos.z);
      b.v.root.rotation.y = Math.atan2(-tan.z, tan.x);
      b.spin += (b.speed * dt) / 0.055;
      const arm = 0.5 - 0.5 * Math.cos(b.u * Math.PI * 6);
      b.v.pose(arm * 0.9, -0.17 + arm * 0.4, b.spin);
    }
    clock -= dt; nextScore -= dt;
    if (clock <= 0) { clock = 150; red = 0; blue = 0; }
    if (nextScore <= 0) {
      nextScore = 2.5 + Math.random() * 4;
      const pts = [1, 3, 3, 5, 5, 7, 9][(Math.random() * 7) | 0];
      if (Math.random() < 0.5) red += pts; else blue += pts;
      arena.excite = Math.min(1, arena.excite + 0.5);
    }
    arena.setScore(red, blue, fmt(Math.max(0, clock)), clock < 30 ? 'LEVEL UP' : 'QUALIFICATION');
    arena.update(dt);
    void t;
  };

  // camera: high on the side terraces, swinging slowly across both fields (never through the canopy)
  const C = new THREE.Vector3(DIV_DX / 2, 0, 0);
  const shot = { radius: 13, height: 5.0, base: -2.7, swing: 0.3, speed: 0.06, look: new THREE.Vector3(DIV_DX / 2, -0.3, 0.3), film: 0 };
  const place = (a) => {
    camera.position.set(C.x + Math.cos(a) * shot.radius, shot.height, C.z + Math.sin(a) * shot.radius * 0.75);
    camera.lookAt(shot.look);
    camera.filmOffset = shot.film; camera.updateProjectionMatrix();
  };

  let raf = 0, last = 0, t = 0;
  const frame = (now) => {
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0); last = now; t += dt;
    step(dt, t);
    place(shot.base + Math.sin(t * shot.speed) * shot.swing);
    renderer.render(scene, camera);
    gov.frame(dt);
    raf = requestAnimationFrame(frame);
  };
  await compileAll(renderer, scene, camera);
  onProgress(100);
  return {
    renderer, scene, camera, shot, arena,
    start() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } },
    stop() { cancelAnimationFrame(raf); raf = 0; },
    // advance the match by a fixed time and draw one frame (used to render the stills)
    still(seconds, angle = shot.base) { for (let i = 0; i < seconds * 30; i++) step(1 / 30, i / 30); place(angle); renderer.render(scene, camera); },
  };
}
