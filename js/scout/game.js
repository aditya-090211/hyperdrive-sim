// HYPERDRIVE (NRL 2026) as Overdrive Scout records it. Keys and ranges match supabase/scouting.sql
// (scout_valid_report / scout_report_points); points follow the game manual's Table 4.5.1.
export const TERMS_VERSION = '2026-11-01';
export const MAX_COUNT = 60;

export const PHASES = [
  { id: 'm', label: 'Match', hint: '2:30 to 0:30' },
  { id: 'l', label: 'Level Up', hint: 'Final 30 s' },
];
// scoring actions per phase: key suffix, label, points, style
export const ACTIONS = {
  m: [
    { k: 'high', label: 'HIGH pole', pts: 3, sub: 'CORE on a high pole' },
    { k: 'star', label: 'STAR pole', pts: 5, sub: 'CORE on a star pole', tone: 'od' },
    { k: 'drop', label: 'DROP zone', pts: 1, sub: 'CORE in the drop zone' },
    { k: 'gstar', label: 'Golden on STAR', pts: 7, sub: 'GOLDEN CORE, star pole', tone: 'gold' },
    { k: 'gdrop', label: 'Golden in DROP', pts: 3, sub: 'GOLDEN CORE, drop zone', tone: 'gold' },
    { k: 'miss', label: 'Missed', pts: 0, sub: 'Dropped or fell off', tone: 'bad' },
  ],
  l: [
    { k: 'apex', label: 'APEX pole', pts: 9, sub: 'From its own station', tone: 'od' },
    { k: 'high', label: 'HIGH pole', pts: 3, sub: 'CORE on a high pole' },
    { k: 'star', label: 'STAR pole', pts: 5, sub: 'CORE on a star pole', tone: 'od' },
    { k: 'drop', label: 'DROP zone', pts: 1, sub: 'CORE in the drop zone' },
    { k: 'gstar', label: 'Golden on STAR', pts: 7, sub: 'GOLDEN CORE, star pole', tone: 'gold' },
    { k: 'gdrop', label: 'Golden in DROP', pts: 3, sub: 'GOLDEN CORE, drop zone', tone: 'gold' },
    { k: 'miss', label: 'Missed', pts: 0, sub: 'Dropped or fell off', tone: 'bad' },
  ],
};
export const STATION = [
  { v: 'none', label: 'None', pts: 0 }, { v: 'engage', label: 'Engaged', pts: 3 },
  { v: 'dock', label: 'Docked', pts: 8 }, { v: 'balance', label: 'Balanced', pts: 15 },
];
export const PAYLOAD = [{ v: 'none', label: 'No' }, { v: 'attempt', label: 'Tried' }, { v: 'scored', label: 'Scored' }];
export const START = [{ v: 'l', label: 'Left' }, { v: 'c', label: 'Centre' }, { v: 'r', label: 'Right' }];
export const MATCH_TYPES = [{ v: 'pr', label: 'Practice' }, { v: 'qm', label: 'Qual' }, { v: 'sf', label: 'Semi' }, { v: 'f', label: 'Final' }];
export const DEFENSE = [{ v: 0, label: 'None' }, { v: 1, label: 'Light' }, { v: 2, label: 'Solid' }, { v: 3, label: 'Lockdown' }];
export const TAGS = [
  { v: 'fast', label: 'Fast cycles' }, { v: 'accurate', label: 'Accurate' }, { v: 'consistent', label: 'Consistent' },
  { v: 'defender', label: 'Good defender' }, { v: 'pusher', label: 'Pushes hard' }, { v: 'golden', label: 'Goes for golden' },
  { v: 'apex', label: 'Apex threat' }, { v: 'carried', label: 'Was carried' }, { v: 'clumsy', label: 'Clumsy' }, { v: 'quiet-hp', label: 'Quiet human player' },
];
export const DRIVE = [{ v: 'tank', label: 'Tank' }, { v: 'mecanum', label: 'Mecanum' }, { v: 'swerve', label: 'Swerve' }, { v: 'omni', label: 'Omni' }, { v: 'other', label: 'Other' }];

const n = (d, k) => (Number.isInteger(d?.[k]) ? d[k] : 0);
export function pointsOf(d) {
  if (!d) return 0;
  const st = STATION.find((s) => s.v === d.station)?.pts || 0;
  return 3 * (n(d, 'm_high') + n(d, 'l_high')) + 5 * (n(d, 'm_star') + n(d, 'l_star')) + (n(d, 'm_drop') + n(d, 'l_drop'))
    + 7 * (n(d, 'm_gstar') + n(d, 'l_gstar')) + 3 * (n(d, 'm_gdrop') + n(d, 'l_gdrop')) + 9 * n(d, 'l_apex') + st;
}
export function coresOf(d) {
  let c = 0;
  for (const p of ['m', 'l']) for (const a of ['high', 'star', 'drop', 'gstar', 'gdrop', 'apex']) c += n(d, `${p}_${a}`);
  return c;
}
export const missesOf = (d) => n(d, 'm_miss') + n(d, 'l_miss');
export const levelUpPts = (d) => 3 * n(d, 'l_high') + 5 * n(d, 'l_star') + n(d, 'l_drop') + 7 * n(d, 'l_gstar') + 3 * n(d, 'l_gdrop') + 9 * n(d, 'l_apex');

// free text: no control characters (Postgres refuses NUL) and no bidi overrides that could disguise a note
const cleanText = (t) => (typeof t === 'string' ? [...t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim()].slice(0, 500).join('') : '');
// keep only what the database accepts (it rejects unknown keys and out-of-range values)
export function cleanReport(d) {
  const out = { v: 1 };
  if (d.noshow === true) {                 // a robot that never took the field scored nothing
    out.noshow = true;
    const note = cleanText(d.note);
    if (note) out.note = note;
    return out;
  }
  for (const p of ['m', 'l']) for (const a of ACTIONS[p]) { const k = `${p}_${a.k}`; const v = n(d, k); if (v) out[k] = Math.min(MAX_COUNT, Math.max(0, v)); }
  for (const k of ['minor', 'major']) { const v = n(d, k); if (v) out[k] = Math.min(MAX_COUNT, Math.max(0, v)); }
  for (const k of ['defense', 'driver', 'speed']) { const v = n(d, k); if (v) out[k] = Math.min(k === 'defense' ? 3 : 5, Math.max(0, v)); }
  for (const k of ['noshow', 'died', 'tipped', 'starburst']) if (d[k] === true) out[k] = true;
  if (START.some((s) => s.v === d.start)) out.start = d.start;
  if (PAYLOAD.some((s) => s.v === d.payload) && d.payload !== 'none') out.payload = d.payload;
  if (STATION.some((s) => s.v === d.station) && d.station !== 'none') out.station = d.station;
  const tags = Array.isArray(d.tags) ? [...new Set(d.tags.filter((t) => TAGS.some((x) => x.v === t)))].slice(0, 8) : [];
  if (tags.length) out.tags = tags;
  const note = cleanText(d.note);
  if (note) out.note = note;
  return out;
}
export function cleanPit(d) {
  const out = { v: 1 };
  if (DRIVE.some((x) => x.v === d.drive)) out.drive = d.drive;
  if (Number.isInteger(d.motors) && d.motors >= 0 && d.motors <= 16) out.motors = d.motors;
  if (typeof d.weight === 'number' && Number.isFinite(d.weight) && d.weight >= 0 && d.weight <= 20) out.weight = Math.round(d.weight * 100) / 100;
  for (const k of ['high', 'star', 'apex', 'golden', 'payload', 'auto']) if (typeof d[k] === 'boolean') out[k] = d[k];
  if (STATION.some((s) => s.v === d.station)) out.station = d.station;
  for (const k of ['strategy', 'note']) { const t = cleanText(d[k]); if (t) out[k] = t; }
  return out;
}

const TYPE_ORDER = { pr: 0, qm: 1, sf: 2, f: 3 };
export const matchOrder = (a, b) => (TYPE_ORDER[a.match_type] ?? 1) - (TYPE_ORDER[b.match_type] ?? 1) || a.match_number - b.match_number;
// per-robot summary over an event's reports. Two scouts filing the same robot in the same match count as one match
// (their numbers averaged); a no-show is a match that scored 0, so it pulls the average down.
export function summarize(reports) {
  const by = new Map();
  for (const r of reports) {
    const key = robotKey(r.robot_number);
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(r);
  }
  const rows = [];
  for (const all of by.values()) {
    const robot = all.map((r) => String(r.robot_number)).sort((a, b) => b.length - a.length)[0];   // show "009" rather than "9"
    // one entry per match: the first report stands for it, its points are the mean of every report of that match
    const perMatch = new Map();
    for (const r of [...all].sort(matchOrder)) { const k = `${r.match_type}:${r.match_number}`; if (!perMatch.has(k)) perMatch.set(k, []); perMatch.get(k).push(r); }
    const list = [...perMatch.values()].map((g) => ({ ...g[0], mpts: g.reduce((a, r) => a + (r.data?.noshow ? 0 : pointsOf(r.data)), 0) / g.length, noshow: g.every((r) => r.data?.noshow) }));
    const played = list.filter((r) => !r.noshow);
    const pts = list.map((r) => r.mpts);
    const cores = played.reduce((a, r) => a + coresOf(r.data), 0), miss = played.reduce((a, r) => a + missesOf(r.data), 0);
    const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const sd = (arr) => { if (arr.length < 2) return 0; const m = avg(arr); return Math.sqrt(avg(arr.map((x) => (x - m) ** 2))); };
    const rated = played.filter((r) => r.data?.driver);
    rows.push({
      robot, n: list.length, played: played.length, noshows: list.length - played.length,
      avg: avg(pts), max: pts.length ? Math.max(...pts) : 0, sd: sd(pts),
      cores: played.length ? cores / played.length : 0,
      acc: cores + miss ? cores / (cores + miss) : null,
      lvl: avg(played.map((r) => levelUpPts(r.data))),
      balance: played.length ? played.filter((r) => r.data?.station === 'balance').length / played.length : 0,
      dock: played.length ? played.filter((r) => ['dock', 'balance'].includes(r.data?.station)).length / played.length : 0,
      died: list.length ? list.filter((r) => r.data?.died || r.data?.noshow).length / list.length : 0,
      driver: rated.length ? avg(rated.map((r) => r.data.driver)) : null,
      speed: played.some((r) => r.data?.speed) ? avg(played.filter((r) => r.data?.speed).map((r) => r.data.speed)) : null,
      station: avg(played.map((r) => STATION.find((s) => s.v === r.data?.station)?.pts || 0)),
      defense: avg(played.map((r) => r.data?.defense || 0)),
      fouls: avg(played.map((r) => (r.data?.minor || 0) * 3 + (r.data?.major || 0) * 15)),
      series: list.map((r) => ({ m: r.match_number, p: r.mpts })),
    });
  }
  return rows;
}

export const robotKey = (n) => String(parseInt(n, 10) || 0);
export const matchLabel = (type, num) => `${(MATCH_TYPES.find((t) => t.v === type)?.label || 'Qual')} ${num}`;
