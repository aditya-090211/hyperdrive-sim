// AI drivers: fill the robots nobody is driving. Each bot drives through the same channels a person does
// (robot.cmd throttle / turn / arm, the gripper and the cargo bay) and its squad's Human Player uses the same
// Game calls as the HP keys, so a bot is bound by the same physics and rules as a human driver.
//
// Layers:
//   Nav     a 74 x 74 cost grid of the field (walls, poles, stations, vaults, forbidden zones) + A* with
//           line-of-sight smoothing; other robots and Payloads are added as costs at query time
//   Bot     one per AI robot: a task (core cycle, payload, golden core, end game) over driving primitives
//           (follow a path, put the claw on a point, turn to a heading)
//   HPBrain one per squad that has a bot: places COREs, loads Payloads, presses STARBURST
//   AI      owns the bots for the current round and shares claims (which CORE / pole slot a bot is going for)
import { ROBOT, CORE, MATCH, FIELD, HALF, POLE, VAULT } from './config.js';
import { pointInPoly, qrot } from './physics.js';

const DEG = Math.PI / 180;
const OPP = { red: 'blue', blue: 'red' };
const V_TOP = ROBOT.motorFreeRPM * 2 * Math.PI / 60 * ROBOT.wheelR;   // free-running wheel speed, m/s
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// arm angles (deg) and where they put the claw: floor pick-up, and a carry / score height per pole type.
// The ring's underside must clear the pole top: star 105 mm, high 130 mm (claw centre 142 / 165 mm, ring half 15 mm)
// High poles: the ring clears the 130 mm cap at 48°, but there the bumper is 34 mm from the pole, inside the
// 47.5 mm radius of rings already on it. So the claw comes in high, stops 2 cm short and drops to 38°, which
// moves it forward onto the pole (bumper 51 mm out) with the ring hole round the domed cap.
const ARM = { floor: ROBOT.armMin, carry: 48, star: 36, high: 38, highIn: 48, climb: 70 };

export const LEVELS = {
  easy: { label: 'Rookie', speed: 0.5, turn: 0.42, tol: 0.0045, think: 0.7, payload: false, golden: false, pattern: false, starburst: false, endMargin: 6 },
  normal: { label: 'Pro', speed: 0.75, turn: 0.55, tol: 0.0035, think: 0.3, payload: true, golden: false, pattern: false, starburst: true, endMargin: 5 },
  hard: { label: 'Champion', speed: 1.0, turn: 0.62, tol: 0.003, think: 0.12, payload: true, golden: true, pattern: true, starburst: true, endMargin: 4 },
};

// ---------------------------------------------------------------- navigation grid
const N = 74, CELL = FIELD / N;
const INF = Infinity;
const ci = (x) => Math.floor((x + HALF) / CELL);
const cx = (i) => -HALF + (i + 0.5) * CELL;
const BLOCK = 60;            // cost of a cell a robot cannot physically be in (still searchable, so a bot that
                             // has been shoved against a pole can plan its way out)

function distToSeg(px, pz, a, b) {
  const abx = b[0] - a[0], abz = b[1] - a[1];
  const t = clamp(((px - a[0]) * abx + (pz - a[1]) * abz) / (abx * abx + abz * abz || 1), 0, 1);
  return Math.hypot(a[0] + abx * t - px, a[1] + abz * t - pz);
}
function distToPoly(px, pz, poly) {
  if (pointInPoly([px, pz], poly)) return 0;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, distToSeg(px, pz, poly[i], poly[(i + 1) % poly.length]));
  return d;
}

class Nav {
  constructor(sim) {
    this.sim = sim;
    this.layers = {};          // squad -> { base, station } cost arrays
  }
  layer(squad) {
    if (this.layers[squad]) return this.layers[squad];
    const F = this.sim.field, opp = OPP[squad];
    const base = new Float32Array(N * N), ownStation = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = cx(i), z = cx(j), k = j * N + i;
      let c = 0;
      const dWall = Math.min(x + HALF, HALF - x, z + HALF, HALF - z);
      if (dWall < 0.215) c += BLOCK * 0.6; else if (dWall < 0.33) c += 2.5 * (0.33 - dWall) / 0.115;
      for (const p of F.poles) {
        if (p.type === 'apex') continue;
        const d = Math.hypot(x - p.x, z - p.z);
        // the claw reaches ~0.3 m ahead of the centre: keep turning room round every pole
        if (d < 0.265) c += BLOCK; else if (d < 0.46) c += 6 * (0.46 - d) / 0.195 * (p.squad === squad ? 1 : 1.5);
      }
      for (const s of ['red', 'blue']) {
        const d = distToPoly(x, z, F.stations[s].footprint);
        // (a robot that grazes a ramp's side edge can climb onto it and hang there with its wheels in the air)
        if (d < 0.26) { if (s === squad) { c += BLOCK; ownStation[k] = 1; } else c = INF; }
        else if (d < 0.4) c += 4;
        const v = F.vaults[s], dv = Math.hypot(x - v.x, z - v.z);
        if (dv < 0.3) c += BLOCK;
      }
      // G4.17: no part of the robot (claw included) may enter the opponent SOURCE ZONE
      if (distToPoly(x, z, F.sourceZones[opp]) < 0.33) c = INF;
      // G4.18 territory: the opponent VAULT ZONE is somewhere to be only when there is no other way at all
      const vz = F.vaultZones[opp];
      if (Math.hypot(x - vz.c[0], z - vz.c[1]) < vz.r + 0.22) c += BLOCK;
      base[k] = c;
    }
    return (this.layers[squad] = { base, ownStation });
  }
  // costs for this query: the static layer plus other robots and Payloads where they are now
  costs(bot, { station = false } = {}) {
    const L = this.layer(bot.squad);
    const cost = L.base.slice();
    if (station) for (let k = 0; k < cost.length; k++) if (L.ownStation[k]) cost[k] -= BLOCK;
    const mark = (x, z, rHard, rSoft, hard, soft) => {
      const i0 = ci(x - rSoft), i1 = ci(x + rSoft), j0 = ci(z - rSoft), j1 = ci(z + rSoft);
      for (let j = Math.max(0, j0); j <= Math.min(N - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(N - 1, i1); i++) {
        const d = Math.hypot(cx(i) - x, cx(j) - z);
        if (d < rHard) cost[j * N + i] += hard; else if (d < rSoft) cost[j * N + i] += soft * (rSoft - d) / (rSoft - rHard);
      }
    };
    for (const o of this.sim.robots) {
      if (o === bot.r || o.benched) continue;
      const t = o.body.translation();
      const extra = bot.avoid.get(o.id) || 0;
      mark(t.x, t.z, 0.43 + extra, 0.66 + extra, o.squad === bot.squad ? 25 : 40, 6);
    }
    // loose rings: a wheel that climbs onto one lifts the robot off the tiles and wedges it
    const target = bot.task && bot.task.core;
    for (const c of this.sim.game.cores) {
      if (c.heldBy || c === target || c.scored === 'pole') continue;
      const t = c.pos();
      if (t.y > 0.06 || t.y < 0 || Math.abs(t.x) > HALF || Math.abs(t.z) > HALF) continue;
      // a ring the bumper meets edge-on is pushed; one the side rails swing over while turning slides under and
      // lifts the chassis off its wheels for good (no drive command frees a fully beached robot), so give every
      // loose ring the robot's full half-width plus the ring's radius
      mark(t.x, t.z, 0.27, 0.4, BLOCK * 0.5, 6);
    }
    for (const p of this.sim.game.payloads) {
      if (!p.body || p.where !== 'field') continue;
      const t = p.pos();
      if (p.squad !== bot.squad) mark(t.x, t.z, 0.3, 0.42, INF, 8);           // G4.19: never touch it
      else if (p.robot !== bot.r || p.scored) mark(t.x, t.z, 0.33, 0.45, BLOCK, 8);   // a claw touch voids it (R9.4)
    }
    return cost;
  }
  // A* from (x0,z0) to (x1,z1); returns world waypoints (smoothed) or null
  plan(bot, x0, z0, x1, z1, opts = {}) {
    const cost = this.costs(bot, opts);
    const s = this.nearestOpen(cost, ci(x0), ci(z0), true), g = this.nearestOpen(cost, ci(x1), ci(z1), false);
    if (s < 0 || g < 0) return null;
    const gScore = new Float32Array(N * N).fill(INF), came = new Int32Array(N * N).fill(-1), closed = new Uint8Array(N * N);
    const heap = new Heap();
    const gi = g % N, gj = (g / N) | 0;
    const h = (k) => { const dx = Math.abs((k % N) - gi), dz = Math.abs(((k / N) | 0) - gj); return (Math.max(dx, dz) + 0.414 * Math.min(dx, dz)); };
    gScore[s] = 0; heap.push(s, h(s));
    let found = false, iter = 0;
    while (heap.size && iter++ < 20000) {
      const k = heap.pop();
      if (closed[k]) continue;
      closed[k] = 1;
      if (k === g) { found = true; break; }
      const i = k % N, j = (k / N) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const nk = nj * N + ni;
        const c = cost[nk];
        if (c === INF || closed[nk]) continue;
        const ng = gScore[k] + (di && dj ? 1.414 : 1) * (1 + c);
        if (ng < gScore[nk]) { gScore[nk] = ng; came[nk] = k; heap.push(nk, ng + h(nk)); }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let k = g; k >= 0; k = came[k]) { cells.push(k); if (k === s) break; }
    cells.reverse();
    // line-of-sight smoothing: skip waypoints while the straight segment stays as cheap as the cells it replaces
    const pts = cells.map((k) => [cx(k % N), cx((k / N) | 0)]);
    pts[0] = [x0, z0];
    pts[pts.length - 1] = cost[ci(x1) + ci(z1) * N] < BLOCK && ci(x1) >= 0 && ci(x1) < N && ci(z1) >= 0 && ci(z1) < N ? [x1, z1] : pts[pts.length - 1];
    const out = [pts[0]];
    let a = 0;
    while (a < pts.length - 1) {
      let b = pts.length - 1;
      while (b > a + 1 && !this.clear(cost, pts[a], pts[b])) b--;
      out.push(pts[b]); a = b;
    }
    let len = 0;
    for (let i = 1; i < out.length; i++) len += Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]);
    return { pts: out, len };
  }
  // a straight segment may replace the path only if it never runs through costlier ground than its ends
  clear(cost, a, b) {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (CELL * 0.5));
    const at = (x, z) => { const i = ci(x), j = ci(z); return i < 0 || j < 0 || i >= N || j >= N ? INF : cost[j * N + i]; };
    const lim = Math.max(at(a[0], a[1]), at(b[0], b[1]), 0.5) + 0.5;
    for (let t = 1; t < n; t++) if (at(a[0] + (b[0] - a[0]) * t / n, a[1] + (b[1] - a[1]) * t / n) > lim) return false;
    return true;
  }
  // the cell itself if it is usable, else the nearest one that is (start: anything but forbidden; goal: cheap)
  nearestOpen(cost, i, j, start) {
    i = clamp(i, 0, N - 1); j = clamp(j, 0, N - 1);
    const ok = (k) => (start ? cost[k] !== INF : cost[k] < BLOCK * 0.5);
    if (ok(j * N + i)) return j * N + i;
    for (let r = 1; r < 14; r++) {
      let best = -1, bd = INF;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const k = nj * N + ni;
        if (ok(k) && di * di + dj * dj < bd) { bd = di * di + dj * dj; best = k; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }
}

class Heap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(k, p) {
    const K = this.k, P = this.p; K.push(k); P.push(p);
    let i = K.length - 1;
    while (i > 0) { const u = (i - 1) >> 1; if (P[u] <= P[i]) break; [K[u], K[i]] = [K[i], K[u]]; [P[u], P[i]] = [P[i], P[u]]; i = u; }
  }
  pop() {
    const K = this.k, P = this.p, top = K[0], lk = K.pop(), lp = P.pop();
    if (K.length) {
      K[0] = lk; P[0] = lp;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < K.length && P[l] < P[m]) m = l;
        if (r < K.length && P[r] < P[m]) m = r;
        if (m === i) break;
        [K[m], K[i]] = [K[i], K[m]]; [P[m], P[i]] = [P[i], P[m]]; i = m;
      }
    }
    return top;
  }
}

// ---------------------------------------------------------------- field knowledge
const flat = (c) => Math.abs(c.axis().y) > 0.93;
function polesOf(sim, squad, type) { return sim.field.poles.filter((p) => p.squad === squad && p.type === type); }
// COREs threaded on a pole, bottom first
function onPole(game, p) {
  return game.cores.filter((c) => !c.heldBy && c.scored === 'pole' && Math.hypot(c.pos().x - p.x, c.pos().z - p.z) < 0.03)
    .sort((a, b) => a.pos().y - b.pos().y);
}
function coreTag(c, squad) { return c.color === squad ? 'C' : c.golden && c.owner === squad ? 'G' : 'X'; }

// ---------------------------------------------------------------- one AI robot
class Bot {
  constructor(ai, robot) {
    this.ai = ai; this.sim = ai.sim; this.r = robot;
    this.squad = robot.squad; this.opp = OPP[robot.squad];
    this.sign = robot.squad === 'red' ? 1 : -1;     // blue's field is red's rotated 180°: world (x, z) -> (-x, -z)
    this.task = null; this.taskT = 0;
    this.path = null; this.goal = null; this.replanAt = 0;
    this.stuckT = 0; this.unstick = 0; this.unstickDir = -1;
    this.avoid = new Map();                          // robot id -> extra clearance after it blocked us
    this.blacklist = new Map();                      // core id -> sim time until which it is ignored
    this.armDeg = ROBOT.armMin; this.claw = 'closed';
    this.idle = 0;                                   // seconds spent deciding (the level's reaction time)
    this.wantPayload = false; this.payloadDone = false;
  }
  get L() { return LEVELS[this.ai.level] || LEVELS.normal; }
  get game() { return this.sim.game; }
  get now() { return this.sim.simTime; }

  // ------------------------------------------------ perception
  pose() {
    const t = this.r.body.translation(), f = qrot(this.r.body.rotation(), { x: 1, y: 0, z: 0 });
    return { x: t.x, z: t.z, h: Math.atan2(f.z, f.x) };
  }
  rate() { return -this.r.body.angvel().y; }     // + = turning right (heading increasing)
  local(x, z, p = this.pose()) {
    const dx = x - p.x, dz = z - p.z, c = Math.cos(p.h), s = Math.sin(p.h);
    return { x: dx * c + dz * s, z: -dx * s + dz * c };
  }
  clawPoint() { const h = this.r.holdLocal(); const w = this.r.toWorld(h); return { x: w.x, z: w.z, lx: h.x }; }
  // squad-relative field point (red frame) -> world
  P(x, z) { return [x * this.sign, z * this.sign]; }

  // ------------------------------------------------ outputs
  out(throttle, turn) { this.cmd.throttle = clamp(throttle, -1, 1); this.cmd.turn = clamp(turn, -1, 1); }
  stop() { this.out(0, 0); }

  // turn command for a heading error a (rad): PD on the yaw rate, with a floor that breaks the tyres' scrub
  steer(a, maxTurn = this.L.turn) {
    const w = this.rate();
    let u = 1.1 * a - 0.11 * w;
    if (Math.abs(a) > 0.02 && Math.abs(u) < 0.14) u = Math.sign(u || a) * 0.14 * Math.min(1, Math.abs(a) / 0.08);
    return clamp(u, -maxTurn, maxTurn);
  }
  // drive toward a world point; returns the distance left. reverse: back into it (the rear leads)
  driveAt(x, z, { speed = this.L.speed, stopDist = 0, slow = 0.4, reverse = false } = {}) {
    const p = this.pose(), l = this.local(x, z, p);
    const d = Math.hypot(l.x, l.z) - stopDist;
    let a = Math.atan2(l.z, l.x);
    // a point just behind us: back onto it instead of spinning round (spinning moves the centre and the
    // bearing to a close point swings with it)
    if (!reverse && d < 0.35 && Math.abs(a) > Math.PI / 2) reverse = true;
    if (reverse) a = wrap(a + Math.PI);
    const turn = this.steer(a);
    const vNow = Math.hypot(this.r.body.linvel().x, this.r.body.linvel().z);
    // speed: braking distance v^2 / 2a with a ~ 2.5 m/s^2, never faster than the level's cap
    const vMax = Math.min(speed * V_TOP, Math.sqrt(2 * 2.5 * Math.max(0, d)) + 0.08, slow > 0 && d < slow ? Math.max(0.25, d / slow) * speed * V_TOP : 9);
    // well off line: turn on the spot first (driving while turning hard orbits a close point instead of reaching it)
    const align = Math.abs(a) > (d < 0.4 ? 0.45 : 1.1) ? 0 : Math.cos(a) ** 3;
    let thr = (vMax / V_TOP) * align;
    if (vNow > vMax + 0.1) thr *= 0.5;
    this.out(reverse ? -thr : thr, turn);
    return d;
  }
  face(h, tol = 2 * DEG) {
    const a = wrap(h - this.pose().h);
    this.out(0, this.steer(a));
    return Math.abs(a) < tol && Math.abs(this.rate()) < 0.25;
  }
  // put the claw (the robot's forward point at local x = lead) exactly on a world point. Returns the remaining
  // error (m). The robot turns so the point lies on its centre line, then creeps along that line.
  place(x, z, lead, { maxThr = 0.22 } = {}) {
    const p = this.pose(), l = this.local(x, z, p);
    const a = Math.atan2(l.z, Math.max(0.05, l.x));
    const ex = l.x - lead, ez = l.z;
    let thr = 0;
    if (Math.abs(ex) > 0.0015) thr = Math.sign(ex) * Math.min(maxThr, 0.055 + 2.2 * Math.abs(ex));
    if (Math.abs(a) > 0.35) thr *= 0.2;
    let turn = 0;
    if (Math.abs(ez) > 0.0012 || Math.abs(this.rate()) > 0.05) {
      const w = this.rate();
      turn = 1.6 * a - 0.12 * w;
      // break the tyres' scrub only when the error is worth it, and never against the current turn
      if (Math.abs(turn) < 0.12 && Math.abs(ez) > 0.003 && Math.sign(a) * w < 0.15) turn = Math.sign(a) * 0.12;
      turn = clamp(turn, -0.4, 0.4);
    }
    this.out(thr, turn);
    return { ex, ez, err: Math.hypot(ex, ez) };
  }
  // follow a planned path to (x, z); returns true on arrival within tol
  goto(x, z, { tol = 0.06, speed = this.L.speed, station = false, reverse = false } = {}) {
    const p = this.pose();
    const dGoal = Math.hypot(x - p.x, z - p.z);
    const g = this.goal;
    const same = g && Math.hypot(g[0] - x, g[1] - z) < 0.02;
    // arrival latches until we drift well away, so turning on the spot afterwards does not restart the drive
    if (dGoal < tol || (same && this.arrived && dGoal < tol * 2)) { this.stop(); this.path = null; this.goal = [x, z]; this.arrived = true; return true; }
    this.arrived = false;
    if (!this.path || !g || Math.hypot(g[0] - x, g[1] - z) > 0.05 || this.now > this.replanAt) {
      this.path = this.ai.nav.plan(this, p.x, p.z, x, z, { station });
      this.goal = [x, z]; this.replanAt = this.now + 0.5;
      if (!this.path) { this.driveAt(x, z, { speed: speed * 0.5, reverse }); return false; }
    }
    // carrot: the first waypoint more than 0.22 m away (skipping ones we are already past)
    const pts = this.path.pts;
    while (pts.length > 2 && Math.hypot(pts[1][0] - p.x, pts[1][1] - p.z) < 0.18) pts.splice(1, 1);
    const last = pts.length <= 2;
    const tgt = pts[Math.min(1, pts.length - 1)];
    this.driveAt(tgt[0], tgt[1], { speed, slow: last ? 0.45 : 0, reverse });
    return false;
  }

  // ------------------------------------------------ mechanisms
  setArm(deg) { this.armDeg = deg; }
  // lowering the claw onto a ring levers the front wheels off the tiles: only go down over clear floor.
  // except: the ring we are reaching for, once it is beyond the claw tips
  lowerArm(except = null) {
    const r = this.r;
    const blocked = this.game.cores.some((c) => {
      if (c.heldBy) return false;
      const l = r.toLocal(c.pos());
      if (l.y > 0.06 || l.y < -0.05 || Math.abs(l.z) > 0.12 || l.x < 0.09 || l.x > 0.34) return false;
      return c !== except || l.x < r.holdLocal(ROBOT.armMin * DEG).x + 0.075;
    });
    if (!blocked || r.theta < 0) this.setArm(ARM.floor);
    else if (r.theta / DEG < ARM.carry - 1) this.setArm(Math.max(this.armDeg, 30));
    return !blocked;
  }
  armAt(tol = 3) { return Math.abs(this.r.theta / DEG - this.armDeg) < tol; }
  open() { this.claw = 'open'; }
  // close the claws; grabs the CORE between them only if it is our own (G4.6)
  grab() {
    const r = this.r;
    if (r.gripClosed) return !!r.heldCore;
    const c = r.findGrippableCore();
    r.gripClosed = true;
    if (c && c.owner === this.squad) { r.attachCore(c); r.fingerTarget = ROBOT.fingerHold; this.claw = 'closed'; return true; }
    r.fingerTarget = ROBOT.fingerClosed; this.claw = 'closed';
    return false;
  }
  clawOpen() { return !this.r.gripClosed && this.r.finger > ROBOT.fingerHold + 0.1; }
  applyMech(dt) {
    const r = this.r;
    this.cmd.arm = clamp((this.armDeg * DEG - r.thetaTarget) / (ROBOT.armRate * DEG * Math.max(dt, 1e-3)), -1, 1);
    if (this.claw === 'open' && r.gripClosed) r.toggleGrip();
  }

  // ------------------------------------------------ main loop
  update(dt) {
    const r = this.r;
    this.cmd = { throttle: 0, turn: 0, arm: 0 };
    if (!r.enabled || this.game.state !== 'running') { r.cmd = this.cmd; return; }
    this.taskT += dt;
    if (this.unstick > 0) this.doUnstick(dt);
    else {
      if (!this.task || this.task.done) { this.task = null; this.idle = (this.idle || 0) + dt; if (this.idle >= this.L.think || this.endgameDue()) { this.idle = 0; this.task = this.choose(); } }
      if (this.task) {
        const res = this.task.step(this, dt);
        if (res !== 'run') { this.task.done = true; this.task.result = res; this.release(); }
      }
      if (!(this.task && this.task.noStuck)) this.watchStuck(dt);
    }
    this.applyMech(dt);
    r.cmd = this.cmd;
  }
  release() { this.ai.unclaim(this); }

  // commanding motion but not moving: back away, then plan round whatever stopped us (also how a bot
  // stays clear of G4.9 pinning: it never keeps pushing into a robot)
  watchStuck(dt) {
    const v = this.r.body.linvel(), sp = Math.hypot(v.x, v.z);
    const trying = Math.abs(this.cmd.throttle) > 0.12 && sp < 0.05 || Math.abs(this.cmd.turn) > 0.25 && Math.abs(this.rate()) < 0.15 && sp < 0.05;
    const touching = this.sim.robots.find((o) => o !== this.r && this.game.robotsInContact(this.r, o));
    // beached: a ring under the chassis has lifted wheels off the tiles
    const grounded = this.r.wheels.filter((w) => w.ground !== null).length;
    this.beachT = grounded < 3 && this.r.stationState === 'none' ? (this.beachT || 0) + dt : 0;
    if (trying) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    const limit = touching && touching.squad !== this.squad ? 0.6 : 1.0;
    // (repeated attempts space out: a robot sitting on a ring is not going anywhere, and flailing pushes rings about)
    if (this.beachT > 0.3 + Math.min(4, (this.beached || 0) * 1.5)) {
      this.beachT = 0; this.beached = (this.beached || 0) + 1; this.unstick = 1.5; this.wiggle = true; this.path = null;
      // let go of whatever we were after so a teammate can have it, and choose afresh once free
      this.release(); if (this.task && !(this.task instanceof StationTask)) this.task = null;
      // reverse only if nothing that can hang us up is behind (a station side, a wall)
      const back = this.r.toWorld({ x: -0.45, y: 0, z: 0 });
      const st = this.sim.field.stations;
      this.escapeDir = ['red', 'blue'].some((q) => distToPoly(back.x, back.z, st[q].footprint) < 0.05) || Math.max(Math.abs(back.x), Math.abs(back.z)) > HALF - 0.05 ? 1 : -1;
      return;
    }
    if (grounded === 4) this.beached = 0;
    for (const [id, v] of this.avoid) { if (v <= dt * 0.02) this.avoid.delete(id); else this.avoid.set(id, v - dt * 0.02); }
    // G4.9: never stay locked against an opponent (pinning is judged after 3 s): back off whichever way is
    // away from it, and give it a wider berth next time
    const opp = touching && touching.squad !== this.squad ? touching : null;
    this.oppT = opp ? (this.oppT || 0) + dt : 0;
    if (opp && this.oppT > 1.2) {
      const q = opp.body.translation(), l = this.local(q.x, q.z);
      this.oppT = 0; this.stuckT = 0; this.wiggle = false;
      this.unstick = 0.6; this.unstickDir = l.x > 0 ? -1 : 1;
      this.avoid.set(opp.id, Math.min(0.35, (this.avoid.get(opp.id) || 0) + 0.12));
      this.path = null;
      return;
    }
    if (this.stuckT > limit) {
      this.stuckT = 0;
      this.unstick = 0.45; this.wiggle = false;
      this.unstickDir = this.cmd.throttle > 0 ? -1 : 1;
      if (touching) this.avoid.set(touching.id, Math.min(0.35, (this.avoid.get(touching.id) || 0) + 0.12));
      this.path = null;
    }
  }
  doUnstick(dt) {
    this.unstick -= dt;
    // beached: rock back and forth with the turn swapping so the wheels find the tiles again
    // (the claw comes up first: an arm resting on a ring is the usual reason the wheels lost the tiles)
    // measured on a beached robot: a straight full reverse is the only move that ever got wheels back on the tiles
    if (this.wiggle) {
      this.setArm(ARM.carry);
      const e = this.escapeDir || -1;
      if (this.unstick > 1.2) this.stop(); else if (this.unstick > 0.6) this.out(e, 0); else this.out(-0.6 * e, 0);
    }
    else this.out(this.unstickDir * 0.45, 0.25);
    if (this.unstick <= 0) { this.path = null; if (this.task && this.task.stuck) this.task.stuck(this); }
  }

  // ------------------------------------------------ strategy
  choose() {
    const g = this.game, L = this.L;
    this.taskT = 0;
    if (this.endgameDue()) return new StationTask(this);
    const pl = g.payloads[this.r.id];
    // (after two failed tries the Payload just rides along in the tray: it scores nothing there, but costs nothing)
    if (this.r.payloadJoint && !this.r.heldCore && (this.dumpFails || 0) < 2) return new DumpPayloadTask(this);
    if (this.r.heldCore) return new ScoreTask(this, this.r.heldCore);
    if (L.golden && g.starburst[this.squad].active && this.goldenWanted()) return new GoldenTask(this);
    this.wantPayload = L.payload && pl.where === 'hp' && !this.payloadDone && g.mode === 'match' && !this.teammateWantsPayload();
    return new CycleTask(this);
  }
  teammateWantsPayload() { return false; }
  // End Game: one robot per squad parks and levels the deck (15). A second robot on the deck was measured to
  // cost more than it adds: it stalls at the ramp crest or tips the first robot off level, so it keeps scoring
  // rings to the buzzer instead. A teammate (bot or driver) already on the station takes our turn.
  endgameDue() {
    const g = this.game;
    if (g.mode !== 'match') return false;
    if (this.task instanceof StationTask) return true;
    const mates = this.sim.robots.filter((o) => o !== this.r && o.squad === this.squad);
    if (mates.some((o) => o.stationSquad === this.squad && o.stationState !== 'none' || this.ai.bots.get(o.id)?.task instanceof StationTask)) return false;
    const st = this.sim.field.stations[this.squad], t = this.r.body.translation();
    const d = Math.hypot(t.x - st.cx, t.z - st.cz);
    return g.remaining < d / (this.L.speed * V_TOP * 0.5) + 13 + this.L.endMargin;
  }
  goldenWanted() {
    if (this.game.cores.every((c) => !c.golden || c.owner !== this.squad || c.scored || c.heldBy)) return false;
    return this.starSlots('G').length > 0;
  }
  // own star poles whose next slot (bottom up) wants tag t ('C' or 'G') for the STAR MAP pattern
  starSlots(t) {
    const g = this.game, want = [...g.starMap].reverse();
    return polesOf(this.sim, this.squad, 'star').filter((p) => {
      const list = onPole(g, p);
      if (list.length >= p.capacity) return false;
      if (this.L.pattern && list.some((c, i) => coreTag(c, this.squad) !== want[i])) return t === 'C';   // pattern broken: just fill it
      return !this.L.pattern ? t === 'C' : want[list.length + this.ai.claimsOn(p, this)] === t;
    });
  }
}

// ---------------------------------------------------------------- tasks
// each task is a small state machine; step() returns 'run', 'done' or 'fail'
class CycleTask {
  constructor(bot) { this.bot = bot; this.state = 'pick'; this.core = null; this.t = 0; this.stucks = 0; }
  // shoved off line or wedged: come in again from a fresh stand-off (twice), then try another ring
  stuck(b) {
    if (!this.core || (this.state !== 'final' && this.state !== 'approach')) return;
    if (++this.stucks > 2) { b.blacklist.set(this.core.id, b.now + 8); this.state = 'pick'; this.stucks = 0; return; }
    this.dir = b.ai.approachFor(b, this.core); this.state = 'approach'; this.t = 0;
  }
  step(b, dt) {
    this.t += dt;
    if (b.endgameDue()) return 'done';
    if (this.state === 'pick') {
      this.core = b.ai.pickCore(b);
      if (this.core) { b.ai.claim(b, this.core); this.dir = b.ai.approachFor(b, this.core); this.state = 'approach'; this.t = 0; }
      else { this.state = 'wait'; this.t = 0; }
    }
    if (this.state === 'wait') {
      // nothing loose on the field: wait beside our Source Zone for the Human Player (G4.10 keeps us out of it)
      const mate = b.r.id % 2;                      // teammates wait on different spots
      const [x, z] = b.P(mate ? -0.95 : -1.2, mate ? 1.3 : 1.05);
      b.setArm(ARM.carry);
      if (b.goto(x, z, { tol: 0.1 })) b.face(Math.atan2(1.6 * b.sign - z, -1.6 * b.sign - x));
      if (this.t > 0.4) { this.state = 'pick'; this.t = 0; }
      return 'run';
    }
    const c = this.core;
    if (!c || c.heldBy && c.heldBy !== b.r || c.scored || c.pos().y > 0.05 || !flat(c)) {
      if (b.r.heldCore) return 'done';
      this.state = 'pick'; return 'run';
    }
    return grabCore(this, b, dt, c, { approachDir: this.dir });
  }
}

// shared by the CORE cycle and the golden task: line up, open, put the claw on the ring, close, lift
function grabCore(task, b, dt, c, { approachDir = null } = {}) {
  const cp = c.pos();
  if (task.state === 'approach') {
    // stand-off point 0.55 m back from the ring along the approach direction
    const p = b.pose();
    let ux = cp.x - p.x, uz = cp.z - p.z;
    if (approachDir) [ux, uz] = approachDir;
    const n = Math.hypot(ux, uz) || 1; ux /= n; uz /= n;
    const sx = cp.x - ux * 0.55, sz = cp.z - uz * 0.55;
    const dCore = Math.hypot(cp.x - p.x, cp.z - p.z);
    // close enough and already coming in along the chosen line: no need to visit the stand-off point itself
    const inLine = dCore < 0.62 && ((cp.x - p.x) * ux + (cp.z - p.z) * uz) / dCore > 0.9;
    if (dCore < 0.9) b.lowerArm(c); else b.setArm(ARM.carry);
    if (inLine || b.goto(sx, sz, { tol: 0.1 })) { task.state = 'final'; task.t = 0; }
    if (task.t > 9) { b.blacklist.set(c.id, b.now + 6); task.state = 'pick'; }
    return 'run';
  }
  if (task.state === 'final') {
    b.lowerArm(c); b.open();
    const lead = b.r.holdLocal().x;
    const l = b.local(cp.x, cp.z);
    if (!b.armAt(4) || !b.clawOpen()) { b.place(cp.x, cp.z, lead + 0.12, { maxThr: 0.25 }); return 'run'; }
    b.place(cp.x, cp.z, lead - 0.004, { maxThr: l.x > lead + 0.15 ? 0.32 : 0.16 });
    // the same test that lights the driver's green target ring
    if (b.r.findGrippableCore() === c) {
      if (b.grab()) { task.state = 'lift'; task.t = 0; } else { task.state = 'approach'; }
    }
    // on the ring but the claws cannot take it (tilted, wedged): give it up for a while
    const there = Math.abs(l.x - lead) < 0.008 && Math.abs(l.z) < 0.008 && b.r.speed() < 0.02;
    task.stall = there ? (task.stall || 0) + dt : 0;
    if (task.t > 6 || l.x < 0.05 || task.stall > 0.8) { b.blacklist.set(c.id, b.now + 5); task.state = 'pick'; b.setArm(ARM.carry); }
    return 'run';
  }
  if (task.state === 'lift') {
    b.stop();
    b.setArm(ARM.carry);
    if (!b.r.heldCore) { task.state = 'pick'; return 'run'; }
    if (b.r.theta / DEG > 10) return 'done';
    return 'run';
  }
  return 'run';
}

class ScoreTask {
  constructor(bot, core) { this.bot = bot; this.core = core; this.state = 'choose'; this.t = 0; this.pole = null; }
  step(b, dt) {
    this.t += dt;
    const c = this.core;
    if (this.state !== 'release' && this.state !== 'check' && b.r.heldCore !== c) return 'fail';
    if (this.state === 'choose') {
      this.pole = b.ai.pickPole(b, c);
      if (!this.pole) {                                          // every pole full: the Drop Zone still pays
        this.pole = null; this.state = 'drop'; this.t = 0;
      } else { b.ai.claim(b, this.pole); this.state = 'approach'; this.t = 0; }
    }
    if (this.state === 'drop') {
      const [x, z] = b.P(-1.5, -1.5);
      b.setArm(ARM.carry);
      const p = b.pose();
      if (b.goto(x, z, { tol: 0.1 })) {
        if (b.face(Math.atan2(-1.75 * b.sign - p.z, -1.75 * b.sign - p.x), 6 * DEG)) { b.setArm(ARM.floor); if (b.armAt(5)) { b.open(); return 'done'; } }
      }
      return 'run';
    }
    const p = this.pole;
    const high = p.type === 'high';
    const arm = high ? ARM.high : ARM.star, armIn = high ? ARM.highIn : ARM.star;
    const lead = b.r.holdLocal(armIn * DEG).x;
    if (b.endgameDue() && this.state === 'approach' && this.t > 0.5) return 'done';   // keep the ring, go park
    if (this.state === 'approach') {
      // star poles stand 0.3 m off our wall: line up facing the wall. High poles: from whichever side we are on
      if (!this.dir) this.dir = p.type === 'star' ? { ux: 0, uz: -b.sign, off: lead + 0.32 } : b.ai.poleApproach(b, p, lead);
      const { ux, uz, off } = this.dir;
      const sx = p.x - ux * off, sz = p.z - uz * off;
      b.setArm(armIn);
      if (b.goto(sx, sz, { tol: 0.05 })) { if (b.face(Math.atan2(uz, ux), 4 * DEG)) { this.state = high ? 'close' : 'align'; this.t = 0; } }
      if (this.t > 10) { b.ai.unclaim(b); this.state = 'choose'; this.dir = null; }
      return 'run';
    }
    if (this.state === 'close') {
      // claw high, 2 cm short of the pole: the ring's leading edge is over the cap, the bumper clear of the stack
      b.setArm(armIn);
      const e = b.place(p.x, p.z, b.r.holdLocal().x + (b.r.holdLocal(arm * DEG).x - b.r.holdLocal(armIn * DEG).x), { maxThr: 0.2 });
      if (b.armAt(1.5) && e.err < 0.004 && b.r.speed() < 0.03) { this.state = 'align'; this.t = 0; }
      if (this.t > 6) { this.state = 'approach'; this.t = 0; this.dir = null; }
      return 'run';
    }
    if (this.state === 'align') {
      b.setArm(arm);
      if (!b.armAt(1.5)) { b.stop(); return 'run'; }
      const e = b.place(p.x, p.z, b.r.holdLocal().x, { maxThr: 0.2 });
      const sp = b.r.speed();
      const tol = this.t > 4 ? b.L.tol * 2 : b.L.tol;
      if (b.armAt(1.5) && e.err < tol && sp < 0.02 && Math.abs(b.rate()) < 0.05) { b.stop(); b.open(); this.state = 'release'; this.t = 0; }
      if (this.t > 7) { this.state = 'approach'; this.t = 0; this.dir = null; }
      return 'run';
    }
    if (this.state === 'release') {
      b.stop();
      if (this.t > 0.45) { this.state = 'back'; this.t = 0; }
      return 'run';
    }
    if (this.state === 'back') {
      b.out(-0.25, 0);
      if (this.t > 0.45) { b.stop(); this.state = 'check'; this.t = 0; }
      return 'run';
    }
    if (this.state === 'check') {
      b.stop();
      if (this.t < 0.2) return 'run';
      if (c.scored === 'pole') return 'done';
      b.blacklist.set(c.id, b.now + 30);
      return 'fail';
    }
    return 'run';
  }
}

// golden COREs: the bottom ring of the VAULT stack sits under the tube (the tube starts 45 mm up). Face the
// wall, put the claw on it at floor height, close and back straight out.
class GoldenTask {
  constructor(bot) { this.bot = bot; this.state = 'go'; this.t = 0; this.core = null; }
  step(b, dt) {
    this.t += dt;
    if (b.endgameDue()) return 'done';
    const v = b.sim.field.vaults[b.squad];
    const uz = b.sign;           // toward our vault's wall
    if (this.state === 'go') {
      b.setArm(ARM.carry);
      if (!b.goldenWanted()) return 'done';
      if (b.goto(v.x, v.z - uz * 0.75, { tol: 0.06 })) { if (b.face(Math.atan2(uz, 0), 3 * DEG)) { this.state = 'final'; this.t = 0; } }
      if (this.t > 12) return 'fail';
      return 'run';
    }
    if (this.state === 'final') {
      const bottom = b.game.cores.filter((c) => c.golden && c.owner === b.squad && !c.heldBy && Math.hypot(c.pos().x - v.x, c.pos().z - v.z) < 0.03)
        .sort((a, c) => a.pos().y - c.pos().y)[0];
      if (!bottom) return 'fail';
      this.core = bottom;
      b.setArm(ARM.floor); b.open();
      const lead = b.r.holdLocal().x;
      if (!b.armAt(4) || !b.clawOpen()) { b.place(v.x, v.z, lead + 0.15); return 'run'; }
      const e = b.place(v.x, v.z, lead + 0.003, { maxThr: 0.16 });
      if (b.r.findGrippableCore() === bottom && Math.abs(e.ez) < 0.01) { if (b.grab()) { this.state = 'out'; this.t = 0; } }
      if (this.t > 6) { this.state = 'go'; this.t = 0; }
      return 'run';
    }
    if (this.state === 'out') {
      b.setArm(ARM.floor);
      b.out(-0.18, 0);
      if (!b.r.heldCore) return 'fail';
      if (this.t > 0.9) { b.stop(); b.setArm(ARM.carry); return 'done'; }
      return 'run';
    }
    return 'run';
  }
}

// back the Cargo Bay into our Drop Zone corner and tip the Payload out
class DumpPayloadTask {
  constructor(bot) { this.bot = bot; this.state = 'go'; this.t = 0; this.total = 0; }
  // corner is ours now (the teammate waits outside while we are in it)
  get inCorner() { return this.state !== 'go' || this.near; }
  step(b, dt) {
    this.t += dt; this.total += dt;
    if (!b.r.payloadJoint) { b.payloadDone = true; return 'done'; }
    // rear to the corner, facing diagonally out: the Payload lands 0.236 m nearer each wall than the robot centre
    // (measured; it scores with the robot 4 cm or 6° off). Teammates use two spots 0.18 m apart so the second
    // Payload never lands on the first: (0.25, 0.12) and (0.12, 0.25) m from the two walls.
    const s = b.sign, [ku, kv] = b.r.id % 2 ? [0.356, 0.486] : [0.486, 0.356];
    const [x, z] = [(-HALF + ku) * s, (-HALF + kv) * s];
    const hOut = Math.atan2(s, s);                     // facing out of the corner
    const p = b.pose(), d = Math.hypot(p.x - x, p.z - z);
    if (this.total > 20) { b.dumpFails = (b.dumpFails || 0) + 1; return 'fail'; }
    if (b.endgameDue() && this.state === 'go') return 'done';
    // line up 0.35 m out on the spot's diagonal facing out of the corner, then reverse straight onto the spot
    // (turning on the spot near the walls scrubs the robot 5-10 cm sideways, more than the landing allows)
    const px = x + Math.cos(hOut) * 0.35, pz = z + Math.sin(hOut) * 0.35;
    if (this.state === 'go') {
      b.setArm(ARM.carry);
      // one robot in the corner at a time: wait a metre out while the teammate dumps
      const busy = [...b.ai.bots.values()].some((o) => o !== b && o.squad === b.squad && o.task instanceof DumpPayloadTask && o.task.inCorner);
      this.near = Math.hypot(p.x - px, p.z - pz) < 0.5 && !busy;
      if (busy && d < 1.0) { b.goto((-HALF + 1.0) * s, (-HALF + 1.0) * s, { tol: 0.15 }); return 'run'; }
      if (b.goto(px, pz, { tol: 0.04 })) { this.state = 'turn'; this.t = 0; }
      return 'run';
    }
    if (this.state === 'turn') {
      if (Math.hypot(p.x - px, p.z - pz) > 0.12) { this.state = 'go'; return 'run'; }
      if (b.face(hOut, 2 * DEG)) { this.state = 'back'; this.t = 0; }
      return 'run';
    }
    if (this.state === 'back') {
      const left = b.driveAt(x, z, { speed: 0.3, reverse: true, slow: 0.25 });
      if (left < 0.015 || (this.t > 3 && d < 0.04)) {
        b.stop();
        if (Math.abs(wrap(hOut - p.h)) < 6 * DEG && b.r.speed() < 0.03) { this.state = 'dump'; this.t = 0; }
      }
      if (this.t > 5 || d > 0.5) { this.state = 'go'; this.t = 0; }
      return 'run';
    }
    if (this.state === 'dump') {
      b.stop();
      if (this.t > 0.15 && b.r.tray < 1) b.r.cargoAction();
      if (this.t > 2) return 'fail';
      return 'run';
    }
    return 'run';
  }
}

// End Game: square up on our own ramp, take it with momentum, park on the deck and bring it level.
// Measured on this robot: hitting the ramp a few degrees skew leaves it on two diagonal wheels at the toe,
// and creeping in stalls it on the 33° face, so it lines up 0.6 m out and arrives at speed.
class StationTask {
  constructor(bot) { this.bot = bot; this.state = 'go'; this.t = 0; this.side = null; this.noStuck = false; }
  step(b, dt) {
    this.t += dt;
    const st = b.sim.field.stations[b.squad];
    if (!this.side) this.side = b.pose().z < st.cz ? -1 : 1;   // the ramp on our side of the pivot
    const sz = this.side;                                // ramp at cz + sz * 0.69; we drive toward -sz
    const ax = st.cx, h = Math.atan2(-sz, 0);
    const runUp = st.cz + sz * (0.686 + 0.62);
    const p = b.pose(), lat = p.x - ax;
    const prog = (p.z - st.cz) * -sz;                    // how far past the pivot, along our direction of travel
    const y = b.r.body.translation().y;
    const onSt = b.r.stationSquad === b.squad && b.r.stationState !== 'none';
    const docked = onSt && (b.r.stationState === 'dock' || b.r.stationState === 'balance');
    // heading that steers us back onto the ramp's centre line
    const head = (k, lim) => wrap(h - sz * clamp(k * lat, -lim, lim) - p.h);
    const tz = 0;                                        // park over the pivot
    this.noStuck = this.state === 'run' || this.state === 'park' || this.state === 'hold';
    b.setArm(ARM.climb);
    if (this.state === 'go') {
      if (b.r.stationState !== 'none' && y < 0.1) { this.state = 'retreat'; this.t = 0; return 'run'; }   // caught on a ramp toe
      if (b.goto(ax, runUp, { tol: 0.06 })) { this.state = 'line'; this.t = 0; }
      return 'run';
    }
    if (this.state === 'line') {
      if (Math.abs(lat) > 0.09) { this.state = 'go'; return 'run'; }
      const a = head(4, 0.35);
      b.out(0, b.steer(a));
      if ((Math.abs(a) < 1.5 * DEG && Math.abs(b.rate()) < 0.15 && Math.abs(lat) < 0.03) || this.t > 3) { this.state = 'run'; this.t = 0; }
      return 'run';
    }
    if (this.state === 'run') {
      b.out(y > 0.1 ? 0.62 : 0.8, b.steer(head(2.5, 0.25), 0.18));
      if (y > 0.15 && onSt) { this.state = 'park'; this.t = 0; }
      // balked at the toe: back out to the run-up and go again
      if (this.t > 0.8 && b.r.speed() < 0.05 && y < 0.1) { this.state = 'retreat'; this.t = 0; }
      if (this.t > 4) { this.state = onSt && y > 0.08 ? 'park' : 'go'; this.t = 0; }
      return 'run';
    }
    if (this.state === 'retreat') {
      b.out(-0.5, 0);
      if (this.t > 0.6) { this.state = 'go'; this.t = 0; }
      return 'run';
    }
    // on the deck: drive along it to a spot (forward = +prog). Up a 15° deck it takes a firm push (anything
    // under ~0.4 stalls), and near the spot it brakes on its own speed so a deck that flips under it does not
    // throw it past; inside the deadband the gearboxes hold it (they do up to ~17°)
    const along = (target) => {
      const e = target - prog;
      const f = qrot(b.r.body.rotation(), { x: 1, y: 0, z: 0 }), v = b.r.body.linvel();
      const vf = v.x * f.x + v.y * f.y + v.z * f.z;
      const steer = b.steer(head(1.5, 0.15), 0.12);
      if (Math.abs(e) < 0.012) { b.out(Math.abs(vf) > 0.06 ? -0.4 * Math.sign(vf) : 0, steer); return true; }
      const uphill = f.y * Math.sign(e) > 0.05;
      const lo = uphill ? 0.44 : 0.18;
      let thr = Math.sign(e) * clamp(lo + 1.6 * Math.abs(e), lo, 0.58);
      if (Math.abs(e) < 0.06) thr -= 0.8 * vf / V_TOP * (vf * e > 0 ? 1 : 0) * 4;
      b.out(clamp(thr, -0.6, 0.6), steer);
      return false;
    };
    if (!onSt && y < 0.04) { this.state = 'go'; this.t = 0; return 'run'; }   // fell off
    if (this.state === 'park') {
      const there = along(tz);
      if (docked && (there || Math.abs(tz - prog) < 0.03)) { this.state = 'hold'; this.t = 0; }
      if (this.t > 6 && !docked) { this.state = 'retreat'; this.t = 0; }
      return 'run';
    }
    if (this.state === 'hold') {
      const tilt = st.tilt(), w = st.deckBody.angvel().x;
      // every level balances: at the buzzer the robots go limp, and on a deck at its 15° stop a parked robot
      // slides down and off the low end before the score is final (a level deck is the only place it stays)
      if (Math.abs(tilt) > STATION_LEVEL) {
        // a stuck deck: lean toward its high end (+tilt drops the +z end) until it starts to swing, then
        // come back over the pivot so the bearing's friction catches it level. The pivot holds while the
        // robot is within ~3.5 cm of it, and a robot standing 12 cm above the pivot on a tilted deck already
        // leans its weight a further 3 cm toward the low end, so a steep deck needs the bigger lean.
        const high = sz * Math.sign(tilt);
        const swinging = Math.abs(w) > 0.03 && w * tilt < 0;
        // if the deck still does not move with us out on the lean, lean further (a ring on the deck, or the
        // claw's load, shifts where it lets go)
        const base = Math.abs(tilt) > 6 * DEG ? 0.085 : 0.05;
        if (swinging) this.lean = 0;
        const out = this.lean || base;
        const target = tz + high * out;
        along(swinging ? tz : target);
        this.leanT = !swinging && Math.abs(target - prog) < 0.02 ? (this.leanT || 0) + dt : 0;
        if (this.leanT > 0.7) { this.lean = Math.min(0.15, out + 0.015); this.leanT = 0; }
      } else if (Math.abs(tz - prog) > 0.05) along(tz);
      else b.out(0, 0);
      if (!docked) { this.lost = (this.lost || 0) + dt; if (this.lost > 1) { this.state = 'park'; this.t = 0; this.lost = 0; } } else this.lost = 0;
      return 'run';
    }
    return 'run';
  }
}
const STATION_LEVEL = 1.8 * DEG;   // aim inside the 2.5° BALANCE tolerance

// ---------------------------------------------------------------- the squad's Human Player
// where the Human Player puts COREs, as (distance from the side wall, distance from the end wall): about the
// triangle's incentre, where a robot coming in diagonally gets its claw on the ring without its bumper corners
// touching either wall
const HP_SPOTS = [[0.21, 0.21], [0.14, 0.31], [0.31, 0.14]];
class HPBrain {
  constructor(ai, squad) { this.ai = ai; this.squad = squad; this.t = 0; }
  update(dt, bots) {
    const g = this.ai.sim.game, sim = this.ai.sim, s = this.squad;
    if (g.state !== 'running') return;
    this.t -= dt;
    const F = sim.field;
    const robots = sim.robots.filter((r) => r.squad === s);
    const inZone = robots.some((r) => r.zone && r.zone.ownSource);
    // Payloads: loaded straight into a waiting bot's Cargo Bay (R9.2)
    for (const b of bots) {
      const p = g.payloads[b.r.id];
      if (b.wantPayload && p.where === 'hp' && b.r.zone && b.r.zone.ownSource && !b.r.payloadJoint && b.r.tray < 2) g.payloadAction(b.r.id);
    }
    // COREs: keep one or two waiting in the Source Zone (G4.3 caps it at 6, G4.10 forbids placing while we are in it)
    if (this.t <= 0 && g.hp[s].cores > 0 && !inZone) {
      // rings shoved against a wall do not count: no robot can get its claw round them
      const all = g.cores.filter((c) => c.color === s && !c.heldBy && pointInPoly([c.pos().x, c.pos().z], F.sourceZones[s]));
      const free = all.filter((c) => Math.min(HALF - Math.abs(c.pos().x), HALF - Math.abs(c.pos().z)) >= 0.1 && flat(c)).length;
      // one ring at a time: extra rings in the corner get shoved about and end up under a robot
      const want = 1;
      if (free < want && all.length < MATCH.sourceZoneCap) {
        // on a spot a robot can reach claw-first from the field (a ring tucked into the corner cannot be)
        const k = s === 'red' ? 1 : -1;
        const spot = HP_SPOTS.map(([u, v]) => ({ x: k * (-HALF + u), z: k * (HALF - v) }))
          .find((q) => !g.cores.some((c) => !c.heldBy && Math.hypot(c.pos().x - q.x, c.pos().z - q.z) < 0.105));
        const n = g.hp[s].cores;
        g.placeCore(s, spot || null);
        this.t = g.hp[s].cores < n ? 0.5 : 1.5;
      }
    }
    // STARBURST early, by the button, once a Payload is in (3.3.6)
    const L = LEVELS[this.ai.level] || LEVELS.normal;
    const sc = g.score[s];
    if (L.starburst && !g.starburst[s].active && sc.payloadScored && sc.squadCores >= MATCH.starburstThreshold - MATCH.payloadReduction) g.pressStarburst(s);
  }
}

// ---------------------------------------------------------------- coordinator
export class AI {
  constructor(sim) {
    this.sim = sim;
    this.nav = new Nav(sim);
    this.bots = new Map();
    this.hps = { red: new HPBrain(this, 'red'), blue: new HPBrain(this, 'blue') };
    this.claims = new Map();          // bot -> claimed object (CORE or pole)
    this.level = 'normal';
    this.round = -1;
    this.lastT = 0;
  }
  isBot(id) { return this.bots.has(id); }
  // seats: robot ids the AI drives this frame (everything else is left alone)
  update(seats) {
    const g = this.sim.game;
    if (g.roundId !== this.round) { this.round = g.roundId; this.bots.clear(); this.claims.clear(); this.lastT = this.sim.simTime; }
    const dt = Math.max(0, Math.min(0.1, this.sim.simTime - this.lastT));
    this.lastT = this.sim.simTime;
    for (const id of [...this.bots.keys()]) if (!seats.includes(id)) { this.unclaim(this.bots.get(id)); this.bots.delete(id); }
    for (const id of seats) {
      const r = this.sim.robots[id];
      if (!r || r.benched) continue;
      if (!this.bots.has(id)) this.bots.set(id, new Bot(this, r));
      this.bots.get(id).update(dt);
    }
    for (const s of ['red', 'blue']) {
      const mine = [...this.bots.values()].filter((b) => b.squad === s);
      if (mine.length) this.hps[s].update(dt, mine);
    }
  }
  claim(bot, obj) { this.claims.set(bot, obj); }
  unclaim(bot) { this.claims.delete(bot); }
  claimedBy(obj, bot) { for (const [b, o] of this.claims) if (o === obj && b !== bot) return b; return null; }
  claimsOn(pole, bot) { let n = 0; for (const [b, o] of this.claims) if (o === pole && b !== bot) n++; return n; }

  // nearest loose CORE of our colour that no other bot is after
  pickCore(bot) {
    const g = this.sim.game, F = this.sim.field, p = bot.pose();
    let best = null, bs = Infinity;
    for (const c of g.cores) {
      if (c.color !== bot.squad || c.heldBy || c.scored) continue;
      const t = c.pos();
      if (t.y > 0.04 || t.y < 0 || !flat(c) || Math.abs(t.x) > 1.79 || Math.abs(t.z) > 1.79) continue;
      if ((bot.blacklist.get(c.id) || 0) > bot.now) continue;
      if (this.claimedBy(c, bot)) continue;
      if (pointInPoly([t.x, t.z], F.sourceZones[bot.opp]) || pointInPoly([t.x, t.z], F.dropZones[bot.squad])) continue;
      const ovz = F.vaultZones[bot.opp];
      if (Math.hypot(t.x - ovz.c[0], t.z - ovz.c[1]) < ovz.r + 0.25) continue;
      if (F.poles.some((q) => Math.hypot(q.x - t.x, q.z - t.z) < 0.12)) continue;
      // sitting by a wall: only reachable claw-first, which the corner of our Source Zone allows
      const dWall = Math.min(HALF - Math.abs(t.x), HALF - Math.abs(t.z));
      const inSrc = pointInPoly([t.x, t.z], F.sourceZones[bot.squad]);
      if (dWall < 0.06 && !inSrc) continue;
      if (inSrc && dWall < 0.1) continue;                  // tucked into the corner: the bumper hits a wall first
      let sc = Math.hypot(t.x - p.x, t.z - p.z);
      if (bot.wantPayload && inSrc) sc -= 3;              // the Payload is loaded in the Source Zone: go there
      for (const o of this.sim.robots) if (o.squad !== bot.squad) { const q = o.body.translation(); if (Math.hypot(q.x - t.x, q.z - t.z) < 0.4) sc += 1.5; }
      if (sc < bs) { bs = sc; best = c; }
    }
    return best;
  }
  // direction to come in on a CORE from: a drivable stand-off, no other ring in the claw's way, near us
  approachFor(bot, c) {
    const F = this.sim.field, g = this.sim.game, t = c.pos(), p = bot.pose();
    if (pointInPoly([t.x, t.z], F.sourceZones[bot.squad])) return [-bot.sign * Math.SQRT1_2, bot.sign * Math.SQRT1_2];
    const cost = this.nav.layer(bot.squad).base;
    let best = null, bs = Infinity;
    for (let k = 0; k < 16; k++) {
      const a = k * Math.PI / 8, ux = Math.cos(a), uz = Math.sin(a);
      const sx = t.x - ux * 0.55, sz = t.z - uz * 0.55;
      let pen = 0;
      for (let d = 0.22; d <= 0.62; d += 0.08) {
        const i = ci(t.x - ux * d), j = ci(t.z - uz * d);
        if (i < 0 || j < 0 || i >= N || j >= N || cost[j * N + i] === INF) { pen = Infinity; break; }
        pen += Math.min(cost[j * N + i], BLOCK) * 0.25;
      }
      if (pen === Infinity) continue;
      for (const o of g.cores) {
        if (o === c || o.heldBy) continue;
        const q = o.pos(), rx = q.x - t.x, rz = q.z - t.z;
        const along = -(rx * ux + rz * uz), lat = Math.abs(-rx * uz + rz * ux);
        if (along > -0.06 && along < 0.62 && lat < 0.24) pen += 25;
      }
      for (const o of this.sim.robots) if (o !== bot.r) { const q = o.body.translation(); if (Math.hypot(q.x - sx, q.z - sz) < 0.5) pen += 12; }
      const sc = pen + Math.hypot(sx - p.x, sz - p.z);
      if (sc < bs) { bs = sc; best = [ux, uz]; }
    }
    return best;
  }
  // which side to come at a high pole from: the four sides along the field axes, scored on loose rings in the
  // claw's path (the opponent's spike-mark rings sit 0.2 m in front of our high poles), robots, and how
  // drivable the stand-off is. Along the pole row the stand-off is shorter so the robot fits between poles.
  poleApproach(bot, q, lead) {
    const g = this.sim.game, p = bot.pose(), cost = this.nav.layer(bot.squad).base;
    let best = null, bs = Infinity;
    for (const [ux, uz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const off = lead + (ux ? 0.12 : 0.32);
      const sx = q.x - ux * off, sz = q.z - uz * off;
      if (Math.abs(sx) > HALF - 0.25 || Math.abs(sz) > HALF - 0.25) continue;
      let pen = 0;
      for (let d = 0.12; d <= off + 0.1; d += 0.06) {
        const i = ci(q.x - ux * d), j = ci(q.z - uz * d);
        const c = i < 0 || j < 0 || i >= N || j >= N ? INF : cost[j * N + i];
        if (c === INF) { pen = Infinity; break; }
        // only the other poles count here (this pole's own clearance is the point of the exercise)
        for (const o of this.sim.field.poles) if (o !== q && Math.hypot(o.x - (q.x - ux * d), o.z - (q.z - uz * d)) < 0.16) pen += 30;
      }
      if (pen === Infinity) continue;
      for (const c of g.cores) {
        if (c.heldBy || c.scored === 'pole') continue;
        const t = c.pos(); if (t.y > 0.06 || t.y < 0) continue;
        const rx = t.x - q.x, rz = t.z - q.z, along = -(rx * ux + rz * uz), lat = Math.abs(-rx * uz + rz * ux);
        if (along > 0 && along < off + 0.2 && lat < 0.26) pen += 40;
      }
      for (const o of this.sim.robots) if (o !== bot.r) { const t = o.body.translation(); if (Math.hypot(t.x - sx, t.z - sz) < 0.45) pen += 15; }
      const sc = pen + Math.hypot(sx - p.x, sz - p.z);
      if (sc < bs) { bs = sc; best = { ux, uz, off }; }
    }
    return best || { ux: 0, uz: Math.sign(q.z - p.z) || -bot.sign, off: lead + 0.32 };
  }
  // best pole for a CORE: value per metre of driving, room left on it, the STAR MAP plan
  pickPole(bot, core) {
    const g = this.sim.game, p = bot.pose();
    const L = bot.L;
    let best = null, bs = -Infinity;
    const golden = core.golden;
    for (const q of this.sim.field.poles) {
      if (q.squad !== bot.squad || q.type === 'apex') continue;
      if (golden && q.type !== 'star') continue;
      const n = onPole(g, q).length + this.claimsOn(q, bot);
      if (n >= q.capacity) continue;
      let val = q.type === 'star' ? 5 : 3;
      if (q.type === 'star') {
        const slots = bot.starSlots(golden ? 'G' : 'C');
        if (!slots.includes(q)) continue;
        if (golden) val = 7 + (L.pattern ? 4 : 0);
      }
      const sc = val - 1.2 * Math.hypot(q.x - p.x, q.z - p.z);
      if (sc > bs) { bs = sc; best = q; }
    }
    return best;
  }
}
