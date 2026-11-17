// Today: water intake log, today's readings on a 24 h timeline, and drink reminders.
import { store } from '../store.js';

const QUICK = [150, 250, 330, 500];
const REMIND_OPTS = [0, 30, 60, 90, 120];
const DAY = 86400000;
const HEX_RE = /^#[0-9a-f]{6}$/i;

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeHex = h => (HEX_RE.test(String(h || '')) ? h : '#808080');
const startOfDay = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const hhmm = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtMl = ml => (ml >= 1000 ? String(+(ml / 1000).toFixed(2)) + ' L' : Math.round(ml) + ' ml');

const STYLE = `
.td-bar{height:14px;border-radius:99px;background:var(--accent-soft);overflow:hidden;border:1px solid var(--line)}
.td-bar > i{display:block;height:100%;background:var(--accent);border-radius:99px}
.td-list{list-style:none;margin:10px 0 0;padding:0}
.td-list li{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);font-size:14px}
.td-list li .t{color:var(--muted);font-variant-numeric:tabular-nums;min-width:52px}
.td-list li .grow{flex:1;min-width:0}
.td-svg{width:100%;height:auto;display:block;color:var(--ink)}
.td-legend{display:flex;flex-wrap:wrap;gap:14px;font-size:12.5px;color:var(--muted);margin-top:8px}
.td-legend span{display:inline-flex;align-items:center;gap:6px}
.td-legend i{display:inline-block;width:14px;height:10px;border-radius:3px}
.td-inline{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.td-inline input{width:110px}
`;

export async function mount(el, ctx) {
  const st = document.createElement('style'); st.textContent = STYLE;
  el.innerHTML = `
    <div class="page-head"><h1>Today</h1><p>Log the water you drink and see it against today's strip readings.</p></div>
    <div class="grid2">
      <section class="card" id="tdIntake"></section>
      <section class="card" id="tdRemind"></section>
    </div>
    <section class="card" id="tdTimeline" style="margin-bottom:22px"></section>`;
  el.prepend(st);
  const $ = s => el.querySelector(s);
  let profile = null, alive = true, editingGoal = false;

  async function render() {
    if (!alive) return;
    profile = await store.activeProfile();
    const from = startOfDay(), to = from + DAY;
    const [intake, allReadings] = await Promise.all([
      store.intake.list({ profileId: profile.id, from, to }),
      store.readings.list({ profileId: profile.id })
    ]);
    if (!alive) return;
    const readings = allReadings.filter(r => r.t >= from && r.t < to);
    renderIntake(intake);
    renderReminders(intake);
    renderTimeline(readings, intake, from);
  }

  function renderIntake(intake) {
    const s = store.settings();
    const goal = Math.max(1, +s.intakeGoalMl || 2000);
    const total = intake.reduce((a, r) => a + r.ml, 0);
    const pct = Math.min(100, Math.round(total / goal * 100));
    const box = $('#tdIntake');
    box.innerHTML = `
      <div class="section-title"><h2>Water intake</h2><p class="sub">${esc(profile.name)}, today</p></div>
      <div class="row" style="justify-content:space-between;align-items:baseline">
        <div style="font-size:26px;font-weight:600;font-variant-numeric:tabular-nums">${fmtMl(total)}</div>
        <div class="sub" style="margin:0" id="tdGoalWrap"></div>
      </div>
      <div class="td-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${total}" aria-label="Water intake towards today's goal" style="margin:8px 0 4px"><i style="width:${pct}%"></i></div>
      <p class="sub">${total >= goal ? 'Goal reached for today.' : `${fmtMl(goal - total)} to go (${pct}% of goal).`}</p>
      <div class="row" style="margin-bottom:8px">
        ${QUICK.map(ml => `<button class="small" data-add="${ml}">+ ${ml} ml</button>`).join('')}
      </div>
      <form class="td-inline" id="tdCustom">
        <input class="inp" type="number" min="10" max="3000" step="10" placeholder="Other, ml" aria-label="Custom amount in ml" required>
        <button class="small" type="submit">Add</button>
      </form>
      ${intake.length ? `<ul class="td-list">${intake.slice().reverse().map(r => `
        <li><span class="t">${hhmm(r.t)}</span><span class="grow">${fmtMl(r.ml)}</span>
        <button class="small danger" data-del="${esc(r.id)}" aria-label="Remove ${r.ml} ml at ${hhmm(r.t)}">Remove</button></li>`).join('')}</ul>`
        : '<p class="empty">Nothing logged yet today. Tap an amount above each time you drink.</p>'}`;
    renderGoal(goal);
    box.querySelectorAll('[data-add]').forEach(b => b.onclick = () => addIntake(+b.dataset.add));
    box.querySelector('#tdCustom').onsubmit = e => {
      e.preventDefault();
      const v = Math.round(+e.target.querySelector('input').value);
      if (!(v >= 10 && v <= 3000)) { ctx.toast('Enter an amount between 10 and 3000 ml.'); return; }
      addIntake(v);
    };
    box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { await store.intake.remove(b.dataset.del); });
  }

  function renderGoal(goal) {
    const w = $('#tdGoalWrap');
    if (!editingGoal) {
      w.innerHTML = `Goal ${fmtMl(goal)} <button class="small" id="tdGoalEdit" style="margin-left:6px">Edit</button>`;
      w.querySelector('#tdGoalEdit').onclick = () => { editingGoal = true; renderGoal(goal); };
      return;
    }
    w.innerHTML = `<form class="td-inline" id="tdGoalForm"><input class="inp" type="number" min="500" max="8000" step="50" value="${goal}" aria-label="Daily goal in ml"> ml
      <button class="small primary" type="submit">Save</button><button class="small" type="button" id="tdGoalCancel">Cancel</button></form>`;
    const inp = w.querySelector('input'); inp.focus(); inp.select();
    w.querySelector('#tdGoalCancel').onclick = () => { editingGoal = false; renderGoal(goal); };
    w.querySelector('#tdGoalForm').onsubmit = e => {
      e.preventDefault();
      const v = Math.round(+inp.value);
      if (!(v >= 500 && v <= 8000)) { ctx.toast('Choose a goal between 500 and 8000 ml.'); return; }
      editingGoal = false;
      store.setSettings({ intakeGoalMl: v });
    };
  }

  async function addIntake(ml) {
    await store.intake.add({ profileId: profile.id, ml, t: Date.now() });
    ctx.toast(`Logged ${ml} ml.`);
  }

  function renderReminders(intake) {
    const s = store.settings();
    const mins = +s.reminderMins || 0;
    const hasN = 'Notification' in window;
    const perm = hasN ? Notification.permission : 'unsupported';
    const last = intake.length ? intake[intake.length - 1].t : null;
    let status = 'Reminders are off.';
    if (mins) {
      const ref = reminderReference(last);
      const next = ref + mins * 60000;
      const now = new Date();
      status = last ? `Last drink logged at ${hhmm(last)}.` : 'No drink logged yet today.';
      if (now.getHours() < 8 || now.getHours() >= 22) status += ' Reminders are quiet between 22:00 and 08:00.';
      else status += next <= Date.now() ? ' A reminder is due now.' : ` Next reminder around ${hhmm(next)} if you do not log a drink before then.`;
    }
    const box = $('#tdRemind');
    box.innerHTML = `
      <div class="section-title"><h2>Drink reminders</h2><p class="sub">Remind me if I have not logged water for</p></div>
      <div class="chips" role="group" aria-label="Reminder interval">
        ${REMIND_OPTS.map(m => `<button class="chip${m === mins ? ' on' : ''}" data-m="${m}" aria-pressed="${m === mins}">${m ? m + ' min' : 'Off'}</button>`).join('')}
      </div>
      <p style="font-size:14px;margin:14px 0 8px">${esc(status)}</p>
      <div class="note">Reminders only fire while Viora is open in a browser tab (it can be in the background). Closing the tab or the browser stops them. They run between 08:00 and 22:00 local time.</div>
      <div id="tdPerm" style="margin-top:10px">${
        perm === 'granted' ? '<p class="sub" style="margin:0">System notifications are allowed for this site.</p>'
        : perm === 'denied' ? '<p class="sub" style="margin:0">Notifications are blocked for this site in your browser settings, so reminders appear as a message at the bottom of this page instead.</p>'
        : perm === 'unsupported' ? '<p class="sub" style="margin:0">This browser does not support notifications here, so reminders appear as a message at the bottom of this page.</p>'
        : '<p class="sub">Without permission, reminders appear as a message at the bottom of this page only.</p><button class="small" id="tdAskPerm">Allow system notifications</button>'
      }</div>`;
    box.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
      store.setSettings({ reminderMins: +b.dataset.m });
      store.kv.set('hs_reminder_last', Date.now() - 1); // restart the interval from now
    });
    const ask = box.querySelector('#tdAskPerm');
    if (ask) ask.onclick = async () => {
      try { await Notification.requestPermission(); } catch (e) { /* older Safari uses callbacks */ }
      render();
    };
  }

  function renderTimeline(readings, intake, from) {
    const box = $('#tdTimeline');
    const head = `<div class="section-title"><h2>Today's readings</h2><p class="sub">Hydration score from each strip reading, with the water you logged as bars on the same clock.</p></div>`;
    if (!readings.length && !intake.length) {
      box.innerHTML = head + `<p class="empty">No readings or drinks yet today. Take a reading on the <a href="#check">Check</a> page and log water above to see them here.</p>`;
      return;
    }
    box.innerHTML = head + timelineSvg(readings, intake, from) + `
      <div class="td-legend">
        <span><i style="background:var(--accent)"></i>Hydration score (points use the strip colour)</span>
        <span><i style="background:var(--accent-soft);border:1px solid var(--accent)"></i>Water logged</span>
      </div>
      ${readings.length ? `<div class="table-wrap" style="margin-top:12px"><table class="data"><thead><tr><th>Time</th><th>Colour</th><th>Band</th><th>Score</th></tr></thead><tbody>
        ${readings.slice().reverse().map(r => `<tr><td class="num">${hhmm(r.t)}</td><td><span class="swatch-sm" style="background:${safeHex(r.test && r.test.hex)}"></span></td><td>${esc(r.band)}</td><td class="num">${Math.round(r.score)}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="empty">No strip readings yet today, only water.</p>'}`;
  }

  const unsub = store.on('change', ({ kind }) => { if (['intake', 'readings', 'settings', 'profiles'].includes(kind)) render(); });
  // Keeps the "now" marker and reminder status current; skipped while the user is typing in a field here.
  const tick = setInterval(() => { const a = document.activeElement; if (!(a && a.tagName === 'INPUT' && el.contains(a))) render(); }, 60000);
  await render();
  return () => { alive = false; unsub(); clearInterval(tick); };
}

function timelineSvg(readings, intake, from) {
  const W = 720, H = 240, L = 34, R = 10, T = 12, B = 26;
  const pw = W - L - R, ph = H - T - B;
  const x = t => L + (t - from) / DAY * pw;
  const y = s => T + (1 - s / 100) * ph;
  const maxMl = Math.max(500, ...intake.map(r => r.ml));
  const barH = ml => ml / maxMl * ph * 0.4;
  let g = '';
  // band guides
  for (const [v, name] of [[30, 'Dehydrated below'], [50, 'Mild below'], [75, 'Hydrated below']]) {
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--line)" stroke-dasharray="3 4"/>`;
  }
  for (const v of [0, 25, 50, 75, 100]) g += `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" style="fill:var(--muted)">${v}</text>`;
  for (let h = 0; h <= 24; h += 3) {
    const xx = L + h / 24 * pw;
    g += `<line x1="${xx}" x2="${xx}" y1="${T}" y2="${T + ph}" style="stroke:var(--line)" stroke-width="${h % 6 ? 0.5 : 1}"/>`;
    g += `<text x="${xx}" y="${H - 8}" text-anchor="middle" font-size="11" style="fill:var(--muted)">${String(h).padStart(2, '0')}:00</text>`;
  }
  // intake bars (15-minute wide)
  const bw = Math.max(4, pw / 96);
  for (const r of intake) {
    const hgt = barH(r.ml);
    g += `<rect x="${x(r.t) - bw / 2}" y="${T + ph - hgt}" width="${bw}" height="${hgt}" rx="2" style="fill:var(--accent-soft);stroke:var(--accent)" stroke-width="1"><title>${hhmm(r.t)}: ${r.ml} ml</title></rect>`;
  }
  // now marker
  const now = Date.now();
  if (now >= from && now < from + DAY) g += `<line x1="${x(now)}" x2="${x(now)}" y1="${T}" y2="${T + ph}" style="stroke:var(--muted)" stroke-width="1"/><text x="${x(now) + 4}" y="${T + 10}" font-size="10" style="fill:var(--muted)">now</text>`;
  // score line + points
  if (readings.length > 1) g += `<polyline fill="none" style="stroke:var(--accent)" stroke-width="2" stroke-linejoin="round" points="${readings.map(r => `${x(r.t).toFixed(1)},${y(r.score).toFixed(1)}`).join(' ')}"/>`;
  for (const r of readings) {
    g += `<circle cx="${x(r.t)}" cy="${y(r.score)}" r="6" fill="${safeHex(r.test && r.test.hex)}" style="stroke:var(--surface)" stroke-width="2"><title>${hhmm(r.t)}: ${esc(r.band)}, score ${Math.round(r.score)}</title></circle>`;
  }
  return `<svg class="td-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Timeline of today's hydration scores and water intake">${g}</svg>`;
}

// When the reminder clock starts counting: the latest of the last drink, 08:00 today, and the last reminder.
function reminderReference(lastIntakeT) {
  const d = new Date(); d.setHours(8, 0, 0, 0);
  return Math.max(lastIntakeT || 0, d.getTime(), +store.kv.get('hs_reminder_last', 0) || 0);
}

let reminderTimer = null;
export function startReminders(ctx) {
  if (reminderTimer) return;
  const tick = async () => {
    try {
      const s = store.settings();                 // re-read every tick
      const mins = +s.reminderMins || 0;
      if (!mins) return;
      const now = new Date();
      if (now.getHours() < 8 || now.getHours() >= 22) return;
      const profile = await store.activeProfile();
      const recent = await store.intake.list({ profileId: profile.id, from: Date.now() - mins * 60000 });
      if (recent.length) return;
      const all = await store.intake.list({ profileId: profile.id, from: startOfDay() });
      const last = all.length ? all[all.length - 1].t : null;
      if (Date.now() - reminderReference(last) < mins * 60000) return;
      store.kv.set('hs_reminder_last', Date.now());
      const body = last ? `${profile.name}: no water logged since ${hhmm(last)}. Have a glass and log it on the Today page.`
        : `${profile.name}: no water logged yet today. Have a glass and log it on the Today page.`;
      let shown = false;
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          const n = new Notification('Time for some water', { body, tag: 'viora-reminder' });
          n.onclick = () => { window.focus(); location.hash = '#today'; n.close(); };
          shown = true;
        } catch (e) { /* some mobile browsers only allow notifications from a service worker */ }
      }
      if (!shown || document.visibilityState === 'visible') ctx.toast('Reminder: ' + body);
    } catch (e) { console.error(e); }
  };
  reminderTimer = setInterval(tick, 60000);
}
