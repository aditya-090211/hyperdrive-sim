// Team: coach / squad dashboard from local profiles on this device and, optionally, the team server.
import { store } from '../store.js';
import { computeBaseline } from '../insights.js';
import { fetchTeam, normalizeCode, CODE_RE, queueLength } from '../sync.js';

const HEX_RE = /^#[0-9a-f]{6}$/i;
const STALE_MS = 3 * 3600000;
const LOW_BANDS = ['Dehydrated', 'Mildly dehydrated'];
const NO_TEAM = '__none__';
const ALL = '__all__';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeHex = h => (HEX_RE.test(String(h || '')) ? h : '#808080');
const hhmm = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function ago(t) {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60 ? (m % 60) + ' min ' : ''}ago`;
  return `${Math.floor(h / 24)} days ago`;
}

function trendWord(scores) {
  if (scores.length < 2) return { word: 'not enough readings', cls: '' };
  const k = Math.min(3, Math.floor(scores.length / 2));
  const recent = scores.slice(-k), prev = scores.slice(-2 * k, -k);
  const d = recent.reduce((a, v) => a + v, 0) / k - prev.reduce((a, v) => a + v, 0) / prev.length;
  if (d >= 5) return { word: 'trending up', cls: 'up' };
  if (d <= -5) return { word: 'trending down', cls: 'down' };
  return { word: 'flat', cls: '' };
}

function sparkline(scores) {
  const W = 110, H = 30, P = 3;
  if (!scores.length) return '';
  const x = i => P + (scores.length === 1 ? (W - 2 * P) / 2 : i / (scores.length - 1) * (W - 2 * P));
  const y = s => P + (1 - s / 100) * (H - 2 * P);
  const pts = scores.map((s, i) => `${x(i).toFixed(1)},${y(s).toFixed(1)}`).join(' ');
  return `<svg class="tm-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Last ${scores.length} scores: ${scores.map(Math.round).join(', ')}">
    <line x1="0" x2="${W}" y1="${y(50)}" y2="${y(50)}" style="stroke:var(--line)" stroke-dasharray="2 3"/>
    ${scores.length > 1 ? `<polyline fill="none" style="stroke:var(--accent)" stroke-width="1.6" stroke-linejoin="round" points="${pts}"/>` : ''}
    <circle cx="${x(scores.length - 1)}" cy="${y(scores[scores.length - 1])}" r="2.6" style="fill:var(--accent)"/></svg>`;
}

// players: [{ id, name, readings: [{t, score, band, hex}] ascending, baseline? }]
function analyse(p) {
  const rs = p.readings;
  const latest = rs[rs.length - 1] || null;
  const alerts = [];
  if (latest && LOW_BANDS.includes(latest.band)) alerts.push(`Latest reading: ${latest.band.toLowerCase()}`);
  if (latest && p.baseline && latest.score < p.baseline.meanScore - p.baseline.sdScore) {
    alerts.push(`${Math.round(p.baseline.meanScore - latest.score)} points below personal baseline of ${Math.round(p.baseline.meanScore)}`);
  }
  const stale = !latest || Date.now() - latest.t > STALE_MS;
  return { ...p, latest, alerts, stale, last10: rs.slice(-10).map(r => r.score), trend: trendWord(rs.slice(-10).map(r => r.score)) };
}

function summaryStats(list) {
  const tested = list.filter(p => p.latest && !p.stale).length;
  const need = list.filter(p => p.alerts.length).length;
  return `<div class="stats">
    <div class="stat"><div class="k">Players</div><div class="v">${list.length}</div></div>
    <div class="stat"><div class="k">Tested in last 3 h</div><div class="v">${tested}</div></div>
    <div class="stat"><div class="k">Need water</div><div class="v">${need}</div></div></div>`;
}

function playerCard(p) {
  const l = p.latest;
  return `<div class="tm-player${p.alerts.length ? ' alert' : ''}">
    <div class="tm-top">
      <span class="swatch-sm" style="background:${l ? safeHex(l.hex) : 'transparent'}"></span>
      <strong class="tm-name">${esc(p.name)}</strong>
      ${l ? `<span class="tm-score">${Math.round(l.score)}</span>` : ''}
    </div>
    ${l ? `<div class="tm-band">${esc(l.band)}</div>
      <div class="tm-meta${p.stale ? ' stale' : ''}">${p.stale ? 'Stale: ' : ''}tested ${ago(l.t)} (${hhmm(l.t)})</div>
      <div class="tm-spark-row">${sparkline(p.last10)}<span class="tm-trend ${p.trend.cls}">${esc(p.trend.word)}</span></div>`
      : '<div class="tm-meta stale">No readings yet</div>'}
    ${p.alerts.map(a => `<div class="tm-alert">${esc(a)}</div>`).join('')}
  </div>`;
}

function squadBlock(list, emptyText) {
  if (!list.length) return `<p class="empty">${emptyText}</p>`;
  const sorted = list.slice().sort((a, b) =>
    (b.alerts.length > 0) - (a.alerts.length > 0) ||
    (a.latest ? a.latest.score : 999) - (b.latest ? b.latest.score : 999) ||
    a.name.localeCompare(b.name));
  const alerts = sorted.filter(p => p.alerts.length);
  return summaryStats(list)
    + (alerts.length ? `<div class="flag" style="margin-bottom:12px"><strong>Needs water now:</strong> ${alerts.map(p => esc(p.name)).join(', ')}</div>` : '<div class="ok-box" style="margin-bottom:12px">No player is currently flagged as dehydrated or below their baseline.</div>')
    + `<div class="tm-grid">${sorted.map(playerCard).join('')}</div>`;
}

const STYLE = `
.tm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}
.tm-player{border:1px solid var(--line);border-radius:12px;padding:12px;min-width:0;background:var(--surface)}
.tm-player.alert{border-color:var(--warn-line);background:var(--warn-soft)}
.tm-top{display:flex;align-items:center;gap:8px}
.tm-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tm-score{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}
.tm-band{font-size:13.5px;margin-top:2px}
.tm-meta{font-size:12.5px;color:var(--muted)}
.tm-meta.stale{color:var(--warn)}
.tm-spark-row{display:flex;align-items:center;gap:10px;margin-top:6px}
.tm-spark{flex:none;display:block}
.tm-trend{font-size:12.5px;color:var(--muted)}
.tm-trend.up{color:var(--ok)}
.tm-trend.down{color:var(--warn)}
.tm-alert{font-size:12.5px;color:var(--warn);margin-top:4px;font-weight:500}
.tm-form{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end}
.tm-form .field{flex:1 1 140px}
.tm-steps{margin:8px 0 0;padding-left:20px;font-size:14px}
.tm-steps li{margin:4px 0}
.tm-steps code{background:var(--accent-soft);padding:1px 5px;border-radius:5px;font-size:13px;word-break:break-all}
`;

export async function mount(el, ctx) {
  const st = document.createElement('style'); st.textContent = STYLE;
  el.innerHTML = `
    <div class="page-head"><h1>Team</h1><p>A squad view for coaches: who has tested recently, who is dry, and who is below their usual level.</p></div>
    <section class="card" id="tmServer" style="margin-top:22px"></section>
    <section class="card" id="tmLocal" style="margin-top:20px"></section>
    <section class="card" id="tmSetup" style="margin:20px 0"></section>`;
  el.prepend(st);
  const $ = s => el.querySelector(s);
  let alive = true, serverState = { data: null, error: null, at: null, loading: false, code: '' };
  let pollTimer = null;

  // ---------- server source ----------
  async function refreshServer() {
    const code = normalizeCode(store.settings().teamCode);
    serverState.code = code;
    if (!code) { serverState = { data: null, error: null, at: null, loading: false, code }; renderServer(); return; }
    serverState.loading = true; renderServer();
    try {
      const data = await fetchTeam(code);
      if (!alive || code !== normalizeCode(store.settings().teamCode)) return;
      serverState = { data, error: null, at: Date.now(), loading: false, code };
    } catch (e) {
      if (!alive) return;
      serverState = { ...serverState, error: e.message || String(e), loading: false };
    }
    renderServer();
  }

  function renderServer() {
    const box = $('#tmServer');
    const s = serverState;
    if (!s.code) {
      box.innerHTML = `<div class="section-title"><h2>Team server</h2><p class="sub">Not connected</p></div>
        <p class="empty" style="padding-top:0">No team code is set, so readings stay on each phone. Set a team code below to collect the whole squad on one laptop.</p>`;
      return;
    }
    const players = s.data ? s.data.players.map(p => analyse({
      id: p.id, name: String(p.name || 'Player'),
      readings: (p.readings || []).filter(r => r && typeof r.score === 'number' && typeof r.t === 'number').sort((a, b) => a.t - b.t)
    })) : [];
    const q = queueLength();
    box.innerHTML = `<div class="section-title tm-head"><h2>Team server: ${esc(s.code)}</h2>
        <p class="sub">${s.loading ? 'Refreshing...' : s.at ? `Last updated ${hhmm(s.at)}. Refreshes every 30 seconds while this page is open.` : 'Loading...'}
        ${q ? ` ${q} reading${q === 1 ? '' : 's'} from this device waiting to upload.` : ''}</p></div>
      ${s.error ? `<div class="flag" style="margin-bottom:12px"><strong>Cannot reach the team server.</strong> ${esc(s.error)}${s.data ? ' Showing the last data received.' : ''}</div>` : ''}
      ${s.data ? squadBlock(players, 'No readings have been sent to this team yet. Players need the same team code set on their own phone, then each reading they save is uploaded.') : ''}
      <div class="row" style="margin-top:12px"><button class="small" id="tmRefresh"${s.loading ? ' disabled' : ''}>Refresh now</button></div>`;
    box.querySelector('#tmRefresh').onclick = refreshServer;
  }

  // ---------- local source ----------
  async function renderLocal() {
    const box = $('#tmLocal');
    const [profiles, readings, active] = await Promise.all([store.profiles.list(), store.readings.list(), store.activeProfile()]);
    if (!alive) return;
    const teams = [...new Set(profiles.map(p => (p.team || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const hasNoTeam = profiles.some(p => !(p.team || '').trim());
    let sel = store.kv.get('hs_team_local', null);
    const valid = sel === ALL || (sel === NO_TEAM && hasNoTeam) || teams.includes(sel);
    if (!valid) sel = (active.team || '').trim() && teams.includes(active.team.trim()) ? active.team.trim() : (teams[0] || ALL);
    const members = profiles.filter(p => sel === ALL || (sel === NO_TEAM ? !(p.team || '').trim() : (p.team || '').trim() === sel));
    const byProfile = new Map();
    for (const r of readings) { if (!byProfile.has(r.profileId)) byProfile.set(r.profileId, []); byProfile.get(r.profileId).push(r); }
    const players = members.map(p => {
      const rs = byProfile.get(p.id) || [];
      return analyse({ id: p.id, name: p.name, baseline: computeBaseline(rs),
        readings: rs.map(r => ({ t: r.t, score: r.score, band: r.band, hex: r.test && r.test.hex })) });
    });
    const opts = [`<option value="${ALL}"${sel === ALL ? ' selected' : ''}>All profiles</option>`]
      .concat(teams.map(t => `<option value="${esc(t)}"${sel === t ? ' selected' : ''}>${esc(t)}</option>`))
      .concat(hasNoTeam ? [`<option value="${NO_TEAM}"${sel === NO_TEAM ? ' selected' : ''}>No team</option>`] : []);
    box.innerHTML = `<div class="section-title"><h2>On this device</h2><p class="sub">Profiles on this phone or tablet, for a shared device passed around the squad. Switch the active profile in the header before each player tests.</p></div>
      <label class="field" style="max-width:260px;margin-bottom:12px">Show team
        <select id="tmLocalSel">${opts.join('')}</select></label>
      ${squadBlock(players, sel === ALL ? 'No profiles yet.' : 'No players in this team yet. Add one in Team setup below.')}
      <p class="sub" style="margin:10px 0 0">Below-baseline alerts appear once a player has at least 3 baseline readings (flagged on the Check page).</p>`;
    box.querySelector('#tmLocalSel').onchange = e => { store.kv.set('hs_team_local', e.target.value); renderLocal(); };
  }

  // ---------- setup ----------
  function renderSetup() {
    const box = $('#tmSetup');
    const code = store.settings().teamCode || '';
    const origin = location.origin && location.origin !== 'null' ? location.origin : '';
    box.innerHTML = `<div class="section-title"><h2>Team setup</h2></div>
      <h3>Team code</h3>
      <p class="sub">Every player and the coach enter the same code. With a code set, each reading saved on this device is also sent (score, band, pH, colour and tags only, never the photo) to the team server.</p>
      <form class="tm-form" id="tmCodeForm">
        <label class="field">Team code
          <input id="tmCode" value="${esc(code)}" placeholder="e.g. u16-girls" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="40"></label>
        <button class="primary" type="submit">Save code</button>
        ${code ? '<button type="button" id="tmCodeClear">Stop syncing</button>' : ''}
      </form>
      <p class="sub" id="tmCodeMsg" style="margin:6px 0 16px">3 to 32 characters: lowercase letters, digits and hyphens.</p>

      <h3>Running the team server</h3>
      <ol class="tm-steps">
        <li>On the coach's laptop, open a terminal in the Viora folder and run <code>python server.py</code> (Python 3, nothing to install).</li>
        <li>It prints one or more addresses such as <code>http://192.168.1.20:8460/</code>. Players connect their phones to the same Wi-Fi and open that address.</li>
        <li>Everyone sets the same team code on this page. Readings appear here within 30 seconds.</li>
        <li>If a phone is offline, its readings are kept and uploaded automatically when it reconnects while the site is open.</li>
      </ol>
      <p class="sub" style="margin-top:8px">The team API only exists when the site is served by <code>server.py</code>. ${origin ? `This page is served from ${esc(origin)}.` : 'This page is not served over http, so syncing will not work.'} Phone cameras need https or localhost, so over plain Wi-Fi http players can upload a photo of the strip instead of using the live camera.</p>

      <h3 style="margin-top:18px">Add a player on this device</h3>
      <form class="tm-form" id="tmAddForm">
        <label class="field">Name<input id="tmName" required maxlength="40" autocomplete="off"></label>
        <label class="field">Team<input id="tmTeam" maxlength="40" autocomplete="off" list="tmTeamList"></label>
        <datalist id="tmTeamList"></datalist>
        <button type="submit">Add player</button>
      </form>`;
    store.profiles.list().then(ps => {
      const dl = box.querySelector('#tmTeamList'); if (!dl) return;
      dl.innerHTML = [...new Set(ps.map(p => (p.team || '').trim()).filter(Boolean))].map(t => `<option value="${esc(t)}">`).join('');
      const sel = store.kv.get('hs_team_local', null);
      if (sel && sel !== ALL && sel !== NO_TEAM) box.querySelector('#tmTeam').value = sel;
    });
    box.querySelector('#tmCodeForm').onsubmit = e => {
      e.preventDefault();
      const v = normalizeCode(box.querySelector('#tmCode').value);
      const msg = box.querySelector('#tmCodeMsg');
      if (!CODE_RE.test(v)) { msg.textContent = 'That code is not valid. Use 3 to 32 characters: lowercase letters, digits and hyphens.'; msg.style.color = 'var(--warn)'; return; }
      store.setSettings({ teamCode: v });
      ctx.toast(`Team code set to ${v}.`);
    };
    const clr = box.querySelector('#tmCodeClear');
    if (clr) clr.onclick = () => { store.setSettings({ teamCode: '' }); ctx.toast('Team sync turned off.'); };
    box.querySelector('#tmAddForm').onsubmit = async e => {
      e.preventDefault();
      const name = box.querySelector('#tmName').value.trim();
      const team = box.querySelector('#tmTeam').value.trim();
      if (!name) return;
      await store.profiles.add({ name, team });
      if (team) store.kv.set('hs_team_local', team);
      ctx.toast(`Added ${name}${team ? ' to ' + team : ''}. Choose them in the profile menu before they test.`);
      box.querySelector('#tmName').value = '';
      renderLocal();
    };
  }

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { if (document.visibilityState !== 'hidden') refreshServer(); else renderServer(); }, 30000);
  }

  let lastCode = normalizeCode(store.settings().teamCode);
  const unsub = store.on('change', ({ kind }) => {
    if (!alive) return;
    if (kind === 'settings') {
      const c = normalizeCode(store.settings().teamCode);
      if (c !== lastCode) { lastCode = c; renderSetup(); refreshServer(); }
    }
    if (kind === 'readings' || kind === 'profiles') renderLocal();
  });
  const onVis = () => { if (document.visibilityState === 'visible') refreshServer(); };
  document.addEventListener('visibilitychange', onVis);

  renderSetup();
  renderServer();
  await renderLocal();
  refreshServer();
  startPolling();
  return () => { alive = false; unsub(); clearInterval(pollTimer); document.removeEventListener('visibilitychange', onVis); };
}
