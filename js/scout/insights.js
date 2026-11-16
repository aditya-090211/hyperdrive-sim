// Event overview for Overdrive 009: who is strongest, what each team does well and badly, and who 009 should
// pick. Pure functions over the same reports the Data tab ranks, so the numbers always agree with it.
import { summarize, robotKey } from './game.js';

const PRIOR = 2;               // a robot seen twice is pulled halfway to the event average (small samples lie)
const avgOf = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
function quantile(a, p) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y), i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
const r0 = (x) => String(Math.round(x));
const r1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const pc = (x) => `${Math.round(x * 100)}%`;
const of = (k, n) => `${k} of ${n}`;

export const ROLES = {
  levelup: 'Level Up threat', scorer: 'Cycle scorer', endgame: 'End-game specialist', defender: 'Defender', allround: 'All-rounder', unknown: 'Barely seen',
};

/**
 * @param reports the event's reports (practice matches already filtered out by the caller if wanted)
 * @param pits    the event's pit reports
 * @param own     robotKey of the team doing the picking ('9' for 009)
 */
export function analyse(reports, pits = [], { own = '9' } = {}) {
  const rows = summarize(reports);
  const field = rows.filter((r) => r.played > 0);
  const mean = avgOf(field.map((r) => r.avg));
  const col = (k, f = field) => f.map((r) => r[k] ?? 0);
  const seen3 = field.filter((r) => r.played >= 3);
  const Q = {
    avgHi: quantile(col('avg'), 0.75), avgLo: quantile(col('avg'), 0.25),
    lvlHi: quantile(col('lvl'), 0.75), lvlMid: quantile(col('lvl'), 0.5),
    coresHi: quantile(col('cores'), 0.75),
    stMid: quantile(col('station'), 0.5), stHi: quantile(col('station'), 0.75),
    sdLo: quantile(col('sd', seen3), 0.25), sdHi: quantile(col('sd', seen3), 0.75),
  };

  for (const r of rows) {
    r.key = robotKey(r.robot);
    r.pit = pits.find((p) => robotKey(p.robot_number) === r.key)?.data || null;
    r.conf = r.n >= 5 ? 'high' : r.n >= 3 ? 'ok' : 'low';
    r.adj = (r.n * r.avg + PRIOR * mean) / (r.n + PRIOR);
    // pick value: expected points a match, shrunk for small samples, less the points it hands the other alliance,
    // a little for swinging wildly, and more for stopping on the field
    r.value = r.played ? r.adj - r.fouls - 0.3 * (r.played >= 3 ? r.sd : 0) - 12 * r.died : 0;
    r.role = roleOf(r, Q);
    const { pros, cons } = traits(r, Q);
    r.strengths = pros; r.drawbacks = cons;
  }
  rows.sort((a, b) => b.value - a.value || b.avg - a.avg);
  rows.forEach((r, i) => { r.rank = i + 1; });

  const ownRow = rows.find((r) => r.key === own && r.played > 0) || null;
  const needs = needsOf(ownRow, Q);
  const recs = rows.filter((r) => r.key !== own && r.played > 0).map((r) => {
    const fit = fitOf(r, needs, Q);
    // the reasons: what it covers for us first, then its other strengths (never the same point twice)
    const covered = new Set(fit.why.map((w) => w.k));
    const why = [...fit.why.map((w) => w.text), ...r.strengths.filter((s) => !covered.has(s.k)).map((s) => s.text)].slice(0, 3);
    return { row: r, score: r.value + fit.bonus, why, risk: r.drawbacks.filter((d) => d.weight >= 2).slice(0, 2).map((d) => d.text) };
  }).sort((a, b) => b.score - a.score);
  recs.forEach((x, i) => { x.order = i + 1; });

  // risky picks: look good on the average, but break down or foul too often to trust blind in a playoff
  const avoid = rows.filter((r) => r.key !== own && r.played >= 2 && r.avg >= mean && (r.died >= 0.25 || r.fouls >= 8))
    .map((r) => ({ row: r, why: r.died >= 0.25 ? `${r.avg >= Q.avgHi ? 'Top-quarter average, but stopped' : 'Stopped'} in ${of(Math.round(r.died * r.n), r.n)} matches` : `Hands opponents ${r0(r.fouls)} pts a match in fouls` }));
  const risky = new Set(avoid.map((a) => a.row));
  recs.forEach((x) => { x.risky = risky.has(x.row); });
  // when the best pick is a gamble, name the best one that is not
  const safer = recs[0]?.risky ? recs.find((x) => !x.risky) || null : null;
  // sleepers: outside the top six, but climbing or capable of far more than their average shows
  const sleepers = recs.filter((x) => x.order > 6 && !avoid.some((a) => a.row === x.row) && (
    (x.row.n >= 4 && x.row.recent >= x.row.avg * 1.15) || (x.row.max >= Q.avgHi && x.row.conf === 'low')))
    .slice(0, 3).map((x) => ({ ...x, why: x.row.n >= 4 && x.row.recent >= x.row.avg * 1.15 ? `Last 3 matches average ${r0(x.row.recent)}, up from ${r0(x.row.avg)}` : `Best match ${r0(x.row.max)} pts from only ${x.row.n} scouted` }));

  const thin = field.filter((r) => r.n < 3).length;
  return { rows, field, mean, own: ownRow, ownKey: own, needs, recs, avoid, safer, sleepers, thin, Q };
}

function roleOf(r, Q) {
  if (!r.played || r.n < 2) return 'unknown';
  const lv = Q.lvlHi > 0 ? r.lvl / Q.lvlHi : 0, sc = Q.coresHi > 0 ? r.cores / Q.coresHi : 0, st = Q.stHi > 0 ? r.station / Q.stHi : 0;
  if (r.defense >= 1.5 && r.avg < Q.avgHi) return 'defender';
  const top = Math.max(lv, sc, st);
  if (top < 0.8) return 'allround';
  if (r.apex >= 0.3 || top === lv) return 'levelup';
  return top === sc ? 'scorer' : 'endgame';
}

// what each robot does well and badly, compared with the rest of this event. weight orders them (3 = matters most)
function traits(r, Q) {
  const pros = [], cons = [];
  const pro = (weight, text, k) => pros.push({ weight, text, k });
  const con = (weight, text, k) => cons.push({ weight, text, k });
  if (!r.played) { con(3, r.n ? `No show in all ${r.n} scouted` : 'Not scouted'); return { pros, cons }; }
  if (r.avg >= Q.avgHi && r.avg > 0) pro(3, `Top-quarter scorer: ${r0(r.avg)} pts a match`, 'avg');
  else if (r.avg <= Q.avgLo) con(2, `Bottom-quarter scoring: ${r0(r.avg)} pts a match`);
  if (r.lvl >= Q.lvlHi && r.lvl >= 3) pro(2, `Strong Level Up: ${r0(r.lvl)} pts in the last 30 s`, 'lvl');
  else if (r.played >= 2 && r.lvl < 2) con(1, 'Little in Level Up');
  if (r.apex >= 0.3) pro(2, `Scores APEX in ${pc(r.apex)} of matches`);
  if (r.balance >= 0.5) pro(2, `Balances in ${pc(r.balance)} of matches`, 'station');
  else if (r.dock >= 0.75) pro(1, `Docks reliably (${pc(r.dock)})`, 'station');
  else if (r.played >= 2 && r.dock <= 0.25) con(2, `Rarely docks (${pc(r.dock)})`);
  if (r.acc != null && r.cores >= 2) {
    if (r.acc >= 0.85) pro(1, `Accurate: ${pc(r.acc)} of cores land`);
    else if (r.acc <= 0.65) con(1, `Misses a lot: ${pc(r.acc)} accuracy`);
  }
  if (r.n >= 3 && r.died === 0) pro(2, `Never broke down in ${r.n} matches`, 'rel');
  else if (r.died >= 0.25) con(3, `Broke down or no-show in ${of(Math.round(r.died * r.n), r.n)}`);
  else if (r.died > 0) con(1, `Broke down once in ${r.n}`);
  if (r.played >= 3 && r.sd <= Q.sdLo) pro(1, `Consistent: ± ${r0(r.sd)} pts`);
  else if (r.played >= 3 && r.sd >= Q.sdHi && r.sd >= 8) con(1, `Up and down: ± ${r0(r.sd)} pts`);
  if (r.fouls >= 5) con(r.fouls >= 10 ? 3 : 2, `Gives away ${r0(r.fouls)} pts a match in fouls`);
  else if (r.played >= 3 && r.fouls === 0) pro(1, 'Clean: no fouls');
  if (r.golden >= 0.5) pro(1, `Goes for golden cores (${r1(r.golden)} a match)`);
  if (r.defense >= 1.5) pro(1, `Plays real defence (${r1(r.defense)} / 3)`);
  if (r.driver != null && r.driver >= 4) pro(1, `Skilled driver (${r1(r.driver)} / 5)`);
  else if (r.driver != null && r.driver <= 2) con(1, `Shaky driving (${r1(r.driver)} / 5)`);
  if (r.n >= 4 && r.recent >= r.avg * 1.15 && r.recent - r.avg >= 3) pro(2, `Improving: last 3 average ${r0(r.recent)}`);
  else if (r.n >= 4 && r.recent <= r.avg * 0.85 && r.avg - r.recent >= 3) con(2, `Fading: last 3 average ${r0(r.recent)}`);
  if (r.tipped) con(r.tipped >= 2 ? 2 : 1, `Tipped over ${r.tipped === 1 ? 'once' : `${r.tipped} times`}`);
  if ((r.tags.carried || 0) >= Math.max(2, r.played / 2)) con(1, 'Scouts say it was carried');
  if (r.pit?.apex && r.apex === 0 && r.played >= 3) con(1, 'Claimed APEX in the pit, not seen yet');
  if (r.pit?.station === 'balance' && r.balance === 0 && r.played >= 3) con(1, 'Claimed a balance in the pit, not seen yet');
  if (r.n <= 2) con(2, `Only ${r.n === 1 ? 'one match' : 'two matches'} scouted`);
  const by = (a, b) => b.weight - a.weight;
  return { pros: pros.sort(by).slice(0, 4), cons: cons.sort(by).slice(0, 4) };
}

// where 009 is weakest against the rest of the event: that is what a partner should cover
function needsOf(own, Q) {
  if (!own) return [];
  const needs = [];
  // only gaps big enough to matter: a point either side of the middle is noise
  if (own.station < Q.stMid - 2) needs.push({ k: 'endgame', text: `End game: we earn ${r0(own.station)} station pts, the event middle is ${r0(Q.stMid)}` });
  if (own.lvl < Q.lvlMid - 2) needs.push({ k: 'levelup', text: `Level Up: we score ${r0(own.lvl)}, the event middle is ${r0(Q.lvlMid)}` });
  if (own.died >= 0.15) needs.push({ k: 'reliability', text: `Reliability: we stopped in ${pc(own.died)} of matches, so a partner that never breaks matters` });
  if (own.avg < Q.avgHi) needs.push({ k: 'scoring', text: 'Scoring: we are not a top-quarter scorer yet' });
  return needs;
}
function fitOf(r, needs, Q) {
  let bonus = 0; const why = [];
  for (const n of needs) {
    if (n.k === 'endgame' && r.station >= Q.stMid + 3) { bonus += Math.min(6, (r.station - Q.stMid) * 0.5); why.push({ k: 'station', text: r.balance >= 0.4 ? `Covers our end game: balances ${pc(r.balance)}` : `Covers our end game: ${r0(r.station)} station pts` }); }
    if (n.k === 'levelup' && r.lvl >= Q.lvlMid + 3) { bonus += Math.min(6, (r.lvl - Q.lvlMid) * 0.5); why.push({ k: 'lvl', text: `Covers our Level Up: ${r0(r.lvl)} pts` }); }
    if (n.k === 'reliability' && r.died === 0 && r.n >= 3) { bonus += 3; why.push({ k: 'rel', text: `Covers our reliability: never broke down in ${r.n}` }); }
    if (n.k === 'scoring' && r.avg >= Q.avgHi) { bonus += 3; why.push({ k: 'avg', text: `Adds the firepower we lack: ${r0(r.avg)} pts a match` }); }
  }
  return { bonus, why: why.slice(0, 2) };
}
