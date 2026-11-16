// Ghost replay: the driver's robot pose sampled on the drill clock, and a translucent copy of the robot
// (visual only, no physics) that plays a recording back at the same clock.
import { loadRobotModel, buildRobotVisual } from '../robot-model.js';

const HZ = 20;                       // samples per drill second (linear interpolation in between)
const N = 10;                        // x y z (mm), quaternion (1e-4), arm angle (mrad), finger (mrad), tray (deg)

let modelP = null;
// the robot CAD again (the browser has it cached); built once, shared by every ghost
export function ghostModel() {
  if (!modelP) { modelP = loadRobotModel(); modelP.catch(() => { modelP = null; }); }
  return modelP;
}

export class Recorder {
  constructor() { this.f = []; this.next = 0; }
  sample(t, r) {
    if (t < this.next) return;
    const p = r.body.translation(), q = r.body.rotation();
    const row = [p.x * 1000, p.y * 1000, p.z * 1000, q.x * 1e4, q.y * 1e4, q.z * 1e4, q.w * 1e4, (r.theta - r.theta0) * 1000, r.finger * 1000].map(Math.round);
    // a long frame crosses several sample times: repeat the pose so the index stays time = i / HZ
    while (t >= this.next) { this.f.push(...row, Math.round(r.tray || 0)); this.next += 1 / HZ; }
  }
  data() { return { hz: HZ, n: N, f: this.f }; }
}

const GHOST_COL = 0xcfdcec;

export class Ghost {
  constructor(scene, model) {
    this.scene = scene;
    this.rec = null;
    this.vis = buildRobotVisual(model, { squadCol: GHOST_COL, number: 'BEST', shadows: false });
    const seen = new Set();
    this.vis.root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false; o.receiveShadow = false; o.renderOrder = 3;
      const m = o.material;
      if (seen.has(m)) return;
      seen.add(m);
      m.transparent = true; m.depthWrite = false;
      m.opacity = 0.36 * (m.opacity ?? 1);
      if (m.color && !m.map) m.color.setHex(GHOST_COL);
      if (m.emissive) { m.emissive.setHex(0x1c2a3a); }
      m.needsUpdate = true;
    });
    this.mats = [...seen];
    this.vis.root.visible = false;
    scene.add(this.vis.root);
  }
  setRecording(rec) { this.rec = rec && Array.isArray(rec.f) && rec.f.length ? rec : null; if (!this.rec) this.vis.root.visible = false; }
  get length() { return this.rec ? this.rec.f.length / this.rec.n / this.rec.hz : 0; }
  // pose at drill time t (holds the last pose once the recording has ended)
  at(t, show = true) {
    const R = this.rec, root = this.vis.root;
    if (!R || !show) { root.visible = false; return; }
    const n = R.n, count = R.f.length / n;
    const u = Math.max(0, t) * R.hz;
    const i = Math.min(count - 1, Math.floor(u)), j = Math.min(count - 1, i + 1), k = i === j ? 0 : u - i;
    const v = (c) => R.f[i * n + c] + (R.f[j * n + c] - R.f[i * n + c]) * k;
    root.position.set(v(0) / 1000, v(1) / 1000, v(2) / 1000);
    // normalised lerp; flip the second quaternion onto the same hemisphere first
    const a = [3, 4, 5, 6].map((c) => R.f[i * n + c]), b = [3, 4, 5, 6].map((c) => R.f[j * n + c]);
    const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
    const q = a.map((x, c) => x + (s * b[c] - x) * k), L = Math.hypot(...q) || 1;
    root.quaternion.set(q[0] / L, q[1] / L, q[2] / L, q[3] / L);
    this.vis.pose(v(7) / 1000, v(8) / 1000, 0, v(9));
    root.visible = true;
  }
  dispose() {
    this.scene.remove(this.vis.root);
    // materials and the number texture belong to this copy; the geometry is the shared CAD and stays
    for (const m of this.mats) { if (m.map) m.map.dispose(); m.dispose(); }
  }
}
