// The NRL competition venue: the Open Air Theatre at IIT Bombay as it was set up for the league, at golden hour.
// Two raised division fields side by side (ALPHA in magenta, BRAVO in blue) with black pipe railings, aluminium
// truss towers carrying moving-head lights, a camera riser between the fields, crowd barricades, a stage with an
// LED wall behind them, a horseshoe of concrete terraces full of teams, graffiti walls, trees, and the radiating
// pink / blue / white fabric canopy over the front terraces.
// The simulated field is ALPHA (at the origin); BRAVO is a visual copy. Purely visual: no colliders.
import * as THREE from 'three';
import { mergeGeometries } from '../lib/BufferGeometryUtils.js';
import { CANVAS_FONT, WALL, HALF } from './config.js';

export const PLATFORM = { h: 0.45, half: 3.353 };          // raised deck round each field (the CAD arena floor, 264 in square)
export const DIV_DX = 9.6;                                  // BRAVO field centre, metres along +x
const TOP = WALL.ground;                                    // deck height
const G = TOP - PLATFORM.h;                                 // courtyard ground
const MAGENTA = 0xe1258f, BLUE = 0x2457d6;

const rnd = (() => { let s = 20251206; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();   // repeatable layout
function canvasTex(w, h, draw, { repeat } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
const std = (o) => new THREE.MeshStandardMaterial(o);
const place = (geo, x, y, z, ry = 0) => { geo.rotateY(ry); geo.translate(x, y, z); return geo; };

// ---------------------------------------------------------------- daylight: sky dome, haze and a sky reflection map
export const SUN_DIR = new THREE.Vector3(-0.62, 0.42, -0.66).normalize();   // late afternoon, low over the main terraces
export function daylight(scene, renderer) {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(70, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x86acd6) }, mid: { value: new THREE.Color(0xcdd8e2) }, horizon: { value: new THREE.Color(0xeed9bd) }, sun: { value: SUN_DIR } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sun; varying vec3 vD;
      void main(){ float h = max(vD.y, 0.0); vec3 c = mix(horizon, mid, smoothstep(0.0, 0.18, h)); c = mix(c, top, smoothstep(0.18, 0.75, h));
        float s = max(dot(normalize(vD), sun), 0.0); c += vec3(1.0, 0.8, 0.55) * (pow(s, 32.0) * 0.5 + pow(s, 5.0) * 0.1);
        if (vD.y < 0.0) c = horizon * 0.8; gl_FragColor = vec4(c, 1.0); }`,
  }));
  sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);
  scene.background = new THREE.Color(0xdcd6cc);
  scene.fog = new THREE.Fog(0xdcd6cc, 26, 72);
  const env = new THREE.Scene();
  env.add(sky.clone());
  const gnd = new THREE.Mesh(new THREE.CircleGeometry(60, 24), new THREE.MeshBasicMaterial({ color: 0x8f877b })); gnd.rotation.x = -Math.PI / 2; gnd.position.y = -2; env.add(gnd);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(env, 0.02).texture; pm.dispose();
  scene.environmentIntensity = 0.8;
  return sky;
}

// ---------------------------------------------------------------- textures
function skirtTex(name, col) {
  return canvasTex(2048, 160, (g, w, h) => {
    g.fillStyle = `#${new THREE.Color(col).getHexString()}`; g.fillRect(0, 0, w, h);
    g.globalAlpha = 0.13; g.fillStyle = '#ffffff';
    for (let x = 0; x < w; x += 40) for (let y = 0; y < h; y += 40) if (((x + y) / 40) % 2 === 0) g.fillRect(x + 6, y + 6, 22, 22);
    g.globalAlpha = 1;
    g.fillStyle = '#ffffff'; g.font = `800 92px ${CANVAS_FONT}`; g.textBaseline = 'middle'; g.textAlign = 'right';
    g.fillText(name, w - 70, h / 2 + 6);
    g.font = `600 44px ${CANVAS_FONT}`; g.textAlign = 'left'; g.globalAlpha = 0.9; g.fillText('National Robotics League', 70, h / 2 + 4);
  });
}
const barricadeTex = () => canvasTex(256, 128, (g, w, h) => {
  g.clearRect(0, 0, w, h); g.fillStyle = '#17181b';
  g.fillRect(0, 0, w, 10); g.fillRect(0, h - 14, w, 14); g.fillRect(0, 0, 10, h); g.fillRect(w - 10, 0, 10, h);
  for (let x = 24; x < w - 10; x += 18) g.fillRect(x, 10, 5, h - 24);
});
const trussTex = () => canvasTex(128, 256, (g, w, h) => {
  g.clearRect(0, 0, w, h); g.strokeStyle = '#dde1e6'; g.lineCap = 'round';
  g.lineWidth = 12; g.beginPath(); g.moveTo(6, 0); g.lineTo(6, h); g.moveTo(w - 6, 0); g.lineTo(w - 6, h); g.stroke();
  g.lineWidth = 5; g.beginPath();
  for (let y = 0; y < h; y += 64) { g.moveTo(6, y); g.lineTo(w - 6, y + 32); g.lineTo(6, y + 64); g.moveTo(6, y); g.lineTo(w - 6, y); }
  g.stroke();
});
function muralTex() {
  return canvasTex(2048, 320, (g, w, h) => {
    g.fillStyle = '#e8e3d8'; g.fillRect(0, 0, w, h);
    const pal = ['#ff3e8e', '#2f7bff', '#ffd23e', '#21c7a8', '#ff6a1a', '#7a3cff', '#111318', '#f2f2f2', '#0fa3ff', '#ff4f4f'];
    for (let i = 0; i < 80; i++) {
      g.fillStyle = pal[(rnd() * pal.length) | 0]; const x = rnd() * w, y = rnd() * h, s = 30 + rnd() * 170, k = rnd();
      if (k < 0.35) { g.beginPath(); g.arc(x, y, s / 2, 0, Math.PI * 2); g.fill(); }
      else if (k < 0.7) g.fillRect(x, y, s * 1.4, s);
      else { g.beginPath(); g.moveTo(x, y); g.lineTo(x + s, y + s * 0.2); g.lineTo(x + s * 0.4, y + s); g.fill(); }
    }
    for (const x0 of [380, 1320]) for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#fff'; g.fillRect(x0 + i * 22, 40 + j * 22, 22, 22); }
    g.lineWidth = 9; g.lineCap = 'round';
    for (let i = 0; i < 26; i++) { g.strokeStyle = pal[(rnd() * pal.length) | 0]; g.beginPath(); const x = rnd() * w, y = rnd() * h; g.moveTo(x, y); g.bezierCurveTo(x + 60, y - 70, x + 140, y + 70, x + 220, y - 10); g.stroke(); }
    for (let i = 0; i < 9; i++) { g.fillStyle = i % 2 ? '#ff2f93' : '#2f6bff'; g.fillRect(120 + i * 220, 0, 56, 190); }   // hanging league banners
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, h - 26, w, 26);
  });
}

// Low-poly people, seated on the terraces or standing at the barricades. Each figure is three instanced meshes so
// shirts, trousers and skin get their own colours: shirt (torso, sleeves), legs (trousers, shoes), head (skin, hair).
function personParts(seated) {
  const hip = seated ? 0.36 : 0.84;
  // low-poly on purpose: the crowd is only ever seen from across the venue, and there are hundreds of them
  const torso = new THREE.CylinderGeometry(0.17, 0.14, 0.5, 7); torso.scale(1, 1, 0.6); torso.translate(0, hip + 0.27, 0);
  const shoulders = new THREE.CylinderGeometry(0.075, 0.075, 0.39, 6); shoulders.rotateZ(Math.PI / 2); shoulders.translate(0, hip + 0.5, 0);
  const arm = (sx) => {
    const g = new THREE.CylinderGeometry(0.045, 0.04, 0.5, 5);
    if (seated) { g.rotateX(-0.75); g.translate(sx * 0.2, hip + 0.3, 0.14); } else { g.rotateZ(sx * 0.08); g.translate(sx * 0.21, hip + 0.25, 0); }
    return g;
  };
  const shirt = mergeGeometries([torso, shoulders, arm(-1), arm(1)].map((g) => (g.index ? g.toNonIndexed() : g)));
  const legs = [];
  for (const sx of [-1, 1]) {
    if (seated) {
      legs.push(new THREE.CylinderGeometry(0.07, 0.065, 0.46, 5).rotateX(Math.PI / 2).translate(sx * 0.09, hip, 0.2));
      legs.push(new THREE.CylinderGeometry(0.06, 0.055, 0.42, 5).translate(sx * 0.09, 0.2, 0.4));
      legs.push(new THREE.BoxGeometry(0.1, 0.07, 0.2).translate(sx * 0.09, 0.035, 0.46));
    } else {
      legs.push(new THREE.CylinderGeometry(0.07, 0.06, 0.84, 5).translate(sx * 0.09, 0.46, 0));
      legs.push(new THREE.BoxGeometry(0.1, 0.07, 0.22).translate(sx * 0.09, 0.035, 0.04));
    }
  }
  legs.push(new THREE.CylinderGeometry(0.15, 0.15, 0.14, 7).scale(1, 1, 0.65).translate(0, hip + 0.02, 0));
  // head and neck: skin, with a darker cap of hair baked in as vertex colour
  const neck = new THREE.CylinderGeometry(0.045, 0.05, 0.08, 5, 1, true).translate(0, hip + 0.58, 0);
  const head = new THREE.SphereGeometry(0.1, 8, 6); head.scale(0.92, 1.08, 1).translate(0, hip + 0.7, 0.005);
  const hair = new THREE.SphereGeometry(0.104, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.52); hair.scale(0.93, 1.07, 1).rotateX(-0.25).translate(0, hip + 0.715, -0.008);
  const tint = (g, k) => { if (g.index) g = g.toNonIndexed(); g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(k), 3)); return g; };
  const headGeo = mergeGeometries([tint(neck, 1), tint(head, 1), tint(hair, 0.12)]);
  return { shirt, legs: mergeGeometries(legs.map((g) => (g.index ? g.toNonIndexed() : g))), head: headGeo };
}
const SHIRTS = [0x2aa6e8, 0xd23a3a, 0x16171c, 0xf0f0f0, 0x1f3f8f, 0xe85aa8, 0x2b2b30, 0x3a78c9, 0xffffff, 0x8a1d2a, 0x1c1c22, 0x2aa6e8];
const TROUSERS = [0x1d2230, 0x23262d, 0x2d3a55, 0x3b3f47, 0x14161b, 0x5a5348];
const SKIN = [0x8d5a3b, 0x6e4329, 0xa66f4c, 0x593621, 0xb98260, 0x7a4b30];
function people(root, list, seated, rnd) {
  const parts = personParts(seated);
  const make = (geo, mat, pal) => {
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    const c = new THREE.Color();
    for (let i = 0; i < list.length; i++) m.setColorAt(i, c.setHex(pal[(rnd() * pal.length) | 0]));
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(m); return m;
  };
  // Lambert, not PBR: hundreds of distant figures cost a lot of fragment shading on laptop GPUs and look the same
  const lam = (o) => new THREE.MeshLambertMaterial(o);
  const meshes = [make(parts.shirt, lam({}), SHIRTS), make(parts.legs, lam({}), TROUSERS), make(parts.head, lam({ vertexColors: true }), SKIN)];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const set = (i, x, y, z, ry, s) => { m4.compose(v.set(x, y, z), q.setFromEuler(e.set(0, ry, 0)), sc.set(s, s, s)); for (const m of meshes) m.setMatrixAt(i, m4); };
  list.forEach((p, i) => set(i, p.x, p.y, p.z, p.ry, p.s));
  return { meshes, set, done() { for (const m of meshes) m.instanceMatrix.needsUpdate = true; } };
}

// ---------------------------------------------------------------- the venue
export function buildArena(scene, { crowd = true } = {}) {
  const A = { group: new THREE.Group(), update: null };
  const root = A.group; root.name = 'arena'; scene.add(root);
  const concrete = std({ color: 0xc4baa9, roughness: 0.95 });
  const black = std({ color: 0x141518, roughness: 0.55, metalness: 0.3 });
  const alu = std({ color: 0xd4d8de, roughness: 0.35, metalness: 0.85 });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const CX = DIV_DX / 2;                                     // centre line between the two fields

  // courtyard floor
  const floorTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#a19a8e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2200; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},${(rnd() * 0.06).toFixed(3)})`; g.fillRect(rnd() * w, rnd() * h, 3 + rnd() * 9, 3 + rnd() * 9); }
    g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2; for (let p = 0; p <= w; p += 128) { g.beginPath(); g.moveTo(p, 0); g.lineTo(p, h); g.moveTo(0, p); g.lineTo(w, p); g.stroke(); }
  }, { repeat: [18, 18] });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(72, 72), std({ map: floorTex, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(CX, G, 0); ground.receiveShadow = true; root.add(ground);

  // ----- the two division platforms: printed skirt, deck edge, pipe railing, steps, speakers
  const P = PLATFORM.half;
  const railGeos = [], blackGeos = [];
  for (const [cx, name, col] of [[0, 'ALPHA', MAGENTA], [DIV_DX, 'BRAVO', BLUE]]) {
    const skirtMat = std({ map: skirtTex(name, col), roughness: 0.7 });
    for (const [x, z, ry] of [[cx, -P, Math.PI], [cx, P, 0], [cx - P, 0, -Math.PI / 2], [cx + P, 0, Math.PI / 2]]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(2 * P, PLATFORM.h), skirtMat); s.position.set(x, G + PLATFORM.h / 2, z); s.rotation.y = ry; root.add(s);
    }
    blackGeos.push(place(new THREE.BoxGeometry(2 * P + 0.04, 0.03, 2 * P + 0.04), cx, TOP - 0.016, 0));
    const H = 1.0, posts = [];
    const runs = [[-P, -P, -1.6, -P], [1.6, -P, P, -P], [-P, P, -1.6, P], [1.6, P, P, P], [-P, -P, -P, P], [P, -P, P, P]];
    for (const [x0, z0, x1, z1] of runs) {
      const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(z1 - z0, x1 - x0);
      for (const y of [H, H * 0.55]) { const bar = new THREE.CylinderGeometry(0.019, 0.019, len, 8); bar.rotateZ(Math.PI / 2); bar.rotateY(-ang); bar.translate(cx + (x0 + x1) / 2, TOP + y, (z0 + z1) / 2); railGeos.push(bar); }
      const n = Math.max(1, Math.round(len / 1.3));
      for (let i = 0; i <= n; i++) posts.push([cx + x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n]);
    }
    for (const [x, z] of posts) railGeos.push(place(new THREE.CylinderGeometry(0.024, 0.024, H, 8), x, TOP + H / 2, z));
    for (const sz of [-1, 1]) for (let i = 0; i < 2; i++) blackGeos.push(place(new THREE.BoxGeometry(2.6, PLATFORM.h * (i + 1) / 3, 0.32), cx, G + PLATFORM.h * (i + 1) / 6, sz * (P + 0.16 + (1 - i) * 0.32)));
    for (const sx of [-1, 1]) {
      blackGeos.push(place(new THREE.BoxGeometry(0.42, 0.62, 0.38), cx + sx * (P + 0.5), G + 1.75, -P - 0.4));
      railGeos.push(place(new THREE.CylinderGeometry(0.02, 0.02, 1.45, 6), cx + sx * (P + 0.5), G + 0.72, -P - 0.4));
    }
  }
  root.add(new THREE.Mesh(mergeGeometries(railGeos), black));

  // ----- camera riser between the fields with two broadcast cameras
  blackGeos.push(place(new THREE.BoxGeometry(2.0, 0.9, 1.6), CX, G + 0.45, -1.4));
  for (const dx of [-0.5, 0.5]) {
    blackGeos.push(place(new THREE.BoxGeometry(0.22, 0.16, 0.42), CX + dx, G + 2.25, -1.2));
    for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3; const leg = new THREE.CylinderGeometry(0.012, 0.012, 1.4, 5); leg.rotateX(0.18); leg.rotateY(a); leg.translate(CX + dx + Math.sin(a) * 0.12, G + 1.55, -1.2 + Math.cos(a) * 0.12); blackGeos.push(leg); }
  }

  // ----- crowd barricades round the competition area (gaps where teams come through)
  const bMat = std({ map: barricadeTex(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 });
  const bGeos = [];
  const bx0 = -P - 1.7, bx1 = DIV_DX + P + 1.7, bz0 = -P - 2.4, bz1 = P + 1.6;
  const fence = (x0, z0, x1, z1, gap) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.round(len / 2.2), ang = Math.atan2(z1 - z0, x1 - x0);
    for (let i = 0; i < n; i++) {
      if (gap && Math.abs(i - (n - 1) / 2) < 1) continue;
      const t = (i + 0.5) / n, p = new THREE.PlaneGeometry(len / n - 0.06, 1.1);
      p.rotateY(-ang); p.translate(x0 + (x1 - x0) * t, G + 0.6, z0 + (z1 - z0) * t); bGeos.push(p);
    }
  };
  fence(bx0, bz0, bx1, bz0, true); fence(bx0, bz0, bx0, bz1); fence(bx1, bz0, bx1, bz1);
  root.add(new THREE.Mesh(mergeGeometries(bGeos), bMat));

  // ----- aluminium truss towers with moving-head lights, a pair per field on the audience side
  const tTex = trussTex(); tTex.wrapT = THREE.RepeatWrapping;
  const tMat = std({ map: tTex, alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.85, roughness: 0.35 });
  const trussGeos = [], heads = [];
  const side4 = (L, build) => { for (let k = 0; k < 4; k++) { const p = new THREE.PlaneGeometry(0.3, L); const uv = p.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * L / 0.6); p.translate(0, 0, 0.15); p.rotateY(k * Math.PI / 2); build(p); trussGeos.push(p); } };
  for (const [cx, sx] of [[0, -1], [DIV_DX, 1]]) {                                  // outer corners only; the camera riser sits between the fields
    const x = cx + sx * (P + 1.1), z = -P - 1.0, H = 3.4;
    side4(H, (p) => p.translate(x, G + H / 2, z));
    for (const y of [G + H - 0.15, G + H - 1.4]) side4(2.2, (p) => { p.rotateZ(Math.PI / 2); p.translate(x, y, z); });
    for (let i = 0; i < 4; i++) heads.push([x - 0.85 + i * 0.57, G + H - 0.42, z, cx]);
  }
  root.add(new THREE.Mesh(mergeGeometries(trussGeos), tMat));
  const headGeo = mergeGeometries([new THREE.BoxGeometry(0.22, 0.08, 0.16).translate(0, 0.12, 0), new THREE.CylinderGeometry(0.1, 0.12, 0.26, 12).rotateX(Math.PI / 2)]);
  const headMesh = new THREE.InstancedMesh(headGeo, black, heads.length);
  const lens = new THREE.InstancedMesh(new THREE.CircleGeometry(0.085, 14), new THREE.MeshBasicMaterial({ color: 0xfff1d6, toneMapped: false }), heads.length);
  const flip = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0));
  heads.forEach(([x, y, z, cx], i) => {
    q.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(x, y, z), new THREE.Vector3(cx + (x - cx) * 0.2, TOP, 0.5), new THREE.Vector3(0, 1, 0)));
    m4.compose(v.set(x, y, z), q, one); headMesh.setMatrixAt(i, m4);
    const off = new THREE.Vector3(0, 0, -0.131).applyQuaternion(q); m4.compose(v.set(x, y, z).add(off), q.clone().multiply(flip), one); lens.setMatrixAt(i, m4);
  });
  root.add(headMesh, lens);

  // ----- the stage behind the fields: riser with banner, LED wall (live score), league screens, lighting rig
  const SZ = P + 4.6;
  blackGeos.push(place(new THREE.BoxGeometry(12.5, 1.0, 3.6), CX, G + 0.5, SZ + 1.8));
  const banner = canvasTex(2048, 160, (g, w, h) => {
    g.fillStyle = '#151022'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff'; g.font = `800 96px ${CANVAS_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('HYPERDRIVE  ·  NRL 2026', w / 2, h / 2 + 6);
    g.fillStyle = '#ff3ea0'; g.fillRect(0, h - 10, w / 2, 10); g.fillStyle = '#3d7bff'; g.fillRect(w / 2, h - 10, w / 2, 10);
  });
  const front = new THREE.Mesh(new THREE.PlaneGeometry(12.5, 1.0), std({ map: banner, roughness: 0.6, emissive: 0xffffff, emissiveMap: banner, emissiveIntensity: 0.2 }));
  front.position.set(CX, G + 0.5, SZ - 0.001); front.rotation.y = Math.PI; root.add(front);
  const screenCanvas = document.createElement('canvas'); screenCanvas.width = 1024; screenCanvas.height = 512;
  const screenTex = new THREE.CanvasTexture(screenCanvas); screenTex.colorSpace = THREE.SRGBColorSpace;
  blackGeos.push(place(new THREE.BoxGeometry(8.6, 4.5, 0.3), CX, G + 3.35, SZ + 3.3));
  const led = new THREE.Mesh(new THREE.PlaneGeometry(8.2, 4.1), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false, color: 0xe6e6e6 }));
  led.position.set(CX, G + 3.35, SZ + 3.14); led.rotation.y = Math.PI; root.add(led);
  const sideTex = canvasTex(256, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#5b1a86'); gr.addColorStop(1, '#2343b8'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = `800 40px ${CANVAS_FONT}`; g.textAlign = 'center'; g.fillText('NATIONAL', w / 2, h / 2 - 50); g.fillText('ROBOTICS', w / 2, h / 2); g.fillText('LEAGUE', w / 2, h / 2 + 50);
  });
  for (const sx of [-1, 1]) {
    blackGeos.push(place(new THREE.BoxGeometry(1.7, 3.4, 0.25), CX + sx * 5.6, G + 2.8, SZ + 3.2));
    const s = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 3.2), new THREE.MeshBasicMaterial({ map: sideTex, toneMapped: false, color: 0xdddddd }));
    s.position.set(CX + sx * 5.6, G + 2.8, SZ + 3.06); s.rotation.y = Math.PI; root.add(s);
  }
  for (const sx of [-1, 1]) blackGeos.push(place(new THREE.BoxGeometry(0.3, 6.4, 0.3), CX + sx * 6.6, G + 3.2, SZ + 1.8));
  blackGeos.push(place(new THREE.BoxGeometry(13.5, 0.3, 0.3), CX, G + 6.3, SZ + 0.6), place(new THREE.BoxGeometry(13.5, 0.3, 0.3), CX, G + 6.3, SZ + 3.0));
  for (let i = 0; i < 12; i++) blackGeos.push(place(new THREE.CylinderGeometry(0.09, 0.11, 0.24, 10), CX - 6 + i * 1.1, G + 6.0, SZ + 0.6));
  root.add(new THREE.Mesh(mergeGeometries(blackGeos), black));
  let shown = '';
  A.setScore = (red, blue, clock, phase) => {
    const key = `${red}|${blue}|${clock}|${phase}`; if (key === shown) return; shown = key;
    const g = screenCanvas.getContext('2d'), w = 1024, h = 512;
    g.fillStyle = '#f6f5f2'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e1258f'; g.fillRect(0, 0, w, 14);
    g.fillStyle = '#101018'; g.font = `700 40px ${CANVAS_FONT}`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('National Robotics League', 60, 70);
    g.textAlign = 'center';
    g.fillStyle = '#6b6f7a'; g.font = `600 30px ${CANVAS_FONT}`; g.fillText(phase || 'HYPERDRIVE', w / 2, 150);
    g.fillStyle = '#101018'; g.font = `800 110px ${CANVAS_FONT}`; g.fillText(clock || '2:30', w / 2, 250);
    g.font = `800 140px ${CANVAS_FONT}`; g.fillStyle = '#e0303f'; g.fillText(String(red ?? 0), w * 0.2, 380); g.fillStyle = '#2457d6'; g.fillText(String(blue ?? 0), w * 0.8, 380);
    g.fillStyle = '#e1258f'; g.font = `700 30px ${CANVAS_FONT}`; g.fillText('ALPHA DIVISION', w / 2, 466);
    screenTex.needsUpdate = true;
  };
  A.setScore(0, 0, '2:30', 'HYPERDRIVE');

  // ----- the Open Air Theatre terraces: a horseshoe of concrete steps around the floor, open towards the stage
  const TC = new THREE.Vector3(CX, 0, 0.6), R0 = 13.2, ROWS = 9, STEP_D = 0.85, STEP_H = 0.42;
  const A0 = 2.62, A1 = 2 * Math.PI + 0.52;                  // radians in the x-z plane (stage side at +z left open)
  const stepGeos = [], seats = [];
  for (let r = 0; r < ROWS; r++) {
    const ri = R0 + r * STEP_D, ro = ri + STEP_D, hgt = STEP_H * (r + 1);
    const shape = new THREE.Shape();
    const n = 64;
    for (let i = 0; i <= n; i++) { const a = A0 + (A1 - A0) * i / n; shape[i ? 'lineTo' : 'moveTo'](Math.cos(a) * ro, Math.sin(a) * ro); }
    for (let i = n; i >= 0; i--) { const a = A0 + (A1 - A0) * i / n; shape.lineTo(Math.cos(a) * ri, Math.sin(a) * ri); }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: hgt, bevelEnabled: false, curveSegments: 1 });
    geo.rotateX(Math.PI / 2); geo.translate(TC.x, G + hgt, TC.z);        // shape y becomes +z after the rotation
    stepGeos.push(geo);
    const rm = ri + STEP_D * 0.45, count = Math.floor((A1 - A0) * rm / 0.55);
    for (let i = 0; i < count; i++) {
      if (rnd() > 0.62 - r * 0.02) continue;
      const a = A0 + (A1 - A0) * (i + 0.5 + (rnd() - 0.5) * 0.3) / count;
      seats.push({ x: TC.x + Math.cos(a) * rm, y: G + hgt, z: TC.z + Math.sin(a) * rm, ry: -a - Math.PI / 2 });
    }
  }
  root.add(new THREE.Mesh(mergeGeometries(stepGeos.map((g) => (g.index ? g.toNonIndexed() : g))), concrete));
  // the back wall at the top of the terraces
  const back = new THREE.Shape(); const RB = R0 + ROWS * STEP_D;
  for (let i = 0; i <= 64; i++) { const a = A0 + (A1 - A0) * i / 64; back[i ? 'lineTo' : 'moveTo'](Math.cos(a) * (RB + 0.3), Math.sin(a) * (RB + 0.3)); }
  for (let i = 64; i >= 0; i--) { const a = A0 + (A1 - A0) * i / 64; back.lineTo(Math.cos(a) * RB, Math.sin(a) * RB); }
  const backGeo = new THREE.ExtrudeGeometry(back, { depth: STEP_H * ROWS + 1.1, bevelEnabled: false, curveSegments: 1 });
  backGeo.rotateX(Math.PI / 2); backGeo.translate(TC.x, G + STEP_H * ROWS + 1.1, TC.z);
  root.add(new THREE.Mesh(backGeo, concrete));

  // ----- graffiti walls flanking the stage, the building behind it, trees all round
  const mural = muralTex();
  const wallMat = [concrete, concrete, concrete, concrete, std({ map: mural, roughness: 0.9 }), concrete];
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(9.5, 3.4, 0.3), wallMat);
    m.position.set(CX + sx * 11.4, G + 1.7, SZ + 2.4); m.rotation.y = Math.PI + sx * 0.32; root.add(m);
  }
  const wallB = new THREE.Mesh(new THREE.BoxGeometry(14, 3.4, 0.3), wallMat); wallB.position.set(CX, G + 1.7, SZ + 6.2); wallB.rotation.y = Math.PI; root.add(wallB);
  const bld = new THREE.Mesh(new THREE.BoxGeometry(18, 7, 6), std({ color: 0xd9d3c5, roughness: 0.9 })); bld.position.set(CX + 4, G + 3.5, SZ + 11); root.add(bld);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(19, 0.3, 7), std({ color: 0x5e8c79, roughness: 0.8 })); roof.position.set(CX + 4, G + 7.1, SZ + 11); root.add(roof);
  const trees = [];
  for (let i = 0; i < 34; i++) { const a = rnd() * Math.PI * 2, r = RB + 5 + rnd() * 9; trees.push([TC.x + Math.cos(a) * r, TC.z + Math.sin(a) * r, 0.8 + rnd() * 0.7]); }
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.4, 5, 7), std({ color: 0x4a3a2c, roughness: 1 }), trees.length);
  const crownGeo = mergeGeometries([new THREE.IcosahedronGeometry(2.6, 1), new THREE.IcosahedronGeometry(2.1, 1).translate(1.8, -0.4, 0.6), new THREE.IcosahedronGeometry(2.0, 1).translate(-1.7, -0.2, -0.8)]);
  const crown = new THREE.InstancedMesh(crownGeo, std({ color: 0xffffff, roughness: 0.95, flatShading: true }), trees.length);
  const tc = new THREE.Color();
  trees.forEach(([x, z, s], i) => {
    const base = G + STEP_H * ROWS;
    m4.compose(v.set(x, base + 2.5 * s, z), q.identity(), new THREE.Vector3(s, s, s)); trunk.setMatrixAt(i, m4);
    m4.compose(v.set(x, base + 6.2 * s, z), q.setFromEuler(e.set(0, rnd() * 6, 0)), new THREE.Vector3(s * 1.2, s, s * 1.2)); crown.setMatrixAt(i, m4);
    crown.setColorAt(i, tc.setHSL(0.26 + rnd() * 0.06, 0.38, 0.2 + rnd() * 0.1));
  });
  root.add(trunk, crown);

  // ----- the fabric canopy: strips radiating from a hub over the front terraces
  const hub = new THREE.Vector3(CX, G + 8.0, TC.z - R0 - 3.5);
  const strips = 30, cols = [0xff2fa3, 0x1e8fff, 0xffffff], canopy = [];
  for (let i = 0; i < strips; i++) {
    const a = (i / strips) * Math.PI * 2;
    const end = new THREE.Vector3(hub.x + Math.cos(a) * 15, G + 5.0, hub.z + Math.sin(a) * 10);
    if (end.z > bz0 - 0.6) end.z = bz0 - 0.6;                                            // keep the fields' sky clear
    const seg = 18, pos = [], idx = [];
    const dir = new THREE.Vector3().subVectors(end, hub).setY(0).normalize(), sd = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let k = 0; k <= seg; k++) {
      const t = k / seg, c = new THREE.Vector3().lerpVectors(hub, end, t); c.y -= Math.sin(Math.PI * t) * 1.2;
      const wd = 0.12 + 1.3 * t;
      for (const s of [-1, 1]) pos.push(c.x + sd.x * wd * s / 2, c.y, c.z + sd.z * wd * s / 2);
      if (k < seg) { const b = k * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    const col = new THREE.Color(cols[i % 3]); geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.length).map((_, j) => [col.r, col.g, col.b][j % 3]), 3));
    canopy.push(geo);
  }
  const canopyMesh = new THREE.Mesh(mergeGeometries(canopy), std({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85, emissive: 0x2a1f2a, emissiveIntensity: 0.35 }));
  root.add(canopyMesh);
  root.add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 8.0, 8), alu).translateX(hub.x).translateY(G + 4.0).translateZ(hub.z));

  // ----- crowd: teams on the terraces, more standing at the barricades
  let standing = null;
  if (crowd) {
    people(root, seats.map((p) => ({ ...p, ry: p.ry + (rnd() - 0.5) * 0.3, s: 0.94 + rnd() * 0.12 })), true, rnd);
    const stand = [];
    for (let x = bx0 + 0.4; x < bx1 - 0.4; x += 0.48) for (const row of [0, 1]) if (rnd() < 0.7 - row * 0.25) stand.push({ x: x + (rnd() - 0.5) * 0.2, y: G, z: bz0 - 0.45 - row * 0.55 - rnd() * 0.2, ry: (rnd() - 0.5) * 0.8, s: 0.9 + rnd() * 0.18 });
    for (let z = bz0 + 0.4; z < bz1; z += 0.6) if (rnd() < 0.45) stand.push({ x: bx1 + 0.5 + rnd() * 0.4, y: G, z, ry: -Math.PI / 2 + (rnd() - 0.5) * 0.6, s: 0.9 + rnd() * 0.18 });
    standing = people(root, stand, false, rnd);
    A.standBase = stand;
  }

  // ----- per frame: the standing crowd bounces when something is scored
  A.excite = 0;
  let t = 0, acc = 0;
  A.update = (dt) => {
    t += dt; A.excite = Math.max(0, A.excite - dt * 0.4); acc += dt;
    if (!standing || acc < 1 / 30 || A.excite < 0.01) return;
    acc = 0;
    A.standBase.forEach((p, i) => standing.set(i, p.x, G + Math.max(0, Math.sin(t * 9 + i * 1.7)) * 0.07 * A.excite, p.z, p.ry, p.s));
    standing.done();
  };
  A.setBeams = (on) => { canopyMesh.visible = on; };          // a straight-down view would look through the canopy: hide it there
  return A;
}

// a visual copy of the simulated field for the second division (static: stations at rest, no physics)
export function cloneDivision(scene, objects) {
  const g = new THREE.Group(); g.name = 'bravo'; g.position.x = DIV_DX;
  for (const o of objects) g.add(o.clone(true));
  scene.add(g);
  return g;
}

// The simulator's home shot: your robot on its plinth in the red Driver Area, the field and the venue behind it.
// Shared with the landing page so its hand-off into the simulator lands on exactly this frame.
export const HERO = new THREE.Vector3(0, WALL.ground, -HALF - 0.92);
export function homeShot(w, h, t, filmGauge = 35) {
  const portrait = h > w * 1.05, wide = w >= 860;
  const a = -Math.PI / 2 + 0.42 + Math.sin(t * 0.11) * 0.1;
  const dist = portrait ? 2.0 : 1.5, up = portrait ? 0.95 : 0.62 + Math.sin(t * 0.07) * 0.04;
  const fov = portrait ? 44 : 32;
  return {
    pos: [HERO.x + Math.cos(a) * dist, HERO.y + up, HERO.z + Math.sin(a) * dist],
    tgt: [HERO.x - 0.02, HERO.y + (portrait ? -0.12 : 0.16), HERO.z + 0.25],
    fov,
    // wide screens: shift the lens so the robot sits to the right of the menu column
    film: wide ? -0.2 * filmGauge * 2 * Math.tan(fov * Math.PI / 360) * Math.min(w / Math.max(1, h), 2.2) : 0,
  };
}
export const HERO_YAW = -Math.PI / 2 + 0.62;

// The home-screen plinth: a dark disc with a thin orange ring
export function buildPlinth() {
  // a low graphite turntable with a chamfered lip, hairline scale and one accent index mark at the front
  const g = new THREE.Group();
  const prof = [[0, 0], [0.315, 0], [0.315, 0.036], [0.303, 0.05], [0, 0.05]].map(([x, y]) => new THREE.Vector2(x, y));
  const disc = new THREE.Mesh(new THREE.LatheGeometry(prof, 96), new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.62, metalness: 0.35 }));
  disc.receiveShadow = true; disc.castShadow = true; g.add(disc);
  const line = new THREE.Mesh(new THREE.RingGeometry(0.2885, 0.2905, 128), new THREE.MeshBasicMaterial({ color: 0xd9d2c4, transparent: true, opacity: 0.45 }));
  line.rotation.x = -Math.PI / 2; line.position.y = 0.0503; g.add(line);
  const ticks = new THREE.Group();
  const tickMat = new THREE.MeshBasicMaterial({ color: 0xd9d2c4, transparent: true, opacity: 0.28 });
  for (let i = 0; i < 72; i++) {
    const tk = new THREE.Mesh(new THREE.PlaneGeometry(0.0018, i % 6 ? 0.008 : 0.016), tickMat);
    const a = i / 72 * Math.PI * 2; tk.rotation.x = -Math.PI / 2; tk.rotation.z = -a + Math.PI / 2;
    tk.position.set(Math.cos(a) * (i % 6 ? 0.282 : 0.278), 0.0504, Math.sin(a) * (i % 6 ? 0.282 : 0.278)); ticks.add(tk);
  }
  g.add(ticks);
  const index = new THREE.Mesh(new THREE.PlaneGeometry(0.004, 0.022), new THREE.MeshBasicMaterial({ color: 0xe2531b }));
  index.rotation.x = -Math.PI / 2; index.position.set(0, 0.0505, 0.299); g.add(index);
  g.userData.ticks = ticks;
  return g;
}
