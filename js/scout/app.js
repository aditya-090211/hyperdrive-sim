// Overdrive Scout: match and pit scouting for NRL 2026 HYPERDRIVE.
// Every piece of user-supplied text is placed with textContent / attributes, never parsed as HTML.
import { Store, DEMO, friendly, uuid } from './store.js';
import { signInUrl } from '../auth-client.js';
import {
  PHASES, ACTIONS, STATION, PAYLOAD, START, MATCH_TYPES, DEFENSE, TAGS, DRIVE, MAX_COUNT, TERMS_VERSION,
  pointsOf, coresOf, cleanReport, cleanPit, summarize, matchLabel, robotKey, matchOrder,
} from './game.js';
import { analyse, ROLES } from './insights.js';

import { takeHandoff } from '../handoff.js';

// arriving from the landing page: start on its last frame and fade into the app once the first screen is drawn
const handoff = (() => {
  const img = takeHandoff('scout'); if (!img) return null;
  const el = document.createElement('div'); el.className = 'handoff'; el.setAttribute('aria-hidden', 'true'); el.style.backgroundImage = `url("${img}")`;
  document.body.append(el);
  return el;
})();
function releaseHandoff() { if (!handoff || handoff.dataset.out) return; handoff.dataset.out = '1'; requestAnimationFrame(() => handoff.classList.add('out')); setTimeout(() => handoff.remove(), 1400); }

// ------------------------------------------------------------------ tiny DOM helpers
const ICON = {
  clip: '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4.5V3.5h6v1M9 11h6M9 15h4"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  cloud: '<path d="M7 18a5 5 0 0 1-.6-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
  chev: '<path d="M6 9l6 6 6-6"/>', top: '<path d="M6 5h12M7 14l5-5 5 5M12 9v11"/>', up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>', download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>', cal: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/>', trash: '<path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>', home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>', play: '<path d="M7 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 7 5.5z"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>', flag: '<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.9"/>',
  off: '<path d="M7 18a5 5 0 0 1-1.3-9.8M9.7 6.3A6 6 0 0 1 18 9a4.5 4.5 0 0 1 2.3 8.1M17 18H7M3.5 3.5l17 17"/>',
  alert: '<path d="M12 3.5l9 16H3z"/><path d="M12 10v4.5M12 17.6v.1"/>',
};
const MARK = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M22.6 7.7A11 11 0 1 0 22.6 24.3" stroke="#f2ede3" stroke-width="2.8" fill="none" stroke-linecap="round"/><path d="M14.6 10.6l5.6 5.4-5.6 5.4" stroke="#e2531b" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat(Infinity)) { if (c == null || c === false) continue; el.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return el;
}
const icon = (name, cls = 'i') => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true'); s.innerHTML = ICON[name] || ''; return s; };
const raw = (svg) => { const t = document.createElement('template'); t.innerHTML = svg; return t.content.firstChild; };   // constant markup only
const $ = (s, r = document) => r.querySelector(s);
const fmt = (x, d = 1) => (x == null || Number.isNaN(x) ? '—' : (Math.round(x * 10 ** d) / 10 ** d).toFixed(d));
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
// "just now", "4 min ago", "2 h ago", or a time of day for anything older than today
function ago(t) {
  if (!t) return null;
  const s = (Date.now() - t) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 6 * 3600) return `${Math.round(s / 3600)} h ago`;
  return `at ${new Date(t).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;
}
const vibrate = (ms = 8) => { try { navigator.vibrate?.(ms); } catch { /* not supported */ } };
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};

// ------------------------------------------------------------------ motion (transform and opacity only)
const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
// count a number up (or down) to its new value
function countTo(el, to, { ms = 500, fmtFn = (v) => String(Math.round(v)), from = null } = {}) {
  const start = from ?? (parseFloat(el.textContent) || 0);
  el.dataset.v = String(to);
  if (calm() || start === to || !Number.isFinite(start)) { el.textContent = fmtFn(to); return; }
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmtFn(start + (to - start) * e);
    if (k < 1 && el.dataset.v === String(to)) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
// a value that rolls in from below (up) or above (down), like an odometer
function roll(el, dir) {
  if (calm() || !el.animate) return;
  el.animate([{ transform: `translateY(${dir > 0 ? 18 : -18}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 240, easing: EASE_OUT });
}
// a small "+5" that floats off the tally
function floatChip(anchor, text) {
  if (calm() || !anchor.animate) return;
  const c = h('span', { class: 'float-chip', text, 'aria-hidden': 'true' });
  anchor.append(c);
  c.animate([{ transform: 'translateY(6px)', opacity: 0 }, { transform: 'translateY(-4px)', opacity: 1, offset: 0.3 }, { transform: 'translateY(-18px)', opacity: 0 }], { duration: 760, easing: EASE_OUT }).onfinish = () => c.remove();
}

let toastTimer = 0;
function toast(msg, ms = 2200) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// segmented control: options [{v,label}]
function seg(options, value, onPick, { cls = '', label } = {}) {
  const box = h('div', { class: `seg thumb ${cls}`, role: 'group', 'aria-label': label });
  const place = (i) => { box.style.setProperty('--i', String(Math.max(0, i))); box.style.setProperty('--on', i < 0 ? '0' : '1'); };
  box.style.setProperty('--n', String(options.length));
  place(options.findIndex((o) => o.v === value));
  options.forEach((o, i) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(o.v === value), text: o.label });
    b.addEventListener('click', () => { for (const x of box.querySelectorAll('button')) x.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-pressed', 'true'); place(i); vibrate(5); onPick(o.v); });
    box.append(b);
  });
  return box;
}
function toggle(label, checked, onChange, sub) {
  const input = h('input', { type: 'checkbox', checked: !!checked, onchange: (e) => { vibrate(5); onChange(e.target.checked); } });
  return h('label', { class: 'switch glass' }, h('span', { class: 'sw-l' }, h('b', { text: label }), sub ? h('small', { text: sub }) : null), input, h('span', { class: 'track', 'aria-hidden': 'true' }));
}
function field(labelText, input, help) {
  const id = `f${Math.random().toString(36).slice(2, 8)}`;
  input.id = id;
  return h('div', { class: 'fld' }, h('label', { class: 'lab', for: id, text: labelText }), h('div', { class: 'field' }, input), help ? h('p', { class: 'help', text: help }) : null);
}
function sheet(title, sub, build, { wide = false } = {}) {
  const prev = document.activeElement;
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    document.removeEventListener('keydown', onKey); prev?.focus?.();
    if (calm()) { scrim.remove(); return; }
    scrim.classList.add('closing'); setTimeout(() => scrim.remove(), 280);
  };
  const onKey = (e) => { if (e.key === 'Escape' && [...document.querySelectorAll('.scrim:not(.closing)')].pop() === scrim) close(); };
  const body = h('div', { class: 'sheet-body' });
  const box = h('div', { class: `sheet${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('button', { class: 'b b-ghost sm icon sheet-x', type: 'button', 'aria-label': 'Close', onclick: () => close() }, icon('x')),
    h('h2', { text: title }), sub ? h('p', { class: 'sub', text: sub }) : null, body);
  const scrim = h('div', { class: 'scrim', onclick: (e) => { if (e.target === scrim) close(); } }, box);
  document.body.append(scrim); document.addEventListener('keydown', onKey);
  build(body, close);
  setTimeout(() => (box.querySelector('input, select, textarea') || box.querySelector('.sheet-x'))?.focus(), 30);
  return close;
}
function confirmSheet(title, text, okLabel, danger, onOk, typeToConfirm) {
  sheet(title, text, (body, close) => {
    const input = typeToConfirm ? h('input', { autocomplete: 'off', autocapitalize: 'characters', placeholder: typeToConfirm, 'aria-label': `Type ${typeToConfirm} to confirm` }) : null;
    const err = h('p', { class: 'err', role: 'alert' });
    const ok = h('button', { class: `b ${danger ? 'b-danger' : 'b-primary'}`, type: 'button', text: okLabel });
    ok.addEventListener('click', async () => {
      if (input && input.value.trim().toUpperCase() !== typeToConfirm) { err.textContent = `Type ${typeToConfirm} to confirm.`; return; }
      ok.disabled = true; err.textContent = '';
      try { await onOk(); close(); } catch (e) { err.textContent = friendly(e); ok.disabled = false; }
    });
    body.append(input ? h('div', { class: 'field' }, input) : '', err, h('div', { class: 'row' }, h('button', { class: 'b b-glass', type: 'button', text: 'Cancel', onclick: close }), ok));
  });
}
function csvDownload(name, rows) {
  const esc = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;                       // keep spreadsheets from running formulas
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: name.replace(/[^\w.-]+/g, '_') }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function spark(series, w = 120, hgt = 32) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`); svg.setAttribute('class', 'spark'); svg.setAttribute('aria-hidden', 'true');
  if (!series.length) return svg;
  const max = Math.max(10, ...series.map((s) => s.p));
  const pts = series.map((s, i) => [series.length === 1 ? w / 2 : (i / (series.length - 1)) * (w - 4) + 2, hgt - 3 - (s.p / max) * (hgt - 6)]);
  const line = document.createElementNS(NS, 'polyline'); line.setAttribute('points', pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')); svg.append(line);
  const last = pts[pts.length - 1], dot = document.createElementNS(NS, 'circle'); dot.setAttribute('cx', last[0].toFixed(1)); dot.setAttribute('cy', last[1].toFixed(1)); dot.setAttribute('r', '2.6'); svg.append(dot);
  return svg;
}

// ------------------------------------------------------------------ state
const store = new Store();
if (DEMO) window.__scoutStore = store;   // localhost demo only: tools/scout-offline.cjs drives the sync through it
const S = {
  session: null, user: null, consent: null, mem: null, events: [], eventId: null, reports: [], pits: [], admin: false,
  view: ls.get('od.scout.view', 'scout'), sort: 'avg', search: '', loading: true, adminTeam: null,
  syncedAt: null,          // when this event's reports last came from the server (not the phone's copy)
  ovGated: false, ovPreview: false,
  ovSource: ls.get('od.scout.ovsource', 'all') === 'ours' ? 'ours' : 'all',   // 009: our scouts only, or every team's
  pool: null,              // every team's reports at this competition (team 009 / staff only)
};
const DRAFT_KEY = 'od.scout.draft';
const blankForm = (keep = {}) => ({ id: null, event_id: null, match_type: keep.match_type || 'qm', match_number: keep.match_number || 1, robot_number: '', alliance: keep.alliance || 'red', station: keep.station || 1, phase: 'm', data: { tags: [] } });
function validForm(f) {
  if (!f || typeof f !== 'object' || !f.data || typeof f.data !== 'object' || Array.isArray(f.data)) return null;
  if (!MATCH_TYPES.some((m) => m.v === f.match_type) || !Number.isInteger(f.match_number) || f.match_number < 1 || f.match_number > 999) return null;
  if (!['red', 'blue'].includes(f.alliance) || ![1, 2].includes(f.station) || !PHASES.some((x) => x.id === f.phase)) return null;
  if (typeof f.robot_number !== 'string' || !/^[0-9]{0,6}$/.test(f.robot_number)) return null;
  f.data = { tags: [], ...cleanReport(f.data) }; delete f.data.v;
  if (f.id != null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(f.id))) return null;
  for (const [k, v] of Object.entries(f.data)) if (/^(m|l)_|^(minor|major|driver|speed|defense)$/.test(k) && !(Number.isInteger(v) && v >= 0 && v <= MAX_COUNT)) delete f.data[k];
  if (f.resume && !validForm(f.resume)) f.resume = null;
  return f;
}
let form = validForm(ls.get(DRAFT_KEY, null)) || blankForm();
const saveDraft = () => { if (!form.event_id && S.eventId) form.event_id = S.eventId; ls.set(DRAFT_KEY, form); };
const PIT_KEY = 'od.scout.pitdraft';
const validPit = (f) => (f && typeof f === 'object' && typeof f.robot_number === 'string' && /^[0-9]{0,6}$/.test(f.robot_number) && f.data && typeof f.data === 'object' && !Array.isArray(f.data) ? f : null);
let pitForm = validPit(ls.get(PIT_KEY, null)) || { robot_number: '', data: {} };
const savePit = () => ls.set(PIT_KEY, pitForm);

const app = $('#app');
// on scout.overdrive009.in the rest of the site is on the main domain
const SITE = /^scout\./.test(location.hostname) ? 'https://overdrive009.in' : '';
$('#topbar .brand').href = `${SITE}/`;
// the old address keeps Scout running only so copies installed there can finish syncing, then sends people on
const MOVED = location.hostname === 'hyperdrive-sim.vercel.app';
const isLead = () => ['owner', 'lead'].includes(S.mem?.role);
// the event overview and pick advice are Overdrive's own: only shown to members of team 009
const is009 = () => robotKey(S.mem?.team?.number) === '9';
const lsDel = (k) => { try { localStorage.removeItem(k); } catch { /* storage blocked */ } };
const isConn = (e) => /connection|offline|fetch|timed out/i.test(e?.message || '');
const memberName = (uid, list = S.mem?.members) => list?.find((m) => m.user_id === uid)?.display_name || (uid ? 'Teammate' : 'Former member');
const currentEvent = () => S.events.find((e) => e.id === S.eventId) || null;

// ------------------------------------------------------------------ boot and auth gates
async function boot() {
  if (!store.available) { renderFatal('Overdrive Scout could not load its sign-in service. Check your connection and reload.'); return; }
  try { await store.init(); } catch { renderFatal('This browser blocked Scout from saving on the device (private mode or storage turned off). Scout needs it to work offline.'); return; }
  store.on(renderSync);
  // a report that has left the queue is on the server: drop its "waiting to sync" mark
  store.on(() => {
    const q = new Set(store.pending().filter((x) => x.kind === 'report' || x.kind === 'pit').map((x) => x.row.id));
    for (const r of S.reports) if (r.pending && !q.has(r.id)) { r.pending = false; r.created_on_server = true; }
    for (const p of S.pits) if (p.pending && !q.has(p.id)) p.pending = false;
    for (const e of S.events) if (e.local && !store.pendingOf('event').some((x) => x.row.id === e.id)) delete e.local;
    // the overview waits for this phone's reports to reach the server: open it the moment they have
    if (S.view === 'overview' && S.ovGated && !store.syncing && S.mem && !store.pending(S.mem.team.id).length && !document.querySelector('.scrim')) {
      S.ovGated = false; lastPull = Date.now();
      loadEventData().catch(() => {}).finally(() => { if (S.view === 'overview' && !document.querySelector('.scrim')) renderView(); });
    }
  });
  // a dropped network never signs anyone out: supabase-js keeps the session when a refresh fails for want of a
  // connection, and Scout opens from the saved session while offline. Only a real sign-out (or a refused refresh) does.
  store.api.onAuth((s) => {
    if (s) store.setSession(s);
    if ((s?.user?.id || null) !== (S.user?.id || null)) { S.session = s; S.user = s?.user || null; route(); }
    else if (s && store.authStale) { store.authStale = false; store.flush({ retry: true }); }
  });
  try { S.session = await store.api.session(); } catch { S.session = null; }
  store.setSession(S.session);
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type !== 'od-scout-synced') return;
    store.reload().then(() => { loadEventDataCached(); afterPull(true, false); }).catch(() => {});
  });
  S.user = S.session?.user || null;
  // strip the OAuth code from the address bar once the session is in
  const p = new URLSearchParams(location.search);
  if (p.has('code') || p.has('error') || p.has('error_description')) {
    if (p.get('error') || p.get('error_description')) toast('Sign-in did not complete. Please try again.', 5000);
    for (const k of ['code', 'error', 'error_code', 'error_description', 'state']) p.delete(k);
    history.replaceState(null, '', location.pathname + (p.toString() ? `?${p}` : ''));
  }
  try { localStorage.removeItem('od.authReturn'); } catch { /* ignore */ }
  route();
}

let routeSeq = 0;
async function route() {
  const seq = ++routeSeq, stale = () => seq !== routeSeq;
  S.loading = true;
  document.body.dataset.stage = 'loading';
  store.setUser(S.user?.id);
  if (!S.user) {
    if (DEMO) return renderSignIn();
    if (!store.online) return renderOffline();          // the sign-in page needs a connection; say so instead of a browser error
    location.replace(signInUrl('/scout')); return;
  }
  const uid = S.user.id;
  // offline first: a phone that has opened Scout before opens straight from its own copy, then checks the server
  const known = store.cacheGet(`mem.${uid}`);
  if (known && store.cacheGet(`consent.${uid}`) === TERMS_VERSION) {
    S.mem = known; S.consent = { terms_version: TERMS_VERSION }; S.admin = !!store.cacheGet(`admin.${uid}`);
    store.setTeam(S.mem.team.id);
    loadEventsCached();
    S.loading = false;
    renderShell();
    revalidate(seq).catch(() => {});
    return;
  }
  try {
    S.consent = await store.api.consent(uid);
    if (stale()) return;
    if (!S.consent || S.consent.terms_version !== TERMS_VERSION) return renderConsent();
    store.cacheSet(`consent.${uid}`, S.consent.terms_version);
    S.mem = await store.api.membership(uid);
    if (stale()) return;
    store.cacheSet(`mem.${uid}`, S.mem);
  } catch (e) {
    if (stale()) return;
    if (known && isConn(e)) { S.mem = known; S.consent = { cached: true }; }
    else return isConn(e) ? renderOffline(true) : renderFatal(friendly(e), true);
  }
  if (!S.mem) { store.setTeam(null); return renderTeamSetup(); }
  store.setTeam(S.mem.team.id);
  try { S.admin = !!(await store.api.isAdmin()); store.cacheSet(`admin.${uid}`, S.admin); } catch { S.admin = !!store.cacheGet(`admin.${uid}`); }
  if (stale()) return;
  await loadEvents();
  if (stale()) return;
  S.loading = false;
  renderShell();
  store.flush().catch(() => {});
}
// behind an offline-first open: confirm the account, team and events with the server and quietly bring them up to date
async function revalidate(seq) {
  const uid = S.user.id, stale = () => seq !== routeSeq;
  let consent, mem;
  try { consent = await store.api.consent(uid); } catch { return; }               // no connection: the phone's copy stands
  if (stale()) return;
  if (!consent || consent.terms_version !== TERMS_VERSION) { store.cacheSet(`consent.${uid}`, null); route(); return; }
  try { mem = await store.api.membership(uid); } catch { return; }
  if (stale()) return;
  if (!mem) { forgetTeam(); route(); return; }
  S.mem = mem; store.cacheSet(`mem.${uid}`, mem); store.setTeam(mem.team.id);
  try { S.admin = !!(await store.api.isAdmin()); store.cacheSet(`admin.${uid}`, S.admin); } catch { /* keep the last answer */ }
  if (stale()) return;
  const before = S.eventId;
  const fresh = await loadEvents();
  if (stale()) return;
  lastPull = Date.now();
  afterPull(fresh, S.eventId !== before);
  store.flush().catch(() => {});
}
function forgetTeam() { if (S.user) store.cacheSet(`mem.${S.user.id}`, null); S.mem = null; store.setTeam(null); }

// events made on this phone with no signal wait in the queue; they are listed (and filed to) like any other
const localEvents = (tid) => store.pendingOf('event', tid).map((q) => ({ ...q.row, created_at: new Date(q.at).toISOString(), local: true }));
function chooseEvent(tid) {
  const saved = ls.get(`od.scout.event.${tid}`, null);
  S.eventId = S.events.some((e) => e.id === saved) ? saved : S.events[0]?.id || null;
}
function loadEventsCached() {
  const tid = S.mem.team.id;
  S.events = [...localEvents(tid), ...(store.cacheGet(`events.${tid}`) || [])];
  chooseEvent(tid);
  loadEventDataCached();
}
async function loadEvents() {
  const tid = S.mem.team.id;
  try { const server = await store.api.events(tid); store.cacheSet(`events.${tid}`, server); S.events = [...localEvents(tid), ...server]; }
  catch { S.events = [...localEvents(tid), ...(store.cacheGet(`events.${tid}`) || [])]; }
  chooseEvent(tid);
  return loadEventData();
}
function loadEventDataCached() {
  S.reports = []; S.pits = []; S.syncedAt = null;
  if (!S.eventId) return;
  const c = store.cacheGet(`ev.${S.eventId}`);
  if (c) { S.reports = c.reports || []; S.pits = c.pits || []; S.syncedAt = c.at || null; }
  mergePending();
}
async function loadEventData() {
  if (!S.eventId) { S.reports = []; S.pits = []; S.syncedAt = null; return false; }
  const id = S.eventId;
  if (!S.events.find((e) => e.id === id)?.local) {
    try {
      const [reports, pits, picks] = await Promise.all([store.api.reports(id), store.api.pits(id), store.api.picks(id).catch(() => undefined)]);
      if (S.eventId !== id) return false;                 // they switched events while this loaded
      S.reports = reports; S.pits = pits; S.syncedAt = Date.now();
      store.cacheSet(`ev.${id}`, { reports, pits, at: S.syncedAt });
      if (picks !== undefined && !store.pendingOf('picks').some((q) => q.row.event_id === id)) store.cacheSet(`picks.${id}`, picks ? { data: picks.data, updated_at: picks.updated_at } : null);
      mergePending();
      return true;
    } catch { /* no connection: the phone's copy below */ }
  }
  if (S.eventId === id) loadEventDataCached();
  return false;
}
// what is still waiting on this phone counts too: new and edited reports, pit reports, and deletions
function mergePending() {
  const tid = S.mem.team.id;
  const gone = new Set(store.pendingOf('del', tid).map((q) => q.row.id));
  if (gone.size) S.reports = S.reports.filter((r) => !gone.has(r.id));
  for (const q of store.pending(tid)) {
    if (q.row.event_id !== S.eventId) continue;
    if (q.kind === 'report') {
      const i = S.reports.findIndex((r) => r.id === q.row.id);
      const row = { ...q.row, scout_id: i >= 0 ? S.reports[i].scout_id : S.user.id, points: pointsOf(q.row.data), pending: true, created_on_server: i >= 0, created_at: i >= 0 ? S.reports[i].created_at : new Date(q.at).toISOString() };
      if (i >= 0) S.reports[i] = row; else S.reports.push(row);
    } else if (q.kind === 'pit') {
      const i = S.pits.findIndex((p) => robotKey(p.robot_number) === robotKey(q.row.robot_number));
      if (i >= 0) S.pits[i] = { ...S.pits[i], data: q.row.data, pending: true }; else S.pits.push({ ...q.row, scout_id: S.user.id, pending: true });
    }
  }
}
function stage(name, ...kids) {
  document.body.dataset.stage = name;
  app.replaceChildren(...kids);
  releaseHandoff();
  $('#topbar').hidden = name !== 'app'; $('#tabbar').hidden = name !== 'app';
  window.scrollTo(0, 0);
}
function renderFatal(msg, canRetry) {
  stage('gate', h('section', { class: 'gate' }, h('div', { class: 'gate-card card strong' },
    h('div', { class: 'gate-mark' }, raw(MARK)), h('h1', { text: 'Something went wrong' }), h('p', { class: 'sub', text: msg }),
    h('div', { class: 'row' }, canRetry ? h('button', { class: 'b b-primary', type: 'button', text: 'Try again', onclick: () => route() }) : null,
      S.user ? h('button', { class: 'b b-glass', type: 'button', text: 'Sign out', onclick: () => signOut() }) : null))));
}

function renderOffline(signedIn) {
  stage('gate', h('section', { class: 'gate' }, h('div', { class: 'gate-card card strong' },
    h('div', { class: 'gate-mark' }, raw(MARK)), h('p', { class: 'eyebrow', text: 'No connection' }),
    h('h1', { text: 'You’re offline' }),
    h('p', { class: 'sub', text: signedIn
      ? 'Scout needs a connection once on this phone to load your team. After that it opens and works with no signal at all.'
      : 'Signing in needs a connection. Once you have signed in on this phone, Scout opens and works with no signal at all.' }),
    h('div', { class: 'row start' }, h('button', { class: 'b b-primary', type: 'button', onclick: () => route() }, icon('refresh'), h('span', { text: 'Try again' }))))));
}
window.addEventListener('online', () => { if (document.body.dataset.stage === 'gate' && !S.mem) route(); });

function renderSignIn(note) {
  const btn = h('button', { class: 'b b-primary lg block', type: 'button' }, h('span', { text: 'Sign in with email' }));
  const err = h('p', { class: 'err', role: 'alert', text: note || '' });
  btn.addEventListener('click', async () => {
    btn.disabled = true; err.textContent = '';
    try { await store.api.signIn(); } catch (e) { err.textContent = friendly(e); btn.disabled = false; }
  });
  stage('gate', h('section', { class: 'gate' },
    h('div', { class: 'gate-intro' },
      h('p', { class: 'eyebrow', text: 'Overdrive 009 · NRL 2026' }),
      h('h1', {}, 'Overdrive ', h('em', { text: 'Scout' })),
      h('p', { class: 'lede', text: 'Match and pit scouting for HYPERDRIVE. Count every scoring action with one thumb, keep working when the Wi-Fi drops, and rank teams the moment reports sync.' })),
    h('div', { class: 'gate-card card strong' },
      h('div', { class: 'gate-mark' }, raw(MARK)),
      h('h2', { text: 'Sign in to scout' }),
      h('p', { class: 'sub', text: 'One Overdrive account for Scout and the simulator: your email and a password.' }),
      btn, err,
      h('p', { class: 'fine' }, 'Signing in is required. By continuing you agree to the ', h('a', { href: '/terms', target: '_blank', rel: 'noopener', text: 'Terms' }), ' and ', h('a', { href: '/privacy', target: '_blank', rel: 'noopener', text: 'Privacy Policy' }), '.'),
      DEMO ? h('p', { class: 'fine demo', text: 'Local demo mode: sign-in is simulated and nothing leaves this browser.' }) : null),
    h('nav', { class: 'gate-links' }, h('a', { href: `${SITE}/`, text: 'Overdrive home' }), h('a', { href: `${SITE}/sim`, text: 'Simulator' }), h('a', { href: '/privacy', text: 'Privacy' }), h('a', { href: '/terms', text: 'Terms' }))));
}

function renderConsent() {
  const box = h('input', { type: 'checkbox', id: 'agree' });
  const go = h('button', { class: 'b b-primary lg block', type: 'button', text: 'Continue', disabled: true });
  const err = h('p', { class: 'err', role: 'alert' });
  box.addEventListener('change', () => { go.disabled = !box.checked; });
  go.addEventListener('click', async () => {
    go.disabled = true; err.textContent = '';
    try { await store.api.acceptTerms(); route(); } catch (e) { err.textContent = friendly(e); go.disabled = false; }
  });
  const name = S.user.user_metadata?.full_name || S.user.email || 'there';
  stage('gate', h('section', { class: 'gate' }, h('div', { class: 'gate-card card strong' },
    h('div', { class: 'gate-mark' }, raw(MARK)),
    h('p', { class: 'eyebrow', text: 'One more step' }),
    h('h1', { text: `Welcome, ${String(name).split(' ')[0]}` }),
    h('p', { class: 'sub', text: 'Before you scout, please read and accept the Terms of Use and the Privacy Policy. They explain what Overdrive Scout stores, who can see your team’s scouting reports and how the data is used.' }),
    h('div', { class: 'doc-links' },
      h('a', { class: 'b b-glass', href: '/terms', target: '_blank', rel: 'noopener' }, 'Terms of Use'),
      h('a', { class: 'b b-glass', href: '/privacy', target: '_blank', rel: 'noopener' }, 'Privacy Policy')),
    h('label', { class: 'agree', for: 'agree' }, box, h('span', { text: 'I have read and agree to the Terms of Use and the Privacy Policy.' })),
    go, err,
    h('button', { class: 'b b-ghost sm', type: 'button', text: 'Sign out', onclick: () => signOut() }))));
}

function renderTeamSetup() {
  const defName = String(S.user.user_metadata?.full_name || S.user.user_metadata?.name || '').trim().slice(0, 40);
  const mk = (title, sub, fields, label, run) => {
    const err = h('p', { class: 'err', role: 'alert' });
    const go = h('button', { class: 'b b-primary block', type: 'submit', text: label });
    const f = h('form', { class: 'card setup', novalidate: true }, h('h2', { text: title }), h('p', { class: 'sub', text: sub }), ...fields, go, err);
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); go.disabled = true; err.textContent = '';
      try { await run(); toast(label === 'Register team' ? 'Team registered' : 'Joined the team'); route(); } catch (x) { err.textContent = friendly(x); go.disabled = false; }
    });
    return f;
  };
  const code = h('input', { maxlength: 12, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'ABCD2345', inputmode: 'text' });
  const n1 = h('input', { maxlength: 40, autocomplete: 'name', value: defName, placeholder: 'Your name' });
  const num = h('input', { maxlength: 6, inputmode: 'numeric', pattern: '[0-9]*', placeholder: '009', autocomplete: 'off' });
  const tname = h('input', { maxlength: 48, placeholder: 'Overdrive', autocomplete: 'organization' });
  const n2 = h('input', { maxlength: 40, autocomplete: 'name', value: defName, placeholder: 'Your name' });
  const need = (v, msg) => { if (!v) throw new Error(msg); return v; };
  stage('gate', h('section', { class: 'gate setup-wrap' },
    h('div', { class: 'setup-head' }, h('div', { class: 'gate-mark' }, raw(MARK)), h('p', { class: 'eyebrow', text: 'Your team' }), h('h1', { text: 'Join or register your team' }),
      h('p', { class: 'sub', text: 'Scouts on the same team see each other’s reports. A lead can find the join code on the Team tab.' })),
    h('div', { class: 'setup-grid' },
      mk('Join a team', 'Enter the 8-character code from your team lead.', [field('Join code', code), field('Your name', n1, 'Shown to your teammates.')], 'Join team',
        () => store.api.joinTeam(need(code.value.replace(/[^a-z0-9]/gi, '').toUpperCase(), 'Enter the join code.'), need(n1.value.trim(), 'Enter your name.'))),
      mk('Register your team', 'First from your team here? Register it and invite the others.', [field('Team number', num), field('Team name', tname), field('Your name', n2)], 'Register team',
        () => {
          const v = num.value.trim(); if (!/^[0-9]{1,6}$/.test(v)) throw new Error('Team numbers are 1 to 6 digits.');
          return store.api.createTeam(v, need(tname.value.trim(), 'Enter your team name.'), need(n2.value.trim(), 'Enter your name.'));
        })),
    h('button', { class: 'b b-ghost sm', type: 'button', text: 'Sign out', onclick: () => signOut() })));
}

function signOut() {
  const waiting = store.pending().length;
  if (!waiting) return doSignOut();
  confirmSheet('Sign out with entries not synced?', `${waiting} entr${waiting === 1 ? 'y has' : 'ies have'} not reached the server yet. They stay locked to your account on this phone and upload the next time you sign in here. Everything else Scout keeps on this phone is deleted.`,
    'Sign out anyway', true, () => doSignOut());
}
async function doSignOut() {
  try { await store.api.signOut(); } catch { /* signed out on this phone anyway */ }
  await store.clearLocal(); form = blankForm(); pitForm = { robot_number: '', data: {} };
  S.user = null; S.session = null; S.mem = null; S.reports = []; S.pits = []; S.events = []; S.adminTeam = null; S.pool = null;
  route();
}

// ------------------------------------------------------------------ the app shell
const TABS = [
  { id: 'scout', label: 'Scout', icon: 'clip' }, { id: 'pit', label: 'Pit', icon: 'wrench' }, { id: 'data', label: 'Data', icon: 'chart' },
  { id: 'picks', label: 'Picks', icon: 'list' }, { id: 'team', label: 'Team', icon: 'users' },
];
const OVERVIEW_TAB = { id: 'overview', label: 'Overview', icon: 'target' };
function currentTabs() {
  const tabs = [...TABS];
  if (is009()) tabs.splice(3, 0, OVERVIEW_TAB);
  if (S.admin) tabs.push({ id: 'admin', label: is009() ? 'League' : 'Admin', icon: 'shield' });
  return tabs;
}
function renderTopbar() {
  const ev = currentEvent();
  $('#tb-team').textContent = `${S.mem.team.number}`;
  $('#tb-team-name').textContent = S.mem.team.name;
  $('#tb-event').textContent = ev ? ev.name : 'No event';
  $('#tb-avatar').textContent = initials(S.mem.displayName || S.user.email || '?');
  renderSync();
}
function renderShell() {
  const tabs = currentTabs();
  if (!tabs.some((t) => t.id === S.view)) S.view = 'scout';
  const bar = $('#tabbar');
  if (bar.dataset.tabs !== tabs.map((t) => t.id).join()) {
    bar.dataset.tabs = tabs.map((t) => t.id).join(); bar.replaceChildren(h('i', { class: 'tab-ind', 'aria-hidden': 'true' }));
    for (const t of tabs) bar.append(h('button', { type: 'button', class: 'tab', 'data-tab': t.id, onclick: () => go(t.id) }, icon(t.icon), h('span', { text: t.label })));
  }
  const idx = tabs.findIndex((t) => t.id === S.view);
  for (const b of bar.querySelectorAll('.tab')) { if (b.dataset.tab === S.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  bar.style.setProperty('--n', String(tabs.length)); bar.style.setProperty('--i', String(idx));
  renderTopbar();
  const arriving = document.body.dataset.stage !== 'app';
  renderView();
  if (arriving) window.scrollTo(0, 0);
  document.body.dataset.stage = 'app'; $('#topbar').hidden = false; $('#tabbar').hidden = false;
  releaseHandoff();
}
const graphemes = (w) => (typeof Intl !== 'undefined' && Intl.Segmenter ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(w)].map((x) => x.segment) : [...w]);
const initials = (n) => String(n).trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => { const g = graphemes(w)[0] || ''; return g.length === 1 ? g.toUpperCase() : g; }).join('') || '?';
let lastTab = 0;
function go(view) {
  const order = currentTabs().map((t) => t.id), next = order.indexOf(view);
  app.dataset.dir = next >= lastTab ? 'fwd' : 'back'; lastTab = next;
  if (view === 'overview' && S.view !== 'overview') { S.ovPreview = false; lastPull = 0; pull().catch(() => {}); }   // fetch teammates' latest first
  S.view = view; ls.set('od.scout.view', view); renderShell(); window.scrollTo(0, 0);
}
const SYNC_LABEL = { offline: 'Offline', syncing: 'Syncing', synced: 'Synced', attention: 'Needs attention' };
function renderSync() {
  const el = $('#tb-sync'); if (!el || !S.mem) return;
  const st = store.status();
  el.dataset.state = st.state;
  el.querySelector('svg').innerHTML = ICON[st.state === 'offline' ? 'off' : st.state === 'attention' ? 'alert' : 'cloud'];
  $('#tb-sync-l').textContent = SYNC_LABEL[st.state];
  $('#tb-sync-n').textContent = st.unsynced ? String(st.unsynced) : '';
  const n = (k) => `${k} entr${k === 1 ? 'y' : 'ies'}`;
  el.title = st.state === 'attention' ? (st.auth ? 'Sign in again to upload what is waiting' : `${n(st.stuck)} need${st.stuck === 1 ? 's' : ''} you. Tap to review.`)
    : st.state === 'offline' ? (st.unsynced ? `Offline · ${n(st.unsynced)} saved on this phone, will sync` : 'Offline · everything you filed has synced')
      : st.state === 'syncing' ? `Syncing ${n(st.unsynced)}` : 'Everything you filed has synced';
  el.setAttribute('aria-label', `Sync status: ${el.title}`);
  for (const s of document.querySelectorAll('[data-stamp]')) s.textContent = stampText();
}
// how fresh the numbers on screen are
function stampText() {
  const when = ago(S.syncedAt);
  if (!store.online) return when ? `Offline · last synced ${when}` : 'Offline · not synced on this phone yet';
  if (S.events.find((e) => e.id === S.eventId)?.local) return 'New event · syncs when the connection is back';
  return when ? `Synced ${when}` : 'Syncing…';
}
function syncStamp() {
  const b = h('button', { class: 'stamp', type: 'button', 'aria-label': 'Refresh from the server' }, h('i', { class: 'dot', 'aria-hidden': 'true' }), h('span', { 'data-stamp': '', text: stampText() }), icon('refresh'));
  b.addEventListener('click', async () => {
    b.classList.add('busy');
    await store.flush().catch(() => {});
    const fresh = await loadEventData();
    b.classList.remove('busy');
    if (!['scout', 'pit'].includes(S.view)) renderView(); else renderSync();
    toast(fresh ? 'Up to date' : 'Offline: showing the last data you synced');
  });
  return b;
}
setInterval(() => { for (const s of document.querySelectorAll('[data-stamp]')) s.textContent = stampText(); }, 30000);
function renderView() {
  const v = { scout: viewScout, pit: viewPit, data: viewData, picks: viewPicks, team: viewTeam, admin: viewAdmin, overview: viewOverview }[S.view] || viewScout;
  app.replaceChildren(...(MOVED ? [movedNote()] : []), v());
}
function movedNote() {
  const left = store.status().unsynced;
  return h('div', { class: 'card strong moved', role: 'note' },
    h('p', {}, h('b', { text: 'Scout has moved to scout.overdrive009.in. ' }),
      left ? `Keep this page open until the ${left} entr${left === 1 ? 'y' : 'ies'} waiting here have synced, then switch.` : 'Everything here has synced. Open it there and sign in once more.'),
    h('a', { class: 'b b-od sm', href: 'https://scout.overdrive009.in/', text: 'Open the new address' }));
}

function noEvent() {
  return h('div', { class: 'empty card' }, h('div', { class: 'empty-ico' }, icon('cal')), h('h2', { text: 'Create your first event' }),
    h('p', { class: 'sub', text: 'Reports are grouped by event. Add the competition you are scouting at.' }),
    h('button', { class: 'b b-primary', type: 'button', text: 'New event', onclick: () => eventSheet() }));
}

// ------------------------------------------------------------------ match scouting
function viewScout() {
  if (!S.eventId) return h('section', { class: 'view' }, noEvent());
  const d = form.data;
  const pts = h('b', { class: 'tally-n', text: d.noshow ? '0' : String(pointsOf(d)) });
  const coreWord = (n) => `${n} core${n === 1 ? '' : 's'}`;
  const cores = h('span', { class: 'tally-c', text: d.noshow ? 'No show' : coreWord(coresOf(d)) });
  let view = null;
  const refreshTally = () => {
    const ns = !!form.data.noshow;
    countTo(pts, ns ? 0 : pointsOf(form.data), { ms: 420 }); cores.textContent = ns ? 'No show' : coreWord(coresOf(form.data));
    view?.classList.toggle('is-noshow', ns); saveDraft();
  };

  const robot = h('input', { inputmode: 'numeric', pattern: '[0-9]*', maxlength: 6, placeholder: 'e.g. 1002', value: form.robot_number, autocomplete: 'off', 'aria-describedby': 'robot-err' });
  robot.addEventListener('input', () => { robot.value = robot.value.replace(/\D/g, '').slice(0, 6); form.robot_number = robot.value; saveDraft(); title.textContent = headline(); });
  const matchNum = h('input', { inputmode: 'numeric', pattern: '[0-9]*', maxlength: 3, value: String(form.match_number), 'aria-label': 'Match number', class: 'num-in' });
  matchNum.addEventListener('input', () => { matchNum.value = matchNum.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 3); form.match_number = Math.max(1, Math.min(999, parseInt(matchNum.value, 10) || 1)); saveDraft(); title.textContent = headline(); });
  matchNum.addEventListener('blur', () => { matchNum.value = String(form.match_number); });
  const bumpMatch = (dv) => { form.match_number = Math.max(1, Math.min(999, form.match_number + dv)); matchNum.value = String(form.match_number); saveDraft(); title.textContent = headline(); };
  const headline = () => `${matchLabel(form.match_type, form.match_number)} · ${form.robot_number || 'Robot ?'} · ${form.alliance === 'red' ? 'Red' : 'Blue'} ${form.station}`;
  const title = h('span', { class: 'tally-t', text: headline() });

  // whose robot this is on the field: Red/Blue + station 1/2
  const allianceSeg = seg([{ v: 'red', label: 'Red' }, { v: 'blue', label: 'Blue' }], form.alliance, (v) => {
    form.alliance = v; document.body.dataset.alliance = v;
    allianceSeg.classList.toggle('red', v === 'red'); allianceSeg.classList.toggle('blue', v === 'blue');
    saveDraft(); title.textContent = headline();
  }, { cls: form.alliance, label: 'Alliance' });
  const setup = h('div', { class: 'card setup-card' },
    h('div', { class: 'grid2' },
      h('div', { class: 'fld' }, h('span', { class: 'lab', text: 'Match' }), seg(MATCH_TYPES, form.match_type, (v) => { form.match_type = v; saveDraft(); title.textContent = headline(); }, { label: 'Match type' }),
        h('div', { class: 'num-step glass' }, h('button', { type: 'button', class: 'b b-ghost icon', 'aria-label': 'Previous match', onclick: () => bumpMatch(-1) }, icon('minus')), matchNum, h('button', { type: 'button', class: 'b b-ghost icon', 'aria-label': 'Next match', onclick: () => bumpMatch(1) }, icon('plus')))),
      h('div', { class: 'fld' }, field('Robot (team number)', robot), h('p', { class: 'err', id: 'robot-err', role: 'alert' }))),
    h('div', { class: 'grid2' },
      h('div', { class: 'fld' }, h('span', { class: 'lab', text: 'Alliance' }), allianceSeg),
      h('div', { class: 'fld' }, h('span', { class: 'lab', text: 'Station' }), seg([{ v: 1, label: '1' }, { v: 2, label: '2' }], form.station, (v) => { form.station = v; saveDraft(); title.textContent = headline(); }, { label: 'Station' }))),
    h('div', { class: 'grid2' },
      h('div', { class: 'fld' }, h('span', { class: 'lab', text: 'Starting position' }), seg(START, d.start ?? null, (v) => { form.data.start = v; saveDraft(); }, { label: 'Starting position' })),
      h('div', { class: 'fld fld-sw' }, toggle('No show', d.noshow, (v) => { form.data.noshow = v; refreshTally(); }, 'Robot never took the field'))));
  document.body.dataset.alliance = form.alliance;

  const counters = h('div', { class: 'counters' });
  const drawCounters = () => {
    counters.replaceChildren();
    for (const a of ACTIONS[form.phase]) {
      const key = `${form.phase}_${a.k}`;
      const val = h('span', { class: 'val', text: String(form.data[key] || 0) });
      const step = h('div', { class: `stepper ${a.tone || ''}` });
      const set = (dv) => {
        const nv = Math.max(0, Math.min(MAX_COUNT, (form.data[key] || 0) + dv));
        if (nv === (form.data[key] || 0)) return;
        const before = pointsOf(form.data);
        form.data[key] = nv; val.textContent = String(nv); roll(val, dv); refreshTally(); vibrate(dv > 0 ? 10 : 4);
        const gained = pointsOf(form.data) - before;
        if (gained > 0 && !form.data.noshow) floatChip(pts.parentElement, `+${gained}`);
        step.classList.remove('bump'); void step.offsetWidth; step.classList.add('bump');
      };
      step.append(
        h('button', { type: 'button', class: 'dec', 'aria-label': `Remove one ${a.label}`, onclick: () => set(-1) }, icon('minus')),
        h('div', { class: 'mid' }, h('b', { text: a.label }), h('small', { text: a.pts ? `+${a.pts} · ${a.sub}` : a.sub })),
        h('button', { type: 'button', class: 'inc', 'aria-label': `Add one ${a.label}`, onclick: () => set(1) }, val));
      counters.append(step);
    }
  };
  drawCounters();
  const phaseSeg = seg(PHASES.map((p) => ({ v: p.id, label: p.label })), form.phase, (v) => { form.phase = v; saveDraft(); drawCounters(); }, { cls: 'phase', label: 'Match phase' });

  // a compact submit in the tally: always in view, but up here, away from the counters the thumb is tapping
  const quick = h('button', { class: 'b b-od sm tally-go', type: 'button', 'aria-label': form.id ? 'Save changes' : 'Submit report' }, icon('check'), h('span', { text: form.id ? 'Save' : 'Submit' }));
  const tally = h('div', { class: 'live' }, h('div', { class: 'tally' }, h('div', { class: 'tally-l' }, title, cores), h('div', { class: 'tally-r' }, pts, h('small', { text: 'pts' })), quick), phaseSeg);

  const fouls = h('div', { class: 'counters two' });
  for (const [k, label, sub] of [['minor', 'Minor foul', '+3 to opponents'], ['major', 'Major foul', '+15 to opponents']]) {
    const val = h('span', { class: 'val', text: String(d[k] || 0) });
    const set = (dv) => { const nv = Math.max(0, Math.min(MAX_COUNT, (form.data[k] || 0) + dv)); if (nv === (form.data[k] || 0)) return; form.data[k] = nv; val.textContent = String(nv); roll(val, dv); saveDraft(); vibrate(6); };
    fouls.append(h('div', { class: 'stepper bad' }, h('button', { type: 'button', class: 'dec', 'aria-label': `Remove one ${label}`, onclick: () => set(-1) }, icon('minus')),
      h('div', { class: 'mid' }, h('b', { text: label }), h('small', { text: sub })), h('button', { type: 'button', class: 'inc', 'aria-label': `Add one ${label}`, onclick: () => set(1) }, val)));
  }

  const rate = (label, key, max = 5) => {
    const box = h('div', { class: 'rate', role: 'group', 'aria-label': label });
    for (let i = 1; i <= max; i++) {
      const b = h('button', { type: 'button', 'aria-pressed': String(form.data[key] === i), text: String(i) });
      b.addEventListener('click', () => { const nv = form.data[key] === i ? 0 : i; form.data[key] = nv; for (const [j, x] of [...box.children].entries()) x.setAttribute('aria-pressed', String(nv === j + 1)); saveDraft(); vibrate(5); });
      box.append(b);
    }
    return h('div', { class: 'fld' }, h('span', { class: 'lab', text: label }), box);
  };
  const tags = h('div', { class: 'chips', role: 'group', 'aria-label': 'Tags' });
  for (const t of TAGS) {
    const on = (form.data.tags || []).includes(t.v);
    const c = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(on), text: t.label });
    c.addEventListener('click', () => {
      const list = new Set(form.data.tags || []);
      if (list.has(t.v)) list.delete(t.v); else list.add(t.v);
      form.data.tags = [...list]; c.setAttribute('aria-pressed', String(list.has(t.v))); saveDraft(); vibrate(5);
    });
    tags.append(c);
  }
  const note = h('textarea', { maxlength: 500, rows: 3, placeholder: 'What should the drive team know? Cycles, breakdowns, defence…', value: d.note || '' });
  const noteCount = h('span', { class: 'suf', text: `${(d.note || '').length}/500` });
  note.addEventListener('input', () => { form.data.note = note.value.slice(0, 500); noteCount.textContent = `${note.value.length}/500`; saveDraft(); });

  const submit = h('button', { class: 'b b-od lg block', type: 'button' }, icon('check'), h('span', { text: form.id ? 'Save changes' : 'Submit report' }));
  submit.addEventListener('click', () => submitReport(robot, submit));
  quick.addEventListener('click', () => submitReport(robot, quick));
  const reset = h('button', { class: 'b b-ghost', type: 'button', text: form.id ? 'Cancel editing' : 'Clear form', onclick: () => confirmSheet(form.id ? 'Discard your changes?' : 'Clear this report?', form.id ? 'The saved report stays as it was.' : 'Everything you have entered for this robot will be lost.', form.id ? 'Discard' : 'Clear', true, async () => { form = form.resume || blankForm(form); saveDraft(); renderView(); }) });

  view = h('section', { class: `view scout-view${d.noshow ? ' is-noshow' : ''}` },
    h('div', { class: 'view-head' }, h('div', {}, h('p', { class: 'eyebrow', text: formEventNote() }), h('h1', { text: form.id ? 'Edit report' : 'Scout a match' })),
      h('button', { class: 'b b-glass sm', type: 'button', onclick: () => myReportsSheet() }, icon('list'), h('span', { text: 'My reports' }))),
    setup, tally,
    h('p', { class: 'help', text: 'Tap the number to add one, the minus to undo.' }),
    counters,
    h('div', { class: 'card' },
      h('div', { class: 'grid2' },
        h('div', { class: 'fld' }, h('span', { class: 'lab', text: 'Team Payload' }), seg(PAYLOAD, d.payload || 'none', (v) => { form.data.payload = v; saveDraft(); }, { label: 'Payload' })),
        h('div', { class: 'fld fld-sw' }, toggle('Helped trigger STARBURST', d.starburst, (v) => { form.data.starburst = v; saveDraft(); }))),
      h('div', { class: 'fld' }, h('span', { class: 'lab', text: 'End game · Space Station' }), seg(STATION.map((s) => ({ v: s.v, label: s.label })), d.station || 'none', (v) => { form.data.station = v; refreshTally(); }, { cls: 'station', label: 'Space Station' }))),
    h('h3', { class: 'sec-t', text: 'Fouls' }), fouls,
    h('div', { class: 'card' },
      h('div', { class: 'grid2' }, rate('Driver skill', 'driver'), rate('Speed', 'speed')),
      h('div', { class: 'fld' }, h('span', { class: 'lab', text: 'Defence played' }), seg(DEFENSE, d.defense || 0, (v) => { form.data.defense = v; saveDraft(); }, { label: 'Defence' })),
      h('div', { class: 'grid2' }, toggle('Broke down', d.died, (v) => { form.data.died = v; saveDraft(); }, 'Stopped moving for part of the match'), toggle('Tipped over', d.tipped, (v) => { form.data.tipped = v; saveDraft(); })),
      h('div', { class: 'fld' }, h('span', { class: 'lab', text: 'Tags' }), tags),
      h('div', { class: 'fld' }, h('label', { class: 'lab', text: 'Notes' }), h('div', { class: 'field' }, note, noteCount))),
    h('div', { class: 'submit-bar' }, reset, submit));
  return view;
}

// a form nothing has been typed into follows the event you switch to (a half-filled one stays where it started)
function retargetBlankForm() {
  const touched = form.id || form.robot_number || Object.entries(form.data || {}).some(([k, v]) => k !== 'tags' && v) || form.data?.tags?.length;
  if (!touched && S.eventId && form.event_id !== S.eventId) { form.event_id = S.eventId; ls.set(DRAFT_KEY, form); }
}
function formEventNote() {
  const ev = S.events.find((e) => e.id === form.event_id), cur = currentEvent();
  if (ev && cur && ev.id !== cur.id) return `Filing to ${ev.name} (started there)`;
  return cur?.name || '';
}
function submitReport(robotInput, btn, force = false) {
  const err = $('#robot-err');
  if (!/^[0-9]{1,6}$/.test(form.robot_number)) { err.textContent = 'Enter the robot’s team number.'; robotInput.focus(); robotInput.scrollIntoView({ block: 'center', behavior: 'smooth' }); vibrate(30); return; }
  err.textContent = '';
  const eventId = form.event_id && S.events.some((e) => e.id === form.event_id) ? form.event_id : S.eventId;
  // the same robot in the same match already filed (by anyone on the team): replace it or keep both
  const same = (r) => r.id !== form.id && r.event_id === eventId && r.match_type === form.match_type && r.match_number === form.match_number;
  const dup = !force && S.reports.find((r) => same(r) && robotKey(r.robot_number) === robotKey(form.robot_number));
  // the same alliance station already filed for this match with a different robot: probably a typo
  const slot = !force && !dup && S.reports.find((r) => same(r) && r.alliance === form.alliance && r.station === form.station && robotKey(r.robot_number) !== robotKey(form.robot_number));
  const unseen = !force && !dup && !slot && S.reports.length >= 6 && !S.reports.some((r) => r.event_id === eventId && robotKey(r.robot_number) === robotKey(form.robot_number)) && !S.pits.some((p) => robotKey(p.robot_number) === robotKey(form.robot_number));
  const go = () => submitReport(robotInput, btn, true);
  if (dup) {
    const canReplace = !form.id && (dup.scout_id === S.user.id || isLead());
    sheet('Already scouted', `${matchLabel(dup.match_type, dup.match_number)}, robot ${dup.robot_number} was filed by ${memberName(dup.scout_id)}.${canReplace ? ' Replace that report with this one, or keep both?' : ' Keep both reports?'}`, (body, close) => {
      body.append(h('div', { class: 'row' },
        h('button', { class: 'b b-glass', type: 'button', text: canReplace ? 'Keep both' : 'Go back', onclick: () => { close(); if (canReplace) go(); } }),
        canReplace ? h('button', { class: 'b b-primary', type: 'button', text: 'Replace', onclick: () => { close(); form.id = dup.id; form.replaced = true; go(); } })
          : h('button', { class: 'b b-primary', type: 'button', text: 'Keep both', onclick: () => { close(); go(); } })));
    });
    return;
  }
  if (slot || unseen) {
    const msg = slot ? `${form.alliance === 'red' ? 'Red' : 'Blue'} ${form.station} in ${matchLabel(slot.match_type, slot.match_number)} was already filed as robot ${slot.robot_number} by ${memberName(slot.scout_id)}. Is ${form.robot_number} right?`
      : `Nobody has scouted ${form.robot_number} at this event yet. Check the number before filing.`;
    sheet('Check the robot number', msg, (body, close) => {
      body.append(h('div', { class: 'row' },
        h('button', { class: 'b b-glass', type: 'button', text: 'Fix it', onclick: () => { close(); robotInput.focus(); robotInput.select?.(); } }),
        h('button', { class: 'b b-primary', type: 'button', text: `File as ${form.robot_number}`, onclick: () => { close(); go(); } })));
    });
    return;
  }
  btn.disabled = true;
  const row = {
    id: form.id || uuid(), team_id: S.mem.team.id, event_id: eventId, match_type: form.match_type, match_number: form.match_number,
    robot_number: form.robot_number, alliance: form.alliance, station: form.station, data: cleanReport(form.data),
  };
  const existing = S.reports.findIndex((r) => r.id === row.id);
  const local = { ...row, scout_id: S.user.id, points: pointsOf(row.data), pending: true, created_at: new Date().toISOString() };
  if (row.event_id !== S.eventId) { if (existing >= 0) S.reports.splice(existing, 1); }
  else if (existing >= 0) S.reports[existing] = { ...S.reports[existing], ...local, scout_id: S.reports[existing].scout_id || local.scout_id, created_on_server: !S.reports[existing].pending || S.reports[existing].created_on_server }; else S.reports.push(local);
  store.enqueue('report', row).then((res) => { const r = S.reports.find((x) => x.id === row.id); if (r && res.synced) r.pending = false; }).catch((e) => toast(`Not saved: ${friendly(e)} Open Sync to review it.`, 5000));
  toast(`${form.id && !form.replaced ? 'Updated' : !store.online ? 'Saved on this phone, will sync' : 'Saved'} · ${matchLabel(row.match_type, row.match_number)} · ${row.robot_number}`);
  vibrate([12, 40, 12]);
  const was = form;
  if (was.resume) form = was.resume;                     // back to the match the scout was on before editing
  else { form = blankForm(was); if (!was.id || was.replaced) form.match_number = Math.min(999, was.match_number + 1); }
  saveDraft();
  renderView(); window.scrollTo({ top: 0, behavior: 'smooth' });
}

function myReportsSheet() {
  const mine = S.reports.filter((r) => r.scout_id === S.user.id || isLead()).sort((a, b) => (b.scout_id === S.user.id) - (a.scout_id === S.user.id) || b.match_number - a.match_number || String(a.robot_number).localeCompare(b.robot_number));
  sheet('Reports at this event', isLead() ? 'Leads can edit or delete any report.' : 'Edit or delete the reports you filed.', (body, close) => {
    if (!mine.length) { body.append(h('p', { class: 'muted', text: 'Nothing filed yet.' })); return; }
    const list = h('div', { class: 'rlist' });
    const q = h('input', { type: 'search', placeholder: 'Filter by robot, match or scout', 'aria-label': 'Filter reports' });
    if (mine.length > 8) body.append(h('div', { class: 'field', style: 'margin-bottom:12px' }, icon('search'), q));
    q.addEventListener('input', () => { const t = q.value.trim().toLowerCase(); for (const el of list.children) el.hidden = !!t && !el.dataset.k.includes(t); });
    for (const r of mine) {
      list.append(h('div', { class: 'ritem', 'data-k': `${r.robot_number} ${matchLabel(r.match_type, r.match_number)} ${memberName(r.scout_id)}`.toLowerCase() },
        h('div', { class: `rdot ${r.alliance}` }),
        h('div', { class: 'rmain' }, h('b', { text: `${matchLabel(r.match_type, r.match_number)} · ${r.robot_number}` }), h('small', { text: `${r.alliance === 'red' ? 'Red' : 'Blue'} ${r.station} · ${memberName(r.scout_id)}${r.pending ? ' · waiting to sync' : ''}` })),
        h('span', { class: 'rpts', text: `${r.data?.noshow ? 'No show' : `${pointsOf(r.data)} pts`}` }),
        h('button', { class: 'b b-ghost sm icon', type: 'button', 'aria-label': 'Edit report', onclick: () => { close(); editReport(r); } }, icon('edit')),
        h('button', { class: 'b b-ghost sm icon', type: 'button', 'aria-label': 'Delete report', onclick: () => confirmSheet('Delete this report?', `${matchLabel(r.match_type, r.match_number)}, robot ${r.robot_number}. This cannot be undone.`, 'Delete', true, async () => {
          // never on the server (made on this phone and not yet sent): forget it; otherwise the deletion is queued
          const queued = store.pendingOf('report').find((x) => x.row.id === r.id);
          const onlyLocal = !!r.pending && !r.created_on_server && !queued?.attempted;
          if (onlyLocal) store.dropWhere((x) => x.kind === 'report' && x.row.id === r.id);
          else store.enqueue('del', { id: r.id, team_id: S.mem.team.id, event_id: r.event_id }).catch((e) => toast(`Not deleted: ${friendly(e)} Open Sync to review it.`, 5000));
          S.reports = S.reports.filter((x) => x.id !== r.id); close(); toast(onlyLocal || store.online ? 'Report deleted' : 'Deleted on this phone · syncs when you are back online'); renderView();
        }) }, icon('trash'))));
    }
    body.append(list);
  }, { wide: true });
}
function editReport(r) {
  const resume = form.id ? form.resume : form;          // whatever the scout was filling in comes back afterwards
  form = { resume, event_id: r.event_id, id: r.id, match_type: r.match_type, match_number: r.match_number, robot_number: r.robot_number, alliance: r.alliance, station: r.station, phase: 'm', data: { tags: [], ...structuredClone(r.data || {}) } };
  saveDraft(); go('scout');
}

// ------------------------------------------------------------------ pit scouting
function viewPit() {
  if (!S.eventId) return h('section', { class: 'view' }, noEvent());
  const d = pitForm.data;
  const robot = h('input', { inputmode: 'numeric', pattern: '[0-9]*', maxlength: 6, placeholder: 'e.g. 1002', value: pitForm.robot_number, autocomplete: 'off' });
  robot.addEventListener('change', () => {
    // load a robot's saved pit report only once the number is complete, and only into a form that came from a load
    const existing = S.pits.find((p) => robotKey(p.robot_number) === robotKey(robot.value));
    if (existing && (pitForm.loaded || !Object.keys(pitForm.data).length)) { pitForm = { robot_number: existing.robot_number, data: structuredClone(existing.data || {}), loaded: true }; savePit(); renderView(); }
    else if (pitForm.loaded && !existing) { pitForm = { robot_number: robot.value, data: {} }; savePit(); renderView(); }
    else if (existing && existing.scout_id !== S.user.id && !isLead()) { err.textContent = `${memberName(existing.scout_id)} filed the pit report for ${existing.robot_number}. Only they or a team lead can change it; add what you saw to a match report note instead.`; }
    else if (existing) toast(`${existing.robot_number} already has a pit report. Saving adds your answers to it.`, 3600);
  });
  robot.addEventListener('input', () => { robot.value = robot.value.replace(/\D/g, '').slice(0, 6); pitForm.robot_number = robot.value; savePit(); });
  const motors = h('input', { inputmode: 'numeric', maxlength: 2, value: d.motors ?? '', placeholder: '4' });
  motors.addEventListener('input', () => { motors.value = motors.value.replace(/\D/g, '').slice(0, 2); const v = parseInt(motors.value, 10); pitForm.data.motors = Number.isInteger(v) ? Math.min(16, v) : undefined; savePit(); });
  const err = h('p', { class: 'err', role: 'alert' });
  const weight = h('input', { inputmode: 'decimal', maxlength: 5, value: d.weight ?? '', placeholder: '3.2' });
  weight.addEventListener('input', () => { weight.value = weight.value.replace(/[^\d.]/g, '').slice(0, 5); const v = parseFloat(weight.value); pitForm.data.weight = Number.isFinite(v) && v <= 20 ? v : undefined; err.textContent = Number.isFinite(v) && v > 20 ? 'Weight looks too high: robots are at most 20 kg.' : ''; savePit(); });
  const ta = (key, ph) => { const t = h('textarea', { maxlength: 500, rows: 3, placeholder: ph, value: d[key] || '' }); t.addEventListener('input', () => { pitForm.data[key] = t.value.slice(0, 500); savePit(); }); return t; };
  const save = h('button', { class: 'b b-od lg block', type: 'button' }, icon('check'), h('span', { text: 'Save pit report' }));
  save.addEventListener('click', () => {
    if (!/^[0-9]{1,6}$/.test(pitForm.robot_number)) { err.textContent = 'Enter the robot’s team number.'; robot.focus(); return; }
    err.textContent = '';
    const existing = S.pits.find((p) => robotKey(p.robot_number) === robotKey(pitForm.robot_number));
    if (existing && existing.scout_id !== S.user.id && !isLead()) { err.textContent = `${memberName(existing.scout_id)} filed this pit report. Only they or a team lead can change it.`; return; }
    // a fresh form for a robot that already has a report fills in, rather than replaces, what was there
    const fresh = Object.fromEntries(Object.entries(pitForm.data).filter(([, v]) => v !== undefined && v !== ''));
    const data = existing && !pitForm.loaded ? cleanPit({ ...(existing.data || {}), ...fresh }) : cleanPit(pitForm.data);
    const row = { id: existing?.id || uuid(), team_id: S.mem.team.id, event_id: S.eventId, robot_number: existing?.robot_number || pitForm.robot_number, data };
    if (existing) { existing.data = row.data; existing.pending = true; } else S.pits.push({ ...row, scout_id: S.user.id, pending: true });
    store.enqueue('pit', row).catch((e) => toast(`Not saved: ${friendly(e)}`, 5000));
    toast(`Pit report saved${store.online ? "" : " on this phone, will sync"} · ${row.robot_number}`); vibrate([12, 40, 12]);
    pitForm = { robot_number: '', data: {} }; savePit(); renderView();
  });
  const sw = (k, label) => toggle(label, d[k], (v) => { pitForm.data[k] = v; savePit(); });
  const longForm = (n) => [n, ...S.reports.filter((r) => robotKey(r.robot_number) === robotKey(n)).map((r) => String(r.robot_number))].sort((a, b) => b.length - a.length)[0];
  const done = [...S.pits].sort((a, b) => parseInt(a.robot_number, 10) - parseInt(b.robot_number, 10));
  return h('section', { class: 'view' },
    h('div', { class: 'view-head' }, h('div', {}, h('p', { class: 'eyebrow', text: currentEvent()?.name || '' }), h('h1', { text: 'Pit scouting' }))),
    h('div', { class: 'card' },
      field('Robot (team number)', robot, 'Type a number, or pick a robot below to edit its report.'),
      h('div', { class: 'fld' }, h('span', { class: 'lab', text: 'Drivetrain' }), seg(DRIVE, d.drive || null, (v) => { pitForm.data.drive = v; savePit(); }, { label: 'Drivetrain' })),
      h('div', { class: 'grid2' }, field('Drive motors', motors), field('Weight (kg)', weight))),
    h('h3', { class: 'sec-t', text: 'What it can do' }),
    h('div', { class: 'grid2 sw-grid' }, sw('high', 'Scores HIGH poles'), sw('star', 'Scores STAR poles'), sw('apex', 'Reaches APEX poles'), sw('golden', 'Handles GOLDEN COREs'), sw('payload', 'Carries the Payload')),
    h('div', { class: 'card' },
      h('div', { class: 'fld' }, h('span', { class: 'lab', text: 'Best Space Station result' }), seg(STATION.map((s) => ({ v: s.v, label: s.label })), d.station || null, (v) => { pitForm.data.station = v; savePit(); }, { cls: 'station', label: 'Best station result' })),
      h('div', { class: 'fld' }, h('label', { class: 'lab', text: 'Strategy they described' }), h('div', { class: 'field' }, ta('strategy', 'Where they score, what they want from partners…'))),
      h('div', { class: 'fld' }, h('label', { class: 'lab', text: 'Notes' }), h('div', { class: 'field' }, ta('note', 'Build quality, spares, anything else…')))),
    err, h('div', { class: 'submit-bar one' }, save),
    done.length ? h('div', { class: 'card' }, h('h3', { class: 'card-t', text: `Pit reports (${done.length})` }), h('div', { class: 'chips' },
      done.map((p) => h('button', { type: 'button', class: 'chip', text: longForm(p.robot_number), onclick: () => { pitForm = { robot_number: p.robot_number, data: structuredClone(p.data || {}), loaded: true }; savePit(); renderView(); window.scrollTo({ top: 0, behavior: 'smooth' }); } })))) : null);
}

// ------------------------------------------------------------------ analysis
const SORTS = [
  { v: 'avg', label: 'Avg points' }, { v: 'max', label: 'Best match' }, { v: 'cores', label: 'Cores / match' }, { v: 'lvl', label: 'Level Up pts' },
  { v: 'balance', label: 'Balance rate' }, { v: 'acc', label: 'Accuracy' }, { v: 'driver', label: 'Driver skill' }, { v: 'died', label: 'Reliability' },
];
const sortLabel = () => ({ avg: 'avg pts', max: 'best', cores: 'cores', lvl: 'lvl up', balance: 'balance', acc: 'accuracy', driver: 'driver', died: 'reliable' }[S.sort] || 'avg pts');
const sortVal = (r) => ({ max: String(r.max), cores: fmt(r.cores), lvl: fmt(r.lvl), balance: pct(r.balance), acc: pct(r.acc), driver: r.driver == null ? '—' : fmt(r.driver), died: pct(1 - r.died) }[S.sort] ?? fmt(r.avg));
function rankingsBlock(allReports, pits, { title, sub, exportName, members = S.mem.members }) {
  const hasPractice = allReports.some((r) => r.match_type === 'pr');
  const reports = S.withPractice ? allReports : allReports.filter((r) => r.match_type !== 'pr');
  let rows = summarize(reports);
  const key = S.sort;
  rows.sort((a, b) => (key === 'died' ? a.died - b.died : (b[key] ?? -1) - (a[key] ?? -1)) || b.avg - a.avg);
  const search = h('input', { type: 'search', placeholder: 'Team #', value: S.search, inputmode: 'numeric', 'aria-label': 'Find a team number' });
  const listBox = h('div', { class: 'rank-list' });
  const draw = () => {
    const q = S.search.trim();
    const shown = q ? rows.filter((r) => r.robot.includes(q)) : rows;
    listBox.replaceChildren();
    if (!shown.length) { listBox.append(h('p', { class: 'muted pad', text: reports.length ? 'No team matches that number.' : 'No reports yet. They appear here as soon as your scouts submit them.' })); return; }
    const metric = (r) => (S.sort === 'died' ? 1 - r.died : S.sort === 'driver' ? r.driver || 0 : r[S.sort] ?? r.avg) || 0;
    const top = Math.max(1e-9, ...rows.map(metric));
    shown.forEach((r, n) => {
      const rank = rows.indexOf(r) + 1;
      listBox.append(h('button', { type: 'button', class: 'rank glass', onclick: () => robotSheet(r.robot, reports, pits, members) },
        h('span', { class: 'rk', text: String(rank) }),
        h('span', { class: 'rt' }, h('b', { text: r.robot }), h('small', { text: `${r.n} match${r.n === 1 ? '' : 'es'}${r.noshows ? ` · ${r.noshows} no show` : ''}${pits.some((p) => robotKey(p.robot_number) === robotKey(r.robot)) ? ' · pit ✓' : ''}` })),
        h('span', { class: 'rbar', 'aria-hidden': 'true' }, h('i', { style: `--w:${(metric(r) / top).toFixed(3)}; --d:${Math.min(n, 14) * 40}ms` })),
        h('span', { class: 'rs' }, h('b', { text: sortVal(r) }), h('small', { text: sortLabel() })),
        h('span', { class: 'rs hide-s' }, h('b', { text: fmt(r.cores) }), h('small', { text: 'cores' })),
        h('span', { class: 'rs hide-s' }, h('b', { text: pct(r.balance) }), h('small', { text: 'balance' })),
        h('span', { class: 'rs hide-s' }, h('b', { text: r.driver == null ? '—' : fmt(r.driver) }), h('small', { text: 'driver' })),
        spark(r.series)));
    });
  };
  search.addEventListener('input', () => { S.search = search.value.replace(/\D/g, ''); search.value = S.search; draw(); });
  draw();
  const sortSel = h('select', { 'aria-label': 'Sort by', onchange: (e) => { S.sort = e.target.value; renderView(); } }, SORTS.map((s) => h('option', { value: s.v, text: s.label, selected: s.v === S.sort })));
  const exportBtn = h('button', { class: 'b b-glass sm', type: 'button', onclick: () => exportCsv(reports, exportName, members) }, icon('download'), h('span', { text: 'CSV' }));
  return h('div', {},
    h('div', { class: 'view-head' }, h('div', {}, h('p', { class: 'eyebrow', text: sub || '' }), h('h1', { text: title })), exportBtn),
    h('div', { class: 'stat-row' },
      [[reports.length, 'reports'], [rows.length, 'robots'], [new Set(reports.map((r) => `${r.match_type}${r.match_number}`)).size, 'matches'], [pits.length, 'pit reports']].map(([n, l], i) => {
        const b = h('b', { text: '0' }); setTimeout(() => countTo(b, n, { ms: 700, from: 0 }), 120 + i * 80);
        return h('div', { class: 'tile' }, b, h('span', { text: l }));
      })),
    h('div', { class: 'tools' }, h('div', { class: 'field grow' }, icon('search'), search), h('div', { class: 'field sel' }, sortSel, icon('chev', 'i chev'))),
    hasPractice ? toggle('Include practice matches', !!S.withPractice, (v) => { S.withPractice = v; renderView(); }) : null,
    listBox);
}
function exportCsv(reports, name, members = S.mem.members) {
  if (!reports.length) { toast('Nothing to export yet'); return; }
  const keys = ['m_high', 'm_star', 'm_drop', 'm_gstar', 'm_gdrop', 'm_miss', 'l_apex', 'l_high', 'l_star', 'l_drop', 'l_gstar', 'l_gdrop', 'l_miss', 'payload', 'starburst', 'station', 'minor', 'major', 'driver', 'speed', 'defense', 'noshow', 'died', 'tipped', 'start'];
  const rows = [['match_type', 'match', 'robot', 'alliance', 'station', 'points', ...keys, 'tags', 'note', 'scout', 'filed']];
  for (const r of [...reports].sort((a, b) => a.match_number - b.match_number)) {
    const d = r.data || {};
    rows.push([r.match_type, r.match_number, r.robot_number, r.alliance, r.station, d.noshow ? 0 : (r.points ?? pointsOf(d)), ...keys.map((k) => d[k] ?? ''), (d.tags || []).join(' '), d.note || '', memberName(r.scout_id, members), r.created_at || '']);
  }
  csvDownload(`${name || 'overdrive-scout'}.csv`, rows);
}
function robotSheet(robot, reports, pits, members = S.mem.members) {
  const mine = reports.filter((r) => robotKey(r.robot_number) === robotKey(robot)).sort(matchOrder);
  const sum = summarize(mine)[0];
  const pit = pits.find((p) => robotKey(p.robot_number) === robotKey(robot));
  sheet(`Team ${robot}`, `${sum?.played || 0} matches scouted`, (body) => {
    if (sum) body.append(h('div', { class: 'stat-row' },
      h('div', { class: 'tile' }, h('b', { text: fmt(sum.avg) }), h('span', { text: 'avg points' })),
      h('div', { class: 'tile' }, h('b', { text: String(sum.max) }), h('span', { text: 'best match' })),
      h('div', { class: 'tile' }, h('b', { text: pct(sum.acc) }), h('span', { text: 'accuracy' })),
      h('div', { class: 'tile' }, h('b', { text: pct(1 - sum.died) }), h('span', { text: 'reliability' }))),
    h('div', { class: 'big-spark glass' }, spark(sum.series, 320, 80)),
    teamDetail(mine, sum));
    if (pit) {
      const p = pit.data || {};
      const caps = [['high', 'HIGH'], ['star', 'STAR'], ['apex', 'APEX'], ['golden', 'Golden'], ['payload', 'Payload']].filter(([k]) => p[k]).map(([, l]) => l);
      body.append(h('div', { class: 'card pit-sum' }, h('h3', { class: 'card-t', text: 'Pit report' }),
        h('p', {}, [p.drive && `${DRIVE.find((x) => x.v === p.drive)?.label} drive`, p.motors != null && `${p.motors} motors`, p.weight != null && `${p.weight} kg`].filter(Boolean).join(' · ') || 'No drivetrain details'),
        caps.length ? h('div', { class: 'chips' }, caps.map((c) => h('span', { class: 'chip static', text: c }))) : null,
        p.strategy ? h('p', { class: 'quote', text: p.strategy }) : null, p.note ? h('p', { class: 'quote', text: p.note }) : null));
    }
    const list = h('div', { class: 'rlist' });
    for (const r of mine) {
      const d = r.data || {};
      list.append(h('div', { class: 'ritem col' },
        h('div', { class: 'rrow' }, h('div', { class: `rdot ${r.alliance}` }), h('b', { text: matchLabel(r.match_type, r.match_number) }),
          h('span', { class: 'muted', text: d.noshow ? 'No show' : `${coresOf(d)} cores · ${STATION.find((s) => s.v === (d.station || 'none')).label}${d.died ? ' · broke down' : ''}` }),
          h('span', { class: 'rpts', text: d.noshow ? '0' : `${pointsOf(d)} pts` })),
        d.note ? h('p', { class: 'quote', text: d.note }) : null,
        h('small', { class: 'muted', text: `Scouted by ${scoutLabel(r, members)}` })));
    }
    body.append(h('h3', { class: 'card-t', text: 'Matches' }), list);
    if (S.view !== 'admin') body.append(h('div', { class: 'row' }, h('button', { class: 'b b-glass', type: 'button', onclick: () => { addPick(robot); toast(`${robot} added to your pick list`); } }, icon('star'), h('span', { text: 'Add to pick list' }))));
  }, { wide: true });
}
// everything the scouts recorded about one robot, beyond the headline numbers
function teamDetail(list, sum) {
  const played = list.filter((r) => !r.data?.noshow);
  const avgOf = (f) => (played.length ? played.reduce((a, r) => a + (f(r.data || {}) || 0), 0) / played.length : null);
  const share = (f) => (played.length ? played.filter((r) => f(r.data || {})).length / played.length : null);
  const tagCount = new Map();
  for (const r of played) for (const t of r.data?.tags || []) tagCount.set(t, (tagCount.get(t) || 0) + 1);
  const starts = new Map(); for (const r of played) if (r.data?.start) starts.set(r.data.start, (starts.get(r.data.start) || 0) + 1);
  const rows = [
    ['Match period', `${fmt(Math.max(0, sum.avg - sum.lvl - sum.station))} pts`], ['Level Up', `${fmt(sum.lvl)} pts`], ['Space Station', `${fmt(sum.station)} pts`],
    ['Consistency', `± ${fmt(sum.sd)} pts`], ['Docked or balanced', pct(sum.dock)], ['Defence played', `${fmt(sum.defense)} / 3`], ['Speed', sum.speed == null ? '—' : `${fmt(sum.speed)} / 5`],
    ['Fouls given away', `${fmt(sum.fouls)} pts a match`], ['Helped STARBURST', pct(share((d) => d.starburst))],
    ['Tipped over', String(played.filter((r) => r.data?.tipped).length)], ['No shows', String(list.length - played.length)],
  ];
  return h('div', { class: 'card detail' },
    h('dl', { class: 'kv' }, rows.map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', { text: v })))),
    starts.size ? h('p', { class: 'muted', text: `Starts: ${[...starts].map(([k, n]) => `${START.find((x) => x.v === k)?.label || k} ×${n}`).join(' · ')}` }) : null,
    tagCount.size ? h('div', { class: 'chips' }, [...tagCount].sort((a, b) => b[1] - a[1]).map(([t, n]) => h('span', { class: 'chip static', text: `${TAGS.find((x) => x.v === t)?.label || t} ×${n}` }))) : null);
}
function viewData() {
  if (!S.eventId) return h('section', { class: 'view' }, noEvent());
  const ev = currentEvent();
  const block = rankingsBlock(S.reports, S.pits, { title: 'Team rankings', sub: ev?.name, exportName: `${S.mem.team.number}-${ev?.name || 'event'}` });
  block.querySelector('.view-head')?.after(syncStamp());
  return h('section', { class: 'view' }, block);
}

// ------------------------------------------------------------------ event overview (Overdrive 009 only)
function viewOverview() {
  if (!is009()) { S.view = 'scout'; return viewScout(); }           // never drawn for any other team
  if (!S.eventId) return h('section', { class: 'view' }, noEvent());
  const ev = currentEvent(), tid = S.mem.team.id;
  const head = h('div', { class: 'view-head' }, h('div', {}, h('p', { class: 'eyebrow', text: `Overdrive 009 only · ${ev?.name || ''}` }), h('h1', { text: 'Event overview' })));
  const wrap = h('section', { class: 'view ov' }, head, syncStamp());
  // team 009 reads every team's scouting: pool the reports every team filed at this same competition
  const pooled = S.admin && S.ovSource === 'all';
  if (S.admin) {
    const nTeams = poolTeamsAt().length;
    wrap.append(h('div', { class: 'ov-src' },
      seg([{ v: 'ours', label: 'Our scouts' }, { v: 'all', label: nTeams > 1 ? `All teams (${nTeams})` : 'All teams' }], S.ovSource, (v) => { S.ovSource = v; ls.set('od.scout.ovsource', v); renderView(); }, { label: 'Whose scouting' }),
      pooled ? h('button', { class: 'b b-ghost sm', type: 'button', onclick: () => poolSheet() }, icon('cal'), h('span', { text: 'Choose events' })) : null));
  }

  // the overview is built from everything on the server, so it waits for this phone's reports to get there
  const waiting = store.pending(tid);
  S.ovGated = waiting.length > 0 && !S.ovPreview;
  if (S.ovGated) { wrap.append(ovSyncGate(waiting)); return wrap; }

  if (pooled) {
    const fresh = S.pool && S.pool.eventId === S.eventId;
    if (!fresh || (store.online && Date.now() - (S.pool.at || 0) > 60000)) refreshPool();
    if (!fresh) { wrap.append(h('p', { class: 'muted pad', text: store.online ? 'Gathering every team\u2019s scouting for this competition\u2026' : 'Offline, and all teams\u2019 scouting has not been loaded on this phone yet. Switch to Our scouts above.' })); return wrap; }
  }
  const src = pooled ? poolData() : { reports: S.reports, pits: S.pits };
  const reports = src.reports.filter((r) => r.match_type !== 'pr');
  if (!reports.length) {
    wrap.append(h('div', { class: 'empty card' }, h('div', { class: 'empty-ico' }, icon('target')), h('h2', { text: 'Nothing to weigh up yet' }),
      h('p', { class: 'sub', text: 'Once your scouts file qualification reports, this page ranks every team, lists what each does well and badly, and tells you who to pick.' })));
    return wrap;
  }
  const A = analyse(reports, src.pits, { own: '9' });
  const sheetFor = (r) => robotSheet(r.robot, src.reports, src.pits);
  if (pooled) {
    const by = new Map(); for (const r of reports) by.set(r.team_id, (by.get(r.team_id) || 0) + 1);
    wrap.append(h('p', { class: 'ov-pool' }, h('b', { text: `Pooled from ${by.size} team${by.size === 1 ? '' : 's'}: ` }),
      [...by].sort((a, b) => b[1] - a[1]).map(([tid, n]) => `${teamNumber(tid)} (${n})`).join(' \u00b7 '),
      h('span', { class: 'muted', text: `${S.pool.at ? ` \u00b7 fetched ${ago(S.pool.at)}` : ''}. When two teams scouted the same robot in the same match, their numbers are averaged.` })));
  }
  if (S.ovPreview && waiting.length) wrap.append(h('p', { class: 'ov-warn', text: `Preview: ${waiting.length} item${waiting.length === 1 ? '' : 's'} on this phone not synced yet, so this may change.` }));

  wrap.append(h('div', { class: 'stat-row' },
    [[reports.length, 'reports'], [A.field.length, 'robots'], [new Set(reports.map((r) => `${r.match_type}${r.match_number}`)).size, 'matches'], [A.thin, 'thin samples']].map(([n, l]) => h('div', { class: 'tile' }, h('b', { text: String(n) }), h('span', { text: l })))));

  // ---- who to pick
  const [first, ...rest] = A.recs;
  wrap.append(h('h2', { class: 'ov-h' }, h('span', { class: 'ov-n', text: '01' }), 'Who to pick'));
  if (!first) wrap.append(h('p', { class: 'muted', text: 'No other robot has been scouted yet.' }));
  else {
    const picks = getPicks();
    const onList = (r) => picks.some((p) => robotKey(p.robot) === r.key);
    const lead = h('div', { class: 'card strong ov-lead' },
      h('div', { class: 'ov-lead-top' },
        h('div', {}, h('p', { class: 'eyebrow', text: 'First pick' }), h('button', { type: 'button', class: 'ov-big lnk-row', onclick: () => sheetFor(first.row) }, h('b', { text: first.row.robot }), h('small', { text: ROLES[first.row.role] }))),
        h('div', { class: 'ov-val' }, h('b', { text: fmt(first.score) }), h('small', { text: 'pick score' }))),
      h('ul', { class: 'ov-why' }, first.why.map((w) => h('li', { class: 'pro', text: w }))),
      first.risk.length ? h('ul', { class: 'ov-why' }, first.risk.map((w) => h('li', { class: 'con', text: w }))) : null,
      A.safer ? h('p', { class: 'ov-safer' }, 'Highest ceiling, but a gamble. ', h('button', { type: 'button', class: 'lnk', onclick: () => sheetFor(A.safer.row), text: `Safer choice: ${A.safer.row.robot}` }),
        ` (score ${fmt(A.safer.score)}${A.safer.why[0] ? `, ${A.safer.why[0].charAt(0).toLowerCase()}${A.safer.why[0].slice(1)}` : ''}). Check ${first.row.robot}’s repairs in the pit before choosing.`) : null,
      h('div', { class: 'row start' },
        h('button', { class: 'b b-od sm', type: 'button', onclick: () => sheetFor(first.row) }, h('span', { text: 'Team details' })),
        h('button', { class: 'b b-glass sm', type: 'button', disabled: onList(first.row), onclick: (e) => { addPick(first.row.robot); e.currentTarget.disabled = true; toast(`${first.row.robot} added to your pick list`); } }, icon('star'), h('span', { text: onList(first.row) ? 'On your pick list' : 'Add to pick list' }))));
    const then = h('div', { class: 'ov-list' }, rest.slice(0, 5).map((x) => h('button', { type: 'button', class: 'ov-row', onclick: () => sheetFor(x.row) },
      h('span', { class: 'rk', text: String(x.order) }),
      h('span', { class: 'rt' }, h('b', { text: x.row.robot }), h('small', { text: ROLES[x.row.role] })),
      h('span', { class: 'ov-line', text: x.why[0] || '' }),
      h('span', { class: 'rs' }, h('b', { text: fmt(x.score) }), h('small', { text: 'score' })))));
    const useOrder = h('button', { class: 'b b-glass sm', type: 'button', onclick: () => {
      const apply = () => {
        const keep = getPicks(), dnp = new Set(keep.filter((p) => p.dnp).map((p) => robotKey(p.robot)));
        const order = A.recs.map((x) => x.row.robot).filter((r) => !dnp.has(robotKey(r)));
        setPicks([...order.map((robot) => ({ robot, dnp: false })), ...keep.filter((p) => p.dnp)]);
        toast('Pick list set to the recommended order');
      };
      if (getPicks().length) confirmSheet('Replace your pick list?', 'Your list is reordered to match these recommendations. Teams you marked DNP stay DNP.', 'Replace', false, async () => apply()); else apply();
    } }, icon('list'), h('span', { text: 'Use this order for my pick list' }));
    wrap.append(h('div', { class: 'ov-pick' }, lead, h('div', { class: 'ov-then' }, h('p', { class: 'eyebrow', text: 'Then' }), then, h('div', { class: 'row start' }, useOrder))));
  }
  // what 009 itself brings, and so what a partner should cover
  const needs = A.own
    ? (A.needs.length ? A.needs.map((n) => h('li', { class: 'need', text: n.text })) : [h('li', { class: 'pro', text: 'No clear gap: picks are ranked on pick score alone.' })])
    : [h('li', { class: 'need', text: '009 has not been scouted at this event, so picks are ranked on pick score alone. File 009’s matches to get advice that fits our robot.' })];
  wrap.append(h('div', { class: 'card ov-needs' }, h('h3', { class: 'card-t', text: 'What 009 needs from a partner' }), h('ul', { class: 'ov-why' }, needs)));

  // sleepers and trap picks side by side
  const mini = (title, sub, items, cls, empty) => h('div', { class: `card ov-mini ${cls}` }, h('h3', { class: 'card-t', text: title }), h('p', { class: 'sub', text: sub }),
    items.length ? h('div', { class: 'ov-list' }, items.map((x) => h('button', { type: 'button', class: 'ov-row two', onclick: () => sheetFor(x.row) },
      h('span', { class: 'rt' }, h('b', { text: x.row.robot }), h('small', { text: `${fmt(x.row.avg)} avg` })), h('span', { class: 'ov-line', text: x.why })))) : h('p', { class: 'muted', text: empty }));
  wrap.append(h('div', { class: 'ov-two' },
    mini('Sleepers', 'Outside the top six, but worth a second look.', A.sleepers, 'sleep', 'None stand out yet.'),
    mini('Risky picks', 'Strong on paper, but stop or foul too often to trust blind.', A.avoid, 'trap', 'No risky high scorers. Good.')));

  // ---- the best teams, side by side
  wrap.append(h('h2', { class: 'ov-h' }, h('span', { class: 'ov-n', text: '02' }), 'The best teams'));
  const top = A.rows.filter((r) => r.played).slice(0, 6);
  wrap.append(h('div', { class: 'ov-table', role: 'table', 'aria-label': 'Best teams' },
    h('div', { class: 'ov-tr head', role: 'row' }, ['#', 'Team', 'Pick score', 'Avg pts', 'Level Up', 'End game', 'Reliable'].map((t) => h('span', { role: 'columnheader', text: t }))),
    top.map((r) => h('button', { type: 'button', class: `ov-tr${r.key === A.ownKey ? ' own' : ''}`, role: 'row', onclick: () => sheetFor(r) },
      h('span', { class: 'rk', text: String(r.rank) }),
      h('span', { class: 'rt' }, h('b', { text: r.robot }), h('small', { text: ROLES[r.role] })),
      h('span', { class: 'num strong', text: fmt(r.value) }), h('span', { class: 'num', text: fmt(r.avg) }), h('span', { class: 'num', text: fmt(r.lvl) }),
      h('span', { class: 'num', text: `${fmt(r.station)}` }), h('span', { class: 'num', text: pct(1 - r.died) })))));

  // ---- every team: strengths and drawbacks
  wrap.append(h('h2', { class: 'ov-h' }, h('span', { class: 'ov-n', text: '03' }), 'Every team, strengths and drawbacks'));
  const q = h('input', { type: 'search', inputmode: 'numeric', placeholder: 'Find a team #', 'aria-label': 'Find a team number' });
  const grid = h('div', { class: 'tr-grid' });
  const cards = A.rows.map((r) => {
    const c = h('article', { class: `tr-card${r.key === A.ownKey ? ' own' : ''}`, 'data-k': r.robot },
      h('button', { type: 'button', class: 'tr-head', onclick: () => sheetFor(r) },
        h('span', { class: 'rk', text: String(r.rank) }),
        h('span', { class: 'rt' }, h('b', { text: r.robot }), h('small', { text: `${ROLES[r.role]} · ${r.n} match${r.n === 1 ? '' : 'es'}${r.conf === 'low' ? ' · low confidence' : ''}` })),
        h('span', { class: 'rs' }, h('b', { text: fmt(r.value) }), h('small', { text: 'pick score' }))),
      h('ul', { class: 'ov-why' }, r.strengths.length ? r.strengths.map((s) => h('li', { class: 'pro', text: s.text })) : h('li', { class: 'none', text: 'No standout strengths yet' })),
      h('ul', { class: 'ov-why' }, r.drawbacks.length ? r.drawbacks.map((s) => h('li', { class: 'con', text: s.text })) : h('li', { class: 'none', text: 'No clear weaknesses' })));
    grid.append(c);
    return c;
  });
  q.addEventListener('input', () => { q.value = q.value.replace(/\D/g, ''); for (const c of cards) c.hidden = !!q.value && !c.dataset.k.includes(q.value); });
  wrap.append(h('div', { class: 'tools' }, h('div', { class: 'field grow' }, icon('search'), q)), grid);

  wrap.append(h('details', { class: 'ov-method' }, h('summary', { text: 'How the pick score works' }),
    h('p', { text: `Pick score is the points a robot is expected to add each match. It starts from its qualification average, pulled towards the event average (${fmt(A.mean)}) when it has been seen only a few times, then takes off the points its fouls hand the other alliance, a little for swinging from match to match, and more for breaking down or not showing. Recommendations add a bonus when a robot covers what 009 is weakest at. Practice matches are left out. Strengths and drawbacks compare each team with the rest of this event.` })));
  return wrap;
}
function ovSyncGate(waiting) {
  const off = !store.online, bad = waiting.filter((x) => x.error).length;
  const go = h('button', { class: 'b b-od', type: 'button', disabled: off || store.syncing }, icon('refresh'), h('span', { text: store.syncing ? 'Syncing…' : 'Sync now' }));
  go.addEventListener('click', async () => {
    go.disabled = true; go.querySelector('span').textContent = 'Syncing…';
    await store.flush({ retry: true }).catch(() => {});
    const left = store.pending(S.mem.team.id);
    if (left.length) { toast(left.some((x) => x.error) ? 'Some items were refused. Open Sync (the cloud at the top) to review them.' : 'Still offline. Will retry.'); renderView(); }
  });
  return h('div', { class: 'card strong ov-gate' },
    h('div', { class: 'ov-gate-n' }, h('b', { text: String(waiting.length) }), h('span', { text: `item${waiting.length === 1 ? '' : 's'} on this phone` })),
    h('div', {},
      h('h2', { text: off ? 'Waiting for a connection' : 'Sync first' }),
      h('p', { class: 'sub', text: bad ? `${bad} could not be saved. Review them from the cloud at the top, then sync again.`
        : off ? 'The overview is built from every report on the server, so it opens once what you filed here has synced. It will open by itself when the connection is back.'
          : 'The overview is built from every report on the server. Sync what you filed here first, so the picks use all of it.' }),
      h('div', { class: 'row start' }, go,
        h('button', { class: 'b b-ghost', type: 'button', text: 'Preview with what is here', onclick: () => { S.ovPreview = true; S.ovGated = false; renderView(); } }))));
}

// ------------------------------------------------------------------ every team's scouting (team 009 and staff, read only)
// Every team makes its own event, so "the same competition" is matched by name (ignoring case, punctuation and the
// year) or by the same start date. 009 can add or drop events by hand in Choose events.
const evKey = (name) => String(name || '').toLowerCase().replace(/\b20\d\d\b/g, '').replace(/[^a-z0-9]+/g, '');
function sameCompetition(a, b) {
  if (a.starts_on && b.starts_on && Math.abs(Date.parse(a.starts_on) - Date.parse(b.starts_on)) > 7 * 864e5) return false;
  if (evKey(a.name) && evKey(a.name) === evKey(b.name)) return true;
  return !!(a.starts_on && b.starts_on && a.starts_on === b.starts_on);
}
const poolPrefKey = () => `od.scout.pool.${S.eventId}`;
const poolPref = () => { const v = ls.get(poolPrefKey(), {}) || {}; return { add: Array.isArray(v.add) ? v.add : [], drop: Array.isArray(v.drop) ? v.drop : [] }; };
function poolPicked(events = S.pool?.events || []) {
  const ev = currentEvent(); if (!ev || !S.mem) return [];
  const pref = poolPref();
  return events.filter((e) => e.team_id !== S.mem.team.id && !pref.drop.includes(e.id) && (pref.add.includes(e.id) || sameCompetition(ev, e)));
}
const poolTeamsAt = () => (S.pool && S.pool.eventId === S.eventId ? [S.mem.team.id, ...new Set(poolPicked().map((e) => e.team_id))] : []);
const teamNumber = (tid) => (tid === S.mem?.team?.id ? S.mem.team.number : (S.pool?.teams || []).find((t) => t.id === tid)?.number || (S.adminTeam?.id === tid ? S.adminTeam.number : '?'));
function scoutLabel(r, members) {
  if (r.team_id && S.mem && r.team_id !== S.mem.team.id && S.view !== 'admin') return `team ${teamNumber(r.team_id)}`;
  return memberName(r.scout_id, members);
}
// our own reports come from this phone (so unsynced edits count); everyone else's from the server copy
function poolData() {
  const own = S.mem.team.id, ids = new Set(poolPicked().map((e) => e.id));
  const theirs = (x) => x.team_id !== own && ids.has(x.event_id);
  return { reports: [...S.reports, ...S.pool.reports.filter(theirs)], pits: [...S.pits, ...S.pool.pits.filter(theirs)] };
}
let poolBusy = false;
async function refreshPool() {
  if (poolBusy || !S.admin || !S.eventId) return;
  poolBusy = true;
  const id = S.eventId;
  let changed = false;
  try {
    const [teams, events] = await Promise.all([store.api.allTeams(), store.api.allEvents()]);
    const ids = poolPicked(events).map((e) => e.id);
    const [reports, pits] = await Promise.all([store.api.reportsAt(ids), store.api.pitsAt(ids)]);
    if (S.eventId === id) { S.pool = { eventId: id, teams, events, reports, pits, at: Date.now() }; store.cacheSet(`pool.${id}`, S.pool); changed = true; }
  } catch {
    const c = store.cacheGet(`pool.${id}`);
    if (S.eventId === id && c && (!S.pool || S.pool.eventId !== id || !S.pool.at)) { S.pool = c; changed = true; }
    else if (S.eventId === id && (!S.pool || S.pool.eventId !== id)) { S.pool = { eventId: id, teams: [], events: [], reports: [], pits: [], at: null }; changed = true; }
  } finally { poolBusy = false; }
  if (changed && S.view === 'overview' && !document.querySelector('.scrim')) renderView();
}
function poolSheet() {
  const ev = currentEvent();
  sheet('Events to pool', `Other teams\u2019 events counted as ${ev?.name || 'this event'}. Matched by name or date; change it here.`, (body, close) => {
    const others = (S.pool?.events || []).filter((e) => e.team_id !== S.mem.team.id);
    if (!others.length) { body.append(h('p', { class: 'muted', text: S.pool?.at ? 'No other team has made an event yet.' : 'Connect once to load the other teams\u2019 events.' })); return; }
    const on = new Set(poolPicked().map((e) => e.id));
    const list = h('div', { class: 'rlist' });
    const sorted = [...others].sort((a, b) => on.has(b.id) - on.has(a.id) || String(teamNumber(a.team_id)).localeCompare(teamNumber(b.team_id)));
    for (const e of sorted) {
      const auto = sameCompetition(ev, e);
      list.append(h('div', { class: 'ritem pool-item' },
        h('div', { class: 'rmain' }, h('b', { text: `${teamNumber(e.team_id)} \u00b7 ${e.name}` }),
          h('small', { text: `${e.starts_on ? new Date(`${e.starts_on}T00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'No date'}${auto ? ' \u00b7 matched automatically' : ''}` })),
        toggle('Include', on.has(e.id), (v) => {
          const p2 = poolPref();
          p2.add = p2.add.filter((x) => x !== e.id); p2.drop = p2.drop.filter((x) => x !== e.id);
          if (v && !auto) p2.add.push(e.id);
          if (!v && auto) p2.drop.push(e.id);
          ls.set(poolPrefKey(), p2);
        })));
    }
    body.append(list, h('div', { class: 'row' }, h('button', { class: 'b b-primary', type: 'button', text: 'Done', onclick: () => { close(); if (S.pool) S.pool.at = 0; refreshPool(); renderView(); } })));
  }, { wide: true });
}

// ------------------------------------------------------------------ pick list (one per event, shared with the team)
const getPicks = () => (store.cacheGet(`picks.${S.eventId}`)?.data || []).filter((p) => p && /^[0-9]{1,6}$/.test(p.robot)).slice(0, 200);
function setPicks(list) {
  const id = S.eventId, prev = store.cacheGet(`picks.${id}`);
  const data = list.map((p) => ({ robot: p.robot, dnp: !!p.dnp }));
  store.cacheSet(`picks.${id}`, { data, updated_at: prev?.updated_at || null });
  store.enqueue('picks', { id, event_id: id, team_id: S.mem.team.id, data }).catch((e) => toast(`Pick list not saved: ${friendly(e)}`, 5000));
}
function addPick(robot) { const l = getPicks(); if (!l.some((p) => robotKey(p.robot) === robotKey(robot))) { l.push({ robot, dnp: false }); setPicks(l); } }
function viewPicks() {
  if (!S.eventId) return h('section', { class: 'view' }, noEvent());
  const rows = summarize(S.reports.filter((r) => r.match_type !== 'pr')); const stats = new Map(rows.map((r) => [robotKey(r.robot), r]));
  const list = getPicks();
  const box = h('div', { class: 'pick-list' });
  const draw = () => {
    box.replaceChildren();
    const l = getPicks();
    if (!l.length) { box.append(h('div', { class: 'empty card' }, h('div', { class: 'empty-ico' }, icon('star')), h('h2', { text: 'No picks yet' }), h('p', { class: 'sub', text: 'Add teams from the rankings, type a number above, or start from the top 12 by average.' }))); return; }
    l.forEach((p, i) => {
      const s = stats.get(robotKey(p.robot));
      const move = (dv) => { const a = getPicks(); const j = i + dv; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setPicks(a); draw(); vibrate(5); };
      box.append(h('div', { class: `pick glass${p.dnp ? ' dnp' : ''}` },
        h('span', { class: 'rk', text: String(i + 1) }),
        h('button', { type: 'button', class: 'rt lnk-row', onclick: () => robotSheet(s?.robot || p.robot, S.reports, S.pits) }, h('b', { text: s?.robot || p.robot }), h('small', { text: s ? `${fmt(s.avg)} avg · ${pct(s.dock)} docked` : 'Not scouted yet' })),
        h('button', { class: `b sm ${p.dnp ? 'b-danger' : 'b-ghost'}`, type: 'button', 'aria-pressed': String(p.dnp), text: p.dnp ? 'DNP' : 'Mark DNP', onclick: () => { const a = getPicks(); const [it] = a.splice(i, 1); it.dnp = !it.dnp; if (it.dnp) a.push(it); else a.splice(Math.min(i, a.filter((x) => !x.dnp).length), 0, it); setPicks(a); draw(); } }),
        h('button', { class: 'b b-ghost sm icon', type: 'button', 'aria-label': `Move ${p.robot} to the top`, disabled: i === 0, onclick: () => { const a = getPicks(); const [it] = a.splice(i, 1); a.unshift(it); setPicks(a); draw(); vibrate(5); } }, icon('top')),
        h('button', { class: 'b b-ghost sm icon', type: 'button', 'aria-label': `Move ${p.robot} up`, disabled: i === 0, onclick: () => move(-1) }, icon('up')),
        h('button', { class: 'b b-ghost sm icon', type: 'button', 'aria-label': `Move ${p.robot} down`, disabled: i === l.length - 1, onclick: () => move(1) }, icon('down')),
        h('button', { class: 'b b-ghost sm icon', type: 'button', 'aria-label': `Remove ${p.robot}`, onclick: () => { const a = getPicks(); a.splice(i, 1); setPicks(a); draw(); } }, icon('x'))));
    });
  };
  draw();
  const add = h('input', { inputmode: 'numeric', maxlength: 6, placeholder: 'Team number', 'aria-label': 'Team number to add' });
  add.addEventListener('input', () => { add.value = add.value.replace(/\D/g, '').slice(0, 6); });
  const addForm = h('form', { class: 'tools' }, h('div', { class: 'field grow' }, add), h('button', { class: 'b b-primary', type: 'submit', text: 'Add' }));
  addForm.addEventListener('submit', (e) => { e.preventDefault(); if (/^[0-9]{1,6}$/.test(add.value)) { addPick(add.value); add.value = ''; draw(); } });
  return h('section', { class: 'view' },
    h('div', { class: 'view-head' }, h('div', {}, h('p', { class: 'eyebrow', text: currentEvent()?.name || '' }), h('h1', { text: 'Pick list' })),
      h('button', { class: 'b b-glass sm', type: 'button', onclick: () => { const top = [...rows].sort((a, b) => b.avg - a.avg).slice(0, 12); for (const r of top) addPick(r.robot); draw(); toast(top.length ? 'Added the top teams by average' : 'No reports yet'); } }, icon('star'), h('span', { text: 'Add top 12' }))),
    h('p', { class: 'help', text: 'Shared with your team for this event, and saved on this phone first. Reorder with the arrows; mark teams you will not pick as DNP.' }),
    addForm, box,
    list.length ? h('div', { class: 'row end' }, h('button', { class: 'b b-ghost sm', type: 'button', text: 'Clear list', onclick: () => confirmSheet('Clear the pick list?', 'Your whole team shares this list.', 'Clear', true, async () => { setPicks([]); renderView(); }) })) : null);
}

// ------------------------------------------------------------------ team management
function eventSheet(ev) {
  sheet(ev ? 'Edit event' : 'New event', ev ? null : 'Name it the way your team will recognise it.', (body, close) => {
    const name = h('input', { maxlength: 80, value: ev?.name || '', placeholder: 'e.g. Mumbai Regional 2026' });
    const date = h('input', { type: 'date', value: ev?.starts_on || '' });
    const err = h('p', { class: 'err', role: 'alert' });
    const ok = h('button', { class: 'b b-primary', type: 'submit', text: ev ? 'Save' : 'Create event' });
    const f = h('form', {}, field('Event name', name), field('Starts on (optional)', date), err, h('div', { class: 'row' }, h('button', { class: 'b b-glass', type: 'button', text: 'Cancel', onclick: close }), ok));
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); const n = name.value.trim(); if (!n) { err.textContent = 'Give the event a name.'; return; }
      ok.disabled = true; err.textContent = '';
      try {
        let offline = false;
        if (ev?.local) {                                   // still on this phone: change the copy that will be sent
          ev.name = n; ev.starts_on = date.value || null;
          await store.enqueue('event', { id: ev.id, team_id: ev.team_id, name: n, starts_on: ev.starts_on });
        } else if (ev) { await store.api.renameEvent(ev.id, n, date.value); ev.name = n; ev.starts_on = date.value || null; }
        else {
          const created = { id: uuid(), team_id: S.mem.team.id, name: n, starts_on: date.value || null, created_at: new Date().toISOString(), local: true };
          S.events.unshift(created); S.eventId = created.id; ls.set(`od.scout.event.${S.mem.team.id}`, created.id); retargetBlankForm();
          const { synced } = await store.enqueue('event', { id: created.id, team_id: created.team_id, name: n, starts_on: created.starts_on });
          offline = !synced;
          if (synced) delete created.local;
          await loadEventData();
        }
        close(); renderShell(); toast(offline ? 'Event made on this phone · syncs when you are back online' : ev ? 'Event updated' : 'Event created', offline ? 3600 : 2200);
      } catch (x) { err.textContent = friendly(x); ok.disabled = false; }
    });
    body.append(f);
  });
}
function pickEventSheet() {
  sheet('Events', 'Reports are grouped by event.', (body, close) => {
    const list = h('div', { class: 'rlist' });
    for (const e of S.events) {
      list.append(h('div', { class: 'ritem' },
        h('button', { class: `ev-pick${e.id === S.eventId ? ' on' : ''}`, type: 'button', onclick: async () => { S.eventId = e.id; ls.set(`od.scout.event.${S.mem.team.id}`, e.id); close(); retargetBlankForm(); await loadEventData(); renderShell(); } },
          h('b', { text: e.name }), h('small', { text: `${e.starts_on ? new Date(`${e.starts_on}T00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'No date'}${e.local ? ' · on this phone, not synced yet' : ''}` })),
        isLead() || e.local ? h('button', { class: 'b b-ghost sm icon', type: 'button', 'aria-label': `Edit ${e.name}`, onclick: () => { close(); eventSheet(e); } }, icon('edit')) : null,
        isLead() || e.local ? h('button', { class: 'b b-ghost sm icon', type: 'button', 'aria-label': `Delete ${e.name}`, onclick: () => { close(); confirmSheet('Delete this event?', e.local ? `${e.name} and the reports filed to it on this phone will be deleted.` : `${e.name} and every report filed at it will be deleted for your whole team.`, 'Delete event', true, async () => {
          if (!e.local) await store.api.deleteEvent(e.id);
          store.dropWhere((q) => q.row.event_id === e.id || (q.kind === 'event' && q.row.id === e.id)); S.events = S.events.filter((x) => x.id !== e.id); if (S.eventId === e.id) { S.eventId = S.events[0]?.id || null; await loadEventData(); } renderShell(); toast('Event deleted');
        }, 'DELETE'); } }, icon('trash')) : null));
    }
    if (!S.events.length) list.append(h('p', { class: 'muted', text: 'No events yet.' }));
    body.append(list, h('div', { class: 'row' }, h('button', { class: 'b b-primary', type: 'button', onclick: () => { close(); eventSheet(); } }, icon('plus'), h('span', { text: 'New event' }))));
  });
}
function viewTeam() {
  const t = S.mem.team, owner = S.mem.role === 'owner';
  const codeBox = h('div', { class: 'code-box glass' }, h('span', { class: 'muted', text: 'Loading…' }));
  if (isLead()) {
    store.api.teamCode().then((code) => {
      codeBox.replaceChildren(h('span', { class: 'code mono', text: code || '—' }),
        h('button', { class: 'b b-glass sm', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(code); toast('Join code copied'); } catch { toast('Copy failed. Select the code instead.'); } } }, icon('copy'), h('span', { text: 'Copy' })),
        owner ? h('button', { class: 'b b-ghost sm', type: 'button', onclick: () => confirmSheet('Make a new join code?', 'The old code stops working. People already on the team stay on it.', 'New code', false, async () => { await store.api.rotateCode(); renderView(); toast('New join code ready'); }) }, icon('refresh'), h('span', { text: 'New code' })) : null);
    }).catch((e) => codeBox.replaceChildren(h('span', { class: 'err', text: friendly(e) })));
  }
  const members = h('div', { class: 'rlist' });
  const roleLabel = { owner: 'Owner', lead: 'Lead', scout: 'Scout' };
  for (const m of [...S.mem.members].sort((a, b) => ['owner', 'lead', 'scout'].indexOf(a.role) - ['owner', 'lead', 'scout'].indexOf(b.role))) {
    const me = m.user_id === S.user.id;
    const acts = [];
    if (owner && !me) {
      acts.push(h('button', { class: 'b b-ghost sm', type: 'button', text: m.role === 'lead' ? 'Make scout' : 'Make lead', onclick: async () => { try { await store.api.setRole(m.user_id, m.role === 'lead' ? 'scout' : 'lead'); await refreshMembership(); toast('Role updated'); } catch (e) { toast(friendly(e)); } } }));
      acts.push(h('button', { class: 'b b-ghost sm', type: 'button', text: 'Make owner', onclick: () => confirmSheet(`Hand the team to ${m.display_name}?`, 'They become the owner and you become a lead.', 'Hand over', false, async () => { await store.api.transferOwner(m.user_id); await refreshMembership(); }) }));
    }
    if (!me && m.role !== 'owner' && (owner || (S.mem.role === 'lead' && m.role === 'scout'))) {
      acts.push(h('button', { class: 'b b-ghost sm icon', type: 'button', 'aria-label': `Remove ${m.display_name}`, onclick: () => confirmSheet(`Remove ${m.display_name}?`, 'They lose access to your team’s data. Reports they filed stay.', 'Remove', true, async () => { await store.api.removeMember(m.user_id); await refreshMembership(); }) }, icon('x')));
    }
    members.append(h('div', { class: 'ritem' }, h('span', { class: 'avatar', text: initials(m.display_name) }),
      h('div', { class: 'rmain' }, h('b', { text: `${m.display_name}${me ? ' (you)' : ''}` }), h('small', { text: roleLabel[m.role] || m.role })), ...acts));
  }
  const nameIn = h('input', { maxlength: 40, value: S.mem.displayName || '' });
  const nameForm = h('form', { class: 'tools' }, h('div', { class: 'field grow' }, nameIn), h('button', { class: 'b b-glass', type: 'submit', text: 'Save' }));
  nameForm.addEventListener('submit', async (e) => { e.preventDefault(); const n = nameIn.value.trim(); if (!n) return; try { await store.api.renameSelf(t.id, S.user.id, n); await refreshMembership(); toast('Name updated'); } catch (x) { toast(friendly(x)); } });
  const teamName = h('input', { maxlength: 48, value: t.name });
  const teamForm = h('form', { class: 'tools' }, h('div', { class: 'field grow' }, teamName), h('button', { class: 'b b-glass', type: 'submit', text: 'Rename' }));
  teamForm.addEventListener('submit', async (e) => { e.preventDefault(); const n = teamName.value.trim(); if (!n) return; try { await store.api.renameTeam(t.id, n); await refreshMembership(); toast('Team renamed'); } catch (x) { toast(friendly(x)); } });
  return h('section', { class: 'view' },
    h('div', { class: 'view-head' }, h('div', {}, h('p', { class: 'eyebrow', text: `Team ${t.number}` }), h('h1', { text: t.name }))),
    owner ? h('div', { class: 'card' }, h('h3', { class: 'card-t', text: 'Team name' }), teamForm) : null,
    isLead() ? h('div', { class: 'card' }, h('h3', { class: 'card-t', text: 'Invite scouts' }), h('p', { class: 'sub', text: 'Share this code. Anyone with it can join your team and see its reports.' }), codeBox) : null,
    h('div', { class: 'card' }, h('h3', { class: 'card-t', text: `Members (${S.mem.members.length})` }), members),
    h('div', { class: 'card' }, h('h3', { class: 'card-t', text: 'Events' }), h('p', { class: 'sub', text: currentEvent() ? `Scouting at ${currentEvent().name}.` : 'No event selected.' }),
      h('div', { class: 'row start' }, h('button', { class: 'b b-glass', type: 'button', onclick: () => pickEventSheet() }, icon('cal'), h('span', { text: 'Switch or manage events' })), h('button', { class: 'b b-ghost', type: 'button', onclick: () => eventSheet() }, icon('plus'), h('span', { text: 'New event' })))),
    h('div', { class: 'card' }, h('h3', { class: 'card-t', text: 'Your name on this team' }), nameForm,
      h('p', { class: 'help', text: `Signed in as ${S.user.email || 'your Overdrive account'}.` }),
      h('div', { class: 'row start' },
        h('button', { class: 'b b-glass', type: 'button', onclick: () => signOut() }, icon('logout'), h('span', { text: 'Sign out' })),
        h('button', { class: 'b b-ghost', type: 'button', text: owner && S.mem.members.length > 1 ? 'Leave team (hand it over first)' : 'Leave team', disabled: owner && S.mem.members.length > 1, onclick: () => confirmSheet('Leave this team?', owner ? 'You are the last member, so the team and all its reports will be deleted.' : 'You lose access to its reports. Reports you filed stay with the team.', 'Leave', true, async () => { const tid = t.id; await store.api.leaveTeam(); store.dropWhere((q) => q.team === tid); forgetTeam(); route(); }, owner ? 'DELETE' : null) }),
        h('button', { class: 'b b-danger', type: 'button', onclick: () => confirmSheet('Delete your account?', 'This deletes your sign-in, your simulator profile and match history, and removes you from your team. Scouting reports you filed stay with your team. This cannot be undone.', 'Delete account', true, async () => { await store.api.deleteAccount(); store.dropWhere(() => true); await doSignOut(); }, 'DELETE') }, icon('trash'), h('span', { text: 'Delete account' })))),
    h('nav', { class: 'foot-links' }, h('a', { href: `${SITE}/`, text: 'Overdrive home' }), h('a', { href: `${SITE}/sim`, text: 'Simulator' }), h('a', { href: '/terms', text: 'Terms' }), h('a', { href: '/privacy', text: 'Privacy' })));
}
async function refreshMembership() { S.mem = await store.api.membership(S.user.id); if (!S.mem) { forgetTeam(); route(); return; } store.cacheSet(`mem.${S.user.id}`, S.mem); renderShell(); }

// ------------------------------------------------------------------ Overdrive staff view (every team)
function viewAdmin() {
  const wrap = h('section', { class: 'view' });
  if (S.adminTeam) {
    const at = S.adminTeam;
    wrap.append(h('button', { class: 'b b-ghost sm back', type: 'button', onclick: () => { S.adminTeam = null; renderView(); } }, icon('up', 'i rot'), h('span', { text: 'All teams' })));
    if (!at.loaded) { wrap.append(h('p', { class: 'muted pad', text: 'Loading…' })); return wrap; }
    const evSel = h('select', { 'aria-label': 'Event', onchange: (e) => { at.eventId = e.target.value; renderView(); } },
      h('option', { value: '', text: `All events (${at.events.length})` }), at.events.map((e) => h('option', { value: e.id, text: e.name, selected: e.id === at.eventId })));
    const reports = at.eventId ? at.reports.filter((r) => r.event_id === at.eventId) : at.reports;
    wrap.append(h('div', { class: 'tools' }, h('div', { class: 'field sel grow' }, evSel, icon('chev', 'i chev'))));
    const pits = at.eventId ? (at.pits || []).filter((x) => x.event_id === at.eventId) : at.pits || [];
    wrap.append(rankingsBlock(reports, pits, { title: `Team ${at.number} · ${at.name}`, sub: 'Overdrive staff view', exportName: `team-${at.number}`, members: at.members }));
    return wrap;
  }
  wrap.append(h('div', { class: 'view-head' }, h('div', {}, h('p', { class: 'eyebrow', text: 'Overdrive staff' }), h('h1', { text: 'All teams' }))));
  const list = h('div', { class: 'rank-list' }, h('p', { class: 'muted pad', text: 'Loading…' }));
  wrap.append(list);
  store.api.adminOverview().then((rows) => {
    list.replaceChildren();
    if (!rows?.length) { list.append(h('p', { class: 'muted pad', text: 'No teams yet.' })); return; }
    for (const r of rows) {
      list.append(h('button', { type: 'button', class: 'rank glass', onclick: async () => {
        const at = { id: r.team_id, number: r.number, name: r.name, loaded: false };
        S.adminTeam = at; renderView();
        try {
          const [events, reports, members, pits] = await Promise.all([store.api.adminEvents(r.team_id), store.api.teamReports(r.team_id), store.api.adminMembers(r.team_id), store.api.teamPits(r.team_id).catch(() => [])]);
          if (S.adminTeam !== at) return;                      // they moved on while it loaded
          Object.assign(at, { events, reports, members, pits, loaded: true, eventId: '' }); renderView();
        } catch (e) { if (S.adminTeam === at) { toast(friendly(e)); S.adminTeam = null; renderView(); } }
      } },
        h('span', { class: 'rt' }, h('b', { text: r.number }), h('small', { text: r.name })),
        h('span', { class: 'rs' }, h('b', { text: String(r.reports) }), h('small', { text: 'reports' })),
        h('span', { class: 'rs hide-s' }, h('b', { text: String(r.members) }), h('small', { text: 'members' })),
        h('span', { class: 'rs hide-s' }, h('b', { text: String(r.events) }), h('small', { text: 'events' })),
        h('span', { class: 'rs' }, h('b', { text: r.last_report ? new Date(r.last_report).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—' }), h('small', { text: 'last report' }))));
    }
  }).catch((e) => list.replaceChildren(h('p', { class: 'err', text: friendly(e) })));
  return wrap;
}

// ------------------------------------------------------------------ top bar actions
$('#tb-event-btn').addEventListener('click', () => pickEventSheet());
const FIELD_LABEL = { event_id: 'Event', match_type: 'Match type', match_number: 'Match', robot_number: 'Robot', alliance: 'Alliance', station: 'Station', data: 'Pick order' };
function entryTitle(item) {
  const r = item.row;
  if (item.kind === 'pit') return `Pit report · ${r.robot_number}`;
  if (item.kind === 'event') return `New event · ${r.name}`;
  if (item.kind === 'picks') return `Pick list · ${S.events.find((e) => e.id === r.event_id)?.name || 'event'}`;
  if (item.kind === 'del') return 'Delete a report';
  return `${matchLabel(r.match_type, r.match_number)} · ${r.robot_number}`;
}
const show = (v) => (v == null || v === '' ? '—' : Array.isArray(v) ? (v.length && typeof v[0] === 'object' ? v.map((p) => p.robot + (p.dnp ? ' (DNP)' : '')).join(', ') : v.join(', ')) : String(v));
function fieldValue(row, k) { return k.startsWith('data.') ? row?.data?.[k.slice(5)] : row?.[k]; }
function conflictBlock(item, close) {
  const c = item.conflict, srv = c.server;
  const box = h('div', { class: 'conflict' });
  if (!srv) box.append(h('p', { class: 'sub', text: item.kind === 'del' ? 'Nothing to delete any more.' : 'A teammate deleted this on the server while you were editing it here.' }));
  else if (item.kind === 'del') box.append(h('p', { class: 'sub', text: `${memberName(srv.scout_id)} changed this report after you last saw it, so it was not deleted.` }));
  else {
    box.append(h('p', { class: 'sub', text: 'Someone else changed the same fields. Nothing was overwritten. Choose which version to keep.' }));
    const dl = h('dl', { class: 'kv clash' });
    for (const k of c.fields) {
      dl.append(h('div', {}, h('dt', { text: FIELD_LABEL[k] || k.replace(/^data\./, '').replace(/_/g, ' ') }),
        h('dd', {}, h('span', { class: 'mine', text: `Yours: ${show(fieldValue(item.row, k))}` }), h('span', { class: 'theirs', text: `Server: ${show(fieldValue(srv, k))}` }))));
    }
    box.append(dl);
  }
  const act = async (choice) => { await store.resolve(item, choice); close(); loadEventDataCached(); renderView(); toast(choice === 'mine' ? 'Your version was sent' : 'Kept the server version'); };
  box.append(h('div', { class: 'row start' },
    h('button', { class: 'b b-od sm', type: 'button', text: item.kind === 'del' ? (srv ? 'Delete anyway' : 'OK') : srv ? 'Keep mine' : 'Send mine again', onclick: () => act(srv || item.kind !== 'del' ? 'mine' : 'theirs') }),
    srv || item.kind !== 'del' ? h('button', { class: 'b b-glass sm', type: 'button', text: item.kind === 'del' ? 'Keep the report' : srv ? 'Keep theirs' : 'Discard mine', onclick: () => act('theirs') }) : null));
  return box;
}
function syncSheet() {
  const q = store.pending(S.mem?.team?.id), st = store.status();
  const head = st.auth ? 'Your sign-in ran out while you were offline. Sign in again and everything waiting uploads.'
    : !q.length ? 'Everything you filed is on the server.' : st.state === 'offline' ? `${q.length} saved on this phone. They upload by themselves when the connection is back.` : `${q.length} waiting to upload.`;
  sheet('Sync', head, (body, close) => {
    const order = (x) => (x.conflict ? 0 : x.error ? 1 : 2);
    for (const item of [...q].sort((a, b) => order(a) - order(b) || a.at - b.at)) {
      const why = item.conflict ? 'Conflict' : item.error ? item.error : st.state === 'offline' ? 'Waiting for a connection' : 'Waiting to upload';
      body.append(h('div', { class: `ritem col sync-item${item.conflict || item.error ? ' bad' : ''}` },
        h('div', { class: 'rrow' }, h('div', { class: 'rmain' }, h('b', { text: entryTitle(item) }), h('small', { class: item.conflict || item.error ? 'err' : 'muted', text: why })),
          item.error ? h('button', { class: 'b b-ghost sm', type: 'button', text: 'Discard', onclick: () => confirmSheet('Discard this entry?', 'It is deleted from this phone and never uploaded.', 'Discard', true, async () => { store.dropQueued(item); close(); loadEventDataCached(); renderView(); }) }) : null),
        item.conflict ? conflictBlock(item, close) : null));
    }
    body.append(h('div', { class: 'row' },
      st.auth ? h('button', { class: 'b b-primary', type: 'button', text: 'Sign in again', onclick: () => store.api.signIn() }) : null,
      h('button', { class: 'b b-primary', type: 'button', disabled: !q.length, onclick: async () => {
        close(); await store.flush({ retry: true });
        const s2 = store.status();
        toast(!s2.unsynced ? 'All synced' : s2.state === 'attention' ? 'Some entries need you. Open Sync to review them.' : 'Still offline. Scout will keep trying.');
      } }, icon('refresh'), h('span', { text: 'Retry now' }))));
  });
}
$('#tb-sync').addEventListener('click', () => syncSheet());
$('#tb-avatar').addEventListener('click', () => go('team'));
window.addEventListener('pageshow', () => store.flush().catch(() => {}));
// coming back to the app (or back online) pulls in teammates' reports; the scouting form is never redrawn under you
let lastPull = Date.now();
async function pull() {
  if (!S.mem || !S.eventId || document.hidden || Date.now() - lastPull < 20000) return;
  lastPull = Date.now();
  afterPull(await loadEventData(), false);
}
// fresh numbers redraw the read-only views; the scouting forms are never redrawn under a scout's thumb
function afterPull(fresh, eventChanged) {
  if (!S.mem || document.body.dataset.stage !== 'app') return;
  if (eventChanged) { renderShell(); return; }
  renderTopbar();
  if (fresh && ['data', 'picks', 'admin', 'overview'].includes(S.view) && !document.querySelector('.scrim')) renderView();
}
document.addEventListener('visibilitychange', () => { pull().catch(() => {}); });
window.addEventListener('online', () => { lastPull = 0; pull().catch(() => {}); });
setInterval(() => { pull().catch(() => {}); }, 60000);
// keep a copy of Scout on the phone so it opens with no signal (demo mode stays out of it unless asked, on localhost)
const swOk = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && swOk && (!DEMO || new URLSearchParams(location.search).get('sw') === '1')) navigator.serviceWorker.register('/sw.js').catch(() => {});
document.addEventListener('visibilitychange', () => { if (!document.hidden) store.flush().catch(() => {}); });

boot().catch((e) => { console.error(e); renderFatal(friendly(e), true); });
