// Alliance strategy model: team capability profiles and a Monte Carlo match simulator that scores
// exactly like Game.computeScore / Game.finalize (js/game.js) with the constants in js/config.js.
// Pure module (no DOM), so it can also be run from Node for calibration.
import { MATCH, POINTS, RP } from '../config.js';

// ---------------------------------------------------------------- random numbers
// mulberry32: small, fast and seedable, so a fixed seed reproduces every number on screen
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare = null;
  next.normal = () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0, v = 0;
    while (u === 0) u = next();
    v = next();
    const m = Math.sqrt(-2 * Math.log(u));
    spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  };
  next.poisson = (lambda) => {
    if (!(lambda > 0)) return 0;
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= next(); } while (p > L && k < 50);
    return k - 1;
  };
  return next;
}
// a count with a fractional mean: floor plus one more with the leftover probability
const fracCount = (r, x) => { const f = Math.floor(x); return f + (r() < x - f ? 1 : 0); };

// ---------------------------------------------------------------- field structure (per squad)
export const FIELD = {
  highPoles: 3, highCap: 4,          // config POLE.high.cap, RED.highPoles
  starPoles: 2, starCap: 3,          // config POLE.star.cap, RED.starPoles
  apexCap: 12,                        // 2 apex poles x 6
  golden: 6,                          // VAULT.cores
};

// ---------------------------------------------------------------- profiles
// One profile describes one robot (team). Times are in seconds, probabilities 0..1, counts per match.
export const DEFAULT_PROFILE = {
  number: '', name: '', level: 'custom',
  auto: 0, autoTime: 0,                // opening routine: COREs scored in the first autoTime seconds
  cycle: 20, cycleVar: 0.3,           // mean ring cycle (pick up to scored) and its spread (coefficient of variation)
  success: 0.9,                        // share of cycles that end with a scored CORE
  high: true, star: true, prefer: 'star',
  payload: 0, payloadTime: 18,         // chance the robot delivers its own Payload, and the time that costs
  golden: false, pattern: false, goldenCycle: 20, goldenSuccess: 0.85,
  engage: 0, dock: 0, balance: 0,      // end-game outcome probabilities when this robot climbs
  climbTime: 22, pairBalance: false,   // seconds before the buzzer it leaves to climb; can share the deck
  apex: 0,                             // APEX COREs per match while on its station (LEVEL UP)
  breakdown: 0.02,                     // chance it stops working at a random moment
  minor: 0.05, major: 0,               // fouls committed per match (points go to the opponent)
  note: '',
};

// Per-robot presets calibrated against full AI-vs-AI matches of js/ai.js (see strategy.js report numbers).
export const PRESETS = {
  rookie: {
    level: 'rookie', cycle: 24.5, cycleVar: 0.3, success: 0.88, high: true, star: true, prefer: 'star',
    payload: 0, golden: false, pattern: false, engage: 0.06, dock: 0.08, balance: 0.72, climbTime: 26,
    breakdown: 0.03, minor: 0.08, major: 0,
  },
  pro: {
    level: 'pro', cycle: 16.5, cycleVar: 0.28, success: 0.92, high: true, star: true, prefer: 'star',
    payload: 0.75, payloadTime: 20, golden: false, pattern: false, engage: 0.03, dock: 0.05, balance: 0.86, climbTime: 23,
    breakdown: 0.02, minor: 0.05, major: 0,
  },
  champion: {
    level: 'champion', cycle: 14.5, cycleVar: 0.25, success: 0.95, high: true, star: true, prefer: 'high',
    payload: 0.97, payloadTime: 16, golden: true, pattern: true, goldenCycle: 15, goldenSuccess: 0.93,
    engage: 0.02, dock: 0.03, balance: 0.92, climbTime: 21, breakdown: 0.01, minor: 0.03, major: 0,
  },
};
export const LEVEL_LABEL = { rookie: 'Rookie', pro: 'Pro', champion: 'Champion', custom: 'Custom', scouted: 'Scouted' };

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : d));
// coerce anything (stored, imported, typed) into a valid profile
export function normalize(p) {
  const d = DEFAULT_PROFILE, o = { ...d };
  o.id = String(p.id || `t${Math.random().toString(36).slice(2, 9)}`);
  o.number = String(p.number ?? '').trim().slice(0, 8);
  o.name = String(p.name ?? '').trim().slice(0, 40);
  o.level = LEVEL_LABEL[p.level] ? p.level : 'custom';
  o.auto = clamp(num(p.auto, d.auto), 0, 12); o.autoTime = clamp(num(p.autoTime, d.autoTime), 0, 60);
  o.cycle = clamp(num(p.cycle, d.cycle), 4, 150); o.cycleVar = clamp(num(p.cycleVar, d.cycleVar), 0, 1);
  o.success = clamp(num(p.success, d.success), 0, 1);
  o.high = p.high !== undefined ? !!p.high : d.high; o.star = p.star !== undefined ? !!p.star : d.star;
  o.prefer = p.prefer === 'high' ? 'high' : 'star';
  o.payload = clamp(num(p.payload, d.payload), 0, 1); o.payloadTime = clamp(num(p.payloadTime, d.payloadTime), 0, 120);
  o.golden = !!p.golden; o.pattern = !!p.pattern && o.golden;
  o.goldenCycle = clamp(num(p.goldenCycle, d.goldenCycle), 4, 150); o.goldenSuccess = clamp(num(p.goldenSuccess, d.goldenSuccess), 0, 1);
  o.engage = clamp(num(p.engage, 0), 0, 1); o.dock = clamp(num(p.dock, 0), 0, 1); o.balance = clamp(num(p.balance, 0), 0, 1);
  const s = o.engage + o.dock + o.balance;
  if (s > 1) { o.engage /= s; o.dock /= s; o.balance /= s; }
  o.climbTime = clamp(num(p.climbTime, d.climbTime), 0, 120); o.pairBalance = !!p.pairBalance;
  o.apex = clamp(num(p.apex, 0), 0, 6);
  o.breakdown = clamp(num(p.breakdown, d.breakdown), 0, 1);
  o.minor = clamp(num(p.minor, d.minor), 0, 10); o.major = clamp(num(p.major, d.major), 0, 5);
  o.note = String(p.note ?? '').slice(0, 200);
  return o;
}
export const fromPreset = (level, number, name) => normalize({ ...DEFAULT_PROFILE, ...PRESETS[level], number, name });
export const stationExpected = (p) => p.engage * POINTS.station.engage + p.dock * POINTS.station.dock + p.balance * POINTS.station.balance;

// ---------------------------------------------------------------- one squad, one match
// The two robots of a squad share the field's poles; the opponent only matters through fouls (added later).
// Event-driven: each robot works through its timeline (opening routine, Payload, ring cycles, golden cycles)
// and every completed cycle claims a slot at that moment, so the faster robot gets the better slots.
const STAR_TAGS = ['C', 'G'];
export function simSquad(profiles, r, starMap) {
  const T = MATCH.length;
  // the STAR MAP is read top -> bottom; robots build it bottom-up, so slot i (from the bottom) wants want[i]
  const want = [...starMap].reverse();
  const pattern = profiles.some((p) => p.pattern);
  const out = { high: 0, star: 0, drop: 0, apex: 0, gStar: 0, gDrop: 0, starMaps: 0, station: 0, payloads: 0,
    payloadBonus: 0, squadCores: 0, fouls: 0, starburstAt: null, cycles: 0, misses: 0 };
  const star = Array.from({ length: FIELD.starPoles }, () => []);   // tags bottom-up
  let highFree = FIELD.highPoles * FIELD.highCap, golden = FIELD.golden, starburst = false, payloadScored = false;

  // who climbs: everyone who can share the deck, otherwise the robot with the best expected station points
  const exp = profiles.map(stationExpected);
  let climbers = [];
  if (profiles.length === 2 && profiles.every((p) => p.pairBalance) && exp.every((e) => e > 0)) climbers = [0, 1];
  else {
    let best = -1;
    profiles.forEach((p, i) => { if (exp[i] > 0 && (best < 0 || exp[i] > exp[best] + 1e-9 || (Math.abs(exp[i] - exp[best]) < 1e-9 && p.cycle > profiles[best].cycle))) best = i; });
    if (best >= 0) climbers = [best];
  }

  const bots = profiles.map((p, i) => {
    const climbs = climbers.includes(i);
    const dies = r() < p.breakdown ? r() * T : Infinity;
    return { p, climbs, dies, stop: Math.min(dies, climbs ? T - p.climbTime : T), t: 0, phase: 'auto' };
  });

  const checkStarburst = (t) => {
    if (starburst) return;
    // automatic at 10 squad COREs, or the Human Player's button at 4 once a Payload is scored (3.3.6)
    if (out.squadCores >= MATCH.starburstThreshold || (payloadScored && out.squadCores >= MATCH.starburstThreshold - MATCH.payloadReduction)) {
      starburst = true; out.starburstAt = t;
    }
  };
  // a star pole slot that wants this tag next (pattern squads keep to the STAR MAP, others just fill)
  const starSlot = (tag) => {
    for (const pole of star) {
      if (pole.length >= FIELD.starCap) continue;
      if (!pattern) { if (tag === 'C' || tag === 'G') return pole; continue; }
      if (want[pole.length] === tag) return pole;
    }
    return null;
  };
  const placeCore = (b) => {
    const p = b.p;
    const toStar = p.star ? starSlot('C') : null;
    const toHigh = p.high && highFree > 0;
    // a pattern squad fills the STAR MAP's C slot first: the 10-point bonus outweighs any pole preference
    const order = pattern && toStar ? ['star', 'high'] : p.prefer === 'high' ? ['high', 'star'] : ['star', 'high'];
    for (const o of order) {
      if (o === 'star' && toStar) { toStar.push('C'); out.star++; out.squadCores++; return; }
      if (o === 'high' && toHigh) { highFree--; out.high++; out.squadCores++; return; }
    }
    out.drop++; out.squadCores++;          // poles full (or none reachable): the Drop Zone still counts 1
  };
  const wantsGolden = (b) => b.p.golden && starburst && golden > 0 && starSlot('G');

  // advance one robot by one action; returns false when it has nothing left to do
  const step = (b) => {
    const p = b.p;
    if (b.phase === 'auto') {
      b.phase = 'payload';
      if (p.auto > 0) {
        const done = Math.max(1, p.autoTime);
        if (done > b.stop) { b.t = Infinity; return false; }
        b.t = done; const n = fracCount(r, p.auto);
        for (let k = 0; k < n; k++) placeCore(b);
        checkStarburst(b.t);
      }
      return true;
    }
    if (b.phase === 'payload') {
      b.phase = 'cycle';
      if (p.payload > 0) {
        const done = b.t + p.payloadTime;
        if (done > b.stop) { b.t = Infinity; return false; }
        b.t = done;
        if (r() < p.payload) { out.payloads++; payloadScored = true; checkStarburst(b.t); }
      }
      return true;
    }
    const g = wantsGolden(b);
    const mean = g ? p.goldenCycle : p.cycle;
    const sd = p.cycleVar;
    const dur = Math.max(3, mean * Math.exp(sd * r.normal() - sd * sd / 2));
    const done = b.t + dur;
    if (done > b.stop) { b.t = Infinity; return false; }
    b.t = done; out.cycles++;
    if (g) {
      // re-check at completion: the teammate may have taken the slot meanwhile
      if (r() < p.goldenSuccess) {
        const pole = starSlot('G');
        golden--;
        if (pole) { pole.push('G'); out.gStar++; } else { out.gDrop++; }
      } else { golden--; out.misses++; }   // a dropped golden CORE is gone for this model
    } else if (r() < p.success) { placeCore(b); checkStarburst(b.t); } else out.misses++;
    return true;
  };

  // process robots in time order so slot claims and STARBURST timing interleave correctly
  for (;;) {
    let next = null;
    for (const b of bots) if (b.t !== Infinity && (!next || b.t < next.t)) next = b;
    if (!next) break;
    if (!step(next)) next.t = Infinity;
  }

  // star poles: a full pole matching the STAR MAP top -> bottom earns the bonus
  for (const pole of star) if (pole.length === FIELD.starCap && pole.every((t, i) => t === want[i])) out.starMaps++;

  // End Game: station points only count at the buzzer (robot must still be working)
  for (const i of climbers) {
    const b = bots[i];
    if (b.dies < T) continue;
    const u = r(), p = b.p;
    let pts = 0;
    if (u < p.balance) pts = POINTS.station.balance;
    else if (u < p.balance + p.dock) pts = POINTS.station.dock;
    else if (u < p.balance + p.dock + p.engage) pts = POINTS.station.engage;
    out.station += pts;
    if (pts > 0 && p.apex > 0) {
      const n = Math.min(FIELD.apexCap - out.apex, fracCount(r, p.apex));
      out.apex += n; out.squadCores += n;
    }
  }
  out.payloadBonus = out.payloads >= profiles.length ? POINTS.payloadBonus : 0;
  for (const p of profiles) {
    out.fouls += r.poisson(p.minor) * POINTS.minorFoul + r.poisson(p.major) * POINTS.majorFoul;
  }
  return out;
}

// points by category for one squad result (opponent's fouls added as foulPts), as Game.computeScore does
export function scoreOf(s, oppFouls) {
  const C = POINTS.core, G = POINTS.golden;
  const sc = {
    high: s.high * C.high, star: s.star * C.star, drop: s.drop * C.drop, apex: s.apex * C.apex,
    golden: s.gStar * G.star + s.gDrop * G.drop, starBonus: s.starMaps * POINTS.starBonus,
    payloadBonus: s.payloadBonus, station: s.station, fouls: oppFouls,
  };
  sc.total = sc.high + sc.star + sc.drop + sc.apex + sc.golden + sc.starBonus + sc.payloadBonus + sc.station + sc.fouls;
  sc.starPolePts = sc.star + s.gStar * G.star + sc.starBonus;
  sc.endgamePts = sc.station + sc.apex;
  sc.squadCores = s.squadCores;
  return sc;
}
export function rpOf(me, opp) {
  const rp = { win: 0, tie: 0, starburst: 0, pattern: 0, endgame: 0 };
  if (me.total > opp.total) rp.win = RP.win; else if (me.total === opp.total) rp.tie = RP.tie;
  if (me.squadCores >= RP.starburstCores) rp.starburst = 1;
  if (me.starPolePts >= RP.patternPoints) rp.pattern = 1;
  if (me.endgamePts >= RP.levelUpPoints) rp.endgame = 1;
  rp.total = rp.win + rp.tie + rp.starburst + rp.pattern + rp.endgame;
  return rp;
}

export const CATS = [
  ['high', 'High poles'], ['star', 'Star poles'], ['golden', 'Golden COREs'], ['starBonus', 'STAR MAP bonus'],
  ['drop', 'Drop Zone'], ['apex', 'Apex'], ['payloadBonus', 'Payload bonus'], ['station', 'Space Station'], ['fouls', 'Foul points'],
];
const RP_KEYS = ['win', 'tie', 'starburst', 'pattern', 'endgame', 'total'];

// ---------------------------------------------------------------- many matches
// red/blue: arrays of two profiles, or a function (rand) -> two profiles (an "average field" opponent)
export function simulate(red, blue, { n = 2000, seed = 1 } = {}) {
  const r = rng(seed);
  const acc = () => ({ totals: new Float64Array(n), cat: Object.fromEntries(CATS.map(([k]) => [k, 0])), rp: Object.fromEntries(RP_KEYS.map((k) => [k, 0])),
    cores: 0, starMaps: 0, starburst: 0, payloadBonus: 0 });
  const A = { red: acc(), blue: acc() };
  let redWins = 0, ties = 0;
  for (let i = 0; i < n; i++) {
    // the field draws a random STAR MAP every match (Game.reset): C in one of three positions
    const map = ['G', 'G', 'G']; map[Math.floor(r() * 3)] = 'C';
    const R = typeof red === 'function' ? red(r) : red;
    const B = typeof blue === 'function' ? blue(r) : blue;
    const sr = simSquad(R, r, map), sb = simSquad(B, r, map);
    const R1 = scoreOf(sr, sb.fouls), B1 = scoreOf(sb, sr.fouls);
    const rpR = rpOf(R1, B1), rpB = rpOf(B1, R1);
    if (R1.total > B1.total) redWins++; else if (R1.total === B1.total) ties++;
    for (const [side, sc, rp, raw] of [['red', R1, rpR, sr], ['blue', B1, rpB, sb]]) {
      const a = A[side];
      a.totals[i] = sc.total;
      for (const [k] of CATS) a.cat[k] += sc[k];
      for (const k of RP_KEYS) a.rp[k] += rp[k];
      a.cores += raw.squadCores; a.starMaps += raw.starMaps;
      if (raw.starburstAt !== null) a.starburst++;
      if (raw.payloadBonus) a.payloadBonus++;
    }
  }
  const fin = (a) => {
    const sorted = Float64Array.from(a.totals).sort();
    const mean = sorted.reduce((x, y) => x + y, 0) / n;
    const sd = Math.sqrt(sorted.reduce((x, y) => x + (y - mean) ** 2, 0) / n);
    const q = (f) => sorted[Math.min(n - 1, Math.floor(f * n))];
    for (const k in a.cat) a.cat[k] /= n;
    for (const k in a.rp) a.rp[k] /= n;
    return { totals: a.totals, mean, sd, p10: q(0.1), p50: q(0.5), p90: q(0.9), min: sorted[0], max: sorted[n - 1], cat: a.cat, rp: a.rp,
      cores: a.cores / n, starMaps: a.starMaps / n, starburst: a.starburst / n, payloadBonus: a.payloadBonus / n };
  };
  return { n, red: fin(A.red), blue: fin(A.blue), pRed: redWins / n, pTie: ties / n, pBlue: (n - redWins - ties) / n };
}

// an "average field" opponent: two different teams drawn at random from the pool each match
export function fieldDraw(pool) {
  return (r) => {
    if (pool.length < 2) return [pool[0], pool[0]];
    const i = Math.floor(r() * pool.length);
    let j = Math.floor(r() * (pool.length - 1)); if (j >= i) j++;
    return [pool[i], pool[j]];
  };
}

// rank every other team as a partner for `team` against `opp` (two profiles or a field draw function)
export function partners(team, others, opp, { n = 2000, seed = 1 } = {}) {
  return others.map((p) => {
    const s = simulate([team, p], opp, { n, seed });
    return { team: p, pWin: s.pRed, pTie: s.pTie, rp: s.red.rp.total, mean: s.red.mean, oppMean: s.blue.mean, sim: s };
  }).sort((a, b) => b.pWin - a.pWin || b.rp - a.rp);
}

// a plain-language reading of a head-to-head result
export function explain(sim, names = { red: 'Red', blue: 'Blue' }) {
  const { red: R, blue: B } = sim;
  const lead = R.mean >= B.mean ? 'red' : 'blue', trail = lead === 'red' ? 'blue' : 'red';
  const L = sim[lead], T = sim[trail], pLead = lead === 'red' ? sim.pRed : sim.pBlue;
  const diffs = CATS.map(([k, label]) => ({ k, label, d: L.cat[k] - T.cat[k] })).sort((a, b) => b.d - a.d);
  const pct = (x) => `${Math.round(x * 100)}%`;
  // lower-case the label for running text, but keep game terms in capitals (STAR MAP, COREs)
  const low = (l) => (/^[A-Z]{2,}/.test(l) ? l : l[0].toLowerCase() + l.slice(1));
  const top = diffs.filter((x) => x.d > 1.5).slice(0, 2);
  const margin = L.mean - T.mean;
  let first;
  if (Math.abs(sim.pRed - sim.pBlue) < 0.12) {
    first = `This is close to a coin flip (${names.red} ${pct(sim.pRed)}, ${names.blue} ${pct(sim.pBlue)}), with average scores ${Math.round(R.mean)} to ${Math.round(B.mean)}.`;
  } else {
    first = `${names[lead]} wins ${pct(pLead)} of simulated matches, by ${Math.round(margin)} points on average (${Math.round(L.mean)} to ${Math.round(T.mean)}).`;
  }
  let second = '';
  if (top.length) {
    const parts = top.map((x) => `${low(x.label)} (+${x.d.toFixed(0)})`);
    second = `The gap comes mostly from ${parts.join(' and ')}`;
    const counter = diffs.filter((x) => x.d < -1.5)[0];
    second += counter ? `; the only category in favour of ${names[trail]} is ${low(counter.label)} (+${(-counter.d).toFixed(0)}).` : '.';
  } else {
    // nothing structural separates them: the spread decides it
    const steadier = R.sd < B.sd ? 'red' : 'blue';
    second = `No scoring category separates them by more than a couple of points, so match-to-match spread decides it; ${names[steadier]} is the steadier squad (SD ${Math.round(sim[steadier].sd)}).`;
  }
  return `${first} ${second}`;
}

// ---------------------------------------------------------------- Overdrive Scout import
// Accepts: the Scout CSV export (Data -> Team rankings -> CSV), a JSON array of Scout report rows
// ({ robot_number, match_type, match_number, data: { m_high, ... } }), or { reports: [...], pits: [...] }
// where pits are { robot_number, data: { high, star, golden, payload, station, ... } }.
const REPORT_KEYS = ['m_high', 'm_star', 'm_drop', 'm_gstar', 'm_gdrop', 'm_miss', 'l_apex', 'l_high', 'l_star', 'l_drop', 'l_gstar', 'l_gdrop', 'l_miss', 'minor', 'major'];

export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// CSV rows -> report objects. The Scout export has two "station" columns: the driver station (1/2) and,
// later, the end-game state (none/engage/dock/balance); the state is the one whose values are words.
function csvReports(rows) {
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => head.indexOf(name);
  const robotCol = [col('robot'), col('robot_number'), col('team')].find((i) => i >= 0);
  if (robotCol === undefined) throw new Error('No "robot" column found');
  const stationCols = head.map((h, i) => (h === 'station' || h === 'end_station' ? i : -1)).filter((i) => i >= 0);
  const out = [];
  for (const r of rows.slice(1)) {
    const robot = (r[robotCol] || '').replace(/^'/, '').trim();
    if (!robot) continue;
    const d = {};
    for (const k of REPORT_KEYS) { const i = col(k); if (i >= 0 && r[i] !== '') d[k] = Math.max(0, Math.round(+r[i] || 0)); }
    const pi = col('payload'); if (pi >= 0) d.payload = (r[pi] || '').trim();
    for (const i of stationCols) { const v = (r[i] || '').trim().toLowerCase(); if (['none', 'engage', 'dock', 'balance'].includes(v)) d.station = v; }
    for (const k of ['noshow', 'died']) { const i = col(k); if (i >= 0) d[k] = /^(true|1|yes)$/i.test((r[i] || '').trim()); }
    const mt = col('match_type'), mn = [col('match'), col('match_number')].find((i) => i >= 0);
    out.push({ robot_number: robot, match_type: mt >= 0 ? r[mt] : 'qm', match_number: mn !== undefined ? +r[mn] || 0 : 0, data: d });
  }
  return out;
}

export function parseScout(text) {
  const t = text.trim();
  if (!t) throw new Error('Nothing to import');
  let reports = [], pits = [];
  if (t[0] === '[' || t[0] === '{') {
    const j = JSON.parse(t);
    const arr = Array.isArray(j) ? j : (j.reports || []);
    pits = Array.isArray(j) ? [] : (j.pits || []);
    reports = arr.map((x) => (x && x.data ? x : { robot_number: x.robot ?? x.robot_number, match_type: x.match_type, match_number: x.match ?? x.match_number, data: x }));
  } else {
    reports = csvReports(parseCsv(t));
  }
  reports = reports.filter((x) => x && x.robot_number !== undefined && x.robot_number !== null && String(x.robot_number).trim() !== '');
  if (!reports.length && !pits.length) throw new Error('No Scout match reports found');
  return { reports, pits };
}

const key = (n) => String(parseInt(n, 10) || String(n).trim());
const n0 = (d, k) => (Number.isFinite(+d?.[k]) ? +d[k] : 0);

// per-robot averages -> a profile. Cycle time is inferred from how many attempts fit the robot's free time.
export function aggregate({ reports, pits }, names = {}) {
  const by = new Map();
  for (const r of reports) {
    const k = key(r.robot_number);
    if (!by.has(k)) by.set(k, { robot: String(r.robot_number).replace(/^'/, ''), list: [], seen: new Set() });
    const e = by.get(k);
    // two scouts on the same robot in the same match: keep the first
    const mk = `${r.match_type || 'qm'}:${r.match_number}`;
    if (r.match_number && e.seen.has(mk)) continue;
    e.seen.add(mk); e.list.push(r.data || {});
  }
  const pitOf = new Map(pits.map((p) => [key(p.robot_number), p.data || {}]));
  const out = [];
  for (const [k, e] of by) {
    const all = e.list, played = all.filter((d) => !d.noshow);
    const m = Math.max(1, played.length);
    const avg = (f) => played.reduce((a, d) => a + f(d), 0) / m;
    const high = avg((d) => n0(d, 'm_high') + n0(d, 'l_high'));
    const star = avg((d) => n0(d, 'm_star') + n0(d, 'l_star'));
    const drop = avg((d) => n0(d, 'm_drop') + n0(d, 'l_drop'));
    const gstar = avg((d) => n0(d, 'm_gstar') + n0(d, 'l_gstar') + n0(d, 'm_gdrop') + n0(d, 'l_gdrop'));
    const miss = avg((d) => n0(d, 'm_miss') + n0(d, 'l_miss'));
    const apex = avg((d) => n0(d, 'l_apex'));
    const frac = (f) => (played.length ? played.filter(f).length / played.length : 0);
    const balance = frac((d) => d.station === 'balance'), dock = frac((d) => d.station === 'dock'), engage = frac((d) => d.station === 'engage');
    const payload = frac((d) => d.payload === 'scored'), tried = frac((d) => d.payload === 'scored' || d.payload === 'attempt');
    const pit = pitOf.get(k) || {};
    const climbs = balance + dock + engage > 0.2;
    const payloadTime = 18;
    const cores = high + star + drop, attempts = cores + miss;
    const free = MATCH.length - (climbs ? 22 : 0) - tried * payloadTime - (gstar > 0 ? gstar * 18 : 0);
    const cycle = attempts > 0.3 ? clamp(free / attempts, 6, 120) : 60;
    out.push(normalize({
      number: e.robot, name: names[k] || '', level: 'scouted',
      cycle: Math.round(cycle * 10) / 10, cycleVar: 0.3,
      success: attempts > 0 ? Math.round((cores / attempts) * 100) / 100 : 0.8,
      high: pit.high ?? high > 0.2, star: pit.star ?? star > 0.2, prefer: star >= high * 0.6 ? 'star' : 'high',
      payload: Math.round(payload * 100) / 100, payloadTime,
      golden: pit.golden ?? gstar > 0.3, pattern: pit.golden ?? gstar > 0.3, goldenCycle: 18,
      engage: Math.round(engage * 100) / 100, dock: Math.round(dock * 100) / 100, balance: Math.round(balance * 100) / 100,
      climbTime: 22, apex: Math.round(apex * 10) / 10,
      breakdown: all.length ? Math.round(all.filter((d) => d.died || d.noshow).length / all.length * 100) / 100 : 0.02,
      minor: Math.round(avg((d) => n0(d, 'minor')) * 100) / 100, major: Math.round(avg((d) => n0(d, 'major')) * 100) / 100,
      note: `Scouted: ${played.length} match${played.length === 1 ? '' : 'es'}, ${cores.toFixed(1)} COREs + ${gstar.toFixed(1)} golden per match`,
    }));
  }
  return out;
}
