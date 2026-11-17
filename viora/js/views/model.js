// Model page: train the learned model on real labelled readings, compare it with the colour rule
// and a majority-class baseline using cross-validation, and save it for the Check page.
import { train, usable, targetOf, saveModel, loadModel, deleteModel, wilson, TARGETS, CLASSES, MIN_READINGS } from '../model.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = v => v == null ? 'n/a' : Math.round(v * 100) + '%';
const fmtDate = t => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function accuracyChart(cv) {
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim() || '#5b3d82';
  const muted = css.getPropertyValue('--muted').trim() || '#6b6573';
  const line = css.getPropertyValue('--line').trim() || '#e4dfe8';
  const ink = css.getPropertyValue('--ink').trim() || '#1d1a22';
  const bars = [
    { name: 'Learned model', v: cv.accuracy, ci: wilson(cv.correct, cv.n), main: true },
    { name: 'Colour rule', v: cv.ruleAccuracy, ci: cv.ruleN ? wilson(cv.ruleCorrect, cv.ruleN) : null },
    { name: 'Majority class', v: cv.baselineAccuracy, ci: null }
  ];
  const W = 400, rowH = 44, left = 104, right = 46, top = 8, H = top + bars.length * rowH + 26;
  const x = v => left + v * (W - left - right);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Accuracy comparison" style="max-width:${W}px;display:block;font:12px var(--sans)">`;
  for (const g of [0, 0.25, 0.5, 0.75, 1]) {
    s += `<line x1="${x(g)}" x2="${x(g)}" y1="${top}" y2="${H - 20}" stroke="${line}"/>`;
    s += `<text x="${x(g)}" y="${H - 6}" text-anchor="middle" fill="${muted}">${g * 100}%</text>`;
  }
  bars.forEach((b, i) => {
    const y = top + i * rowH + 8, h = 22;
    s += `<text x="${left - 8}" y="${y + h / 2 + 4}" text-anchor="end" fill="${ink}">${b.name}</text>`;
    if (b.v == null) { s += `<text x="${left + 4}" y="${y + h / 2 + 4}" fill="${muted}">not available</text>`; return; }
    s += `<rect x="${left}" y="${y}" width="${Math.max(1, x(b.v) - left)}" height="${h}" rx="4" fill="${b.main ? accent : muted}" opacity="${b.main ? 1 : 0.55}"/>`;
    if (b.ci) {
      const cy = y + h / 2;
      s += `<line x1="${x(b.ci[0])}" x2="${x(b.ci[1])}" y1="${cy}" y2="${cy}" stroke="${ink}" stroke-width="1.5"/>`;
      s += `<line x1="${x(b.ci[0])}" x2="${x(b.ci[0])}" y1="${cy - 6}" y2="${cy + 6}" stroke="${ink}" stroke-width="1.5"/>`;
      s += `<line x1="${x(b.ci[1])}" x2="${x(b.ci[1])}" y1="${cy - 6}" y2="${cy + 6}" stroke="${ink}" stroke-width="1.5"/>`;
    }
    s += `<text x="${W - right + 8}" y="${y + h / 2 + 4}" fill="${ink}" font-weight="600">${pct(b.v)}</text>`;
  });
  return s + '</svg>';
}

function confusionTable(classes, m, title) {
  const rowTot = m.map(r => r.reduce((a, c) => a + c, 0));
  return `<div class="table-wrap"><table class="data" style="max-width:560px"><caption style="text-align:left;font-size:13px;color:var(--muted);padding-bottom:6px">${esc(title)}</caption>
    <thead><tr><th>Actual \\ Predicted</th>${classes.map(c => `<th>${esc(c)}</th>`).join('')}<th>Total</th></tr></thead>
    <tbody>${classes.map((c, i) => `<tr><th scope="row" style="color:var(--ink)">${esc(c)}</th>${m[i].map((v, j) =>
      `<td class="num" style="${i === j ? 'background:var(--accent-soft);font-weight:600' : ''}">${v}</td>`).join('')}<td class="num">${rowTot[i]}</td></tr>`).join('')}</tbody></table></div>`;
}

function verdict(cv) {
  const [lo, hi] = wilson(cv.correct, cv.n);
  const out = [];
  const diff = cv.ruleAccuracy == null ? null : cv.accuracy - cv.ruleAccuracy;
  if (diff == null) out.push('The colour rule could not be scored on these readings because they have no band.');
  else if (Math.abs(diff) < 0.05) out.push(`The learned model and the colour rule perform about the same on your data (${pct(cv.accuracy)} vs ${pct(cv.ruleAccuracy)}).`);
  else if (diff > 0) out.push(`The learned model beats the colour rule on your data: ${pct(cv.accuracy)} vs ${pct(cv.ruleAccuracy)} of readings classified correctly.`);
  else out.push(`The colour rule does better than the learned model on your data: ${pct(cv.ruleAccuracy)} vs ${pct(cv.accuracy)}. Keep using the rule and collect more readings.`);
  if (cv.accuracy <= cv.baselineAccuracy + 0.02) out.push(`The model is not clearly better than always guessing "${cv.majorityClass}" (${pct(cv.baselineAccuracy)}), so it has not yet learned anything useful from the colour.`);
  else out.push(`It does better than always guessing the most common class, "${cv.majorityClass}" (${pct(cv.baselineAccuracy)}).`);
  out.push(`With ${cv.n} readings, the 95% interval for the model's accuracy runs from ${pct(lo)} to ${pct(hi)}. ${cv.n < 40 ? 'That is wide: small samples give uncertain estimates, and differences of a few readings can swing the result.' : 'More readings will narrow it further.'}`);
  if (cv.classes.length < 3) out.push(`Only ${cv.classes.length} of the 3 classes appear in your labels, so the model can only predict ${cv.classes.join(' or ')}.`);
  return out;
}

export async function mount(el, ctx) {
  const { store, toast } = ctx;
  let kind = 'urine', scope = 'all', last = null, destroyed = false;

  el.innerHTML = `
    <div class="page-head">
      <h1>Learned model</h1>
      <p>Train a small classifier on your own labelled readings and test, honestly, whether strip colour predicts hydration better than the built-in colour rule.</p>
    </div>
    <div class="grid2">
      <div class="card">
        <h2>Training data</h2>
        <p class="sub">Choose which independent measure the model should predict.</p>
        <div class="chips" data-kind style="margin-bottom:10px">
          <button type="button" class="chip on" data-k="urine">Urine colour</button>
          <button type="button" class="chip" data-k="hours">Hours since drink</button>
        </div>
        <div class="chips" data-scope style="margin-bottom:12px">
          <button type="button" class="chip on" data-s="all">All profiles</button>
          <button type="button" class="chip" data-s="me">Active profile only</button>
        </div>
        <p class="sub" data-kind-note style="margin-bottom:8px"></p>
        <div data-progress></div>
        <div class="row" style="margin-top:14px"><button type="button" class="primary" data-train>Train and cross-validate</button></div>
        <p class="sub" data-err style="margin:10px 0 0"></p>
      </div>
      <div class="card">
        <h2>Saved model</h2>
        <p class="sub">When a model is saved, the Check page shows its prediction next to the colour rule.</p>
        <div data-saved></div>
      </div>
    </div>
    <div data-results></div>
    <div class="card" style="margin:20px 0">
      <h2>What the model looks at</h2>
      <p class="sub">Only the colour-corrected pad colours are used, never the photo itself or your labels.</p>
      <ul style="margin:0;padding-left:18px">
        <li><strong>Test pad colour</strong> in the Lab colour space: lightness, red to green, and yellow to blue.</li>
        <li><strong>Test pad hue</strong>, entered as its sine and cosine so that hues either side of red count as close together.</li>
        <li><strong>Saturation</strong>: how strong the colour is compared with grey.</li>
        <li><strong>Control pad comparison</strong> when the reference card was used: the colour difference (deltaE) and the hue shift between the wet test pad and the dry control pad. Without the card these are set to zero and a separate yes/no feature records that the control was missing.</li>
      </ul>
      <p style="margin:12px 0 0">The model is multinomial logistic regression: each feature is standardised, then one weighted sum per class is turned into probabilities. A small penalty on large weights (L2 regularisation) reduces overfitting. Training is deterministic, so the same data always gives the same model.</p>
      <p style="margin:10px 0 0">Accuracy is measured by cross-validation: the model is trained without some readings and tested on those held-out readings, so it is never graded on data it has seen. Fewer than 20 readings use leave-one-out; larger sets use stratified k-fold (up to 5 folds). The colour rule is scored on the same readings by mapping its band to the same three classes (Well hydrated counts as Hydrated). The majority-class baseline is the accuracy of always guessing the most common label.</p>
    </div>`;

  const kindNote = el.querySelector('[data-kind-note]');
  const errEl = el.querySelector('[data-err]');

  async function getReadings() {
    if (scope === 'all') return store.readings.list();
    const p = await store.activeProfile();
    return store.readings.list({ profileId: p.id });
  }

  async function renderProgress() {
    const rs = await getReadings();
    if (destroyed) return;
    const u = usable(rs, kind);
    const counts = Object.fromEntries(CLASSES.map(c => [c, 0]));
    u.forEach(r => counts[targetOf(r, kind)]++);
    const frac = Math.min(1, u.length / MIN_READINGS);
    kindNote.textContent = TARGETS[kind].describe;
    el.querySelector('[data-progress]').innerHTML = `
      <div style="display:flex;justify-content:space-between;font-size:13.5px;margin-bottom:6px"><span>${u.length} usable labelled reading${u.length === 1 ? '' : 's'}</span><span style="color:var(--muted)">minimum ${MIN_READINGS}</span></div>
      <div role="progressbar" aria-valuemin="0" aria-valuemax="${MIN_READINGS}" aria-valuenow="${Math.min(u.length, MIN_READINGS)}" style="height:10px;border-radius:99px;background:var(--accent-soft);overflow:hidden">
        <div style="height:100%;width:${(frac * 100).toFixed(1)}%;background:var(--accent)"></div></div>
      <div class="stats" style="margin-bottom:0">${CLASSES.map(c => `<div class="stat"><div class="k">${esc(c)}</div><div class="v">${counts[c]}</div></div>`).join('')}</div>
      ${rs.length > u.length ? `<p class="sub" style="margin:8px 0 0">${rs.length - u.length} other reading${rs.length - u.length === 1 ? ' has' : 's have'} no ${esc(TARGETS[kind].label.toLowerCase())} label. Add labels on the <a href="#study">Study</a> page.</p>` : ''}`;
    el.querySelector('[data-train]').disabled = u.length < MIN_READINGS;
  }

  function renderSaved() {
    const m = loadModel();
    const box = el.querySelector('[data-saved]');
    if (!m) { box.innerHTML = `<p class="empty">No model saved. The Check page uses the colour rule only.</p>`; return; }
    const cv = m.cv || {};
    box.innerHTML = `
      <div class="stats">
        <div class="stat"><div class="k">Predicts</div><div class="v" style="font-size:16px">${esc(m.targetLabel || (TARGETS[m.kind] || {}).label || m.kind)}</div></div>
        <div class="stat"><div class="k">Trained on</div><div class="v">${m.n}</div></div>
        <div class="stat"><div class="k">CV accuracy</div><div class="v">${pct(cv.accuracy)}</div></div>
        <div class="stat"><div class="k">Colour rule</div><div class="v">${pct(cv.ruleAccuracy)}</div></div>
      </div>
      <p class="sub">Trained ${esc(fmtDate(m.trainedAt))}. Classes: ${esc(m.classes.join(', '))}.</p>
      <button type="button" class="small danger" data-del>Delete saved model</button>`;
    box.querySelector('[data-del]').onclick = () => {
      if (!confirm('Delete the saved model? The Check page will go back to the colour rule only.')) return;
      deleteModel(); renderSaved(); renderResults(); toast('Saved model deleted');
    };
  }

  function renderResults() {
    const box = el.querySelector('[data-results]');
    if (!last) { box.innerHTML = ''; return; }
    const { model, cv } = last;
    const [lo, hi] = wilson(cv.correct, cv.n);
    const rci = cv.ruleN ? wilson(cv.ruleCorrect, cv.ruleN) : null;
    const saved = loadModel();
    const isSaved = saved && saved.trainedAt === model.trainedAt;
    box.innerHTML = `
      <div class="card">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div class="section-title"><h2>Cross-validation results</h2>
            <p class="sub" style="margin:0">Predicting ${esc(TARGETS[model.kind].label.toLowerCase())} from ${cv.n} readings, ${esc(cv.method)}.</p></div>
          <button type="button" class="${isSaved ? '' : 'primary'}" data-save ${isSaved ? 'disabled' : ''}>${isSaved ? 'Saved' : 'Save this model'}</button>
        </div>
        <div class="stats">
          <div class="stat"><div class="k">Learned model</div><div class="v">${pct(cv.accuracy)}</div><div class="k">95% CI ${pct(lo)} to ${pct(hi)}</div></div>
          <div class="stat"><div class="k">Colour rule</div><div class="v">${pct(cv.ruleAccuracy)}</div><div class="k">${rci ? `95% CI ${pct(rci[0])} to ${pct(rci[1])}` : 'no bands'}</div></div>
          <div class="stat"><div class="k">Majority class</div><div class="v">${pct(cv.baselineAccuracy)}</div><div class="k">always "${esc(cv.majorityClass)}"</div></div>
          <div class="stat"><div class="k">Readings</div><div class="v">${cv.n}</div><div class="k">${cv.classes.map(c => `${esc(c)} ${cv.perClass[c]}`).join(', ')}</div></div>
        </div>
        ${accuracyChart(cv)}
        <p class="sub" style="margin:6px 0 14px">Bars show the share of readings classified correctly. Whiskers show 95% Wilson intervals.</p>
        <h3>Verdict</h3>
        ${verdict(cv).map(t => `<p style="margin:6px 0">${esc(t)}</p>`).join('')}
        <div class="grid2" style="margin-bottom:0">
          <div>${confusionTable(cv.classes, cv.confusion, 'Learned model (held-out predictions)')}</div>
          <div>${confusionTable(cv.classes, cv.ruleConfusion, 'Colour rule')}</div>
        </div>
        <p class="sub" style="margin:10px 0 0">Rows are the label you recorded; columns are what was predicted. The shaded diagonal counts correct predictions.</p>
      </div>`;
    const sb = box.querySelector('[data-save]');
    if (sb && !isSaved) sb.onclick = () => {
      if (!saveModel(model)) { toast('Could not save the model (storage unavailable)'); return; }
      renderSaved(); renderResults(); toast('Model saved. The Check page will use it.');
    };
  }

  el.querySelector('[data-kind]').addEventListener('click', e => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    kind = b.dataset.k;
    el.querySelectorAll('[data-kind] .chip').forEach(c => c.classList.toggle('on', c === b));
    errEl.textContent = ''; renderProgress();
  });
  el.querySelector('[data-scope]').addEventListener('click', e => {
    const b = e.target.closest('[data-s]'); if (!b) return;
    scope = b.dataset.s;
    el.querySelectorAll('[data-scope] .chip').forEach(c => c.classList.toggle('on', c === b));
    errEl.textContent = ''; renderProgress();
  });
  el.querySelector('[data-train]').addEventListener('click', async e => {
    const btn = e.currentTarget;
    errEl.textContent = ''; btn.disabled = true; btn.textContent = 'Training...';
    await new Promise(r => setTimeout(r, 30)); // let the button repaint before the synchronous fit
    try {
      last = train(await getReadings(), kind);
      renderResults();
      el.querySelector('[data-results]').scrollIntoView({ block: 'start', behavior: 'auto' });
    } catch (err) {
      last = null; renderResults();
      errEl.innerHTML = `<span class="flag" style="display:block">${esc(err.message || String(err))}</span>`;
    } finally {
      btn.textContent = 'Train and cross-validate';
      if (!destroyed) renderProgress();
    }
  });

  const off = store.on('change', ({ kind: k }) => { if (k === 'readings' || k === 'profiles') renderProgress(); });
  renderSaved();
  await renderProgress();
  return () => { destroyed = true; off(); };
}
