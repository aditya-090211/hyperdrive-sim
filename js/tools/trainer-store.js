// Driver trainer storage: personal bests, recent runs and picker choices in one localStorage entry, and the
// ghost of each drill's best run in its own entry (a 2:30 match recording is ~150 kB). Every access is
// wrapped: private windows and blocked storage just mean nothing is remembered.
const KEY = 'hyperdrive.trainer.v1';
const GHOST = 'hyperdrive.trainer.ghost.v1.';
const RESTORE = 'hyperdrive.trainer.restore';
const HISTORY = 10;

function read(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
function drop(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } }

function load() {
  const d = read(KEY);
  return d && typeof d === 'object' ? { records: d.records || {}, prefs: d.prefs || {} } : { records: {}, prefs: {} };
}

// metric 'time': lower is better; 'margin': higher is better
export const better = (a, b, metric) => (metric === 'time' ? a < b : a > b);

export const Store = {
  prefs() { return load().prefs; },
  setPrefs(p) { const d = load(); d.prefs = { ...d.prefs, ...p }; write(KEY, d); },
  record(key) { return load().records[key] || { best: null, history: [] }; },
  // adds a finished run; returns { prev, isBest }
  addRun(key, metric, run) {
    const d = load();
    const rec = d.records[key] || { best: null, history: [] };
    const prev = rec.best;
    const isBest = !prev || better(run.value, prev.value, metric);
    if (isBest) rec.best = run;
    rec.history = [run, ...(rec.history || [])].slice(0, HISTORY);
    d.records[key] = rec;
    write(KEY, d);
    return { prev, isBest };
  },
  clear(key) { const d = load(); delete d.records[key]; write(KEY, d); drop(GHOST + key); },
  ghost(key) { return read(GHOST + key); },
  saveGhost(key, data) { return write(GHOST + key, data); },
  // the player's own settings while a drill borrows them (put back even if the tab was closed mid-drill)
  saveRestore(s) { write(RESTORE, s); },
  takeRestore() { const s = read(RESTORE); drop(RESTORE); return s; },
};
