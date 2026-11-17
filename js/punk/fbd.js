// fbd.js: the robot page's engineering cards. Reads assets/robot/specs.json (made by tools/robot_specs.py from the
// team's STEP file and js/config.js) and draws the spec list and four free body diagrams as inline SVG.
// Every number on these cards is computed here from specs.json; nothing is typed in by hand.
const SVGNS = 'http://www.w3.org/2000/svg';
const DEG = Math.PI / 180;

const S = await fetch('/assets/robot/specs.json').then((r) => r.json());
const V = (k) => S.values[k].value;
const g = V('g');
const O = S.outline;

// ---------------------------------------------------------------- the physics
const m = V('mass'), W = m * g;
const L = V('wheelbase'), R = V('wheel_diameter') / 2;
const half = L / 2;
const cad = V('com_cad'), floor = V('com_floor');
const bRear = (c) => half + c[0];            // CoM to rear axle, along x (mm)
const aFront = (c) => half - c[0];           // CoM to front axle
const mu = V('mu'), crr = V('roll_crr');
const tau = V('motor_stall_torque'), nMot = V('motor_count');

const still = { Nf: W * bRear(cad) / L, Nr: W * aFront(cad) / L };

const roll = crr * W;
const fGrip = mu * W, fMotor = nMot * tau / (R / 1000);
const aGrip = (fGrip - roll) / m, aMotor = (fMotor - roll) / m;
const aLift = g * bRear(cad) / cad[2];
const aTop = Math.min(aGrip, aMotor);
const vFree = V('motor_free_rpm') * 2 * Math.PI * (R / 1000) / 60;
function accel(a) {
  const dN = m * a * (cad[2] / 1000) / (L / 1000);
  const Nf = Math.max(0, still.Nf - dN), Nr = W - Nf;
  return { dN, Nf, Nr, F: m * a + roll };
}

const Larm = V('arm_link_length') / 1000;
const mEnd = V('arm_end_mass'), mCore = V('core_mass'), mLinks = V('arm_links_mass'), fLink = V('arm_links_com_frac');
const armTorque = (th) => g * Math.cos(th * DEG) * Larm * (mEnd + mCore + mLinks * fLink);
const tauWorst = armTorque(0);
const tauServo = V('servo_stall_torque');

const tipBack = Math.atan(bRear(floor) / floor[2]) / DEG;
const tipFwd = Math.atan(aFront(floor) / floor[2]) / DEG;
const tipSide = Math.atan((V('track') / 2) / floor[2]) / DEG;
const tipBackUp = Math.atan(bRear(cad) / cad[2]) / DEG;
const slipAt = Math.atan(mu) / DEG;
const hold = nMot * V('gear_hold');
const holdAt = Math.asin(Math.min(1, hold / W)) / DEG;
function slope(th) {
  const t = th * DEG, h = floor[2], b = bRear(floor);
  const Nf = Math.max(0, W * (b * Math.cos(t) - h * Math.sin(t)) / L);
  return { along: W * Math.sin(t), normal: W * Math.cos(t), Nf, Nr: W * Math.cos(t) - Nf, muNeed: Math.tan(t) };
}

// ---------------------------------------------------------------- formatting
const f = (x, nd = 1) => x.toFixed(nd);
const N = (x) => f(x) + ' N';
const mm = (x, nd = 1) => f(x, nd) + ' mm';
const Nm = (x) => f(x, 2) + ' N·m';
const deg = (x) => f(x) + '°';

// ---------------------------------------------------------------- tiny SVG kit
function el(tag, attrs, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function text(parent, x, y, str, cls = '', anchor = 'start') {
  const t = el('text', { x: f(x), y: f(y), class: cls, 'text-anchor': anchor }, parent);
  t.textContent = str;
  return t;
}
// a force arrow: the page's arrow look (ink under a colour core), straight, with a solid head at (x2, y2)
function force(parent, x1, y1, x2, y2, col) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  if (len < 2) return;
  const ux = dx / len, uy = dy / len, hs = Math.min(16, len * 0.6);
  const bx = x2 - ux * hs, by = y2 - uy * hs;
  const d = `M ${f(x1)} ${f(y1)} L ${f(bx)} ${f(by)}`;
  el('path', { d, class: 'f-ink' }, parent);
  el('path', { d, class: 'f-col ' + col }, parent);
  const px = -uy * hs * 0.55, py = ux * hs * 0.55;
  el('path', { d: `M ${f(x2)} ${f(y2)} L ${f(bx + px)} ${f(by + py)} L ${f(bx - px)} ${f(by - py)} Z`, class: 'head ' + col }, parent);
}
function comMark(parent, x, y) {      // centre-of-mass symbol: a quartered circle
  const r = 9;
  el('circle', { cx: f(x), cy: f(y), r, class: 'com-b' }, parent);
  el('path', { d: `M ${f(x)} ${f(y)} L ${f(x + r)} ${f(y)} A ${r} ${r} 0 0 1 ${f(x)} ${f(y + r)} Z M ${f(x)} ${f(y)} L ${f(x - r)} ${f(y)} A ${r} ${r} 0 0 1 ${f(x)} ${f(y - r)} Z`, class: 'com-a' }, parent);
}
function ground(parent, x1, x2, y) {
  el('line', { x1: f(x1), y1: f(y), x2: f(x2), y2: f(y), class: 'ground' }, parent);
  for (let x = x1 + 6; x < x2; x += 14) el('line', { x1: f(x), y1: f(y + 2), x2: f(x - 9), y2: f(y + 11), class: 'hatch' }, parent);
}
function dimension(parent, x1, x2, y, label) {
  el('path', { d: `M ${f(x1)} ${f(y - 6)} V ${f(y + 6)} M ${f(x2)} ${f(y - 6)} V ${f(y + 6)} M ${f(x1)} ${f(y)} H ${f(x2)}`, class: 'dim' }, parent);
  text(parent, (x1 + x2) / 2, y - 6, label, 's halo', 'middle');
}

// the robot from the side, from the CAD outline boxes. map(x, z) takes robot-frame mm to SVG; pose = arm angle (deg)
function robotSide(parent, map, pose, withPayload) {
  const th0 = V('arm_cad_angle'), Lmm = V('arm_link_length');
  const ex = Lmm * (Math.cos(pose * DEG) - Math.cos(th0 * DEG)), ez = Lmm * (Math.sin(pose * DEG) - Math.sin(th0 * DEG));
  const poly = (b, cls, dx = 0, dz = 0) => {
    const p = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]].map(([x, z]) => map(x + dx, z + dz));
    el('path', { d: 'M ' + p.map((q) => f(q[0]) + ' ' + f(q[1])).join(' L ') + ' Z', class: cls }, parent);
  };
  poly(O.cargo_bay, 'bay');
  if (withPayload) poly(O.payload, 'core');
  poly(O.side_plates, 'body');
  poly(O.top, 'body');
  poly(O.aligner, 'body');
  for (const pv of [V('arm_pivot_lower'), V('arm_pivot_upper')]) {
    const a = map(pv[0], pv[1]), b = map(pv[0] + Lmm * Math.cos(pose * DEG), pv[1] + Lmm * Math.sin(pose * DEG));
    const d = `M ${f(a[0])} ${f(a[1])} L ${f(b[0])} ${f(b[1])}`;
    el('path', { d, class: 'link' }, parent); el('path', { d, class: 'link-in' }, parent);
  }
  poly(O.gripper, 'grip', ex, ez);
  for (const pv of [V('arm_pivot_lower'), V('arm_pivot_upper')]) {
    const a = map(pv[0], pv[1]);
    el('circle', { cx: f(a[0]), cy: f(a[1]), r: 4.5, class: 'pin' }, parent);
  }
  for (const x of [-half, half]) {
    const c = map(x, R), r = Math.hypot(map(x + R, R)[0] - c[0], map(x + R, R)[1] - c[1]);
    el('circle', { cx: f(c[0]), cy: f(c[1]), r: f(r), class: 'wheel' }, parent);
    el('circle', { cx: f(c[0]), cy: f(c[1]), r: f(r * 0.32), class: 'hub' }, parent);
  }
  return { ex, ez };
}

function svgIn(fig, w, h, label) {
  const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': label });
  fig.insertBefore(svg, fig.firstChild);
  return svg;
}
function redraw(svg, fn) { while (svg.firstChild) svg.removeChild(svg.firstChild); fn(svg); }

// ---------------------------------------------------------------- fill-ins
const $ = (sel) => document.querySelector(sel);
function say(key, str) { const e = document.querySelectorAll(`[data-n="${key}"]`); e.forEach((x) => { x.textContent = str; }); }
function list(key, rows) {
  const dl = $(`[data-list="${key}"]`);
  dl.textContent = '';
  for (const [dt, dd, src] of rows) {
    const div = document.createElement('div');
    const a = document.createElement('dt'); a.textContent = dt;
    const b = document.createElement('dd');
    const v = document.createElement('b'); v.textContent = dd; b.appendChild(v);
    if (src) { const s = document.createElement('span'); s.className = 'small'; s.textContent = ' ' + src; b.appendChild(s); }
    div.append(a, b); dl.appendChild(div);
  }
}
function setList(key, rows) {      // update values in place once the list exists (keeps the scribble reveal sizes)
  const dl = $(`[data-list="${key}"]`);
  if (!dl.children.length) { list(key, rows); return; }
  rows.forEach(([, dd, src], i) => {
    const row = dl.children[i];
    row.querySelector('dd b').textContent = dd;
    if (src) row.querySelector('dd .small').textContent = ' ' + src;
  });
}
// a slider that the page's own arrow-key / swipe card navigation leaves alone
// (continuous, so an end like -16.45 deg is reachable; arrow keys move one keyStep, Page keys five)
function dial(key, min, max, keyStep, value, show, onInput) {
  const input = $(`[data-in="${key}"]`), out = $(`[data-out="${key}"]`);
  Object.assign(input, { min, max, step: 'any', value });
  const stop = (e) => e.stopPropagation();
  const KEYS = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 5, PageDown: -5 };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    let v = null;
    if (e.key in KEYS) v = Math.round((+input.value + KEYS[e.key] * keyStep) / keyStep) * keyStep;
    else if (e.key === 'Home') v = +min;
    else if (e.key === 'End') v = +max;
    if (v === null) return;
    e.preventDefault();
    input.value = Math.min(+max, Math.max(+min, v));
    input.dispatchEvent(new Event('input'));
  });
  input.addEventListener('touchstart', stop, { passive: true });
  input.addEventListener('touchend', stop, { passive: true });
  input.addEventListener('wheel', stop, { passive: true });
  const upd = () => { const v = +input.value; out.textContent = show(v); input.setAttribute('aria-valuetext', show(v)); onInput(v); };
  input.addEventListener('input', upd);
  upd();
}

// ---------------------------------------------------------------- card: by the numbers
say('step', S.step_file);
say('solids', S.solid_count.toLocaleString('en-GB'));
const named = S.parts.filter((p) => p.counted === 'copies');
list('dims', [
  ['Footprint', mm(V('length'), 0) + ' × ' + mm(V('width'), 0), 'long × wide; the limit is ' + mm(V('limit_footprint'), 0) + ' square'],
  ['Height', mm(V('height'), 0), 'with the payload, ' + mm(V('height_no_payload'), 0) + ' without'],
  ['Wheels', '4 × ø' + mm(V('wheel_diameter'), 0), f(V('wheel_width'), 0) + ' mm tread'],
  ['Wheelbase', mm(V('wheelbase')), 'track ' + mm(V('track'))],
  ['Clearance', mm(V('ground_clearance')), 'under the aligner jaws; ' + mm(V('base_clearance')) + ' under the chassis base'],
  ['Arm', '2 × ' + mm(V('arm_link_length')), 'parallelogram links, pivots ' + f(V('arm_pivot_lower')[1], 1) + ' and ' + f(V('arm_pivot_upper')[1], 1) + ' mm up'],
  ['Claw reach', mm(V('claw_past_tyre_floor'), 0), 'past the front tyres with the arm on the floor'],
  ['Mass', f(m, 2) + ' kg', 'estimate with the payload, ' + f(V('mass_no_payload'), 2) + ' kg without; the limit is ' + f(V('limit_mass'), 0) + ' kg'],
  ['Centre of mass', mm(-cad[0], 0) + ' back', f(cad[2], 0) + ' mm up, ' + (Math.abs(cad[1]) < 1 ? 'on the centre line' : f(Math.abs(cad[1]), 0) + ' mm off centre') + ' (arm in the CAD pose)'],
  ['Parts', named.reduce((s, p) => s + p.count, 0) + ' pieces', named.length + ' different parts, plus ' + S.parts.find((p) => p.counted === 'solids').count + ' electronics solids'],
]);
{
  const tb = $('[data-list="parts"]');
  const nice = (n) => n.replace(/^PRINTED /, 'Printed ').replace(/^ACRYLIC (.*) \(laser cut black\)/, 'Acrylic $1').replace(/_/g, ' ').replace(/ 1$/, '');
  for (const p of [...S.parts].sort((a, b) => b.mass_g - a.mass_g).slice(0, 10)) {
    const tr = document.createElement('tr');
    const qty = p.counted === 'solids' ? '—' : String(p.count);
    for (const [v, cls] of [[nice(p.name) + (p.material === 'catalogue' ? '*' : ''), ''], [qty, 'n'], [f(p.mass_g, 0) + ' g', 'n']]) {
      const td = document.createElement('td'); td.textContent = v; if (cls) td.className = cls; tr.appendChild(td);
    }
    tb.appendChild(tr);
  }
  const tr = document.createElement('tr'), td = document.createElement('td');
  td.colSpan = 3; td.className = 'small'; td.textContent = '* catalogue or team-estimate mass, not CAD volume';
  tr.appendChild(td); tb.appendChild(tr);
}

// ---------------------------------------------------------------- 1: standing still
const SIDE = { w: 400, h: 350, k: 0.9, ox: 172, oy: 238, fs: 2.2 };
const sideMap = (x, z) => [SIDE.ox + x * SIDE.k, SIDE.oy - z * SIDE.k];
function sideScene(svg, Nf, Nr, extra) {
  ground(svg, 8, SIDE.w - 8, SIDE.oy);
  robotSide(svg, sideMap, V('arm_cad_angle'), true);
  const [cx, cy] = sideMap(cad[0], cad[2]);
  const [rx] = sideMap(-half, 0), [fx] = sideMap(half, 0);
  force(svg, rx, SIDE.oy + 12 + Nr * SIDE.fs, rx, SIDE.oy + 2, 'c-n');
  force(svg, fx, SIDE.oy + 12 + Nf * SIDE.fs, fx, SIDE.oy + 2, 'c-n');
  text(svg, rx - 10, SIDE.oy + 30, 'N rear', 'm halo', 'end');
  text(svg, rx - 10, SIDE.oy + 52, N(Nr), 'v halo', 'end');
  text(svg, fx + 10, SIDE.oy + 30, 'N front', 'm halo');
  text(svg, fx + 10, SIDE.oy + 52, N(Nf), 'v halo');
  if (extra) extra(svg, cx, cy, rx, fx);
  force(svg, cx, cy, cx, cy + W * SIDE.fs, 'c-w');
  comMark(svg, cx, cy);
  text(svg, cx + 12, cy + W * SIDE.fs - 4, 'W ' + N(W), 'v halo');
  dimension(svg, rx, cx, SIDE.h - 14, 'b ' + f(bRear(cad), 0));
  dimension(svg, cx, fx, SIDE.h - 14, 'a ' + f(aFront(cad), 0));
}
{
  const fig = $('[data-fbd="still"]');
  const svg = svgIn(fig, SIDE.w, SIDE.h, `Free body diagram of the robot standing still: weight ${N(W)} down at the centre of mass, ${N(still.Nr)} up at the rear tyres and ${N(still.Nf)} up at the front tyres.`);
  sideScene(svg, still.Nf, still.Nr);
  say('W', N(W)); say('behind', mm(-cad[0], 0)); say('L', mm(L)); say('b', mm(bRear(cad)));
  list('still', [
    ['Weight W', N(W), f(m, 2) + ' kg × ' + f(g, 2)],
    ['Rear tyres', N(still.Nr), N(still.Nr / 2) + ' each'],
    ['Front tyres', N(still.Nf), N(still.Nf / 2) + ' each'],
    ['Rear share', f(still.Nr / W * 100, 0) + '%', 'of the weight'],
  ]);
}

// ---------------------------------------------------------------- 2: flat out
{
  const fig = $('[data-fbd="accel"]');
  const svg = svgIn(fig, SIDE.w, SIDE.h, 'Free body diagram of the robot accelerating: weight, normal forces at both axles, forward tyre forces and the inertia of the robot.');
  const rows = (a, s) => [
    ['Grip limit', N(fGrip), 'μ ' + f(mu, 2) + ' × W, so a ≤ ' + f(aGrip, 1) + ' m/s²'],
    ['Motor limit', N(fMotor), nMot + ' × ' + f(tau, 1) + ' N·m / ' + f(R / 1000, 3) + ' m (assumed stall torque)'],
    ['Front lift-off', f(aLift, 1) + ' m/s²', 'g × b / h = ' + f(g, 2) + ' × ' + f(bRear(cad), 0) + ' / ' + f(cad[2], 0)],
    ['Load moved back', N(s.dN), 'm a h / L at this acceleration'],
    ['Front / rear', N(s.Nf) + ' / ' + N(s.Nr), 'normal forces now'],
    ['Top speed', f(vFree, 2) + ' m/s', 'motor free speed (assumed ' + f(V('motor_free_rpm'), 0) + ' rpm)'],
  ];
  const draw = (a) => {
    const s = accel(a);
    redraw(svg, (svg) => sideScene(svg, s.Nf, s.Nr, (svg, cx, cy, rx, fx) => {
      const k = SIDE.fs * 1.4;
      force(svg, rx, SIDE.oy - 4, rx + s.F * s.Nr / W * k, SIDE.oy - 4, 'c-t');
      if (s.Nf > 0) force(svg, fx, SIDE.oy - 4, fx + s.F * s.Nf / W * k, SIDE.oy - 4, 'c-t');
      force(svg, cx, cy, cx - m * a * k, cy, 'c-i');
      text(svg, cx - m * a * k - 6, cy - 12, 'm a ' + N(m * a), 'v halo', 'end');
      text(svg, rx + 10, SIDE.oy + 26, 'drive', 'm halo');
      text(svg, rx + 10, SIDE.oy + 48, N(s.F), 'v halo');
    }));
    setList('accel', rows(a, s));
  };
  dial('acc', 0, f(aTop, 1), 0.1, f(Math.floor(aLift * 10) / 10, 1), (v) => f(v, 1) + ' m/s²', draw);
  say('accelVerdict', aLift < aTop
    ? `The front tyres lift at ${f(aLift, 1)} m/s², before the tyres slip (${f(aGrip, 1)}) or the motors run out (${f(aMotor, 1)}). If the tyres grip as well as we assume, a full-power launch can pitch the nose up.`
    : `The tyres slip at ${f(aTop, 1)} m/s² before the front lifts (${f(aLift, 1)}).`);
}

// ---------------------------------------------------------------- 3: arm holding a CORE
{
  const P0 = V('arm_pivot_lower'), P1 = V('arm_pivot_upper'), Lmm = V('arm_link_length');
  const th0 = V('arm_cad_angle');
  const AR = { w: 400, h: 330, k: 0.95, ox: 92, oy: 300 };
  const map = (x, z) => [AR.ox + (x - P0[0]) * AR.k, AR.oy - z * AR.k];
  const fig = $('[data-fbd="arm"]');
  const svg = svgIn(fig, AR.w, AR.h, 'The arm from the side with the weight of the gripper and CORE at the link ends, the links’ weight and the servo torque at the lower pivot.');
  const fe = (mEnd + mCore) * g, fl = mLinks * g, fsA = 18;
  const drawArm = (th) => {
    redraw(svg, (svg) => {
      ground(svg, 8, AR.w - 8, AR.oy);
      const sp = O.side_plates;
      const q = [map(Math.max(sp[0], -60), sp[1]), map(sp[2], sp[3])];
      el('rect', { x: f(q[0][0]), y: f(q[1][1]), width: f(q[1][0] - q[0][0]), height: f(q[0][1] - q[1][1]), class: 'body' }, svg);
      const c = Math.cos(th * DEG), s = Math.sin(th * DEG);
      const dx = Lmm * (c - Math.cos(th0 * DEG)), dz = Lmm * (s - Math.sin(th0 * DEG));
      const gb = O.gripper, gp = [map(gb[0] + dx, gb[1] + dz), map(gb[2] + dx, gb[3] + dz)];
      el('rect', { x: f(gp[0][0]), y: f(gp[1][1]), width: f(gp[1][0] - gp[0][0]), height: f(gp[0][1] - gp[1][1]), class: 'grip' }, svg);
      const ch = map(O.core_hold[0] + dx, O.core_hold[1] + dz), cr = 47.5 * AR.k;
      el('rect', { x: f(ch[0] - cr), y: f(ch[1] - 15 * AR.k), width: f(2 * cr), height: f(30 * AR.k), rx: 4, class: 'core' }, svg);
      for (const pv of [P0, P1]) {
        const a = map(pv[0], pv[1]), b = map(pv[0] + Lmm * c, pv[1] + Lmm * s);
        const d = `M ${f(a[0])} ${f(a[1])} L ${f(b[0])} ${f(b[1])}`;
        el('path', { d, class: 'link' }, svg); el('path', { d, class: 'link-in' }, svg);
        el('circle', { cx: f(b[0]), cy: f(b[1]), r: 4.5, class: 'pin' }, svg);
      }
      // link weight at its centre of mass, end load straight down through the link ends
      const lm = map(P0[0] + Lmm * fLink * c, (P0[1] + P1[1]) / 2 + Lmm * fLink * s);
      force(svg, lm[0], lm[1], lm[0], lm[1] + fl * fsA, 'c-w');
      text(svg, lm[0], lm[1] + fl * fsA + 20, 'links ' + N(fl), 's halo', 'middle');
      const tip = map(P0[0] + Lmm * c, (P0[1] + P1[1]) / 2 + Lmm * s);
      force(svg, tip[0], tip[1], tip[0], tip[1] + fe * fsA, 'c-w');
      text(svg, tip[0] + 10, tip[1] + fe * fsA - 2, 'gripper + CORE', 's halo');
      text(svg, tip[0] + 10, tip[1] + fe * fsA + 18, N(fe), 'v halo');
      // servo torque: an arc round the lower pivot, against the load
      const p = map(P0[0], P0[1]), r = 26, a0 = -th * DEG - 1.1, a1 = -th * DEG + 1.1;
      const e0 = [p[0] + r * Math.cos(a0), p[1] + r * Math.sin(a0)], e1 = [p[0] + r * Math.cos(a1), p[1] + r * Math.sin(a1)];
      el('path', { d: `M ${f(e1[0])} ${f(e1[1])} A ${r} ${r} 0 0 0 ${f(e0[0])} ${f(e0[1])}`, class: 'arc' }, svg);
      const t = [Math.sin(a0), -Math.cos(a0)];
      el('path', { d: `M ${f(e0[0] + t[0] * 4)} ${f(e0[1] + t[1] * 4)} l ${f(-t[0] * 13 + Math.cos(a0) * 6)} ${f(-t[1] * 13 + Math.sin(a0) * 6)} l ${f(-Math.cos(a0) * 12)} ${f(-Math.sin(a0) * 12)} Z`, class: 'arc-head' }, svg);
      for (const pv of [P0, P1]) { const a = map(pv[0], pv[1]); el('circle', { cx: f(a[0]), cy: f(a[1]), r: 5, class: 'pin' }, svg); }
      text(svg, AR.w - 14, 30, 'θ ' + armDeg(th), 'v halo', 'end');
      text(svg, AR.w - 14, 58, 'servo τ ' + Nm(armTorque(th)), 'v halo', 'end');
    });
  };
  // torque against angle
  const CH = { w: 400, h: 240, x0: 58, x1: 384, y0: 196, y1: 30 };
  const thMin = V('arm_floor_angle'), thMax = V('arm_max_angle');
  const armDeg = (v) => f(v, Math.abs(v - thMin) < 1e-6 ? 2 : 1) + '°';
  const top = Math.ceil(Math.max(tauServo, tauWorst) * 1.15 * 10) / 10;
  const cx = (th) => CH.x0 + (th - thMin) / (thMax - thMin) * (CH.x1 - CH.x0);
  const cy = (t) => CH.y0 - t / top * (CH.y0 - CH.y1);
  const chart = svgIn($('[data-fbd="armChart"]'), CH.w, CH.h, `Chart of holding torque against arm angle: a cosine curve peaking at ${Nm(tauWorst)} with the links level, under the assumed servo stall torque of ${Nm(tauServo)}.`);
  const drawChart = (th) => redraw(chart, (svg) => {
    for (let t = 0; t <= top + 1e-9; t += top > 1 ? 0.5 : 0.2) {
      el('line', { x1: CH.x0, x2: CH.x1, y1: f(cy(t)), y2: f(cy(t)), class: 'gridl' }, svg);
      text(svg, CH.x0 - 8, cy(t) + 5, f(t, 1), 's', 'end');
    }
    for (const a of [0, 30, 60, 90].filter((a) => a >= thMin && a <= thMax)) {
      el('line', { x1: f(cx(a)), x2: f(cx(a)), y1: CH.y0, y2: CH.y1, class: 'gridl' }, svg);
      text(svg, cx(a), CH.y0 + 20, a + '°', 's', 'middle');
    }
    el('path', { d: `M ${CH.x0} ${CH.y1 - 6} V ${CH.y0} H ${CH.x1}`, class: 'axis' }, svg);
    text(svg, CH.x0 - 44, CH.y1 - 14, 'N·m', 's');
    text(svg, CH.x1, CH.y0 + 40, 'arm angle θ', 's', 'end');
    let d = '';
    for (let a = thMin; a <= thMax + 1e-9; a += (thMax - thMin) / 60) d += (d ? ' L ' : 'M ') + f(cx(a)) + ' ' + f(cy(armTorque(a)));
    el('path', { d, class: 'curve-ink' }, svg); el('path', { d, class: 'curve' }, svg);
    el('line', { x1: CH.x0, x2: CH.x1, y1: f(cy(tauServo)), y2: f(cy(tauServo)), class: 'limit' }, svg);
    text(svg, CH.x1, cy(tauServo) - 8, 'servo stall ' + Nm(tauServo) + ' (assumed)', 's halo', 'end');
    text(svg, cx(0) + 8, cy(tauWorst) - 10, 'worst ' + Nm(tauWorst), 'm halo');
    el('circle', { cx: f(cx(th)), cy: f(cy(armTorque(th))), r: 7, class: 'dot' }, svg);
  });
  const rows = (th) => [
    ['Gripper carriage', f(mEnd * 1000, 0) + ' g', 'incl. its servo (assumed 55 g)'],
    ['CORE', f(mCore * 1000, 0) + ' g', 'game manual'],
    ['Links', f(mLinks * 1000, 0) + ' g', 'four plates and their spacers'],
    ['Torque now', Nm(armTorque(th)), 'at ' + armDeg(th)],
    ['Worst case', Nm(tauWorst), 'links level (0°)'],
    ['Servo stall', Nm(tauServo), V('servo_model') + ' at 4.8 V (assumed)'],
  ];
  dial('arm', thMin, thMax, 1, 0, (v) => armDeg(v) + (Math.abs(v - thMin) < 1e-6 ? ' on the floor' : ''), (th) => { drawArm(th); drawChart(th); setList('arm', rows(th)); });
  say('linkFrac', f(fLink, 2));
  say('armVerdict', tauWorst < tauServo
    ? `Covered: the worst case uses ${f(tauWorst / tauServo, 2)} of the servo's stall torque, a margin of ${f(tauServo / tauWorst, 1)} times.`
    : `Not covered: the worst case needs ${f(tauWorst / tauServo, 1)} times the servo's stall torque.`);
  say('servoNote', `The CAD has no servo body, only a standard-size mount (49 × 10 mm hole pattern). We assumed an ${V('servo_model')}: ${S.values.servo_stall_torque.source}. Check the label on the real servo.`);
}

// ---------------------------------------------------------------- 4: on the ramp
{
  const SL = { w: 400, h: 360, k: 0.62, px: 160, py: 262, fs: 2.2 };
  const fig = $('[data-fbd="slope"]');
  const svg = svgIn(fig, SL.w, SL.h, 'Free body diagram of the robot facing uphill on a slope: weight split into along-slope and into-slope parts, normal and friction forces at the tyres.');
  const pose = V('arm_floor_angle');
  const draw = (th) => {
    const t = th * DEG, u = [Math.cos(t), -Math.sin(t)], n = [-Math.sin(t), -Math.cos(t)];
    const map = (x, z) => [SL.px + ((x + half) * u[0] + z * n[0]) * SL.k, SL.py + ((x + half) * u[1] + z * n[1]) * SL.k];
    const s = slope(th);
    redraw(svg, (svg) => {
      const g0 = map(-half - 230, 0), g1 = map(half + 260, 0);
      el('path', { d: `M ${f(g0[0])} ${f(g0[1])} L ${f(g1[0])} ${f(g1[1])} L ${f(g1[0])} ${f(SL.h)} L ${f(g0[0])} ${f(SL.h)} Z`, class: 'bay' }, svg);
      el('line', { x1: f(g0[0]), y1: f(SL.py), x2: f(g1[0]), y2: f(SL.py), class: 'dash' }, svg);
      robotSide(svg, map, pose, false);
      const c = map(floor[0], floor[2]);
      const rc = map(-half, 0), fc = map(half, 0);
      const k = SL.fs;
      // normal forces push out of the surface at each axle, friction acts up the slope
      force(svg, rc[0] - n[0] * (s.Nr * k + 6), rc[1] - n[1] * (s.Nr * k + 6), rc[0] - n[0] * 3, rc[1] - n[1] * 3, 'c-n');
      if (s.Nf > 0) force(svg, fc[0] - n[0] * (s.Nf * k + 6), fc[1] - n[1] * (s.Nf * k + 6), fc[0] - n[0] * 3, fc[1] - n[1] * 3, 'c-n');
      const fr = s.along * k * 1.4;
      force(svg, rc[0] - u[0] * fr * 0.6, rc[1] - u[1] * fr * 0.6 + 6, rc[0] + u[0] * fr * 0.4, rc[1] + u[1] * fr * 0.4 + 6, 'c-t');
      // weight and its two parts
      force(svg, c[0], c[1], c[0] - u[0] * s.along * k, c[1] - u[1] * s.along * k, 'c-i');
      force(svg, c[0], c[1], c[0] - n[0] * s.normal * k, c[1] - n[1] * s.normal * k, 'c-i');
      force(svg, c[0], c[1], c[0], c[1] + W * k, 'c-w');
      comMark(svg, c[0], c[1]);
      text(svg, c[0] + 12, c[1] + W * k + 4, 'W ' + N(W), 'v halo');
      const nr = [rc[0] - n[0] * (s.Nr * k + 6), rc[1] - n[1] * (s.Nr * k + 6)];
      text(svg, nr[0] + 8, nr[1] + 2, 'N rear ' + N(s.Nr), 's halo');
      text(svg, 14, 30, 'θ ' + deg(th), 'v halo');
      text(svg, 14, 54, 'W sinθ ' + N(s.along), 's halo');
      text(svg, 14, 76, 'W cosθ ' + N(s.normal), 's halo');
      text(svg, 14, 98, 'friction needed ' + N(s.along), 's halo');
    });
    setList('slope', [
      ['Along the slope', N(s.along), 'W sin θ'],
      ['Into the slope', N(s.normal), 'W cos θ'],
      ['μ needed', f(s.muNeed, 2), 'tan θ; we have ' + f(mu, 2) + ', so the tyres slip at ' + deg(slipAt)],
      ['Motors off', s.along <= hold ? 'holds' : 'rolls back', 'gearboxes resist ' + N(hold) + ' (assumed), enough up to ' + deg(holdAt)],
      ['Tips backwards', deg(tipBack), 'arm down; ' + deg(tipBackUp) + ' with the arm up'],
      ['Tips forwards / sideways', deg(tipFwd) + ' / ' + deg(tipSide), 'facing downhill / across the slope'],
    ]);
  };
  const tilt = V('station_tilt'), ramp = V('ramp_angle');
  dial('slope', 0, 45, 0.5, tilt, (v) => deg(v) + (Math.abs(v - tilt) < 0.25 ? ' deck at its stop' : Math.abs(v - ramp) < 0.25 ? ' ramp (CAD)' : ''), draw);
  const first = tipBack < slipAt ? `it tips backwards (${deg(tipBack)}) before the tyres slip (${deg(slipAt)}), which is why we keep the arm low on the ramp`
    : `the tyres slip (${deg(slipAt)}) before it tips backwards (${deg(tipBack)})`;
  const fits = Math.max(tilt, ramp) < Math.min(tipBack, slipAt);
  say('slopeVerdict', `The deck stops at ${deg(tilt)} and the ramp in the field CAD is ${deg(ramp)}: ${fits ? 'both inside our limits' : 'past one of our limits'}. Steeper than that, ${first}.`);
}
