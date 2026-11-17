// Trends: day and week charts, time-of-day pattern, personal baseline, context tags and full history.
import { store } from '../store.js';
import { TAGS, tagById, computeBaseline } from '../insights.js';

const DAY = 86400000;
const HEX_RE = /^#[0-9a-f]{6}$/i;
const BLOCKS = [[6, 9], [9, 12], [12, 15], [15, 18], [18, 21], [21, 24]];
const PAGE = 50;

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeHex = h => (HEX_RE.test(String(h || '')) ? h : '#808080');
const startOfDay = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); }; // DST-safe
const hhmm = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dayLabel = t => new Date(t).toLocaleDateString([], { weekday: 'short', day: 'numeric' });
const dateLong = t => new Date(t).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
const fmtMl = ml => (ml >= 1000 ? (ml / 1000).toFixed(1) + ' L' : Math.round(ml) + ' ml');
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const pad2 = n => String(n).padStart(2, '0');
const blockName = ([a, b]) => `${pad2(a)}:00 and ${pad2(b === 24 ? 0 : b)}:00`;
const blockShort = ([a, b]) => `${pad2(a)}-${pad2(b)}`;

const STYLE = `
.tr-svg{width:100%;height:auto;display:block}
.tr-legend{display:flex;flex-wrap:wrap;gap:14px;font-size:12.5px;color:var(--muted);margin-top:8px}
.tr-legend span{display:inline-flex;align-items:center;gap:6px}
.tr-legend i{display:inline-block;width:14px;height:10px;border-radius:3px}
.tr-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
.tr-tags td,.tr-tags th{white-space:nowrap}
`;

export async function mount(el, ctx) {
  const st = document.createElement('style'); st.textContent = STYLE;
  el.innerHTML = `
    <div class="page-head"><h1>Trends</h1><p>Your readings over time, the times of day you tend to run dry, and how context affects the strip.</p></div>
    <section class="card" id="trMain" style="margin-top:22px"></section>
    <div class="grid2">
      <section class="card" id="trPattern"></section>
      <section class="card" id="trBase"></section>
    </div>
    <section class="card" id="trTags"></section>
    <section class="card" id="trHist" style="margin:22px 0"></section>`;
  el.prepend(st);
  const $ = s => el.querySelector(s);
  let alive = true, mode = store.kv.get('hs_trends_mode', 'week'), dayStart = startOfDay(), shown = PAGE;
  let profile, readings = [], intake = [], baseline = null;

  async function load() {
    profile = await store.activeProfile();
    [readings, intake] = await Promise.all([
      store.readings.list({ profileId: profile.id }),
      store.intake.list({ profileId: profile.id, from: addDays(startOfDay(), -14) })
    ]);
    baseline = computeBaseline(readings);
  }
  async function render() {
    await load();
    if (!alive) return;
    renderMain(); renderPattern(); renderBaseline(); renderTags(); renderHistory();
  }

  function renderMain() {
    const box = $('#trMain');
    const toggle = `<div class="chips" role="group" aria-label="Chart range">
      <button class="chip${mode === 'day' ? ' on' : ''}" data-mode="day" aria-pressed="${mode === 'day'}">Day</button>
      <button class="chip${mode === 'week' ? ' on' : ''}" data-mode="week" aria-pressed="${mode === 'week'}">Week</button></div>`;
    let body;
    if (mode === 'week') {
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const s = addDays(startOfDay(), -i), e = addDays(s, 1);
        const rs = readings.filter(r => r.t >= s && r.t < e);
        const ml = intake.filter(r => r.t >= s && r.t < e).reduce((a, r) => a + r.ml, 0);
        days.push({ s, n: rs.length, avg: rs.length ? mean(rs.map(r => r.score)) : null, ml });
      }
      const any = days.some(d => d.n || d.ml);
      body = `<div class="section-title"><h2>Last 7 days</h2><p class="sub">Average hydration score per day (line) and total water logged (bars).${baseline ? ' The shaded band is your personal baseline.' : ''}</p></div>`
        + (any ? weekSvg(days, baseline) + `<div class="tr-legend">
            <span><i style="background:var(--accent)"></i>Average score</span>
            <span><i style="background:var(--accent-soft);border:1px solid var(--accent)"></i>Water logged</span>
            ${baseline ? '<span><i style="background:var(--accent);opacity:.18"></i>Baseline (mean plus or minus 1 SD)</span>' : ''}</div>
            <div class="table-wrap" style="margin-top:12px"><table class="data"><thead><tr><th>Day</th><th>Readings</th><th>Avg score</th><th>Water</th></tr></thead><tbody>
            ${days.slice().reverse().map(d => `<tr><td>${dayLabel(d.s)}</td><td class="num">${d.n}</td><td class="num">${d.avg == null ? '-' : Math.round(d.avg)}</td><td class="num">${d.ml ? fmtMl(d.ml) : '-'}</td></tr>`).join('')}
            </tbody></table></div>`
          : '<p class="empty">No readings or water logged in the last 7 days. Take a reading on the <a href="#check">Check</a> page or log water on the <a href="#today">Today</a> page.</p>');
    } else {
      const e = addDays(dayStart, 1);
      const rs = readings.filter(r => r.t >= dayStart && r.t < e);
      const ins = intake.filter(r => r.t >= dayStart && r.t < e);
      const isToday = dayStart === startOfDay();
      const oldest = addDays(startOfDay(), -13);
      body = `<div class="section-title"><h2>${isToday ? 'Today' : esc(dateLong(dayStart))}</h2><p class="sub">Scores through the day with water logged on the same clock.</p></div>
        <div class="row" style="margin-bottom:10px">
          <button class="small" id="trPrev" ${dayStart <= oldest ? 'disabled' : ''}>Previous day</button>
          <button class="small" id="trNext" ${isToday ? 'disabled' : ''}>Next day</button>
          <span class="sub" style="margin:0">${rs.length} reading${rs.length === 1 ? '' : 's'}, ${fmtMl(ins.reduce((a, r) => a + r.ml, 0))} water</span>
        </div>`
        + (rs.length || ins.length ? daySvg(rs, ins, dayStart) + `<div class="tr-legend">
            <span><i style="background:var(--accent)"></i>Score (points use the strip colour)</span>
            <span><i style="background:var(--accent-soft);border:1px solid var(--accent)"></i>Water logged</span></div>`
          : '<p class="empty">Nothing recorded on this day.</p>');
    }
    box.innerHTML = `<div class="tr-head"><div></div>${toggle}</div>` + body;
    box.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode; store.kv.set('hs_trends_mode', mode); renderMain(); });
    const p = box.querySelector('#trPrev'), n = box.querySelector('#trNext');
    if (p) p.onclick = () => { dayStart = addDays(dayStart, -1); renderMain(); };
    if (n) n.onclick = () => { dayStart = addDays(dayStart, 1); renderMain(); };
  }

  function renderPattern() {
    const box = $('#trPattern');
    const since = addDays(startOfDay(), -13);
    const recent = readings.filter(r => r.t >= since);
    const stats = BLOCKS.map(b => {
      const rs = recent.filter(r => { const h = new Date(r.t).getHours(); return h >= b[0] && h < b[1]; });
      return { b, n: rs.length, avg: rs.length ? mean(rs.map(r => r.score)) : null };
    });
    const inBlocks = stats.reduce((a, s) => a + s.n, 0);
    const days = new Set(recent.map(r => startOfDay(r.t))).size;
    const overall = recent.length ? mean(recent.map(r => r.score)) : null;
    let sentence;
    if (recent.length < 8 || days < 3) {
      const needR = Math.max(0, 8 - recent.length), needD = Math.max(0, 3 - days);
      const parts = [];
      if (needR) parts.push(`${needR} more reading${needR === 1 ? '' : 's'}`);
      if (needD) parts.push(`readings on ${needD} more day${needD === 1 ? '' : 's'}`);
      sentence = `Not enough data yet to find a pattern. You have ${recent.length} reading${recent.length === 1 ? '' : 's'} over ${days} day${days === 1 ? '' : 's'} in the last 14 days; ${parts.join(' and ')} needed (at least 8 readings across 3 days).`;
    } else {
      const cands = stats.filter(s => s.n >= 3).sort((a, b) => a.avg - b.avg);
      const low = cands[0];
      if (low && overall - low.avg >= 10) {
        sentence = `You are consistently drier between ${blockName(low.b)} (average ${Math.round(low.avg)} vs ${Math.round(overall)} overall).`;
      } else if (!cands.length) {
        sentence = `No single time block has 3 readings yet, so no pattern can be stated. Try testing at similar times on different days.`;
      } else {
        sentence = `No time of day stands out: no block with at least 3 readings averages 10 or more points below your overall ${Math.round(overall)}.`;
      }
    }
    box.innerHTML = `<div class="section-title"><h2>Time of day</h2><p class="sub">Average score per 3-hour block, last 14 days.</p></div>
      ${inBlocks ? blocksSvg(stats, overall) : ''}
      <p style="font-size:14.5px;margin:12px 0 0">${esc(sentence)}</p>
      ${recent.length > inBlocks ? `<p class="sub" style="margin:6px 0 0">${recent.length - inBlocks} reading${recent.length - inBlocks === 1 ? '' : 's'} taken between 00:00 and 06:00 ${recent.length - inBlocks === 1 ? 'is' : 'are'} not shown in the blocks.</p>` : ''}`;
  }

  function renderBaseline() {
    const box = $('#trBase');
    const nb = readings.filter(r => r.baseline).length;
    const explain = `<p class="sub" style="margin-top:12px">Your baseline is built from readings flagged as baseline on the <a href="#check">Check</a> page: first thing in the morning, before eating, drinking or brushing your teeth. It uses your last 10 baseline readings and needs at least 3.</p>`;
    if (!baseline) {
      box.innerHTML = `<div class="section-title"><h2>Personal baseline</h2></div>
        <p class="empty">${nb ? `${nb} of 3 baseline readings so far. ${3 - nb} more needed.` : 'No baseline readings yet. You need at least 3.'}</p>${explain}`;
      return;
    }
    const lo = Math.max(0, baseline.meanScore - baseline.sdScore), hi = Math.min(100, baseline.meanScore + baseline.sdScore);
    box.innerHTML = `<div class="section-title"><h2>Personal baseline</h2></div>
      <div class="stats">
        <div class="stat"><div class="k">Baseline score</div><div class="v">${Math.round(baseline.meanScore)}</div></div>
        <div class="stat"><div class="k">Normal range</div><div class="v">${Math.round(lo)}-${Math.round(hi)}</div></div>
        <div class="stat"><div class="k">From readings</div><div class="v">${baseline.n}</div></div>
      </div>
      <p style="font-size:14px;margin:0">Scores inside ${Math.round(lo)} to ${Math.round(hi)} (your mean plus or minus one standard deviation) are normal for you. It is shown as the shaded band on the week chart.</p>${explain}`;
  }

  function renderTags() {
    const box = $('#trTags');
    const untagged = readings.filter(r => !(r.tags || []).length);
    const ua = untagged.length ? mean(untagged.map(r => r.score)) : null;
    const rows = TAGS.map(t => {
      const rs = readings.filter(r => (r.tags || []).includes(t.id));
      return { t, n: rs.length, avg: rs.length ? mean(rs.map(r => r.score)) : null };
    }).filter(x => x.n);
    const head = `<div class="section-title"><h2>Context tags</h2><p class="sub">Average score for readings with each tag, compared with readings that have no tags${ua == null ? '' : ` (${untagged.length} untagged, average ${Math.round(ua)})`}.</p></div>`;
    if (!rows.length) { box.innerHTML = head + '<p class="empty">No tagged readings yet. Add context tags such as "Just ate" or "After exercise" when you take a reading.</p>'; return; }
    box.innerHTML = head + `<div class="table-wrap"><table class="data tr-tags"><thead><tr><th>Tag</th><th>Readings</th><th>Avg score</th><th>vs untagged</th></tr></thead><tbody>
      ${rows.map(x => {
        const d = ua == null ? null : Math.round(x.avg - ua);
        return `<tr><td>${esc(x.t.label)}</td><td class="num">${x.n}</td><td class="num">${Math.round(x.avg)}</td><td class="num">${d == null ? 'no untagged readings' : (d > 0 ? '+' : '') + d}</td></tr>`;
      }).join('')}</tbody></table></div>
      <p class="sub" style="margin:10px 0 0">Small counts are noisy. Tags with 5 or more readings are more trustworthy.</p>`;
  }

  function renderHistory() {
    const box = $('#trHist');
    const head = `<div class="section-title"><h2>History</h2><p class="sub">${readings.length} reading${readings.length === 1 ? '' : 's'} for ${esc(profile.name)}, newest first.</p></div>`;
    if (!readings.length) { box.innerHTML = head + '<p class="empty">No readings yet. Your first reading from the <a href="#check">Check</a> page will appear here.</p>'; return; }
    const rows = readings.slice().reverse().slice(0, shown);
    box.innerHTML = head + `<div class="table-wrap"><table class="data"><thead><tr><th>Time</th><th>Colour</th><th>Band</th><th>Score</th><th>pH</th><th>Tags</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr>
        <td class="num" style="white-space:nowrap">${new Date(r.t).toLocaleDateString([], { day: 'numeric', month: 'short' })} ${hhmm(r.t)}${r.baseline ? '<br><span class="sub" style="font-size:12px">baseline</span>' : ''}</td>
        <td><span class="swatch-sm" style="background:${safeHex(r.test && r.test.hex)}" title="${esc(r.test && r.test.hex)}"></span></td>
        <td>${esc(r.band)}</td>
        <td class="num">${Math.round(r.score)}</td>
        <td class="num">${typeof r.ph === 'number' ? r.ph.toFixed(1) : '-'}</td>
        <td>${(r.tags || []).map(id => esc((tagById(id) || { label: id }).label)).join(', ') || '<span class="sub">none</span>'}</td>
        <td><button class="small danger" data-del="${esc(r.id)}" aria-label="Delete reading from ${hhmm(r.t)}">Delete</button></td></tr>`).join('')}
      </tbody></table></div>
      ${readings.length > shown ? `<div class="row" style="margin-top:12px"><button class="small" id="trMore">Show ${Math.min(PAGE, readings.length - shown)} more</button></div>` : ''}`;
    box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const r = readings.find(x => x.id === b.dataset.del);
      if (!r || !confirm(`Delete the reading from ${new Date(r.t).toLocaleString()}? This cannot be undone.`)) return;
      await store.readings.remove(r.id);
      ctx.toast('Reading deleted.');
    });
    const more = box.querySelector('#trMore');
    if (more) more.onclick = () => { shown += PAGE; renderHistory(); };
  }

  const unsub = store.on('change', ({ kind }) => { if (['readings', 'intake', 'profiles'].includes(kind)) render(); });
  await render();
  return () => { alive = false; unsub(); };
}

// ---------- charts ----------
function axes(L, T, pw, ph, y, W) {
  let g = '';
  for (const v of [0, 25, 50, 75, 100]) {
    g += `<line x1="${L}" x2="${L + pw}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--line)" stroke-width="${v % 50 ? 0.5 : 1}"/>`;
    g += `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" style="fill:var(--muted)">${v}</text>`;
  }
  return g;
}

function weekSvg(days, base) {
  const W = 720, H = 260, L = 34, R = 46, T = 14, B = 30;
  const pw = W - L - R, ph = H - T - B, slot = pw / days.length;
  const y = s => T + (1 - s / 100) * ph;
  const maxMl = Math.max(1000, ...days.map(d => d.ml));
  const yMl = ml => T + ph - ml / maxMl * ph;
  let g = axes(L, T, pw, ph, y, W);
  if (base) {
    const lo = Math.max(0, base.meanScore - base.sdScore), hi = Math.min(100, base.meanScore + base.sdScore);
    g += `<rect x="${L}" y="${y(hi)}" width="${pw}" height="${y(lo) - y(hi)}" style="fill:var(--accent)" fill-opacity="0.12"/>`;
    g += `<line x1="${L}" x2="${L + pw}" y1="${y(base.meanScore)}" y2="${y(base.meanScore)}" style="stroke:var(--accent)" stroke-dasharray="4 4" stroke-opacity="0.6"/>`;
  }
  // right axis for water
  for (const f of [0, 0.5, 1]) g += `<text x="${L + pw + 6}" y="${yMl(maxMl * f) + 4}" font-size="11" style="fill:var(--muted)">${fmtMl(maxMl * f)}</text>`;
  days.forEach((d, i) => {
    const cx = L + slot * (i + 0.5), bw = Math.min(46, slot * 0.55);
    if (d.ml) g += `<rect x="${cx - bw / 2}" y="${yMl(d.ml)}" width="${bw}" height="${T + ph - yMl(d.ml)}" rx="3" style="fill:var(--accent-soft);stroke:var(--accent)" stroke-width="1"><title>${dayLabel(d.s)}: ${fmtMl(d.ml)} water</title></rect>`;
    g += `<text x="${cx}" y="${H - 10}" text-anchor="middle" font-size="11" style="fill:var(--muted)">${dayLabel(d.s)}</text>`;
  });
  const pts = days.map((d, i) => d.avg == null ? null : [L + slot * (i + 0.5), y(d.avg), d]).filter(Boolean);
  // connect consecutive days only; gaps stay gaps
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const ia = days.indexOf(a[2]), ib = days.indexOf(b[2]);
    g += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" style="stroke:var(--accent)" stroke-width="2" ${ib - ia > 1 ? 'stroke-dasharray="4 4"' : ''}/>`;
  }
  for (const [px, py, d] of pts) {
    g += `<circle cx="${px}" cy="${py}" r="5" style="fill:var(--accent);stroke:var(--surface)" stroke-width="2"><title>${dayLabel(d.s)}: average ${Math.round(d.avg)} from ${d.n} reading${d.n === 1 ? '' : 's'}</title></circle>`;
    g += `<text x="${px}" y="${py - 10}" text-anchor="middle" font-size="11" style="fill:var(--ink)">${Math.round(d.avg)} (${d.n})</text>`;
  }
  return `<svg class="tr-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Average hydration score and water intake for the last 7 days">${g}</svg>`;
}

function daySvg(rs, ins, from) {
  const W = 720, H = 240, L = 34, R = 10, T = 12, B = 26;
  const pw = W - L - R, ph = H - T - B, span = addDays(from, 1) - from;
  const x = t => L + (t - from) / span * pw;
  const y = s => T + (1 - s / 100) * ph;
  const maxMl = Math.max(500, ...ins.map(r => r.ml));
  let g = axes(L, T, pw, ph, y, W);
  for (let h = 0; h <= 24; h += 3) {
    const xx = L + h / 24 * pw;
    g += `<text x="${xx}" y="${H - 8}" text-anchor="middle" font-size="11" style="fill:var(--muted)">${pad2(h)}:00</text>`;
  }
  const bw = Math.max(4, pw / 96);
  for (const r of ins) {
    const hgt = r.ml / maxMl * ph * 0.4;
    g += `<rect x="${x(r.t) - bw / 2}" y="${T + ph - hgt}" width="${bw}" height="${hgt}" rx="2" style="fill:var(--accent-soft);stroke:var(--accent)" stroke-width="1"><title>${hhmm(r.t)}: ${r.ml} ml</title></rect>`;
  }
  if (rs.length > 1) g += `<polyline fill="none" style="stroke:var(--accent)" stroke-width="2" stroke-linejoin="round" points="${rs.map(r => `${x(r.t).toFixed(1)},${y(r.score).toFixed(1)}`).join(' ')}"/>`;
  for (const r of rs) g += `<circle cx="${x(r.t)}" cy="${y(r.score)}" r="6" fill="${safeHex(r.test && r.test.hex)}" style="stroke:var(--surface)" stroke-width="2"><title>${hhmm(r.t)}: ${esc(r.band)}, score ${Math.round(r.score)}</title></circle>`;
  return `<svg class="tr-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Hydration scores and water intake through the day">${g}</svg>`;
}

function blocksSvg(stats, overall) {
  const W = 360, H = 190, L = 30, R = 8, T = 14, B = 34;
  const pw = W - L - R, ph = H - T - B, slot = pw / stats.length;
  const y = s => T + (1 - s / 100) * ph;
  let g = '';
  for (const v of [0, 50, 100]) {
    g += `<line x1="${L}" x2="${L + pw}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--line)"/>`;
    g += `<text x="${L - 5}" y="${y(v) + 4}" text-anchor="end" font-size="10" style="fill:var(--muted)">${v}</text>`;
  }
  stats.forEach((s, i) => {
    const cx = L + slot * (i + 0.5), bw = slot * 0.62;
    if (s.n) {
      g += `<rect x="${cx - bw / 2}" y="${y(s.avg)}" width="${bw}" height="${T + ph - y(s.avg)}" rx="3" style="fill:var(--accent)" fill-opacity="${s.n >= 3 ? 0.85 : 0.35}"><title>${blockShort(s.b)}: average ${Math.round(s.avg)} from ${s.n} reading${s.n === 1 ? '' : 's'}</title></rect>`;
      g += `<text x="${cx}" y="${y(s.avg) - 4}" text-anchor="middle" font-size="10" style="fill:var(--ink)">${Math.round(s.avg)}</text>`;
    }
    g += `<text x="${cx}" y="${H - 18}" text-anchor="middle" font-size="10" style="fill:var(--muted)">${blockShort(s.b)}</text>`;
    g += `<text x="${cx}" y="${H - 5}" text-anchor="middle" font-size="9.5" style="fill:var(--muted)">n=${s.n}</text>`;
  });
  if (overall != null) g += `<line x1="${L}" x2="${L + pw}" y1="${y(overall)}" y2="${y(overall)}" style="stroke:var(--ink)" stroke-dasharray="4 3" stroke-opacity="0.6"><title>Overall average ${Math.round(overall)}</title></line>`;
  return `<svg class="tr-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Average score by time of day">${g}</svg>
    <p class="sub" style="margin:6px 0 0">Dashed line: overall average. Faded bars have fewer than 3 readings.</p>`;
}
