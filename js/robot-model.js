// The NRL-2026 robot CAD as a visual model only (no physics), shared by the simulator robots, the
// simulator's home-screen showcase and the Overdrive landing page.
import * as THREE from 'three';
import { mapYielding } from './physics-core.js';
import { toCreasedNormals, mergeGeometries } from '../lib/BufferGeometryUtils.js';
import { CANVAS_FONT } from './config.js';

const DEG = Math.PI / 180;
// CARGO BAY (not in the CAD model: a rear dump tray on the top plate, see README)
export const TRAY = { hinge: [-0.130, 0.131], len: 0.108, width: 0.13, wall: 0.035 };

export async function loadRobotModel(base = 'assets/') {
  const get = async (f, kind) => {
    const r = await fetch(base + f + '?v=3');
    if (!r.ok) throw new Error(`could not load ${f} (${r.status})`);
    return kind === 'json' ? r.json() : r.arrayBuffer();
  };
  const [meta, bin] = await Promise.all([get('robot.json', 'json'), get('robot.bin', 'bin')]);
  const parts = await mapYielding(meta.parts, (p) => {
    const geo = new THREE.BufferGeometry();
    let pos;
    if (meta.format === 'int16') { // quantised positions (±0.5 m, 15 µm steps)
      const q = new Int16Array(bin, p.pOff, p.pLen);
      pos = new Float32Array(q.length);
      for (let i = 0; i < q.length; i++) pos[i] = q[i] * meta.posScale;
    } else pos = new Float32Array(bin, p.pOff, p.pLen);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(p.i16 ? new Uint16Array(bin, p.iOff, p.iLen) : new Uint32Array(bin, p.iOff, p.iLen), 1));
    const g2 = toCreasedNormals(geo, 32 * DEG);
    g2.computeBoundingSphere();
    return { ...p, geo: g2, squadMarker: p.color === 'squad' };
  });
  return { meta, parts };
}

// CAD parts that move together and share a material are drawn as one mesh (built once, shared by every copy)
export function mergedParts(model, P) {
  if (model.merged) return model.merged;
  const pivots = { armLower: P.armLower, armUpper: P.armUpper, fingerL: P.fingerL, fingerR: P.fingerR, wheelFL: P.wheelFL, wheelFR: P.wheelFR, wheelRL: P.wheelRL, wheelRR: P.wheelRR };
  const buckets = new Map();
  for (const part of model.parts) {
    const key = [part.color, part.metalness, part.roughness, part.opacity].join('|');
    const k = `${part.group}|${key}`;
    if (!buckets.has(k)) buckets.set(k, { group: part.group, key, part, geos: [] });
    const pv = pivots[part.group];
    const g = part.geo.clone();
    if (pv) g.translate(-pv[0], -pv[1], -pv[2]);
    buckets.get(k).geos.push(g);
  }
  model.merged = [...buckets.values()].map((b) => {
    const geo = b.geos.length > 1 ? mergeGeometries(b.geos) : b.geos[0];
    geo.computeBoundingSphere();
    return { group: b.group, key: b.key, part: b.part, geo };
  });
  return model.merged;
}

export function numberTexture(num, col) {
  const c = document.createElement('canvas'); c.width = 350; c.height = 200;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 350, 200);
  g.fillStyle = '#' + new THREE.Color(col).getHexString(); g.fillRect(0, 0, 350, 20); g.fillRect(0, 180, 350, 20);
  g.fillStyle = '#111'; g.font = `700 120px ${CANVAS_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(num, 175, 104);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

// Build one articulated copy of the robot. Returns the root, its moving groups and a pose() helper
// (arm angle in radians relative to the CAD pose, finger opening, wheel spin).
export function buildRobotVisual(model, { squadCol, number = '009', shadows = true } = {}) {
  const P = model.meta.pivots;
  const root = new THREE.Group();
  const g = {};
  const mk = (name, pivot) => { const grp = new THREE.Group(); if (pivot) grp.position.set(...pivot); g[name] = grp; return grp; };
  root.add(mk('chassis'), mk('armLower', P.armLower), mk('armUpper', P.armUpper), mk('end'));
  g.end.add(mk('fingerL', P.fingerL)); g.end.add(mk('fingerR', P.fingerR));
  for (const w of ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR']) root.add(mk(w, P[w]));
  const mats = {};
  for (const { group, key, geo, part } of mergedParts(model, P)) {
    if (!mats[key]) {
      const translucent = part.opacity < 1;
      mats[key] = new THREE.MeshStandardMaterial({
        color: part.squadMarker ? squadCol : part.color, roughness: part.roughness, metalness: part.metalness,
        transparent: translucent, opacity: part.opacity, depthWrite: !translucent,
      });
    }
    const m = new THREE.Mesh(geo, mats[key]);
    m.castShadow = shadows && part.opacity >= 1; m.receiveShadow = shadows;
    (g[group] || g.chassis).add(m);
  }
  const tray = new THREE.Group(); tray.position.set(TRAY.hinge[0], TRAY.hinge[1], 0); root.add(tray);
  const trayMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.5, metalness: 0.4 });
  const tb = new THREE.Mesh(new THREE.BoxGeometry(TRAY.len, 0.004, TRAY.width), trayMat); tb.position.set(TRAY.len / 2, 0.002, 0); tb.castShadow = shadows; tray.add(tb);
  for (const sz of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(TRAY.len, TRAY.wall, 0.004), trayMat); w.position.set(TRAY.len / 2, TRAY.wall / 2, sz * TRAY.width / 2); tray.add(w);
  }
  const fw = new THREE.Mesh(new THREE.BoxGeometry(0.004, TRAY.wall, TRAY.width), trayMat); fw.position.set(TRAY.len, TRAY.wall / 2, 0); tray.add(fw);
  g.tray = tray;
  // team number plate (R4) on the back
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(3.5 * 0.0254, 2 * 0.0254), new THREE.MeshBasicMaterial({ map: numberTexture(number, squadCol) }));
  plate.position.set(-0.1347, 0.0668, 0); plate.rotation.y = -Math.PI / 2; root.add(plate);
  const theta0 = model.meta.armAngle0Deg * DEG, L = model.meta.armLinkLength;
  let current = number;
  return {
    root, g, plate, theta0, L,
    get number() { return current; },
    setNumber(num) {
      if (num === current) return;
      current = num;
      if (plate.material.map) plate.material.map.dispose();
      plate.material.map = numberTexture(num, squadCol); plate.material.needsUpdate = true;
    },
    // d: arm angle change from the CAD pose (rad); the parallelogram keeps the gripper level
    pose(d = 0, finger = -0.17, spin = 0, tray = 0) {
      g.armLower.rotation.z = d; g.armUpper.rotation.z = d;
      const th = theta0 + d;
      g.end.position.set(L * (Math.cos(th) - Math.cos(theta0)), L * (Math.sin(th) - Math.sin(theta0)), 0);
      g.fingerL.rotation.y = finger; g.fingerR.rotation.y = -finger;
      g.tray.rotation.z = tray * DEG;
      for (const k of ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR']) g[k].rotation.z = -spin;
    },
  };
}
