import * as THREE from 'three';
import {
  RAPIER, G, robotBit, groups, qrot, add, sub, scl, dot, cross, norm, pointVel, quatYaw,
} from './physics.js';
import { ROBOT, COLORS, PAYLOAD } from './config.js';
import { CANVAS_FONT } from './config.js';
import { loadRobotModel, buildRobotVisual, TRAY } from './robot-model.js';

export { loadRobotModel };

const DEG = Math.PI / 180;

// ---------------------------------------------------------------- CAD model (shared by all robots)
// ---------------------------------------------------------------- robot geometry (local: +X fwd, +Y up, +Z right)
const R = ROBOT.wheelR;
const SUSP_REST = 0.004;            // spring free length (foam tile + tyre compliance)
const SUSP_STATIC = 0.002;          // static compression
const OMEGA_FREE = ROBOT.motorFreeRPM * 2 * Math.PI / 60;
const V_FREE = OMEGA_FREE * R;      // wheel surface speed at free running
// DC motor at the tyre: torque falls linearly with speed; `v` is the supply as a fraction of the rated voltage
// (the battery sags under load), so stall torque and free speed both scale with it.
function motorForce(duty, u, v = 1) {
  const tau = ROBOT.motorStallTorque * (duty * v - u / V_FREE);
  return Math.max(-ROBOT.motorStallTorque, Math.min(ROBOT.motorStallTorque, tau)) / R;
}

// collider boxes [center, halfExtents], measured on NRL-2026 Robot.step (robot frame, metres)
const CH_BOXES = [
  [[-0.0035, 0.0578, 0], [0.1285, 0.037, 0.1066]],   // base plate, side plates and top plate
  [[-0.0775, 0.1113, 0], [0.0565, 0.0165, 0.111]],   // control hub bay under the PC cover
  [[0.0005, 0.1018, 0], [0.0305, 0.007, 0.028]],     // arm servo tower
  [[0.096, 0.101, -0.0758], [0.022, 0.007, 0.025]],  // front motor towers
  [[0.096, 0.101, 0.0758], [0.022, 0.007, 0.025]],
  // bumper frame: a 4 mm plate loop at 21-25 mm (CAD), given 12 mm of height here so two bumpers meeting
  // edge-on cannot ride over each other, which a solver does far more easily than real aluminium does
  [[0, 0.0268, -0.201], [0.150, 0.006, 0.005]],      // side rails outside the wheels
  [[0, 0.0268, 0.201], [0.150, 0.006, 0.005]],
  // end bars run the full width: the CAD's two half bars left a 14 cm gap at bumper height in the middle, and a robot
  // driven head-on into another slid into it and climbed on top
  [[0.142, 0.036, 0], [0.008, 0.016, 0.206]],
  [[-0.142, 0.036, 0], [0.008, 0.016, 0.206]],
];
const END_BOXES = {                  // gripper parts that follow the parallelogram coupler (pose at CAD angle)
  coupler: [[0.080, 0.1932, 0], [0.008, 0.0325, 0.016]],
  gripBody: [[0.0995, 0.1757, 0], [0.0275, 0.019, 0.035]],
};
// claw fingers (two stacked plates each) as two straight segments in the CAD pose [x, z of the left finger];
// each finger turns about its gear axis
const FINGER = { y: 0.1732, hy: 0.0165, hw: 0.005, segs: [[[0.127, -0.036], [0.161, -0.061]], [[0.161, -0.061], [0.202, -0.054]]] };
export const CHASSIS = { x0: -0.150, x1: 0.150, hz: 0.206 };   // bumper envelope (robot frame)

export class Robot {
  constructor(sim, team, model) {
    this.sim = sim;
    this.id = team.id; this.name = team.name; this.squad = team.squad; this.number = team.number;
    this.team = team;
    this.bit = robotBit(team.id);
    const P = model.meta.pivots;
    this.P = P;
    this.theta0 = model.meta.armAngle0Deg * DEG;
    this.L = model.meta.armLinkLength;
    this.buildVisual(model);
    this.buildPhysics();
    this.reset();
  }

  // ------------------------------------------------------------ visual
  buildVisual(model) {
    const squadCol = this.squad === 'red' ? COLORS.red : COLORS.blue;
    const vis = buildRobotVisual(model, { squadCol, number: this.number });
    const root = vis.root;
    this.vis = vis; this.plate = vis.plate; this.squadCol = squadCol;
    const groupsMap = vis.g;
    // name tag: a constant size on screen, however near or far the robot is
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(this.name, this.number, squadCol), depthTest: false, transparent: true, sizeAttenuation: false }));
    label.scale.set(0.084, 0.021, 1); label.position.set(0, 0.36, 0); label.renderOrder = 10; root.add(label);
    this.label = label;
    this.root = root; this.g = groupsMap;
    this.sim.scene.add(root);
    // driver aid: vertical guide under a held CORE (shows where it will drop)
    const gm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
    this.guide = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 1, 6), gm);
    const dot = new THREE.Mesh(new THREE.RingGeometry(0.0115, 0.0135, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    dot.rotation.x = -Math.PI / 2;
    this.guideDot = dot;
    this.target = new THREE.Mesh(new THREE.RingGeometry(0.051, 0.068, 48), new THREE.MeshBasicMaterial({ color: 0x5dffa8, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide }));
    this.target.rotation.x = -Math.PI / 2; this.target.visible = false; this.target.renderOrder = 4;
    this.sim.scene.add(this.target);
    this.guide.visible = dot.visible = false;
    this.sim.scene.add(this.guide, dot);
  }

  // ------------------------------------------------------------ physics
  buildPhysics() {
    const { world } = this.sim;
    const team = this.team;
    const start = this.startPose();
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(start.x, 0.0005, start.z).setRotation(quatYaw(start.yaw))
      .setCanSleep(false).setCcdEnabled(true).setLinearDamping(0.02).setAngularDamping(0.05)
      .setAdditionalMassProperties(ROBOT.mass, { x: -0.01, y: 0.055, z: 0 }, { x: 0.0295, y: 0.0496, z: 0.0278 }, { x: 0, y: 0, z: 0, w: 1 }));
    this.body.userData = { robot: this };
    const gr = groups(this.bit, G.ALL);
    const ev = RAPIER.ActiveEvents.COLLISION_EVENTS;
    const box = ([c, h], fr = 0.4) => world.createCollider(RAPIER.ColliderDesc.cuboid(h[0], h[1], h[2]).setTranslation(c[0], c[1], c[2])
      .setDensity(0).setFriction(fr).setCollisionGroups(gr).setActiveEvents(ev), this.body);
    // chassis: rounded edges so robots meeting edge-on slide apart instead of catching, aluminium-on-aluminium friction
    const rbox = ([c, h]) => { const r = Math.min(0.006, ...h) * 0.9; return world.createCollider(RAPIER.ColliderDesc.roundCuboid(h[0] - r, h[1] - r, h[2] - r, r)
      .setTranslation(c[0], c[1], c[2]).setDensity(0).setFriction(c[1] < 0.03 ? 0.15 : 0.25).setRestitution(0.1).setCollisionGroups(gr).setActiveEvents(ev), this.body); };
    this.colliders = [];
    this.chassisCols = CH_BOXES.map((b) => rbox(b));
    this.colliders.push(...this.chassisCols);
    // wheels (side contact only; traction comes from the ray-cast wheel model)
    this.hard = [];
    this.wheels = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'].map((k) => {
      const p = this.P[k];
      const c = world.createCollider(RAPIER.ColliderDesc.cylinder(0.015, R - 0.004).setTranslation(p[0], p[1], p[2])
        .setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }).setDensity(0).setFriction(0.6).setCollisionGroups(gr).setActiveEvents(ev), this.body);
      this.colliders.push(c);
      const hard = { x: p[0], y: p[1] + SUSP_STATIC, z: p[2] };
      this.hard.push(hard);
      return { key: k, left: p[2] < 0, collider: c, spin: 0, omega: 0, ground: null, load: 0 };
    });
    // arm + gripper (moving colliders on the robot body)
    const link = () => world.createCollider(RAPIER.ColliderDesc.cuboid(this.L / 2 + 0.012, 0.008, 0.012).setDensity(0).setFriction(0.4).setCollisionGroups(gr).setActiveEvents(ev), this.body);
    this.lowerCol = link(); this.upperCol = link();
    this.endCols = {};
    for (const [k, b] of Object.entries(END_BOXES)) this.endCols[k] = box(b, 0.5);
    // one box per finger segment; side -1 = left (-z), +1 = right (mirror image)
    this.fingerCols = [];
    for (const side of [-1, 1]) for (const [a, b] of FINGER.segs) {
      const half = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2;
      const c = world.createCollider(RAPIER.ColliderDesc.roundCuboid(half - 0.002, FINGER.hy - 0.002, FINGER.hw - 0.002, 0.002).setDensity(0).setFriction(0.35).setCollisionGroups(gr).setActiveEvents(ev), this.body);
      this.fingerCols.push({ c, side, a: [a[0], -side * a[1]], b: [b[0], -side * b[1]] });
    }
    this.coreMechCols = [this.lowerCol, this.upperCol, ...Object.values(this.endCols), ...this.fingerCols.map((f) => f.c)];
    this.colliders.push(...this.coreMechCols);
    this.colliderSet = new Set(this.colliders.map((c) => c.handle));
    this.coreMechSet = new Set(this.coreMechCols.map((c) => c.handle));
    for (const c of this.colliders) this.sim.registerCollider(c, { type: 'robot', robot: this, coreMech: this.coreMechSet.has(c.handle) });
  }

  startPose() {
    const X = this.team.startX;
    const red = this.squad === 'red';
    // touching the field wall (G3.4), inside the 48 x 24 in START ZONE, facing the field
    const Y = red ? 6.0 : 144 - 6.0;
    return { x: (X - 72) * 0.0254, z: (Y - 72) * 0.0254, yaw: red ? -Math.PI / 2 : Math.PI / 2 };
  }

  reset() {
    const s = this.startPose();
    this.releaseCore(false);
    this.releasePayload(false);
    this.body.setTranslation({ x: s.x, y: 0.0005, z: s.z }, true);
    this.body.setRotation(quatYaw(s.yaw), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.theta = this.theta0; this.thetaTarget = this.theta0;
    this.finger = ROBOT.fingerClosed; this.fingerTarget = ROBOT.fingerClosed; this.gripClosed = true;
    this.tray = 0; this.trayTarget = 0;
    this.cmd = { throttle: 0, turn: 0, arm: 0 };
    this.enabled = false;
    this.heldCore = null; this.coreJoint = null;
    this.payloadJoint = null;
    this.contacts = new Map();        // other collider handle -> number of my colliders touching it
    this.pairContacts = new Map();    // other collider handle -> Set(my collider handles)
    this.wheels.forEach((w) => { w.ground = null; w.spin = 0; w.omega = 0; w.amps = 0; });
    this.amps = 0; this.volts = ROBOT.battery.volts;
    this.stationState = 'none'; this.stationSquad = null;
    this.updateMechColliders();
  }

  // team number shown on the number plate (R4) and the name tag
  setNumber(num) {
    if (num === this.number) return;
    this.number = num;
    const swap = (mat, tex) => { if (mat.map) mat.map.dispose(); mat.map = tex; mat.needsUpdate = true; };
    this.vis.setNumber(num);
    swap(this.label.material, labelTexture(this.name, num, this.squadCol));
  }

  // move the robot (and anything it carries) instantly — used by tests / debugging
  teleport(x, z, yaw) {
    const q = quatYaw(yaw);
    this.body.setTranslation({ x, y: 0.001, z }, true); this.body.setRotation(q, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    const carry = (b, local) => { b.setTranslation(this.toWorld(local), true); b.setRotation(q, true); b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true); };
    if (this.heldCore) carry(this.heldCore.body, this.holdLocal());
    if (this.payloadJoint) carry(this.sim.game.payloads[this.id].body, this.trayPointLocal());
  }

  // hold point of the gripper (center of a gripped CORE) in robot-local coords
  holdLocal(theta = this.theta) {
    const h = this.P.holdPoint;
    return { x: h[0] + this.L * (Math.cos(theta) - Math.cos(this.theta0)), y: h[1] + this.L * (Math.sin(theta) - Math.sin(this.theta0)), z: h[2] };
  }
  endOffset() {
    return [this.L * (Math.cos(this.theta) - Math.cos(this.theta0)), this.L * (Math.sin(this.theta) - Math.sin(this.theta0))];
  }
  toWorld(p) { return add(this.body.translation(), qrot(this.body.rotation(), p)); }
  toLocal(p) {
    const q = this.body.rotation();
    return qrot({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, sub(p, this.body.translation()));
  }

  updateMechColliders() {
    const th = this.theta;
    const qz = { x: 0, y: 0, z: Math.sin(th / 2), w: Math.cos(th / 2) };
    const P = this.P;
    const half = this.L / 2;
    this.lowerCol.setTranslationWrtParent({ x: P.armLower[0] + Math.cos(th) * half, y: P.armLower[1] + Math.sin(th) * half, z: 0 });
    this.lowerCol.setRotationWrtParent(qz);
    this.upperCol.setTranslationWrtParent({ x: P.armUpper[0] + Math.cos(th) * half, y: P.armUpper[1] + Math.sin(th) * half, z: 0 });
    this.upperCol.setRotationWrtParent(qz);
    const [dx, dy] = this.endOffset();
    for (const [k, b] of Object.entries(END_BOXES)) this.endCols[k].setTranslationWrtParent({ x: b[0][0] + dx, y: b[0][1] + dy, z: b[0][2] });
    // claws: each finger turns about its gear axis (left opens toward -z, right toward +z)
    for (const f of this.fingerCols) {
      const pv = f.side < 0 ? P.fingerL : P.fingerR;
      const ang = -f.side * this.finger;              // rotation about +y
      const cs = Math.cos(ang), sn = Math.sin(ang);
      const rot = (p) => { const x = p[0] - pv[0], z = p[1] - pv[2]; return [pv[0] + x * cs + z * sn, pv[2] - x * sn + z * cs]; };
      const a = rot(f.a), b = rot(f.b);
      f.c.setTranslationWrtParent({ x: (a[0] + b[0]) / 2 + dx, y: FINGER.y + dy, z: (a[1] + b[1]) / 2 });
      const yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
      f.c.setRotationWrtParent({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
    }
  }

  trayPointLocal() {
    const a = this.tray * DEG;
    // payload center sits 0.055 above tray floor, 0.065 from the hinge
    const lx = 0.065, ly = PAYLOAD.size / 2 + 0.004;
    return { x: TRAY.hinge[0] + lx * Math.cos(a) - ly * Math.sin(a), y: TRAY.hinge[1] + lx * Math.sin(a) + ly * Math.cos(a), z: 0 };
  }

  // ------------------------------------------------------------ per-substep physics
  step(dt) {
    const world = this.sim.world;
    const b = this.body;
    const t = b.translation(), q = b.rotation();
    const up = qrot(q, { x: 0, y: 1, z: 0 }), fwd = qrot(q, { x: 1, y: 0, z: 0 });
    const down = scl(up, -1);
    const m = ROBOT.mass;
    const k = (m * 9.81 / 4) / SUSP_STATIC, c = 2 * 0.7 * Math.sqrt(k * m / 4);
    let L = 0, Rt = 0;
    if (this.enabled) {
      L = this.cmd.throttle + this.cmd.turn; Rt = this.cmd.throttle - this.cmd.turn;
      const mx = Math.max(1, Math.abs(L), Math.abs(Rt)); L /= mx; Rt /= mx;
    }
    const qGroups = groups(G.ALL, G.ENV | G.STATION);
    // battery: the four motors share one pack, so hard acceleration or a pushing match sags the voltage
    // (uses last substep's current, which avoids an algebraic loop at 240 Hz)
    const B = ROBOT.battery;
    this.volts += ((B.volts - B.rInt * this.amps) - this.volts) * Math.min(1, dt * 60);
    const vFrac = Math.max(0.4, this.volts / B.volts);
    let amps = 0;
    // pass 1: evaluate every wheel against the same velocity snapshot; pass 2: apply impulses
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
      // static terms predict this step's gravity pull so a parked robot does not creep
      const gl = -9.81 * f.y * dt, glat = -9.81 * l.y * dt;
      if (Math.abs(duty) < 0.05) { // gearbox back-drive resistance (holds the robot on a tilted station)
        const fs = -(vl + gl) * (m / 4) / dt - Fx;
        Fx += Math.max(-ROBOT.gearHold, Math.min(ROBOT.gearHold, fs));
      } else if (Math.abs(vl) > 0.01) Fx -= Math.sign(vl) * ROBOT.rollCrr * N;   // tyre rolling on soft foam
      let Fy = -(vlat + glat) * (m / 4) / dt * 0.9;
      const lim = ROBOT.mu * N;
      let spin = vl / R;
      if (Math.hypot(Fx, Fy) > lim) {
        // the tyre slides: kinetic friction acts against the slip velocity (the contact patch's motion over the
        // floor), and the wheel spins at the speed where motor torque equals the friction torque. This is what
        // lets a skid-steer robot turn: wheels spinning past the ground speed put their grip into drive force.
        const fk = ROBOT.muKinetic * N;
        const g = (u) => { const sx = u - vl, s = Math.hypot(sx, vlat) || 1e-9; return motorForce(duty, u, vFrac) - fk * sx / s; };
        let lo = -3 * V_FREE, hi = 3 * V_FREE;
        for (let it = 0; it < 22; it++) { const mid = (lo + hi) / 2; if (g(mid) > 0) lo = mid; else hi = mid; }
        const u = (lo + hi) / 2, sx = u - vl, s = Math.hypot(sx, vlat) || 1e-9;
        Fx = fk * sx / s; Fy = -fk * vlat / s;
        spin = u / R;
      }
      const F = add(add(scl(f, Fx), scl(l, Fy)), scl(n, N));
      apply.push([F, p, otherDyn ? other : null]);
      w.ground = hit.collider.handle; w.load = N;
      w.omega += (spin - w.omega) * Math.min(1, dt * 30);
      // motor current follows torque: I = I_stall * |duty·v - ω/ω_free|
      w.amps = ROBOT.motorStallAmps * Math.min(1, Math.abs(duty * vFrac - w.omega / OMEGA_FREE)) + (Math.abs(duty) > 0.05 ? 0.25 : 0);
      amps += w.amps;
    }
    this.amps = amps + 0.35;   // + hub, servos at rest
    // applied as forces so the solver integrates them in every substep, exactly like gravity
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
    // servos (arm, gripper, cargo tray) — powered only while enabled (G1.4, G5.3)
    if (this.enabled) {
      this.thetaTarget = Math.max(ROBOT.armMin * DEG, Math.min(ROBOT.armMax * DEG, this.thetaTarget + this.cmd.arm * ROBOT.armRate * DEG * dt));
      const d = this.thetaTarget - this.theta, mxs = ROBOT.servoMax * DEG * dt;
      this.theta += Math.max(-mxs, Math.min(mxs, d));
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

  // ------------------------------------------------------------ gripper
  toggleGrip() {
    if (!this.enabled) return;
    if (this.gripClosed) { // open
      this.gripClosed = false; this.fingerTarget = ROBOT.fingerOpen;
      this.releaseCore(true);
    } else {
      this.gripClosed = true;
      const core = this.findGrippableCore();
      if (core) { this.attachCore(core); this.fingerTarget = ROBOT.fingerHold; } else { this.fingerTarget = ROBOT.fingerClosed; this.explainMiss(); }
    }
  }
  // the open claws catch a ring anywhere between them and pull it into the cradle as they close
  findGrippableCore(loose = 1) {
    if (this.finger < ROBOT.fingerHold - ROBOT.fingerTol / 3) return null;   // claws must be open wide enough to surround the ring
    const h = this.holdLocal();
    const myUp = qrot(this.body.rotation(), { x: 0, y: 1, z: 0 });
    let best = null, bestD = Infinity;
    for (const core of this.sim.game.cores) {
      if (core.heldBy) continue;
      if (core.golden && !this.sim.game.starburst[core.owner].active) continue; // VAULT locked until STARBURST
      const lp = this.toLocal(core.pos());
      const dx = lp.x - h.x, dy = lp.y - h.y, dz = lp.z - h.z;
      if (dx < -0.04 * loose || dx > 0.03 * loose || Math.abs(dz) > 0.035 * loose || Math.abs(dy) > 0.025 * loose) continue;
      if (Math.abs(dot(core.axis(), myUp)) < Math.cos(35 * DEG)) continue;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = core; }
    }
    return best;
  }
  // tell the driver why the gripper closed on nothing
  explainMiss() {
    const g = this.sim.game, h = this.holdLocal();
    let near = null, nd = Infinity;
    for (const core of g.cores) {
      if (core.heldBy) continue;
      const lp = this.toLocal(core.pos()), d = Math.hypot(lp.x - h.x, lp.z - h.z);
      if (d < nd) { nd = d; near = { core, lp }; }
    }
    if (!near || nd > 0.2) return;
    const { core, lp } = near;
    if (core.golden && !g.starburst[core.owner].active) g.hint('The VAULT stays locked until STARBURST');
    else if (lp.y - h.y < -0.025) g.hint(`${this.name}: lower the arm to reach the CORE`);
    else if (lp.y - h.y > 0.025) g.hint(`${this.name}: raise the arm to reach the CORE`);
    else g.hint(`${this.name}: line the CORE up between the claws`);
  }
  attachCore(core) {
    const world = this.sim.world;
    core.heldBy = this; core.release = null;
    // G4.6: controlling an opponent's CORE is a Minor Foul (once per CORE per robot)
    if (core.owner !== this.squad) { core.foulBy = core.foulBy || new Set(); if (!core.foulBy.has(this.id)) { core.foulBy.add(this.id); this.sim.game.foul(this, 'minor', 'G4.6', `controlled an opponent ${core.golden ? 'GOLDEN ' : ''}CORE`); } }
    core.setFilter(G.ALL & ~this.bit);
    this.heldCore = core;
    this.wakeNear(core);
    this.coreJoint = world.createImpulseJoint(RAPIER.JointData.fixed(this.holdLocal(), { x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }), this.body, core.body, true);
    this.coreJoint.setContactsEnabled(false);
    this.sim.game.onCoreGripped(this, core);
  }
  releaseCore(record) {
    if (!this.heldCore) return;
    const core = this.heldCore;
    if (this.coreJoint) this.sim.world.removeImpulseJoint(this.coreJoint, true);
    this.coreJoint = null; this.heldCore = null;
    core.heldBy = null;
    // the claws swing outward as they open; let the ring fall clear of them before it can touch this robot again
    if (record) { core.setFilter(G.ALL & ~this.bit); core.restoreFilterAt = this.sim.simTime + 0.25; } else core.setFilter(G.ALL);
    if (record) this.sim.game.onCoreReleased(this, core);
    this.wakeNear(core);
  }
  // staged rings start asleep; taking one from a stack (or dropping one onto it) must wake its neighbours,
  // or the rest of a VAULT stack would hang in the air
  wakeNear(core) {
    const p = core.pos();
    for (const c of this.sim.game.cores) {
      if (c === core || !c.body.isSleeping()) continue;
      const q = c.pos();
      if (Math.hypot(q.x - p.x, q.z - p.z) < 0.25) c.body.wakeUp();
    }
  }

  // ------------------------------------------------------------ cargo bay
  cargoAction() {
    if (!this.enabled) return;
    if (this.payloadJoint) { this.trayTarget = ROBOT.trayDump; return; }
    // intake: own PAYLOAD lying just behind the robot
    const pl = this.sim.game.payloads[this.id];
    if (pl.where !== 'field' || !pl.body || this.tray > 5) return;
    const lp = this.toLocal(pl.pos());
    if (lp.x > -0.155 || lp.x < -0.34 || Math.abs(lp.z) > 0.09 || lp.y > 0.09) return;
    this.loadPayload(pl);
  }
  loadPayload(pl) {
    const world = this.sim.world;
    const wp = this.toWorld(this.trayPointLocal());
    pl.spawn(wp, this.body.rotation(), this.body.linvel());
    pl.setFilter(G.ALL & ~this.bit);
    pl.where = 'cargo'; pl.invalid = false; pl.viaCargo = false; pl.outsideTimer = 0;
    this.payloadJoint = world.createImpulseJoint(RAPIER.JointData.fixed(this.trayPointLocal(), { x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }), this.body, pl.body, true);
    this.payloadJoint.setContactsEnabled(false);
  }
  releasePayload(record) {
    if (!this.payloadJoint) return;
    const pl = this.sim.game.payloads[this.id];
    this.sim.world.removeImpulseJoint(this.payloadJoint, true);
    this.payloadJoint = null;
    if (!record) { pl.reset(); return; }
    pl.where = 'field'; pl.viaCargo = true;
    // tip it off the rear lip of the tray
    const back = qrot(this.body.rotation(), { x: -0.55, y: 0.15, z: 0 });
    const v = add(pl.body.linvel(), back);
    pl.body.setLinvel(v, true);
    pl.body.setAngvel(qrot(this.body.rotation(), { x: 0, y: 0, z: 4 }), true);
    pl.restoreFilterAt = this.sim.simTime + 0.35; // stay clear of the tray while it falls away
  }

  // ------------------------------------------------------------ status helpers
  footprint() {
    const front = Math.max(CHASSIS.x1, this.holdLocal().x + 0.05);
    const pts = [[CHASSIS.x0, -CHASSIS.hz], [front, -CHASSIS.hz], [front, CHASSIS.hz], [CHASSIS.x0, CHASSIS.hz]];
    return pts.map(([x, z]) => { const w = this.toWorld({ x, y: 0, z }); return [w.x, w.z]; });
  }
  // the robot's frame and bumpers only (no arm), projected to the floor
  chassisFootprint() {
    return [[CHASSIS.x0, -CHASSIS.hz], [CHASSIS.x1, -CHASSIS.hz], [CHASSIS.x1, CHASSIS.hz], [CHASSIS.x0, CHASSIS.hz]]
      .map(([x, z]) => { const w = this.toWorld({ x, y: 0, z }); return [w.x, w.z]; });
  }
  speed() { const v = this.body.linvel(); return Math.hypot(v.x, v.z); }

  sync() {
    const t = this.body.translation(), q = this.body.rotation();
    this.root.position.set(t.x, t.y, t.z); this.root.quaternion.set(q.x, q.y, q.z, q.w);
    const d = this.theta - this.theta0;
    this.g.armLower.rotation.z = d; this.g.armUpper.rotation.z = d;
    const [dx, dy] = this.endOffset();
    this.g.end.position.set(dx, dy, 0);
    this.g.fingerL.rotation.y = this.finger; this.g.fingerR.rotation.y = -this.finger;
    this.g.tray.rotation.z = this.tray * DEG;
    for (const w of this.wheels) this.g[w.key].rotation.z = -w.spin;
    const cand = !this.heldCore && !this.gripClosed && this.enabled && this.sim.showGuides !== false ? this.findGrippableCore() : null;
    this.target.visible = !!cand;
    if (cand) { const p = cand.pos(); this.target.position.set(p.x, p.y - 0.0145, p.z); }
    const show = !!this.heldCore && this.sim.showGuides !== false;
    this.guide.visible = this.guideDot.visible = show;
    if (show) {
      const c = this.heldCore.pos();
      const hit = this.sim.world.castRay(new RAPIER.Ray({ x: c.x, y: c.y - 0.016, z: c.z }, { x: 0, y: -1, z: 0 }), 2, true, undefined, groups(G.ALL, G.ENV | G.STATION | G.POLE | G.CORE), undefined, this.heldCore.body);
      const d = hit ? hit.toi : c.y;
      this.guide.scale.y = Math.max(0.001, d); this.guide.position.set(c.x, c.y - 0.016 - d / 2, c.z);
      this.guideDot.position.set(c.x, c.y - 0.016 - d + 0.002, c.z);
    }
  }
}

function labelTexture(name, num, col) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(10,12,16,0.78)'; g.beginPath(); g.roundRect(4, 4, 504, 120, 28); g.fill();
  g.fillStyle = '#' + new THREE.Color(col).getHexString(); g.beginPath(); g.roundRect(4, 4, 24, 120, [28, 0, 0, 28]); g.fill();
  g.fillStyle = '#fff'; g.font = `700 56px ${CANVAS_FONT}`; g.textBaseline = 'middle'; g.fillText(`${name}`, 48, 66);
  g.fillStyle = '#c8ccd4'; g.font = `500 48px ${CANVAS_FONT}`; g.textAlign = 'right'; g.fillText(`#${num}`, 490, 66);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
