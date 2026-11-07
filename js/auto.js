// Robot code mode: import a team's HexaNRL OpMode source (.cpp + its .h files), compile it in the browser
// (cpp.js) and run it on a simulated robot (nrl.js). AUTO OpModes run for 60 s exactly like the robot's
// Auto period; TELEOP OpModes run for 2:30 with the keyboard or a gamepad standing in for gamepad1.
import * as THREE from 'three';
import { compileFiles, CompileError } from './cpp.js';
import { NRLRuntime, RUNTIME_INFO, DEFAULT_WIRING, SERVO_PINS, MOTOR_PORTS, AUTO_SECONDS, TELEOP_SECONDS, TYPICAL_ERRORS, SIM_MS_PER_INCH } from './nrl.js';
import { icon } from './icons.js';

const KEY = 'hyperdrive.robotCode';
const IN = 0.0254, DEG = Math.PI / 180, HALF = 1.829;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kbd = (k) => `<kbd>${esc(k)}</kbd>`;
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// keyboard stand-in for gamepad1 (TELEOP OpModes): twin-stick on WASD + arrows, face buttons on I J K L
const PAD_KEYS = { X: 'KeyJ', A: 'KeyK', B: 'KeyL', Y: 'KeyI', LB: 'KeyQ', RB: 'KeyE', LT: 'KeyU', RT: 'KeyO', UP: 'KeyT', DOWN: 'KeyG', LEFT: 'KeyF', RIGHT: 'KeyH' };
const BTN_BITS = { X: 1, A: 2, B: 4, Y: 8, RIGHT: 16, DOWN: 32, UP: 64, LEFT: 128, RB: 256, LB: 512, LT: 1024, RT: 2048 };

export class RobotCode {
  constructor(sim, ui) {
    this.sim = sim; this.ui = ui;
    this.state = this.load();
    this.compiled = null; this.compileError = null;
    this.rt = null; this.active = false;
    this.trail = null; this.trailPts = [];
    this.recompile();
  }
  // ---------------------------------------------------------------- persistence
  load() {
    const def = { files: [], op: null, robot: 0, pose: { side: 0, fwd: 0, heading: 0 }, wiring: JSON.parse(JSON.stringify(DEFAULT_WIRING)), clear: true, hp: { on: true, x: 13.5, y: 135 } };
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.files)) return { ...def, ...s, pose: { ...def.pose, ...s.pose }, hp: { ...def.hp, ...s.hp }, wiring: { ...def.wiring, ...s.wiring, servos: { ...def.wiring.servos, ...(s.wiring?.servos || {}) }, motors: { ...def.wiring.motors, ...(s.wiring?.motors || {}) }, mirrored: { ...def.wiring.mirrored, ...(s.wiring?.mirrored || {}) } } };
    } catch { /* storage blocked or corrupt */ }
    return def;
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch { this.ui.toast('Could not save the program in this browser (storage is full or blocked)'); } }

  recompile() {
    this.compiled = null; this.compileError = null;
    if (!this.state.files.length) return;
    try {
      // The simulated robot is not the team's robot: by default, MS_PER_INCH (the drive's time ->
      // distance calibration, measured on the real robot) is set to the simulated robot's own value.
      this.calib = null;
      const files = this.state.files.map((f) => {
        if (this.state.wiring.simCalib === false) return f;
        const text = f.text.replace(/constexpr\s+float\s+MS_PER_INCH\s*=\s*([\d.]+)f?\s*;/, (m, v) => { this.calib = { from: Number(v), file: f.name }; return `constexpr float MS_PER_INCH = ${SIM_MS_PER_INCH}f;`; });
        return text === f.text ? f : { ...f, text };
      });
      this.compiled = compileFiles(files, RUNTIME_INFO);
      const ops = this.compiled.registry;
      if (!ops.length) this.compileError = { message: 'No REGISTER_OPMODE(...) found. Import the .cpp file that registers your OpMode.' };
      else if (!ops.some((o) => o.name === this.state.op)) this.state.op = (ops.find((o) => o.type === 'AUTO') || ops[0]).name;
    } catch (e) {
      this.compiled = null;
      this.compileError = e instanceof CompileError ? { message: e.message, file: e.file, line: e.line } : { message: `Internal compiler error: ${e.message}` };
      if (!(e instanceof CompileError)) console.error(e);
    }
  }
  get opEntry() { return this.compiled?.registry.find((o) => o.name === this.state.op) || null; }
  get isTeleop() { return this.opEntry?.type === 'TELEOP'; }
  get length() { return this.isTeleop ? TELEOP_SECONDS : AUTO_SECONDS; }
  wantsKeys() { return this.active && this.isTeleop; }

  async addFiles(list) {
    const files = [...list].filter((f) => /\.(c|cc|cpp|cxx|h|hh|hpp|ino|txt)$/i.test(f.name));
    if (!files.length) { this.ui.toast('Choose .cpp, .h or .ino files'); return; }
    for (const f of files) {
      if (f.size > 400000) { this.ui.toast(`${f.name} is too large`); continue; }
      const text = await f.text();
      const i = this.state.files.findIndex((x) => x.name.toLowerCase() === f.name.toLowerCase());
      if (i >= 0) this.state.files[i] = { name: f.name, text }; else this.state.files.push({ name: f.name, text });
    }
    this.recompile(); this.save();
  }

  // ================================================================ setup dialog
  openSetup() {
    const ui = this.ui;
    const m = ui.modal({ title: 'Robot code', width: 720, body: '<div></div>', cls: 'rc-modal', footer: `<button class="btn ghost" data-cancel>Close</button><button class="btn primary" data-run>${icon('play')}Run on the field</button>` });
    m.kind = 'robotcode';
    const draw = () => { m.body.innerHTML = ''; m.body.appendChild(this.setupView(m, draw)); syncRun(); };
    const syncRun = () => { const b = $('[data-run]', m.el); b.disabled = !this.opEntry; b.title = this.opEntry ? '' : 'Import a program that compiles first'; };
    $('[data-cancel]', m.el).addEventListener('click', () => m.close());
    $('[data-run]', m.el).addEventListener('click', () => { if (this.opEntry) { this.save(); this.sim.ctx.startRobotCode(); } });
    draw();
    return m;
  }
  setupView(m, redraw) {
    const S = this.state, C = this.compiled, ops = C?.registry || [];
    const robots = this.sim.robots;
    const el = document.createElement('div');
    el.className = 'rc-setup';
    const err = this.compileError;
    const errLine = err && err.file ? this.state.files.find((f) => f.name === err.file)?.text.split('\n')[err.line - 1] : null;
    el.innerHTML = `
      <p class="rc-lead">Import your HexaNRL OpMode (the <code>.cpp</code> plus the headers it includes, like <code>OverdriveConfig.h</code>). It is compiled here in the browser and runs on a simulated robot: the 100 Hz loop, actions, <code>driveActions</code>, servos, motors, IMU and telemetry behave like the control hub.</p>
      <div class="rc-drop" tabindex="0" role="button" aria-label="Import robot code files">
        ${icon('cpu')}<div><b>Drop .cpp / .h files here</b><span>or <u>choose files</u> · they stay in this browser</span></div>
        <input type="file" multiple accept=".cpp,.cc,.cxx,.h,.hpp,.hh,.ino,.c,.txt" hidden>
      </div>
      ${S.files.length ? `<ul class="rc-files">${S.files.map((f, i) => `<li><code>${esc(f.name)}</code><span>${f.text.split('\n').length} lines</span><button class="lnk" data-view="${i}">View</button><button class="x sm" data-del="${i}" aria-label="Remove ${esc(f.name)}">${icon('x')}</button></li>`).join('')}</ul>` : ''}
      <div class="rc-paste-row"><button class="lnk" data-paste>Paste code instead</button>${S.files.length ? ' · <button class="lnk" data-clear>Remove all</button>' : ''}</div>
      ${err ? `<div class="rc-err" role="alert"><b>Does not compile${err.file ? ` · ${esc(err.file)}:${err.line}` : ''}</b><span>${esc(err.message)}</span>${errLine ? `<pre>${err.line} | ${esc(errLine)}</pre>` : ''}</div>` : ''}
      ${C && C.warnings.length ? `<div class="rc-warn">${C.warnings.slice(0, 4).map((w) => `<span>${w.file ? `${esc(w.file)}:${w.line} · ` : ''}${esc(w.msg)}</span>`).join('')}</div>` : ''}
      ${ops.length ? `<h3>OpMode</h3><div class="rc-ops" role="radiogroup" aria-label="OpMode">${ops.map((o) => `<button role="radio" aria-checked="${o.name === S.op}" class="${o.name === S.op ? 'on' : ''}" data-op="${esc(o.name)}"><b>${esc(o.name)}</b><span>${o.type === 'AUTO' ? 'Auto · 60 s, runs by itself' : 'TeleOp · 2:30, you drive with keys or a gamepad'}</span></button>`).join('')}</div>` : ''}
      <h3>Robot and start position</h3>
      <div class="rc-pose">
        <svg class="rc-map" viewBox="0 0 200 200" aria-label="Start position on the field"></svg>
        <div class="rc-pose-f">
          <label>Robot<select data-robot>${robots.map((r, i) => `<option value="${i}" ${i === S.robot ? 'selected' : ''}>${esc(r.name)} (#${esc(r.number)})</option>`).join('')}</select></label>
          <label>Sideways <small>in, + = right</small><input type="number" step="0.5" data-pose="side" value="${S.pose.side}"></label>
          <label>Forward <small>in, from the wall</small><input type="number" step="0.5" min="0" data-pose="fwd" value="${S.pose.fwd}"></label>
          <label>Heading <small>°, + = right</small><input type="number" step="1" data-pose="heading" value="${S.pose.heading}"></label>
          <label class="chk"><input type="checkbox" data-clear-field ${S.clear ? 'checked' : ''}> Only this robot on the field</label>
          <label class="chk"><input type="checkbox" data-hp ${S.hp.on ? 'checked' : ''}> Human Player keeps a CORE on the spot</label>
          <label>Spot X <small>in, from the right wall</small><input type="number" step="0.5" data-hpk="x" value="${S.hp.x}"></label>
          <label>Spot Y <small>in, from your wall</small><input type="number" step="0.5" data-hpk="y" value="${S.hp.y}"></label>
        </div>
      </div>
      <details class="rc-wiring"><summary>Wiring and calibration</summary>${this.wiringView()}</details>`;
    // ---- events
    const input = $('input[type=file]', el), drop = $('.rc-drop', el);
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', async () => { await this.addFiles(input.files); redraw(); });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', async (e) => { e.preventDefault(); drop.classList.remove('over'); await this.addFiles(e.dataTransfer.files); redraw(); });
    $$('[data-del]', el).forEach((b) => b.addEventListener('click', () => { S.files.splice(Number(b.dataset.del), 1); this.recompile(); this.save(); redraw(); }));
    $$('[data-view]', el).forEach((b) => b.addEventListener('click', () => this.viewFile(S.files[Number(b.dataset.view)])));
    const clr = $('[data-clear]', el); if (clr) clr.addEventListener('click', () => { S.files = []; this.recompile(); this.save(); redraw(); });
    $('[data-paste]', el).addEventListener('click', () => this.openPaste(redraw));
    $$('[data-op]', el).forEach((b) => b.addEventListener('click', () => { S.op = b.dataset.op; this.save(); redraw(); }));
    $('[data-robot]', el).addEventListener('change', (e) => { S.robot = Number(e.target.value); this.save(); this.drawMap(el); });
    $$('[data-pose]', el).forEach((inp) => inp.addEventListener('input', () => { const v = Number(inp.value); if (Number.isFinite(v)) { S.pose[inp.dataset.pose] = v; this.save(); this.drawMap(el); } }));
    $('[data-clear-field]', el).addEventListener('change', (e) => { S.clear = e.target.checked; this.save(); });
    $('[data-hp]', el).addEventListener('change', (e) => { S.hp.on = e.target.checked; this.save(); this.drawMap(el); });
    $$('[data-hpk]', el).forEach((inp) => inp.addEventListener('input', () => { const v = Number(inp.value); if (Number.isFinite(v)) { S.hp[inp.dataset.hpk] = v; this.save(); this.drawMap(el); } }));
    this.bindWiring(el);
    this.drawMap(el);
    return el;
  }
  wiringView() {
    const W = this.state.wiring;
    const sv = SERVO_PINS.map(([n, pin]) => {
      const s = W.servos[pin] || { role: 'none' };
      const cal = s.role === 'arm' ? `<label>Angle at floor<input type="number" step="1" data-sv="${pin}" data-k="floor" value="${s.floor ?? 30}"></label><label>Arm ° per servo °<input type="number" step="0.05" data-sv="${pin}" data-k="scale" value="${s.scale ?? 1}"></label>`
        : s.role === 'gripper' ? `<label>Open angle<input type="number" step="1" data-sv="${pin}" data-k="open" value="${s.open ?? 15}"></label><label>Closed angle<input type="number" step="1" data-sv="${pin}" data-k="closed" value="${s.closed ?? 90}"></label>`
          : s.role === 'cargo' ? `<label>Rest angle<input type="number" step="1" data-sv="${pin}" data-k="rest" value="${s.rest ?? 0}"></label><label>Dump angle<input type="number" step="1" data-sv="${pin}" data-k="dump" value="${s.dump ?? 120}"></label>` : '';
      return `<div class="rc-wrow"><b>${n}</b><select data-sv="${pin}" data-k="role" aria-label="${n} drives">${[['none', 'Not connected'], ['arm', 'Arm'], ['gripper', 'Gripper'], ['cargo', 'Cargo bay']].map(([v, l]) => `<option value="${v}" ${s.role === v ? 'selected' : ''}>${l}</option>`).join('')}</select>${cal}</div>`;
    }).join('');
    const mo = MOTOR_PORTS.map(([n, pin]) => `<div class="rc-wrow"><b>${n}</b><select data-mo="${pin}" aria-label="${n} side">${[['left', 'Left wheels'], ['right', 'Right wheels'], ['none', 'Not connected']].map(([v, l]) => `<option value="${v}" ${(W.motors[pin] || 'none') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`).join('');
    return `<p class="note">How the program's servo and motor ports connect to the simulated robot. The defaults match Team 009's OverdriveConfig.h (Servo 1 arm, 115° on the floor and smaller = higher; Servo 2 gripper). The arm's lowest position is ${'−16.9°'} and its highest 90°.</p>
      <div class="rc-wgrid"><div><h4>Servos</h4>${sv}</div><div><h4>Motors</h4>${mo}
        <label class="chk"><input type="checkbox" data-trust ${W.trustFlip ? 'checked' : ''}> Trust the code's <code>flipped</code> settings (+ speed drives forward)</label>
        ${W.trustFlip ? '' : `<label class="chk"><input type="checkbox" data-mir="left" ${W.mirrored.left ? 'checked' : ''}> Left gearbox mirrored (needs <code>flipped = true</code>)</label>
        <label class="chk"><input type="checkbox" data-mir="right" ${W.mirrored.right ? 'checked' : ''}> Right gearbox mirrored</label>`}
        <h4>IMU and battery</h4>
        <div class="rc-wrow"><b>IMU X axis</b><select data-imu>${[['back', 'Points backward'], ['forward', 'Points forward'], ['left', 'Points left'], ['right', 'Points right']].map(([v, l]) => `<option value="${v}" ${W.imuX === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="rc-wrow"><b>Battery</b><input type="number" step="0.1" min="6" max="13" data-batt value="${W.battery}"> V</div>
        <label class="chk"><input type="checkbox" data-simcal ${W.simCalib !== false ? 'checked' : ''}> Calibrate <code>MS_PER_INCH</code> for the simulated robot (${SIM_MS_PER_INCH} ms per inch${this.calib && this.calib.from !== SIM_MS_PER_INCH ? `; your code says ${this.calib.from}` : ''})</label>
        <button class="lnk" data-wreset>Reset wiring to the defaults</button></div></div>
      ${this.errorsView()}`;
  }
  errorsView() {
    const E = { ...DEFAULT_WIRING.errors, ...(this.state.wiring.errors || {}) };
    const row = (k, label, unit, step) => `<div class="rc-wrow"><b>${label}</b><label><span>${unit}</span><input type="number" step="${step}" data-err="${k}" value="${E[k]}" ${E.on ? '' : 'disabled'}></label></div>`;
    return `<h4>Real-robot errors</h4>
      <p class="note">A real robot never drives perfectly. Turn these on to see how the code copes: one side's motors stronger than the other (trim), power too low to move (deadband), the battery dipping under load, and a gyro that drifts, reads a few percent wrong and is noisy.</p>
      <label class="chk"><input type="checkbox" data-err="on" ${E.on ? 'checked' : ''}> Simulate errors</label>
      <label class="chk"><input type="checkbox" data-err="random" ${E.random ? 'checked' : ''} ${E.on ? '' : 'disabled'}> New random robot every run (within the limits below)</label>
      <div class="rc-wgrid"><div>
        ${row('trimL', 'Left trim', '% power (+/-)', 0.5)}${row('trimR', 'Right trim', '% power (+/-)', 0.5)}${row('deadband', 'Deadband', 'PWM that does not move', 1)}${row('sag', 'Battery sag', 'V at full power', 0.1)}
      </div><div>
        ${row('gyroBias', 'Gyro drift', 'deg/s', 0.05)}${row('gyroScale', 'Gyro scale', '% (+/-)', 0.5)}${row('gyroNoise', 'Gyro noise', 'deg/s', 0.1)}${row('accelNoise', 'Accel noise', 'm/s²', 0.05)}${row('accelBias', 'Accel drift', 'm/s² (+/-)', 0.01)}
        ${row('laserBias', 'Laser offset', 'mm (+/-)', 1)}${row('laserNoise', 'Laser noise', 'mm per m', 0.5)}
      </div></div>
      <button class="lnk" data-typical>Use a typical robot (random errors each run)</button>`;
  }
  bindWiring(el) {
    const W = this.state.wiring;
    const redrawW = () => { const d = $('.rc-wiring', el); const open = d.open; d.innerHTML = `<summary>Wiring and calibration</summary>${this.wiringView()}`; d.open = open; this.bindWiring(el); };
    $$('[data-sv]', el).forEach((inp) => inp.addEventListener('change', () => {
      const pin = inp.dataset.sv, k = inp.dataset.k;
      W.servos[pin] = W.servos[pin] || { role: 'none' };
      if (k === 'role') {
        const defs = { arm: { floor: 30, scale: 1 }, gripper: { open: 15, closed: 90 }, cargo: { rest: 0, dump: 120 }, none: {} };
        // one servo per mechanism
        if (inp.value !== 'none') for (const p of Object.keys(W.servos)) if (p !== pin && W.servos[p].role === inp.value) W.servos[p] = { role: 'none' };
        W.servos[pin] = { role: inp.value, ...defs[inp.value] };
        this.save(); redrawW();
      } else { const v = Number(inp.value); if (Number.isFinite(v)) { W.servos[pin][k] = v; this.save(); } }
    }));
    $$('[data-mo]', el).forEach((s) => s.addEventListener('change', () => { W.motors[s.dataset.mo] = s.value; this.save(); }));
    $$('[data-mir]', el).forEach((c) => c.addEventListener('change', () => { W.mirrored[c.dataset.mir] = c.checked; this.save(); }));
    const tr = $('[data-trust]', el); if (tr) tr.addEventListener('change', () => { W.trustFlip = tr.checked; this.save(); redrawW(); });
    const imu = $('[data-imu]', el); if (imu) imu.addEventListener('change', () => { W.imuX = imu.value; this.save(); });
    const bt = $('[data-batt]', el); if (bt) bt.addEventListener('change', () => { const v = Number(bt.value); if (v >= 6 && v <= 13) { W.battery = v; this.save(); } else bt.value = W.battery; });
    const sc = $('[data-simcal]', el); if (sc) sc.addEventListener('change', () => { W.simCalib = sc.checked; this.recompile(); this.save(); });
    const rs = $('[data-wreset]', el); if (rs) rs.addEventListener('click', () => { this.state.wiring = JSON.parse(JSON.stringify(DEFAULT_WIRING)); this.save(); redrawW(); });
    // real-robot errors
    W.errors = { ...DEFAULT_WIRING.errors, ...(W.errors || {}) };
    $$('[data-err]', el).forEach((inp) => inp.addEventListener('change', () => {
      const k = inp.dataset.err;
      if (inp.type === 'checkbox') W.errors[k] = inp.checked; else { const v = Number(inp.value); if (Number.isFinite(v)) W.errors[k] = v; }
      this.save(); if (inp.type === 'checkbox') redrawW();
    }));
    const ty = $('[data-typical]', el); if (ty) ty.addEventListener('click', () => { W.errors = { ...TYPICAL_ERRORS }; this.save(); redrawW(); });
  }
  // mini map, seen from the Red driver station (Red at the bottom)
  drawMap(el) {
    const svg = $('.rc-map', el); if (!svg) return;
    const F = this.sim.field, s = 200 / (2 * HALF);
    const P = (x, z) => [(HALF - x) * s, (HALF - z) * s];
    const poly = (pts, cls) => `<polygon class="${cls}" points="${pts.map(([x, z]) => P(x, z).join(',')).join(' ')}"/>`;
    let h = `<rect class="fld" x="0" y="0" width="200" height="200" rx="3"/>`;
    for (const sq of ['red', 'blue']) {
      h += poly(F.sourceZones[sq], `src ${sq}`);
      h += poly(F.stations[sq].footprint, `stn ${sq}`);
    }
    for (const p of F.poles) { const [x, y] = P(p.x, p.z); h += `<circle class="pole ${p.squad} ${p.type}" cx="${x}" cy="${y}" r="${p.type === 'apex' ? 3 : 2.4}"/>`; }
    if (this.state.hp.on) { const sp = this.hpSpot(this.sim.robots[this.state.robot].squad); const [hx, hy] = P(sp.x, sp.z); h += `<circle class="hpspot" cx="${hx}" cy="${hy}" r="3.2"/>`; }
    const pose = this.startPose(this.sim.robots[this.state.robot]);
    const [cx, cy] = P(pose.x, pose.z);
    // robot footprint 0.30 m long x 0.41 m wide over the bumpers; heading arrow
    const ang = Math.atan2(-(-Math.sin(pose.yaw)), -Math.cos(pose.yaw)) / DEG;   // svg rotation of the forward vector
    h += `<g transform="translate(${cx} ${cy}) rotate(${ang})"><rect class="bot ${this.sim.robots[this.state.robot].squad}" x="-8.2" y="-11.3" width="16.4" height="22.5" rx="2.5"/><path class="arr" d="M0 -5 L9 0 L0 5"/></g>`;
    svg.innerHTML = h;
  }
  startPose(r) {
    const s = r.startPose(), p = this.state.pose;
    const fx = Math.cos(s.yaw), fz = -Math.sin(s.yaw);          // forward
    const rx = Math.sin(s.yaw), rz = Math.cos(s.yaw);           // right (local +z)
    const x = s.x + fx * p.fwd * IN + rx * p.side * IN, z = s.z + fz * p.fwd * IN + rz * p.side * IN;
    return { x: Math.max(-HALF + 0.12, Math.min(HALF - 0.12, x)), z: Math.max(-HALF + 0.12, Math.min(HALF - 0.12, z)), yaw: s.yaw - p.heading * DEG };
  }
  viewFile(f) {
    const m = this.ui.modal({ title: f.name, width: 760, body: `<pre class="rc-code">${f.text.split('\n').map((l, i) => `<span class="ln">${i + 1}</span>${esc(l)}`).join('\n')}</pre>` });
    void m;
  }
  openPaste(redraw) {
    const m = this.ui.modal({
      title: 'Paste code', width: 640,
      body: `<div class="fld"><label for="rc-pn">File name</label><input id="rc-pn" data-n value="${this.state.files.some((f) => /auto/i.test(f.name)) ? 'MyOpMode.cpp' : 'MyAuto.cpp'}" spellcheck="false"></div><div class="fld"><label for="rc-pt">Code</label><textarea id="rc-pt" class="rc-ta" data-t rows="14" spellcheck="false" placeholder="#include &quot;NRL.h&quot;\n\nclass MyAuto : public NRLOpMode { ... };\nREGISTER_OPMODE(MyAuto, &quot;MyAuto&quot;, AUTO);"></textarea></div>`,
      footer: '<button class="btn ghost" data-c>Cancel</button><button class="btn primary" data-ok>Add file</button>',
    });
    $('[data-c]', m.el).addEventListener('click', () => m.close());
    $('[data-ok]', m.el).addEventListener('click', () => {
      const name = $('[data-n]', m.el).value.trim().replace(/[\\/]/g, '') || 'MyAuto.cpp', text = $('[data-t]', m.el).value;
      if (!text.trim()) { $('[data-t]', m.el).focus(); return; }
      const i = this.state.files.findIndex((x) => x.name.toLowerCase() === name.toLowerCase());
      if (i >= 0) this.state.files[i] = { name, text }; else this.state.files.push({ name, text });
      this.recompile(); this.save(); m.close(); redraw();
    });
  }

  // ================================================================ running
  // called after game.reset() for a robot-code run: stage the robot, load the program, run init()
  arm() {
    const S = this.state, sim = this.sim, game = sim.game;
    this.disarm(false);
    const robot = sim.robots[S.robot];
    this.robot = robot;
    game.lengthOverride = this.length;
    for (const r of sim.robots) this.bench(r, S.clear && r !== robot);
    const p = this.startPose(robot);
    robot.teleport(p.x, p.z, p.yaw);
    this.rt = new NRLRuntime(sim, robot, S.wiring, { gamepad: () => this.readPad() });
    this.active = true;
    this.lines = [];
    try {
      this.rt.load(this.compiled);
      this.rt.init(S.op);
    } catch (e) {
      this.rt.error = this.rt.error || { message: e.message, where: 'loading' };
    }
    this.resetTrail();
    this.ui.update();
  }
  disarm(unbench = true) {
    if (this.rt && !this.rt.stopped) this.rt.stop();
    this.rt = null; this.active = false;
    this.sim.game.lengthOverride = null;
    if (unbench) for (const r of this.sim.robots) this.bench(r, false);
    if (this.trail) { this.trail.visible = false; }
    for (const b of this.beams || []) b.line.visible = b.dot.visible = false;
    if (this.panel) this.panel.classList.add('hidden');
  }
  // other robots wait outside the arena during a robot-code run
  bench(r, on) {
    if (!!r.benched === on) return;
    r.benched = on;
    r.body.setEnabled(!on);
    r.root.visible = !on;
    if (on) { r.enabled = false; r.cmd = { throttle: 0, turn: 0, arm: 0 }; }
    else { r.reset(); }
  }
  onSignal(type) {
    if (!this.active || !this.rt) return;
    if (type === 'start') this.rt.start();
    if (type === 'end') this.rt.stop();
  }
  // the marked Human Player spot in world metres (Red frame: X from the right wall, Y from the Red wall; Blue is mirrored)
  hpSpot(squad) {
    const IN = 0.0254, s = this.state.hp;
    const X = squad === 'red' ? s.x : 144 - s.x, Y = squad === 'red' ? s.y : 144 - s.y;
    return { x: (X - 72) * IN, z: (Y - 72) * IN };
  }
  // Human Player: keep one CORE on the spot (refills once the robot has carried the last one away)
  feedHp(dt) {
    this.hpT = (this.hpT || 0) + dt;
    if (!this.state.hp.on || this.hpT < 0.25) return;
    this.hpT = 0;
    const g = this.sim.game, sq = this.robot.squad, sp = this.hpSpot(sq);
    if (g.hp[sq].cores <= 0 || this.sim.robots.some((r) => r.squad === sq && r.zone && r.zone.ownSource)) return;
    if (g.cores.some((c) => c.color === sq && Math.hypot(c.pos().x - sp.x, c.pos().z - sp.z) < 0.06)) return;
    g.placeCore(sq, sp);
  }
  // every physics substep
  step(dt) {
    if (!this.active || !this.rt || this.sim.game.state !== 'running') return;
    this.feedHp(dt);
    this.rt.step(dt);
    this.trailT = (this.trailT || 0) + dt;
    if (this.trailT > 0.05) { this.trailT = 0; this.addTrail(); }
    this.updateBeams();
  }
  // laser rangefinder beams: red while the last reading was valid, grey when it got no return
  updateBeams() {
    const lasers = (this.rt && this.rt.lasers || []).filter((l) => l.running && l.vis);
    this.beams = this.beams || [];
    while (this.beams.length < lasers.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff2d2d, transparent: true, opacity: 0.9, depthWrite: false }));
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff2d2d }));
      line.renderOrder = 4; line.frustumCulled = false;
      this.sim.scene.add(line); this.sim.scene.add(dot);
      this.beams.push({ line, dot });
    }
    this.beams.forEach((b, i) => {
      const L = lasers[i];
      b.line.visible = b.dot.visible = !!L;
      if (!L) return;
      const a = b.line.geometry.attributes.position;
      a.setXYZ(0, L.vis.o.x, L.vis.o.y, L.vis.o.z); a.setXYZ(1, L.vis.p.x, L.vis.p.y, L.vis.p.z); a.needsUpdate = true;
      b.dot.position.set(L.vis.p.x, L.vis.p.y, L.vis.p.z);
      const c = L.valid ? 0xff2d2d : 0x9a9a9a;
      b.line.material.color.setHex(c); b.dot.material.color.setHex(c);
    });
  }
  readPad() {
    if (!this.isTeleop) return null;
    const d = this.sim.input.down;
    const ax = (neg, pos) => (d.has(pos) ? 1 : 0) - (d.has(neg) ? 1 : 0);
    let buttons = 0;
    for (const [k, code] of Object.entries(PAD_KEYS)) if (d.has(code)) buttons |= BTN_BITS[k];
    const p = { lx: ax('KeyA', 'KeyD'), ly: ax('KeyS', 'KeyW'), rx: ax('ArrowLeft', 'ArrowRight'), ry: ax('ArrowDown', 'ArrowUp'), buttons };
    // a real gamepad (standard mapping) wins when it is touched
    const all = [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter((g) => g && g.connected);
    const gp = all.find((g) => g.mapping === 'standard') || all[0];
    if (gp) {
      const dz = (v) => (Math.abs(v) < 0.05 ? 0 : v);
      const bi = (i) => gp.buttons[i] && gp.buttons[i].pressed;
      const map = [[0, 'A'], [1, 'B'], [2, 'X'], [3, 'Y'], [4, 'LB'], [5, 'RB'], [6, 'LT'], [7, 'RT'], [12, 'UP'], [13, 'DOWN'], [14, 'LEFT'], [15, 'RIGHT']];
      for (const [i, k] of map) if (bi(i)) p.buttons |= BTN_BITS[k];
      if (!p.lx) p.lx = dz(gp.axes[0] || 0); if (!p.ly) p.ly = -dz(gp.axes[1] || 0);
      if (!p.rx) p.rx = dz(gp.axes[2] || 0); if (!p.ry) p.ry = -dz(gp.axes[3] || 0);
    }
    return p;
  }

  // ---------------------------------------------------------------- path trail on the floor
  resetTrail() {
    this.trailPts = [];
    if (!this.trail) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 4000), 3));
      this.trail = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xf4c542, transparent: true, opacity: 0.85, depthWrite: false }));
      this.trail.renderOrder = 3; this.trail.frustumCulled = false;
      this.sim.scene.add(this.trail);
    }
    this.trail.visible = true;
    this.trail.geometry.setDrawRange(0, 0);
    for (const b of this.beams || []) b.line.visible = b.dot.visible = false;
    this.addTrail();
  }
  addTrail() {
    if (!this.trail || !this.robot || this.trailPts.length >= 4000) return;
    const t = this.robot.body.translation();
    const last = this.trailPts[this.trailPts.length - 1];
    if (last && Math.hypot(last[0] - t.x, last[2] - t.z) < 0.004 && Math.abs(last[1] - t.y) < 0.004) return;
    this.trailPts.push([t.x, t.y + 0.004, t.z]);
    const a = this.trail.geometry.attributes.position;
    a.setXYZ(this.trailPts.length - 1, t.x, t.y + 0.004, t.z);
    a.needsUpdate = true;
    this.trail.geometry.setDrawRange(0, this.trailPts.length);
  }

  // ---------------------------------------------------------------- HUD
  buildPanel() {
    const p = document.createElement('div');
    p.id = 'rc-panel'; p.className = 'rc-panel hidden';
    p.setAttribute('role', 'region'); p.setAttribute('aria-label', 'Robot code telemetry');
    $('#hud').appendChild(p);
    p.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.a === 'edit') this.openSetup();
      if (b.dataset.a === 'rerun') this.sim.ctx.restart();
      if (b.dataset.a === 'min') { p.classList.toggle('min'); }
      b.blur();
    });
    this.panel = p;
  }
  updatePanel() {
    if (!this.panel) this.buildPanel();
    const p = this.panel, rt = this.rt;
    p.classList.toggle('hidden', !this.active || this.sim.game.mode !== 'robotcode');
    if (!this.active || !rt) return;
    const g = this.sim.game;
    const status = rt.error ? 'error' : g.state === 'pre' ? 'init' : rt.stopped ? 'stopped' : g.state === 'paused' ? 'paused' : 'running';
    const label = { error: 'Error', init: 'Init · ready', stopped: 'Stopped', paused: 'Paused', running: 'Running' }[status];
    const led = rt.leds.user;
    const tel = [...rt.telemetry.entries()];
    const log = rt.log.slice(-4);
    const keys = this.isTeleop ? `<div class="rc-keys">${kbd('W')}${kbd('A')}${kbd('S')}${kbd('D')} left stick · arrows right stick · ${kbd('J')} X ${kbd('K')} A ${kbd('L')} B ${kbd('I')} Y · ${kbd('Q')}/${kbd('E')} LB/RB · ${kbd('U')}/${kbd('O')} LT/RT · ${kbd('T')}${kbd('F')}${kbd('G')}${kbd('H')} D-pad</div>` : '';
    const html = `<div class="rc-h"><span class="rc-dot ${status}"></span><b>${esc(this.state.op)}</b><span class="rc-st">${label}</span>${led && led.kind !== 'off' ? `<i class="rc-led" style="background:rgb(${led.r},${led.g},${led.b})" title="userLed"></i>` : ''}<button class="x sm" data-a="min" aria-label="Collapse telemetry">${icon('chevron')}</button></div>
      <div class="rc-b">
      <div class="rc-sub">${esc(this.robot.name)} · ${this.isTeleop ? 'TeleOp' : 'Auto'} ${fmt(rt.elapsed)} / ${fmt(this.length)}</div>
      ${rt.err ? `<div class="rc-errs">Robot errors: trim L ${rt.err.trimL.toFixed(1)}% R ${rt.err.trimR.toFixed(1)}% · deadband ${Math.round(rt.err.deadband)} · gyro drift ${rt.err.gyroBias.toFixed(2)}°/s, scale ${rt.err.gyroScale.toFixed(1)}% · sag ${rt.err.sag.toFixed(1)} V</div>` : ''}
      ${rt.error ? `<div class="rc-err sm"><b>${esc(rt.error.where || 'Error')}${rt.error.loc ? ` · ${esc(rt.error.loc.file)}:${rt.error.loc.line}` : ''}</b><span>${esc(rt.error.message)}</span></div>` : ''}
      ${tel.length ? `<table class="rc-tel">${tel.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>` : `<div class="rc-empty">${g.state === 'pre' ? 'Telemetry appears once the OpMode is running.' : 'No telemetry.addData() yet.'}</div>`}
      ${log.length ? `<div class="rc-log">${log.map((l) => `<div>${esc(l.text)}</div>`).join('')}</div>` : ''}
      ${keys}
      <div class="rc-act"><button class="btn sm" data-a="rerun">${icon('play')}Run again</button><button class="btn sm ghost" data-a="edit">Code and setup</button></div></div>`;
    if (p._h !== html) { p.innerHTML = html; p._h = html; }
  }
  centerHtml() {
    const e = this.opEntry, r = this.robot;
    if (!e || !r) return '';
    const err = this.rt?.error;
    return `<div class="card center-card">
      <h2>${esc(e.name)}</h2>
      <p>${err ? `<span class="bad">init() failed: ${esc(err.message)}</span>` : `${esc(r.name)} is lined up and <code>init()</code> has run. ${e.type === 'AUTO' ? 'Starting runs <code>start()</code>, then <code>loop()</code> at 100 Hz for 60 seconds.' : 'Starting runs your TeleOp for 2:30. Drive it with the keys below or a gamepad.'}`}</p>
      <button class="btn primary lg block" id="btn-go" ${err ? 'disabled' : ''}>${icon('play')}Start ${e.type === 'AUTO' ? 'Auto' : 'TeleOp'}</button>
      <div class="hint">or press ${kbd('Space')} · ${kbd('C')} camera · the yellow line shows the path driven</div></div>`;
  }
  resultsBody() {
    const g = this.sim.game, rt = this.rt, r = this.robot;
    const sc = g.score[r.squad];
    const tel = rt ? [...rt.telemetry.entries()] : [];
    const st = r.stationState !== 'none' ? `${r.stationState[0].toUpperCase()}${r.stationState.slice(1)}` : 'Not on the station';
    return `<div class="rc-res">
      <div class="rc-big"><span>${sc.total}</span><small>points</small></div>
      <table class="bd-table"><tr><td>COREs scored</td><td class="r n">${sc.squadCores}</td></tr><tr><td>Space Station</td><td class="r n">${esc(st)} · ${sc.station} pts</td></tr><tr><td>Fouls committed</td><td class="r n">${g.fouls[r.squad].length}</td></tr></table>
      ${rt?.error ? `<div class="rc-err"><b>${esc(rt.error.where)}${rt.error.loc ? ` · ${esc(rt.error.loc.file)}:${rt.error.loc.line}` : ''}</b><span>${esc(rt.error.message)}</span></div>` : ''}
      ${tel.length ? `<h3>Final telemetry</h3><table class="rc-tel">${tel.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>` : ''}
    </div>`;
  }
  showResults() {
    const m = this.ui.modal({ title: `${this.state.op} · results`, width: 460, body: this.resultsBody(), footer: `<button class="btn ghost" data-menu>Main menu</button><button class="btn ghost" data-edit>Code and setup</button><button class="btn primary" data-again>${icon('play')}Run again</button>` });
    $('[data-menu]', m.el).addEventListener('click', () => { m.close(); this.sim.ctx.toMenu(); });
    $('[data-edit]', m.el).addEventListener('click', () => { m.close(); this.openSetup(); });
    $('[data-again]', m.el).addEventListener('click', () => { m.close(); this.sim.ctx.restart(); });
  }
}
