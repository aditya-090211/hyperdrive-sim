// Overdrive Scout data layer. Every read and write goes to the phone's own database first (IndexedDB, js/scout/outbox.js);
// Supabase (email sign-in, row-level security) is synced behind it. On localhost, ?demo=1 swaps in an in-memory
// backend so the interface can be exercised without a real account (never available on a real host).
import { getClient, signInUrl } from '../auth-client.js';
import { SUPABASE_URL, SUPABASE_KEY } from '../supabase-config.js';
import { TERMS_VERSION, pointsOf, robotKey } from './game.js';

const db = self.OdOutbox;
// what can wait on the device: match reports, pit reports, pick lists, events made offline and deletions of reports
const KINDS = ['report', 'pit', 'picks', 'event', 'del'];
const SYNC_TAG = 'od-scout-sync';
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
export const DEMO = LOCAL_HOSTS.includes(location.hostname) && new URLSearchParams(location.search).get('demo') === '1';

const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* storage blocked */ } },
};
export const uuid = db.uuid;

// the session supabase-js saved on this device (shared storage key with the simulator)
function storedSession() {
  try { const s = JSON.parse(localStorage.getItem('hyperdrive.auth') || 'null'); return s && s.user && s.user.id ? s : null; } catch { return null; }
}
const timeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('Failed to fetch (timed out)')), ms))]);

export function friendly(err) {
  const m = (err && (err.message || err.error_description || String(err))) || 'Something went wrong';
  if (/failed to fetch|network|load failed/i.test(m)) return 'No connection. Try again when you are back online.';
  if (/jwt|not signed in|invalid claim|session/i.test(m)) return 'Your session ended. Sign in again.';
  if (/row-level security|permission denied/i.test(m)) return 'You do not have access to do that.';
  if (/scout_reports_data_valid|scout_pits_data_valid|check constraint/i.test(m)) return 'Some values were out of range. Check the form and try again.';
  if (/duplicate key.*scout_pits/i.test(m)) return 'This robot already has a pit report for this event.';
  if (/wrong codes/i.test(m)) return 'Too many wrong codes. Wait 15 minutes and try again.';
  if (/rate limit|too many/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
  return m.replace(/^error:\s*/i, '');
}

// ------------------------------------------------------------------ Supabase backend
class Remote {
  constructor() {
    this.c = getClient();                      // the one Overdrive account, shared with the simulator
  }
  // at a venue with no signal the token refresh can hang for half a minute and then sign you out: open from the
  // session saved on this device instead, and let it refresh once the connection is back
  async session() {
    const stored = storedSession();
    if (navigator.onLine === false && stored) return stored;
    try {
      // with a session already on the device, do not let dead venue Wi-Fi hold the app at the door
      const { data } = await timeout(this.c.auth.getSession(), stored ? 2500 : 6000);
      return data.session || (navigator.onLine === false ? stored : null);
    } catch { return stored; }
  }
  onAuth(fn) { this.c.auth.onAuthStateChange((event, s) => fn(s, event)); }
  // true: a fresh token; false: the server refused the saved sign-in; null: no connection to ask over
  async refresh() {
    try {
      const { data, error } = await timeout(this.c.auth.refreshSession(), 9000);
      if (!error) return !!data.session;
      return /fetch|network|timed out|load failed/i.test(error.message || '') || error.name === 'AuthRetryableFetchError' ? null : false;
    } catch { return null; }
  }
  async signIn() { location.href = signInUrl('/scout'); }
  async signOut() { await this.c.auth.signOut(); }
  async q(p) {
    if (navigator.onLine === false) { this.onNet?.(false); throw new Error(friendly({ message: 'Failed to fetch' })); }
    let res;
    try { res = await timeout(p, 9000); } catch (e) { if (/fetch|network|timed out|load failed/i.test(e.message)) this.onNet?.(false); throw new Error(friendly(e)); }
    const { data, error } = res;
    if (error) { this.onNet?.(!/failed to fetch|network|load failed/i.test(error.message || '')); throw new Error(friendly(error)); }
    this.onNet?.(true);
    return data;
  }
  rpc(fn, args) { return this.q(this.c.rpc(fn, args)); }
  async consent(uid) { return this.q(this.c.from('scout_consents').select('terms_version, accepted_at').eq('user_id', uid).maybeSingle()); }
  acceptTerms() { return this.rpc('scout_accept_terms', { version: TERMS_VERSION }); }
  async membership(uid) {
    const me = await this.q(this.c.from('scout_members').select('team_id, role, display_name').eq('user_id', uid).maybeSingle());
    if (!me) return null;
    const [team, members] = await Promise.all([
      this.q(this.c.from('scout_teams').select('id, number, name, created_at').eq('id', me.team_id).single()),
      this.q(this.c.from('scout_members').select('user_id, role, display_name, joined_at').eq('team_id', me.team_id).order('joined_at')),
    ]);
    return { team, role: me.role, displayName: me.display_name, members };
  }
  createTeam(number, name, displayName) { return this.rpc('scout_create_team', { team_number: number, team_name: name, display_name: displayName }); }
  async joinTeam(code, displayName) {
    const id = await this.rpc('scout_join_team', { code, display_name: displayName });
    if (!id) throw new Error('That join code does not match a team');
    return id;
  }
  leaveTeam() { return this.rpc('scout_leave_team'); }
  teamCode() { return this.rpc('scout_team_code'); }
  rotateCode() { return this.rpc('scout_rotate_code'); }
  setRole(uid, role) { return this.rpc('scout_set_role', { member: uid, new_role: role }); }
  transferOwner(uid) { return this.rpc('scout_transfer_owner', { member: uid }); }
  removeMember(uid) { return this.rpc('scout_remove_member', { member: uid }); }
  renameTeam(id, name) { return this.q(this.c.from('scout_teams').update({ name }).eq('id', id)); }
  renameSelf(teamId, uid, name) { return this.q(this.c.from('scout_members').update({ display_name: name }).eq('team_id', teamId).eq('user_id', uid)); }
  events(teamId) { return this.q(this.c.from('scout_events').select('id, team_id, name, starts_on, created_at').eq('team_id', teamId).order('created_at', { ascending: false })); }
  renameEvent(id, name, startsOn) { return this.q(this.c.from('scout_events').update({ name, starts_on: startsOn || null }).eq('id', id)); }
  deleteEvent(id) { return this.q(this.c.from('scout_events').delete().eq('id', id)); }
  reports(eventId) { return this.q(this.c.from('scout_reports').select('*').eq('event_id', eventId).order('match_number').limit(5000)); }
  teamReports(teamId) { return this.q(this.c.from('scout_reports').select('*').eq('team_id', teamId).order('created_at', { ascending: false }).limit(5000)); }
  pits(eventId) { return this.q(this.c.from('scout_pits').select('*').eq('event_id', eventId).limit(2000)); }
  picks(eventId) { return this.q(this.c.from('scout_picklists').select('event_id, data, updated_at').eq('event_id', eventId).maybeSingle()); }
  // replay one offline write: { status: 'ok', row } or { status: 'conflict', server }
  push(item) { return this.rpc(...db.rpcOf(item)); }
  isAdmin() { return this.rpc('scout_is_admin'); }
  adminOverview() { return this.rpc('scout_admin_overview'); }
  adminEvents(teamId) { return this.events(teamId); }
  adminMembers(teamId) { return this.q(this.c.from('scout_members').select('user_id, role, display_name, joined_at').eq('team_id', teamId)); }
  // team 009 / staff: every team's events, and the reports and pit reports filed at a set of them (read only)
  allTeams() { return this.q(this.c.from('scout_teams').select('id, number, name').limit(2000)); }
  allEvents() { return this.q(this.c.from('scout_events').select('id, team_id, name, starts_on, created_at').order('created_at', { ascending: false }).limit(5000)); }
  reportsAt(eventIds) { return eventIds.length ? this.q(this.c.from('scout_reports').select('*').in('event_id', eventIds).limit(20000)) : Promise.resolve([]); }
  pitsAt(eventIds) { return eventIds.length ? this.q(this.c.from('scout_pits').select('*').in('event_id', eventIds).limit(5000)) : Promise.resolve([]); }
  teamPits(teamId) { return this.q(this.c.from('scout_pits').select('*').eq('team_id', teamId).limit(5000)); }
  deleteAccount() { return this.rpc('delete_my_account'); }
}

// ------------------------------------------------------------------ localhost demo backend (in memory)
class Demo {
  constructor() {
    const me = { id: 'demo-user', email: 'scout@example.test', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { full_name: 'Demo Scout' } };
    const qp = new URLSearchParams(location.search);
    let saved = null; try { saved = JSON.parse(sessionStorage.getItem('od.scout.demo') || 'null'); } catch { /* fresh demo */ }
    this.db = saved && qp.get('fresh') !== '1' ? saved : { me, signedIn: qp.get('signedin') !== '0', consent: null, team: null, role: null, members: [], events: [], reports: [], pits: [], code: 'DEMO2345' };
    this.db.admin = qp.get('admin') === '1';
    this.cb = null;
  }
  // the demo keeps its state for this tab, so a reload carries on where you were. ?offline=1 (or the
  // od.scout.demo.offline session flag) makes every request fail the way a dead connection does
  offline() { try { return new URLSearchParams(location.search).get('offline') === '1' || navigator.onLine === false || sessionStorage.getItem('od.scout.demo.offline') === '1'; } catch { return false; } }
  wait(v) {
    try { sessionStorage.setItem('od.scout.demo', JSON.stringify(this.db)); } catch { /* ignore */ }
    return new Promise((r, no) => setTimeout(() => { if (this.offline()) { this.onNet?.(false); no(new Error('No connection. Try again when you are back online.')); } else { this.onNet?.(true); r(v); } }, 120));
  }
  async session() { return this.db.signedIn ? { user: this.db.me } : null; }
  onAuth(fn) { this.cb = fn; }
  async signIn() { this.db.signedIn = true; await this.wait(); this.cb?.({ user: this.db.me }); }
  async signOut() { this.db.signedIn = false; await this.wait(); this.cb?.(null); }
  async consent() { return this.wait(this.db.consent); }
  async acceptTerms() { this.db.consent = { terms_version: TERMS_VERSION, accepted_at: new Date().toISOString() }; return this.wait(); }
  async membership() {
    if (!this.db.team) return this.wait(null);
    return this.wait({ team: this.db.team, role: this.db.role, displayName: this.db.members[0].display_name, members: this.db.members });
  }
  async createTeam(number, name, displayName) {
    if (!/^[0-9]{1,6}$/.test(number)) throw new Error('Team numbers are 1 to 6 digits');
    this.db.team = { id: 'team-demo', number, name, created_at: new Date().toISOString() }; this.db.role = 'owner';
    this.db.members = [{ user_id: 'demo-user', role: 'owner', display_name: displayName, joined_at: new Date().toISOString() },
      { user_id: 'demo-2', role: 'scout', display_name: 'Riya', joined_at: new Date().toISOString() }];
    this.seed(); return this.wait('team-demo');
  }
  async joinTeam(code, displayName) { if (String(code).toUpperCase() !== this.db.code) throw new Error('That join code does not match a team'); return this.createTeam('4242', 'Demo Robotics', displayName); }
  async leaveTeam() { this.db.team = null; this.db.members = []; this.db.events = []; this.db.reports = []; return this.wait(); }
  async teamCode() { return this.wait(this.db.role === 'scout' ? null : this.db.code); }
  async rotateCode() { this.db.code = 'NEW' + Math.random().toString(36).slice(2, 7).toUpperCase(); return this.wait(this.db.code); }
  async setRole(uid, role) { const m = this.db.members.find((x) => x.user_id === uid); if (m) m.role = role; return this.wait(); }
  async transferOwner(uid) { for (const m of this.db.members) m.role = m.user_id === uid ? 'owner' : m.role === 'owner' ? 'lead' : m.role; this.db.role = 'lead'; return this.wait(); }
  async removeMember(uid) { this.db.members = this.db.members.filter((m) => m.user_id !== uid); return this.wait(); }
  async renameTeam(_id, name) { this.db.team.name = name; return this.wait(); }
  async renameSelf(_t, _u, name) { this.db.members[0].display_name = name; return this.wait(); }
  async events() { return this.wait([...this.db.events]); }
  async renameEvent(id, name, startsOn) { const e = this.db.events.find((x) => x.id === id); if (e) { e.name = name; e.starts_on = startsOn || null; } return this.wait(); }
  async deleteEvent(id) { this.db.events = this.db.events.filter((e) => e.id !== id); this.db.reports = this.db.reports.filter((r) => r.event_id !== id); return this.wait(); }
  async reports(eventId) { return this.wait(this.db.reports.filter((r) => r.event_id === eventId)); }
  async teamReports(teamId) { return this.wait([...(this.allTeamRows().find((t) => t.team.id === teamId)?.reports || this.db.reports)]); }
  async pits(eventId) { return this.wait(this.db.pits.filter((p) => p.event_id === eventId)); }
  async picks(eventId) { return this.wait((this.db.picks || []).find((p) => p.event_id === eventId) || null); }
  // the same replies as the scout_push_* functions in supabase/scouting-offline.sql
  stamp() { this.clock = Math.max(Date.now(), (this.clock || 0) + 1); return new Date(this.clock).toISOString(); }
  async push({ kind, row, base, mid }) {
    if (this.offline()) return this.wait();
    const ok = (cur) => this.wait({ status: 'ok', row: cur }), conflict = (cur) => this.wait({ status: 'conflict', server: cur });
    if (kind === 'event') {
      let e = this.db.events.find((x) => x.id === row.id);
      if (!e) { e = { id: row.id, team_id: this.db.team.id, name: row.name, starts_on: row.starts_on || null, created_at: this.stamp() }; this.db.events.unshift(e); }
      return ok(e);
    }
    if (kind === 'del') {
      const cur = this.db.reports.find((r) => r.id === row.id);
      if (cur && base && cur.updated_at !== base) return conflict(cur);
      this.db.reports = this.db.reports.filter((r) => r.id !== row.id);
      return ok(null);
    }
    const list = kind === 'report' ? this.db.reports : kind === 'pit' ? this.db.pits : (this.db.picks = this.db.picks || []);
    const i = list.findIndex((x) => (kind === 'report' ? x.id === row.id : x.event_id === row.event_id && (kind === 'picks' || robotKey(x.robot_number) === robotKey(row.robot_number))));
    const cur = list[i], t = this.stamp();
    if (!cur) {
      if (base && kind !== 'picks') return conflict(null);
      list.push({ ...row, team_id: this.db.team.id, scout_id: 'demo-user', ...(kind === 'report' ? { points: pointsOf(row.data) } : {}), created_at: t, updated_at: t, client_rev: mid });
      return ok(list[list.length - 1]);
    }
    if (cur.client_rev === mid) return ok(cur);
    if (!base || cur.updated_at !== base) return conflict(cur);
    list[i] = { ...cur, ...row, id: cur.id, scout_id: cur.scout_id, ...(kind === 'report' ? { points: pointsOf(row.data) } : {}), updated_at: t, client_rev: mid };
    return ok(list[i]);
  }
  // like the server: staff, or anyone on team 009
  is009() { return this.db.admin || (this.db.team && (parseInt(this.db.team.number, 10) || 0) === 9); }
  async isAdmin() { return this.wait(!!this.is009()); }
  allTeamRows() { return [...(this.db.team ? [{ team: this.db.team, members: this.db.members, events: this.db.events, reports: this.db.reports, pits: this.db.pits }] : []), ...(this.is009() ? this.db.others || [] : [])]; }
  async adminOverview() { return this.wait(this.allTeamRows().map((t) => ({ team_id: t.team.id, number: t.team.number, name: t.team.name, members: t.members.length, events: t.events.length, reports: t.reports.length, pits: t.pits.length, last_report: new Date().toISOString() }))); }
  async adminEvents(teamId) { return this.wait([...(this.allTeamRows().find((t) => t.team.id === teamId)?.events || [])]); }
  async adminMembers(teamId) { return this.wait(this.allTeamRows().find((t) => t.team.id === teamId)?.members || []); }
  async allTeams() { return this.wait(this.allTeamRows().map((t) => ({ id: t.team.id, number: t.team.number, name: t.team.name }))); }
  async allEvents() { return this.wait(this.allTeamRows().flatMap((t) => t.events)); }
  async reportsAt(ids) { return this.wait(this.allTeamRows().flatMap((t) => t.reports).filter((r) => ids.includes(r.event_id))); }
  async pitsAt(ids) { return this.wait(this.allTeamRows().flatMap((t) => t.pits).filter((p) => ids.includes(p.event_id))); }
  async teamPits(teamId) { return this.wait(this.allTeamRows().find((t) => t.team.id === teamId)?.pits || []); }
  async deleteAccount() { this.db = { ...this.db, signedIn: false, team: null, consent: null }; this.cb?.(null); return this.wait(); }
  seed() {
    const ev = { id: uuid(), team_id: 'team-demo', name: 'Demo Regional', starts_on: '2026-11-14', created_at: new Date().toISOString() };
    this.db.events = [ev];
    this.db.reports = []; this.db.pits = [];
    this.db.others = [['1530', 'Ironclad', 'Demo regional', 16, '2026-11-14'], ['2001', 'Byte Force', 'DEMO REGIONAL 2026', 14, null], ['317', 'Tidebreakers', 'Pune Scrimmage', 6, '2026-10-02']].map(([number, name, evName, matches, date]) => {
      const team = { id: `team-${number}`, number, name, created_at: new Date().toISOString() };
      const e = { id: uuid(), team_id: team.id, name: evName, starts_on: date, created_at: new Date().toISOString() };
      const t = { team, members: [{ user_id: `u-${number}`, role: 'owner', display_name: `${name} lead`, joined_at: team.created_at }], events: [e], reports: [], pits: [] };
      this.seedReports(t.reports, team.id, e.id, matches, `u-${number}`);
      t.pits.push({ id: uuid(), team_id: team.id, event_id: e.id, robot_number: '88', scout_id: `u-${number}`, data: { v: 1, drive: 'swerve', apex: true, station: 'balance', strategy: `Told ${name}: they want a partner that docks` }, updated_at: team.created_at });
      return t;
    });
    this.seedReports(this.db.reports, 'team-demo', ev.id, 12, null);
  }
  seedReports(out, teamId, eventId, matches, scout) {
    const robots = ['009', '1002', '2001', '2002', '317', '4242', '88', '1530'];
    let n = 0;
    for (let m = 1; m <= matches; m++) for (let k = 0; k < 4; k++) {
      const robot = robots[(m * 3 + k * 5) % robots.length], skill = (parseInt(robot, 10) % 7) / 7;
      const r = (a) => Math.max(0, Math.round(a + (Math.random() - 0.5) * 2));
      const data = { v: 1, m_high: r(2 + skill * 4), m_star: r(1 + skill * 3), m_drop: r(1), m_miss: r(2 - skill), l_high: r(skill * 2), l_star: r(skill * 2), l_apex: Math.random() < skill * 0.4 ? 1 : 0, station: ['none', 'engage', 'dock', 'balance'][Math.min(3, Math.floor(skill * 4 + Math.random()))], payload: Math.random() < 0.5 ? 'scored' : 'none', driver: Math.min(5, 1 + Math.round(skill * 4)), defense: Math.round(Math.random() * 2), died: Math.random() < 0.06, note: n % 7 === 0 ? 'Fast cycles, struggled on the ramp' : '' };
      out.push({ id: uuid(), team_id: teamId, event_id: eventId, match_type: 'qm', match_number: m, robot_number: robot, alliance: k < 2 ? 'red' : 'blue', station: (k % 2) + 1, scout_id: scout || (k % 2 ? 'demo-2' : 'demo-user'), data, points: pointsOf(data), created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      n++;
    }
  }
}


// ------------------------------------------------------------------ the store the app talks to
export class Store {
  constructor() {
    this.api = DEMO ? new Demo() : (getClient() ? new Remote() : null);
    this.kv = new Map();                 // the phone's copy of what this account may see (mirrors the 'kv' table)
    this.queue = [];                     // unsynced creates, edits and deletes (mirrors the 'outbox' table)
    this.listeners = new Set();
    this.syncing = false;
    this.uid = null;                     // entries wait on the device for the account that filed them
    this.team = null;                    // ...and are only ever sent for the team that account is on now
    this.reachable = true;               // false after a request fails for want of a connection (dead Wi-Fi counts)
    this.authStale = false;              // the saved sign-in was refused: uploads wait until the scout signs in again
    this.delay = 5000;
    if (this.api) this.api.onNet = (ok) => { if (ok !== this.reachable) { this.reachable = ok; this.emit(); if (ok) this.flush(); } };
    window.addEventListener('online', () => { this.reachable = true; this.delay = 5000; this.emit(); this.flush(); });
    window.addEventListener('offline', () => this.emit());
  }
  get available() { return !!this.api; }
  get online() { return navigator.onLine !== false && this.reachable; }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const f of this.listeners) f(); }

  // read the phone's database into memory once, so every later read is synchronous
  async init() {
    if (DEMO && new URLSearchParams(location.search).get('fresh') === '1') await Promise.all([db.clear('kv'), db.clear('outbox')]);
    await this.reload();
    await this.adoptLegacy();
  }
  // also run when the service worker has synced with the app in the background
  async reload() {
    const [names, values, queue] = await Promise.all([db.keys('kv'), db.all('kv'), db.all('outbox')]);
    names.forEach((k, i) => this.kv.set(k, values[i]));
    this.queue = queue; this.emit();
  }
  // earlier versions kept the queue and the read cache in localStorage: move them over once
  async adoptLegacy() {
    const old = ls.get('od.scout.queue', null);
    for (const x of Array.isArray(old) ? old : []) {
      if (!x || !x.row || typeof x.row.id !== 'string' || !KINDS.includes(x.kind) || !x.uid) continue;
      const item = { key: `${x.uid}|${x.kind === 'del' ? 'report' : x.kind}|${x.row.id}`, kind: x.kind, row: x.row, at: x.at || Date.now(), team: x.team || x.row.team_id, uid: x.uid, mid: uuid(), revs: [], base: null, snap: null, tries: 0, error: null, conflict: null };
      await db.put('outbox', item); this.queue.push(item);
    }
    ls.del('od.scout.queue');
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('od.scout.cache.')) this.cacheSet(k.slice(15), ls.get(k, null));
      else if (k.startsWith('od.scout.picks.')) this.cacheSet(`picks.${k.slice(15)}`, { data: ls.get(k, []), updated_at: null });
      else continue;
      ls.del(k);
    }
  }

  setUser(uid) { this.uid = uid || null; this.emit(); }
  setTeam(id) { if (this.team !== (id || null)) { this.team = id || null; this.saveAuth(); } }
  // the service worker uploads with this when Background Sync wakes it with the app closed (it never refreshes it)
  setSession(s) { this.session = s && s.access_token ? s : null; this.saveAuth(); }
  saveAuth() {
    if (DEMO) return;
    const s = this.session;
    const v = s && this.team ? { url: SUPABASE_URL, key: SUPABASE_KEY, token: s.access_token, exp: s.expires_at || 0, uid: s.user?.id, team: this.team } : null;
    (v ? db.put('kv', v, 'auth') : db.del('kv', 'auth')).catch(() => {});
  }

  // the copy of this record the server last gave this phone: what an edit is later compared against
  serverRow(kind, row) {
    if (kind === 'picks') { const p = this.kv.get(`picks.${row.event_id}`); return p && p.updated_at ? { event_id: row.event_id, data: p.data, updated_at: p.updated_at } : null; }
    const c = this.kv.get(`ev.${row.event_id}`);
    if (!c || kind === 'event') return null;
    return (kind === 'pit' ? (c.pits || []).find((p) => p.id === row.id || robotKey(p.robot_number) === robotKey(row.robot_number)) : (c.reports || []).find((r) => r.id === row.id)) || null;
  }
  // Save a create, edit or delete on the phone, then try to upload it. Resolves once it is safely stored (synced or
  // still waiting for a connection); rejects if the phone could not store it or the server refused this entry.
  async enqueue(kind, row) {
    const key = `${this.uid}|${kind === 'del' ? 'report' : kind}|${row.id}`;
    const old = this.queue.find((q) => q.key === key);
    const snap = old ? old.snap : this.serverRow(kind, row);
    const item = { key, kind, row, at: old?.at || Date.now(), team: row.team_id, uid: this.uid, mid: uuid(), revs: old ? [...old.revs, old.mid] : [],
      base: old ? old.base : snap?.updated_at || null, snap, tries: 0, error: null, conflict: old?.conflict || null, attempted: !!old?.attempted };
    await db.put('outbox', item);
    this.queue = [...this.queue.filter((q) => q.key !== key), item];
    this.emit();
    this.askBackgroundSync();
    await this.flush();
    const left = this.queue.find((q) => q.key === key);
    if (left?.error) throw new Error(left.error);
    return { synced: !left };
  }
  pending(teamId) { return this.queue.filter((q) => q.uid === this.uid && (!teamId || q.team === teamId)); }
  pendingOf(kind, teamId) { return this.pending(teamId).filter((q) => q.kind === kind); }
  // one status for the whole app: Offline, Syncing, Synced or Needs attention, with the number of unsynced entries
  status() {
    const mine = this.pending(this.team), stuck = mine.filter((q) => q.error || q.conflict).length;
    const state = this.syncing ? 'syncing' : stuck || this.authStale ? 'attention' : !this.online ? 'offline' : mine.length ? 'syncing' : 'synced';
    return { state, unsynced: mine.length, stuck, auth: this.authStale };
  }

  async send(item) {
    if (!item.attempted) { item.attempted = true; await db.put('outbox', item); }
    try { return await this.api.push(item); } catch (e) {
      if (/connection|offline|fetch|timed out/i.test(e.message)) e.offline = true;
      else if (/session|jwt|token|signed in/i.test(e.message)) e.auth = true;
      throw e;
    }
  }
  // Upload this account's waiting entries. One run at a time; a call made during a run queues one more pass.
  async flush({ retry = false } = {}) {
    if (!this.api || !this.uid || !this.team) return;
    if (this.running) { this.again = { retry: retry || !!this.again?.retry }; return this.running; }
    this.syncing = true; this.emit();
    this.running = (async () => {
      let pass = { retry }, refreshed = false;
      while (pass) {
        this.again = null;
        const res = await db.push((item) => this.send(item), { uid: this.uid, team: this.team, retry: pass.retry });
        this.queue = await db.all('outbox');
        for (const k of res.touched) this.kv.set(k, await db.get('kv', k));
        if (res.sent) this.delay = 5000;
        if (res.stop === 'offline') this.reachable = false;
        else if (res.stop === 'auth') {
          // the token ran out while the phone was offline: get a new one and go again, once
          const fresh = refreshed ? false : await this.api.refresh?.();
          refreshed = true;
          if (fresh) this.again = this.again || { retry: false };
          else if (fresh === null) this.reachable = false;
          else this.authStale = true;
        } else this.authStale = false;
        pass = this.again;
      }
    })();
    try { await this.running; } catch (e) { console.error(e); } finally { this.running = null; this.syncing = false; this.schedule(); this.emit(); }
  }
  // while entries are still waiting, try again by timer: 5 s, doubling to 5 min (the online event and coming back to
  // the app also trigger a sync, and Background Sync covers a closed app where the browser supports it)
  schedule() {
    clearTimeout(this.timer);
    if (!this.queue.some((q) => q.uid === this.uid && !q.error && !q.conflict)) { this.delay = 5000; return; }
    this.timer = setTimeout(() => this.flush(), this.delay);
    this.delay = Math.min(this.delay * 2, 300000);
    this.askBackgroundSync();
  }
  askBackgroundSync() { navigator.serviceWorker?.ready.then((r) => r.sync?.register(SYNC_TAG)).catch(() => {}); }

  // settle a conflict: 'mine' sends this phone's version over the server's, 'theirs' keeps the server's and drops this one
  async resolve(item, choice) {
    const server = item.conflict?.server || null;
    if (choice === 'theirs') {
      await db.del('outbox', item.key);
      const touched = await db.applyRow(server ? item : { kind: 'del', row: item.row }, server);
      for (const k of touched) this.kv.set(k, await db.get('kv', k));
      this.queue = this.queue.filter((q) => q.key !== item.key); this.emit();
      return;
    }
    const next = { ...item, row: server && item.kind === 'pit' ? { ...item.row, id: server.id } : item.row, base: server ? server.updated_at : null, snap: server,
      revs: [...item.revs, item.mid], mid: uuid(), conflict: null, error: null };
    await db.put('outbox', next);
    this.queue = this.queue.map((q) => (q.key === item.key ? next : q));
    await this.flush({ retry: true });
  }
  dropQueued(item) { this.dropWhere((q) => q.key === item.key); }
  dropWhere(fn) {
    const gone = this.queue.filter((q) => q.uid === this.uid && fn(q));
    this.queue = this.queue.filter((q) => !gone.includes(q));
    for (const q of gone) db.del('outbox', q.key).catch(() => {});
    this.emit();
  }

  cacheGet(key) { const v = this.kv.get(key); return v == null ? null : structuredClone(v); }
  cacheSet(key, v) {
    if (v == null) { this.kv.delete(key); db.del('kv', key).catch(() => {}); return; }
    this.kv.set(key, v); db.put('kv', v, key).catch(() => {});
  }
  // on sign-out: forget everything this account could see (team data, other teams' data, pick lists, drafts).
  // Entries that have not synced stay in the outbox, tagged with their author, and upload when that scout signs in again.
  clearLocal() {
    this.kv.clear(); this.session = null; this.team = null; this.authStale = false; clearTimeout(this.timer);
    try { for (const k of Object.keys(localStorage)) if (k.startsWith('od.scout.')) localStorage.removeItem(k); } catch { /* storage blocked */ }
    return db.clear('kv').catch(() => {});
  }
}
