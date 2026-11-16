// Robot designer: change the robot's design (drivetrain, battery, tyres, mass, arm), put it on the robots in the
// simulator, and measure it against the stock robot with a headless test battery.
import { icon } from '../icons.js';
import {
  PARAMS, PRESETS, STOCK, stockDesign, presetDesign, cleanDesign, isStock, changedKeys, applyToRobot, appliedDesign,
  armGeom, derived, POLE_TOPS,
} from './designer-model.js';
import { Bench, Cancelled, TESTS, CYCLE_SECONDS } from './designer-tests.js';

const DEG = Math.PI / 180;
const STORE = 'od-designer-designs-v1';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const frag = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const fmt = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(d));
const shown = (p, v) => v * (p.scale || 1);

// rows of the results table: get() reads one battery result; better: which direction is an improvement
const ROWS = [
  { t: 'sprint', test: 'Sprint', m: 'Time over 2 m from rest', unit: 's', d: 2, get: (r) => r.sprint?.time, better: -1, ok: (r) => r.sprint?.pass },
  { t: 'sprint', test: '', m: 'Top speed', unit: 'm/s', d: 2, get: (r) => r.sprint?.top, better: 1 },
  { t: 'sprint', test: '', m: 'Lowest pack voltage', unit: 'V', d: 2, get: (r) => r.sprint?.sag, better: 1 },
  { t: 'turn', test: 'Turn', m: '180° on the spot', unit: 's', d: 2, get: (r) => r.turn?.time, better: -1, ok: (r) => r.turn?.pass },
  { t: 'push', test: 'Push', m: 'Ground gained against a stock robot in 3 s (median of 3 starts)', unit: 'cm', d: 1, get: (r) => r.push && r.push.disp * 100, better: 1, chip: (r) => r.push && ({ win: ['Wins', 'ok'], draw: ['Even', 'mid'], loss: ['Loses', 'bad'] })[r.push.win] },
  { t: 'push', test: '', m: 'Spread over the 3 starts', unit: 'cm', d: 1, get: (r) => r.push && r.push.runs && (r.push.max - r.push.min) * 100, better: 0 },
  { t: 'ramp', test: 'Ramp', m: 'Time to dock, 80 / 62 % power', unit: 's', d: 2, get: (r) => r.ramp?.time, better: -1, ok: (r) => r.ramp?.pass },
  { t: 'reach', test: 'Reach', m: 'Lowest claw height (ring centre)', unit: 'mm', d: 0, get: (r) => r.reach && r.reach.hMin * 1000, better: 0 },
  { t: 'reach', test: '', m: 'Highest claw height', unit: 'mm', d: 0, get: (r) => r.reach && r.reach.hMax * 1000, better: 1 },
  { t: 'reach', test: '', m: 'Arm angle where a CORE clears a Star Pole', unit: '°', d: 1, get: (r) => r.reach?.starA, better: 0, ok: (r) => r.reach && r.reach.starA !== null },
  { t: 'reach', test: '', m: 'Arm angle where a CORE clears a High Pole', unit: '°', d: 1, get: (r) => r.reach?.highA, better: 0, ok: (r) => r.reach && r.reach.highA !== null },
  { t: 'reach', test: '', m: 'Apex Pole: claw short of the axis as the ring clears the cap', unit: 'mm', d: 1, get: (r) => r.reach?.apex?.dist * 1000, better: -1, ok: (r) => r.reach?.apex?.pass },
  { t: 'cycle', test: 'Cycle', m: `COREs scored by the AI (Pro) in ${CYCLE_SECONDS} s of Practice`, unit: '', d: 0, get: (r) => r.cycle?.cores, better: 1 },
  { t: 'cycle', test: '', m: 'Points', unit: '', d: 0, get: (r) => r.cycle?.points, better: 1 },
];

export class Designer {
  constructor(sim, ui) {
    this.sim = sim; this.ui = ui;
    this.draft = stockDesign(); this.draftName = PRESETS[0].name; this.presetId = 'stock';
    this.appliedName = null;
    this.previewDeg = 45;
    this.picked = Object.fromEntries(TESTS.map((t) => [t.id, true]));
    this.rerunStock = false;
    this.stockResults = null; this.designResults = null; this.resultName = null; this.resultDesign = null;
    this.running = null;            // { bench, progress, label }
    this.m = null;
  }

  open() {
    if (this.m) return;
    const m = this.ui.modal({
      title: 'Robot designer', width: 980, cls: 'dz-modal',
      tabs: [
        { label: 'Design', body: () => this.designTab() },
        { label: 'Tests', body: () => this.testsTab() },
        { label: 'Saved designs', body: () => this.savedTab() },
      ],
      footer: `<span class="dz-status" data-status></span><button class="btn" data-restore>Restore stock</button><button class="btn primary" data-apply>Apply to robots</button>`,
      onClose: () => { this.m = null; if (this.running) this.running.bench.cancel(); },
    });
    this.m = m;
    m.el.querySelector('[data-apply]').addEventListener('click', () => this.applyAll(this.draft, this.draftName));
    m.el.querySelector('[data-restore]').addEventListener('click', () => this.applyAll(null));
    this.syncFooter();
  }

  // ------------------------------------------------------------ applying
  liveDesign() { return appliedDesign(this.sim.robots[0]); }
  applyAll(design, name) {
    if (this.running) return;
    for (const r of this.sim.robots) applyToRobot(r, design);
    const stock = !design || isStock(design);
    this.appliedName = stock ? null : name || 'Custom design';
    this.ui.toast(stock ? 'All robots restored to the stock design' : `${this.appliedName} applied to all four robots`);
    this.syncFooter();
  }
  syncFooter() {
    if (!this.m) return;
    const live = this.liveDesign();
    const st = this.m.el.querySelector('[data-status]');
    st.innerHTML = live ? `On the field: <b>${esc(this.appliedName || 'Custom design')}</b>` : 'On the field: <b>Stock</b>';
    st.classList.toggle('dz-mod', !!live);
    for (const b of this.m.el.querySelectorAll('[data-apply], [data-restore]')) b.disabled = !!this.running;
    this.m.el.querySelector('[data-restore]').disabled = !!this.running || !live;
  }

  // ------------------------------------------------------------ Design tab
  designTab() {
    const el = frag(`<div class="dz-design">
      <div class="dz-presets" role="group" aria-label="Presets">${PRESETS.map((p) => `<button class="dz-chip" data-preset="${p.id}">${esc(p.name)}</button>`).join('')}</div>
      <p class="dz-lead" data-lead></p>
      <div class="dz-cols">
        <div class="dz-form" data-form></div>
        <div class="dz-side">
          <div class="dz-card"><div class="dz-card-h">Arm side view</div><div data-svg></div>
            <label class="dz-slider">Arm angle <input type="range" data-angle step="0.5"><span data-angle-v></span></label></div>
          <div class="dz-card"><div class="dz-card-h">Quick numbers</div><div data-derived></div></div>
        </div>
      </div></div>`);
    const form = el.querySelector('[data-form]');
    let group = '';
    let html = '';
    for (const p of PARAMS) {
      if (p.group !== group) { group = p.group; html += `<div class="dz-group">${esc(group)}</div>`; }
      html += `<label class="dz-row" data-row="${p.k}"><span class="dz-l"><b>${esc(p.label)}</b><small>${esc(p.help)}</small></span>
        <input class="field-in dz-in" type="number" data-k="${p.k}" min="${p.min}" max="${p.max}" step="${p.step}" aria-label="${esc(p.label)} (${esc(p.unit)})">
        <span class="dz-u">${esc(p.unit)}</span><span class="dz-stock" data-stock="${p.k}">stock ${fmt(shown(p, STOCK[p.k]), p.digits)}</span></label>`;
    }
    form.innerHTML = html;
    form.addEventListener('change', (e) => {
      const k = e.target.dataset.k; if (!k) return;
      const p = PARAMS.find((x) => x.k === k);
      const v = parseFloat(e.target.value);
      if (Number.isFinite(v)) { this.draft = cleanDesign({ ...this.draft, [k]: v / (p.scale || 1) }); this.presetId = null; this.draftName = 'Custom design'; }
      this.refreshDesign(el);
    });
    el.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const p = PRESETS.find((x) => x.id === b.dataset.preset);
      this.draft = presetDesign(p.id); this.presetId = p.id; this.draftName = p.name;
      this.refreshDesign(el);
    }));
    const ang = el.querySelector('[data-angle]');
    ang.addEventListener('input', () => { this.previewDeg = parseFloat(ang.value); this.drawArm(el); });
    this.refreshDesign(el);
    return el;
  }
  refreshDesign(el) {
    const d = this.draft;
    el.querySelectorAll('[data-preset]').forEach((b) => b.classList.toggle('on', b.dataset.preset === this.presetId));
    const pre = PRESETS.find((x) => x.id === this.presetId);
    const ch = changedKeys(d);
    el.querySelector('[data-lead]').textContent = pre ? pre.note
      : ch.length ? `${this.draftName}: ${ch.length} change${ch.length > 1 ? 's' : ''} from stock (${ch.map((k) => PARAMS.find((p) => p.k === k).label.toLowerCase()).join(', ')}).` : 'Same as stock.';
    for (const p of PARAMS) {
      const inp = el.querySelector(`[data-k="${p.k}"]`);
      if (document.activeElement !== inp) inp.value = +shown(p, d[p.k]).toFixed(p.digits + 1);
      el.querySelector(`[data-row="${p.k}"]`).classList.toggle('dz-changed', ch.includes(p.k));
    }
    const r = this.sim.robots[0];
    const g = armGeom(r.P, r.theta0, d);
    const ang = el.querySelector('[data-angle]');
    ang.min = g.armMin.toFixed(1); ang.max = String(d.armMax);
    this.previewDeg = Math.max(g.armMin, Math.min(d.armMax, this.previewDeg));
    ang.value = String(this.previewDeg);
    this.drawArm(el);
    const q = derived(d, r.P, r.theta0), s = derived(STOCK, r.P, r.theta0);
    const line = (label, a, b, unit, dg, note = '') => `<div class="dz-kv"><span>${label}${note ? `<small>${note}</small>` : ''}</span><b>${fmt(a, dg)} ${unit}</b><i>${Math.abs(a - b) > 1e-9 ? `stock ${fmt(b, dg)}` : ''}</i></div>`;
    el.querySelector('[data-derived]').innerHTML = [
      line('Free-running speed', q.vFree, s.vFree, 'm/s', 2, 'wheel surface, no load'),
      line('Stall push, 4 wheels', q.stallPush, s.stallPush, 'N', 1, 'motor limit at pack voltage'),
      line('Tyre grip limit', q.traction, s.traction, 'N', 1, 'μ × weight: the push ceiling'),
      line('Arm floor angle', q.armMin, s.armMin, '°', 1, 'claw on the tiles'),
      line('Highest ring bottom', q.ringTopClear * 1000, s.ringTopClear * 1000, 'mm', 0, 'Star 105, High 130'),
    ].join('');
  }
  // side view of the arm (robot frame, mm above the tiles): links at the floor stop, the top stop and the
  // slider angle, the ring's path, and the pole tops
  drawArm(el) {
    const host = el.querySelector('[data-svg]');
    if (!host) return;
    el.querySelector('[data-angle-v]').textContent = `${this.previewDeg.toFixed(1)}°`;
    host.innerHTML = armSvg(this.sim.robots[0], this.draft, this.previewDeg, this.apexInfo());
  }
  // where an Apex Pole sits relative to a robot on its deck (geometry only, stock field)
  apexInfo() {
    if (this._apex) return this._apex;
    try { const a = new Bench(this.sim).reach(STOCK).apex; this._apex = a ? { ahead: a.ahead, floor: a.deckFloor } : null; } catch { this._apex = null; }
    return this._apex;
  }

  // ------------------------------------------------------------ Tests tab
  testsTab() {
    const el = frag(`<div class="dz-tests">
      <div class="dz-runbar">
        <div class="dz-picks">${TESTS.map((t) => `<label class="dz-pick"><input type="checkbox" data-pick="${t.id}" ${this.picked[t.id] ? 'checked' : ''}> ${t.label}</label>`).join('')}</div>
        <label class="dz-pick dz-rerun"><input type="checkbox" data-rerun ${this.rerunStock ? 'checked' : ''}> Re-run Stock</label>
        <button class="btn primary" data-run>${icon('play')}Run tests</button>
        <button class="btn danger hidden" data-cancel>Cancel</button>
      </div>
      <div class="dz-progress hidden" data-progress><div class="dz-bar"><i data-bar></i></div><span data-plabel></span></div>
      <p class="note dz-note">Tests run headlessly in Practice with only the robot under test on the field (the others are benched),
        first for Stock and then for the design on the Design tab. The field is reset afterwards and the robots go back to the design they had.
        Push puts the design against a stock robot. Cycle lets the AI (Pro) drive for ${CYCLE_SECONDS} s; it was tuned for the stock robot.</p>
      <div data-results></div></div>`);
    el.querySelectorAll('[data-pick]').forEach((c) => c.addEventListener('change', () => { this.picked[c.dataset.pick] = c.checked; }));
    el.querySelector('[data-rerun]').addEventListener('change', (e) => { this.rerunStock = e.target.checked; });
    el.querySelector('[data-run]').addEventListener('click', () => this.runBattery());
    el.querySelector('[data-cancel]').addEventListener('click', () => { if (this.running) this.running.bench.cancel(); });
    this.testsEl = el;
    this.renderResults();
    this.renderProgress();
    return el;
  }
  renderProgress() {
    const el = this.testsEl; if (!el || !el.isConnected) return;
    const run = this.running;
    el.querySelector('[data-progress]').classList.toggle('hidden', !run);
    el.querySelector('[data-run]').classList.toggle('hidden', !!run);
    el.querySelector('[data-cancel]').classList.toggle('hidden', !run);
    el.querySelectorAll('[data-pick], [data-rerun]').forEach((c) => { c.disabled = !!run; });
    if (run) {
      el.querySelector('[data-bar]').style.width = `${Math.round(run.progress * 100)}%`;
      el.querySelector('[data-plabel]').textContent = run.label;
    }
  }
  async runBattery() {
    if (this.running) return;
    const ids = TESTS.filter((t) => this.picked[t.id]).map((t) => t.id);
    if (!ids.length) { this.ui.toast('Pick at least one test'); return; }
    const design = { ...this.draft }, name = this.draftName;
    const sameAsStock = isStock(design);
    const needStock = this.rerunStock || !this.stockResults || ids.some((id) => !(id in this.stockResults));
    const plan = [];
    if (needStock || sameAsStock) for (const id of ids) plan.push(['stock', id]);
    if (!sameAsStock) for (const id of ids) plan.push(['design', id]);
    const weight = (id) => Math.max(0.5, TESTS.find((t) => t.id === id).sim);
    const total = plan.reduce((s, [, id]) => s + weight(id), 0);
    const bench = new Bench(this.sim);
    this.running = { bench, progress: 0, label: 'Preparing the field' };
    this.syncFooter(); this.renderProgress();
    const stockRes = needStock || sameAsStock ? {} : { ...this.stockResults };
    const designRes = {};
    let done = 0, ok = false;
    try {
      bench.begin();
      for (const [who, id] of plan) {
        const t = TESTS.find((x) => x.id === id);
        this.running.label = `${t.label}: ${who === 'stock' ? 'Stock' : name}`;
        this.running.progress = done / total; this.renderProgress();
        const d = who === 'stock' ? null : design;
        const onTick = (s) => { this.running.progress = (done + weight(id) * Math.min(1, s / CYCLE_SECONDS)) / total; this.renderProgress(); };
        const res = id === 'reach' ? bench.reach(d || STOCK) : id === 'cycle' ? await bench.cycle(d, onTick) : await bench[id](d);
        (who === 'stock' ? stockRes : designRes)[id] = res;
        done += weight(id);
      }
      ok = true;
    } catch (e) {
      if (e instanceof Cancelled) this.ui.toast('Tests cancelled; the field has been restored');
      else { console.error(e); this.ui.toast(`Tests stopped: ${e.message}`); }
    } finally {
      bench.end();
      this.running = null;
    }
    if (ok) {
      this.stockResults = { ...(this.stockResults || {}), ...stockRes };
      this.designResults = sameAsStock ? null : designRes;
      this.resultName = sameAsStock ? null : name; this.resultDesign = sameAsStock ? null : design;
      this.resultIds = ids;
    }
    this.syncFooter(); this.renderProgress(); this.renderResults();
  }
  renderResults() {
    const el = this.testsEl; if (!el || !el.isConnected) return;
    const host = el.querySelector('[data-results]');
    const S = this.stockResults, D = this.designResults;
    if (!S) { host.innerHTML = '<div class="dz-empty">No results yet. Pick the tests and press Run tests.</div>'; return; }
    const ids = this.resultIds || Object.keys(S);
    const rows = ROWS.filter((r) => ids.includes(r.t) && (r.t in S));
    const chip = (row, R) => {
      if (!R || !(row.t in R)) return '';
      if (row.chip) { const c = row.chip(R); return c ? `<span class="dz-res dz-${c[1]}">${c[0]}</span>` : ''; }
      if (!row.ok) return '';
      return row.ok(R) ? '<span class="dz-res dz-ok">Pass</span>' : '<span class="dz-res dz-bad">Fail</span>';
    };
    const delta = (row) => {
      if (!D) return '';
      const a = row.get(S), b = row.get(D);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return '';
      const dv = b - a;
      if (Math.abs(dv) < Math.pow(10, -row.d) / 2) return '<span class="dz-same">same</span>';
      const pct = Math.abs(a) > 1e-9 && row.unit !== '°' && row.unit !== 'mm' && row.unit !== 'cm' ? ` (${dv > 0 ? '+' : ''}${(dv / Math.abs(a) * 100).toFixed(0)} %)` : '';
      const cls = row.better === 0 ? '' : Math.sign(dv) === row.better ? 'dz-up' : 'dz-down';
      return `<span class="${cls}">${dv > 0 ? '+' : ''}${dv.toFixed(row.d)}${pct}</span>`;
    };
    const cell = (row, R) => (R && row.t in R ? `${fmt(row.get(R), row.d)}${row.unit && Number.isFinite(row.get(R)) ? ` <small>${row.unit}</small>` : ''}` : '');
    host.innerHTML = `<table class="dz-table"><thead><tr><th>Test</th><th>Measure</th><th>Stock</th><th>${esc(D ? this.resultName : 'Design')}</th><th>Change</th><th>Result</th></tr></thead><tbody>
      ${rows.map((row) => `<tr class="${row.test ? 'dz-first' : ''}"><td>${row.test}</td><td>${row.m}</td><td>${cell(row, S)} ${D ? '' : chip(row, S)}</td><td>${D ? cell(row, D) : '<span class="dz-same">run a design</span>'}</td><td>${delta(row)}</td><td>${D ? chip(row, D) : ''}</td></tr>`).join('')}
      </tbody></table>
      <div class="dz-verdict"><div class="dz-card-h">Verdict</div>${verdict(S, D, this.resultName, this.resultDesign).map((s) => `<p>${s}</p>`).join('')}</div>
      ${detailNotes(S, D)}`;
  }

  // ------------------------------------------------------------ Saved tab
  loadSaved() { try { const v = JSON.parse(localStorage.getItem(STORE) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
  storeSaved(list) { try { if (list.length) localStorage.setItem(STORE, JSON.stringify(list)); else localStorage.removeItem(STORE); return true; } catch { this.ui.toast('Could not save: browser storage is unavailable'); return false; } }
  savedTab() {
    const el = frag(`<div class="dz-saved">
      <p class="dz-lead">Designs are kept in this browser only. Nothing is applied when the page loads: the robots always start as Stock.</p>
      <form class="dz-saveform" data-save><input class="field-in" data-name maxlength="40" placeholder="Name for the design on the Design tab" value="${esc(this.presetId === 'stock' ? '' : this.draftName)}"><button class="btn" type="submit">Save current design</button></form>
      <div data-list></div></div>`);
    const draw = () => {
      const list = this.loadSaved();
      el.querySelector('[data-list]').innerHTML = list.length ? `<table class="dz-table dz-savedtable"><thead><tr><th>Name</th><th>Changes from stock</th><th></th></tr></thead><tbody>${list.map((s, i) => {
        const d = cleanDesign(s.design);
        const ch = changedKeys(d).map((k) => { const p = PARAMS.find((x) => x.k === k); return `${p.label.toLowerCase()} ${fmt(shown(p, d[k]), p.digits)} ${p.unit}`; });
        return `<tr><td><b>${esc(s.name)}</b></td><td class="dz-muted">${esc(ch.join(', ') || 'none')}</td><td class="dz-actions"><button class="btn sm" data-load="${i}">Load</button><button class="btn sm ghost" data-del="${i}">Delete</button></td></tr>`;
      }).join('')}</tbody></table>` : '<div class="dz-empty">No saved designs yet.</div>';
    };
    el.querySelector('[data-save]').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = el.querySelector('[data-name]').value.trim();
      if (!name) { this.ui.toast('Give the design a name'); return; }
      const list = this.loadSaved().filter((s) => s.name !== name);
      list.push({ name, design: { ...this.draft }, saved: Date.now() });
      if (this.storeSaved(list)) { this.draftName = name; this.ui.toast(`Saved "${name}"`); draw(); }
    });
    el.addEventListener('click', (e) => {
      const ld = e.target.closest('[data-load]'), dl = e.target.closest('[data-del]');
      const list = this.loadSaved();
      if (ld) {
        const s = list[Number(ld.dataset.load)]; if (!s) return;
        this.draft = cleanDesign(s.design); this.draftName = s.name; this.presetId = null;
        this.ui.toast(`Loaded "${s.name}" into the Design tab`);
        if (this.m && this.m.showTab) this.m.showTab(0);
      } else if (dl) {
        list.splice(Number(dl.dataset.del), 1); this.storeSaved(list); draw();
      }
    });
    draw();
    return el;
  }
}

// ------------------------------------------------------------------ verdict
function verdict(S, D, name, design) {
  const out = [];
  if (!D) {
    out.push('These are the stock robot\'s numbers. Pick or edit a design on the Design tab and run the tests again to compare.');
    return out;
  }
  const pct = (a, b) => (b - a) / Math.abs(a) * 100;
  if (S.sprint && D.sprint && S.sprint.time && D.sprint.time) {
    const p = pct(S.sprint.time, D.sprint.time);
    out.push(Math.abs(p) < 3 ? `Straight-line speed is about the same (${fmt(D.sprint.time)} s over 2 m against ${fmt(S.sprint.time)} s).`
      : p < 0 ? `Quicker in a straight line: 2 m in ${fmt(D.sprint.time)} s, ${fmt(-p, 0)} % faster than stock, with a top speed of ${fmt(D.sprint.top)} m/s (stock ${fmt(S.sprint.top)}).`
        : `Slower in a straight line: 2 m takes ${fmt(D.sprint.time)} s, ${fmt(p, 0)} % longer than stock, and it tops out at ${fmt(D.sprint.top)} m/s (stock ${fmt(S.sprint.top)}).`);
  }
  if (S.turn && D.turn && S.turn.time && D.turn.time) {
    const p = pct(S.turn.time, D.turn.time);
    out.push(Math.abs(p) < 5 ? `It turns about as quickly as stock (${fmt(D.turn.time)} s for 180°).`
      : `It turns ${p < 0 ? 'faster' : 'slower'}: ${fmt(D.turn.time)} s for 180° against ${fmt(S.turn.time)} s.`);
  }
  if (D.push) {
    const cm = D.push.disp * 100;
    out.push(D.push.win === 'win' ? `In a shoving match it beats the stock robot from all three starts, driving it back ${fmt(cm, 0)} cm in 3 s (median).`
      : D.push.win === 'loss' ? `In a shoving match it loses from all three starts: the stock robot drives it back ${fmt(-cm, 0)} cm in 3 s (median).`
        : `A shoving match with the stock robot is even: the three starts went ${D.push.runs.map((v) => `${v > 0 ? '+' : ''}${fmt(v * 100, 0)}`).join(', ')} cm. Both robots are grip-limited, so only more weight or tyre grip tips it reliably.`);
  }
  if (D.ramp) {
    out.push(D.ramp.pass ? `It climbs its Space Station ramp from the AI's run-up and docks in ${fmt(D.ramp.time)} s${S.ramp && S.ramp.time ? ` (stock ${fmt(S.ramp.time)} s)` : ''}${D.ramp.held ? '' : ', but did not stay docked'}.`
      : `It does not dock from the AI's run-up at 80 / 62 % power${D.ramp.retries ? ` (${D.ramp.retries} attempts balked)` : ''}. Expect drivers to struggle with the End Game.`);
  }
  if (D.reach) {
    const R = D.reach, a = R.apex;
    const poles = R.highA === null ? 'A held CORE cannot clear a High Pole at any arm angle.' : R.starA === null ? 'A held CORE cannot clear a Star Pole.' : '';
    if (poles) out.push(poles);
    if (a) {
      out.push(a.pass ? `The Apex Pole is in reach: as the ring clears the cap the claw is ${a.dist < 0 ? `${fmt(-a.dist * 1000, 0)} mm past the pole, so the robot backs ${fmt(-a.dist * 1000, 0)} mm off the guard to line up` : `${fmt(a.dist * 1000, 0)} mm short, inside the 14 mm a ring allows`}.`
        : a.clearAngle === null ? 'A held CORE cannot be lifted over the Apex Pole cap from the deck.'
          : `The Apex Pole stays out of reach: the claw is ${fmt(a.dist * 1000, 0)} mm short of the axis (a ring threads within 14 mm).`);
    }
  }
  if (S.cycle && D.cycle) {
    const dc = D.cycle.cores - S.cycle.cores;
    out.push(`Match pace (AI, ${CYCLE_SECONDS} s): ${D.cycle.cores} COREs against ${S.cycle.cores} for stock. ${Math.abs(dc) <= 1 ? 'That is within the run-to-run noise of one AI run.' : dc > 0 ? 'A clear gain.' : 'A clear loss.'}`);
    if (design && Math.abs(design.motorFreeRPM * design.wheelR / (STOCK.motorFreeRPM * STOCK.wheelR) - 1) > 0.1) out.push('The AI drivers were tuned for the stock drivetrain speed, so the Cycle number for a re-geared robot reflects their tuning as much as the robot.');
  }
  return out;
}
function detailNotes(S, D) {
  const R = (D && D.reach) || (S && S.reach);
  const bits = [];
  if (R && R.apex) {
    bits.push(`Apex geometry: robot on its own level deck facing the wall, front bumper on the wall-side guard, robot floor ${fmt(R.apex.deckFloor * 1000, 0)} mm above the tiles; ring underside must clear the cap at ${fmt(POLE_TOPS.apex * 1000, 0)} mm.${R.apex.beached ? ' Facing the wall the chassis straddles the deck crest and rests on its base plate, so a driver has to slide it there rather than drive it.' : ''} The README's hand estimate for the stock robot (17 mm short at about 16°) assumed a different stance; this check uses the simulated deck and guard colliders.`);
  }
  if (R) bits.push(`The AI's score angles put the ring ${fmt(R.aiStar * 1000, 0)} mm above a Star Pole (36°) and ${fmt(R.aiHigh * 1000, 0)} mm above a High Pole (48°).`);
  return bits.length ? `<div class="dz-details">${bits.map((b) => `<p>${b}</p>`).join('')}</div>` : '';
}

// ------------------------------------------------------------------ side-view drawing (mm, robot frame)
function armSvg(robot, d, previewDeg, apex) {
  const P = robot.P, g = armGeom(P, robot.theta0, d);
  const fy = g.floorY;
  const mm = (v) => v * 1000;
  const top = Math.max(250, mm(g.height(Math.min(90, d.armMax) * DEG)) + 45);
  const X0 = -190, X1 = 420, W = X1 - X0, H = top + 30;
  const X = (x) => (mm(x) - X0).toFixed(1);
  const Y = (y) => (top - mm(y - fy)).toFixed(1);          // y in robot frame metres
  const Yh = (h) => (top - mm(h)).toFixed(1);               // height above the tiles, metres
  const rect = (cx, cy, hx, hy, cls) => `<rect class="${cls}" x="${X(cx - hx)}" y="${Y(cy + hy)}" width="${mm(2 * hx).toFixed(1)}" height="${mm(2 * hy).toFixed(1)}" rx="3"/>`;
  const pivL = P.armLower, pivU = P.armUpper;
  const pose = (deg, cls) => {
    const th = deg * DEG, c = Math.cos(th), s = Math.sin(th);
    const tl = [pivL[0] + d.L * c, pivL[1] + d.L * s], tu = [pivU[0] + d.L * c, pivU[1] + d.L * s];
    const h = g.hold(th);
    return `<g class="${cls}"><line x1="${X(pivL[0])}" y1="${Y(pivL[1])}" x2="${X(tl[0])}" y2="${Y(tl[1])}"/><line x1="${X(pivU[0])}" y1="${Y(pivU[1])}" x2="${X(tu[0])}" y2="${Y(tu[1])}"/>
      <line x1="${X(tl[0])}" y1="${Y(tl[1])}" x2="${X(tu[0])}" y2="${Y(tu[1])}"/><line x1="${X(tl[0])}" y1="${Y(tl[1])}" x2="${X(h.x)}" y2="${Y(h.y)}"/>
      <rect class="dz-ring" x="${X(h.x - 0.0475)}" y="${Y(h.y + 0.015)}" width="95" height="30" rx="4"/></g>`;
  };
  let arc = '';
  for (let a = g.armMin; a <= d.armMax + 1e-9; a += 2) { const h = g.hold(a * DEG); arc += `${arc ? 'L' : 'M'}${X(h.x)} ${Y(h.y)} `; }
  { const h = g.hold(d.armMax * DEG); arc += `L${X(h.x)} ${Y(h.y)}`; }
  const R = d.wheelR;
  const hl = (h, label, cls) => `<line class="${cls}" x1="4" x2="${W - 4}" y1="${Yh(h)}" y2="${Yh(h)}"/><text class="dz-t ${cls}-t" x="${W - 6}" y="${(+Yh(h) - 4).toFixed(1)}" text-anchor="end">${label}</text>`;
  let apexG = '';
  if (apex) {
    const capH = POLE_TOPS.apex - apex.floor, px = (apex.ahead * 1000 - X0).toFixed(1);
    apexG = `<g class="dz-apex"><line x1="${px}" x2="${px}" y1="${Yh(0)}" y2="${Yh(capH)}"/><rect x="${(+px - 14).toFixed(1)}" y="${Yh(capH)}" width="28" height="8" rx="2"/>
      <text class="dz-t dz-apex-t" x="${(+px + 20).toFixed(1)}" y="${(+Yh(capH) + 22).toFixed(1)}">Apex cap seen from the deck</text>
      <text class="dz-t dz-apex-t" x="${(+px + 20).toFixed(1)}" y="${(+Yh(capH) + 36).toFixed(1)}">${fmt(capH * 1000, 0)} mm above the robot's floor</text></g>`;
  }
  return `<svg class="dz-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Side view of the arm: claw from ${fmt(mm(g.height(g.armMin * DEG)), 0)} to ${fmt(mm(g.height(Math.min(90, d.armMax) * DEG)), 0)} mm above the tiles">
    <line class="dz-floor" x1="0" x2="${W}" y1="${Yh(0)}" y2="${Yh(0)}"/>
    ${hl(POLE_TOPS.high, 'High Pole top 130 mm', 'dz-hi')}${hl(POLE_TOPS.star, 'Star Pole top 105 mm', 'dz-st')}
    ${apexG}
    <path class="dz-arc" d="${arc}"/>
    ${rect(0, 0.0268, 0.150, 0.006, 'dz-bump')}${rect(0.142, 0.036, 0.008, 0.016, 'dz-bump')}${rect(-0.142, 0.036, 0.008, 0.016, 'dz-bump')}
    ${rect(-0.0035, 0.0578, 0.1285, 0.037, 'dz-chassis')}${rect(-0.0775, 0.1113, 0.0565, 0.0165, 'dz-chassis')}${rect(0.0005, 0.1018, 0.0305, 0.007, 'dz-chassis')}
    ${[P.wheelFL[0], P.wheelRL[0]].map((x) => `<circle class="dz-wheel" cx="${X(x)}" cy="${Y(P.wheelFL[1])}" r="${mm(R).toFixed(1)}"/>`).join('')}
    ${pose(g.armMin, 'dz-ghost')}${pose(d.armMax, 'dz-ghost')}${pose(previewDeg, 'dz-arm')}
    <circle class="dz-piv" cx="${X(pivL[0])}" cy="${Y(pivL[1])}" r="3.5"/><circle class="dz-piv" cx="${X(pivU[0])}" cy="${Y(pivU[1])}" r="3.5"/>
    <text class="dz-t" x="${X(-0.15)}" y="${(+Yh(0) + 18).toFixed(1)}">Links ${fmt(mm(d.L), 1)} mm, ${fmt(g.armMin, 1)}° to ${fmt(d.armMax, 0)}°</text>
    <text class="dz-t" x="${X(0.40)}" y="${(+Yh(0) + 18).toFixed(1)}" text-anchor="end">Ring centre ${fmt(mm(g.height(previewDeg * DEG)), 0)} mm</text>
  </svg>`;
}
