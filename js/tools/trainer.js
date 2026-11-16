// Driver trainer: timed drills on Red 1 with personal bests, split times and a ghost of the best run.
// A session borrows the player's local-match settings (drivers, AI) and puts them back when it ends; the
// drills themselves live in trainer-drills.js, storage in trainer-store.js and the ghost in trainer-ghost.js.
import { Settings } from '../settings.js';
import { icon } from '../icons.js';
import { fmtTime } from '../game.js';
import { DRILLS } from './trainer-drills.js';
import { Store, better } from './trainer-store.js';
import { Recorder, Ghost, ghostModel } from './trainer-ghost.js';

const COUNTDOWN = 3;
const BORROWED = ['drivers', 'bots', 'botLevel', 'touchRobot'];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// stopwatch: tenths, truncated
export function fmtT(t) {
  const d = Math.floor(Math.max(0, t) * 10 + 1e-6), m = Math.floor(d / 600);
  return `${m}:${((d % 600) / 10).toFixed(1).padStart(4, '0')}`;
}
const fmtSeg = (x) => (x < 60 ? `${(Math.floor(x * 10 + 1e-6) / 10).toFixed(1)} s` : fmtT(x));
const MINUS = '−';
const signed = (v, digits = 0) => `${v > 0 ? '+' : v < 0 ? MINUS : '±'}${Math.abs(v).toFixed(digits)}`;
const fmtValue = (v, metric) => (metric === 'time' ? fmtT(v) : signed(v));
// delta of a against b, and whether it is an improvement
function delta(a, b, metric) {
  if (metric === 'time') return { text: `${signed(a - b, 1)} s`, gain: a < b, even: Math.abs(a - b) < 0.05 };
  return { text: signed(a - b), gain: a > b, even: a === b };
}
const fmtDate = (ms) => { try { return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); } catch { return ''; } };

// a robot that sits a drill out waits outside the arena (the same bench the robot-code runs use)
function bench(r, on) {
  if (!!r.benched === on) return;
  r.benched = on;
  r.body.setEnabled(!on);
  r.root.visible = !on;
  if (on) { r.enabled = false; r.cmd = { throttle: 0, turn: 0, arm: 0 }; } else r.reset();
}

export class Trainer {
  constructor(sim, ui) {
    this.sim = sim; this.ui = ui;
    this.s = null;              // the running session
    this.ghost = null;
    this.overlay = null;
    this.hook = null;
    // the tab was closed during a drill: give the player their settings back
    const back = Store.takeRestore();
    if (back) Settings.replace(back);
  }

  // ================================================================ picker
  open() {
    if (this.sim.net && this.sim.net.active) { this.ui.toast('Leave the online room to use the driver trainer'); return; }
    ghostModel();
    const prefs = Store.prefs();
    let cur = DRILLS.find((d) => d.id === prefs.drill) || DRILLS[0];
    const opts = {};
    for (const d of DRILLS) {
      opts[d.id] = {};
      for (const o of d.options) {
        const want = prefs.opts && prefs.opts[d.id] ? prefs.opts[d.id][o.key] : undefined;
        opts[d.id][o.key] = o.values.some(([v]) => v === want) ? want : o.def;
      }
    }
    let ghostOn = prefs.ghost !== false;
    const m = this.ui.modal({
      title: 'Driver trainer', width: 640, cls: 'tr-modal', body: '<div class="tr-pick"></div>',
      footer: `<button class="btn ghost" data-tr-cancel>Cancel</button><button class="btn primary" data-tr-go>${icon('play')}Start drill</button>`,
    });
    const root = m.el.querySelector('.tr-pick');
    const seg = (attr, list, val) => `<div class="seg" role="group">${list.map(([v, l]) => `<button data-${attr}="${esc(v)}" aria-pressed="${v === val}" class="${v === val ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
    const render = () => {
      const o = opts[cur.id], key = cur.key(o), rec = Store.record(key);
      const hist = (rec.history || []).slice(0, 5);
      const hasGhost = !!Store.ghost(key);
      root.innerHTML = `<p>Timed drills for Red 1 with your usual controls. Personal bests, recent runs and a ghost of your best run are kept on this device.</p>
        <div class="tr-drills" role="radiogroup" aria-label="Drill">${DRILLS.map((d) => {
          const b = Store.record(d.key(opts[d.id])).best;
          return `<button class="tr-drill${d === cur ? ' on' : ''}" role="radio" aria-checked="${d === cur}" data-drill="${d.id}">
            <span class="tr-dn">${esc(d.name)}</span><span class="tr-db">${esc(d.blurb)}</span>
            <span class="tr-dpb">${b ? `Best ${esc(fmtValue(b.value, d.metric))}` : 'No best yet'}</span></button>`;
        }).join('')}</div>
        <div class="tr-opts">
          ${cur.options.map((op) => `<div class="tr-opt"><span>${esc(op.label)}</span>${seg(`opt-${op.key}`, op.values, o[op.key])}</div>`).join('')}
          <div class="tr-opt"><span>Ghost of best run</span>${seg('ghost', [['on', 'On'], ['off', 'Off']], ghostOn ? 'on' : 'off')}</div>
        </div>
        <div class="tr-recs">
          <div class="tr-recs-h"><h4>${esc(cur.title(o))}</h4>${rec.best || hist.length ? '<button class="lnk" data-tr-clear>Clear records</button>' : ''}</div>
          ${rec.best ? `<div class="tr-best"><span>Personal best</span><b>${esc(fmtValue(rec.best.value, cur.metric))}</b><small>${esc(fmtDate(rec.best.date))}${hasGhost ? ' · ghost saved' : ''}</small></div>` : '<p class="tr-empty">No runs yet. Your first finished run sets the best to beat.</p>'}
          ${hist.length ? `<table class="bd-table tr-hist"><tr><th>Recent runs</th><th class="r">Result</th><th class="r">vs best</th></tr>
            ${hist.map((h) => { const d = delta(h.value, rec.best.value, cur.metric); return `<tr><td>${esc(fmtDate(h.date))}</td><td class="r n">${esc(fmtValue(h.value, cur.metric))}</td><td class="r n ${d.even ? '' : d.gain ? 'tr-gain' : 'tr-loss'}">${d.even ? '—' : esc(d.text)}</td></tr>`; }).join('')}</table>` : ''}
        </div>`;
      root.querySelectorAll('[data-drill]').forEach((b) => b.addEventListener('click', () => { cur = DRILLS.find((d) => d.id === b.dataset.drill); render(); }));
      for (const op of cur.options) {
        root.querySelectorAll(`[data-opt-${op.key}]`).forEach((b) => b.addEventListener('click', () => {
          const raw = b.getAttribute(`data-opt-${op.key}`);
          o[op.key] = op.values.find(([v]) => String(v) === raw)[0];
          render();
        }));
      }
      root.querySelectorAll('[data-ghost]').forEach((b) => b.addEventListener('click', () => { ghostOn = b.dataset.ghost === 'on'; render(); }));
      const clr = root.querySelector('[data-tr-clear]');
      if (clr) clr.addEventListener('click', () => this.ui.confirmAction({
        title: 'Clear these records?', text: `The personal best, recent runs and ghost for ${cur.title(o)} are deleted from this device.`, ok: 'Clear records', danger: true,
        fn: () => { Store.clear(key); render(); },
      }));
    };
    render();
    m.el.querySelector('[data-tr-cancel]').addEventListener('click', () => m.close());
    m.el.querySelector('[data-tr-go]').addEventListener('click', () => {
      Store.setPrefs({ drill: cur.id, opts, ghost: ghostOn });
      this.start(cur, { ...opts[cur.id] }, ghostOn);
    });
    return m;
  }

  // ================================================================ session
  start(drill, opts, ghostOn = true) {
    const sim = this.sim;
    if (this.s) this.endSession();
    // borrow the local-match settings (put back by endSession, or on the next load if the tab closes)
    this.saved = { settings: Object.fromEntries(BORROWED.map((k) => [k, Settings.get(k)])), spectate: sim.ai.spectate, only: sim.ai.only };
    Store.saveRestore(this.saved.settings);
    Settings.replace({ ...drill.settings(opts), touchRobot: 0 });
    const only = drill.spectate ? drill.spectate(opts) : null;
    if (only) { sim.ai.spectate = true; sim.ai.only = only; }
    const s = this.s = {
      drill, opts, ghostOn, key: drill.key(opts), metric: drill.metric,
      sim, game: sim.game, robot: sim.robots[0],
      benched: drill.bench(opts), added: [], splits: [], phase: 'countdown', clock: 0, data: null,
    };
    s.split = (label, extra = {}) => { if (s.phase === 'running') s.splits.push({ label, t: Math.round(s.clock * 1000) / 1000, ...extra }); };
    s.finish = (value, extra = {}) => this.finish(s, value, extra);
    s.toast = (text) => this.ui.toast(text);
    s.addCore = (color, pos) => { const c = sim.game.addCore(color, 'red', pos); s.added.push(c); return c; };
    this.install();
    this.ui.closeAll();
    sim.ctx.startGame(drill.mode, { autoStart: false });
    if (sim.input.touch) sim.input.touch.slot = 0;
    this.begin();
  }

  // (re)arm the drill on a freshly reset field: first start, Retry, or Restart from the pause menu
  begin() {
    const s = this.s, sim = this.sim;
    if (s.data && s.drill.teardown) s.drill.teardown(s);
    this.removeCores(s);
    for (const r of sim.robots) bench(r, s.benched.includes(r.id));
    Object.assign(s, { roundId: sim.game.roundId, phase: 'countdown', cd: COUNTDOWN, goT: 0, clock: 0, lastSim: sim.simTime, splits: [], result: null, data: null });
    s.rec = new Recorder();
    s.best = Store.record(s.key).best;
    s.drill.setup(s);
    this.closeResults();
    this.loadGhost(s);
    this.buildOverlay(s);
  }

  loadGhost(s) {
    const rec = s.ghostOn ? Store.ghost(s.key) : null;
    if (!rec) { if (this.ghost) this.ghost.setRecording(null); return; }
    ghostModel().then((model) => {
      if (this.s !== s) return;
      if (!this.ghost) this.ghost = new Ghost(this.sim.scene, model);
      this.ghost.setRecording(rec);
    }).catch(() => {});
  }

  install() {
    if (this.hook) return;
    this.hook = (dt, inGame) => this.tick(dt, inGame);
    this.sim.frameHooks.push(this.hook);
  }
  uninstall() {
    const h = this.hook; this.hook = null;
    if (!h) return;
    // the frame loop may be iterating the hook list right now: drop ours once it has finished
    queueMicrotask(() => { const i = this.sim.frameHooks.indexOf(h); if (i >= 0) this.sim.frameHooks.splice(i, 1); });
  }

  tick(dtReal, inGame) {
    const s = this.s;
    if (!s) return;
    const sim = this.sim, g = sim.game;
    // left the field (pause menu, quit) or something else took over
    if (!inGame || g.mode !== s.drill.mode) { this.endSession(); return; }
    if (g.roundId !== s.roundId) this.begin();
    const dSim = Math.max(0, sim.simTime - s.lastSim);
    s.lastSim = sim.simTime;
    if (s.phase === 'countdown') {
      if (g.state !== 'pre') this.go(s);                                   // started early with Space / Start
      else if (!sim.isFlying() && !this.ui.modals.length) {
        s.cd -= dtReal;
        if (s.cd <= 0) { g.start(); this.go(s); }
      }
    } else if (s.goT > 0) s.goT -= dtReal;
    if (s.phase === 'running') {
      // the clock is simulated time while the game runs (pauses, menus and slow frames do not count)
      if (s.metric === 'margin') s.clock = g.time;
      else if (g.state === 'running') s.clock += dSim;
      if (g.state !== 'paused') s.drill.update(s, g.state === 'running' ? dSim : 0);
      if (s.phase === 'running' && g.state === 'running') s.rec.sample(s.clock, s.robot);
    }
    if (s.drill.frame) s.drill.frame(s);
    if (this.ghost) this.ghost.at(s.clock, s.ghostOn && s.phase !== 'done');
    this.updateOverlay(s);
  }
  go(s) {
    s.phase = 'running'; s.goT = 0.8;
    // the drill overlay replaces the Practice banner
    if (s.drill.mode === 'practice') { const b = document.getElementById('banner'); if (b) b.innerHTML = ''; }
  }

  finish(s, value, extra) {
    if (s.phase !== 'running' || this.s !== s) return;
    s.phase = 'done';
    s.rec.sample(s.clock + 1e-6, s.robot);
    const run = { value, splits: s.splits, date: Date.now(), ...extra };
    const { prev, isBest } = Store.addRun(s.key, s.metric, run);
    let ghostSaved = false;
    if (isBest) ghostSaved = Store.saveGhost(s.key, s.rec.data());
    s.result = { run, prev, isBest, ghostSaved };
    // a match: these results (with the breakdown one click away) replace the standard result dialog
    if (s.drill.mode === 'match') { clearTimeout(this.ui.resultTimer); this.ui.resultTimer = null; }
    clearTimeout(this.resultTimer);
    this.resultTimer = setTimeout(() => this.showResults(s), 700);
  }

  removeCores(s) {
    const g = this.sim.game;
    for (const c of s.added) {
      const i = g.cores.indexOf(c);
      if (i < 0) continue;
      const holder = this.sim.robots.find((r) => r.heldCore === c);
      if (holder) holder.releaseCore(false);
      this.sim.unregisterBody(c.body); c.destroy();
      g.cores.splice(i, 1);
    }
    s.added = [];
  }

  // everything a session added goes: overlay, ghost, markers, COREs, benched robots, hook, borrowed settings
  endSession() {
    const s = this.s;
    if (!s) return;
    this.s = null;
    clearTimeout(this.resultTimer);
    this.closeResults();
    if (s.data && s.drill.teardown) s.drill.teardown(s);
    this.removeCores(s);
    for (const r of this.sim.robots) bench(r, false);
    if (this.ghost) { this.ghost.dispose(); this.ghost = null; }
    if (this.overlay) { this.overlay.remove(); this.overlay = null; }
    if (this.saved) {
      Settings.replace(this.saved.settings);
      this.sim.ai.spectate = this.saved.spectate; this.sim.ai.only = this.saved.only;
      this.saved = null;
      Store.takeRestore();
    }
    this.uninstall();
  }
  leave(toPicker) {
    this.endSession();
    this.ui.closeAll();
    this.sim.ctx.toMenu();
    if (toPicker) this.open();
  }
  retry() {
    if (!this.s) return;
    clearTimeout(this.resultTimer);
    this.ui.closeAll();
    this.sim.ctx.restart();           // resets the field; the next frame re-arms the drill (roundId changes)
  }

  // ================================================================ overlay
  buildOverlay(s) {
    if (this.overlay) this.overlay.remove();
    const el = document.createElement('div');
    el.className = 'tr-ov';
    el.innerHTML = `<div class="tr-card" role="region" aria-label="Driver trainer">
        <div class="tr-top"><span>Driver trainer</span><span class="tr-pb"></span></div>
        <h3 class="tr-title">${esc(s.drill.title(s.opts))}</h3>
        <div class="tr-clock">0:00.0</div>
        <div class="tr-prog"></div>
        <div class="tr-hint"></div>
        <div class="tr-meter hidden"><i></i></div>
        <ol class="tr-splits"></ol>
        <div class="tr-acts"><button class="btn sm" data-tr="restart">${icon('refresh')}Restart</button><button class="btn sm ghost" data-tr="end">End drill</button></div>
      </div>
      <div class="tr-count" aria-live="polite"></div>`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tr]'); if (!b) return;
      b.blur();                         // Space must keep starting / pausing, not press this button again
      if (b.dataset.tr === 'restart') this.retry(); else this.leave(true);
    });
    document.body.appendChild(el);
    this.overlay = el;
    this.ov = { el, last: {} };
    for (const k of ['pb', 'clock', 'prog', 'hint', 'meter', 'splits', 'count']) this.ov[k] = el.querySelector(`.tr-${k}`);
  }
  updateOverlay(s) {
    const O = this.ov; if (!O || !this.overlay) return;
    const set = (k, html) => { if (O.last[k] !== html) { O.last[k] = html; O[k].innerHTML = html; } };
    const g = this.sim.game, best = s.best, done = s.phase === 'done';
    const shown = done && s.result.isBest ? s.result.run : best;
    set('pb', shown ? `Best ${esc(fmtValue(shown.value, s.metric))}` : 'No best yet');
    set('clock', s.metric === 'margin' ? esc(fmtTime(Math.ceil(g.remaining - 1e-6))) : esc(fmtT(done ? s.result.run.value : s.clock)));
    O.clock.classList.toggle('done', done);
    const st = s.data ? s.drill.status(s) : {};
    let prog = st.progress || '';
    if (done) {
      const r = s.result;
      prog = r.isBest ? (r.prev ? 'New personal best' : 'First run recorded') : `Finished, ${delta(r.run.value, r.prev.value, s.metric).text} on best`;
      if (s.metric === 'margin') prog = `${r.run.value > 0 ? 'Won' : r.run.value < 0 ? 'Lost' : 'Tied'} ${r.run.red}–${r.run.blue}. ${prog}`;
    }
    set('prog', esc(prog));
    set('hint', esc(done ? 'Restart to go again' : st.hint || ''));
    O.meter.classList.toggle('hidden', st.meter === undefined || done);
    if (st.meter !== undefined) O.meter.firstElementChild.style.width = `${(st.meter * 100).toFixed(1)}%`;
    const rows = s.splits.slice(-5).map((sp) => {
      const i = s.splits.indexOf(sp), b = best && best.splits ? best.splits[i] : null;
      const main = s.metric === 'margin' ? `${sp.red}–${sp.blue}` : fmtT(sp.t);
      let d = '';
      if (b && b.label === sp.label) {
        const x = s.metric === 'margin' ? delta(sp.v, b.v, 'margin') : delta(sp.t, b.t, 'time');
        d = `<em class="${x.even ? '' : x.gain ? 'tr-gain' : 'tr-loss'}">${esc(x.text)}</em>`;
      }
      return `<li><span>${esc(sp.label)}</span><b>${esc(main)}</b>${d}</li>`;
    }).join('');
    set('splits', rows);
    // countdown, then GO
    const flying = this.sim.isFlying();
    const count = s.phase === 'countdown' ? (flying ? '' : String(Math.max(1, Math.ceil(s.cd)))) : s.goT > 0 ? 'GO' : '';
    set('count', count ? `<span>${count}</span>` : '');
  }

  // ================================================================ results
  closeResults() { if (this.resultModal) { const m = this.resultModal; this.resultModal = null; m.close(); } }
  showResults(s) {
    if (this.s !== s || s.phase !== 'done' || !s.result) return;
    if (this.ui.modals.some((m) => m.kind === 'pause')) { this.resultTimer = setTimeout(() => this.showResults(s), 500); return; }
    const { run, prev, isBest } = s.result, M = s.metric;
    const prevSplits = prev && prev.splits ? prev.splits : [];
    const hist = Store.record(s.key).history.slice(0, 5);
    const bestNow = Store.record(s.key).best;
    let sub;
    if (isBest && !prev) sub = 'First run recorded. This is the best to beat.';
    else if (isBest) sub = `New personal best, ${delta(run.value, prev.value, M).text} on ${fmtValue(prev.value, M)}.`;
    else sub = `Best ${fmtValue(prev.value, M)}. This run: ${delta(run.value, prev.value, M).text}.`;
    const heroLabel = M === 'margin' ? (run.value > 0 ? 'Won by' : run.value < 0 ? 'Lost by' : 'Tied') : 'Time';
    const heroVal = M === 'margin' ? (run.value === 0 ? `${run.red}–${run.blue}` : String(Math.abs(run.value))) : fmtT(run.value);
    const splitRows = run.splits.map((sp, i) => {
      const b = prevSplits[i] && prevSplits[i].label === sp.label ? prevSplits[i] : null;
      const seg = M === 'time' ? fmtSeg(sp.t - (i ? run.splits[i - 1].t : 0)) : signed(sp.v);
      const x = b ? (M === 'margin' ? delta(sp.v, b.v, 'margin') : delta(sp.t, b.t, 'time')) : null;
      return `<tr><td>${esc(sp.label)}</td><td class="r n">${esc(M === 'margin' ? `${sp.red}–${sp.blue}` : fmtT(sp.t))}</td><td class="r n">${esc(seg)}</td>
        <td class="r n ${x && !x.even ? (x.gain ? 'tr-gain' : 'tr-loss') : ''}">${x ? (x.even ? '—' : esc(x.text)) : ''}</td></tr>`;
    }).join('');
    const m = this.resultModal = this.ui.modal({
      title: 'Drill result', width: 560, cls: 'tr-modal',
      body: `<div class="tr-res">
          <div class="tr-res-hero"><small>${esc(s.drill.title(s.opts))}</small><span class="tr-res-l">${esc(heroLabel)}</span><b class="${isBest ? 'tr-pbv' : ''}">${esc(heroVal)}</b>
            ${M === 'margin' ? `<span class="tr-res-sc"><i class="red">RED ${run.red}</i><i class="blue">BLUE ${run.blue}</i></span>` : ''}
            <p>${esc(sub)}</p></div>
          ${run.splits.length ? `<table class="bd-table"><tr><th>Split</th><th class="r">${M === 'margin' ? 'Score' : 'Time'}</th><th class="r">${M === 'margin' ? 'Margin' : 'Segment'}</th><th class="r">vs ${isBest && prev ? 'old best' : 'best'}</th></tr>${splitRows}</table>` : ''}
          ${hist.length > 1 ? `<h4>Recent runs</h4><div class="tr-spark">${hist.map((h, i) => `<span class="${i === 0 ? 'now' : ''}${bestNow && h.date === bestNow.date ? ' best' : ''}"><b>${esc(fmtValue(h.value, M))}</b><small>${i === 0 ? 'this run' : esc(fmtDate(h.date))}</small></span>`).join('')}</div>` : ''}
          ${isBest && s.ghostOn ? `<p class="tr-note">${s.result.ghostSaved ? 'This run is now the ghost on your next attempt.' : 'The ghost could not be saved: browser storage is full or blocked.'}</p>` : ''}
        </div>`,
      footer: `<button class="btn ghost" data-trr="back">Back to drills</button>${s.drill.mode === 'match' ? '<button class="btn" data-trr="breakdown">Match breakdown</button>' : ''}<button class="btn primary" data-trr="retry">${icon('refresh')}Retry</button>`,
      onClose: () => { if (this.resultModal === m) this.resultModal = null; },
    });
    m.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-trr]'); if (!b) return;
      const a = b.dataset.trr;
      if (a === 'retry') this.retry();
      else if (a === 'back') this.leave(true);
      else if (a === 'breakdown') this.ui.showResults();
    });
  }
}
