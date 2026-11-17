import { store } from './store.js';
import { loadModel, targetOf, wilson, CLASSES } from './model.js';

const box = document.getElementById('live');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = v => v == null ? 'n/a' : Math.round(v * 100) + '%';
const tile = (k, v) => `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${v}</div></div>`;

async function render() {
  let readings = [], profiles = [];
  try {
    readings = await store.readings.list();
    profiles = await store.profiles.list();
  } catch (e) {
    box.innerHTML = '<p class="empty">Your saved readings could not be opened in this browser (storage may be disabled or this is a private window).</p>';
    return;
  }
  const model = loadModel();
  if (!readings.length && !model) {
    box.innerHTML = '<p class="empty">No readings saved in this browser yet. Take a reading on the <a href="./#check">Check</a> page and turn on study mode to start building a labelled dataset.</p>';
    return;
  }
  const card = readings.filter(r => r.mode === 'card').length;
  const urine = Object.fromEntries(CLASSES.map(c => [c, 0]));
  const hours = Object.fromEntries(CLASSES.map(c => [c, 0]));
  let nu = 0, nh = 0;
  readings.forEach(r => {
    const u = targetOf(r, 'urine'), h = targetOf(r, 'hours');
    if (u) { urine[u]++; nu++; }
    if (h) { hours[h]++; nh++; }
  });
  const used = profiles.filter(p => readings.some(r => r.profileId === p.id)).length;
  let html = `<h3>Readings</h3><div class="stats">
    ${tile('Readings', readings.length)}${tile('Profiles with readings', used)}${tile('Taken with the card', card)}
    ${tile('Urine colour labels', nu)}${tile('Hours since drink labels', nh)}</div>`;
  if (nu || nh) {
    html += `<div class="table-wrap"><table class="data"><thead><tr><th>Label</th>${CLASSES.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
      <tr><td>Urine colour</td>${CLASSES.map(c => `<td class="num">${urine[c]}</td>`).join('')}</tr>
      <tr><td>Hours since drink</td>${CLASSES.map(c => `<td class="num">${hours[c]}</td>`).join('')}</tr></tbody></table></div>`;
  } else {
    html += '<p class="empty">No readings have an independent hydration label yet. Add urine colour or hours since drinking on the <a href="./#study">Study</a> page.</p>';
  }
  if (model && model.cv) {
    const cv = model.cv;
    const [lo, hi] = cv.correct != null ? wilson(cv.correct, cv.n) : [null, null];
    html += `<h3 style="margin-top:18px">Saved learned model</h3>
      <p class="sub">Predicts ${esc((model.targetLabel || model.kind).toLowerCase())}; trained ${esc(new Date(model.trainedAt).toLocaleDateString())} on ${cv.n} readings, ${esc(cv.method || 'cross-validated')}.</p>
      <div class="stats">${tile('Model accuracy (CV)', pct(cv.accuracy))}${tile('Colour rule accuracy', pct(cv.ruleAccuracy))}${tile('Majority-class baseline', pct(cv.baselineAccuracy))}${lo != null ? tile('95% interval, model', pct(lo) + ' to ' + pct(hi)) : ''}</div>
      <p class="sub" style="margin:0">These figures come from cross-validation on readings saved in this browser. With small samples the interval is wide, so treat any difference from the colour rule with caution.</p>`;
  } else {
    html += '<p class="sub" style="margin-top:14px">No learned model saved yet. Train one on the <a href="./#model">Model</a> page once you have at least 12 labelled readings.</p>';
  }
  box.innerHTML = html;
}
render();
