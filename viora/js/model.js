// Learned model: multinomial logistic regression on corrected strip colours, trained in the
// browser on the user's own labelled readings. Pure maths, no DOM; runs in Node for tests.
import { rgbToHsv, deltaE, hueDelta } from './color.js';

export const CLASSES = ['Hydrated', 'Mildly dehydrated', 'Dehydrated'];
export const MIN_READINGS = 12;
export const MODEL_KEY = 'hs_model';

export const FEATURE_NAMES = [
  'Test lightness (L*)', 'Test red-green (a*)', 'Test yellow-blue (b*)',
  'Test hue (sine)', 'Test hue (cosine)', 'Test saturation',
  'Control pad present', 'Colour difference test vs control (deltaE)', 'Hue shift test vs control'
];

export const TARGETS = {
  urine: {
    label: 'Urine colour',
    describe: 'Urine colour chart shade 1 to 8: 1-3 Hydrated, 4-5 Mildly dehydrated, 6-8 Dehydrated.'
  },
  hours: {
    label: 'Hours since last drink',
    describe: 'Hours since last drink: under 2 Hydrated, 2 to 6 Mildly dehydrated, over 6 Dehydrated.'
  }
};

const num = v => (v === null || v === undefined || v === '' || !isFinite(+v)) ? null : +v;

export function featuresOf(reading) {
  const t = reading.test;
  const [L, a, b] = t.lab;
  const rad = (+t.hue || 0) * Math.PI / 180;
  const sat = rgbToHsv(t.rgb)[1];
  const c = reading.control;
  let has = 0, dE = 0, shift = 0;
  if (c && c.lab) {
    has = 1;
    dE = deltaE(t.lab, c.lab);
    shift = num(reading.hueShift) ?? hueDelta(t.hue, c.hue);
  }
  return [L, a, b, Math.sin(rad), Math.cos(rad), sat, has, dE, shift];
}

export function targetOf(reading, kind) {
  const l = reading && reading.labels;
  if (!l) return null;
  if (kind === 'urine') {
    const u = num(l.urineColour);
    if (u === null || u < 1 || u > 8) return null;
    const r = Math.round(u);
    return r <= 3 ? 'Hydrated' : r <= 5 ? 'Mildly dehydrated' : 'Dehydrated';
  }
  if (kind === 'hours') {
    const h = num(l.hoursSinceDrink);
    if (h === null || h < 0) return null;
    return h < 2 ? 'Hydrated' : h <= 6 ? 'Mildly dehydrated' : 'Dehydrated';
  }
  return null;
}

// The existing colour rule, mapped onto the same three classes.
export function ruleClassOf(reading) {
  const b = reading && reading.band;
  if (b === 'Well hydrated' || b === 'Hydrated') return 'Hydrated';
  if (b === 'Mildly dehydrated') return 'Mildly dehydrated';
  if (b === 'Dehydrated') return 'Dehydrated';
  return null;
}

// 95% Wilson score interval for k successes out of n.
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 1];
  const p = k / n, z2 = z * z, den = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / den;
  const half = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / den;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export function usable(readings, kind) {
  return (readings || []).filter(r => r && r.test && r.test.lab && targetOf(r, kind) !== null);
}

// ---------- core trainer ----------
const OPTS = { lambda: 0.05, lr: 0.3, iters: 1500 };

function fit(X, y, classes, opts = OPTS) {
  const n = X.length, d = X[0].length, K = classes.length;
  const means = new Array(d).fill(0), sds = new Array(d).fill(0);
  for (const x of X) for (let j = 0; j < d; j++) means[j] += x[j] / n;
  for (const x of X) for (let j = 0; j < d; j++) sds[j] += (x[j] - means[j]) ** 2 / n;
  for (let j = 0; j < d; j++) { sds[j] = Math.sqrt(sds[j]); if (!(sds[j] > 1e-9)) sds[j] = 1; }
  const Z = X.map(x => x.map((v, j) => (v - means[j]) / sds[j]));
  const yi = y.map(c => classes.indexOf(c));
  // weights[k] = [bias, w1..wd]; deterministic zero start
  const W = Array.from({ length: K }, () => new Array(d + 1).fill(0));
  const G = Array.from({ length: K }, () => new Array(d + 1).fill(0));
  for (let it = 0; it < opts.iters; it++) {
    for (const g of G) g.fill(0);
    for (let i = 0; i < n; i++) {
      const p = softmax(W, Z[i]);
      for (let k = 0; k < K; k++) {
        const e = (p[k] - (yi[i] === k ? 1 : 0)) / n;
        G[k][0] += e;
        for (let j = 0; j < d; j++) G[k][j + 1] += e * Z[i][j];
      }
    }
    for (let k = 0; k < K; k++) {
      W[k][0] -= opts.lr * G[k][0];
      for (let j = 1; j <= d; j++) W[k][j] -= opts.lr * (G[k][j] + opts.lambda * W[k][j]);
    }
  }
  return { means, sds, weights: W, classes: classes.slice() };
}

function softmax(W, z) {
  const s = W.map(w => { let v = w[0]; for (let j = 0; j < z.length; j++) v += w[j + 1] * z[j]; return v; });
  const m = Math.max(...s);
  const e = s.map(v => Math.exp(v - m));
  const tot = e.reduce((a, c) => a + c, 0);
  return e.map(v => v / tot);
}

function predictVec(m, x) {
  const z = x.map((v, j) => (v - m.means[j]) / m.sds[j]);
  const p = softmax(m.weights, z);
  let best = 0;
  for (let k = 1; k < p.length; k++) if (p[k] > p[best]) best = k;
  const probs = {};
  m.classes.forEach((c, k) => { probs[c] = p[k]; });
  return { cls: m.classes[best], probs };
}

export function predict(model, reading) {
  return predictVec(model, featuresOf(reading));
}

// ---------- cross-validation ----------
function makeFolds(y, classes) {
  const n = y.length;
  const counts = classes.map(c => y.filter(v => v === c).length);
  const smallest = Math.min(...counts);
  // Leave-one-out for tiny sets (or when a class is too small to stratify).
  if (n < 20 || smallest < 2) {
    return { method: 'leave-one-out', k: n, fold: y.map((_, i) => i) };
  }
  const k = Math.max(2, Math.min(5, smallest));
  const fold = new Array(n);
  for (const c of classes) {
    let i = 0;
    y.forEach((v, idx) => { if (v === c) { fold[idx] = i % k; i++; } });
  }
  return { method: 'stratified ' + k + '-fold', k, fold };
}

function emptyMatrix(K) { return Array.from({ length: K }, () => new Array(K).fill(0)); }

export function train(readings, kind) {
  if (!TARGETS[kind]) throw new Error('Unknown target "' + kind + '". Use "urine" or "hours".');
  const rows = usable(readings, kind).slice().sort((a, b) => (a.t || 0) - (b.t || 0));
  const n = rows.length;
  if (n < MIN_READINGS) {
    const need = MIN_READINGS - n;
    throw new Error(`Need at least ${MIN_READINGS} readings labelled with ${TARGETS[kind].label.toLowerCase()}; you have ${n}, so ${need} more ${need === 1 ? 'is' : 'are'} needed.`);
  }
  const y = rows.map(r => targetOf(r, kind));
  const classes = CLASSES.filter(c => y.includes(c));
  if (classes.length < 2) {
    throw new Error(`All ${n} labelled readings fall in one class (${classes[0]}). Record at least one reading in another hydration state before training.`);
  }
  const X = rows.map(featuresOf);
  const K = classes.length;
  const perClass = {};
  classes.forEach(c => { perClass[c] = y.filter(v => v === c).length; });

  const { method, k, fold } = makeFolds(y, classes);
  const confusion = emptyMatrix(K);
  let correct = 0;
  for (let f = 0; f < k; f++) {
    const tr = [], te = [];
    for (let i = 0; i < n; i++) (fold[i] === f ? te : tr).push(i);
    if (!te.length) continue;
    const trClasses = classes.filter(c => tr.some(i => y[i] === c));
    let m = null;
    if (trClasses.length >= 2) m = fit(tr.map(i => X[i]), tr.map(i => y[i]), trClasses);
    for (const i of te) {
      const pred = m ? predictVec(m, X[i]).cls : trClasses[0];
      confusion[classes.indexOf(y[i])][classes.indexOf(pred)]++;
      if (pred === y[i]) correct++;
    }
  }

  // Colour rule on the same readings.
  const ruleConfusion = emptyMatrix(K);
  let ruleCorrect = 0, ruleN = 0;
  rows.forEach((r, i) => {
    const rc = ruleClassOf(r);
    if (!rc) return;
    ruleN++;
    if (rc === y[i]) ruleCorrect++;
    const col = classes.indexOf(rc);
    if (col >= 0) ruleConfusion[classes.indexOf(y[i])][col]++;
  });

  const majorityClass = classes.reduce((a, c) => perClass[c] > perClass[a] ? c : a, classes[0]);
  const cv = {
    method, k, n,
    accuracy: correct / n, correct,
    ruleAccuracy: ruleN ? ruleCorrect / ruleN : null, ruleCorrect, ruleN,
    baselineAccuracy: perClass[majorityClass] / n, majorityClass,
    perClass, classes: classes.slice(),
    confusion, ruleConfusion
  };

  const full = fit(X, y, classes);
  const model = {
    version: 1, kind, targetLabel: TARGETS[kind].label,
    features: FEATURE_NAMES.slice(),
    means: full.means, sds: full.sds, weights: full.weights, classes: full.classes,
    lambda: OPTS.lambda, trainedAt: Date.now(), n, cv
  };
  return { model, cv };
}

// ---------- persistence ----------
export function saveModel(model) {
  try { localStorage.setItem(MODEL_KEY, JSON.stringify(model)); return true; } catch (e) { return false; }
}
export function loadModel() {
  try {
    const v = localStorage.getItem(MODEL_KEY);
    if (!v) return null;
    const m = JSON.parse(v);
    return m && Array.isArray(m.weights) && Array.isArray(m.classes) ? m : null;
  } catch (e) { return null; }
}
export function deleteModel() {
  try { localStorage.removeItem(MODEL_KEY); } catch (e) {}
}
