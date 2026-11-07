// Cinematic reel director: renders the real HYPERDRIVE simulator with film lighting,
// lens effects and true (accumulated) motion blur. 1080x1920 @ 30 fps, deterministic.
import * as THREE from 'three';
import { EffectComposer } from './jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './jsm/postprocessing/RenderPass.js';
import { ShaderPass } from './jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from './jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from './jsm/postprocessing/BokehPass.js';
import { OutputPass } from './jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from './jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from '../lib/BufferGeometryUtils.js';
import { createWorld, qrot, RAPIER } from '../js/physics.js';
import { buildField, loadFieldModel } from '../js/field.js';
import { loadRobotModel, Robot } from '../js/robot.js';
import { Game } from '../js/game.js';
import { TEAMS, ROBOT, COLORS, wx, wz } from '../js/config.js';

let seed = 1337;
Math.random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

const W = 1080, H = 1920, FPS = 30, STEP = 1 / 240, SAMPLES = Number(new URLSearchParams(location.search).get('samples') || 8), SHUTTER = 0.5;
const DEG = Math.PI / 180;
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sat = (v) => clamp(v, 0, 1);
const ease = (t) => 1 - Math.pow(1 - sat(t), 3);
const easeIO = (t) => { t = sat(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const lerp = (a, b, t) => a + (b - a) * t;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const noise1 = (t, s = 0) => Math.sin(t * 1.7 + s) * 0.5 + Math.sin(t * 2.9 + s * 1.3) * 0.3 + Math.sin(t * 5.3 + s * 2.1) * 0.2;

let renderer, scene, camera, composer, bokeh, bloom, grade, sim, game;
let accRT, quad, accMat, presentMat, quadScene, quadCam;
const lights = {}; const beams = []; let dust, ledStrips = [];
const events = [];
const S = {};   // director state

// ======================================================================= boot
async function boot() {
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1); renderer.setSize(W, H);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92;
  $('view').appendChild(renderer.domElement);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020306);
  scene.fog = new THREE.FogExp2(0x05070c, 0.16);
  camera = new THREE.PerspectiveCamera(36, W / H, 0.01, 40);

  // reflections from a soft studio environment (kept low so the arena stays dark)
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const { world, events: ev } = await createWorld();
  sim = {
    world, events: ev, scene, renderer, camera, simTime: 0, showLabels: false, showGuides: false,
    audio: new Proxy({}, { get: () => () => {} }), hud: new Proxy({}, { get: () => () => {} }), owners: new Map(),
    registerCollider(c, info) { this.owners.set(c.handle, info); },
    registerBody(body, colliders, info) { for (const c of colliders) this.owners.set(c.handle, info); },
    unregisterBody(body) { const n = body.numColliders(); for (let i = 0; i < n; i++) { const h = body.collider(i).handle; this.owners.delete(h); for (const r of this.robots || []) { r.contacts.delete(h); r.pairContacts.delete(h); } } },
  };
  const beforeField = new Set(scene.children);
  sim.field = buildField(scene, world, renderer, await loadFieldModel('../assets/'), RAPIER);
  sim.fieldObjects = scene.children.filter((o) => !beforeField.has(o));
  sim.registerCollider(sim.field.floorCollider, { type: 'floor' });
  for (const s of ['red', 'blue']) for (const c of sim.field.stations[s].colliders) sim.registerCollider(c, { type: 'station', station: sim.field.stations[s] });
  const model = await loadRobotModel('../assets/');
  sim.robots = TEAMS.map((t) => new Robot(sim, t, model));
  game = sim.game = new Game(sim);
  // let the hinged ramps settle onto their floor plates once (as the simulator does), so every reset starts from rest
  for (let i = 0; i < 480; i++) { for (const s of ['red', 'blue']) { const st = sim.field.stations[s]; st.deckBody.resetTorques(false); st.step?.(STEP); } world.step(); }
  for (const s of ['red', 'blue']) { sim.field.stations[s].captureRest?.(); sim.field.stations[s].reset?.(); }
  sim.stationBodies = ['red', 'blue'].flatMap((s) => [sim.field.stations[s].deckBody, ...sim.field.stations[s].ramps.map((r) => r.body)]);

  lookDev();
  buildLights();
  buildDust();
  buildPost();
  await document.fonts.ready;
  await document.fonts.load('800 100px "Inter Tight"'); await document.fonts.load('600 100px Inter');
  teamBranding();
  window.__cine = { sim, game, S, camera, lights };
  // internals for other directors built on this pipeline (promo/ad.js)
  Object.assign(window.__cine, {
    renderer, scene, get composer() { return composer; }, bokeh, bloom, grade, accRT, accMat, presentMat, quad, quadScene, quadCam, dust, beams,
    enter, direct, cameraAndLights, stepPhysics, syncVisuals, updateDust, aim, stadium, lightsOff, leds, fresh, park, setArm, openGrip, clearArea, W3,
    SHOTS, ROOT, events, pipeFrame, seekCut, getEditT: () => editT, setEditT: (v) => { editT = v; }, FPS, SAMPLES, SHUTTER, STEP, W, H,
  });
  window.cineReady = true;
}

// ======================================================================= materials & set dressing
function lookDev() {
  // everything gets a little environment reflection; robots get proper metals
  scene.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    for (const m of [].concat(o.material)) if (m.isMeshStandardMaterial && m.envMapIntensity === 1) m.envMapIntensity = 0.25;
  });
  const grain = S.grain = grainTexture();
  // field floor: matte foam tiles with a fine surface grain
  scene.traverse((o) => {
    if (o.isMesh && o.geometry?.type === 'PlaneGeometry' && o.geometry.parameters.width > 3 && o.material?.map) {
      const fg = grain.clone(); fg.repeat.set(10, 10); fg.needsUpdate = true;
      const m = o.material; m.color.setScalar(0.5); m.roughness = 1; m.roughnessMap = fg; m.bumpMap = fg; m.bumpScale = 0.3; m.envMapIntensity = 0.05; m.needsUpdate = true;
    }
  });
  // squad-coloured field parts (poles, core racks, station pads): same deep anodised/moulded colour as the cores
  const robotRoots = new Set(sim.robots.map((r) => r.root));
  const fieldParts = []; scene.traverse((o) => { if (o.isMesh) { let p = o; while (p && !robotRoots.has(p)) p = p.parent; if (!p) fieldParts.push(o); } });
  fieldParts.forEach((o) => {
    if (!o.material?.isMeshStandardMaterial || o.material.userData.fieldLook) return;
    for (const m of [].concat(o.material)) {
      m.userData.fieldLook = true;
      if (isHex(m.color, COLORS.red)) m.color.setRGB(0.26, 0.012, 0.016); else if (isHex(m.color, COLORS.blue)) m.color.setRGB(0.012, 0.04, 0.26); else continue;
      m.roughness = Math.max(m.roughness, 0.5);
    }
  });
  // station deck + ramps: clear polycarbonate (reflective, see-through) instead of milky plastic
  scene.traverse((o) => {
    if (!o.isMesh || !o.material?.transparent || !o.material.isMeshStandardMaterial) return;
    const m = o.material, c = m.color;
    if (Math.abs(c.r - 0.73) < 0.06 && c.b > c.r && m.opacity === 0.5) { m.color.setRGB(0.55, 0.6, 0.66); m.opacity = 0.24; m.roughness = 0.1; m.metalness = 0; m.envMapIntensity = 1.5; }
  });
  for (const r of sim.robots) {
    const done = new Set();
    r.root.traverse((o) => {
      if (!o.isMesh || done.has(o.material) || !o.material.isMeshStandardMaterial) return;
      const m = o.material; done.add(m);
      const c = m.color, lum = (c.r + c.g + c.b) / 3;
      if (isHex(c, COLORS.red) || isHex(c, COLORS.blue)) {   // squad plates: anodised aluminium, deep colour
        if (isHex(c, COLORS.red)) c.setRGB(0.24, 0.012, 0.016); else c.setRGB(0.012, 0.04, 0.24);
        m.metalness = 0.45; m.roughness = 0.42; m.envMapIntensity = 0.7; m.roughnessMap = grain; m.bumpMap = grain; m.bumpScale = 0.25; m.needsUpdate = true;
        o.parent.traverse((p) => { if (p.isMesh && p.material === m) boxUV(p.geometry, 8); });
      }
      else if (m.transparent) { m.roughness = 0.08; m.metalness = 0; m.envMapIntensity = 1.6; m.opacity = 0.42; }
      else if (Math.abs(c.r - c.g) < 0.05 && Math.abs(c.g - c.b) < 0.06 && lum > 0.7) { m.metalness = 0.9; m.roughness = 0.34; m.envMapIntensity = 0.85; m.color.setRGB(0.8, 0.81, 0.84); }    // aluminium plate
      else if (lum < 0.16) { m.metalness = 0.55; m.roughness = 0.42; m.envMapIntensity = 0.9; }                                                                                    // anodised black
      else if (Math.abs(c.r - c.g) < 0.06 && lum > 0.25) { m.metalness = 0.85; m.roughness = 0.4; m.envMapIntensity = 0.8; }                                                    // steel / bronze
      else { m.metalness = 0.0; m.roughness = 0.62; m.envMapIntensity = 0.4; m.color.multiplyScalar(0.7); }                                                                                                   // coloured plastics
    });
    // detailed tyres for the close-ups (CAD wheels are plain cylinders); same 113 mm x 56 mm envelope
    for (const k of ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR']) {
      const g = r.g[k];
      g.children.forEach((ch) => { ch.visible = false; });
      g.add(makeWheel(k.endsWith('L') ? -1 : 1));
    }
    // status LED (R8.15) on the HEXA hub
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.12, 1.4, 0.4) }));
    led.position.set(-0.02, 0.113, 0.042); r.root.add(led);
    const led2 = led.clone(); led2.material = new THREE.MeshBasicMaterial({ color: r.squad === 'red' ? new THREE.Color(1.5, 0.15, 0.12) : new THREE.Color(0.15, 0.35, 1.7) });
    led2.position.set(-0.148, 0.09, 0.07); r.root.add(led2);
  }
}

// fine surface grain (foam / anodise / print texture) so big faces are not perfectly flat CG.
// Own PRNG so the scene's seeded Math.random sequence (and therefore the choreography) is unchanged.
const isHex = (c, hex) => { const t = new THREE.Color(hex); return Math.abs(c.r - t.r) + Math.abs(c.g - t.g) + Math.abs(c.b - t.b) < 0.01; };
function grainTexture() {
  let sd = 4242; const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  const N = 512, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N);
  for (let i = 0; i < N * N; i++) { const v = 200 + (rnd() - 0.5) * 60; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  g.globalAlpha = 0.035;
  for (let i = 0; i < 500; i++) { g.fillStyle = rnd() < 0.5 ? '#000' : '#fff'; g.beginPath(); g.arc(rnd() * N, rnd() * N, 3 + rnd() * 26, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}
// box-projected UVs (per vertex, by dominant normal axis) for CAD meshes that ship without UVs
function boxUV(geo, k) {
  if (geo.attributes.uv) return;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const p = geo.attributes.position, n = geo.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const [u, v] = ax >= ay && ax >= az ? [p.getZ(i), p.getY(i)] : ay >= az ? [p.getX(i), p.getZ(i)] : [p.getX(i), p.getY(i)];
    uv[i * 2] = u * k; uv[i * 2 + 1] = v * k;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
// scoring cores: matte moulded plastic in a deep squad colour with a light texture
function coreLook() {
  for (const c of game.cores) {
    const m = c.mesh.material; if (m.userData.look) continue; m.userData.look = true;
    if (isHex(m.color, COLORS.red)) m.color.setRGB(0.26, 0.012, 0.016); else if (isHex(m.color, COLORS.blue)) m.color.setRGB(0.012, 0.04, 0.26);
    if (!S.coreGrain) { S.coreGrain = S.grain.clone(); S.coreGrain.repeat.set(1, 1); S.coreGrain.needsUpdate = true; }
    m.roughness = 0.78; m.roughnessMap = S.coreGrain; m.bumpMap = S.coreGrain; m.bumpScale = 0.35; m.envMapIntensity = 0.35; m.needsUpdate = true;
  }
}

function makeWheel(side) {
  const R = ROBOT.wheelR, Wd = 0.056;
  const grp = new THREE.Group();
  // tyre: rounded profile lathe + tread lugs
  const pts = [];
  const r0 = R - 0.012, f = 0.006;
  pts.push(new THREE.Vector2(r0, -Wd / 2));
  for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2); pts.push(new THREE.Vector2(R - 0.003 - f + Math.cos(a) * f, -Wd / 2 + f + Math.sin(a) * f)); }
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * (Math.PI / 2); pts.push(new THREE.Vector2(R - 0.003 - f + Math.cos(a) * f, Wd / 2 - f + Math.sin(a) * f)); }
  pts.push(new THREE.Vector2(r0, Wd / 2));
  const tyreGeo = new THREE.LatheGeometry(pts, 64);
  // tread lugs in the lathe frame (axle = Y): x radial, y axial, z tangential; staggered rows
  const lugs = [];
  for (let i = 0; i < 28; i++) {
    for (const zz of [-1, 1]) {
      const b = new THREE.BoxGeometry(0.0044, Wd * 0.38, 0.0068);
      b.translate(R - 0.0022, zz * Wd * 0.21, 0);
      b.applyMatrix4(new THREE.Matrix4().makeRotationY((i / 28) * Math.PI * 2 + (zz > 0 ? Math.PI / 28 : 0)));
      lugs.push(b);
    }
  }
  const rubber = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.82, metalness: 0, envMapIntensity: 0.4 });
  const tyre = new THREE.Mesh(mergeGeometries([tyreGeo.toNonIndexed(), ...lugs.map((g) => g.toNonIndexed())]), rubber);
  tyre.geometry.computeVertexNormals();
  // hub: lavender printed rim (CAD colour) with five spokes and an aluminium cap
  const plastic = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.24, 0.26, 0.37), roughness: 0.6, metalness: 0.05, envMapIntensity: 0.35 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xd8dbe2, roughness: 0.25, metalness: 0.95, envMapIntensity: 1.3 });
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r0, r0, Wd * 0.92, 48, 1, true), plastic);
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(r0 - 0.004, r0 - 0.004, Wd * 0.9, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0x272a33, roughness: 0.6, side: THREE.BackSide }));
  const spokes = [];
  for (let i = 0; i < 5; i++) { const s = new THREE.BoxGeometry(r0 * 1.9, 0.008, 0.0078); s.applyMatrix4(new THREE.Matrix4().makeRotationY((i / 5) * Math.PI)); spokes.push(s.toNonIndexed()); }
  const spokeMesh = new THREE.Mesh(mergeGeometries(spokes), plastic);
  spokeMesh.position.y = side * Wd * 0.36;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 24), metal); cap.position.y = side * Wd * 0.46;
  const hub = new THREE.Group(); hub.add(rim, inner, spokeMesh, cap);
  grp.add(tyre, hub);
  // lathe axis is Y; the wheel group spins about local Z (the axle)
  grp.rotation.x = Math.PI / 2;
  grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return grp;
}

// ======================================================================= team branding (OVERDRIVE 009)
// the hero robot (Red 1) is team 009: vinyl decals on both front plates + its rear number plate
function decalTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = '600 92px Inter'; g.letterSpacing = '32px'; g.fillText('OVERDRIVE', 528, 150);
  g.font = '800 330px "Inter Tight"'; g.letterSpacing = '-6px'; g.fillText('009', 512, 462);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function teamBranding() {
  const r = sim.robots[0];
  r.setNumber('009');
  let plate = null; r.root.traverse((o) => { if (o.isMesh && o.material.bumpMap) plate = o; });
  if (!plate) return;
  r.root.updateMatrixWorld(true);
  const mat = new THREE.MeshStandardMaterial({ map: decalTexture(), transparent: true, depthWrite: false, roughness: 0.55, metalness: 0, envMapIntensity: 0.5, color: 0xe8e8e8, polygonOffset: true, polygonOffsetFactor: -4 });
  const rootQ = new THREE.Quaternion(); r.root.getWorldQuaternion(rootQ);
  for (const z of [-0.078, 0.078]) {
    const o = V(0.4, 0.06, z).applyMatrix4(r.root.matrixWorld), d = V(-1, 0, 0).transformDirection(r.root.matrixWorld);
    const hit = new THREE.Raycaster(o, d, 0, 1).intersectObject(plate)[0]; if (!hit) continue;
    const inv = r.root.matrixWorld.clone().invert();
    const n = hit.face.normal.clone().transformDirection(plate.matrixWorld).transformDirection(inv);   // robot-local plate normal
    const right = V(0, 0, -1), up = n.clone().cross(right).normalize();                                  // text reads left-to-right from the front
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, n));
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(0.044, 0.022), mat);
    decal.receiveShadow = true;
    decal.position.copy(hit.point).addScaledVector(n.clone().transformDirection(r.root.matrixWorld), 0.0006);
    decal.quaternion.copy(rootQ).multiply(q);
    plate.parent.attach(decal);
  }
}

// ======================================================================= lights + volumetrics
function beamMesh() {
  const geo = new THREE.CylinderGeometry(0.001, 1, 1, 48, 1, true);
  geo.translate(0, -0.5, 0); // apex at origin, opening downwards along -Y
  const mat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(1, 0.9, 0.8) }, intensity: { value: 0 }, time: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 vW;
      void main(){ vY = -position.y; vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform vec3 color; uniform float intensity; uniform float time; varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 vW;
      void main(){ float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
        float fall = pow(1.0 - clamp(vY,0.,1.), 0.7) * smoothstep(0.0, 0.12, vY) * (0.35 + 0.65 * smoothstep(1.0, 0.55, vY));
        float n = 0.85 + 0.15*sin(vW.x*7.0 + vW.y*5.0 + time*0.6)*sin(vW.z*6.0 - time*0.4);
        gl_FragColor = vec4(color * intensity * edge * fall * n * 0.35, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false; m.renderOrder = 5;
  m.userData.volumetric = true;
  return m;
}
function addSpot(name, { color = 0xffffff, angle = 22, penumbra = 0.55, shadow = false, beam = false, decay = 2, dist = 14, power = 4, beamGain = 0.5 } = {}) {
  const l = new THREE.SpotLight(color, 0, dist, angle * DEG, penumbra, decay);
  l.userData.power = power; l.userData.beamGain = beamGain;
  l.castShadow = shadow;
  if (shadow) { l.shadow.mapSize.set(2048, 2048); l.shadow.bias = -0.0002; l.shadow.normalBias = 0.02; l.shadow.camera.near = 0.3; l.shadow.camera.far = 12; }
  scene.add(l); scene.add(l.target);
  l.userData.beam = beam ? beamMesh() : null;
  if (l.userData.beam) { scene.add(l.userData.beam); beams.push(l); }
  lights[name] = l;
  return l;
}
// level is an artistic 0..~1.5 value; power/beamGain convert it to light output and visible beam
function aim(l, pos, tgt, level, color) {
  l.position.copy(pos); l.target.position.copy(tgt);
  l.intensity = level * l.userData.power * 10; l.userData.level = level;
  if (color !== undefined) l.color.set(color);
  const b = l.userData.beam;
  if (b) {
    const dir = tgt.clone().sub(pos); const len = Math.min(dir.length() * 1.06, 6);
    b.position.copy(pos);
    b.quaternion.setFromUnitVectors(V(0, -1, 0), dir.normalize());
    const rad = Math.tan(l.angle) * len;
    b.scale.set(rad, len, rad);
    b.material.uniforms.intensity.value = level * l.userData.beamGain;
    b.material.uniforms.color.value.copy(l.color);
    b.visible = level > 0.001;
  }
}
function buildLights() {
  lights.amb = new THREE.HemisphereLight(0x8090b0, 0x050505, 0.06); scene.add(lights.amb);
  addSpot('key', { color: 0xfff1e0, angle: 16, penumbra: 0.7, shadow: true, beam: true, power: 1.9, beamGain: 0.28 });
  addSpot('rim', { color: 0xd4e0ff, angle: 18, penumbra: 0.9, shadow: false, beam: true, power: 1.6, beamGain: 0.14 });
  addSpot('rim2', { color: 0x9db4dc, angle: 30, penumbra: 0.8, shadow: false, beam: false, power: 1.4 });
  addSpot('fill', { color: 0xb4c4e0, angle: 40, penumbra: 1, shadow: false, power: 0.5 });
  for (let i = 0; i < 6; i++) addSpot(`ov${i}`, { color: 0xfff4e6, angle: 15, penumbra: 0.45, shadow: i < 2, beam: true, power: 2.2, beamGain: 0.3 });
}
function buildDust() {
  const N = 2600, pos = new Float32Array(N * 3), seedA = new Float32Array(N), bright = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 4.4; pos[i * 3 + 1] = Math.random() * 2.6; pos[i * 3 + 2] = (Math.random() - 0.5) * 4.4; seedA[i] = Math.random() * 100; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seedA, 1));
  g.setAttribute('bright', new THREE.BufferAttribute(bright, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, scale: { value: H * 0.5 } },
    vertexShader: `attribute float seed; attribute float bright; uniform float time; uniform float scale; varying float vB;
      void main(){ vec3 p = position + vec3(sin(time*0.13+seed)*0.06, sin(time*0.09+seed*1.7)*0.05, cos(time*0.11+seed*0.7)*0.06);
        vec4 mv = modelViewMatrix*vec4(p,1.); gl_Position = projectionMatrix*mv; gl_PointSize = clamp(scale*0.0016/ -mv.z, 1.0, 14.0); vB = bright; }`,
    fragmentShader: `varying float vB; void main(){ vec2 c = gl_PointCoord-0.5; float d = length(c); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vec3(1.0,0.93,0.82)*a*vB*0.9, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  dust = new THREE.Points(g, mat); dust.frustumCulled = false; dust.userData.volumetric = true; dust.renderOrder = 6;
  scene.add(dust);
}
function updateDust(t) {
  const p = dust.geometry.attributes.position.array, b = dust.geometry.attributes.bright.array;
  const act = beams.filter((l) => l.intensity > 0.01).map((l) => {
    const o = l.position, d = l.target.position;
    let ax = d.x - o.x, ay = d.y - o.y, az = d.z - o.z; const n = Math.hypot(ax, ay, az); ax /= n; ay /= n; az /= n;
    return [o.x, o.y, o.z, ax, ay, az, Math.tan(l.angle), Math.min(1, l.userData.level || 0)];
  });
  for (let i = 0; i < b.length; i++) {
    let s = 0.0;
    const px = p[i * 3], py = p[i * 3 + 1], pz = p[i * 3 + 2];
    for (const [ox, oy, oz, ax, ay, az, ta, k] of act) {
      const rx = px - ox, ry = py - oy, rz = pz - oz;
      const along = rx * ax + ry * ay + rz * az;
      if (along <= 0) continue;
      const qx = rx - ax * along, qy = ry - ay * along, qz = rz - az * along;
      const radial = Math.sqrt(qx * qx + qy * qy + qz * qz), rad = ta * along;
      if (radial < rad) s += (1 - radial / rad) * k;
    }
    b[i] = Math.min(1.5, s);
  }
  dust.geometry.attributes.bright.needsUpdate = true;
  dust.material.uniforms.time.value = t;
  for (const l of beams) l.userData.beam.material.uniforms.time.value = t;
}

// ======================================================================= post-processing
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, exposure: { value: 1 }, sat: { value: 0.96 }, contrast: { value: 1.12 }, shadowTint: { value: new THREE.Vector3(0.9, 0.99, 1.1) }, hiTint: { value: new THREE.Vector3(1.06, 1.0, 0.93) }, streak: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float exposure, sat, contrast, streak; uniform vec3 shadowTint, hiTint; varying vec2 vUv;
    vec3 bright(vec2 uv){ vec3 c = texture2D(tDiffuse, uv).rgb; float l = max(max(c.r,c.g),c.b); return c * smoothstep(3.0, 8.0, l); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb * exposure;
      // anamorphic streaks: wide horizontal smear of the brightest pixels, tinted blue
      vec3 s = vec3(0.); float wsum = 0.;
      for (int i = -20; i <= 20; i++) { float o = float(i)/20.; float w = exp(-o*o*3.); s += bright(vUv + vec2(o*0.22, 0.)) * w; wsum += w; }
      c += s / wsum * vec3(0.45, 0.65, 1.3) * streak;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, sat);
      float k = smoothstep(0.0, 1.2, l);
      c *= mix(shadowTint, hiTint, k);
      c = pow(max(c, 0.), vec3(contrast));
      gl_FragColor = vec4(c, 1.);
    }`,
};
function buildPost() {
  composer = new EffectComposer(renderer);
  composer.setPixelRatio(1); composer.setSize(W, H);
  composer.renderToScreen = false;
  composer.addPass(new RenderPass(scene, camera));
  bokeh = new BokehPass(scene, camera, { focus: 1.0, aperture: 0.002, maxblur: 0.012 });
  const bokehRender = bokeh.render.bind(bokeh);
  bokeh.render = (...a) => { const vol = []; scene.traverse((o) => { if (o.userData.volumetric && o.visible) { vol.push(o); o.visible = false; } }); bokehRender(...a); vol.forEach((o) => { o.visible = true; }); };
  composer.addPass(bokeh);
  bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.32, 0.45, 1.0);
  composer.addPass(bloom);
  grade = new ShaderPass(GradeShader); composer.addPass(grade);
  composer.addPass(new OutputPass());

  accRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType });
  quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const vs = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
  accMat = new THREE.ShaderMaterial({ uniforms: { tex: { value: null }, w: { value: 0.25 } }, vertexShader: vs,
    fragmentShader: `uniform sampler2D tex; uniform float w; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(tex, vUv).rgb * w, 1.); }`,
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true });
  presentMat = new THREE.ShaderMaterial({ uniforms: { tex: { value: null }, time: { value: 0 }, vig: { value: 0.42 }, grain: { value: 0.03 }, ca: { value: 0.0007 }, fade: { value: 0 }, flash: { value: 0 } }, vertexShader: vs,
    fragmentShader: `uniform sampler2D tex; uniform float time, vig, grain, ca, fade, flash; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + time*43.1) * 43758.5453); }
      void main(){ vec2 d = vUv - 0.5; float r = length(d*vec2(0.5625,1.));
        vec3 c; c.r = texture2D(tex, vUv - d*ca*4.).r; c.g = texture2D(tex, vUv).g; c.b = texture2D(tex, vUv + d*ca*4.).b;
        c *= 1.0 - vig * smoothstep(0.25, 0.75, r);
        c += (h(vUv*vec2(1080.,1920.)) - 0.5) * grain;
        c = mix(c, vec3(1.0, 0.98, 0.95), flash);
        c *= 1.0 - fade;
        gl_FragColor = vec4(c, 1.); }`,
    depthTest: false, depthWrite: false });
  quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), accMat);
  quadScene = new THREE.Scene(); quadScene.add(quad);
}

// ======================================================================= physics
function stepPhysics(n) {
  for (let i = 0; i < n; i++) {
    for (const b of sim.stationBodies) { b.resetForces(false); b.resetTorques(false); }
    for (const r of sim.robots) r.step(STEP);
    for (const s of ['red', 'blue']) sim.field.stations[s].step?.(STEP);
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
}
function syncVisuals() {
  coreLook();
  for (const r of sim.robots) { r.sync(); r.label.visible = false; }
  for (const c of game.cores) c.sync();
  for (const p of game.payloads) p.sync();
  for (const s of ['red', 'blue']) sim.field.stations[s].sync();
}

// ======================================================================= choreography helpers
const R = () => sim.robots;
function park(r, x, z, yaw) { r.teleport(x, z, yaw); r.cmd = { throttle: 0, turn: 0, arm: 0 }; }
function setArm(r, deg) { r.theta = r.thetaTarget = deg * DEG; r.updateMechColliders(); }
function openGrip(r) { r.releaseCore(false); r.gripClosed = false; r.finger = r.fingerTarget = ROBOT.fingerOpen; }
function fresh() { game.mode = 'match'; game.reset(); sim.robots.forEach((r) => { r.contacts = new Map(); r.pairContacts = new Map(); }); game.start(); }
const W3 = (r, x, y, z) => { const p = r.toWorld({ x, y, z }); return V(p.x, p.y, p.z); };
const lightsOff = () => { for (const k of Object.keys(lights)) if (lights[k].isSpotLight) aim(lights[k], lights[k].position, lights[k].target.position, 0); };

// ======================================================================= shots
// [name, start, end]
const SHOTS = [
  ['ignite', 0.0, 1.5], ['macro', 1.5, 2.5], ['launch', 2.5, 3.5], ['reveal', 3.5, 6.0], ['flyby', 6.0, 6.75],
  ['grab', 6.75, 7.75], ['lift', 7.75, 8.75], ['slowmo', 8.75, 11.0], ['station', 11.0, 13.5], ['arena', 13.5, 16.0], ['end', 16.0, 20.0],
  // edit-only shots
  ['spin', 20, 23], ['drift', 23, 26], ['duel', 26, 29], ['wheel', 29, 31.5], ['decal', 31.5, 34],
];
// remove staged COREs near an action spot (the new shots drive through the centre)
function clearArea(x, z, r) { for (const c of [...game.cores]) { const p = c.pos(); if (Math.hypot(p.x - x, p.z - z) < r) { sim.unregisterBody(c.body); c.destroy(); game.cores = game.cores.filter((k) => k !== c); } } }
const OV = [ // overhead stadium spots: position, aim
  [V(-1.3, 3.6, -1.3), V(-0.75, 0, -0.75)], [V(1.3, 3.6, 1.3), V(0.75, 0, 0.75)], [V(1.3, 3.6, -1.3), V(0.75, 0, -0.75)],
  [V(-1.3, 3.6, 1.3), V(-0.75, 0, 0.75)], [V(0, 3.9, -0.4), V(0, 0, -0.55)], [V(0, 3.9, 0.4), V(0, 0, 0.55)],
];
function stadium(t, on) { // on: array of 6 levels 0..1
  OV.forEach(([p, a], i) => aim(lights[`ov${i}`], p, a, (on[i] ?? 0)));
}
function leds(level) { for (const m of ledStrips) m.material.color.copy(m.userData.base).multiplyScalar(level); }

function enter(name) {
  const [r1, r2, b1, b2] = R();
  if (name === 'ignite') {
    fresh(); setArm(r1, 21.2);
  }
  if (name === 'reveal') fresh();
  if (name === 'grab') {
    fresh();
    S.gx = -0.95; S.gz = 0.95;
    setArm(r1, ROBOT.armMin); openGrip(r1);
    park(r1, S.gx, S.gz, 0);
    const h = r1.toWorld(r1.holdLocal());
    S.ring = game.addCore('red', 'red', { x: h.x, y: 0.0155, z: h.z });
    park(r2, wx(84), wz(6), -Math.PI / 2); park(b1, wx(84), wz(138), Math.PI / 2); park(b2, wx(60), wz(138), Math.PI / 2);
    S.grabbed = false;
  }
  if (name === 'slowmo') {
    fresh();
    S.px = 0; S.pz = wz(48);
    game.addCore('red', 'red', { x: S.px, y: 0.024, z: S.pz });
    game.addCore('red', 'red', { x: S.px, y: 0.056, z: S.pz });
    setArm(r1, 62);
    const hl = r1.holdLocal();
    park(r1, S.px, S.pz - hl.x, -Math.PI / 2);
    const c = game.addCore('red', 'red', r1.toWorld(hl));
    r1.finger = r1.fingerTarget = ROBOT.fingerOpen; r1.gripClosed = false;
    r1.attachCore(c); r1.gripClosed = true; r1.finger = r1.fingerTarget = ROBOT.fingerHold;
    S.ring3 = c; S.released = null; S.scored = null; S.landed = null; S.prevVy = undefined;
    park(r2, wx(84), wz(6), -Math.PI / 2);
  }
  if (name === 'station') {
    fresh(); game.time = 121;
    const st = sim.field.stations.red;
    setArm(r1, 12);
    park(r1, st.cx, 0.98, Math.PI / 2);
    r1.body.setLinvel({ x: 0, y: 0, z: -0.9 }, true);
    S.docked = null;
  }
  if (name === 'spin') { fresh(); clearArea(0, 0, 0.45); park(r1, 0, 0, 0.4); setArm(r1, 38); }
  if (name === 'drift') { fresh(); clearArea(-0.3, 0.1, 0.9); park(r1, -1.05, -0.25, 0); setArm(r1, 30); }
  if (name === 'duel') { fresh(); clearArea(0, 0, 0.8); park(r1, -0.66, 0, 0); park(b1, 0.66, 0, Math.PI); setArm(r1, 42); setArm(b1, 42); }
  if (name === 'wheel') { fresh(); clearArea(-0.3, 0, 0.9); park(r1, -1.05, 0, 0); setArm(r1, 24); }
  if (name === 'decal') { fresh(); clearArea(0, 0, 0.45); park(r1, 0, 0, 0); setArm(r1, 30); }
  if (name === 'arena') {
    fresh();
    const P = (sq, ty) => sim.field.poles.filter((p) => p.squad === sq && p.type === ty);
    P('red', 'high').slice(0, 2).forEach((p) => game.addCore('red', 'red', { x: p.x, y: 0.024, z: p.z }));
    P('blue', 'high').slice(0, 2).forEach((p) => game.addCore('blue', 'blue', { x: p.x, y: 0.024, z: p.z }));
    park(r1, wx(58), wz(30), -Math.PI / 2 + 0.25); park(r2, wx(100), wz(26), -Math.PI / 2 - 0.35);
    park(b1, wx(84), wz(114), Math.PI / 2 + 0.3); park(b2, wx(42), wz(118), Math.PI / 2 - 0.2);
    sim.robots.forEach((r) => setArm(r, 35));
  }
}

// per-frame: robot commands + time warp. returns sim-time scale for this frame
function direct(name, t, lt) {
  const [r1, r2, b1, b2] = R();
  let warp = 1;
  if (name === 'ignite') { r1.cmd = { throttle: 0, turn: 0, arm: 0 }; }
  if (name === 'macro') {
    r1.cmd = { throttle: 0, turn: 0, arm: lt > 0.45 && lt < 0.8 ? -0.6 : 0 };
    if (lt > 0.2 && r1.gripClosed && !S.macroOpened) { r1.toggleGrip(); S.macroOpened = true; events.push({ t, type: 'servo' }); }
  }
  if (name === 'launch') {
    r1.cmd = { throttle: lt > 0.12 ? 1 : 0, turn: 0, arm: 0 };
    if (lt > 0.12 && !S.launched) { S.launched = true; events.push({ t, type: 'launch' }); }
  }
  if (name === 'reveal') { for (const r of R()) r.cmd = { throttle: 0, turn: 0, arm: 0 }; }
  if (name === 'flyby') {
    if (!S.flySet) {
      S.flySet = true; fresh();
      park(r2, 0.305, -1.05, -Math.PI / 2); r2.body.setLinvel({ x: 0, y: 0, z: 1.65 }, true);
      setArm(r2, 28);
      events.push({ t, type: 'flyby' });
    }
    r2.cmd = { throttle: 1, turn: 0, arm: 0 };
  }
  if (name === 'grab') {
    r1.cmd = { throttle: 0, turn: 0, arm: 0 };
    if (lt > 0.42 && !S.grabbed) { r1.toggleGrip(); S.grabbed = !!r1.heldCore; events.push({ t, type: 'grip', ok: S.grabbed }); }
  }
  if (name === 'lift') { r1.cmd = { throttle: 0, turn: 0, arm: lt > 0.08 && lt < 0.62 ? 1 : 0 }; if (lt > 0.08 && !S.lifted) { S.lifted = true; events.push({ t, type: 'lift' }); } }
  if (name === 'slowmo') {
    r1.cmd = { throttle: 0, turn: 0, arm: 0 };
    if (lt > 0.45 && !S.released) { r1.toggleGrip(); S.released = t; events.push({ t, type: 'release' }); }
    if (S.released) {
      const k = t - S.released;
      warp = k < 0.08 ? lerp(1, 0.14, k / 0.08) : k < 1.25 ? 0.14 : k < 1.6 ? lerp(0.14, 1, (k - 1.25) / 0.35) : 1;
      // first contact of the falling core (sharp loss of downward speed) -> sound sync
      const vy = S.ring3.body.linvel().y;
      if (!S.landed && S.prevVy !== undefined && S.prevVy < -0.05 && vy > S.prevVy * 0.4) { S.landed = t - 0.5 / FPS; events.push({ t: S.landed, type: 'land' }); }
      S.prevVy = vy;
      if (!S.scored && S.ring3.scored === 'pole' && Math.abs(S.ring3.body.linvel().y) < 0.01 && k > 0.3) { S.scored = t; events.push({ t, type: 'score' }); }
      if (k > 1.7) r1.cmd.throttle = -0.18;
    } else warp = lt < 0.3 ? 1 : lerp(1, 0.7, (lt - 0.3) / 0.15);
  }
  if (name === 'station') {
    const z = r1.body.translation().z;
    r1.cmd = { throttle: z > 0.06 ? 0.8 : 0, turn: 0, arm: 0 };
    if (!S.docked && r1.stationState === 'dock') { S.docked = t; events.push({ t, type: 'dock' }); }
  }
  if (name === 'spin') r1.cmd = { throttle: 0, turn: lt > 0.05 ? 1 : 0, arm: 0 };
  if (name === 'drift') r1.cmd = { throttle: 1, turn: lt > 0.35 ? -0.6 : 0, arm: 0 };
  if (name === 'duel') {
    r1.cmd = { throttle: lt > 0.08 ? 1 : 0, turn: 0, arm: 0 }; b1.cmd = { throttle: lt > 0.08 ? 1 : 0, turn: 0, arm: 0 };
    if (!S.clash && game.robotsInContact(r1, b1)) { S.clash = t; events.push({ t, type: 'clash' }); }
  }
  if (name === 'wheel') r1.cmd = { throttle: lt > 0.12 ? 1 : 0, turn: 0, arm: 0 };
  if (name === 'decal') r1.cmd = { throttle: 0, turn: 0, arm: 0 };
  if (name === 'arena' || name === 'end') {
    const k = name === 'end' ? Math.max(0, 1 - (t - 16) / 1.2) : 1;
    r1.cmd = { throttle: 0.55 * k, turn: 0.2, arm: 0 };
    r2.cmd = { throttle: 0.5 * k, turn: -0.24, arm: 0 };
    b1.cmd = { throttle: 0.55 * k, turn: -0.17, arm: 0 };
    b2.cmd = { throttle: 0.48 * k, turn: 0.22, arm: 0 };
  }
  return warp;
}

// camera + lighting for a sample at time ts. returns {pos, tgt, fov, focus, aperture}
function cameraAndLights(name, ts, lt, dur) {
  const [r1, r2] = R();
  const u = lt / dur;
  let pos, tgt, fov = 36, fpt = null, ap = 0.004, shake = 0.0;
  lightsOff(); leds(0); lights.amb.intensity = 0.05;
  bloom.strength = 0.26; bloom.threshold = 1.4; grade.uniforms.streak.value = 0; grade.uniforms.exposure.value = 0.85;
  const keyOn = (p, tg, i, c) => aim(lights.key, p, tg, i, c);

  if (name === 'ignite') {
    const on = ts < 0.25 ? 0 : ts < 0.3 ? 1.6 : ts < 0.36 ? 0.4 : 1;   // relay snap + flicker
    const hp = W3(r1, 0.12, 0.08, 0);
    keyOn(V(hp.x - 0.15, 2.6, hp.z + 0.55), hp, 1.0 * on, 0xfff0dd);
    aim(lights.rim, V(hp.x + 0.35, 1.0, hp.z - 1.25), V(hp.x, 0.12, hp.z), 1.0 * on, 0xd4e0ff);
    aim(lights.fill, V(hp.x + 1.5, 0.6, hp.z + 1.2), hp, 1.0 * on, 0xb4c4e0);
    pos = W3(r1, lerp(1.15, 0.58, easeIO(u)), lerp(0.05, 0.075, u), lerp(0.18, 0.06, u));
    tgt = W3(r1, 0.12, 0.085, 0); fov = 34; fpt = W3(r1, 0.2, 0.09, 0); ap = 0.03; shake = 0.0015;
    grade.uniforms.exposure.value = ts < 0.25 ? 0 : 0.85;
  }
  if (name === 'macro') {
    const hp = W3(r1, 0.2, 0.1, 0);
    keyOn(V(hp.x - 0.4, 1.8, hp.z + 0.4), hp, 0.8, 0xfff0dd);
    aim(lights.rim, V(hp.x + 0.3, 0.8, hp.z - 1.2), hp, 0.9, 0xd4e0ff);
    aim(lights.fill, V(hp.x + 1.2, 0.5, hp.z + 0.8), hp, 1.0, 0xb4c4e0);
    // slow front-quarter push on the fingers; focus racks from the near finger to the gears
    pos = W3(r1, lerp(0.58, 0.52, easeIO(u)), lerp(0.125, 0.118, u), lerp(0.22, 0.17, easeIO(u)));
    tgt = W3(r1, 0.22, 0.1, 0); fov = 24;
    fpt = W3(r1, lerp(0.24, 0.19, easeIO((u - 0.2) / 0.6)), 0.1, lerp(0.03, 0.0, u)); ap = 0.007; shake = 0.0005;
  }
  if (name === 'launch') {
    const hp = W3(r1, 0.0, 0.06, -0.16);
    keyOn(V(hp.x - 0.6, 2.2, hp.z + 0.2), hp, 0.9, 0xfff0dd);
    aim(lights.rim, V(hp.x + 0.6, 0.7, hp.z + 1.4), hp, 0.8, 0xd4e0ff);
    if (!S.launchCam) S.launchCam = W3(r1, 0.32, 0.045, -0.45);
    pos = S.launchCam.clone();
    tgt = W3(r1, 0.09, 0.055, -0.16); fov = 40; fpt = W3(r1, 0.09, 0.055, -0.2); ap = 0.03; shake = 0.002;
  }
  if (name === 'reveal') {
    const k = (i) => (ts > 3.5 + i * 0.5 ? (ts < 3.5 + i * 0.5 + 0.05 ? 1.5 : 1) : 0);
    stadium(ts, [k(0), k(0), k(1), k(1), k(2), k(2)]);
    leds(ts > 5.0 ? (ts < 5.06 || (ts > 5.12 && ts < 5.16) ? 0.2 : 1) : 0);
    lights.amb.intensity = 0.05 + 0.1 * sat((ts - 4.5) / 1);
    pos = V(lerp(-2.5, -3.1, easeIO(u)), lerp(0.28, 2.9, easeIO(u)), lerp(2.6, 3.2, easeIO(u)));
    tgt = V(0, lerp(0.15, -0.35, easeIO(u)), 0); fov = lerp(40, 44, u); fpt = V(0, 0, 0); ap = 0.002; shake = 0.004;
    bloom.strength = 0.5;
  }
  if (name === 'flyby') {
    stadium(ts, [1, 1, 1, 1, 1, 1]); leds(1); lights.amb.intensity = 0.12;
    pos = V(0.035, 0.055, 0.12);
    const rp = W3(r2, 0.15, 0.08, 0);
    tgt = V(rp.x, 0.09, Math.min(rp.z, 0.05)); fov = 42; fpt = rp; ap = 0.02; shake = 0.003;
    aim(lights.rim, V(0.4, 0.5, 0.9), rp, 0.8, 0xd4e0ff);
  }
  if (name === 'grab') {
    const hp = W3(r1, 0.24, 0.02, 0);
    keyOn(V(hp.x - 0.3, 2.0, hp.z + 0.5), hp, 0.9, 0xfff0dd);
    aim(lights.rim, V(hp.x + 0.9, 0.5, hp.z - 0.9), hp, 1.0, 0xd4e0ff);
    aim(lights.fill, V(hp.x + 0.8, 0.4, hp.z + 1.0), hp, 1.0, 0xb4c4e0);
    pos = W3(r1, lerp(0.62, 0.5, easeIO(u)), lerp(0.06, 0.07, u), lerp(0.2, 0.12, u));
    tgt = W3(r1, 0.23, 0.002, 0); fov = 32; fpt = W3(r1, 0.24, 0.02, 0); ap = 0.035; shake = 0.001;
  }
  if (name === 'lift') {
    const hp = r1.toWorld(r1.holdLocal()); const hv = V(hp.x, hp.y, hp.z);
    keyOn(W3(r1, -0.35, 1.6, 0.5), hv, 0.5, 0xfff0dd);
    aim(lights.rim, W3(r1, 0.9, 1.3, -0.35), hv, 1.4, 0xffd6a0);   // backlight: ring silhouette + flare
    aim(lights.rim2, W3(r1, -0.2, 0.4, -1.0), hv, 0.8, 0x9db4dc);
    pos = W3(r1, 0.62, 0.025, -0.24); tgt = V(hv.x, hv.y + 0.02, hv.z); fov = 34; fpt = hv; ap = 0.03; shake = 0.0015;
    grade.uniforms.streak.value = 0.06;
  }
  if (name === 'slowmo') {
    const pv = V(S.px, 0.1, S.pz);
    keyOn(V(S.px + 0.5, 1.9, S.pz + 0.35), pv, 1.0, 0xfff0dd);
    aim(lights.rim, V(S.px - 0.5, 0.9, S.pz - 1.0), pv, 0.55, 0xd4e0ff);
    aim(lights.fill, V(S.px + 0.9, 0.3, S.pz + 0.6), pv, 1.0, 0xb4c4e0);
    const a = lerp(0.6, 1.05, easeIO(u));
    pos = V(S.px + Math.cos(a) * 0.52, lerp(0.2, 0.16, u), S.pz + Math.sin(a) * 0.52);
    tgt = V(S.px, 0.05, S.pz); fov = 32; fpt = V(S.px, 0.1, S.pz); ap = 0.03; shake = 0.0008;
    if (S.scored) { const k = ts - S.scored; bloom.strength = 0.32 + Math.max(0, 0.3 - k * 0.5); }
  }
  if (name === 'station') {
    const st = sim.field.stations.red; const rp = r1.body.translation();
    keyOn(V(st.cx + 1.6, 0.9, rp.z - 0.4), V(st.cx, 0.1, rp.z), 1.3, 0xfff0dd);    // low side key: long shadows
    aim(lights.rim, V(st.cx - 0.3, 1.8, rp.z + 1.4), V(st.cx, 0.1, rp.z), 0.9, 0xd4e0ff);
    stadium(ts, [0.25, 0, 0, 0.25, 0, 0]); leds(0.8); lights.amb.intensity = 0.08;
    pos = V(st.cx + lerp(1.25, 1.05, easeIO(u)), lerp(0.24, 0.42, easeIO(u)), rp.z - 0.62 + 0.12 * u);
    tgt = V(st.cx, 0.06, rp.z - 0.12); fov = 40; fpt = V(rp.x, 0.12, rp.z); ap = 0.02; shake = 0.002;
  }
  if (name === 'arena' || name === 'end') {
    const sweep = (i) => { const [p, a] = OV[i]; const o = 0.45 * Math.sin(ts * 0.9 + i * 1.7); return [p, V(a.x + o, 0, a.z + 0.4 * Math.cos(ts * 0.7 + i))]; };
    const lvl = name === 'end' ? lerp(1, 0.35, sat((ts - 16) / 2.5)) : 1;
    OV.forEach((_, i) => { const [p, a] = sweep(i); aim(lights[`ov${i}`], p, a, lvl); });
    leds(lvl); lights.amb.intensity = 0.12 * lvl;
    const T = ts - 13.5;
    const ang = 0.95 + T * 0.1;
    const rad = lerp(3.3, 4.6, sat((ts - 15.5) / 3));
    const hgt = lerp(3.0, 5.2, sat((ts - 15.5) / 3));
    pos = V(Math.cos(ang) * rad - 0.2, hgt, Math.sin(ang) * rad);
    tgt = V(0, -0.3, 0); fov = 44; fpt = V(0, 0, 0); ap = 0.0015; shake = 0.003;
    bloom.strength = 0.42;
  }
  if (name === 'spin') {
    const c = r1.body.translation(), pc = V(c.x, 0.085, c.z);
    keyOn(V(c.x - 0.5, 2.2, c.z + 0.6), pc, 0.85, 0xfff0dd);
    aim(lights.rim, V(c.x + 0.7, 0.9, c.z - 1.1), pc, 1.0, 0xd4e0ff);
    aim(lights.fill, V(c.x + 1.2, 0.5, c.z + 1.0), pc, 0.8, 0xb4c4e0);
    const a = 0.6 - lt * 0.9, Rr = lerp(0.68, 0.6, u);
    pos = V(c.x + Math.cos(a) * Rr, 0.065, c.z + Math.sin(a) * Rr); tgt = pc; fov = 36; fpt = pc; ap = 0.02; shake = 0.001;
  }
  if (name === 'drift') {
    const c = r1.body.translation(), pc = V(c.x, 0.08, c.z);
    stadium(ts, [0.5, 0.5, 0.5, 0.5, 0, 0]);
    keyOn(V(c.x, 2.4, c.z + 0.4), pc, 0.7, 0xfff0dd);
    aim(lights.rim, V(c.x + 0.4, 0.8, c.z - 1.2), pc, 0.9, 0xd4e0ff);
    pos = V(-0.05, 0.06, 0.32); tgt = pc; fov = 42; fpt = pc; ap = 0.012; shake = 0.002;
  }
  if (name === 'duel') {
    const a = r1.body.translation(), b = R()[2].body.translation(), mid = V((a.x + b.x) / 2, 0.08, (a.z + b.z) / 2);
    keyOn(V(mid.x, 2.4, mid.z + 0.3), mid, 0.9, 0xfff0dd);
    aim(lights.rim, V(mid.x, 0.9, mid.z - 1.3), mid, 1.1, 0xd4e0ff);
    aim(lights.fill, V(mid.x - 1.0, 0.4, mid.z + 1.0), mid, 0.6, 0xb4c4e0);
    pos = V(lerp(0.0, 0.03, u), 0.055, lerp(0.62, 0.5, easeIO(u))); tgt = V(mid.x, 0.085, mid.z); fov = 46; fpt = mid; ap = 0.008; shake = 0.002;
  }
  if (name === 'wheel') {
    const wp = W3(r1, 0.0925, 0.0565, -0.158);
    keyOn(W3(r1, 0.2, 1.8, -0.6), wp, 0.8, 0xfff0dd);
    aim(lights.rim, W3(r1, -0.9, 0.6, -0.5), wp, 1.1, 0xd4e0ff);
    pos = W3(r1, 0.21, 0.03, -0.33); tgt = W3(r1, 0.05, 0.05, -0.17); fov = 40; fpt = wp; ap = 0.02; shake = 0.0015;
  }
  if (name === 'decal') {
    const dp = W3(r1, 0.11, 0.06, -0.078);
    const sweep = lerp(-0.6, 0.6, easeIO(u));                      // a light sweeping across the plate
    keyOn(W3(r1, 0.7, 0.5, sweep), dp, 0.5, 0xfff0dd);
    aim(lights.rim, W3(r1, -0.6, 0.9, 0.4), dp, 0.8, 0xd4e0ff);
    pos = W3(r1, lerp(0.36, 0.31, easeIO(u)), 0.075, lerp(-0.2, -0.02, easeIO(u))); tgt = dp; fov = 28; fpt = dp; ap = 0.012; shake = 0.0006;
  }
  // handheld micro-movement
  if (shake) { pos = pos.clone().add(V(noise1(ts, 1) * shake, noise1(ts, 7) * shake, noise1(ts, 13) * shake)); }
  return { pos, tgt, fov, focus: fpt ? pos.distanceTo(fpt) : pos.distanceTo(tgt), aperture: ap };
}

// ======================================================================= overlay (titles)
function reveal(id, ts, t0, t1, { dIn = 0.45, dOut = 0.35 } = {}) {
  const el = $(id);
  if (ts < t0 || ts > t1) { el.style.opacity = 0; return 0; }
  const a = ease((ts - t0) / dIn), b = ease((t1 - ts) / dOut);
  el.style.opacity = Math.min(a, b);
  el.style.clipPath = `inset(0 ${(1 - a) * 50}% 0 ${(1 - a) * 50}%)`;
  el.style.filter = `blur(${(1 - a) * 10 + (1 - b) * 6}px)`;
  el.style.transform = `translateY(${(1 - b) * -20}px) scale(${1 + (1 - a) * 0.06})`;
  return Math.min(a, b);
}
function overlay(ts) {
  reveal('open', ts, 0.4, 2.35, { dIn: 0.55 });
  reveal('bug', ts, 2.5, 15.85, { dIn: 0.6, dOut: 0.4 });
  reveal('cap1', ts, 6.95, 8.6);
  reveal('cap2', ts, 9.05, 10.85);
  reveal('cap3', ts, 11.3, 13.35);
  reveal('cap4', ts, 13.8, 15.85);
  // title
  reveal('rule', ts, 4.55, 5.95, { dIn: 0.7 });
  const tk = reveal('title', ts, 4.5, 5.95, { dIn: 0.35 });
  reveal('sub', ts, 4.9, 5.95, { dIn: 0.6 });
  reveal('byline', ts, 5.15, 5.95, { dIn: 0.45 });
  $('glint').style.backgroundPosition = `${lerp(100, 0, sat((ts - 4.6) / 0.9))}% 0`;
  void tk;
  // score pop
  const pop = $('pop');
  if (S.scored && ts >= S.scored && ts < 11) {
    const k = ts - S.scored;
    const v = new THREE.Vector3(S.px, 0.17, S.pz).project(camera);
    const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
    pop.style.opacity = sat(Math.min(k / 0.1, (1.5 - k) / 0.4));
    pop.style.left = `${x - 110}px`; pop.style.top = `${Math.max(420, y - 230 - k * 50)}px`;
    pop.style.transform = `scale(${1 + Math.max(0, 0.5 - k * 2.5)})`; pop.style.filter = `blur(${Math.max(0, 0.3 - k) * 20}px)`;
  } else pop.style.opacity = 0;
  if (S.docked) reveal('badge', ts, Math.max(S.docked, 12.0), 13.35, { dIn: 0.25 }); else $('badge').style.opacity = 0;
  // end card
  reveal('endLogo', ts, 16.15, 21, { dIn: 0.4 });
  $('glint2').style.backgroundPosition = `${lerp(100, 0, sat((ts - 16.4) / 1.0))}% 0`;
  reveal('endSub', ts, 16.5, 21, { dIn: 0.5 });
  reveal('cta', ts, 16.85, 21, { dIn: 0.5 });
  const u = $('url'); u.style.left = '50%';
  const ku = reveal('url', ts, 17.2, 21, { dIn: 0.45 }); u.style.transform = `translateX(-50%) scale(${0.94 + 0.06 * ku})`; u.style.clipPath = 'none';
  reveal('bio', ts, 17.7, 21, { dIn: 0.5 });
  reveal('team', ts, 18.0, 21, { dIn: 0.55 });
}

// ======================================================================= frame
let current = null;
window.renderFrame = (f) => {
  const t0 = f / FPS;
  const shot = SHOTS.find(([, a, b]) => t0 >= a && t0 < b) || SHOTS[SHOTS.length - 1];
  const [name, start, end] = shot;
  if (name !== current) { current = name; S.launchCam = null; enter(name); }
  const warp = direct(name, t0, t0 - start);
  const frameSteps = Math.max(1, Math.round((8 * warp)));
  const shutterSteps = frameSteps * SHUTTER;
  // accumulate SAMPLES exposures over the open shutter
  renderer.setRenderTarget(accRT); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.setRenderTarget(null);
  let done = 0;
  for (let k = 0; k < SAMPLES; k++) {
    const target = Math.round((k / (SAMPLES - 1)) * shutterSteps);
    if (target > done) { stepPhysics(target - done); done = target; }
    const ts = t0 + (k / (SAMPLES - 1)) * SHUTTER / FPS;
    syncVisuals();
    const cam = cameraAndLights(name, ts, ts - start, end - start);
    camera.position.copy(cam.pos); camera.fov = cam.fov; camera.updateProjectionMatrix(); camera.lookAt(cam.tgt);
    camera.updateMatrixWorld();
    bokeh.uniforms.focus.value = cam.focus; bokeh.uniforms.aperture.value = cam.aperture; bokeh.uniforms.maxblur.value = 0.014;
    for (const s of ['red', 'blue']) sim.field.trifrons[s].group.rotation.y = ts * 0.4;
    updateDust(ts);
    composer.render();
    accMat.uniforms.tex.value = composer.readBuffer.texture; accMat.uniforms.w.value = 1 / SAMPLES;
    quad.material = accMat; renderer.setRenderTarget(accRT); renderer.autoClear = false; renderer.render(quadScene, quadCam); renderer.autoClear = true;
  }
  if (frameSteps > done) stepPhysics(frameSteps - done);
  game.update(frameSteps * STEP);
  // present
  presentMat.uniforms.tex.value = accRT.texture; presentMat.uniforms.time.value = t0;
  presentMat.uniforms.fade.value = t0 > 19.4 ? sat((t0 - 19.4) / 0.55) : 0;
  quad.material = presentMat; renderer.setRenderTarget(null); renderer.render(quadScene, quadCam);
  overlay(t0);
  return { t: t0, name };
};
window.cineEvents = events;

// ======================================================================= beat-synced edit (?edit)
// Cut list on a 125 BPM grid ("Believer", Imagine Dragons; the song is added in Instagram). b = start beat,
// shot + t = source in-point on the reel timeline, k = playback speed (chosen so key moments land on beats).
const BPM = 125, BEAT = 60 / BPM;
const bf = (b) => Math.round(b * BEAT * FPS);                     // beat -> output frame (rounded per beat: no drift)
const CUTS = [
  { b: 0, shot: 'ignite', t: 0.25, k: 1, hit: 1 },               // lights slam on with the first hit
  { b: 1, shot: 'macro', t: 1.70, k: 1 },                         // gripper servo fires on the beat
  { b: 2, shot: 'wheel', t: 29.05, k: 1.3 },
  { b: 3, shot: 'launch', t: 2.60, k: 1.2 },                      // wheels bite on the beat
  { b: 4, shot: 'flyby', t: 6.0, k: 0.78, hit: 1 },               // passes the lens on beat 6
  { b: 6, shot: 'spin', t: 20.25, k: 1 },
  { b: 7, shot: 'drift', t: 23.5, k: 1.15 },
  { b: 8, shot: 'reveal', t: 3.5, k: 0.5 / BEAT, hit: 1 },       // stadium light banks fire on beats 8 and 9
  { b: 10, shot: 'duel', t: 26.47, k: 1, hit: 1 },               // the two robots slam together on beat 10
  { b: 11, shot: 'decal', t: 31.6, k: 1.6 },                      // OVERDRIVE 009
  { b: 12, shot: 'grab', t: 7.2 - BEAT / 2, k: 1, hit: 1 },       // grip closes on the off-beat
  { b: 13, shot: 'lift', t: 7.84, k: 1 },
  { b: 14, shot: 'slowmo', t: 8.75 + 20 / FPS, k: 1 },           // slow-mo fall; the CORE lands on the pole on beat 15
  { b: 16, shot: 'station', t: 11.0, k: (11.729 - 11.0) / BEAT, hit: 1 },   // docks on beat 17
  { b: 18, shot: 'spin', t: 21.0, k: 1.2 },
  { b: 19, shot: 'duel', t: 26.6, k: 1.1 },
  { b: 20, shot: 'flyby', t: 6.25, k: 1.05, hit: 1 },
  { b: 21, shot: 'drift', t: 24.1, k: 1.3 },
  { b: 22, shot: 'wheel', t: 29.4, k: 1.6 },                       // half-beat burst into the hero shot
  { b: 22.5, shot: 'macro', t: 1.75, k: 1.4 },
  { b: 23, shot: 'spin', t: 21.6, k: 1.4 },
  { b: 23.5, shot: 'decal', t: 32.4, k: 2 },
  { b: 24, shot: 'arena', t: 13.6, k: 1.25, hit: 1 },              // hero: the whole field
  { b: 28, shot: 'end', t: 16.0, k: 1, hit: 1, card: 1 },          // end card: made by Overdrive 009, live at...
  { b: 32 },
];
const ROOT = { macro: 'ignite', launch: 'ignite', lift: 'grab', end: 'arena' };
window.EDIT_FRAMES = bf(32);
window.EDIT_BEATS = { bpm: BPM, cuts: CUTS.filter((c) => c.shot).map((c) => ({ b: c.b, frame: bf(c.b), shot: c.shot })) };
const editEvents = [];
window.editEvents = editEvents;
let editCut = -1, editT = 0, editShot = null;

// one frame of the reel pipeline at reel time t0 and playback speed k (render = false: physics only)
function pipeFrame(t0, k, render, fx) {
  const shot = SHOTS.find(([, a, b]) => t0 >= a && t0 < b) || SHOTS[SHOTS.length - 1];
  const [name, start, end] = shot;
  if (name !== editShot) { editShot = name; S.launchCam = null; enter(name); }
  const nEv = events.length;
  const warp = direct(name, t0, t0 - start);
  const frameSteps = Math.max(1, Math.round(8 * warp * k));
  if (!render) { stepPhysics(frameSteps); game.update(frameSteps * STEP); events.length = nEv; return; }
  const shutterSteps = frameSteps * SHUTTER;
  renderer.setRenderTarget(accRT); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.setRenderTarget(null);
  let done = 0;
  for (let s = 0; s < SAMPLES; s++) {
    const target = Math.round((s / (SAMPLES - 1)) * shutterSteps);
    if (target > done) { stepPhysics(target - done); done = target; }
    const ts = t0 + (s / (SAMPLES - 1)) * SHUTTER * k / FPS;
    syncVisuals();
    let cam = cameraAndLights(name, ts, ts - start, end - start);
    if (window.__cineLook) cam = window.__cineLook(name, ts, cam) || cam;   // other directors can relight a shot (promo/update.js)
    // beat hit: a quick zoom punch that relaxes over ~5 frames
    camera.position.copy(cam.pos); camera.fov = cam.fov * (1 - fx.punch); camera.updateProjectionMatrix(); camera.lookAt(cam.tgt);
    camera.updateMatrixWorld();
    if (fx.card) grade.uniforms.exposure.value *= 0.55;           // calm the background under the end card
    bokeh.uniforms.focus.value = cam.focus; bokeh.uniforms.aperture.value = cam.aperture; bokeh.uniforms.maxblur.value = 0.014;
    for (const sq of ['red', 'blue']) sim.field.trifrons[sq].group.rotation.y = ts * 0.4;
    updateDust(ts);
    composer.render();
    accMat.uniforms.tex.value = composer.readBuffer.texture; accMat.uniforms.w.value = 1 / SAMPLES;
    quad.material = accMat; renderer.setRenderTarget(accRT); renderer.autoClear = false; renderer.render(quadScene, quadCam); renderer.autoClear = true;
  }
  if (frameSteps > done) stepPhysics(frameSteps - done);
  game.update(frameSteps * STEP);
  for (let i = nEv; i < events.length; i++) editEvents.push({ ...events[i], out: fx.outT + (events[i].t - t0) / k });
  presentMat.uniforms.tex.value = accRT.texture; presentMat.uniforms.time.value = fx.outT;
  presentMat.uniforms.flash.value = fx.flash; presentMat.uniforms.fade.value = fx.fade;
  quad.material = presentMat; renderer.setRenderTarget(null); renderer.render(quadScene, quadCam);
}
// jump to a cut's in-point: replay its shot (and any shot it depends on) from the start without rendering
function seekCut(c) {
  for (const key of Object.keys(S)) if (key !== 'grain' && key !== 'coreGrain') delete S[key];   // keep the shared textures
  const root = ROOT[c.shot] || c.shot;
  editShot = null;
  let t = SHOTS.find((s) => s[0] === root)[1];
  while (c.t - t > 1e-6) { const step = Math.min(1 / FPS, c.t - t); pipeFrame(t, step * FPS, false); t += step; }
  editT = c.t;
}
window.renderEditFrame = (f) => {
  let i = CUTS.length - 2;
  while (i > 0 && f < bf(CUTS[i].b)) i--;
  const c = CUTS[i];
  if (i !== editCut) { editCut = i; seekCut(c); }
  const lf = f - bf(c.b);                                          // frame within the cut
  const outT = f / FPS;
  const punch = 0.075 * Math.max(0, 1 - lf / 5) * (c.hit ? 1.4 : 1);
  const flash = (c.hit ? 0.55 : 0.18) * Math.max(0, 1 - lf / (c.hit ? 4 : 2));
  const fade = f >= window.EDIT_FRAMES - 4 ? (f - (window.EDIT_FRAMES - 4)) / 4 : 0;
  pipeFrame(editT, c.k, true, { punch, flash, fade, outT, card: !!c.card });
  editT += c.k / FPS;
  overlayEdit(outT, c, lf);
  return { f, cut: i, shot: c.shot, t: editT };
};
function overlayEdit(outT, c, lf) {
  const card0 = bf(28) / FPS;
  const show = (id, t0, dIn) => { const el = $(id); const a = ease((outT - t0) / dIn); el.style.opacity = outT >= t0 ? a : 0; el.style.transform = `translateY(${(1 - a) * 24}px) scale(${1 + (1 - a) * 0.04})`; el.style.filter = `blur(${(1 - a) * 8}px)`; };
  show('eMade', card0, 0.16);                                      // on the downbeat
  show('eTeam', card0 + BEAT / 2, 0.16);                           // and the off-beat
  show('eLive', card0 + BEAT, 0.16);                               // next beat
  show('eUrl', card0 + BEAT * 1.5, 0.18);
  const u = $('eUrl'); u.style.transform = `translateX(-50%) ${u.style.transform}`;
}
boot();
