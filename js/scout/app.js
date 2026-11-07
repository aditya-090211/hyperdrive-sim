// Overdrive Scout: match and pit scouting for NRL 2026 HYPERDRIVE.
// Every piece of user-supplied text is placed with textContent / attributes, never parsed as HTML.
import { Store, DEMO, friendly, uuid } from './store.js';
import { signInUrl } from '../auth-client.js';
import {
  PHASES, ACTIONS, STATION, PAYLOAD, START, MATCH_TYPES, DEFENSE, TAGS, DRIVE, MAX_COUNT, TERMS_VERSION,
  pointsOf, coresOf, cleanReport, cleanPit, summarize, matchLabel, robotKey, matchOrder,
} from './game.js';

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
  el.animate([{ transform: `translateY(${dir > 0 ? 55 : -55}%)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 240, easing: EASE_OUT });
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
const S = {
  session: null, user: null, consent: null, mem: null, events: [], eventId: null, reports: [], pits: [], admin: false,
  view: ls.get('od.scout.view', 'scout'), sort: 'avg', search: '', loading: true, adminTeam: null,
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
const isLead = () => ['owner', 'lead'].includes(S.mem?.role);
const memberName = (uid, list = S.mem?.members) => list?.find((m) => m.user_id === uid)?.display_name || (uid ? 'Teammate' : 'Former member');
const currentEvent = () => S.events.find((e) => e.id === S.eventId) || null;

// ------------------------------------------------------------------ boot and auth gates
async function boot() {
  if (!store.available) { renderFatal('Overdrive Scout could not load its sign-in service. Check your connection and reload.'); return; }
  store.on(renderSync);
  // a report that has left the queue is on the server: drop its "waiting to sync" mark
  store.on(() => {
    const q = new Set(store.pending().filter((x) => x.kind === 'report').map((x) => x.row.id));
    for (const r of S.reports) if (r.pending && !q.has(r.id)) r.pending = false;
  });
  store.api.onAuth((s) => { if ((s?.user?.id || null) !== (S.user?.id || null)) { S.session = s; S.user = s?.user || null; route(); } });
  try { S.session = await store.api.session(); } catch { S.session = null; }
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
  if (!S.user) { if (DEMO) return renderSignIn(); location.replace(signInUrl('/scout')); return; }
  try {
    const uid = S.user.id;
    S.consent = await store.api.consent(uid);
    if (stale()) return;
    if (!S.consent || S.consent.terms_version !== TERMS_VERSION) return renderConsent();
    S.mem = await store.api.membership(uid);
    if (stale()) return;
    store.cacheSet(`mem.${uid}`, S.mem);
  } catch (e) {
    if (stale()) return;
    const cached = store.cacheGet(`mem.${S.user.id}`);
    if (cached && /connection/i.test(friendly(e))) { S.mem = cached; S.consent = { cached: true }; toast('Offline: showing your last synced data'); }
    else return renderFatal(friendly(e), true);
  }
  if (!S.mem) return renderTeamSetup();
  try { S.admin = !!(await store.api.isAdmin()); } catch { S.admin = false; }
  if (stale()) return;
  await loadEvents();
  if (stale()) return;
  S.loading = false;
  renderShell();
  store.flush().catch(() => {});
}

async function loadEvents() {
  const tid = S.mem.team.id;
  try { S.events = await store.api.events(tid); store.cacheSet(`events.${tid}`, S.events); }
  catch { S.events = store.cacheGet(`events.${tid}`) || []; }
  const saved = ls.get(`od.scout.event.${tid}`, null);
  S.eventId = S.events.some((e) => e.id === saved) ? saved : S.events[0]?.id || null;
  await loadEventData();
}
async function loadEventData() {
  let fresh = false;
  S.reports = []; S.pits = [];
  if (!S.eventId) return false;
  try {
    [S.reports, S.pits] = await Promise.all([store.api.reports(S.eventId), store.api.pits(S.eventId)]);
    store.cacheSet(`ev.${S.eventId}`, { reports: S.reports, pits: S.pits });
    fresh = true;
  } catch {
    const c = store.cacheGet(`ev.${S.eventId}`); if (c) { S.reports = c.reports || []; S.pits = c.pits || []; }
  }
  // reports still waiting to sync count too
  for (const q of store.pending(S.mem.team.id)) {
    if (q.kind === 'report' && q.row.event_id === S.eventId && !S.reports.some((r) => r.id === q.row.id)) S.reports.push({ ...q.row, scout_id: S.user.id, points: pointsOf(q.row.data), pending: true });
  }
  return fresh;
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
    h('nav', { class: 'gate-links' }, h('a', { href: '/', text: 'Overdrive home' }), h('a', { href: '/sim', text: 'Simulator' }), h('a', { href: '/privacy', text: 'Privacy' }), h('a', { href: '/terms', text: 'Terms' }))));
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

async function signOut() {
  const waiting = store.pending().length;
  try { await store.api.signOut(); } catch { /* signed out locally anyway */ }
  store.clearCache(); form = blankForm(); pitForm = { robot_number: '', data: {} };
  S.user = null; S.session = null; S.mem = null; S.reports = []; S.pits = []; S.events = []; S.adminTeam = null;
  if (waiting) toast(`${waiting} report${waiting === 1 ? '' : 's'} not synced yet. They stay on this device and upload next time you sign in.`, 5000);
  route();
}

// ------------------------------------------------------------------ the app shell
const TABS = [
  { id: 'scout', label: 'Scout', icon: 'clip' }, { id: 'pit', label: 'Pit', icon: 'wrench' }, { id: 'data', label: 'Data', icon: 'chart' },
  { id: 'picks', label: 'Picks', icon: 'list' }, { id: 'team', label: 'Team', icon: 'users' },
];
function renderShell() {
  const tabs = S.admin ? [...TABS, { id: 'admin', label: 'Admin', icon: 'shield' }] : TABS;
  if (!tabs.some((t) => t.id === S.view)) S.view = 'scout';
  const bar = $('#tabbar');
  if (bar.dataset.tabs !== tabs.map((t) => t.id).join()) {
    bar.dataset.tabs = tabs.map((t) => t.id).join(); bar.replaceChildren(h('i', { class: 'tab-ind', 'aria-hidden': 'true' }));
    for (const t of tabs) bar.append(h('button', { type: 'button', class: 'tab', 'data-tab': t.id, onclick: () => go(t.id) }, icon(t.icon), h('span', { text: t.label })));
  }
  const idx = tabs.findIndex((t) => t.id === S.view);
  for (const b of bar.querySelectorAll('.tab')) { if (b.dataset.tab === S.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  bar.style.setProperty('--n', String(tabs.length)); bar.style.setProperty('--i', String(idx));
  const ev = currentEvent();
  $('#tb-team').textContent = `${S.mem.team.number}`;
  $('#tb-team-name').textContent = S.mem.team.name;
  $('#tb-event').textContent = ev ? ev.name : 'No event';
  $('#tb-avatar').textContent = initials(S.mem.displayName || S.user.email || '?');
  renderSync();
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
  const order = [...TABS.map((t) => t.id), 'admin'], next = order.indexOf(view);
  app.dataset.dir = next >= lastTab ? 'fwd' : 'back'; lastTab = next;
  S.view = view; ls.set('od.scout.view', view); renderShell(); window.scrollTo(0, 0);
}
function renderSync() {
  const el = $('#tb-sync'); if (!el || !S.mem) return;
  const q = store.pending(S.mem.team.id), bad = q.filter((x) => x.error).length;
  el.dataset.state = store.syncing ? 'busy' : bad ? 'error' : q.length ? 'waiting' : 'ok';
  $('#tb-sync-n').textContent = q.length ? String(q.length) : '';
  el.title = store.syncing ? 'Syncing…' : bad ? `${bad} report(s) could not be saved` : q.length ? `${q.length} waiting to sync` : 'All reports synced';
  el.setAttribute('aria-label', el.title);
}
function renderView() {
  const v = { scout: viewScout, pit: viewPit, data: viewData, picks: viewPicks, team: viewTeam, admin: viewAdmin }[S.view] || viewScout;
  app.replaceChildren(v());
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
  toast(`${form.id && !form.replaced ? 'Updated' : navigator.onLine === false ? 'Saved on this phone, will sync' : 'Saved'} · ${matchLabel(row.match_type, row.match_number)} · ${row.robot_number}`);
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
          const onlyLocal = !!r.pending && !r.created_on_server;
          if (!onlyLocal) await store.api.deleteReport(r.id);
          store.dropWhere((x) => x.row.id === r.id);
          S.reports = S.reports.filter((x) => x.id !== r.id); close(); toast('Report deleted'); renderView();
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
    if (existing) existing.data = row.data; else S.pits.push({ ...row, scout_id: S.user.id });
    store.enqueue('pit', row).catch((e) => toast(`Not saved: ${friendly(e)}`, 5000));
    toast(`Pit report saved · ${row.robot_number}`); vibrate([12, 40, 12]);
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
        h('small', { class: 'muted', text: `Scouted by ${memberName(r.scout_id, members)}` })));
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
  const wrap = h('section', { class: 'view' }, rankingsBlock(S.reports, S.pits, { title: 'Team rankings', sub: ev?.name, exportName: `${S.mem.team.number}-${ev?.name || 'event'}` }));
  wrap.append(h('div', { class: 'row end' }, h('button', { class: 'b b-ghost sm', type: 'button', onclick: async () => { const fresh = await loadEventData(); renderView(); toast(fresh ? 'Up to date' : 'Offline: showing the last data you synced'); } }, icon('refresh'), h('span', { text: 'Refresh' }))));
  return wrap;
}

// ------------------------------------------------------------------ pick list (kept on this device)
const pickKey = () => `od.scout.picks.${S.eventId}`;
const getPicks = () => ls.get(pickKey(), []).filter((p) => p && /^[0-9]{1,6}$/.test(p.robot)).slice(0, 200);
const setPicks = (list) => ls.set(pickKey(), list);
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
    h('p', { class: 'help', text: 'Saved on this device for this event. Reorder with the arrows; mark teams you will not pick as DNP.' }),
    addForm, box,
    list.length ? h('div', { class: 'row end' }, h('button', { class: 'b b-ghost sm', type: 'button', text: 'Clear list', onclick: () => confirmSheet('Clear the pick list?', 'This only affects this device.', 'Clear', true, async () => { setPicks([]); renderView(); }) })) : null);
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
        if (ev) { await store.api.renameEvent(ev.id, n, date.value); ev.name = n; ev.starts_on = date.value || null; }
        else { const created = await store.api.createEvent(S.mem.team.id, n, date.value); S.events.unshift(created); S.eventId = created.id; ls.set(`od.scout.event.${S.mem.team.id}`, created.id); await loadEventData(); }
        close(); renderShell(); toast(ev ? 'Event updated' : 'Event created');
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
        h('button', { class: `ev-pick${e.id === S.eventId ? ' on' : ''}`, type: 'button', onclick: async () => { S.eventId = e.id; ls.set(`od.scout.event.${S.mem.team.id}`, e.id); close(); await loadEventData(); renderShell(); } },
          h('b', { text: e.name }), h('small', { text: e.starts_on ? new Date(`${e.starts_on}T00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'No date' })),
        isLead() ? h('button', { class: 'b b-ghost sm icon', type: 'button', 'aria-label': `Edit ${e.name}`, onclick: () => { close(); eventSheet(e); } }, icon('edit')) : null,
        isLead() ? h('button', { class: 'b b-ghost sm icon', type: 'button', 'aria-label': `Delete ${e.name}`, onclick: () => { close(); confirmSheet('Delete this event?', `${e.name} and every report filed at it will be deleted for your whole team.`, 'Delete event', true, async () => {
          await store.api.deleteEvent(e.id); store.dropWhere((q) => q.row.event_id === e.id); S.events = S.events.filter((x) => x.id !== e.id); if (S.eventId === e.id) { S.eventId = S.events[0]?.id || null; await loadEventData(); } renderShell(); toast('Event deleted');
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
        h('button', { class: 'b b-ghost', type: 'button', text: owner && S.mem.members.length > 1 ? 'Leave team (hand it over first)' : 'Leave team', disabled: owner && S.mem.members.length > 1, onclick: () => confirmSheet('Leave this team?', owner ? 'You are the last member, so the team and all its reports will be deleted.' : 'You lose access to its reports. Reports you filed stay with the team.', 'Leave', true, async () => { const tid = t.id; await store.api.leaveTeam(); store.dropWhere((q) => q.team === tid); S.mem = null; route(); }, owner ? 'DELETE' : null) }),
        h('button', { class: 'b b-danger', type: 'button', onclick: () => confirmSheet('Delete your account?', 'This deletes your sign-in, your simulator profile and match history, and removes you from your team. Scouting reports you filed stay with your team. This cannot be undone.', 'Delete account', true, async () => { await store.api.deleteAccount(); store.dropWhere(() => true); store.clearCache(); await signOut(); }, 'DELETE') }, icon('trash'), h('span', { text: 'Delete account' })))),
    h('nav', { class: 'foot-links' }, h('a', { href: '/', text: 'Overdrive home' }), h('a', { href: '/sim', text: 'Simulator' }), h('a', { href: '/terms', text: 'Terms' }), h('a', { href: '/privacy', text: 'Privacy' })));
}
async function refreshMembership() { S.mem = await store.api.membership(S.user.id); if (!S.mem) { route(); return; } renderShell(); }

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
    wrap.append(rankingsBlock(reports, [], { title: `Team ${at.number} · ${at.name}`, sub: 'Overdrive staff view', exportName: `team-${at.number}`, members: at.members }));
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
          const [events, reports, members] = await Promise.all([store.api.adminEvents(r.team_id), store.api.teamReports(r.team_id), store.api.adminMembers(r.team_id)]);
          if (S.adminTeam !== at) return;                      // they moved on while it loaded
          Object.assign(at, { events, reports, members, loaded: true, eventId: '' }); renderView();
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
$('#tb-sync').addEventListener('click', () => {
  const q = store.pending(S.mem?.team?.id);
  sheet('Sync', q.length ? `${q.length} waiting on this device.` : 'Everything you filed is saved to your team.', (body, close) => {
    for (const item of q) {
      const r = item.row;
      body.append(h('div', { class: 'ritem' }, h('div', { class: 'rmain' }, h('b', { text: item.kind === 'pit' ? `Pit · ${r.robot_number}` : `${matchLabel(r.match_type, r.match_number)} · ${r.robot_number}` }),
        h('small', { class: item.error ? 'err' : 'muted', text: item.error || 'Waiting for a connection' })),
        item.error ? h('button', { class: 'b b-ghost sm', type: 'button', text: 'Discard', onclick: () => { store.dropQueued(item); close(); } }) : null));
    }
    body.append(h('div', { class: 'row' }, h('button', { class: 'b b-primary', type: 'button', onclick: async () => { close(); await store.flush({ retry: true }); const left = store.pending(S.mem?.team?.id); toast(!left.length ? 'All synced' : left.some((x) => x.error) ? 'Some reports were refused. Open Sync to review them.' : 'Still offline. Will retry.'); } }, icon('refresh'), h('span', { text: 'Sync now' }))));
  });
});
$('#tb-avatar').addEventListener('click', () => go('team'));
window.addEventListener('pageshow', () => store.flush().catch(() => {}));
// coming back to the app (or back online) pulls in teammates' reports; the scouting form is never redrawn under you
let lastPull = Date.now();
async function pull() {
  if (!S.mem || !S.eventId || document.hidden || Date.now() - lastPull < 20000) return;
  lastPull = Date.now();
  if (await loadEventData() && ['data', 'picks', 'admin'].includes(S.view) && !document.querySelector('.scrim')) renderView();
}
document.addEventListener('visibilitychange', () => { pull().catch(() => {}); });
window.addEventListener('online', () => { lastPull = 0; pull().catch(() => {}); });
setInterval(() => { pull().catch(() => {}); }, 60000);
// keep a copy of Scout on the phone so it opens with no signal (demo mode stays out of it)
if ('serviceWorker' in navigator && !DEMO && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
document.addEventListener('visibilitychange', () => { if (!document.hidden) store.flush().catch(() => {}); });

boot().catch((e) => { console.error(e); renderFatal(friendly(e), true); });
