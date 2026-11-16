// Auto planner: draw an AUTO route on a top-down field, turn it into a HexaNRL OpMode (.cpp) that the
// Robot code compiler accepts, run it on the field, tune its drives on a perfect robot, and test it on
// a batch of imperfect robots (the Robot code's TYPICAL_ERRORS). Routes are saved in this browser.
import { RED, squadPoint, VAULT } from '../config.js';
import { compileFiles } from '../cpp.js';
import { RUNTIME_INFO } from '../nrl.js';
import { icon } from '../icons.js';
import { plan, generate, describe, startOf, servoCal, armDegOf, servoOfArm, armWait, ARM_PRESETS, presetList, presetRoute, opNameOf, wrap180, r1, newId, toDiag, STEP_KINDS, SETTLE_DEFAULT, tunedText } from './planner-gen.js';
import { runBatch } from './planner-run.js';

const KEY = 'hyperdrive.planner';
const PASSES = 6;                  // tuning runs
const SEED = 9000;                 // test runs draw their robots from fixed seeds, so the same N robots every time
const HALF_W = 16.2 / 2, HALF_L = 11.8 / 2;   // bumper frame, inches
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clampF = (v) => Math.max(6, Math.min(138, v));
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const fx = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '–');

export class Planner {
  constructor(sim, ui) {
    this.sim = sim; this.ui = ui;
    this.route = null;
    this.sel = null;          // selected step id
    this.tab = 'steps';
    this.newRev = false;      // new points: forward or reverse
    this.mc = null;           // last test batch
    this.focusStep = null;    // test table row whose finish positions are shown
    this.busy = null;         // 'test' | 'tune'
    this.cancel = false;
  }
  get cal() { return servoCal(this.sim.robotCode.state.wiring); }
  get robot() { return this.sim.robots[this.route.robot] || this.sim.robots[0]; }
  get start() { return startOf(this.robot); }
  get flip() { return this.robot.squad === 'red'; }   // draw the chosen robot's driver station at the bottom

  // ---------------------------------------------------------------- persistence
  load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.steps)) { s.steps.forEach((x) => { x.id = x.id || newId(); }); return s; }
    } catch { /* storage blocked or corrupt */ }
    return presetRoute('star', 0, this.cal);
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.route)); } catch { /* storage full or blocked: the route still works this session */ } }
  code() { return generate(this.route, this.robot, this.cal); }
  plan() { return plan(this.route, this.start, this.cal); }

  // ---------------------------------------------------------------- dialog
  open() {
    if (this.m) return;
    if (!this.route) this.route = this.load();
    const robots = this.sim.robots;
    const body = document.createElement('div');
    body.className = 'pl-wrap';
    body.innerHTML = `
      <div class="pl-left">
        <div class="pl-bar">
          <label class="pl-lab">Robot<select data-robot>${robots.map((r, i) => `<option value="${i}">${esc(r.name)}</option>`).join('')}</select></label>
          <div class="seg" role="radiogroup" aria-label="New points drive"><button data-dir="0" role="radio">Forward</button><button data-dir="1" role="radio">Reverse</button></div>
          <select data-preset aria-label="Starter routes"><option value="">Starter routes</option>${presetList().map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('')}</select>
          <button class="btn sm ghost" data-clear>Clear route</button>
        </div>
        <svg class="pl-field" viewBox="-9 -9 162 162" role="img" aria-label="Field, top-down, with the route"><g data-static></g><g data-route></g><g data-mc></g></svg>
        <p class="pl-hint" data-hint></p>
        <div class="pl-stat" data-stat></div>
      </div>
      <div class="pl-right">
        <div class="seg pl-tabs" role="tablist"><button data-tab="steps" role="tab">Steps</button><button data-tab="code" role="tab">Code</button><button data-tab="test" role="tab">Test</button></div>
        <div class="pl-pane" data-pane></div>
      </div>`;
    const m = this.ui.modal({
      title: 'Auto planner', width: 1180, body, cls: 'pl-modal',
      footer: `<span class="pl-foot-note">Saved in this browser</span><button class="btn ghost" data-close>Close</button><button class="btn primary" data-run>${icon('play')}Run on the field</button>`,
      onClose: () => { this.cancel = true; this.m = null; },
    });
    this.m = m;
    this.el = m.el;
    $('[data-close]', m.el).addEventListener('click', () => m.close());
    $('[data-run]', m.el).addEventListener('click', () => this.runOnField());
    $('[data-robot]', body).value = String(this.route.robot);
    $('[data-robot]', body).addEventListener('change', (e) => { this.route.robot = Number(e.target.value); this.mc = null; this.changed(true); this.drawStatic(); });
    $$('[data-dir]', body).forEach((b) => b.addEventListener('click', () => { this.newRev = b.dataset.dir === '1'; this.syncBar(); }));
    $('[data-preset]', body).addEventListener('change', (e) => {
      const id = e.target.value; e.target.value = '';
      if (!id) return;
      const go = () => { this.route = presetRoute(id, this.route.robot, this.cal); this.sel = null; this.mc = null; this.changed(true); };
      if (this.route.steps.length) this.ui.confirmAction({ title: 'Replace the route?', text: `Loading "${presetList().find((p) => p.id === id).label}" replaces the ${this.route.steps.length} steps you have.`, ok: 'Replace', fn: go });
      else go();
    });
    $('[data-clear]', body).addEventListener('click', () => {
      if (!this.route.steps.length) return;
      this.ui.confirmAction({ title: 'Clear the route?', text: `This removes all ${this.route.steps.length} steps.`, ok: 'Clear', danger: true, fn: () => { this.route.steps = []; this.sel = null; this.mc = null; this.changed(true); } });
    });
    $$('[data-tab]', body).forEach((b) => b.addEventListener('click', () => { this.tab = b.dataset.tab; this.renderPane(); this.drawRoute(); }));
    this.bindField($('.pl-field', body));
    m.el.addEventListener('keydown', (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) { e.preventDefault(); this.removeStep(this.sel); }
    });
    this.drawStatic();
    this.changed(true);
  }

  syncBar() {
    if (!this.m) return;
    $$('[data-dir]', this.el).forEach((b) => { const on = (b.dataset.dir === '1') === this.newRev; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    $$('[data-tab]', this.el).forEach((b) => { const on = b.dataset.tab === this.tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    const s = this.selStep();
    $('[data-hint]', this.el).innerHTML = s && s.kind === 'turn'
      ? `Click the field to aim the selected turn at that point (snaps to 15°; hold <kbd>Shift</kbd> for the exact angle).`
      : `Click the field to add a ${this.newRev ? 'reverse' : 'forward'} drive ${s ? `after step ${this.route.steps.indexOf(s) + 1}` : 'at the end'}. Drag a numbered point to move it. Points snap to 1 in; hold <kbd>Shift</kbd> for free placement.`;
  }

  // the route changed: save, redraw. structural = steps added/removed/reordered (rebuild the list)
  changed(structural = false) {
    this.save();
    if (!this.m) return;
    if (this.mc && !this.busy) this.mc.stale = true;
    this.syncBar();
    this.drawRoute();
    this.drawStats();
    if (structural || this.tab !== 'steps') this.renderPane();
  }
  selStep() { return this.route.steps.find((s) => s.id === this.sel) || null; }

  // ---------------------------------------------------------------- field drawing
  // diagram inches -> svg (flipped for Red, so the chosen robot's own wall is at the bottom)
  P(X, Y) { return this.flip ? [144 - X, 144 - Y] : [X, Y]; }
  pts(list) { return list.map(([X, Y]) => this.P(X, Y).map((v) => v.toFixed(2)).join(',')).join(' '); }

  drawStatic() {
    const g = $('[data-static]', this.el); if (!g) return;
    const F = this.sim.field, rc = this.sim.robotCode;
    const wpoly = (poly) => poly.map(([x, z]) => toDiag(x, z));
    let h = '<rect class="pl-fld" x="0" y="0" width="144" height="144"/>';
    for (let i = 24; i < 144; i += 24) h += `<line class="pl-grid" x1="${i}" y1="0" x2="${i}" y2="144"/><line class="pl-grid" x1="0" y1="${i}" x2="144" y2="${i}"/>`;
    for (const sq of ['red', 'blue']) {
      h += `<polygon class="pl-zone pl-${sq}" points="${this.pts(wpoly(F.startZones[sq]))}"/>`;
      h += `<polygon class="pl-zone pl-${sq} pl-drop" points="${this.pts(wpoly(F.dropZones[sq]))}"/>`;
      h += `<polygon class="pl-zone pl-${sq} pl-src" points="${this.pts(wpoly(F.sourceZones[sq]))}"/>`;
      h += `<polygon class="pl-stn pl-${sq}" points="${this.pts(wpoly(F.stations[sq].footprint))}"/>`;
      // vault: silo plus its 15 in Vault Zone half-disc (open towards the field)
      const [vX, vY] = squadPoint(sq, RED.vault), dir = sq === 'red' ? -1 : 1, R = RED.vaultZoneR;
      const a = this.P(vX - R, vY), b = this.P(vX + R, vY), sweep = (dir < 0) !== this.flip ? 1 : 0;
      h += `<path class="pl-vz pl-${sq}" d="M${a[0]} ${a[1]} A${R} ${R} 0 0 ${sweep} ${b[0]} ${b[1]} Z"/>`;
      const [vx, vy] = this.P(vX, vY);
      h += `<circle class="pl-vault" cx="${vx}" cy="${vy}" r="${(VAULT.rOut / 0.0254).toFixed(2)}"/>`;
      for (const p of RED.spikeMarks) { const [sx, sy] = this.P(...squadPoint(sq, p)); h += `<circle class="pl-spike pl-${sq}" cx="${sx}" cy="${sy}" r="1.87"/>`; }
    }
    for (const p of F.poles) {
      const [X, Y] = toDiag(p.x, p.z), [x, y] = this.P(X, Y);
      h += p.type === 'apex' ? `<circle class="pl-pole pl-apex" cx="${x}" cy="${y}" r="1"/>` : `<circle class="pl-pole pl-${p.squad}" cx="${x}" cy="${y}" r="2"><title>${p.type === 'star' ? 'Star' : 'High'} Pole (${r1(X)}, ${r1(Y)})</title></circle>`;
    }
    const sq = this.robot.squad;
    if (rc.state.hp.on) { const sp = rc.hpSpot(sq), [X, Y] = toDiag(sp.x, sp.z), [x, y] = this.P(X, Y); h += `<circle class="pl-hp" cx="${x}" cy="${y}" r="2.4"><title>Human Player CORE spot (${r1(X)}, ${r1(Y)})</title></circle>`; }
    // walls and the two driver stations
    h += '<rect class="pl-wall" x="0" y="0" width="144" height="144"/>';
    const own = sq === 'red' ? 'Red' : 'Blue', opp = sq === 'red' ? 'Blue' : 'Red';
    h += `<text class="pl-lbl pl-${sq}" x="72" y="150.5" text-anchor="middle">${own} driver station</text><text class="pl-lbl pl-${sq === 'red' ? 'blue' : 'red'}" x="72" y="-3.6" text-anchor="middle">${opp} driver station</text>`;
    // diagram axes: X = 0 and Y = 0 corner
    const [ox, oy] = this.P(0, 0);
    h += `<text class="pl-axis" x="${ox + (ox ? -1.5 : 1.5)}" y="${oy + (oy ? -1.5 : 4.5)}" text-anchor="${ox ? 'end' : 'start'}">(0, 0)</text>`;
    g.innerHTML = h;
  }

  robotShape(X, Y, th, cls) {
    const [x, y] = this.P(X, Y), a = this.flip ? th + 180 : th;
    return `<g class="${cls}" transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${a.toFixed(1)})"><rect x="${-HALF_L}" y="${-HALF_W}" width="${HALF_L * 2}" height="${HALF_W * 2}" rx="1.4"/><path d="M${HALF_L - 4.5} -3 L${HALF_L - 0.8} 0 L${HALF_L - 4.5} 3"/></g>`;
  }
  tick(X, Y, th, len, cls) {
    const [x, y] = this.P(X, Y), a = (this.flip ? th + 180 : th) * Math.PI / 180;
    return `<line class="${cls}" x1="${x}" y1="${y}" x2="${(x + Math.cos(a) * len).toFixed(2)}" y2="${(y + Math.sin(a) * len).toFixed(2)}"/>`;
  }

  drawRoute() {
    const g = $('[data-route]', this.el); if (!g) return;
    const st = this.start, P = this.plan(), steps = this.route.steps;
    let h = this.robotShape(st.X, st.Y, st.th0, 'pl-bot pl-start');
    let X = st.X, Y = st.Y;
    const handles = [];
    steps.forEach((s, i) => {
      const p = P[i], on = s.id === this.sel;
      if (s.kind === 'drive') {
        const [a, b] = [this.P(X, Y), this.P(p.X, p.Y)];
        const hit = this.legClip(X, Y, p.X, p.Y, p.tool);
        h += `<line class="pl-leg${s.rev ? ' pl-rev' : ''}${on ? ' pl-on' : ''}${hit ? ' pl-hit' : ''}" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`;
        handles.push([s, i, p, on]);
      } else if (s.kind === 'turn') {
        h += this.tick(p.X, p.Y, p.th, 9, `pl-turn${on ? ' pl-on' : ''}`);
        const [x, y] = this.P(p.X, p.Y);
        h += `<circle class="pl-turn-dot${on ? ' pl-on' : ''}" cx="${x}" cy="${y}" r="1.4"/>`;
      } else if (on) {
        const [x, y] = this.P(p.X, p.Y);
        h += `<circle class="pl-act-on" cx="${x}" cy="${y}" r="4"/>`;
      }
      X = p.X; Y = p.Y;
    });
    const end = P[P.length - 1];
    if (end) h += this.robotShape(end.X, end.Y, end.th, 'pl-bot pl-end');
    for (const [s, i, p, on] of handles) {
      h += this.tick(p.X, p.Y, p.th, 6.5, 'pl-head');
      const q = p.tool || p, [x, y] = this.P(q.X, q.Y);
      if (p.tool) { const c = this.P(p.X, p.Y); h += `<line class="pl-reach" x1="${c[0]}" y1="${c[1]}" x2="${x}" y2="${y}"/>`; }
      h += `<g class="pl-wp${on ? ' pl-on' : ''}${p.tool ? ' pl-tool' : ''}" data-i="${i}"><circle cx="${x}" cy="${y}" r="3.1"/><text x="${x}" y="${y + 1.25}" text-anchor="middle">${i + 1}</text></g>`;
    }
    g.innerHTML = h;
    this.drawMc();
  }

  // a leg that would run the bumper into a pole (straight-line sweep; turns on the spot are not checked)
  legClip(x0, y0, x1, y1, tool) {
    for (const p of this.sim.field.poles) {
      if (p.type === 'apex') continue;
      const [X, Y] = toDiag(p.x, p.z);
      if (tool && Math.hypot(tool.X - X, tool.Y - Y) < 3) continue;     // the pole the claw is scoring on
      const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((X - x0) * dx + (Y - y0) * dy) / L2));
      if (Math.hypot(x0 + dx * t - X, y0 + dy * t - Y) < HALF_L + 2) return { X, Y, type: p.type };
    }
    return null;
  }

  drawMc() {
    const g = $('[data-mc]', this.el); if (!g) return;
    const mc = this.mc;
    if (!mc || this.tab !== 'test' || !mc.runs.length) { g.innerHTML = ''; return; }
    let h = '';
    const fs = this.focusStep;
    if (fs !== null) {
      const p = mc.plan[fs];
      for (const r of mc.runs) { const k = r.marks[fs]; if (k) { const [x, y] = this.P(k.X, k.Y); h += `<circle class="pl-mc-step" cx="${x}" cy="${y}" r="1.1"/>`; } }
      if (p) { const [x, y] = this.P(p.X, p.Y); h += `<circle class="pl-mc-plan" cx="${x}" cy="${y}" r="2.6"/>`; }
    } else {
      for (const r of mc.runs) {
        const f = r.final, [x, y] = this.P(f.X, f.Y);
        h += this.tick(f.X, f.Y, f.th, 3.2, 'pl-mc-head');
        h += `<circle class="pl-mc-dot${r.cores > 0 ? ' pl-scored' : ''}" cx="${x}" cy="${y}" r="1.25"><title>Run ${mc.runs.indexOf(r) + 1}: (${r1(f.X)}, ${r1(f.Y)}), ${r.cores} CORE${r.cores === 1 ? '' : 's'}</title></circle>`;
      }
      const p = mc.plan[mc.plan.length - 1];
      if (p) { const [x, y] = this.P(p.X, p.Y); h += `<circle class="pl-mc-plan" cx="${x}" cy="${y}" r="2.6"/>`; }
    }
    g.innerHTML = h;
  }

  drawStats() {
    const el = $('[data-stat]', this.el); if (!el) return;
    const P = this.plan(), end = P[P.length - 1];
    const dist = P.reduce((s, p) => s + p.len, 0);
    const warn = [];
    let X = this.start.X, Y = this.start.Y;
    this.route.steps.forEach((s, i) => {
      if (s.kind === 'drive') { const c = this.legClip(X, Y, P[i].X, P[i].Y, P[i].tool); if (c) warn.push(`Step ${i + 1} passes within ${r1(HALF_L + 2)} in of the ${c.type === 'star' ? 'Star' : 'High'} Pole at (${r1(c.X)}, ${r1(c.Y)}).`); }
      X = P[i].X; Y = P[i].Y;
    });
    const t = end ? end.t : 0;
    if (t > 58) warn.push(`The route needs about ${Math.round(t)} s; AUTO stops at 60 s.`);
    el.innerHTML = `<span><b>${this.route.steps.length}</b> steps</span><span><b>${Math.round(dist)}</b> in driven</span><span>about <b>${Math.round(t)}</b> s of 60</span>${end ? `<span>ends at (${r1(end.X)}, ${r1(end.Y)}), heading ${r1(wrap180(end.h))}°</span>` : ''}
      ${warn.map((w) => `<div class="pl-warn">${esc(w)}</div>`).join('')}`;
  }

  // ---------------------------------------------------------------- field interaction
  svgPoint(svg, e) {
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    const [X, Y] = this.P(p.x, p.y);       // the flip is its own inverse
    return { X, Y };
  }
  snapPt(p, free) { return free ? { X: clampF(Math.round(p.X * 10) / 10), Y: clampF(Math.round(p.Y * 10) / 10) } : { X: clampF(Math.round(p.X)), Y: clampF(Math.round(p.Y)) }; }

  bindField(svg) {
    let drag = null, down = null;
    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.busy) return;
      const wp = e.target.closest('.pl-wp');
      if (wp) {
        const s = this.route.steps[Number(wp.dataset.i)];
        drag = { s, moved: false };
        this.sel = s.id;
        svg.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
      down = { x: e.clientX, y: e.clientY };
    });
    svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = this.snapPt(this.svgPoint(svg, e), e.shiftKey);
      if (p.X === drag.s.x && p.Y === drag.s.y) return;
      drag.s.x = p.X; drag.s.y = p.Y; drag.moved = true;
      drag.s.ax = drag.s.ay = 0;       // a moved leg needs tuning again
      this.drawRoute(); this.drawStats();
    });
    const up = (e) => {
      if (drag) { const d = drag; drag = null; this.changed(true); if (!d.moved) this.scrollToSel(); return; }
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4;
      down = null;
      if (moved || this.busy) return;
      const raw = this.svgPoint(svg, e);
      if (raw.X < -2 || raw.X > 146 || raw.Y < -2 || raw.Y > 146) return;
      const sel = this.selStep();
      if (sel && sel.kind === 'turn') {
        // aim the selected turn from where the robot is at that point of the route
        const i = this.route.steps.indexOf(sel), P = this.plan(), from = i > 0 ? P[i - 1] : { X: this.start.X, Y: this.start.Y };
        const th = Math.atan2(raw.Y - from.Y, raw.X - from.X) * 180 / Math.PI;
        let h = wrap180(th - this.start.th0);
        h = e.shiftKey ? r1(h) : wrap180(Math.round(h / 15) * 15);
        sel.h = h;
        this.changed(true);
        return;
      }
      const p = this.snapPt(raw, e.shiftKey);
      this.insertStep({ id: newId(), kind: 'drive', x: p.X, y: p.Y, rev: this.newRev });
    };
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', () => { drag = null; down = null; });
  }

  insertStep(s) {
    const steps = this.route.steps, i = steps.findIndex((x) => x.id === this.sel);
    steps.splice(i >= 0 ? i + 1 : steps.length, 0, s);
    this.sel = s.id;
    this.changed(true);
    this.scrollToSel();
  }
  removeStep(id) {
    const steps = this.route.steps, i = steps.findIndex((x) => x.id === id);
    if (i < 0) return;
    steps.splice(i, 1);
    this.sel = steps[Math.min(i, steps.length - 1)]?.id || null;
    this.changed(true);
  }
  moveStep(id, d) {
    const steps = this.route.steps, i = steps.findIndex((x) => x.id === id), j = i + d;
    if (i < 0 || j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    this.changed(true);
  }
  scrollToSel() { const li = this.el && $(`.pl-step[data-id="${this.sel}"]`, this.el); if (li) li.scrollIntoView({ block: 'nearest' }); }

  // ---------------------------------------------------------------- side panes
  renderPane() {
    const pane = $('[data-pane]', this.el); if (!pane) return;
    this.syncBar();
    if (this.tab === 'steps') this.renderSteps(pane);
    else if (this.tab === 'code') this.renderCode(pane);
    else this.renderTest(pane);
  }

  renderSteps(pane) {
    const cal = this.cal, P = this.plan(), R = this.route;
    const num = (k, v, step, attrs = '') => `<input type="number" data-k="${k}" value="${v}" step="${step}" ${attrs}>`;
    const rows = R.steps.map((s, i) => {
      const p = P[i];
      let f = '';
      if (s.kind === 'drive') {
        f = `<label>X ${num('x', r1(s.x), 1, 'min="6" max="138"')}</label><label>Y ${num('y', r1(s.y), 1, 'min="6" max="138"')}</label>
          <div class="seg pl-mini"><button data-k="rev" data-v="0" class="${s.rev ? '' : 'on'}">Fwd</button><button data-k="rev" data-v="1" class="${s.rev ? 'on' : ''}">Rev</button></div>
          ${s.rev ? '' : `<div class="seg pl-mini" title="Which part of the robot ends on the point"><button data-k="tool" data-v="0" class="${s.tool ? '' : 'on'}">Centre</button><button data-k="tool" data-v="1" class="${s.tool ? 'on' : ''}">Claw</button></div>`}
          <span class="pl-meta">${p.turn !== null ? `turn to ${r1(p.turn)}°, ` : ''}${r1(p.len)} in${tunedText(s) ? `, ${tunedText(s)}` : ''}</span>`;
      } else if (s.kind === 'turn') {
        f = `<label>Heading ${num('h', r1(wrap180(s.h)), 15, 'min="-180" max="180"')}°</label><button class="lnk" data-face>Face the next point</button><span class="pl-meta">turnTo(${r1(p.h)})</span>`;
      } else if (s.kind === 'arm') {
        f = `<label>Servo ${num('a', Math.round(s.a), 1, 'min="0" max="180"')}</label><select data-armp aria-label="Arm position"><option value="">${r1(armDegOf(s.a, cal))}° arm</option>${ARM_PRESETS.map(([n, d]) => `<option value="${d}">${n} (${servoOfArm(d, cal)})</option>`).join('')}</select><label>Wait ${num('ms', s.ms || 0, 50, 'min="0" max="5000"')} ms</label>`;
      } else if (s.kind === 'claw') {
        f = `<div class="seg pl-mini"><button data-k="open" data-v="1" class="${s.open ? 'on' : ''}">Open</button><button data-k="open" data-v="0" class="${s.open ? '' : 'on'}">Close</button></div><label>Wait ${num('ms', s.ms || 0, 50, 'min="0" max="5000"')} ms</label>`;
      } else {
        f = `<label>${num('ms', s.ms || 0, 50, 'min="0" max="20000"')} ms</label>`;
      }
      return `<li class="pl-step${s.id === this.sel ? ' pl-on' : ''}" data-id="${s.id}" tabindex="-1">
        <span class="pl-n">${i + 1}</span><span class="pl-kind pl-k-${s.kind}">${s.kind === 'drive' && s.rev ? 'Reverse' : STEP_KINDS[s.kind]}</span>
        <div class="pl-f">${f}</div>
        <div class="pl-ops"><button class="x sm" data-mv="-1" aria-label="Move step ${i + 1} up" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button><button class="x sm" data-mv="1" aria-label="Move step ${i + 1} down" ${i === R.steps.length - 1 ? 'disabled' : ''}>${icon('down')}</button><button class="x sm" data-del aria-label="Delete step ${i + 1}">${icon('x')}</button></div>
      </li>`;
    }).join('');
    const tuned = R.steps.some((s) => s.ax || s.ay);
    pane.innerHTML = `
      <div class="pl-name"><label>OpMode name<input data-name value="${esc(R.name)}" spellcheck="false" maxlength="40"></label><label title="Pause after every drive so the robot stops coasting before it turns">Settle<input type="number" data-settle value="${R.settle ?? SETTLE_DEFAULT}" min="0" max="2000" step="50"> ms</label></div>
      <div class="pl-add"><span>Add after the selected step</span><button class="btn sm" data-add="turn">Turn</button><button class="btn sm" data-add="arm">Arm</button><button class="btn sm" data-add="claw">Claw</button><button class="btn sm" data-add="wait">Wait</button></div>
      ${R.steps.length ? `<ol class="pl-steps">${rows}</ol>` : '<div class="pl-empty">No steps yet. Click the field to add the first drive, or load a starter route.</div>'}
      <div class="pl-tune">
        <button class="btn sm" data-tune ${R.steps.some((s) => s.kind === 'drive') && !this.busy ? '' : 'disabled'}>${this.busy === 'tune' ? 'Tuning…' : 'Tune drives on a perfect robot'}</button>
        ${tuned ? '<button class="lnk" data-untune>Clear tuning</button>' : ''}
        <p class="note">A drive coasts past its distance and turning on the spot shifts the robot about an inch. Tuning runs the route ${PASSES} times on a robot without errors and moves each drive's aim (its <code>turnTo</code> and <code>driveInches</code>) by what the robot missed, so it stops on its point, the way the team tunes constants in the simulator.${this.tuneMsg ? ` <b>${esc(this.tuneMsg)}</b>` : ''}</p>
      </div>`;
    // ---- events
    $('[data-name]', pane).addEventListener('input', (e) => { R.name = e.target.value; this.save(); });
    $('[data-settle]', pane).addEventListener('input', (e) => { const v = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(v)) { R.settle = Math.max(0, Math.min(2000, Math.round(v))); this.changed(false); } });
    $('[data-name]', pane).addEventListener('change', (e) => { R.name = opNameOf(R); e.target.value = R.name; this.save(); });
    $$('[data-add]', pane).forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.add, i = R.steps.findIndex((x) => x.id === this.sel), prev = i >= 0 ? P[i] : P[P.length - 1];
      const curArm = prev ? prev.arm : (R.armStart ?? cal.floor), curClaw = prev ? prev.claw : (R.clawStart ?? cal.open);
      const s = { id: newId(), kind: k };
      if (k === 'turn') s.h = wrap180(Math.round((prev ? prev.h : 0) / 15) * 15 + 90);
      if (k === 'arm') { s.a = curArm === cal.floor ? servoOfArm(36, cal) : cal.floor; s.ms = armWait(armDegOf(curArm, cal), armDegOf(s.a, cal)); }
      if (k === 'claw') { s.open = curClaw !== cal.open; s.ms = 400; }
      if (k === 'wait') s.ms = 500;
      this.insertStep(s);
    }));
    $$('.pl-step', pane).forEach((li) => {
      const s = R.steps.find((x) => x.id === li.dataset.id);
      li.addEventListener('pointerdown', (e) => {
        if (this.sel === s.id) return;
        this.sel = s.id;
        $$('.pl-step', pane).forEach((o) => o.classList.toggle('pl-on', o === li));
        this.syncBar(); this.drawRoute();
        if (e.target === li) li.focus();
      });
      $$('input[data-k]', li).forEach((inp) => inp.addEventListener('input', () => {
        const v = Number(inp.value); if (!Number.isFinite(v) || inp.value === '') return;
        const k = inp.dataset.k;
        if (k === 'x' || k === 'y') { s[k] = clampF(v); s.ax = s.ay = 0; }
        else if (k === 'h') s.h = wrap180(v);
        else if (k === 'a') s.a = Math.max(0, Math.min(180, Math.round(v)));
        else if (k === 'ms') s.ms = Math.max(0, Math.round(v));
        this.changed(false);
        this.refreshMeta(li, s);
      }));
      $$('input[data-k]', li).forEach((inp) => inp.addEventListener('change', () => this.renderPane()));
      $$('button[data-k]', li).forEach((b) => b.addEventListener('click', () => {
        if (b.dataset.k === 'rev') { s.rev = b.dataset.v === '1'; s.ax = s.ay = 0; }
        if (b.dataset.k === 'open') s.open = b.dataset.v === '1';
        if (b.dataset.k === 'tool') { s.tool = b.dataset.v === '1'; s.ax = s.ay = 0; }
        this.changed(true);
      }));
      const ap = $('[data-armp]', li);
      if (ap) ap.addEventListener('change', () => {
        if (ap.value === '') return;
        const i = R.steps.indexOf(s), before = i > 0 ? P[i - 1].arm : (R.armStart ?? cal.floor);
        s.a = servoOfArm(Number(ap.value), cal); s.ms = armWait(armDegOf(before, cal), Number(ap.value));
        this.changed(true);
      });
      const face = $('[data-face]', li);
      if (face) face.addEventListener('click', () => {
        const i = R.steps.indexOf(s), nx = R.steps.slice(i + 1).find((x) => x.kind === 'drive');
        if (!nx) { this.ui.toast('There is no drive after this turn to face'); return; }
        const from = i > 0 ? P[i - 1] : { X: this.start.X, Y: this.start.Y };
        s.h = r1(wrap180(Math.atan2(nx.y - from.Y, nx.x - from.X) * 180 / Math.PI + (nx.rev ? 180 : 0) - this.start.th0));
        this.changed(true);
      });
      $$('[data-mv]', li).forEach((b) => b.addEventListener('click', () => this.moveStep(s.id, Number(b.dataset.mv))));
      $('[data-del]', li).addEventListener('click', () => this.removeStep(s.id));
    });
    $('[data-tune]', pane).addEventListener('click', () => this.tune());
    const ut = $('[data-untune]', pane); if (ut) ut.addEventListener('click', () => { R.steps.forEach((s) => { s.ax = s.ay = 0; }); this.tuneMsg = ''; this.changed(true); });
    this.scrollToSel();
  }
  refreshMeta(li, s) {
    const meta = $('.pl-meta', li); if (!meta) return;
    const i = this.route.steps.indexOf(s), p = this.plan()[i];
    if (s.kind === 'drive') meta.textContent = `${p.turn !== null ? `turn to ${r1(p.turn)}°, ` : ''}${r1(p.len)} in${tunedText(s) ? `, ${tunedText(s)}` : ''}`;
    if (s.kind === 'turn') meta.textContent = `turnTo(${r1(p.h)})`;
    const as = $('[data-armp] option', li); if (as && s.kind === 'arm') as.textContent = `${r1(armDegOf(s.a, this.cal))}° arm`;
  }

  compileCheck(text) {
    try {
      const c = compileFiles([{ name: `${opNameOf(this.route)}.cpp`, text }], RUNTIME_INFO);
      const ops = c.registry.map((o) => `${o.name} (${o.type})`);
      return { ok: ops.length > 0, msg: ops.length ? `Compiles: OpMode ${ops.join(', ')}` : 'No REGISTER_OPMODE found' };
    } catch (e) { return { ok: false, msg: `Does not compile${e.line ? ` (line ${e.line})` : ''}: ${e.message}` }; }
  }

  renderCode(pane) {
    const text = this.code(), chk = this.compileCheck(text), name = `${opNameOf(this.route)}.cpp`;
    pane.innerHTML = `
      <div class="pl-code-bar"><span class="pl-chk ${chk.ok ? 'pl-ok' : 'pl-bad'}">${esc(chk.msg)}</span><button class="btn sm" data-copy>${icon('copy')}Copy</button><button class="btn sm" data-dl>Download ${esc(name)}</button></div>
      <pre class="pl-code">${esc(text)}</pre>
      <p class="note">Drop the file into your HexaNRL project next to your other OpModes. It sets up its own motors and servos with Team 009's wiring (Servo ${this.cal.armPin === 39 ? 1 : this.cal.armPin - 38} arm, Servo ${this.cal.clawPin === 39 ? 1 : this.cal.clawPin - 38} claw), taken from the Robot code wiring. Set <code>MS_PER_INCH</code> to your robot's measured value.</p>`;
    $('[data-copy]', pane).addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); this.ui.toast('Code copied'); }
      catch { const r = document.createRange(); r.selectNodeContents($('.pl-code', pane)); const s = getSelection(); s.removeAllRanges(); s.addRange(r); this.ui.toast('Select-all done: press Ctrl+C to copy'); }
    });
    $('[data-dl]', pane).addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/x-c++src' }));
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    });
  }

  renderTest(pane) {
    pane = pane || $('[data-pane]', this.el);
    if (!pane || this.tab !== 'test') return;
    const mc = this.mc, R = this.route, cal = this.cal;
    const n = this.mcRuns || 20;
    let h = `<div class="pl-test-bar">
      <label class="pl-lab">Robots<select data-n>${[5, 10, 20, 50].map((v) => `<option value="${v}" ${v === n ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="pl-chk-l"><input type="checkbox" data-errs ${this.mcPerfect ? '' : 'checked'}> Typical robot errors</label>
      ${this.busy === 'test' ? '<button class="btn sm danger" data-cancel>Cancel</button>' : `<button class="btn sm primary" data-test ${R.steps.length && !this.busy ? '' : 'disabled'}>Test on ${n} robots</button>`}
    </div>
    <p class="note">Each run is a fresh robot drawn from the Robot code's typical errors (motor trim, deadband, gyro drift and scale, battery sag), the same ${n} robots every time, so route changes compare fairly. A run ends ${1.5} s after the last step or at 60 s.</p>`;
    if (mc) {
      const runs = mc.runs, done = runs.length;
      h += `<div class="pl-prog"><i style="width:${(done / mc.n) * 100}%"></i></div>`;
      if (mc.error) h += `<div class="pl-warn">${esc(mc.error)}</div>`;
      if (mc.stale && !this.busy) h += '<div class="pl-stale">The route has changed since this test.</div>';
      if (done) {
        const cores = runs.map((r) => r.cores), endP = mc.plan[mc.plan.length - 1];
        const ferr = runs.map((r) => Math.hypot(r.final.X - endP.X, r.final.Y - endP.Y)).sort((a, b) => a - b);
        const docked = runs.filter((r) => r.station === 'dock' || r.station === 'balance').length;
        const errs = runs.filter((r) => r.error).length;
        h += `<div class="pl-sum">
          <div><b>${fx(mean(cores), 2)}</b><span>COREs scored per run</span></div>
          <div><b>${runs.filter((r) => r.cores > 0).length}/${done}</b><span>runs scored</span></div>
          <div><b>${docked}/${done}</b><span>ended docked</span></div>
          <div><b>${fx(mean(ferr))}</b><span>in mean end error (max ${fx(ferr[ferr.length - 1])})</span></div>
        </div>${errs ? `<div class="pl-warn">${errs} run${errs > 1 ? 's' : ''} stopped on a runtime error: ${esc(runs.find((r) => r.error).error)}</div>` : ''}`;
        const rows = mc.steps.map((s, i) => {
          const p = mc.plan[i];
          const hits = runs.map((r) => r.marks[i]).filter(Boolean);
          const e = hits.map((k) => { const q = p.tool ? this.clawAt(k, p.lead) : k, g = p.tool || p; return Math.hypot(q.X - g.X, q.Y - g.Y); });
          const he = hits.map((k) => Math.abs(wrap180(k.th - p.th)));
          return `<tr data-row="${i}" class="${this.focusStep === i ? 'pl-on' : ''}" tabindex="0"><td class="n">${i + 1}</td><td>${esc(describe(s, cal))}${p.tool ? ' <small>(claw error)</small>' : ''}</td><td class="n">${hits.length}/${done}</td><td class="n">${fx(mean(e))}</td><td class="n">${e.length ? fx(Math.max(...e)) : '–'}</td><td class="n">${fx(mean(he))}</td><td class="n">${fx(mean(hits.map((k) => k.t)))}</td></tr>`;
        }).join('');
        h += `<table class="pl-tbl"><thead><tr><th>#</th><th>Step</th><th>Done</th><th>Error in</th><th>Max in</th><th>Head °</th><th>At s</th></tr></thead><tbody>${rows}
          <tr data-row="end" class="pl-endrow ${this.focusStep === null ? 'pl-on' : ''}" tabindex="0"><td></td><td>End of the run</td><td class="n">${done}</td><td class="n">${fx(mean(ferr))}</td><td class="n">${fx(ferr[ferr.length - 1])}</td><td class="n">${fx(mean(runs.map((r) => Math.abs(wrap180(r.final.th - endP.th)))))}</td><td class="n">${fx(mean(runs.map((r) => r.time)))}</td></tr></tbody></table>
          <p class="note">Error is the robot centre's distance from the planned point when the step finished (inches). The field shows ${this.focusStep === null ? 'where each robot ended (gold: it scored a CORE); the ring is the planned end' : `where each robot finished step ${this.focusStep + 1}; the ring is the plan`}. Select a row to see a step.</p>`;
      } else if (this.busy === 'test') h += '<p class="pl-empty">Running the first robot…</p>';
    }
    pane.innerHTML = h;
    const ns = $('[data-n]', pane); ns.addEventListener('change', () => { this.mcRuns = Number(ns.value); this.renderTest(); });
    $('[data-errs]', pane).addEventListener('change', (e) => { this.mcPerfect = !e.target.checked; });
    const tb = $('[data-test]', pane); if (tb) tb.addEventListener('click', () => this.test());
    const cb = $('[data-cancel]', pane); if (cb) cb.addEventListener('click', () => { this.cancel = true; cb.disabled = true; cb.textContent = 'Cancelling…'; });
    $$('[data-row]', pane).forEach((tr) => {
      const pick = () => { this.focusStep = tr.dataset.row === 'end' ? null : Number(tr.dataset.row); this.renderTest(); this.drawMc(); };
      tr.addEventListener('click', pick);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
  }

  // ---------------------------------------------------------------- runs
  batchOpts(extra) {
    return { text: this.code(), fileName: `${opNameOf(this.route)}.cpp`, op: opNameOf(this.route), robot: this.route.robot, steps: this.route.steps.length, cancelled: () => this.cancel, ...extra };
  }
  setBusy(b) {
    this.busy = b;
    if (!this.m) return;
    $('[data-run]', this.el).disabled = !!b;
    $$('.pl-bar select, .pl-bar button', this.el).forEach((x) => { x.disabled = !!b; });
    this.renderPane();
  }

  async test() {
    if (this.busy || !this.route.steps.length) return;
    const n = this.mcRuns || 20;
    this.cancel = false; this.focusStep = null;
    this.mc = { n, runs: [], steps: this.route.steps.map((s) => ({ ...s })), plan: this.plan(), stale: false };
    const mc = this.mc;
    this.setBusy('test');
    try {
      await runBatch(this.sim, this.batchOpts({ runs: n, errors: !this.mcPerfect, seed: SEED, onRun: (i, res) => { mc.runs.push(res); if (this.mc === mc) { this.renderTest(); this.drawMc(); } } }));
    } catch (e) { mc.error = e.message; }
    if (this.cancel && mc.runs.length < n) mc.error = `Cancelled after ${mc.runs.length} of ${n} runs.`;
    this.setBusy(null);
    this.drawMc();
  }

  // run on a perfect robot and correct each drive's distance by what it over- or under-shot
  async tune() {
    if (this.busy) return;
    const R = this.route;
    this.cancel = false;
    this.setBusy('tune');
    let resid = [];
    try {
      for (let pass = 0; pass < PASSES && !this.cancel; pass++) {
        this.tuneMsg = `Pass ${pass + 1} of ${PASSES}…`; this.renderPane();
        const [res] = await runBatch(this.sim, this.batchOpts({ runs: 1, errors: false, seed: 1, onRun: () => {} }));
        if (!res) break;
        const P = this.plan(), st = this.start;
        resid = [];
        R.steps.forEach((s, i) => {
          const p = P[i], b = res.marks[i], a = i === 0 ? { X: st.X, Y: st.Y } : res.marks[i - 1];
          if (s.kind !== 'drive' || p.len < 0.5 || !a || !b) return;
          // a claw leg is judged by where the claw ended up
          const end = p.tool ? this.clawAt(b, p.lead) : b, goal = p.tool || p;
          resid.push(Math.hypot(goal.X - end.X, goal.Y - end.Y));
          // this leg's own miss: what it actually moved against the planned move. Aim the other way by that
          // much (each leg corrects only itself, from wherever it really started, so corrections do not fight)
          const from = i === 0 ? st : P[i - 1];
          const ex = (end.X - a.X) - (goal.X - from.X), ey = (end.Y - a.Y) - (goal.Y - from.Y);
          // sideways aim also swings the claw, which sits ahead of the centre: (len + lead) / len times as far
          const al = ex * p.ux + ey * p.uy, lat = -ex * p.uy + ey * p.ux;
          const kl = 0.9 * (p.tool ? p.len / (p.len + p.lead) : 1);
          const cx = 0.9 * al * p.ux - kl * lat * p.uy, cy = 0.9 * al * p.uy + kl * lat * p.ux;
          const cap = (v) => Math.max(-12, Math.min(12, r1(v)));
          s.ax = cap((s.ax || 0) - cx); s.ay = cap((s.ay || 0) - cy);
        });
        this.save();
        if (!this.m) return;
        this.drawRoute();
      }
      this.tuneMsg = resid.length ? `Last pass: every drive ended within ${fx(Math.max(...resid))} in of its point before this correction.` : 'No drive finished; check the route.';
    } catch (e) { this.tuneMsg = e.message; }
    this.setBusy(null);
    this.changed(true);
  }

  clawAt(k, lead) { const a = k.th * Math.PI / 180; return { X: k.X + Math.cos(a) * lead, Y: k.Y + Math.sin(a) * lead }; }

  // load the generated OpMode into Robot code and start it on the field
  runOnField() {
    if (this.busy) return;
    if (!this.route.steps.length) { this.ui.toast('Add some steps first'); return; }
    const rc = this.sim.robotCode, S = rc.state, file = `${opNameOf(this.route)}.cpp`, text = this.code();
    const go = () => {
      S.files = [{ name: file, text }];
      S.op = opNameOf(this.route); S.robot = this.route.robot; S.pose = { side: 0, fwd: 0, heading: 0 };
      rc.recompile();
      if (rc.compileError) { this.ui.toast(`The generated code does not compile: ${rc.compileError.message}`); return; }
      rc.save();
      this.sim.ctx.startRobotCode();
    };
    const others = S.files.filter((f) => f.name.toLowerCase() !== file.toLowerCase());
    if (others.length) this.ui.confirmAction({ title: 'Replace the Robot code files?', text: `Robot code holds ${others.map((f) => f.name).join(', ')}. Running the route replaces ${others.length > 1 ? 'them' : 'it'} with ${file}. The route stays saved in the planner.`, ok: 'Replace and run', fn: go });
    else go();
  }
}
