// Robot designer test battery. Runs headlessly in Practice mode through sim.advance(): the robots under test
// get their commands from a per-tick controller hooked in where the AI drivers run (after the driver inputs,
// before physics), every other robot is benched (body disabled, hidden) and the field is reset afterwards.
import { RAPIER, G, groups, qrot } from '../physics.js';
import { POLE, CORE, wx, wz } from '../config.js';
import { applyToRobot, appliedDesign, armGeom } from './designer-model.js';

const DEG = Math.PI / 180;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export class Cancelled extends Error {}
// a message-channel task: lets the page paint and handle clicks, and is not throttled in a background tab
const yieldToPage = () => new Promise((res) => { const ch = new MessageChannel(); ch.port1.onmessage = () => res(); ch.port2.postMessage(0); });

// open lane on Blue's half, clear of poles, stations, zones and the spike marks (diagram inches)
const LANE_Y = 114;

export const TESTS = [
  { id: 'sprint', label: 'Sprint', sim: 3 },
  { id: 'turn', label: 'Turn', sim: 2 },
  { id: 'push', label: 'Push', sim: 10 },
  { id: 'ramp', label: 'Ramp', sim: 8 },
  { id: 'reach', label: 'Reach', sim: 0 },
  { id: 'cycle', label: 'Cycle', sim: 45 },
];
export const CYCLE_SECONDS = 45;

export class Bench {
  constructor(sim) { this.sim = sim; this.cancelled = false; this.ctl = null; this.aiSeats = null; }
  get game() { return this.sim.game; }
  cancel() { this.cancelled = true; }

  // ------------------------------------------------ setup / teardown
  begin() {
    const sim = this.sim;
    if (sim.robotCode && sim.robotCode.active) throw new Error('Stop the robot-code run first');
    this.saved = {
      mode: this.game.mode, view: sim.hud ? sim.hud.view : 'menu',
      designs: sim.robots.map((r) => appliedDesign(r)),
      ai: { spectate: sim.ai.spectate, only: sim.ai.only, level: sim.ai.level },
    };
    const ai = sim.ai, orig = Object.getPrototypeOf(ai).update;
    this.origUpdate = orig;
    // the hook: our controller (or the AI on our chosen seats) replaces the AI's normal seat list
    ai.update = (seats) => {
      if (this.aiSeats) orig.call(ai, this.aiSeats);
      else if (this.ctl) { orig.call(ai, []); this.ctl(); }
      else orig.call(ai, seats);
    };
    for (const r of sim.robots) applyToRobot(r, null);
    this.game.mode = 'practice';
  }
  end() {
    const sim = this.sim, s = this.saved;
    if (!s) return;
    delete sim.ai.update;
    this.ctl = null; this.aiSeats = null;
    Object.assign(sim.ai, { spectate: s.ai.spectate, only: s.ai.only, level: s.ai.level });
    for (const r of sim.robots) this.bench(r, false);
    sim.robots.forEach((r, i) => applyToRobot(r, s.designs[i]));
    this.game.mode = s.mode;
    this.game.reset();
    if (sim.ctx && sim.ctx.applyTeams) sim.ctx.applyTeams();
    this.saved = null;
  }
  bench(r, on) {
    if (!!r.benched === on) return;
    r.benched = on;
    r.body.setEnabled(!on);
    r.root.visible = !on;
    if (on) { r.enabled = false; r.cmd = { throttle: 0, turn: 0, arm: 0 }; } else r.reset();
  }
  // fresh field; `active` maps robot id -> design (null = stock); every other robot is benched
  setup(active) {
    const sim = this.sim, g = this.game;
    this.ctl = null; this.aiSeats = null;
    for (const r of sim.robots) this.bench(r, false);
    g.reset();
    for (const r of sim.robots) {
      if (r.id in active) applyToRobot(r, active[r.id]); else { applyToRobot(r, null); this.bench(r, true); }
    }
    if (g.state === 'pre' || g.state === 'paused') g.start();
    for (const r of sim.robots) if (r.benched) r.enabled = false;
  }
  setArm(r, deg) {
    const z = r.__dz, lo = z ? z.armMin : -16.45, hi = z ? z.armMax : 90;
    r.theta = r.thetaTarget = clamp(deg, lo, hi) * DEG;
    r.updateMechColliders();
  }
  pose(r) {
    const t = r.body.translation(), f = qrot(r.body.rotation(), { x: 1, y: 0, z: 0 });
    return { x: t.x, y: t.y, z: t.z, h: Math.atan2(f.z, f.x) };
  }
  // advance in short chunks, yielding to the page between them; stops early when until() is true
  async run(seconds, until = null, onTick = null) {
    const g = this.game;
    const t0 = this.sim.simTime;
    while (this.sim.simTime - t0 < seconds - 1e-9) {
      if (this.cancelled) throw new Cancelled();
      if (g.state === 'paused') g.start();
      this.sim.advance(Math.min(0.25, seconds - (this.sim.simTime - t0) + 1e-6));
      if (onTick) onTick(this.sim.simTime - t0);
      if (until && until()) return true;
      await yieldToPage();
    }
    return false;
  }
  // a per-tick controller that also records; fn(now) runs before each physics tick
  drive(fn) { this.ctl = () => fn(this.sim.simTime); }

  // ------------------------------------------------ tests (each returns plain numbers)
  async sprint(design) {
    this.setup({ 0: design });
    const r = this.sim.robots[0];
    r.teleport(wx(22), wz(LANE_Y), 0); this.setArm(r, 45);
    this.drive(() => { r.cmd = { throttle: 0, turn: 0, arm: 0 }; });
    await this.run(0.4);
    const x0 = r.body.translation().x, t0 = this.sim.simTime;
    let prev = { t: t0, d: 0 }, tCross = null, vMax = 0, vMin = Infinity;
    this.drive((now) => {
      const d = r.body.translation().x - x0;
      vMax = Math.max(vMax, r.speed()); vMin = Math.min(vMin, r.volts);
      if (tCross === null && d >= 2) tCross = prev.t + (now - prev.t) * (2 - prev.d) / Math.max(1e-9, d - prev.d) - t0;
      prev = { t: now, d };
      r.cmd = { throttle: tCross === null ? 1 : 0, turn: 0, arm: 0 };
    });
    await this.run(6, () => tCross !== null);
    return { time: tCross, top: vMax, sag: vMin, pass: tCross !== null };
  }

  async turn(design) {
    this.setup({ 0: design });
    const r = this.sim.robots[0];
    r.teleport(wx(60), wz(LANE_Y), 0); this.setArm(r, 45);
    this.drive(() => { r.cmd = { throttle: 0, turn: 0, arm: 0 }; });
    await this.run(0.4);
    const p0 = this.pose(r), t0 = this.sim.simTime;
    let last = p0.h, acc = 0, tDone = null, wMax = 0, prev = { t: t0, a: 0 };
    this.drive((now) => {
      const h = this.pose(r).h;
      acc += wrap(h - last); last = h;
      wMax = Math.max(wMax, Math.abs(r.body.angvel().y));
      if (tDone === null && Math.abs(acc) >= Math.PI) tDone = prev.t + (now - prev.t) * (Math.PI - prev.a) / Math.max(1e-9, Math.abs(acc) - prev.a) - t0;
      prev = { t: now, a: Math.abs(acc) };
      r.cmd = { throttle: 0, turn: tDone === null ? 1 : 0, arm: 0 };
    });
    await this.run(5, () => tDone !== null);
    const p1 = this.pose(r);
    return { time: tDone, rate: wMax / DEG, drift: Math.hypot(p1.x - p0.x, p1.z - p0.z), pass: tDone !== null };
  }

  // designed robot (Red 1) against a stock robot (Red 2), both at full power for 3 s. Once both robots' tyres
  // slide the contest is close to a balance, so small differences in the start decide it: three starts (gap and
  // lateral offset varied) and a win or loss only when all three agree.
  async push(design) {
    const trials = [[0.005, 0], [0.003, 0.01], [0.008, -0.01]];
    const runs = [];
    let sag = Infinity;
    for (const [gap, lat] of trials) {
      this.setup({ 0: design, 1: null });
      const [a, b] = this.sim.robots;
      const x0 = wx(72), z0 = wz(LANE_Y), half = 0.150 + gap / 2;
      a.teleport(x0 - half, z0 + lat, 0); b.teleport(x0 + half, z0, Math.PI);
      this.setArm(a, 90); this.setArm(b, 90);
      this.drive(() => { a.cmd = { throttle: 0, turn: 0, arm: 0 }; b.cmd = { throttle: 0, turn: 0, arm: 0 }; });
      await this.run(0.3);
      const mid = () => (a.body.translation().x + b.body.translation().x) / 2;
      const m0 = mid();
      this.drive(() => { sag = Math.min(sag, a.volts); a.cmd = { throttle: 1, turn: 0, arm: 0 }; b.cmd = { throttle: 1, turn: 0, arm: 0 }; });
      await this.run(3);
      runs.push(mid() - m0);
    }
    const sorted = [...runs].sort((p, q) => p - q), disp = sorted[1];
    const win = runs.every((v) => v > 0.05) ? 'win' : runs.every((v) => v < -0.05) ? 'loss' : 'draw';
    return { disp, runs, min: sorted[0], max: sorted[2], sag, win };
  }

  // own Space Station ramp from a 0.62 m run-up, the AI's profile (80 % on the tiles, 62 % on the ramp)
  async ramp(design) {
    this.setup({ 0: design });
    const r = this.sim.robots[0], st = this.sim.field.stations[r.squad];
    const sz = 1, ax = st.cx, hd = Math.atan2(-sz, 0);
    r.teleport(ax, st.cz + sz * (0.686 + 0.62), Math.PI / 2); this.setArm(r, 70);
    this.drive(() => { r.cmd = { throttle: 0, turn: 0, arm: 0 }; });
    await this.run(0.3);
    const t0 = this.sim.simTime;
    let state = 'run', tDock = null, maxY = 0, retries = 0, tState = t0;
    const steer = (a) => { const w = -r.body.angvel().y; let u = 1.1 * a - 0.11 * w; if (Math.abs(a) > 0.02 && Math.abs(u) < 0.14) u = Math.sign(u || a) * 0.14; return u; };
    this.drive((now) => {
      const p = this.pose(r), lat = p.x - ax, prog = (p.z - st.cz) * -sz;
      const head = (k, lim) => wrap(hd - sz * clamp(k * lat, -lim, lim) - p.h);
      const onSt = r.stationSquad === r.squad && r.stationState !== 'none';
      const docked = onSt && (r.stationState === 'dock' || r.stationState === 'balance');
      maxY = Math.max(maxY, p.y);
      if (docked && tDock === null) tDock = now - t0;
      let thr = 0, turn = 0;
      if (state === 'run') {
        thr = p.y > 0.1 ? 0.62 : 0.8; turn = clamp(steer(head(2.5, 0.25)), -0.18, 0.18);
        if (p.y > 0.15 && onSt) { state = 'park'; tState = now; }
        if (now - tState > 0.8 && r.speed() < 0.05 && p.y < 0.1) { state = 'back'; tState = now; retries++; }
      } else if (state === 'back') {
        thr = -0.5;
        if (now - tState > 0.6) { state = 'run'; tState = now; }
      } else {
        // along the deck to the pivot, braking on its own speed near the spot (as the AI's StationTask)
        const e = -prog, f = qrot(r.body.rotation(), { x: 1, y: 0, z: 0 }), v = r.body.linvel();
        const vf = v.x * f.x + v.y * f.y + v.z * f.z;
        turn = clamp(steer(head(1.5, 0.15)), -0.12, 0.12);
        if (Math.abs(e) < 0.012) thr = Math.abs(vf) > 0.06 ? -0.4 * Math.sign(vf) : 0;
        else {
          const lo = f.y * Math.sign(e) > 0.05 ? 0.44 : 0.18;
          thr = Math.sign(e) * clamp(lo + 1.6 * Math.abs(e), lo, 0.58);
          if (Math.abs(e) < 0.06) thr -= 0.8 * vf / (r.__dz ? r.__dz.vFree : 1.73) * (vf * e > 0 ? 1 : 0) * 4;
          thr = clamp(thr, -0.6, 0.6);
        }
        if (!onSt && p.y < 0.04) { state = 'run'; tState = now; retries++; }
      }
      r.cmd = { throttle: thr, turn, arm: 0 };
    });
    await this.run(10, () => tDock !== null || retries > 3);
    let held = false;
    if (tDock !== null) {
      await this.run(1.5);
      held = r.stationState === 'dock' || r.stationState === 'balance';
    }
    return { time: tDock, retries, maxY, held, state: r.stationState, pass: tDock !== null };
  }

  // geometry only: claw heights from holdLocal and the Apex Pole question with the bumper on the deck guard
  reach(design) {
    const sim = this.sim, r = sim.robots[0];
    const gm = armGeom(r.P, r.theta0, design);
    const sweep = (fn) => { for (let a = gm.armMin; a <= gm.armMax + 1e-9; a += 0.1) if (fn(a)) return a; return null; };
    let hMax = -Infinity;
    sweep((a) => { hMax = Math.max(hMax, gm.height(a * DEG)); return false; });
    const ringHalf = CORE.h / 2;
    const clear = (top) => sweep((a) => gm.height(a * DEG) - ringHalf >= top);
    const starA = clear(POLE.star.top), highA = clear(POLE.high.top);
    const aiStar = gm.height(36 * DEG) - ringHalf - POLE.star.top, aiHigh = gm.height(48 * DEG) - ringHalf - POLE.high.top;
    // Apex: the robot stands on its own (level) deck facing the wall, front bumper on the wall-side guard
    const st = sim.field.stations[r.squad];
    const dk = deckFrame(sim, st);
    const track = r.P.wheelFL[2], wb = [r.P.wheelFL[0], r.P.wheelRL[0]];
    const clearance = 0.0208 - gm.floorY;                    // base plate underside above the tiles
    let floor = dk.surfaceY(st.cx, st.cz) - clearance, face = null, wheels = floor;
    for (let it = 0; it < 3; it++) {
      // the bumper's end bar is 20-52 mm above the robot's floor; the guard face is the first thing it meets
      face = -Infinity;
      for (const dzz of [-0.18, -0.09, 0, 0.09, 0.18]) for (const hy of [0.025, 0.045]) {
        const fx = dk.faceX(st.cz + dzz, floor + hy); if (fx !== null) face = Math.max(face, fx);
      }
      if (!Number.isFinite(face)) { face = null; break; }
      const cxr = face + 0.150;
      const ws = [];
      for (const wx_ of wb) for (const sgn of [-1, 1]) ws.push(dk.surfaceY(cxr - wx_, st.cz + sgn * Math.abs(track)));
      wheels = ws.reduce((s, v) => s + v, 0) / ws.length;
      floor = Math.max(wheels, dk.surfaceY(cxr, st.cz) - clearance);
    }
    const apexX = sim.field.poles.find((p) => p.type === 'apex' && p.squad === r.squad).x;
    let apex = null;
    if (face !== null) {
      const cxr = face + 0.150, toward = Math.sign(apexX - cxr);
      // facing the wall the robot straddles the deck's crest: if the crest is higher than its belly clearance
      // it rests on its base plate with the wheels unloaded (it cannot drive itself onto the guard)
      const beached = floor > wheels + 0.002, ahead = Math.abs(apexX - cxr);
      const dist = (a) => (apexX - (cxr + toward * gm.hold(a * DEG).x)) * toward;   // + : claw short of the axis
      const aClear = sweep((a) => floor + gm.height(a * DEG) - ringHalf >= POLE.apex.top);
      // the ring passes the cap at aClear; the claw must then be within 14 mm of the axis (the 55 mm hole round
      // the 1 in pipe). Short of the axis cannot be fixed (the guard stops the bumper); past it, back off.
      if (aClear === null) apex = { clearAngle: null, dist: null, deckFloor: floor, beached, ahead, pass: false };
      else {
        const d = dist(aClear);
        apex = { clearAngle: aClear, dist: d, backOff: Math.max(0, -d), deckFloor: floor, beached, ahead, pass: d <= 0.014 };
      }
    }
    return {
      hMin: gm.height(gm.armMin * DEG), hMax, armMin: gm.armMin, armMax: gm.armMax,
      starA, highA, aiStar, aiHigh, apex,
    };
  }

  // the AI (Pro) plays Practice alone for 45 s; COREs scored is the match-pace number
  async cycle(design, onTick) {
    this.setup({ 0: design });
    const sim = this.sim;
    sim.ai.level = 'normal';
    this.aiSeats = [0];
    await this.run(CYCLE_SECONDS, null, onTick);
    this.aiSeats = null;
    const sc = this.game.score.red;
    return { cores: sc.squadCores, points: sc.total, high: sc.high, star: sc.star };
  }
}

// ray queries against one station's deck in its own level frame (the real deck may rest on a stop)
function deckFrame(sim, st) {
  const world = sim.world, body = st.deckBody;
  const piv = body.translation(), q = body.rotation();
  const toW = (p) => { const v = qrot(q, { x: p.x - piv.x, y: p.y - piv.y, z: p.z - piv.z }); return { x: piv.x + v.x, y: piv.y + v.y, z: piv.z + v.z }; };
  const qi = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
  const toL = (p) => { const v = qrot(qi, { x: p.x - piv.x, y: p.y - piv.y, z: p.z - piv.z }); return { x: piv.x + v.x, y: piv.y + v.y, z: piv.z + v.z }; };
  const only = (c) => body.handle === (typeof c === 'number' ? world.getCollider(c) : c).parent().handle;
  const cast = (o, d, max) => {
    const O = toW(o), D = qrot(q, d);
    const hit = world.castRay(new RAPIER.Ray(O, D), max, true, undefined, groups(G.ALL, G.STATION), undefined, undefined, only);
    if (!hit) return null;
    return toL({ x: O.x + D.x * hit.toi, y: O.y + D.y * hit.toi, z: O.z + D.z * hit.toi });
  };
  return {
    surfaceY(x, z) { const h = cast({ x, y: piv.y + 0.3, z }, { x: 0, y: -1, z: 0 }, 0.5); return h ? h.y : piv.y; },
    // wall-side guard: cast from the deck centre toward the near wall
    faceX(z, y) {
      const dir = Math.sign(-st.cx) * -1;   // red station is on the -x wall
      const h = cast({ x: st.cx, y, z }, { x: dir, y: 0, z: 0 }, 0.4);
      return h ? h.x : null;
    },
  };
}
