import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from '../lib/BufferGeometryUtils.js';
import { G, groups, qrot, NULL_RAPIER, nullWorld, mapYielding } from './physics-core.js';

// the physics engine this field is built for: Rapier in the simulator, a pose-only stand-in on the display pages
let RAPIER = NULL_RAPIER;
import { PLATFORM } from './arena.js';
import {
  CANVAS_FONT, IN, FIELD, HALF, WALL, wx, wz, RED, POLE, VAULT, STATION, COLORS, squadPoint, squadPoly,
} from './config.js';

const SQUADS = ['red', 'blue'];
const DEG = Math.PI / 180;
const sqColor = (s) => (s === 'red' ? COLORS.red : COLORS.blue);
const tapeColor = (s) => (s === 'red' ? '#d9252d' : '#1f4fd6');
// canvas text uses the interface's display face (loaded before the field is built)
export { CANVAS_FONT };

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...opts });
}
function shadow(m, cast = true, recv = true) { m.castShadow = cast; m.receiveShadow = recv; return m; }

// ---------------------------------------------------------------- CAD model (Field Assembly Final.step, see tools/)
export async function loadFieldModel(base = 'assets/') {
  const get = async (f, kind) => {
    const r = await fetch(base + f + '?v=3');
    if (!r.ok) throw new Error(`could not load ${f} (${r.status})`);
    return kind === 'json' ? r.json() : r.arrayBuffer();
  };
  const [meta, bin] = await Promise.all([get('field.json', 'json'), get('field.bin', 'bin')]);
  const parts = await mapYielding(meta.parts, (p) => {
    const q = new Int16Array(bin, p.pOff, p.pLen), pos = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) pos[i] = q[i] * meta.posScale;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(p.i16 ? new Uint16Array(bin, p.iOff, p.iLen) : new Uint32Array(bin, p.iOff, p.iLen), 1));
    const g2 = toCreasedNormals(geo, 34 * DEG);
    g2.computeBoundingSphere();
    return { ...p, geo: g2 };
  });
  return { meta, parts };
}

// ---------------------------------------------------------------- floor texture (EVA tiles + taped zones from the CAD)
function floorTexture(renderer) {
  const PX = 14; // px per inch
  const S = 144 * PX;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const P = (X) => X * PX;
  g.fillStyle = '#6f747b'; g.fillRect(0, 0, S, S);
  // coloured tiles: start zones (2 tiles) and the tiles under the space stations
  for (const s of SQUADS) {
    const fill = s === 'red' ? '#9d2a31' : '#2a4aa8';
    g.fillStyle = fill;
    const sz = RED.startZone;
    const a = squadPoint(s, [sz.x0, sz.y0]), b = squadPoint(s, [sz.x1, sz.y1]);
    g.fillRect(P(Math.min(a[0], b[0])), P(Math.min(a[1], b[1])), P(Math.abs(b[0] - a[0])), P(Math.abs(b[1] - a[1])));
    const s0 = squadPoint(s, [0, 48]), s1 = squadPoint(s, [24, 96]);
    g.fillRect(P(Math.min(s0[0], s1[0])), P(Math.min(s0[1], s1[1])), P(24), P(48));
    // drop zone: the corner tile's triangle is filled
    const dz = squadPoly(s, RED.dropZone);
    g.beginPath(); dz.forEach((p, i) => (i ? g.lineTo(P(p[0]), P(p[1])) : g.moveTo(P(p[0]), P(p[1])))); g.closePath(); g.fill();
  }
  // EVA foam grain
  const img = g.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 9;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  // 1 in tape lines (CAD "Taping" parts)
  const tape = (x0, y0, x1, y1, col) => { g.strokeStyle = col; g.lineWidth = P(0.83); g.beginPath(); g.moveTo(P(x0), P(y0)); g.lineTo(P(x1), P(y1)); g.stroke(); };
  for (const s of SQUADS) {
    const col = tapeColor(s);
    const T = (x0, y0, x1, y1) => { const a = squadPoint(s, [x0, y0]), b = squadPoint(s, [x1, y1]); tape(a[0], a[1], b[0], b[1], col); };
    T(48, 24, 96, 24); T(48, 0, 48, 24); T(96, 0, 96, 24);           // start zone
    T(48, 48, 96, 48);                                               // high pole line
    T(0, 48, 24, 48); T(0, 96, 24, 96); T(24, 48, 24, 96);           // station zone
    const sc = RED.sourceZone; T(sc[1][0], sc[1][1], sc[2][0], sc[2][1]); // source zone diagonal
    T(23.0, 132.6, 23.0, 138.4); T(25.1, 132.6, 25.1, 138.4);        // vault lane
    // vault zone (dashed half disc, ASSUMPTION)
    const v = squadPoint(s, RED.vault);
    g.strokeStyle = col; g.setLineDash([P(2), P(1.5)]); g.lineWidth = P(0.5);
    g.beginPath(); const start = s === 'red' ? Math.PI : 0;
    g.arc(P(v[0]), P(v[1]), P(RED.vaultZoneR), start, start + Math.PI); g.stroke(); g.setLineDash([]);
    // spike marks: printed Ø3.74 in ring markers
    for (const p of squadPoly(s, RED.spikeMarks)) {
      g.strokeStyle = col; g.lineWidth = P(0.45);
      g.beginPath(); g.arc(P(p[0]), P(p[1]), P(1.87), 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(P(p[0]), P(p[1]), P(1.08), 0, Math.PI * 2); g.stroke();
    }
  }
  // interlocking tile seams
  g.strokeStyle = 'rgba(30,32,36,0.5)'; g.lineWidth = 2;
  for (let k = 1; k < 6; k++) {
    for (const vertical of [true, false]) {
      g.beginPath();
      const L = k * 24;
      for (let t = 0; t <= 144; t += 0.5) {
        const tooth = Math.floor(t / 1.5) % 2 ? 0.45 : -0.45;
        const x = vertical ? L + tooth : t, y = vertical ? t : L + tooth;
        if (t === 0) g.moveTo(P(x), P(y)); else g.lineTo(P(x), P(y));
      }
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

// arena floor outside the walls: driver, Human Player and referee areas (CAD "Field base" markings)
function arenaTexture() {
  const R = 132, PX = 6, S = 2 * R * PX;                  // covers X, Y in [-60, 204] in
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const P = (X) => (X + 60) * PX;
  g.fillStyle = '#b4b8be'; g.fillRect(0, 0, S, S);                 // light grey platform deck, as at the venue
  const box = (x0, y0, x1, y1, col, label) => {
    g.strokeStyle = col; g.lineWidth = 2 * PX; g.strokeRect(P(x0) + PX, P(y0) + PX, (x1 - x0 - 2) * PX, (y1 - y0 - 2) * PX);
    if (!label) return;
    g.save(); g.translate(P((x0 + x1) / 2), P((y0 + y1) / 2));
    if (y1 - y0 > x1 - x0) g.rotate(-Math.PI / 2);
    g.fillStyle = col; g.globalAlpha = 0.85; g.font = `600 ${3.4 * PX}px ${CANVAS_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, 0, 0); g.restore();
  };
  for (const s of SQUADS) {
    const col = tapeColor(s);
    const pt = (p) => squadPoint(s, p);
    const rect = (x0, y0, x1, y1, label) => { const a = pt([x0, y0]), b = pt([x1, y1]); box(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), col, label); };
    const da = RED.driverArea; rect(da.x0, da.y0, da.x1, da.y1, 'DRIVER AREA');
    rect(-27, 116, 28, 171, null);                         // Human Player 1 (55 x 55 in, wraps the corner)
    rect(-27, -27, 28, 28, null);                          // Human Player 2
    const lab = (X, Y, text) => { const p = pt([X, Y]); g.save(); g.translate(P(p[0]), P(p[1])); if (s === 'blue') g.rotate(Math.PI); g.fillStyle = col; g.globalAlpha = 0.85; g.font = `600 ${3.2 * PX}px ${CANVAS_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 0, 0); g.restore(); };
    lab(-0.5, 157, 'HUMAN PLAYER 1'); lab(14, -15, 'HUMAN PLAYER 2');
  }
  box(-27, 32, -2, 112, '#5b616b', 'REFEREE'); box(146, 32, 171, 112, '#5b616b', 'REFEREE');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return { tex, size: 2 * R * IN, center: [wx(-60 + R), wz(-60 + R)] };
}

let _ringGeo = null;
function coreRingGeometry() { // same 95/55 x 30 mm rounded ring as the game COREs
  if (_ringGeo) return _ringGeo;
  const rIn = 0.0275, rOut = 0.0475, h = 0.03, f = 0.006, pts = [];
  const arc = (cx, cy, a0, a1) => { for (let i = 0; i <= 3; i++) { const a = a0 + (a1 - a0) * (i / 3); pts.push(new THREE.Vector2(cx + Math.cos(a) * f, cy + Math.sin(a) * f)); } };
  arc(rIn + f, -h / 2 + f, Math.PI, Math.PI * 1.5); arc(rOut - f, -h / 2 + f, -Math.PI / 2, 0);
  arc(rOut - f, h / 2 - f, 0, Math.PI / 2); arc(rIn + f, h / 2 - f, Math.PI / 2, Math.PI);
  pts.push(pts[0].clone());
  _ringGeo = new THREE.LatheGeometry(pts, 28);
  return _ringGeo;
}

function textTexture(lines, w = 512, h = 512, bg = '#111', fg = '#fff') {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => { g.font = l.font || `700 60px ${CANVAS_FONT}`; g.fillStyle = l.color || fg; g.fillText(l.text, w / 2, l.y ?? (h / (lines.length + 1)) * (i + 1)); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// materials for the CAD parts (shared, keyed by look)
function cadMaterial(cache, p) {
  const key = [p.color, p.metalness, p.roughness, p.opacity, p.emissive].join('|');
  if (cache[key]) return cache[key];
  const glass = p.opacity < 1;
  const m = new THREE.MeshStandardMaterial({
    color: p.color, metalness: p.metalness, roughness: p.roughness,
    transparent: glass, opacity: p.opacity, depthWrite: !glass, side: glass ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (p.emissive) { m.emissive = new THREE.Color(p.color); m.emissiveIntensity = p.color === '#eaf2ff' ? 0.55 : 0; }
  cache[key] = m;
  return m;
}

// ---------------------------------------------------------------- build
export function buildField(scene, world, renderer, model, physics = null) {
  RAPIER = physics || NULL_RAPIER;
  if (!world) world = nullWorld();
  const F = { poles: [], dropZones: {}, sourceZones: {}, startZones: {}, vaults: {}, stations: {}, vaultZones: {}, buttons: {}, trifrons: {}, floorCollider: null, envColliders: new Set(), hpRacks: {} };
  const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const envG = groups(G.ENV, G.ALL);
  const poleG = groups(G.POLE, G.ALL & ~G.STATION);
  const addCol = (desc, body = fixed) => world.createCollider(desc, body);
  const matCache = {};

  // ----- tiles + arena floor
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTexture(renderer), roughness: 0.93, metalness: 0 });
  const floor = shadow(new THREE.Mesh(new THREE.PlaneGeometry(FIELD, FIELD), floorMat), false, true);
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  // tile edge visible above the arena floor
  const edge = new THREE.Mesh(new THREE.BoxGeometry(FIELD, -WALL.ground, FIELD), mat(0x2a2d33, { roughness: 0.9 }));
  edge.position.y = WALL.ground / 2 - 0.0005; scene.add(edge);
  const arena = arenaTexture();
  const ground = shadow(new THREE.Mesh(new THREE.PlaneGeometry(arena.size, arena.size), new THREE.MeshStandardMaterial({ map: arena.tex, roughness: 0.96 })), false, true);
  ground.rotation.x = -Math.PI / 2; ground.position.set(arena.center[0], WALL.ground, arena.center[1]); scene.add(ground);
  // the courtyard below the raised platform (js/arena.js builds the venue around it)
  const beyond = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), mat(0x9d968a, { roughness: 1 }));
  beyond.rotation.x = -Math.PI / 2; beyond.position.y = WALL.ground - PLATFORM.h - 0.004; scene.add(beyond);
  F.floorCollider = addCol(RAPIER.ColliderDesc.cuboid(8, 0.05, 8).setTranslation(0, -0.05, 0).setFriction(0.9).setCollisionGroups(envG));
  F.envColliders.add(F.floorCollider.handle);

  // ----- walls (outside the 144 in tile area; visuals come from the CAD)
  for (let i = 0; i < 4; i++) {
    const along = FIELD + 2 * WALL.thick;
    const isX = i < 2, sgn = i % 2 ? 1 : -1;
    const sx = isX ? along : WALL.thick, sz = isX ? WALL.thick : along;
    const px = isX ? 0 : sgn * (HALF + WALL.thick / 2), pz = isX ? sgn * (HALF + WALL.thick / 2) : 0;
    // the top face is the real wall top: CORES threaded on an APEX pole rest on it
    const c = addCol(RAPIER.ColliderDesc.cuboid(sx / 2, WALL.height / 2, sz / 2).setTranslation(px, WALL.height / 2, pz).setFriction(0.3).setCollisionGroups(envG));
    F.envColliders.add(c.handle);
  }

  // ----- CAD parts: static ones go straight into the scene, station decks / ramps into their moving groups
  const dynGroups = {};
  const buttonMats = {};
  for (const p of model.parts) {
    let material = cadMaterial(matCache, p);
    const squadBtn = p.emissive && p.color !== '#eaf2ff' ? (p.color === '#c4202b' ? 'red' : 'blue') : null;
    if (squadBtn) material = buttonMats[squadBtn] || (buttonMats[squadBtn] = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.3, metalness: 0.1, emissive: 0x000000 }));
    const m = new THREE.Mesh(p.geo, material);
    m.castShadow = p.opacity >= 1; m.receiveShadow = true;
    if (p.group === 'static') scene.add(m);
    else (dynGroups[p.group] || (dynGroups[p.group] = [])).push(m);
  }

  // ----- zones (world polygons in x,z)
  const toW = (poly) => poly.map(([X, Y]) => [wx(X), wz(Y)]);
  for (const s of SQUADS) {
    F.dropZones[s] = toW(squadPoly(s, RED.dropZone));
    F.sourceZones[s] = toW(squadPoly(s, RED.sourceZone));
    const sz = RED.startZone;
    F.startZones[s] = toW(squadPoly(s, [[sz.x0, sz.y0], [sz.x1, sz.y0], [sz.x1, sz.y1], [sz.x0, sz.y1]]));
    const v = squadPoint(s, RED.vault);
    F.vaultZones[s] = { c: [wx(v[0]), wz(v[1])], r: RED.vaultZoneR * IN, inward: s === 'red' ? -1 : 1 };
  }

  // ----- HIGH / STAR poles: Ø4 in base cup, 1 in pipe, domed cap that passes through a CORE
  function addPole(s, type, X, Y) {
    const x = wx(X), z = wz(Y);
    const spec = POLE[type];
    addCol(RAPIER.ColliderDesc.cylinder(POLE.baseH / 2, POLE.baseR).setTranslation(x, POLE.baseH / 2, z).setFriction(0.5).setCollisionGroups(envG));
    const shaftTop = spec.top - POLE.capH;
    addCol(RAPIER.ColliderDesc.cylinder(shaftTop / 2, POLE.r).setTranslation(x, shaftTop / 2, z).setFriction(0.25).setCollisionGroups(poleG));
    addCol(RAPIER.ColliderDesc.cone(POLE.capH / 2, POLE.capR).setTranslation(x, spec.top - POLE.capH / 2, z).setFriction(0.2).setCollisionGroups(poleG));
    F.poles.push({ squad: s, type, x, z, base: POLE.baseH, top: spec.top, capacity: spec.cap, id: F.poles.length });
  }
  for (const s of SQUADS) {
    for (const p of RED.starPoles) addPole(s, 'star', ...squadPoint(s, p));
    for (const p of RED.highPoles) addPole(s, 'high', ...squadPoint(s, p));
  }

  // ----- APEX poles: wall-mounted pipes; a threaded CORE rests on the wall top
  for (const s of SQUADS) {
    for (const p of RED.apexPoles) {
      const [X, Y] = squadPoint(s, p), x = wx(X), z = wz(Y);
      const A = POLE.apex;
      addCol(RAPIER.ColliderDesc.cylinder((A.top - A.capH) / 2, POLE.r).setTranslation(x, (A.top - A.capH) / 2, z).setFriction(0.25).setCollisionGroups(poleG));
      addCol(RAPIER.ColliderDesc.cylinder(A.capH / 2, A.capR).setTranslation(x, A.top - A.capH / 2, z).setFriction(0.2).setCollisionGroups(poleG));
      F.poles.push({ squad: s, type: 'apex', x, z, base: A.base, top: A.top, capacity: A.cap, id: F.poles.length });
    }
  }

  // ----- space stations + vaults
  for (const s of SQUADS) F.stations[s] = buildStation(scene, world, s, model, dynGroups, addCol);
  for (const s of SQUADS) F.vaults[s] = buildVault(scene, world, s, model, fixed, addCol, envG);

  // ----- STARBURST buttons (CAD pillar + buzzer), trifrons, HP racks
  for (const s of SQUADS) {
    const ledMat = buttonMats[s] || new THREE.MeshStandardMaterial({ color: sqColor(s) });
    F.buttons[s] = { ledMat, squad: s };

    // TRIFRON (equilateral triangular prism behind the space station, shows STAR MAP)
    const [tX, tY] = squadPoint(s, RED.trifron);
    const tri = new THREE.Group(); tri.position.set(wx(tX), WALL.ground, wz(tY)); scene.add(tri);
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, 0.16, 12), mat(0x222222)); stand.position.y = 0.08; tri.add(stand);
    const faces = [];
    const R = 0.13, H = 0.26;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      const fm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
      const face = new THREE.Mesh(new THREE.PlaneGeometry(R * Math.sqrt(3), H), fm);
      face.position.set(Math.cos(a) * R / 2, 0.16 + H / 2, Math.sin(a) * R / 2);
      face.rotation.y = -a + Math.PI / 2; tri.add(face); faces.push(fm);
    }
    F.trifrons[s] = { group: tri, faces };

    // Human Player reserve: the CAD's six stacks (3-4-3 x 2 = 20 COREs) on the Human Player area floor
    const rack = new THREE.Group(); scene.add(rack);
    const rings = shadow(new THREE.InstancedMesh(coreRingGeometry(), mat(sqColor(s), { roughness: 0.55 }), 20));
    const m4 = new THREE.Matrix4();
    // instance order = the order rings are handed out from the end: bottom layers first, top layers last
    const spots = [];
    RED.hpRacks.forEach(([X, Y, n]) => { const [x, y] = squadPoint(s, [X, Y]); for (let k = 0; k < n; k++) spots.push([wx(x), WALL.ground + 0.015 + k * 0.0302, wz(y), k]); });
    spots.sort((a, b) => a[3] - b[3]).forEach(([x, y, z], i) => rings.setMatrixAt(i, m4.makeTranslation(x, y, z)));
    rings.computeBoundingSphere();
    rack.add(rings);
    F.hpRacks[s] = { group: rack, rings, setCount(c) { rings.count = Math.max(0, Math.min(20, c)); } };
  }
  // static field pieces that share a material become one mesh (cuts draw calls)
  const dynamic = new Set(SQUADS.flatMap((s) => [F.stations[s].deckGrp, ...F.stations[s].rampGrps, F.trifrons[s].group, F.hpRacks[s].group, F.vaults[s].gateVis]));
  mergeStatic(scene, dynamic, new Set(Object.values(buttonMats)));
  return F;
}

// materials that look identical can share one draw call
function matKey(m) {
  if (m.map || m.alphaMap || m.normalMap) return m.uuid;
  return [m.type, m.color && m.color.getHexString(), m.roughness, m.metalness, m.transparent, m.opacity, m.side, m.depthWrite,
    m.emissive && m.emissive.getHexString(), m.emissiveIntensity, m.vertexColors, m.flatShading].join('|');
}
function mergeStatic(scene, dynamic, keepMats) {
  scene.updateMatrixWorld(true);
  const buckets = new Map();
  scene.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || !o.visible || keepMats.has(o.material)) return;
    for (let p = o; p; p = p.parent) if (dynamic.has(p)) return;
    const key = `${matKey(o.material)}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}|${o.geometry.attributes.uv ? 1 : 0}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(o);
  });
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const geos = list.map((m) => {
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      if (!g.attributes.normal) g.computeVertexNormals();
      g.applyMatrix4(m.matrixWorld);
      return g;
    });
    const merged = mergeGeometries(geos);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, list[0].material);
    mesh.castShadow = list[0].castShadow; mesh.receiveShadow = list[0].receiveShadow;
    for (const m of list) m.parent.remove(m);
    scene.add(mesh);
  }
}

// ---------------------------------------------------------------- space station
// CAD: a gabled polycarbonate deck (20 x 26 in, crest 11.6 in) on a pivot 8.19 in above the tiles, with 17 in
// ramps hinged at both deck ends. Collision shapes are convex hulls of the CAD deck and ramp panels.
function buildStation(scene, world, s, model, dynGroups, addCol) {
  const A = model.meta.stations[s];
  const hullPts = (k) => new Float32Array(model.meta.hulls[k]);
  const [px, py, pz] = A.pivot;
  const stG = groups(G.STATION, G.ALL);
  const deckPts = hullPts('deck_' + s);
  const top = { y: -Infinity };
  for (let i = 1; i < deckPts.length; i += 3) top.y = Math.max(top.y, deckPts[i]);
  const width = A.deckX[1] - A.deckX[0], deckLen = A.deckZ[1] - A.deckZ[0];
  const dcx = (A.deckX[0] + A.deckX[1]) / 2 - px, dcz = (A.deckZ[0] + A.deckZ[1]) / 2 - pz;

  const deckBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(px, py, pz).setAngularDamping(0.2).setCanSleep(false)
    .setAdditionalMassProperties(STATION.deckMass, { x: dcx, y: 0.025, z: dcz }, { x: 0.165, y: 0.26, z: 0.1 }, { x: 0, y: 0, z: 0, w: 1 }));
  const deckCol = world.createCollider(RAPIER.ColliderDesc.convexHull(deckPts).setDensity(0).setFriction(1.0).setCollisionGroups(stG), deckBody);
  // raised side guards along both long edges of the deck
  const guards = ['guardL_', 'guardR_'].map((k) => world.createCollider(RAPIER.ColliderDesc.convexHull(hullPts(k + s)).setDensity(0).setFriction(0.4).setCollisionGroups(stG), deckBody));
  const anchorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(px, py, pz));
  const pivot = world.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }), anchorBody, deckBody, true);
  pivot.setContactsEnabled(false);
  if (pivot.setLimits) pivot.setLimits(-STATION.maxTilt, STATION.maxTilt);

  // ramps: hinged at the deck ends; their feet rest on the floor plates
  const ramps = [];
  const colliders = [deckCol, ...guards];
  for (const [side, sg] of [['N', -1], ['S', 1]]) {
    const h = A['hinge' + side];
    const pts = hullPts('ramp' + side + '_' + s);
    let reach = 0, cy = 0, cz = 0;
    for (let i = 0; i < pts.length; i += 3) { reach = Math.max(reach, Math.abs(pts[i + 2])); cy += pts[i + 1]; cz += pts[i + 2]; }
    const n = pts.length / 3;
    const rb = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(h[0], h[1], h[2]).setCanSleep(false).setAngularDamping(0.5)
      .setAdditionalMassProperties(STATION.rampMass, { x: 0, y: cy / n, z: cz / n }, { x: 0.035, y: 0.06, z: 0.03 }, { x: 0, y: 0, z: 0, w: 1 }));
    // the toe slides on the polycarbonate floor plate as the deck tilts (tyre grip on the ramp comes from the
    // wheel model, not from this collider's friction)
    const rc = world.createCollider(RAPIER.ColliderDesc.convexHull(pts).setDensity(0).setFriction(0.25)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min).setCollisionGroups(stG), rb);
    const hinge = world.createImpulseJoint(RAPIER.JointData.revolute({ x: h[0] - px, y: h[1] - py, z: h[2] - pz }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }), deckBody, rb, true);
    hinge.setContactsEnabled(false);
    ramps.push({ body: rb, collider: rc, sg, home: h, reach });
    colliders.push(rc);
  }
  // fixed side cover on the field side (CAD "Ramp covering")
  addCol(RAPIER.ColliderDesc.convexHull(hullPts('cover_' + s)).setFriction(0.4).setCollisionGroups(groups(G.ENV, G.ALL & ~G.STATION)));

  // visuals: CAD meshes, re-parented onto the moving bodies
  const deckGrp = new THREE.Group(); scene.add(deckGrp);
  for (const m of dynGroups['deck_' + s] || []) deckGrp.add(m);
  const rampGrps = ramps.map(({ sg }) => {
    const grp = new THREE.Group(); scene.add(grp);
    for (const m of dynGroups[(sg < 0 ? 'rampN_' : 'rampS_') + s] || []) grp.add(m);
    return grp;
  });

  const reach = Math.max(...ramps.map((r) => r.reach));
  const footprint = [[A.deckX[0], pz - deckLen / 2 - reach], [A.deckX[1], pz - deckLen / 2 - reach], [A.deckX[1], pz + deckLen / 2 + reach], [A.deckX[0], pz + deckLen / 2 + reach]];
  const deckTop = top.y - 0.02;   // height (above the pivot) at which the deck outline is projected

  const st = {
    squad: s, deckBody, deckCol, ramps, pivot, colliders, colliderSet: new Set(colliders.map((c) => c.handle)),
    deckGrp, rampGrps, footprint, cx: px, cz: pz, pivotY: py, width, deckLen,
    load: 0, stuck: true,
    tilt() { const q = deckBody.rotation(); return 2 * Math.atan2(q.x, q.w); },
    // the top platform only (tilts with the deck), projected to the floor: DOCK / BALANCE need the robot on it
    deckPoly() {
      const t = deckBody.translation(), q = deckBody.rotation();
      return [[A.deckX[0], A.deckZ[0]], [A.deckX[1], A.deckZ[0]], [A.deckX[1], A.deckZ[1]], [A.deckX[0], A.deckZ[1]]]
        .map(([x, z]) => { const p = qrot(q, { x: x - px, y: deckTop, z: z - pz }); return [t.x + p.x, t.z + p.z]; });
    },
    // a wheel pushes on the deck or a ramp: accumulate its torque about the pivot axis (+x). A ramp passes the
    // share of a load that its hinge carries (the rest goes through its foot into the floor).
    addLoad(body, p, F) {
      if (body === deckBody) { this.load += (p.y - py) * F.z - (p.z - pz) * F.y; return; }
      const r = ramps.find((x) => x.body === body); if (!r) return;
      const h = body.translation();
      const share = Math.max(0, Math.min(1, 1 - Math.abs(p.z - h.z) / r.reach));
      this.load += -(h.z - pz) * F.y * share;
    },
    // pivot bearing: static friction holds the deck while the load torque stays under the limit, then it turns
    // against sliding friction and viscous damping. Call once per substep, after the robots, before world.step.
    step(dt) {
      const w = deckBody.angvel().x, load = this.load;
      this.load = 0;
      let tau;
      if (this.stuck && Math.abs(load) <= STATION.pivotStatic) tau = -load - 0.3 * w / dt;
      else {
        this.stuck = false;
        const dir = Math.abs(w) > 1e-3 ? Math.sign(w) : Math.sign(load);
        tau = -STATION.pivotDamping * w - dir * STATION.pivotKinetic;
        if (Math.abs(w) < 0.02 && Math.abs(load) <= STATION.pivotStatic) this.stuck = true;
      }
      deckBody.addTorque({ x: tau, y: 0, z: 0 }, true);
    },
    sync() {
      const t = deckBody.translation(), q = deckBody.rotation();
      deckGrp.position.set(t.x, t.y, t.z); deckGrp.quaternion.set(q.x, q.y, q.z, q.w);
      ramps.forEach((r, i) => { const rt = r.body.translation(), rq = r.body.rotation(); rampGrps[i].position.set(rt.x, rt.y, rt.z); rampGrps[i].quaternion.set(rq.x, rq.y, rq.z, rq.w); });
    },
    reset() {
      deckBody.setTranslation({ x: px, y: py, z: pz }, true); deckBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      deckBody.setLinvel({ x: 0, y: 0, z: 0 }, true); deckBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.load = 0; this.stuck = true;
      ramps.forEach((r) => {
        r.body.setTranslation({ x: r.home[0], y: r.home[1], z: r.home[2] }, true);
        r.body.setRotation(r.rest || { x: 0, y: 0, z: 0, w: 1 }, true);
        r.body.setLinvel({ x: 0, y: 0, z: 0 }, true); r.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      });
    },
    // remember where the ramps settle under gravity so a reset puts them straight there
    captureRest() { ramps.forEach((r) => { const q = r.body.rotation(); r.rest = { x: q.x, y: q.y, z: q.z, w: q.w }; }); },
  };
  deckBody.userData = { station: st };
  for (const r of ramps) r.body.userData = { station: st };
  return st;
}

// ---------------------------------------------------------------- vault
// CAD: Ø4 in acrylic silo from 1.78 in to 7.69 in above the tiles, capped, flanked by two 45° guide wings.
function buildVault(scene, world, s, model, fixedBody, addCol, envG) {
  const [X, Y] = squadPoint(s, RED.vault);
  const x = wx(X), z = wz(Y);
  const grp = new THREE.Group(); grp.position.set(x, 0, z); scene.add(grp);
  // physics: tube wall segments above the opening + a gate across the opening until STARBURST
  // the CORE collider is an octagon of boxes whose corners reach 50 mm, so the tube's inner face sits just outside that
  const tw = 0.003, rMid = Math.max(VAULT.rIn, 0.0503) + tw, segs = 16;
  const segLen = 2 * Math.PI * rMid / segs * 0.55;
  const gate = [];
  for (let k = 0; k < segs; k++) {
    const a = (k / segs) * Math.PI * 2;
    const rot = { x: 0, y: Math.sin(-a / 2), z: 0, w: Math.cos(-a / 2) };
    const cx = x + Math.cos(a) * rMid, cz = z + Math.sin(a) * rMid;
    addCol(RAPIER.ColliderDesc.cuboid(tw, (VAULT.top - VAULT.gap) / 2, segLen).setTranslation(cx, (VAULT.top + VAULT.gap) / 2, cz).setRotation(rot).setFriction(0.3).setCollisionGroups(envG));
    gate.push(world.createCollider(RAPIER.ColliderDesc.cuboid(tw, VAULT.gap / 2, segLen).setTranslation(cx, VAULT.gap / 2, cz).setRotation(rot).setFriction(0.3).setCollisionGroups(envG), fixedBody));
  }
  addCol(RAPIER.ColliderDesc.cylinder((VAULT.capTop - VAULT.top) / 2 + 0.002, VAULT.capR).setTranslation(x, (VAULT.capTop + VAULT.top) / 2, z).setCollisionGroups(envG));
  for (const k of Object.keys(model.meta.hulls)) if (k.startsWith('wing_' + s)) addCol(RAPIER.ColliderDesc.convexHull(new Float32Array(model.meta.hulls[k])).setFriction(0.3).setCollisionGroups(envG));
  // gate visual: thin bars across the opening (lowered at STARBURST)
  const gateVis = new THREE.Group(); grp.add(gateVis);
  const barMat = mat(0x24272c, { metalness: 0.6, roughness: 0.35 });
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, VAULT.gap, 6), barMat);
    b.position.set(Math.cos(a) * VAULT.rOut, VAULT.gap / 2, Math.sin(a) * VAULT.rOut); gateVis.add(b);
  }
  return {
    squad: s, x, z, gate, gateVis, open: false,
    setOpen(v) { this.open = v; gate.forEach((c) => c.setEnabled(!v)); gateVis.visible = !v; },
  };
}

export function paintTrifron(F, starMap) {
  for (const s of ['red', 'blue']) {
    const label = { C: s === 'red' ? 'RED' : 'BLUE', G: 'GOLD' };
    const fill = { C: s === 'red' ? '#d8232a' : '#1f4fd8', G: '#f2a81e' };
    const c = document.createElement('canvas'); c.width = 256; c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#f6f7f9'; g.fillRect(0, 0, 256, 512);
    g.fillStyle = '#111'; g.font = `700 34px ${CANVAS_FONT}`; g.textAlign = 'center'; g.fillText('STAR MAP', 128, 52);
    g.fillStyle = '#e0a020'; g.fillRect(40, 70, 176, 3);
    starMap.forEach((k, i) => {
      const y = 100 + i * 130;
      g.fillStyle = fill[k]; roundRect(g, 20, y, 216, 100, 18); g.fill();
      g.fillStyle = k === 'G' ? '#7a4a00' : '#0a0a2a'; g.font = `700 46px ${CANVAS_FONT}`; g.fillText(label[k], 128, y + 66);
    });
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    F.trifrons[s].faces.forEach((fm) => { if (fm.map) fm.map.dispose(); fm.map = tex; fm.needsUpdate = true; });
  }
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
export { textTexture };
