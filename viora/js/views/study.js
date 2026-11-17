// Study mode: record an independent hydration measure alongside each strip reading, edit labels,
// and export the dataset (CSV, or ZIP with photos).
import { targetOf, CLASSES } from '../model.js';
import { tagById } from '../insights.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Standard 8-shade urine colour chart, pale straw (1) to dark amber (8).
export const URINE_SCALE = ['#f6f2cf', '#f2e8a0', '#ecda6e', '#e2c44c', '#d6aa34', '#c58f28', '#ab7222', '#8a561c'];
const urineGroup = u => u <= 3 ? 'hydrated' : u <= 5 ? 'mildly dehydrated' : 'dehydrated';

function blankLabels(l) {
  return {
    hoursSinceDrink: l && l.hoursSinceDrink != null ? l.hoursSinceDrink : null,
    weightKg: l && l.weightKg != null ? l.weightKg : null,
    urineColour: l && l.urineColour != null ? l.urineColour : null,
    notes: (l && l.notes) || ''
  };
}

let formSeq = 0;
export function renderLabelForm(container, reading, onChange) {
  const labels = blankLabels(reading && reading.labels);
  const uid = 'lf' + (++formSeq);
  container.innerHTML = `
    <div class="label-form" style="display:flex;flex-direction:column;gap:12px">
      <div class="row" style="align-items:flex-end">
        <label class="field" style="flex:1 1 140px">Hours since last drink
          <input type="number" inputmode="decimal" min="0" max="48" step="0.5" name="hours" value="${labels.hoursSinceDrink ?? ''}" placeholder="e.g. 3">
        </label>
        <label class="field" style="flex:1 1 140px">Morning body weight (kg)
          <input type="number" inputmode="decimal" min="20" max="250" step="0.1" name="weight" value="${labels.weightKg ?? ''}" placeholder="e.g. 62.4">
        </label>
      </div>
      <div class="field" role="group" aria-labelledby="${uid}-u">
        <span id="${uid}-u">Urine colour (1 palest to 8 darkest)</span>
        <div class="chips" data-urine style="gap:4px"></div>
        <span data-urine-note style="font-size:12.5px"></span>
      </div>
      <label class="field">Notes
        <textarea name="notes" rows="2" placeholder="Anything unusual: food, exercise, illness">${esc(labels.notes)}</textarea>
      </label>
    </div>`;
  const sw = container.querySelector('[data-urine]');
  const note = container.querySelector('[data-urine-note]');
  const emit = () => { if (onChange) onChange({ ...labels }); };

  function drawSwatches() {
    sw.innerHTML = URINE_SCALE.map((hex, i) => {
      const v = i + 1, on = labels.urineColour === v;
      return `<button type="button" class="chip${on ? ' on' : ''}" data-v="${v}" aria-pressed="${on}" title="Shade ${v}: ${urineGroup(v)}"
        style="display:inline-flex;flex-direction:column;align-items:center;gap:3px;padding:5px 6px;min-width:36px">
        <span style="display:block;width:22px;height:22px;border-radius:5px;background:${hex};border:1px solid var(--line)"></span>
        <span style="font-size:12px;color:var(--ink)">${v}</span></button>`;
    }).join('');
    note.textContent = labels.urineColour
      ? `Shade ${labels.urineColour}: counts as ${urineGroup(labels.urineColour)}. Tap again to clear.`
      : '1-3 hydrated, 4-5 mildly dehydrated, 6-8 dehydrated. Compare against your first urine of the session in daylight.';
  }
  drawSwatches();
  sw.addEventListener('click', e => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    const v = +b.dataset.v;
    labels.urineColour = labels.urineColour === v ? null : v;
    drawSwatches(); emit();
  });
  const numOrNull = v => (v === '' || !isFinite(+v)) ? null : +v;
  container.querySelector('[name=hours]').addEventListener('input', e => { labels.hoursSinceDrink = numOrNull(e.target.value); emit(); });
  container.querySelector('[name=weight]').addEventListener('input', e => { labels.weightKg = numOrNull(e.target.value); emit(); });
  container.querySelector('[name=notes]').addEventListener('input', e => { labels.notes = e.target.value; emit(); });
}

// ---------- CSV / ZIP export ----------
const CSV_COLS = [
  'id', 'profile', 'profileId', 'time_iso', 't', 'source', 'mode',
  'test_hex', 'test_r', 'test_g', 'test_b', 'test_hue', 'test_L', 'test_a', 'test_b_star',
  'control_hex', 'control_r', 'control_g', 'control_b', 'control_hue', 'control_L', 'control_a', 'control_b_star',
  'hueShift', 'adjHue', 'correction_method', 'correction_residual', 'printerOk',
  'score', 'ph', 'conf', 'band', 'baseline', 'tags', 'flags',
  'hoursSinceDrink', 'weightKg', 'urineColour', 'notes',
  'class_urine', 'class_hours', 'model_cls', 'model_probs'
];
const csvCell = v => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(+v.toFixed(4))) : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
export function readingsToCsv(readings, profileName) {
  const lines = [CSV_COLS.join(',')];
  for (const r of readings) {
    const t = r.test || {}, c = r.control || null, l = r.labels || {}, cor = r.correction || {};
    const rgb = t.rgb || [], lab = t.lab || [];
    const row = [
      r.id, profileName(r.profileId), r.profileId, r.t ? new Date(r.t).toISOString() : '', r.t, r.source, r.mode,
      t.hex, rgb[0], rgb[1], rgb[2], t.hue, lab[0], lab[1], lab[2],
      c && c.hex, c && c.rgb && c.rgb[0], c && c.rgb && c.rgb[1], c && c.rgb && c.rgb[2], c && c.hue, c && c.lab && c.lab[0], c && c.lab && c.lab[1], c && c.lab && c.lab[2],
      r.hueShift, r.adjHue, cor.method, cor.residual, cor.printerOk,
      r.score, r.ph, r.conf, r.band, r.baseline ? 1 : 0, (r.tags || []).join(';'), (r.flags || []).join(' | '),
      l.hoursSinceDrink, l.weightKg, l.urineColour, l.notes,
      targetOf(r, 'urine'), targetOf(r, 'hours'), r.model && r.model.cls, r.model && r.model.probs ? JSON.stringify(r.model.probs) : ''
    ];
    lines.push(row.map(csvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
let jszipP = null;
function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (jszipP) return jszipP;
  jszipP = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = () => window.JSZip ? resolve(window.JSZip) : reject(new Error('JSZip did not load'));
    s.onerror = () => { jszipP = null; reject(new Error('Could not load the ZIP library. Check your internet connection.')); };
    document.head.appendChild(s);
  });
  return jszipP;
}
const dataUrlBase64 = d => (typeof d === 'string' && d.startsWith('data:') && d.includes(',')) ? d.slice(d.indexOf(',') + 1) : null;
const stamp = () => new Date().toISOString().slice(0, 10);

// ---------- view ----------
const fmtTime = t => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
function labelSummary(l) {
  if (!l) return '<span style="color:var(--muted)">None</span>';
  const parts = [];
  if (l.urineColour != null) parts.push(`<span class="swatch-sm" style="background:${URINE_SCALE[l.urineColour - 1]}"></span> ${l.urineColour}`);
  if (l.hoursSinceDrink != null) parts.push(`${l.hoursSinceDrink} h`);
  if (l.weightKg != null) parts.push(`${l.weightKg} kg`);
  if (l.notes) parts.push('note');
  return parts.length ? parts.join(' &middot; ') : '<span style="color:var(--muted)">None</span>';
}
const isLabelled = r => targetOf(r, 'urine') !== null || targetOf(r, 'hours') !== null || (r.labels && r.labels.weightKg != null);

export async function mount(el, ctx) {
  const { store, toast } = ctx;
  let showAll = false, openId = null, selfWrite = 0, destroyed = false;
  let readings = [], profiles = [], active = null;
  const pname = id => (profiles.find(p => p.id === id) || {}).name || 'Unknown';

  el.innerHTML = `
    <div class="page-head">
      <h1>Study mode</h1>
      <p>Collect the evidence that shows whether the strip works. Each reading needs an independent measure of hydration recorded next to it.</p>
    </div>
    <div class="grid2">
      <div class="card">
        <h2>Why label readings</h2>
        <p class="sub">The strip colour is only useful if it predicts real hydration.</p>
        <p style="margin:0 0 10px">A colour on its own cannot prove anything. To test the strip, every reading needs a second, independent measure of hydration taken at the same time. With enough labelled readings, the Model page checks whether the strip colour actually predicts that measure, and how it compares with the built-in colour rule.</p>
        <p style="margin:0">Recommended measures: <strong>urine colour</strong> on the 8-shade chart (quick, every reading) and <strong>morning body weight</strong> (after the toilet, before eating or drinking; a drop from your usual weight suggests fluid loss). Hours since your last drink is also useful.</p>
      </div>
      <div class="card">
        <h2>Testing protocol</h2>
        <p class="sub">Keep conditions the same so the colour reflects hydration, not the routine.</p>
        <ul style="margin:0;padding-left:18px">
          <li>No food, drink, chewing gum or tooth brushing for 30 minutes before testing.</li>
          <li>Test at the same time of day where possible; first thing in the morning is best.</li>
          <li>Use the printed reference card so the colour can be corrected.</li>
          <li>Record the urine colour and hours since drinking straight after the photo.</li>
          <li>Aim for readings across different states: well hydrated, after a long gap without water, and after exercise.</li>
        </ul>
        <label class="switch" style="margin-top:14px"><input type="checkbox" data-study> Study mode on: ask for labels on the Check page after every reading</label>
      </div>
    </div>
    <div class="card" style="margin-bottom:20px">
      <div class="row" style="justify-content:space-between">
        <div class="section-title"><h2>Your readings</h2><p class="sub" style="margin:0" data-scope-note></p></div>
        <div class="chips" data-scope>
          <button type="button" class="chip on" data-s="me">Active profile</button>
          <button type="button" class="chip" data-s="all">All profiles</button>
        </div>
      </div>
      <div class="stats" data-stats></div>
      <div data-table></div>
    </div>
    <div class="card">
      <h2>Export the dataset</h2>
      <p class="sub">Exports include every profile on this device. The CSV has all colour values, scores and labels (no photos). The ZIP adds the analysed photo and thumbnail for each reading.</p>
      <div class="row">
        <button type="button" data-csv>Download CSV</button>
        <button type="button" data-zip>Download ZIP with photos</button>
        <span class="sub" style="margin:0" data-export-status></span>
      </div>
    </div>`;

  const studyBox = el.querySelector('[data-study]');
  studyBox.checked = !!store.settings().studyMode;
  studyBox.addEventListener('change', () => {
    store.setSettings({ studyMode: studyBox.checked });
    toast(studyBox.checked ? 'Study mode on' : 'Study mode off');
  });

  el.querySelector('[data-scope]').addEventListener('click', e => {
    const b = e.target.closest('[data-s]'); if (!b) return;
    showAll = b.dataset.s === 'all';
    el.querySelectorAll('[data-scope] .chip').forEach(c => c.classList.toggle('on', c === b));
    openId = null; render();
  });

  async function load() {
    active = await store.activeProfile();
    profiles = await store.profiles.list();
    readings = await store.readings.list(showAll ? {} : { profileId: active.id });
  }

  function renderStats() {
    const total = readings.length, labelled = readings.filter(isLabelled).length;
    const byUrine = Object.fromEntries(CLASSES.map(c => [c, 0]));
    const byHours = Object.fromEntries(CLASSES.map(c => [c, 0]));
    readings.forEach(r => { const u = targetOf(r, 'urine'), h = targetOf(r, 'hours'); if (u) byUrine[u]++; if (h) byHours[h]++; });
    const tile = (k, v) => `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${v}</div></div>`;
    el.querySelector('[data-stats]').innerHTML =
      tile('Readings', total) + tile('With any label', labelled) +
      CLASSES.map(c => tile(c + ' (urine)', byUrine[c])).join('') +
      CLASSES.map(c => tile(c + ' (hours)', byHours[c])).join('');
    el.querySelector('[data-scope-note]').textContent = showAll
      ? `All profiles on this device, ${total} reading${total === 1 ? '' : 's'}.`
      : `Profile "${active.name}", ${total} reading${total === 1 ? '' : 's'}. Click a row to add or edit its labels.`;
  }

  function rowHtml(r) {
    const open = r.id === openId;
    const thumb = r.thumb ? `<img src="${esc(r.thumb)}" alt="" width="36" height="36" style="border-radius:6px;object-fit:cover;display:block">`
      : `<span class="swatch-sm" style="width:36px;height:36px;background:${esc(r.test && r.test.hex)}"></span>`;
    return `<tr data-id="${esc(r.id)}" style="cursor:pointer" tabindex="0" aria-expanded="${open}">
        <td>${thumb}</td>
        <td style="white-space:nowrap">${esc(fmtTime(r.t))}${showAll ? `<div style="font-size:12px;color:var(--muted)">${esc(pname(r.profileId))}</div>` : ''}</td>
        <td>${esc(r.band)}</td>
        <td class="num">${Math.round(r.score)}</td>
        <td data-lab>${labelSummary(r.labels)}</td>
      </tr>${open ? `<tr data-form-row><td colspan="5" style="background:var(--accent-soft);padding:14px"><div data-form></div>
        <div class="row" style="margin-top:10px;justify-content:space-between"><span class="sub" style="margin:0">${(r.tags || []).map(id => (tagById(id) || { label: id }).label).map(esc).join(', ') || 'No context tags'}</span><button type="button" class="small" data-close>Done</button></div></td></tr>` : ''}`;
  }

  function renderTable() {
    const box = el.querySelector('[data-table]');
    if (!readings.length) {
      box.innerHTML = `<p class="empty">No readings ${showAll ? 'on this device' : 'for this profile'} yet. Take one on the <a href="#check">Check</a> page; with study mode on you will be asked for labels straight away.</p>`;
      return;
    }
    const rows = readings.slice().reverse();
    box.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th></th><th>Time</th><th>Band</th><th>Score</th><th>Labels</th></tr></thead>
      <tbody>${rows.map(rowHtml).join('')}</tbody></table></div>`;
    if (openId) {
      const r = readings.find(x => x.id === openId);
      const formEl = box.querySelector('[data-form]');
      if (r && formEl) renderLabelForm(formEl, r, labels => saveLabels(r, labels));
    }
  }

  let saveT = null, pending = null;
  function saveLabels(r, labels) {
    r.labels = labels; pending = r;
    const cell = el.querySelector(`tr[data-id="${CSS.escape(r.id)}"] [data-lab]`);
    if (cell) cell.innerHTML = labelSummary(labels);
    clearTimeout(saveT);
    saveT = setTimeout(async () => {
      pending = null; selfWrite++;
      try { await store.readings.update(r); } catch (e) { toast('Could not save labels: ' + e.message); }
      finally { selfWrite--; }
      renderStats();
    }, 350);
  }

  el.querySelector('[data-table]').addEventListener('click', e => {
    if (e.target.closest('[data-close]')) { openId = null; renderTable(); return; }
    if (e.target.closest('[data-form-row]')) return;
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    openId = openId === tr.dataset.id ? null : tr.dataset.id;
    renderTable();
  });
  el.querySelector('[data-table]').addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-id]')) { e.preventDefault(); e.target.click(); }
  });

  async function render() {
    await load();
    if (destroyed) return;
    renderStats(); renderTable();
  }

  const status = el.querySelector('[data-export-status]');
  el.querySelector('[data-csv]').addEventListener('click', async () => {
    const all = await store.readings.list();
    if (!all.length) { toast('No readings to export yet'); return; }
    const ps = await store.profiles.list();
    const name = id => (ps.find(p => p.id === id) || {}).name || '';
    download(new Blob([readingsToCsv(all, name)], { type: 'text/csv' }), `viora-readings-${stamp()}.csv`);
  });
  el.querySelector('[data-zip]').addEventListener('click', async e => {
    const btn = e.currentTarget;
    const all = await store.readings.list();
    if (!all.length) { toast('No readings to export yet'); return; }
    btn.disabled = true; status.textContent = 'Preparing ZIP...';
    try {
      const JSZip = await loadJSZip();
      const ps = await store.profiles.list();
      const name = id => (ps.find(p => p.id === id) || {}).name || '';
      const zip = new JSZip();
      zip.file('data.csv', readingsToCsv(all, name));
      let photos = 0;
      for (const r of all) {
        const p = dataUrlBase64(r.photo), t = dataUrlBase64(r.thumb);
        if (p) { zip.file(`photos/${r.id}.jpg`, p, { base64: true }); photos++; }
        if (t) zip.file(`thumbs/${r.id}.jpg`, t, { base64: true });
      }
      zip.file('README.txt', `Viora dataset export, ${new Date().toISOString()}\r\n${all.length} readings, ${photos} photos.\r\ndata.csv: one row per reading. photos/<id>.jpg: analysed photo. thumbs/<id>.jpg: crop around the test pad.\r\nclass_urine and class_hours are the three-class targets derived from the labels.\r\n`);
      const blob = await zip.generateAsync({ type: 'blob' });
      download(blob, `viora-dataset-${stamp()}.zip`);
      status.textContent = `ZIP ready: ${all.length} readings, ${photos} photos.`;
    } catch (err) {
      status.textContent = ''; toast(err.message || String(err));
    } finally { btn.disabled = false; }
  });

  const off = store.on('change', ({ kind }) => {
    if (kind === 'settings') { studyBox.checked = !!store.settings().studyMode; return; }
    if (selfWrite) return;
    if (kind === 'readings' || kind === 'profiles') render();
  });

  await render();
  return () => {
    destroyed = true; off(); clearTimeout(saveT);
    if (pending) store.readings.update(pending).catch(() => {}); // flush unsaved label edits
  };
}
