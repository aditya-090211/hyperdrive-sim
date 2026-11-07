// HYPERDRIVE ad: a 20 s, 1080x1920 high-energy reel cut to a 127 BPM grid ("Tokyo Drift (Fast & Furious)",
// Teriyaki Boyz, added in Instagram starting at 0:11.4, the "I wonder if you know..." hook). Built on the cinematic pipeline in cine.js (film lighting, accumulated motion
// blur, the real simulator's physics shots) plus 3D morphs: a particle swarm that builds the robot, a scan reveal
// from particles to metal, an exploded CAD view that slams back together, a robot -> CORE ring -> logo morph, and
// the whole arena dissolving into the end-card logo.
import * as THREE from 'three';

const BPM = 127, BEAT = 60 / BPM;
const FPS = 30, W = 1080, H = 1920, TOTAL = 600;          // 20.0 s
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
const B = (b) => b * BEAT;                                 // beat -> seconds
const noise1 = (t, s = 0) => Math.sin(t * 1.7 + s) * 0.5 + Math.sin(t * 2.9 + s * 1.3) * 0.3 + Math.sin(t * 5.3 + s * 2.1) * 0.2;

// own PRNG so cine.js's seeded choreography is untouched
let sd = 90210; const rnd = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };

// ---------------------------------------------------------------- the cut list (b = start beat)
// sim shots reuse cine.js's physics shots: shot + t = source in-point, k = playback speed
const CUTS = [
  { b: 0, c: 'swarm' },                                   // particles converge into the robot
  { b: 3, c: 'scan' },                                     // particles -> metal, bottom to top
  { b: 4, shot: 'macro', t: 1.70, k: 1, hit: 1 },          // gripper servo fires on the beat
  { b: 5, shot: 'wheel', t: 29.05, k: 1.3 },
  { b: 6, c: 'explode', hit: 1 },                          // CAD parts blast apart, slam back on 7.75
  { b: 8, shot: 'launch', t: 2.60, k: 1.2, hit: 1 },
  { b: 9, shot: 'flyby', t: 6.0, k: 0.749 / (2 * BEAT) },                // passes the lens on beat 11
  { b: 11, shot: 'drift', t: 23.5, k: 1.15 },
  { b: 12, shot: 'reveal', t: 3.5, k: 0.5 / BEAT, hit: 1 }, // stadium light banks on beats 12 and 13
  { b: 14, c: 'ring' },                                    // robot -> CORE ring, dolly through it
  { b: 16, c: 'logo', hit: 2 },                            // DROP: the logo implodes out of the ring
  { b: 18, shot: 'duel', t: 26.47, k: 1, hit: 1 },         // robots collide on the beat
  { b: 19, shot: 'grab', t: 7.17 - BEAT / 2, k: 1 },       // grip closes on 19.5
  { b: 20, shot: 'lift', t: 7.84, k: 1 },
  { b: 21, shot: 'slowmo', t: 8.75 + 20 / FPS, k: 1 },     // slow-mo CORE lands on the pole on 22
  { b: 24, shot: 'station', t: 11.0, k: (11.729 - 11.0) / BEAT, hit: 1 },  // docks on 25
  { b: 26, shot: 'spin', t: 21.0, k: 1.2 },
  { b: 26.5, shot: 'duel', t: 26.6, k: 1.1 },
  { b: 27, shot: 'wheel', t: 29.4, k: 1.6 },
  { b: 27.5, shot: 'decal', t: 32.4, k: 2 },
  { b: 28, shot: 'arena', t: 13.6, k: 1.25, hit: 1 },      // the whole field, light banks on every beat
  { b: 32, c: 'dissolve', hit: 1 },                        // the arena dissolves and swirls into the logo
  { b: 35, c: 'end', hit: 1 },
  { b: TOTAL / FPS / BEAT },
];

let C, sim, game, scene, camera, renderer;
const P = {};          // particles
const L = {};          // logo
const scan = { uCut: { value: 10 }, uBand: { value: 0.035 } };
let explodeParts = [];
let hidden = null;
let lastCam = null;
const adEvents = [];

// ======================================================================= init
async function init() {
  while (!window.__cine || !window.cineReady) await new Promise((r) => setTimeout(r, 50));
  C = window.__cine; sim = C.sim; game = C.game; scene = C.scene; camera = C.camera; renderer = C.renderer;
  await document.fonts.load('900 100px "Inter Tight"'); await document.fonts.load('200 100px "Inter Tight"'); await document.fonts.load('800 100px "Inter Tight"');
  buildParticles();
  buildLogo();
  scanShader(sim.robots[0]);
  buildExplode(sim.robots[0]);
  buildPresent();
  window.adReady = true;
}

// ---------------------------------------------------------------- particles
const N = 64000;
function buildParticles() {
  const g = new THREE.BufferGeometry();
  const f32 = (k) => new Float32Array(N * k);
  P.from = f32(3); P.to = f32(3); P.cA = f32(3); P.cB = f32(3); P.r = f32(4);
  for (let i = 0; i < N; i++) { P.r[i * 4] = rnd(); P.r[i * 4 + 1] = rnd(); P.r[i * 4 + 2] = rnd(); P.r[i * 4 + 3] = 0.55 + rnd() * 0.9; }
  g.setAttribute('position', new THREE.BufferAttribute(P.to, 3));
  g.setAttribute('aFrom', new THREE.BufferAttribute(P.from, 3));
  g.setAttribute('aTo', new THREE.BufferAttribute(P.to, 3));
  g.setAttribute('aCA', new THREE.BufferAttribute(P.cA, 3));
  g.setAttribute('aCB', new THREE.BufferAttribute(P.cB, 3));
  g.setAttribute('aR', new THREE.BufferAttribute(P.r, 4));
  const u = P.u = {
    uP: { value: 0 }, uVMid: { value: 0 }, uSpread: { value: 0.4 }, uSwirl: { value: 0 }, uVortex: { value: 0 }, uCenter: { value: V(0, 0.1, 0) },
    uTime: { value: 0 }, uSize: { value: 0.0026 }, uScale: { value: H * 0.5 }, uAlpha: { value: 1 }, uGain: { value: 0.5 }, uCut: { value: -10 },
    uFromM: { value: new THREE.Matrix4() }, uToM: { value: new THREE.Matrix4() }, uBurst: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: `attribute vec3 aFrom; attribute vec3 aTo; attribute vec3 aCA; attribute vec3 aCB; attribute vec4 aR;
      uniform float uP, uSpread, uSwirl, uVortex, uVMid, uTime, uSize, uScale, uAlpha, uCut, uBurst; uniform vec3 uCenter; uniform mat4 uFromM, uToM;
      varying vec3 vC; varying float vA;
      float e3(float x){ x = clamp(x, 0., 1.); return x < .5 ? 4.*x*x*x : 1. - pow(-2.*x + 2., 3.) / 2.; }
      void main(){
        float q = e3((uP - aR.x * uSpread) / (1. - uSpread));
        vec3 a = (uFromM * vec4(aFrom, 1.)).xyz, b = (uToM * vec4(aTo, 1.)).xyz;
        vec3 p = mix(a, b, q);
        float mid = sin(3.14159 * q);
        vec3 d = p - uCenter;
        float ang = uVortex * mix(1. - q, mid, uVMid) * (0.55 + aR.y);
        float cs = cos(ang), sn = sin(ang);
        d.xz = vec2(cs * d.x - sn * d.z, sn * d.x + cs * d.z);
        p = uCenter + d;
        float ph = aR.z * 6.2832;
        p += vec3(sin(uTime * 1.9 + ph * 3.1), cos(uTime * 1.6 + ph * 2.3), sin(uTime * 1.3 + ph * 1.7)) * uSwirl * (mid + 0.12) * (0.4 + aR.y);
        p += normalize(d + vec3(0.0001)) * uBurst * (0.3 + aR.y) * (1. - q);
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
const WHITE = [1.0, 0.97, 0.92];
function setPair(fromFn, toFn) {
  fromFn(P.from, P.cA); toFn(P.to, P.cB);
  for (const k of ['aFrom', 'aTo', 'aCA', 'aCB']) P.geo.attributes[k].needsUpdate = true;
  P.u.uFromM.value.identity(); P.u.uToM.value.identity();
}
const fillColor = (cols, c) => { for (let i = 0; i < N; i++) cols.set(c, i * 3); };
// area-weighted surface samples of every mesh under `roots` (world space), coloured by material
function surfaceSampler(roots) {
  const tris = []; let total = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || !o.visible || !o.geometry?.attributes?.position) return;
      let vis = true; for (let p = o; p; p = p.parent) if (!p.visible) vis = false;
      if (!vis) return;
      const pos = o.geometry.attributes.position, idx = o.geometry.index;
      const n = idx ? idx.count / 3 : pos.count / 3;
      const m = [].concat(o.material)[0];
      const col = m.color ? m.color.clone() : new THREE.Color(1, 1, 1);
      for (let t = 0; t < n; t++) {
        const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
        const area = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
        if (area <= 0) continue;
        total += area;
        tris.push([total, a.clone(), b.clone(), c.clone(), col]);
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
      // additive particles: lift dark CAD colours towards silver so the shape reads
      cols[i * 3] = 0.35 + 0.65 * Math.min(1, col.r * 1.4); cols[i * 3 + 1] = 0.35 + 0.65 * Math.min(1, col.g * 1.4); cols[i * 3 + 2] = 0.37 + 0.63 * Math.min(1, col.b * 1.4);
    }
  };
}
const robotTarget = (r) => (out, cols) => { surfaceSampler([r.root])(out, cols, 0, N); };
function shellTarget(center, r0, r1, flat = 1) {
  return (out, cols) => {
    for (let i = 0; i < N; i++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u), r = lerp(r0, r1, Math.pow(rnd(), 0.6));
      out[i * 3] = center.x + Math.cos(th) * s * r; out[i * 3 + 1] = center.y + u * r * flat; out[i * 3 + 2] = center.z + Math.sin(th) * s * r;
    }
    fillColor(cols, WHITE);
  };
}
// a CORE ring (95/55 mm proportions) of radius R about the origin, axis = +z
function ringTarget(R) {
  const rOut = R, rIn = R * 55 / 95, h = R * 30 / 95 * 1.6;
  return (out, cols) => {
    for (let i = 0; i < N; i++) {
      const th = rnd() * Math.PI * 2, k = rnd();
      let rr, z;
      if (k < 0.34) { rr = rOut; z = (rnd() - 0.5) * h; }
      else if (k < 0.6) { rr = rIn; z = (rnd() - 0.5) * h; }
      else { rr = Math.sqrt(lerp(rIn * rIn, rOut * rOut, rnd())); z = (rnd() < 0.5 ? -0.5 : 0.5) * h; }
      out[i * 3] = Math.cos(th) * rr; out[i * 3 + 1] = Math.sin(th) * rr; out[i * 3 + 2] = z;
    }
    for (let i = 0; i < N; i++) { const w = 0.7 + 0.3 * rnd(); cols.set([w, 0.97 * w, 0.93 * w], i * 3); }   // silver
  };
}
// the field as it looks: floor texture colours, poles, robots where they stand
function fieldTarget() {
  const floor = L.floorMesh, img = L.floorImg;
  const sampleRobots = surfaceSampler(sim.robots.map((r) => r.root));
  const poles = []; sim.field.poles.forEach((p) => poles.push(p));
  return (out, cols) => {
    const nF = 38000, nR = 18000;
    const FIELD = floor.geometry.parameters.width, half = FIELD / 2;
    for (let i = 0; i < nF; i++) {
      const x = (rnd() - 0.5) * FIELD, z = (rnd() - 0.5) * FIELD;
      out[i * 3] = x; out[i * 3 + 1] = 0.002; out[i * 3 + 2] = z;
      const px = Math.floor((x / FIELD + 0.5) * (img.width - 1)), py = Math.floor((0.5 + z / FIELD) * (img.height - 1));
      const k = (py * img.width + px) * 4, lin = (v) => Math.pow(v / 255, 2.2);
      cols[i * 3] = 0.22 + lin(img.data[k]) * 1.1; cols[i * 3 + 1] = 0.22 + lin(img.data[k + 1]) * 1.1; cols[i * 3 + 2] = 0.24 + lin(img.data[k + 2]) * 1.1;
      void half;
    }
    sampleRobots(out, cols, nF, nR);
    for (let i = nF + nR; i < N; i++) {
      const p = poles[Math.floor(rnd() * poles.length)], th = rnd() * Math.PI * 2;
      const hgt = p.type === 'apex' ? 0.365 : p.type === 'high' ? 0.13 : 0.1;
      out[i * 3] = p.x + Math.cos(th) * 0.0127; out[i * 3 + 1] = rnd() * hgt; out[i * 3 + 2] = p.z + Math.sin(th) * 0.0127;
      cols.set(p.squad === 'red' ? [0.85, 0.3, 0.3] : p.squad === 'blue' ? [0.3, 0.42, 0.9] : [0.9, 0.8, 0.5], i * 3);
    }
  };
}

// ---------------------------------------------------------------- the logo: a crisp 3D plane + its particle twin
// End-card camera: looking straight at the logo plane (z = 0); the logo sits at screen y = 700 px
const END = { d: 2.3, fov: 40, cy: 0.6 };
function buildLogo() {
  const cw = 2048, ch = 512;
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.textBaseline = 'middle';
  const size = 300;
  g.font = `800 ${size}px "Inter Tight"`; g.letterSpacing = `${-0.015 * size}px`;
  const w1 = g.measureText('HYPER').width;
  g.font = `200 ${size}px "Inter Tight"`;
  const w2 = g.measureText('DRIVE').width;
  const x0 = (cw - (w1 + w2)) / 2;
  g.font = `800 ${size}px "Inter Tight"`; g.fillText('HYPER', x0, ch / 2 + 10);
  g.font = `200 ${size}px "Inter Tight"`; g.fillText('DRIVE', x0 + w1, ch / 2 + 10);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  // world size: the logo spans 880 px of the 1080 px frame at the end-card camera
  const halfH = END.d * Math.tan(END.fov / 2 * DEG), worldW = 2 * halfH * (W / H);
  const textW = (w1 + w2) / cw;                                 // fraction of the canvas the text occupies
  const planeW = (880 / W) * worldW / textW, planeH = planeW * ch / cw;
  const yWorld = END.cy + (1 - 700 / (H / 2)) * halfH;
  L.plane = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeH), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 }));
  L.plane.position.set(0, yWorld, 0); L.plane.renderOrder = 9; L.plane.visible = false; L.plane.userData.volumetric = true;
  scene.add(L.plane);
  // particle targets from the same canvas pixels, mapped onto the plane
  const data = g.getImageData(0, 0, cw, ch).data, px = [];
  for (let y = 0; y < ch; y += 1) for (let x = 0; x < cw; x += 1) if (data[(y * cw + x) * 4 + 3] > 140) px.push(x, y);
  L.pts = px; L.planeW = planeW; L.planeH = planeH; L.cw = cw; L.ch = ch; L.y = yWorld;
  // floor colours for the arena dissolve
  scene.traverse((o) => { if (o.isMesh && o.geometry?.type === 'PlaneGeometry' && o.geometry.parameters.width > 3 && o.material?.map) L.floorMesh = o; });
  const img = L.floorMesh.material.map.image;
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const cg = cv.getContext('2d'); cg.drawImage(img, 0, 0);
  L.floorImg = cg.getImageData(0, 0, cv.width, cv.height);
}
const logoTarget = (out, cols) => {
  const n = L.pts.length / 2;
  for (let i = 0; i < N; i++) {
    const k = Math.floor(rnd() * n) * 2;
    const x = (L.pts[k] + rnd()) / L.cw - 0.5, y = 0.5 - (L.pts[k + 1] + rnd()) / L.ch;
    out[i * 3] = x * L.planeW; out[i * 3 + 1] = L.y + y * L.planeH; out[i * 3 + 2] = (rnd() - 0.5) * 0.004;
  }
  fillColor(cols, WHITE);
};
const endCamPos = () => V(0, END.cy, END.d), endCamTgt = () => V(0, END.cy, 0);

// ---------------------------------------------------------------- scan reveal: the robot is cut at a rising height with a hot edge
function scanShader(r) {
  r.root.traverse((o) => {
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
        if (std) sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.86, 0.68) * 7.0 * smoothstep(uBand, 0.0, uCut - vScanW.y);');
      };
      m.customProgramCacheKey = () => 'scan';
      m.needsUpdate = true;
    }
  });
}

// ---------------------------------------------------------------- exploded view: every CAD mesh flies out from the robot's centre
function buildExplode(r) {
  r.root.updateMatrixWorld(true);
  const inv = r.root.matrixWorld.clone().invert();
  const centre = V(0.02, 0.07, 0);
  r.root.traverse((o) => {
    if (!o.isMesh || o === r.plate || !o.geometry) return;
    o.geometry.computeBoundingBox();
    const cw = o.geometry.boundingBox.getCenter(V(0, 0, 0)).applyMatrix4(o.matrixWorld).applyMatrix4(inv);   // root-local centre
    const dir = cw.clone().sub(centre); if (dir.length() < 1e-4) dir.set(0, 1, 0);
    dir.normalize(); dir.y += 0.35; dir.normalize();
    explodeParts.push({ o, base: o.position.clone(), rot: o.rotation.clone(), dir, dist: 0.1 + rnd() * 0.16, axis: V(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), spin: (rnd() - 0.5) * 2.2 });
  });
}
function setExplode(r, amt, t) {
  const q = new THREE.Quaternion(), pq = new THREE.Quaternion();
  r.root.updateMatrixWorld(true);
  const rootQ = r.root.getWorldQuaternion(new THREE.Quaternion());
  for (const p of explodeParts) {
    p.o.position.copy(p.base); p.o.rotation.copy(p.rot);
    if (amt <= 0) continue;
    // displacement in world space (from the root-local direction), then into the mesh parent's frame
    const dW = p.dir.clone().applyQuaternion(rootQ).multiplyScalar(p.dist * amt);
    p.o.parent.getWorldQuaternion(pq);
    p.o.position.add(dW.applyQuaternion(pq.invert()));
    q.setFromAxisAngle(p.axis, p.spin * amt * (1 + 0.15 * Math.sin(t * 3)));
    p.o.quaternion.premultiply(q);
  }
}

// ---------------------------------------------------------------- final present: zoom blur, chromatic split, grain, flash
function buildPresent() {
  const vs = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
  P.present = new THREE.ShaderMaterial({
    uniforms: { tex: { value: null }, time: { value: 0 }, vig: { value: 0.45 }, grain: { value: 0.03 }, ca: { value: 0.0008 }, fade: { value: 0 }, flash: { value: 0 }, zoom: { value: 0 }, dark: { value: 0 } },
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
        c *= 1.0 - dark;
        c += (h(vUv * vec2(1080., 1920.)) - 0.5) * grain;
        c = mix(c, vec3(1.0, 0.98, 0.95), flash);
        c *= 1.0 - fade;
        gl_FragColor = vec4(c, 1.); }`,
    depthTest: false, depthWrite: false,
  });
}

// ======================================================================= custom shots
const setup = {};
function hideWorld(on) {
  if (on && !hidden) {
    hidden = [];
    for (const o of scene.children) if (o !== P.points && o !== L.plane && !o.isLight && o.visible && o !== C.dust) { hidden.push(o); o.visible = false; }
    for (const l of C.beams) if (l.userData.beam) l.userData.beam.visible = false;
  } else if (!on && hidden) { hidden.forEach((o) => { o.visible = true; }); hidden = null; }
}
function resetFx() {
  hideWorld(false);
  P.points.visible = false; L.plane.visible = false; L.plane.material.opacity = 0;
  scan.uCut.value = 10;
  setExplode(sim.robots[0], 0, 0);
  sim.robots.forEach((r) => { r.root.visible = !r.benched; });
}
function stageHero(yaw) {
  C.fresh();
  C.clearArea(0, 0, 0.7);
  const r1 = sim.robots[0];
  C.park(r1, 0, 0, yaw); C.setArm(r1, 21.2);
  r1.releaseCore(false); r1.gripClosed = true; r1.finger = r1.fingerTarget = 0;
  C.syncVisuals();
  sim.robots.forEach((r, i) => { if (i) r.root.visible = false; });
  sim.robots[0].root.updateMatrixWorld(true);
}
function enterCustom(name) {
  resetFx();
  const r1 = sim.robots[0];
  if (name === 'swarm' || name === 'scan') {
    if (!setup.swarm) {
      stageHero(0);
      setPair(shellTarget(V(0, 0.2, 0), 0.35, 1.5, 0.6), robotTarget(r1));
      setup.swarm = true;
    }
    P.points.visible = true;
  }
  if (name === 'explode') { setup.swarm = false; stageHero(0); }
  if (name === 'ring') {
    setup.swarm = false;
    stageHero(0);                                              // facing the camera (+x)
    setPair(robotTarget(r1), ringTarget(0.13));
  }
  if (name === 'logo') {
    setPair(shellTarget(V(0, L.y, 0.6), 1.2, 3.2, 1), logoTarget);
    P.points.visible = true;
  }
  if (name === 'dissolve') {
    // sample the arena exactly as the previous cut left it
    syncAll();
    setPair(fieldTarget(), logoTarget);
    P.points.visible = true;
  }
}
function syncAll() { C.syncVisuals(); for (const r of sim.robots) r.root.updateMatrixWorld(true); }

// camera + lights + effects for a custom shot at output time ts (lt = seconds into the cut)
function customSample(name, ts, lt) {
  const r1 = sim.robots[0];
  const Lt = C.lights;
  C.lightsOff(); C.leds(0); Lt.amb.intensity = 0.03;
  C.bloom.strength = 0.4; C.bloom.threshold = 1.1; C.bloom.radius = 0.5;
  C.grade.uniforms.exposure.value = 0.85; C.grade.uniforms.streak.value = 0;
  const u = P.u;
  u.uTime.value = ts; u.uBurst.value = 0; u.uSize.value = 0.0026; u.uCut.value = -10; u.uAlpha.value = 1; u.uSwirl.value = 0; u.uVortex.value = 0; u.uVMid.value = 0; u.uGain.value = 0.5;
  let pos, tgt, fov = 36, ap = 0.003, fpt = null, shake = 0;
  const key = (p, t, lvl, col) => C.aim(Lt.key, p, t, lvl, col);
  if (name === 'swarm' || name === 'scan') {
    // one continuous orbit across both cuts
    const T = ts / B(4);
    const a = lerp(-0.42, 0.3, easeIO(T)), R = lerp(1.25, 0.92, easeIO(T));
    pos = V(Math.cos(a) * R, lerp(0.34, 0.17, easeIO(T)), Math.sin(a) * R); tgt = V(0, 0.1, 0); fov = 34; fpt = tgt; ap = 0.004;
    u.uCenter.value.set(0, 0.12, 0);
    u.uP.value = sat(ts / B(2.6)); u.uSpread.value = 0.45; u.uVortex.value = 7.5; u.uSwirl.value = 0.05; u.uSize.value = 0.0032;
    u.uAlpha.value = sat(ts / 0.25);
    u.uGain.value = 0.95;
    scan.uCut.value = -1;
    C.bloom.strength = 0.55; C.bloom.threshold = 0.55;
    if (name === 'scan') {
      const k = sat((ts - B(3)) / (B(3.85) - B(3)));
      scan.uCut.value = lerp(-0.01, 0.42, easeIO(k));
      u.uCut.value = scan.uCut.value; u.uSwirl.value = 0.004;
      const on = ease(k);
      key(V(0.9, 2.2, -0.4), V(0, 0.1, 0), 1.0 * on, 0xfff0dd);
      C.aim(Lt.rim2, V(-1.2, 0.9, 0.6), V(0, 0.12, 0), 1.3 * on, 0xd4e0ff);
      C.aim(Lt.fill, V(1.1, 0.5, 1.4), V(0, 0.1, 0), 0.7 * on, 0xb4c4e0);
      Lt.amb.intensity = 0.03 + 0.05 * on;
    }
  }
  if (name === 'explode') {
    const t = ts - B(6);
    // out on beat 6, hang, slam back on 7.75
    const outA = ease(t / 0.16), back = easeIn((ts - B(7.4)) / (B(7.75) - B(7.4)));
    const amt = ts < B(7.4) ? outA * (1 + 0.12 * sat((t - 0.16) / 0.6)) : (1.12) * (1 - back);
    setExplode(r1, amt, ts);
    const a = lerp(0.42, -0.28, easeIO(t / B(2))), R = lerp(1.4, 1.18, easeIO(t / B(2)));
    pos = V(Math.cos(a) * R, lerp(0.3, 0.2, t / B(2)), Math.sin(a) * R); tgt = V(0, 0.11, 0); fov = 36; fpt = tgt; ap = 0.0025;
    key(V(0.6, 2.3, -0.5), V(0, 0.1, 0), 1.0, 0xfff0dd);
    C.aim(Lt.rim2, V(-1.1, 0.9, -0.8), V(0, 0.12, 0), 1.3, 0xd4e0ff);
    C.aim(Lt.fill, V(1.2, 0.5, 1.2), V(0, 0.1, 0), 0.7, 0xb4c4e0);
    
    Lt.amb.intensity = 0.06;
    if (ts >= B(7.75)) shake = 0.01 * Math.max(0, 1 - (ts - B(7.75)) / 0.25);
  }
  if (name === 'ring') {
    const t = ts - B(14);
    const swap = B(14.5);
    const solid = ts < swap;
    scan.uCut.value = solid ? 10 : -1;
    P.points.visible = !solid;
    const cz = ts < B(15) ? lerp(1.25, 1.1, (ts - B(14)) / B(1)) : lerp(1.1, -0.15, easeIn((ts - B(15)) / B(1)));
    pos = V(cz, 0.2, 0); tgt = V(-1, 0.2, 0); fov = 36; fpt = V(0, 0.2, 0); ap = 0.003;
    key(V(1.0, 2.2, -0.3), V(0, 0.12, 0), 1.0, 0xfff0dd);
    C.aim(Lt.rim2, V(-1.2, 0.9, 0.5), V(0, 0.12, 0), 1.3, 0xd4e0ff);
    Lt.amb.intensity = 0.05;
    // particles leave the robot and close into a spinning CORE ring in front of it
    u.uP.value = sat((ts - swap) / (B(15.25) - swap)); u.uSpread.value = 0.35; u.uSwirl.value = 0.03; u.uVortex.value = 2.5; u.uVMid.value = 1;
    u.uCenter.value.set(0, 0.12, 0); u.uGain.value = 0.7;
    const spin = (ts - swap) * 7 + Math.pow(Math.max(0, ts - B(15)), 2) * 18;
    u.uToM.value.makeRotationZ(spin).premultiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)).premultiply(new THREE.Matrix4().makeTranslation(0.05, 0.2, 0));
    C.bloom.strength = 0.5; C.bloom.threshold = 0.7;
    P.zoom = 0.28 * easeIn((ts - B(15)) / B(1));
    void t;
  }
  if (name === 'logo') {
    hideWorld(true);
    const t = ts - B(16);
    pos = endCamPos().add(V(0, 0, lerp(0.25, 0, ease(t / B(1.5))))); tgt = endCamTgt(); fov = END.fov; fpt = V(0, L.y, 0); ap = 0.0;
    u.uP.value = sat(t / B(1)); u.uSpread.value = 0.45; u.uVortex.value = 3.5; u.uSwirl.value = 0.05; u.uCenter.value.set(0, L.y, 0);
    u.uGain.value = lerp(1.6, 0.7, sat(t / B(1))); u.uSize.value = lerp(0.008, 0.0034, sat(t / B(1)));
    const k = sat((t - B(0.9)) / B(0.35));
    L.plane.visible = true; L.plane.material.opacity = ease(k);
    u.uAlpha.value = 1 - 0.65 * ease(k);
    C.bloom.strength = 0.4; C.bloom.threshold = 1.4;
    if (t < 0.3) shake = 0.012 * (1 - t / 0.3);
  }
  if (name === 'dissolve') {
    const t = ts - B(32);
    if (t > 0.01) hideWorld(true);
    // camera eases from where the arena shot left off to the end-card framing
    const k = easeIO(t / B(2.75));
    const lp = lastCam ? lastCam.pos : V(3, 3, 3), lt0 = lastCam ? lastCam.tgt : V(0, 0, 0);
    pos = lp.clone().lerp(endCamPos(), k); tgt = lt0.clone().lerp(endCamTgt(), k); fov = lerp(lastCam ? lastCam.fov : 44, END.fov, k); fpt = tgt; ap = 0;
    u.uP.value = sat((t - B(0.2)) / B(2.55)); u.uSpread.value = 0.62; u.uVortex.value = 5; u.uVMid.value = 1; u.uSwirl.value = 0.12; u.uCenter.value.set(0, 0.5, 0);
    u.uGain.value = lerp(1.3, 0.55, u.uP.value); u.uSize.value = lerp(0.009, 0.0036, u.uP.value);
    const kk = sat((ts - B(34.3)) / B(0.65));
    L.plane.visible = kk > 0; L.plane.material.opacity = ease(kk) * 0.85;
    C.bloom.strength = 0.4; C.bloom.threshold = 1.2;
  }
  if (name === 'end') {
    hideWorld(true);
    const t = ts - B(35);
    pos = endCamPos(); tgt = endCamTgt(); fov = END.fov; fpt = V(0, L.y, 0); ap = 0;
    u.uP.value = 1; u.uSwirl.value = 0.006; u.uCenter.value.set(0, L.y, 0); u.uGain.value = 0.5; u.uSize.value = 0.0036;
    u.uAlpha.value = lerp(0.6, 0.3, sat(t / 1.2));
    L.plane.visible = true; L.plane.material.opacity = 1;
    // the logo breathes with each bar
    const pulse = Math.max(0, 1 - ((ts / BEAT) % 4) / 1.2);
    L.plane.scale.setScalar(1 + 0.012 * pulse);
    C.bloom.strength = 0.35 + 0.1 * pulse; C.bloom.threshold = 1.4;
  } else L.plane.scale.setScalar(1);
  if (shake) pos = pos.clone().add(V(noise1(ts * 9, 1) * shake, noise1(ts * 9, 7) * shake, noise1(ts * 9, 13) * shake));
  return { pos, tgt, fov, focus: fpt ? pos.distanceTo(fpt) : pos.distanceTo(tgt), aperture: ap };
}

function renderCustom(name, outT, fx) {
  const { renderer: rd, accRT, accMat, quad, quadScene, quadCam, bokeh } = C;
  const SAMPLES = C.SAMPLES, SHUTTER = C.SHUTTER;
  rd.setRenderTarget(accRT); rd.setClearColor(0x000000, 1); rd.clear(); rd.setRenderTarget(null);
  P.zoom = 0;
  for (let s = 0; s < SAMPLES; s++) {
    const ts = outT + (s / (SAMPLES - 1)) * SHUTTER / FPS;
    C.syncVisuals();
    const cam = customSample(name, ts, ts - outT);
    camera.position.copy(cam.pos); camera.fov = cam.fov * (1 - fx.punch); camera.updateProjectionMatrix(); camera.lookAt(cam.tgt); camera.updateMatrixWorld();
    bokeh.uniforms.focus.value = cam.focus; bokeh.uniforms.aperture.value = cam.aperture; bokeh.uniforms.maxblur.value = 0.012;
    C.updateDust(ts);
    C.composer.render();
    accMat.uniforms.tex.value = C.composer.readBuffer.texture; accMat.uniforms.w.value = 1 / SAMPLES;
    quad.material = accMat; rd.setRenderTarget(accRT); rd.autoClear = false; rd.render(quadScene, quadCam); rd.autoClear = true;
  }
  void quad;
}

// ======================================================================= kinetic typography
const WORDS = [
  ['kick', 0.6, 3.6], ['wCad', 6.0, 7.75], ['wPhys', 8.0, 10.9], ['w4', 12.0, 12.95], ['w2', 13.0, 13.95],
  ['wClash', 18.0, 18.95], ['wGrab', 19.5, 19.95], ['wLift', 20.0, 20.95], ['wScore', 22.0, 23.9], ['wBal', 25.0, 25.95],
  ['wRule', 28.0, 29.9], ['wLive', 30.0, 31.9],
  ['eSub', 35.75, 99], ['eCta', 36.5, 99], ['eUrl', 37.0, 99], ['eTeam', 38.5, 99], ['eBio', 39.5, 99],
];
function typography(outT) {
  const b = outT / BEAT;
  for (const [id, b0, b1] of WORDS) {
    const el = $(id);
    if (b < b0 || b > b1) { el.style.opacity = 0; continue; }
    const tin = (b - b0) * BEAT, tout = (b1 - b) * BEAT;
    const end = id.startsWith('e');
    const a = end ? ease(tin / 0.18) : ease(tin / 0.07);
    const o = end ? 1 : ease(tout / 0.08);
    el.style.opacity = Math.min(a, o);
    // slam: arrives slightly oversized and blurred, snaps to size on the beat; leaves upwards
    const sc = end ? 1 + (1 - a) * 0.05 : 1 + (1 - a) * 0.35 + (1 - o) * 0.08;
    const dy = end ? (1 - a) * 26 : (1 - o) * -40;
    el.style.transform = `${id === 'eUrl' ? 'translateX(-50%) ' : ''}translateY(${dy}px) scale(${sc})`;
    el.style.filter = `blur(${(1 - a) * (end ? 8 : 14) + (1 - o) * 10}px)`;
  }
  // score pop, anchored above the pole the CORE lands on
  const pop = $('pop');
  const land = adEvents.find((e) => e.type === 'land');
  if (land && outT >= land.out && b < 23.9) {
    const k = outT - land.out;
    pop.style.opacity = sat(Math.min(k / 0.06, (B(23.9) - outT) / 0.1));
    pop.style.transform = `scale(${1 + Math.max(0, 0.4 - k * 3)})`; pop.style.filter = `blur(${Math.max(0, 0.15 - k) * 40}px)`;
  } else pop.style.opacity = 0;
}

// ======================================================================= frame
let cutIdx = -1, editT = 0;
window.AD_FRAMES = TOTAL;
window.AD_BEATS = { bpm: BPM, cuts: CUTS.filter((c) => c.shot || c.c).map((c) => ({ b: c.b, frame: bf(c.b), what: c.shot || c.c, hit: c.hit || 0 })) };
window.adEvents = adEvents;
window.renderAdFrame = (f) => {
  let i = CUTS.length - 2;
  while (i > 0 && f < bf(CUTS[i].b)) i--;
  const c = CUTS[i];
  const outT = f / FPS, lf = f - bf(c.b);
  if (i !== cutIdx) {
    cutIdx = i;
    if (c.shot) { resetFx(); C.seekCut(c); editT = c.t; }
    else enterCustom(c.c);
    adEvents.push({ type: 'cut', what: c.shot || c.c, out: outT, hit: c.hit || 0 });
  }
  const punch = (c.hit === 2 ? 0.14 : c.hit ? 0.09 : 0.05) * Math.max(0, 1 - lf / 5);
  const flash = (c.hit === 2 ? 0.9 : c.hit ? 0.45 : 0.12) * Math.max(0, 1 - lf / (c.hit ? 4 : 2));
  // light banks / arena: a lighter punch on every beat inside long shots
  const beatPh = (outT / BEAT) % 1, onBeat = Math.max(0, 1 - (beatPh * BEAT * FPS) / 4);
  const beatPunch = (c.shot === 'arena' || c.shot === 'reveal' || c.c === 'end') ? 0.035 * onBeat : 0;
  if (c.shot) {
    const nEv = C.events.length;
    C.pipeFrame(editT, c.k, true, { punch: punch + beatPunch, flash: 0, fade: 0, outT, card: false });
    for (let k = nEv; k < C.events.length; k++) adEvents.push({ ...C.events[k], out: outT + (C.events[k].t - editT) / c.k });
    editT += c.k / FPS;
    lastCam = { pos: camera.position.clone(), tgt: camera.getWorldDirection(V(0, 0, 0)).multiplyScalar(2).add(camera.position), fov: camera.fov };
    P.zoom = 0;
  } else {
    renderCustom(c.c, outT, { punch: punch + beatPunch });
  }
  // present with the ad's own finishing pass
  const pm = P.present.uniforms;
  pm.tex.value = C.accRT.texture; pm.time.value = outT;
  pm.flash.value = flash;
  pm.zoom.value = (P.zoom || 0) + (c.hit ? 0.05 : 0.02) * Math.max(0, 1 - lf / 4);
  pm.ca.value = 0.0008 + (c.hit ? 0.004 : 0.0015) * Math.max(0, 1 - lf / 4);
  pm.fade.value = f >= TOTAL - 12 ? (f - (TOTAL - 12)) / 12 : 0;
  pm.dark.value = 0;
  C.quad.material = P.present; renderer.setRenderTarget(null); renderer.render(C.quadScene, C.quadCam);
  typography(outT);
  return { f, cut: i, what: c.shot || c.c };
};

init();
