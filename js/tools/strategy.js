// Alliance strategy simulator: team capability profiles, Overdrive Scout import, and a Monte Carlo
// match model (js/tools/strategy-model.js) for head-to-head odds and partner rankings.
import {
  DEFAULT_PROFILE, PRESETS, LEVEL_LABEL, CATS, normalize, fromPreset, simulate, partners, fieldDraw,
  explain, parseScout, aggregate, stationExpected,
} from './strategy-model.js';
import { RP } from '../config.js';

const STORE_KEY = 'hyperdrive.strategy.v1';
const SAMPLE = [
  ['009', 'Overdrive', 'champion'], ['1002', 'Sample Pro A', 'pro'], ['2001', 'Sample Pro B', 'pro'], ['2002', 'Sample Rookie A', 'rookie'],
  ['317', 'Sample Rookie B', 'rookie'], ['4242', 'Sample Pro C', 'pro'], ['88', 'Sample Rookie C', 'rookie'], ['1530', 'Sample Champion', 'champion'],
];

// ---------------------------------------------------------------- tiny DOM helpers
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => `${Math.round(x * 100)}%`;
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const label = (t) => (t ? `${t.number}${t.name ? ` ${t.name}` : ''}` : 'None');
const sel = (opts, value, onchange, cls = 'field-sel') => {
  const s = h('select', { class: cls, onchange: (e) => onchange(e.target.value) }, opts.map(([v, l]) => h('option', { value: v, text: l })));
  s.value = value; return s;
};
const seg = (opts, value, onpick) => h('div', { class: 'seg', role: 'group' },
  opts.map(([v, l]) => h('button', { type: 'button', class: v === value ? 'on' : '', 'aria-pressed': String(v === value), onclick: () => onpick(v), text: l })));

// ---------------------------------------------------------------- charts (inline SVG)
// overlaid score histograms with the mean marked
function histogram(sim) {
  const W = 640, H = 210, L = 34, R = 10, T = 12, B = 30;
  const all = [...sim.red.totals, ...sim.blue.totals];
  let lo = Math.min(...all), hi = Math.max(...all);
  const bw = Math.max(2, Math.ceil((hi - lo + 1) / 36));
  lo = Math.floor(lo / bw) * bw; hi = Math.ceil((hi + 1) / bw) * bw;
  const nb = Math.max(1, (hi - lo) / bw);
  const count = (arr) => { const c = new Array(nb).fill(0); for (const v of arr) c[Math.min(nb - 1, Math.floor((v - lo) / bw))]++; return c.map((x) => x / arr.length); };
  const cr = count(sim.red.totals), cb = count(sim.blue.totals);
  const ymax = Math.max(...cr, ...cb) * 1.08 || 1;
  const x = (v) => L + ((v - lo) / (hi - lo)) * (W - L - R);
  const y = (f) => T + (1 - f / ymax) * (H - T - B);
  const path = (c) => {
    let d = `M${x(lo)},${y(0)}`;
    c.forEach((f, i) => { d += `L${x(lo + i * bw)},${y(f)}L${x(lo + (i + 1) * bw)},${y(f)}`; });
    return `${d}L${x(hi)},${y(0)}Z`;
  };
  const step = [5, 10, 20, 25, 50, 100].find((s) => (hi - lo) / s <= 8) || 100;
  let ticks = '';
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks += `<line x1="${x(v)}" x2="${x(v)}" y1="${H - B}" y2="${H - B + 4}" class="st-axis"/><text x="${x(v)}" y="${H - B + 16}" text-anchor="middle" class="st-tick">${v}</text>`;
  const yt = [0, 0.5, 1].map((k) => k * ymax / 1.08).map((f) => `<line x1="${L}" x2="${W - R}" y1="${y(f)}" y2="${y(f)}" class="st-grid"/><text x="${L - 6}" y="${y(f) + 4}" text-anchor="end" class="st-tick">${Math.round(f * 100)}%</text>`).join('');
  const mean = (m, cls) => `<line x1="${x(m)}" x2="${x(m)}" y1="${T}" y2="${H - B}" class="st-mean ${cls}"/>`;
  return `<svg class="st-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Score distributions: Red mean ${Math.round(sim.red.mean)}, Blue mean ${Math.round(sim.blue.mean)}">
    ${yt}<path d="${path(cr)}" class="st-hr"/><path d="${path(cb)}" class="st-hb"/>${mean(sim.red.mean, 'st-sr')}${mean(sim.blue.mean, 'st-sb')}
    <line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="st-axis"/>${ticks}
    <text x="${W - R}" y="${H - 2}" text-anchor="end" class="st-tick">squad score (points), bin ${bw}</text></svg>`;
}
// grouped horizontal bars of expected points per category
function categoryBars(sim) {
  const rows = CATS.filter(([k]) => sim.red.cat[k] > 0.05 || sim.blue.cat[k] > 0.05);
  const W = 640, L = 132, R = 44, rowH = 30, T = 4;
  const H = T + rows.length * rowH + 4;
  const max = Math.max(1, ...rows.map(([k]) => Math.max(sim.red.cat[k], sim.blue.cat[k])));
  const x = (v) => (v / max) * (W - L - R);
  const body = rows.map(([k, lab], i) => {
    const y0 = T + i * rowH, r = sim.red.cat[k], b = sim.blue.cat[k];
    return `<text x="${L - 10}" y="${y0 + 17}" text-anchor="end" class="st-lab">${esc(lab)}</text>
      <rect x="${L}" y="${y0 + 3}" width="${Math.max(1, x(r))}" height="11" rx="2" class="st-fr"/><text x="${L + x(r) + 6}" y="${y0 + 12.5}" class="st-val">${f1(r)}</text>
      <rect x="${L}" y="${y0 + 15}" width="${Math.max(1, x(b))}" height="11" rx="2" class="st-fb"/><text x="${L + x(b) + 6}" y="${y0 + 24.5}" class="st-val">${f1(b)}</text>`;
  }).join('');
  return `<svg class="st-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Expected points by category">${body}</svg>`;
}

// ---------------------------------------------------------------- profile editor fields
// [key, label, kind, extra]: kind num (raw), pct (stored 0..1, shown 0..100), bool, choice
const FIELDS = [
  ['Ring scoring', [
    ['cycle', 'Cycle time (s)', 'num', { step: 0.5, min: 4, max: 150 }], ['success', 'Cycle success', 'pct'],
    ['cycleVar', 'Cycle spread (CV)', 'num', { step: 0.05, min: 0, max: 1 }], ['prefer', 'First choice', 'choice', [['star', 'Star poles'], ['high', 'High poles']]],
    ['star', 'Scores star poles', 'bool'], ['high', 'Scores high poles', 'bool'],
    ['auto', 'Opening routine COREs', 'num', { step: 0.5, min: 0, max: 12 }], ['autoTime', 'Opening routine (s)', 'num', { step: 1, min: 0, max: 60 }],
  ]],
  ['Payload and golden COREs', [
    ['payload', 'Payload delivered', 'pct'], ['payloadTime', 'Payload time (s)', 'num', { step: 1, min: 0, max: 120 }],
    ['golden', 'Scores golden COREs', 'bool'], ['pattern', 'Builds the STAR MAP', 'bool'],
    ['goldenCycle', 'Golden cycle (s)', 'num', { step: 0.5, min: 4, max: 150 }], ['goldenSuccess', 'Golden success', 'pct'],
  ]],
  ['End game', [
    ['balance', 'Balance', 'pct'], ['dock', 'Dock (not level)', 'pct'], ['engage', 'Engage only', 'pct'],
    ['climbTime', 'Leaves to climb at (s left)', 'num', { step: 1, min: 0, max: 120 }],
    ['apex', 'Apex COREs when on station', 'num', { step: 0.5, min: 0, max: 6 }], ['pairBalance', 'Can share the deck', 'bool'],
  ]],
  ['Reliability and fouls', [
    ['breakdown', 'Breaks down', 'pct'], ['minor', 'Minor fouls / match', 'num', { step: 0.05, min: 0, max: 10 }],
    ['major', 'Major fouls / match', 'num', { step: 0.05, min: 0, max: 5 }],
  ]],
];

export class Strategy {
  constructor(sim, ui) {
    this.sim = sim; this.ui = ui;
    this.state = this.load();
    this.lastSim = null; this.lastPartners = null;
  }

  // ------------------------------------------------------------ persistence
  load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { /* storage blocked */ }
    const teams = Array.isArray(s?.teams) && s.teams.length ? s.teams.map(normalize) : SAMPLE.map(([n, name, l]) => fromPreset(l, n, name));
    const st = { teams, n: [1000, 2000, 5000, 10000].includes(s?.n) ? s.n : 2000, fixed: s?.fixed !== false, seed: Number.isInteger(s?.seed) ? s.seed : 9, h2h: s?.h2h || null, pf: s?.pf || null, sel: s?.sel || null };
    const ids = teams.map((t) => t.id);
    if (!st.h2h || !st.h2h.every((id) => ids.includes(id))) st.h2h = [0, 1, 2, 3].map((i) => ids[i % ids.length]);
    if (!st.pf || !ids.includes(st.pf.team)) st.pf = { team: ids[0], mode: 'field', opp: [ids[2 % ids.length], ids[3 % ids.length]] };
    if (!st.pf.opp.every((id) => ids.includes(id))) st.pf.opp = [ids[0], ids[0]];
    if (!ids.includes(st.sel)) st.sel = ids[0];
    return st;
  }
  save() {
    const { teams, n, fixed, seed, h2h, pf, sel } = this.state;
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ teams, n, fixed, seed, h2h, pf, sel })); } catch { /* storage full or blocked */ }
  }
  team(id) { return this.state.teams.find((t) => t.id === id) || this.state.teams[0]; }
  runSeed() { return this.state.fixed ? this.state.seed : (Math.random() * 2 ** 31) | 0; }
  teamOpts() { return this.state.teams.map((t) => [t.id, label(t)]); }

  // ------------------------------------------------------------ entry point
  open() {
    if (this.m && this.m.el.isConnected) return;
    this.m = this.ui.modal({
      title: 'Alliance strategy', width: 940, cls: 'st-modal',
      tabs: [
        { label: 'Head to head', body: () => this.h2hTab() },
        { label: 'Partner finder', body: () => this.partnerTab() },
        { label: 'Teams', body: () => this.teamsTab() },
        { label: 'Import', body: () => this.importTab() },
      ],
    });
  }

  // shared run settings: number of matches and the seed
  settingsRow(rerun) {
    const S = this.state;
    const seedIn = h('input', { class: 'field-in st-seed', type: 'number', value: S.seed, min: 0, step: 1, 'aria-label': 'Seed', disabled: !S.fixed,
      onchange: (e) => { S.seed = Math.max(0, parseInt(e.target.value, 10) || 0); this.save(); rerun(); } });
    return h('div', { class: 'st-settings' },
      h('label', { class: 'st-inline' }, h('span', { text: 'Matches' }), sel([[1000, '1,000'], [2000, '2,000'], [5000, '5,000'], [10000, '10,000']].map(([v, l]) => [String(v), l]), String(S.n), (v) => { S.n = +v; this.save(); rerun(); })),
      h('label', { class: 'st-inline st-check' }, h('input', { type: 'checkbox', checked: S.fixed, onchange: (e) => { S.fixed = e.target.checked; seedIn.disabled = !S.fixed; this.save(); rerun(); } }), h('span', { text: 'Fixed seed' })),
      seedIn);
  }

  // ------------------------------------------------------------ head to head
  h2hTab() {
    const S = this.state;
    const out = h('div', { class: 'st-out' });
    const run = () => {
      const [r1, r2, b1, b2] = S.h2h.map((id) => this.team(id));
      const seed = this.runSeed();
      const t0 = performance.now();
      const sim = simulate([r1, r2], [b1, b2], { n: S.n, seed });
      this.lastSim = { sim, ms: performance.now() - t0, seed };
      out.replaceChildren(this.h2hResult(sim, [r1, r2], [b1, b2], seed, performance.now() - t0));
    };
    const pick = (i) => sel(this.teamOpts(), S.h2h[i], (v) => { S.h2h[i] = v; this.save(); run(); });
    const swap = h('button', { class: 'btn sm ghost', type: 'button', text: 'Swap sides', onclick: () => { S.h2h = [S.h2h[2], S.h2h[3], S.h2h[0], S.h2h[1]]; this.save(); this.m.showTab(0); } });
    const wrap = h('div', { class: 'st-wrap' },
      h('div', { class: 'st-pick' },
        h('div', { class: 'st-side st-red' }, h('h4', { text: 'Red squad' }), pick(0), pick(1)),
        h('div', { class: 'st-vs', text: 'vs' }),
        h('div', { class: 'st-side st-blue' }, h('h4', { text: 'Blue squad' }), pick(2), pick(3))),
      h('div', { class: 'st-bar-row' }, this.settingsRow(run), h('span', { class: 'st-grow' }), swap, h('button', { class: 'btn sm primary', type: 'button', text: 'Run again', onclick: run })),
      out);
    run();
    return wrap;
  }
  h2hResult(sim, red, blue, seed, ms) {
    const R = sim.red, B = sim.blue;
    const dup = new Set([...red, ...blue].map((t) => t.id)).size < 4;
    const names = { red: 'Red', blue: 'Blue' };
    const rpRow = (lab, k, thr) => h('tr', {}, h('th', { text: lab }), h('td', { class: 'st-num', text: thr ? pct(R.rp[k]) : f1(R.rp[k]) }), h('td', { class: 'st-num', text: thr ? pct(B.rp[k]) : f1(B.rp[k]) }));
    return h('div', {},
      h('div', { class: 'st-odds', role: 'img', 'aria-label': `Red wins ${pct(sim.pRed)}, tie ${pct(sim.pTie)}, Blue wins ${pct(sim.pBlue)}` },
        h('div', { class: 'st-odds-r', style: `flex-basis:${sim.pRed * 100}%` }), h('div', { class: 'st-odds-t', style: `flex-basis:${sim.pTie * 100}%` }), h('div', { class: 'st-odds-b', style: `flex-basis:${sim.pBlue * 100}%` })),
      h('div', { class: 'st-odds-lab' },
        h('span', { class: 'st-tr' }, h('b', { text: pct(sim.pRed) }), ' Red win'),
        h('span', { class: 'st-muted', text: `Tie ${pct(sim.pTie)}` }),
        h('span', { class: 'st-tb' }, 'Blue win ', h('b', { text: pct(sim.pBlue) }))),
      h('p', { class: 'st-explain', text: explain(sim, names) }),
      dup ? h('p', { class: 'note', text: 'The same team appears more than once, which cannot happen in a real match.' }) : null,
      h('div', { class: 'st-cards' },
        this.card('Red expected score', Math.round(R.mean), `10th-90th percentile ${R.p10}-${R.p90}, SD ${f1(R.sd)}`, 'st-red'),
        this.card('Blue expected score', Math.round(B.mean), `10th-90th percentile ${B.p10}-${B.p90}, SD ${f1(B.sd)}`, 'st-blue'),
        this.card('Expected RP', `${f1(R.rp.total)} / ${f1(B.rp.total)}`, 'Red / Blue, per match', '')),
      h('div', { class: 'st-grid2' },
        h('section', {}, h('h4', { text: 'Score distribution' }), h('div', { html: histogram(sim) }),
          h('div', { class: 'st-legend' }, h('span', { class: 'st-key st-kr' }), 'Red', h('span', { class: 'st-key st-kb' }), 'Blue', h('span', { class: 'st-muted', text: 'dashed lines: means' }))),
        h('section', {}, h('h4', { text: 'Expected points by category' }), h('div', { html: categoryBars(sim) }))),
      h('div', { class: 'st-grid2' },
        h('section', {}, h('h4', { text: 'Ranking Points' }),
          h('table', { class: 'st-table' },
            h('thead', {}, h('tr', {}, h('th', { text: '' }), h('th', { class: 'st-num st-tr', text: 'Red' }), h('th', { class: 'st-num st-tb', text: 'Blue' }))),
            h('tbody', {},
              rpRow(`Win RP (${RP.win}), expected`, 'win', false),
              rpRow(`Tie RP (${RP.tie}), expected`, 'tie', false),
              rpRow(`Supercharge: ${RP.starburstCores}+ squad COREs`, 'starburst', true),
              rpRow(`Star map: ${RP.patternPoints}+ star pole points`, 'pattern', true),
              rpRow(`Level up: ${RP.levelUpPoints}+ end game points`, 'endgame', true),
              h('tr', { class: 'st-total' }, h('th', { text: 'Total RP, expected' }), h('td', { class: 'st-num', text: f1(R.rp.total) }), h('td', { class: 'st-num', text: f1(B.rp.total) }))))),
        h('section', {}, h('h4', { text: 'Match facts' }),
          h('table', { class: 'st-table' },
            h('thead', {}, h('tr', {}, h('th', { text: '' }), h('th', { class: 'st-num st-tr', text: 'Red' }), h('th', { class: 'st-num st-tb', text: 'Blue' }))),
            h('tbody', {},
              ...[['Squad COREs', f1(R.cores), f1(B.cores)], ['STARBURST reached', pct(R.starburst), pct(B.starburst)],
                ['STAR MAPs completed', f1(R.starMaps), f1(B.starMaps)], ['Payload bonus earned', pct(R.payloadBonus), pct(B.payloadBonus)],
                ['Lowest / highest score', `${R.min} / ${R.max}`, `${B.min} / ${B.max}`]]
                .map(([a, b, c]) => h('tr', {}, h('th', { text: a }), h('td', { class: 'st-num', text: b }), h('td', { class: 'st-num', text: c }))))))),
      h('p', { class: 'note', text: `${sim.n.toLocaleString()} simulated matches in ${Math.round(ms)} ms, seed ${seed}. Each squad's robots share the poles; the opponent only affects the result through foul points (no defence is modelled).` }));
  }
  card(title, big, sub, cls) {
    return h('div', { class: `st-card ${cls}` }, h('span', { class: 'st-card-h', text: title }), h('b', { class: 'st-big', text: String(big) }), h('span', { class: 'st-card-s', text: sub }));
  }

  // ------------------------------------------------------------ partner finder
  partnerTab() {
    const S = this.state, P = S.pf;
    const out = h('div', { class: 'st-out' });
    const run = () => {
      const me = this.team(P.team);
      const others = S.teams.filter((t) => t.id !== me.id);
      if (!others.length) { out.replaceChildren(h('p', { class: 'note', text: 'Add at least one more team.' })); return; }
      out.replaceChildren(h('p', { class: 'note', text: 'Running...' }));
      // let the "Running" line paint before the work starts
      setTimeout(() => {
        const seed = this.runSeed(), t0 = performance.now();
        let ranked;
        if (P.mode === 'pair') {
          const opp = P.opp.map((id) => this.team(id));
          ranked = partners(me, others.filter((t) => !P.opp.includes(t.id)), opp, { n: S.n, seed });
        } else {
          // average field: the opponents are two random teams other than us and the partner under test
          ranked = others.map((p) => {
            const pool = S.teams.filter((t) => t.id !== me.id && t.id !== p.id);
            const opp = pool.length ? fieldDraw(pool) : [p, me];
            const s = simulate([me, p], opp, { n: S.n, seed });
            return { team: p, pWin: s.pRed, pTie: s.pTie, rp: s.red.rp.total, mean: s.red.mean, oppMean: s.blue.mean, sim: s };
          }).sort((a, b) => b.pWin - a.pWin || b.rp - a.rp);
        }
        this.lastPartners = ranked;
        out.replaceChildren(this.partnerResult(me, ranked, seed, performance.now() - t0));
      }, 20);
    };
    const oppRow = h('div', { class: 'st-opp' });
    const drawOpp = () => {
      oppRow.replaceChildren(...(P.mode === 'pair' ? [
        h('span', { class: 'st-muted', text: 'Opponents' }),
        sel(this.teamOpts(), P.opp[0], (v) => { P.opp[0] = v; this.save(); run(); }),
        sel(this.teamOpts(), P.opp[1], (v) => { P.opp[1] = v; this.save(); run(); }),
      ] : [h('span', { class: 'st-muted', text: 'Each match draws two random opponents from the other teams in the list.' })]));
    };
    const modeSeg = h('div', {});
    const drawSeg = () => modeSeg.replaceChildren(seg([['field', 'Average field'], ['pair', 'Specific pair']], P.mode, (v) => { P.mode = v; this.save(); drawSeg(); drawOpp(); run(); }));
    drawSeg(); drawOpp();
    const wrap = h('div', { class: 'st-wrap' },
      h('div', { class: 'st-pf-head' },
        h('label', { class: 'st-inline' }, h('span', { text: 'Our team' }), sel(this.teamOpts(), P.team, (v) => { P.team = v; this.save(); run(); })),
        modeSeg),
      oppRow,
      h('div', { class: 'st-bar-row' }, this.settingsRow(run), h('span', { class: 'st-grow' }), h('button', { class: 'btn sm primary', type: 'button', text: 'Run again', onclick: run })),
      out);
    run();
    return wrap;
  }
  partnerResult(me, ranked, seed, ms) {
    if (!ranked.length) return h('p', { class: 'note', text: 'No partners left once the opponents are excluded.' });
    const best = ranked[0];
    const why = explain(best.sim, { red: `${me.number} with ${best.team.number}`, blue: 'the opponents' });
    const rows = ranked.map((r, i) => h('tr', {},
      h('td', { class: 'st-num st-muted', text: String(i + 1) }),
      h('td', {}, h('b', { text: r.team.number }), ' ', h('span', { class: 'st-muted', text: `${r.team.name || ''}${r.team.level ? ` (${LEVEL_LABEL[r.team.level]})` : ''}` })),
      h('td', { class: 'st-wp' }, h('div', { class: 'st-meter' }, h('i', { style: `width:${r.pWin * 100}%` })), h('span', { class: 'st-num', text: pct(r.pWin) })),
      h('td', { class: 'st-num', text: f1(r.rp) }),
      h('td', { class: 'st-num st-hide-n', text: `${Math.round(r.mean)} - ${Math.round(r.oppMean)}` })));
    return h('div', {},
      h('p', { class: 'st-explain', text: `Best partner for ${me.number}: ${best.team.number}${best.team.name ? ` ${best.team.name}` : ''}. ${why}` }),
      h('div', { class: 'st-scroll' }, h('table', { class: 'st-table st-rank' },
        h('thead', {}, h('tr', {}, h('th', { class: 'st-num', text: '#' }), h('th', { text: 'Partner' }), h('th', { text: 'Win probability' }), h('th', { class: 'st-num', text: 'Exp. RP' }), h('th', { class: 'st-num st-hide-n', text: 'Score' }))),
        h('tbody', {}, rows))),
      h('p', { class: 'note', text: `${ranked.length} pairings x ${this.state.n.toLocaleString()} matches in ${Math.round(ms)} ms, seed ${seed}. Every pairing uses the same random stream, so the ranking compares like with like.` }));
  }

  // ------------------------------------------------------------ teams
  teamsTab() {
    const S = this.state;
    const list = h('div', { class: 'st-list', role: 'listbox', 'aria-label': 'Teams' });
    const editor = h('div', { class: 'st-editor' });
    const drawList = () => {
      list.replaceChildren(...S.teams.map((t) => h('button', {
        type: 'button', role: 'option', 'aria-selected': String(t.id === S.sel), class: `st-item${t.id === S.sel ? ' on' : ''}`,
        onclick: () => { S.sel = t.id; this.save(); drawList(); drawEditor(); },
      }, h('b', { text: t.number || '(no number)' }), h('span', { class: 'st-item-n', text: t.name }), h('span', { class: 'st-tag', text: LEVEL_LABEL[t.level] }))));
    };
    const drawEditor = () => editor.replaceChildren(this.editor(this.team(S.sel), () => { drawList(); }, () => { drawList(); drawEditor(); }));
    const addLevel = sel([['rookie', 'Rookie preset'], ['pro', 'Pro preset'], ['champion', 'Champion preset'], ['blank', 'Blank profile']], 'pro', () => {}, 'field-sel st-addsel');
    const add = () => {
      const lvl = addLevel.value;
      const used = new Set(S.teams.map((t) => t.number));
      let num = 100; while (used.has(String(num))) num++;
      const t = lvl === 'blank' ? normalize({ ...DEFAULT_PROFILE, number: String(num), name: 'New team' }) : fromPreset(lvl, String(num), 'New team');
      S.teams.push(t); S.sel = t.id; this.save(); drawList(); drawEditor();
    };
    drawList(); drawEditor();
    return h('div', { class: 'st-wrap' },
      h('div', { class: 'st-bar-row' }, addLevel, h('button', { class: 'btn sm', type: 'button', text: 'Add team', onclick: add }), h('span', { class: 'st-grow' }),
        h('button', { class: 'btn sm ghost', type: 'button', text: 'Reset to sample teams', onclick: () => this.resetTeams(drawList, drawEditor) })),
      h('div', { class: 'st-teams' }, list, editor),
      h('p', { class: 'note', text: `Presets are per robot and were calibrated so a pair reproduces the simulator's own AI levels in full AI-vs-AI matches. Saved on this device.` }));
  }
  resetTeams(drawList, drawEditor) {
    const reset = () => {
      try { localStorage.removeItem(STORE_KEY); } catch { /* storage blocked */ }
      this.state = this.load(); this.save();
      this.m.showTab(2); this.ui.toast('Sample teams restored');
    };
    if (this.ui.confirmAction) this.ui.confirmAction({ title: 'Reset teams', text: 'Replace every team with the sample list? Imported and edited profiles are removed.', ok: 'Reset', danger: true, fn: reset });
    else reset();
  }
  editor(t, onRename, onStructure) {
    const S = this.state;
    const est = h('div', { class: 'st-est' });
    const estimate = () => {
      // a quick read on the profile: two copies of this robot, as the presets were calibrated
      const s = simulate([t, t], [t, t], { n: 600, seed: 3 });
      est.replaceChildren(h('span', { class: 'st-muted', text: 'A pair of this robot scores about ' }), h('b', { text: `${Math.round(s.red.mean)}` }),
        h('span', { class: 'st-muted', text: ` (10th-90th ${s.red.p10}-${s.red.p90}); end game alone ${f1(stationExpected(t))} expected.` }));
    };
    const commit = () => { const n = normalize(t); Object.assign(t, n); t.level = t.level === 'scouted' ? 'scouted' : 'custom'; this.save(); estimate(); onRename(); };
    const input = (k, kind, extra) => {
      if (kind === 'bool') return h('input', { type: 'checkbox', checked: !!t[k], onchange: (e) => { t[k] = e.target.checked; commit(); } });
      if (kind === 'choice') return sel(extra, t[k], (v) => { t[k] = v; commit(); });
      const scale = kind === 'pct' ? 100 : 1;
      return h('input', { class: 'field-in', type: 'number', inputmode: 'decimal', value: Math.round(t[k] * scale * 100) / 100,
        step: kind === 'pct' ? 1 : extra.step, min: kind === 'pct' ? 0 : extra.min, max: kind === 'pct' ? 100 : extra.max,
        onchange: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { t[k] = v / scale; commit(); e.target.value = Math.round(t[k] * scale * 100) / 100; } } });
    };
    const groups = FIELDS.map(([title, fields]) => h('fieldset', { class: 'st-fs' }, h('legend', { text: title }),
      h('div', { class: 'st-fields' }, fields.map(([k, lab, kind, extra]) => h('label', { class: `st-f${kind === 'bool' ? ' st-fb-row' : ''}` },
        h('span', { text: kind === 'pct' ? `${lab} (%)` : lab }), input(k, kind, extra))))));
    const preset = sel([['', 'Apply preset...'], ['rookie', 'Rookie'], ['pro', 'Pro'], ['champion', 'Champion']], '', (v) => {
      if (!v) return;
      Object.assign(t, normalize({ ...DEFAULT_PROFILE, ...PRESETS[v], id: t.id, number: t.number, name: t.name, note: t.note }));
      this.save(); onStructure();
    });
    const del = h('button', { class: 'btn sm danger', type: 'button', text: 'Delete', disabled: S.teams.length <= 1, onclick: () => {
      S.teams = S.teams.filter((x) => x.id !== t.id);
      S.sel = S.teams[0].id;
      const ids = S.teams.map((x) => x.id);
      S.h2h = S.h2h.map((id) => (ids.includes(id) ? id : ids[0]));
      if (!ids.includes(S.pf.team)) S.pf.team = ids[0];
      S.pf.opp = S.pf.opp.map((id) => (ids.includes(id) ? id : ids[0]));
      this.save(); onStructure(); this.ui.toast(`Deleted ${t.number}`);
    } });
    const dupe = h('button', { class: 'btn sm', type: 'button', text: 'Duplicate', onclick: () => {
      const c = normalize({ ...t, id: undefined, name: `${t.name} copy` }); c.level = t.level;
      S.teams.splice(S.teams.indexOf(t) + 1, 0, c); S.sel = c.id; this.save(); onStructure();
    } });
    estimate();
    return h('div', {},
      h('div', { class: 'st-id' },
        h('label', { class: 'st-f' }, h('span', { text: 'Number' }), h('input', { class: 'field-in', value: t.number, maxlength: 8, onchange: (e) => { t.number = e.target.value; commit(); } })),
        h('label', { class: 'st-f st-grow' }, h('span', { text: 'Name' }), h('input', { class: 'field-in', value: t.name, maxlength: 40, onchange: (e) => { t.name = e.target.value; commit(); } }))),
      h('div', { class: 'st-bar-row' }, preset, h('span', { class: 'st-grow' }), dupe, del),
      est,
      t.note ? h('p', { class: 'note', text: t.note }) : null,
      groups);
  }

  // ------------------------------------------------------------ import
  importTab() {
    const area = h('textarea', { class: 'st-paste', rows: 6, spellcheck: 'false', placeholder: 'Paste an Overdrive Scout CSV export or JSON here' });
    const preview = h('div', {});
    let parsed = null;
    const show = (text, source) => {
      try {
        parsed = aggregate(parseScout(text), Object.fromEntries(this.state.teams.map((t) => [String(parseInt(t.number, 10) || t.number), t.name])));
        this.drawPreview(preview, parsed, source);
      } catch (e) { parsed = null; preview.replaceChildren(h('p', { class: 'st-err', text: `Could not read that: ${e.message}` })); }
    };
    const file = h('input', { type: 'file', accept: '.csv,.json,text/csv,application/json', class: 'st-file', onchange: async (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 5e6) { this.ui.toast('That file is over 5 MB'); return; }
      const text = await f.text(); area.value = text.slice(0, 20000); show(text, f.name);
    } });
    const fromCache = () => {
      // Overdrive Scout keeps the last loaded event of each team in this browser (same site, no network needed)
      const reports = [], pits = [];
      try {
        for (const k of Object.keys(localStorage)) {
          if (!k.startsWith('od.scout.cache.ev.')) continue;
          const v = JSON.parse(localStorage.getItem(k) || 'null');
          if (v?.reports) reports.push(...v.reports);
          if (v?.pits) pits.push(...v.pits);
        }
      } catch { /* storage blocked */ }
      if (!reports.length) { preview.replaceChildren(h('p', { class: 'st-err', text: 'No Overdrive Scout event data is saved in this browser. Open an event in Scout first, or import its CSV export.' })); return; }
      show(JSON.stringify({ reports, pits }), 'Scout data in this browser');
    };
    return h('div', { class: 'st-wrap' },
      h('p', { text: 'Build team profiles from Overdrive Scout match reports. Each robot\'s reports are averaged into a profile: COREs and misses give the cycle time and success rate, and the station, Payload, golden and foul columns give the rest.' }),
      h('div', { class: 'st-bar-row' },
        h('label', { class: 'btn sm st-filebtn' }, 'Choose file', file),
        h('button', { class: 'btn sm', type: 'button', text: 'Read pasted text', onclick: () => show(area.value, 'Pasted text') }),
        h('button', { class: 'btn sm', type: 'button', text: 'Use Scout data in this browser', onclick: fromCache })),
      area,
      preview,
      h('details', { class: 'st-doc' }, h('summary', { text: 'Accepted formats' }),
        h('p', { html: '<b>CSV:</b> the Scout export (Data, Team rankings, CSV). Needed: a <code>robot</code> column; read when present: <code>match_type, match, m_high, m_star, m_drop, m_gstar, m_gdrop, m_miss, l_apex, l_high, l_star, l_drop, l_gstar, l_gdrop, l_miss, payload</code> (scored / attempt), <code>station</code> (none / engage / dock / balance), <code>minor, major, noshow, died</code>.' }),
        h('p', { html: '<b>JSON:</b> an array of Scout report rows <code>[{ "robot_number": "009", "match_type": "qm", "match_number": 3, "data": { "m_star": 4, "station": "balance", "payload": "scored" } }]</code>, or <code>{ "reports": [...], "pits": [...] }</code> where a pit row is <code>{ "robot_number": "009", "data": { "high": true, "star": true, "golden": false } }</code>. Flat rows with the CSV column names also work.' }),
        h('p', { class: 'note', text: 'Two scouts on the same robot in the same match count once. Cycle time assumes 22 s for climbing when the robot usually climbs and 18 s per Payload attempt; adjust the profile afterwards if you know better.' })));
  }
  drawPreview(box, profiles, source) {
    const S = this.state;
    const byNum = new Map(S.teams.map((t) => [String(parseInt(t.number, 10) || t.number), t]));
    const checks = profiles.map(() => true);
    const rows = profiles.map((p, i) => {
      const ex = byNum.get(String(parseInt(p.number, 10) || p.number));
      return h('tr', {},
        h('td', {}, h('input', { type: 'checkbox', checked: true, 'aria-label': `Import ${p.number}`, onchange: (e) => { checks[i] = e.target.checked; } })),
        h('td', {}, h('b', { text: p.number })),
        h('td', { class: 'st-num', text: `${f1(p.cycle)} s` }), h('td', { class: 'st-num', text: pct(p.success) }),
        h('td', { class: 'st-num st-hide-n', text: pct(p.payload) }), h('td', { class: 'st-num st-hide-n', text: pct(p.balance) }),
        h('td', { class: 'st-muted', text: ex ? 'updates existing' : 'new' }));
    });
    box.replaceChildren(
      h('h4', { text: `${profiles.length} team${profiles.length === 1 ? '' : 's'} from ${source}` }),
      h('div', { class: 'st-scroll' }, h('table', { class: 'st-table' },
        h('thead', {}, h('tr', {}, h('th', {}), h('th', { text: 'Team' }), h('th', { class: 'st-num', text: 'Cycle' }), h('th', { class: 'st-num', text: 'Success' }), h('th', { class: 'st-num st-hide-n', text: 'Payload' }), h('th', { class: 'st-num st-hide-n', text: 'Balance' }), h('th', { text: '' }))),
        h('tbody', {}, rows))),
      h('div', { class: 'st-bar-row' }, h('span', { class: 'st-grow' }), h('button', { class: 'btn sm primary', type: 'button', text: 'Import selected', onclick: () => {
        let added = 0, updated = 0;
        profiles.forEach((p, i) => {
          if (!checks[i]) return;
          const ex = byNum.get(String(parseInt(p.number, 10) || p.number));
          if (ex) { Object.assign(ex, { ...p, id: ex.id, name: ex.name || p.name }); updated++; } else { S.teams.push(p); added++; }
        });
        this.save();
        this.ui.toast(`Imported: ${added} new, ${updated} updated`);
        box.replaceChildren(h('p', { class: 'note', text: `Done: ${added} new and ${updated} updated. They are in the Teams tab.` }));
      } })));
  }
}
