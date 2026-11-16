// Robot designer: the design parameters, presets, and how a design is put onto a live Robot.
//
// A design never touches the shared ROBOT object in config.js. robot.js bakes wheel radius and free speed into
// module constants at load, so those cannot be changed through ROBOT anyway. Instead a designed robot gets
// instance overrides (step, holdLocal, endOffset) that read the design, and its rigid body, wheel and arm
// colliders are resized to match. Restoring deletes the overrides and puts back the exact stock numbers, so the
// prototype code (the stock robot) runs again untouched. Because the design is per robot, a designed robot
// and a stock robot can share the field (the push test needs that).
import {
  RAPIER, G, groups, qrot, add, sub, scl, dot, cross, norm, pointVel,
} from '../physics.js';
import { ROBOT, POLE, CORE } from '../config.js';

const DEG = Math.PI / 180;
const SUSP_REST = 0.004, SUSP_STATIC = 0.002;        // as robot.js
const MASS_COM = { x: -0.01, y: 0.055, z: 0 };       // robot.js buildPhysics
const MASS_INERTIA = { x: 0.0295, y: 0.0496, z: 0.0278 };
const IDENT = { x: 0, y: 0, z: 0, w: 1 };

// stock values, read once from config.js (this module never writes ROBOT)
export const STOCK = Object.freeze({
  mass: ROBOT.mass, wheelR: ROBOT.wheelR, motorFreeRPM: ROBOT.motorFreeRPM, motorStallTorque: ROBOT.motorStallTorque,
  motorStallAmps: ROBOT.motorStallAmps, volts: ROBOT.battery.volts, rInt: ROBOT.battery.rInt,
  mu: ROBOT.mu, muKinetic: ROBOT.muKinetic, rollCrr: ROBOT.rollCrr, gearHold: ROBOT.gearHold,
  L: 0.145715, armMax: ROBOT.armMax, servoMax: ROBOT.servoMax,
});

// k: design key; scale: display units per SI unit
export const PARAMS = [
  { group: 'Drivetrain', k: 'motorFreeRPM', label: 'Wheel free speed', unit: 'RPM', min: 80, max: 1200, step: 5, digits: 0, help: 'Gear motor output at 12 V, no load' },
  { group: 'Drivetrain', k: 'motorStallTorque', label: 'Stall torque per motor', unit: 'N·m', min: 0.2, max: 5, step: 0.05, digits: 2, help: 'At the wheel, 12 V' },
  { group: 'Drivetrain', k: 'motorStallAmps', label: 'Stall current per motor', unit: 'A', min: 1, max: 30, step: 0.5, digits: 1, help: 'Sets how hard the pack sags' },
  { group: 'Drivetrain', k: 'wheelR', label: 'Wheel radius', unit: 'mm', scale: 1000, min: 40, max: 75, step: 0.5, digits: 1, help: 'Raises the chassis and the arm by the change' },
  { group: 'Battery', k: 'volts', label: 'Pack voltage', unit: 'V', min: 6, max: 16, step: 0.1, digits: 1, help: '3S LiPo nominal 11.1 to 12.6' },
  { group: 'Battery', k: 'rInt', label: 'Internal resistance', unit: 'Ω', min: 0.01, max: 0.5, step: 0.005, digits: 3, help: 'Pack plus wiring' },
  { group: 'Tyres', k: 'mu', label: 'Friction, static', unit: 'μ', min: 0.3, max: 1.6, step: 0.01, digits: 2, help: 'Rubber on EVA foam' },
  { group: 'Tyres', k: 'muKinetic', label: 'Friction, sliding', unit: 'μ', min: 0.2, max: 1.5, step: 0.01, digits: 2, help: 'While scrubbing in a turn' },
  { group: 'Tyres', k: 'rollCrr', label: 'Rolling resistance', unit: 'Crr', min: 0, max: 0.15, step: 0.005, digits: 3, help: 'Soft tyre on 12 mm foam' },
  { group: 'Chassis', k: 'mass', label: 'Mass', unit: 'kg', min: 1.5, max: 8, step: 0.05, digits: 2, help: 'R1.2 caps it at 8 kg' },
  { group: 'Chassis', k: 'gearHold', label: 'Gearbox hold', unit: 'N/wheel', min: 0, max: 8, step: 0.1, digits: 1, help: 'Back-drive resistance when parked' },
  { group: 'Arm', k: 'L', label: 'Arm link length', unit: 'mm', scale: 1000, min: 100, max: 230, step: 0.5, digits: 1, help: 'Both parallelogram links, pivots fixed' },
  { group: 'Arm', k: 'armMax', label: 'Arm top stop', unit: '°', min: 40, max: 120, step: 1, digits: 0, help: 'Highest commanded angle' },
  { group: 'Arm', k: 'servoMax', label: 'Arm servo speed', unit: '°/s', min: 60, max: 600, step: 10, digits: 0, help: 'No-load speed (driver rate is 150 °/s)' },
];

// gearing change by ratio g: same motor, wheel speed x g, torque / g
const geared = (g) => ({ motorFreeRPM: Math.round(STOCK.motorFreeRPM * g), motorStallTorque: +(STOCK.motorStallTorque / g).toFixed(3) });
export const PRESETS = [
  { id: 'stock', name: 'Stock (Team 009)', note: 'The robot as built: 300 RPM, 1.0 N·m, 3.2 kg, 145.7 mm arm links.', d: {} },
  { id: 'fast', name: 'Fast gearing', note: '1.5 : 1 faster gearbox on the same motors: 450 RPM, 0.67 N·m.', d: geared(1.5) },
  { id: 'torque', name: 'Torque gearing', note: '1.5 : 1 slower gearbox on the same motors: 200 RPM, 1.5 N·m.', d: geared(1 / 1.5) },
  { id: 'heavy', name: 'Torque + ballast', note: 'Torque gearing plus 1.3 kg of ballast (4.5 kg), built for pushing.', d: { ...geared(1 / 1.5), mass: 4.5 } },
  { id: 'longarm', name: 'Long arm', note: '185 mm links on the same pivots, aimed at the Apex Poles.', d: { L: 0.185 } },
];

export const stockDesign = () => ({ ...STOCK });
export const presetDesign = (id) => ({ ...STOCK, ...(PRESETS.find((p) => p.id === id) || PRESETS[0]).d });
export function cleanDesign(d) {
  const out = { ...STOCK };
  for (const p of PARAMS) {
    const v = Number(d && d[p.k]);
    if (Number.isFinite(v)) out[p.k] = Math.min(p.max / (p.scale || 1), Math.max(p.min / (p.scale || 1), v));
  }
  return out;
}
export const isStock = (d) => !d || PARAMS.every((p) => Math.abs(d[p.k] - STOCK[p.k]) < 1e-12);
export const changedKeys = (d) => PARAMS.filter((p) => Math.abs(d[p.k] - STOCK[p.k]) > 1e-12).map((p) => p.k);

// ------------------------------------------------------------------ geometry (no physics)
// Arm: two parallel links of length L from fixed pivots. The stock CAD pose (theta0, holdPoint) fixes the
// offset from the link tip to the hold point (ring centre), so a different L moves the gripper along the arc.
export function armGeom(P, theta0, design) {
  const L0 = STOCK.L, L = design.L;
  const h = P.holdPoint;
  const floorY = P.wheelFL[1] - design.wheelR;          // body-frame height of the tiles (robot level, at rest)
  const hold = (th) => ({ x: h[0] + L * Math.cos(th) - L0 * Math.cos(theta0), y: h[1] + L * Math.sin(th) - L0 * Math.sin(theta0) });
  // lowest angle: the gripper reaches the tiles exactly as the stock arm does at its -16.45° stop
  const stockFloorHold = h[1] + L0 * Math.sin(ROBOT.armMin * DEG) - L0 * Math.sin(theta0) - (P.wheelFL[1] - STOCK.wheelR);
  const s = (stockFloorHold + floorY - h[1] + L0 * Math.sin(theta0)) / L;
  const armMin = Math.max(-60, Math.asin(Math.max(-1, Math.min(1, s))) / DEG);
  return { L, L0, floorY, hold, armMin, armMax: design.armMax, height: (th) => hold(th).y - floorY };
}

// ------------------------------------------------------------------ live robots
const ORIG = new WeakMap();
function original(r) {
  if (!ORIG.has(r)) ORIG.set(r, { L: r.vis && r.vis.L ? r.vis.L : r.L });
  return ORIG.get(r);
}
export const appliedDesign = (r) => r.__dz ? r.__dz.design : null;

// put a design on one robot (null or a stock design restores it exactly)
export function applyToRobot(r, design) {
  const o = original(r);
  if (!design || isStock(design)) { restoreRobot(r, o); return; }
  const d = cleanDesign(design);
  const geom = armGeom(r.P, r.theta0, d);
  const omegaFree = d.motorFreeRPM * 2 * Math.PI / 60;
  r.__dz = { design: d, R: d.wheelR, omegaFree, vFree: omegaFree * d.wheelR, armMin: geom.armMin, armMax: d.armMax, L0: o.L };
  r.step = dzStep; r.holdLocal = dzHold; r.endOffset = dzEnd;
  r.L = d.L;
  setBodyShape(r, d.mass, d.wheelR, d.L);
  r.theta = Math.max(geom.armMin * DEG, Math.min(d.armMax * DEG, r.theta));
  r.thetaTarget = Math.max(geom.armMin * DEG, Math.min(d.armMax * DEG, r.thetaTarget));
  r.updateMechColliders();
}
function restoreRobot(r, o) {
  delete r.step; delete r.holdLocal; delete r.endOffset; delete r.__dz;
  r.L = o.L;
  setBodyShape(r, STOCK.mass, STOCK.wheelR, o.L);
  r.theta = Math.max(ROBOT.armMin * DEG, Math.min(ROBOT.armMax * DEG, r.theta));
  r.thetaTarget = Math.max(ROBOT.armMin * DEG, Math.min(ROBOT.armMax * DEG, r.thetaTarget));
  r.updateMechColliders();
}
function setBodyShape(r, mass, wheelR, L) {
  const k = mass / STOCK.mass;
  r.body.setAdditionalMassProperties(mass, MASS_COM, k === 1 ? MASS_INERTIA : scl(MASS_INERTIA, k), IDENT, true);
  for (const w of r.wheels) w.collider.setRadius(wheelR - 0.004);
  for (const c of [r.lowerCol, r.upperCol]) c.setHalfExtents({ x: L / 2 + 0.012, y: 0.008, z: 0.012 });
  // visuals: wheels scale about their axles, the links about their pivots (the gripper follows endOffset)
  const ws = wheelR / STOCK.wheelR, as = L / original(r).L;
  if (r.g) {
    for (const key of ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR']) if (r.g[key]) r.g[key].scale.set(ws, ws, 1);
    for (const key of ['armLower', 'armUpper']) if (r.g[key]) r.g[key].scale.set(as, as, 1);
  }
}

// instance overrides (this = Robot)
function dzHold(theta = this.theta) {
  const h = this.P.holdPoint, z = this.__dz;
  return { x: h[0] + this.L * Math.cos(theta) - z.L0 * Math.cos(this.theta0), y: h[1] + this.L * Math.sin(theta) - z.L0 * Math.sin(this.theta0), z: h[2] };
}
function dzEnd() {
  const z = this.__dz;
  return [this.L * Math.cos(this.theta) - z.L0 * Math.cos(this.theta0), this.L * Math.sin(this.theta) - z.L0 * Math.sin(this.theta0)];
}

// Robot.step from robot.js with every drivetrain number taken from the design. Kept line for line with the
// original so that a design equal to stock behaves identically (stock robots never run this: they use the
// prototype).
function dzStep(dt) {
  const z = this.__dz, d = z.design, R = z.R, OMEGA_FREE = z.omegaFree, V_FREE = z.vFree;
  const motorForce = (duty, u, v = 1) => {
    const tau = d.motorStallTorque * (duty * v - u / V_FREE);
    return Math.max(-d.motorStallTorque, Math.min(d.motorStallTorque, tau)) / R;
  };
  const world = this.sim.world;
  const b = this.body;
  const t = b.translation(), q = b.rotation();
  const up = qrot(q, { x: 0, y: 1, z: 0 }), fwd = qrot(q, { x: 1, y: 0, z: 0 });
  const down = scl(up, -1);
  const m = d.mass;
  const k = (m * 9.81 / 4) / SUSP_STATIC, c = 2 * 0.7 * Math.sqrt(k * m / 4);
  let L = 0, Rt = 0;
  if (this.enabled) {
    L = this.cmd.throttle + this.cmd.turn; Rt = this.cmd.throttle - this.cmd.turn;
    const mx = Math.max(1, Math.abs(L), Math.abs(Rt)); L /= mx; Rt /= mx;
  }
  const qGroups = groups(G.ALL, G.ENV | G.STATION);
  this.volts += ((d.volts - d.rInt * this.amps) - this.volts) * Math.min(1, dt * 60);
  const vFrac = Math.max(0.4, this.volts / d.volts);
  let amps = 0;
  const apply = [];
  for (let i = 0; i < 4; i++) {
    const w = this.wheels[i];
    const duty = w.left ? L : Rt;
    const hp = add(t, qrot(q, this.hard[i]));
    const hit = world.castRayAndGetNormal(new RAPIER.Ray(hp, down), SUSP_REST + R, true, undefined, qGroups, undefined, b);
    if (!hit) { w.ground = null; w.load = 0; w.omega += (duty * OMEGA_FREE - w.omega) * Math.min(1, dt * 20); continue; }
    const s = hit.toi - R;
    const p = add(hp, scl(down, hit.toi));
    let n = hit.normal; if (dot(n, up) < 0) n = scl(n, -1);
    const other = hit.collider.parent();
    const otherDyn = other && other.isDynamic();
    let vrel = pointVel(b, p);
    if (otherDyn) vrel = sub(vrel, pointVel(other, p));
    let N = k * (SUSP_REST - s) + c * dot(vrel, down);
    if (N < 0) N = 0;
    let f = sub(fwd, scl(n, dot(fwd, n))); f = norm(f);
    const l = cross(n, f);
    const vl = dot(vrel, f), vlat = dot(vrel, l);
    let Fx = motorForce(duty, vl, vFrac);
    const gl = -9.81 * f.y * dt, glat = -9.81 * l.y * dt;
    if (Math.abs(duty) < 0.05) {
      const fs = -(vl + gl) * (m / 4) / dt - Fx;
      Fx += Math.max(-d.gearHold, Math.min(d.gearHold, fs));
    } else if (Math.abs(vl) > 0.01) Fx -= Math.sign(vl) * d.rollCrr * N;
    let Fy = -(vlat + glat) * (m / 4) / dt * 0.9;
    const lim = d.mu * N;
    let spin = vl / R;
    if (Math.hypot(Fx, Fy) > lim) {
      const fk = d.muKinetic * N;
      const g = (u) => { const sx = u - vl, sl = Math.hypot(sx, vlat) || 1e-9; return motorForce(duty, u, vFrac) - fk * sx / sl; };
      let lo = -3 * V_FREE, hi = 3 * V_FREE;
      for (let it = 0; it < 22; it++) { const mid = (lo + hi) / 2; if (g(mid) > 0) lo = mid; else hi = mid; }
      const u = (lo + hi) / 2, sx = u - vl, sl = Math.hypot(sx, vlat) || 1e-9;
      Fx = fk * sx / sl; Fy = -fk * vlat / sl;
      spin = u / R;
    }
    const F = add(add(scl(f, Fx), scl(l, Fy)), scl(n, N));
    apply.push([F, p, otherDyn ? other : null]);
    w.ground = hit.collider.handle; w.load = N;
    w.omega += (spin - w.omega) * Math.min(1, dt * 30);
    w.amps = d.motorStallAmps * Math.min(1, Math.abs(duty * vFrac - w.omega / OMEGA_FREE)) + (Math.abs(duty) > 0.05 ? 0.25 : 0);
    amps += w.amps;
  }
  this.amps = amps + 0.35;
  b.resetForces(false); b.resetTorques(false);
  for (const [F, p, other] of apply) {
    b.addForceAtPoint(F, p, true);
    if (other) {
      const back = scl(F, -1);
      other.addForceAtPoint(back, p, true);
      const st = other.userData && other.userData.station;
      if (st) st.addLoad(other, p, back);
    }
  }
  if (this.enabled) {
    this.thetaTarget = Math.max(z.armMin * DEG, Math.min(z.armMax * DEG, this.thetaTarget + this.cmd.arm * ROBOT.armRate * DEG * dt));
    const dth = this.thetaTarget - this.theta, mxs = d.servoMax * DEG * dt;
    this.theta += Math.max(-mxs, Math.min(mxs, dth));
    const df = this.fingerTarget - this.finger, mf = ROBOT.fingerRate * dt;
    this.finger += Math.max(-mf, Math.min(mf, df));
    const dtr = this.trayTarget - this.tray, mt = ROBOT.trayRate * dt;
    this.tray += Math.max(-mt, Math.min(mt, dtr));
    if (this.payloadJoint && this.tray > 62) this.releasePayload(true);
    if (this.tray >= ROBOT.trayDump - 0.5) this.trayTarget = 0;
  }
  this.updateMechColliders();
  if (this.coreJoint) this.coreJoint.setAnchor1(this.holdLocal());
  if (this.payloadJoint) this.payloadJoint.setAnchor1(this.trayPointLocal());
  for (const w of this.wheels) w.spin += w.omega * dt;
}

// quick numbers shown beside the form (steady state, no physics)
export function derived(d, P, theta0) {
  const g = armGeom(P, theta0, d);
  const vFree = d.motorFreeRPM * 2 * Math.PI / 60 * d.wheelR;
  const stallPush = 4 * d.motorStallTorque * (d.volts / 12) / d.wheelR;
  const traction = d.mu * d.mass * 9.81;
  let hMax = -Infinity;
  for (let a = g.armMin; a <= d.armMax + 1e-9; a += 0.25) hMax = Math.max(hMax, g.height(a * DEG));
  return { vFree, stallPush, traction, armMin: g.armMin, hMin: g.height(g.armMin * DEG), hMax, ringTopClear: hMax - CORE.h / 2 };
}
export const POLE_TOPS = { star: POLE.star.top, high: POLE.high.top, apex: POLE.apex.top };
