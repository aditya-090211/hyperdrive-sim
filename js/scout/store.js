// Overdrive Scout data layer: Supabase (email sign-in, row-level security) plus an offline queue so reports
// filed with no signal are kept on the device and synced later. On localhost, ?demo=1 swaps in an in-memory
// backend so the interface can be exercised without a real account (never available on a real host).
import { getClient, signInUrl } from '../auth-client.js';
import { TERMS_VERSION, pointsOf, cleanReport, cleanPit } from './game.js';

const QUEUE_KEY = 'od.scout.queue';
const CACHE_KEY = 'od.scout.cache';
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
export const DEMO = LOCAL_HOSTS.includes(location.hostname) && new URLSearchParams(location.search).get('demo') === '1';

const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* storage blocked */ } },
};
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

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
    if (navigator.onLine === false) { const s = storedSession(); if (s) return s; }
    try {
      const { data } = await timeout(this.c.auth.getSession(), 6000);
      return data.session || (navigator.onLine === false ? storedSession() : null);
    } catch { return storedSession(); }
  }
  onAuth(fn) { this.c.auth.onAuthStateChange((_e, s) => fn(s)); }
  async signIn() { location.href = signInUrl('/scout'); }
  async signOut() { await this.c.auth.signOut(); }
  async q(p) {
    if (navigator.onLine === false) throw new Error(friendly({ message: 'Failed to fetch' }));
    const { data, error } = await timeout(p, 9000);
    if (error) throw new Error(friendly(error));
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
  createEvent(teamId, name, startsOn) { return this.q(this.c.from('scout_events').insert({ team_id: teamId, name, starts_on: startsOn || null }).select('id, team_id, name, starts_on, created_at').single()); }
  renameEvent(id, name, startsOn) { return this.q(this.c.from('scout_events').update({ name, starts_on: startsOn || null }).eq('id', id)); }
  deleteEvent(id) { return this.q(this.c.from('scout_events').delete().eq('id', id)); }
  reports(eventId) { return this.q(this.c.from('scout_reports').select('*').eq('event_id', eventId).order('match_number').limit(5000)); }
  teamReports(teamId) { return this.q(this.c.from('scout_reports').select('*').eq('team_id', teamId).order('created_at', { ascending: false }).limit(5000)); }
  upsertReport(r) { return this.q(this.c.from('scout_reports').upsert(r, { onConflict: 'id' })); }
  deleteReport(id) { return this.q(this.c.from('scout_reports').delete().eq('id', id)); }
  pits(eventId) { return this.q(this.c.from('scout_pits').select('*').eq('event_id', eventId).limit(2000)); }
  async upsertPit(p) {
    // one pit report per robot per event: update the existing row if there is one
    const found = await this.q(this.c.from('scout_pits').select('id').eq('event_id', p.event_id).eq('robot_number', p.robot_number).maybeSingle());
    if (found) {
      const rows = await this.q(this.c.from('scout_pits').update({ data: p.data }).eq('id', found.id).select('id'));
      if (!rows?.length) throw new Error('Only the scout who filed this pit report, or a team lead, can change it.');
      return rows;
    }
    return this.q(this.c.from('scout_pits').insert(p));
  }
  isAdmin() { return this.rpc('scout_is_admin'); }
  adminOverview() { return this.rpc('scout_admin_overview'); }
  adminEvents(teamId) { return this.events(teamId); }
  adminMembers(teamId) { return this.q(this.c.from('scout_members').select('user_id, role, display_name, joined_at').eq('team_id', teamId)); }
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
  // the demo keeps its state for this tab, so a reload carries on where you were
  wait(v) { try { sessionStorage.setItem('od.scout.demo', JSON.stringify(this.db)); } catch { /* ignore */ } return new Promise((r) => setTimeout(() => r(v), 120)); }
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
  async createEvent(teamId, name, startsOn) { const e = { id: uuid(), team_id: teamId, name, starts_on: startsOn || null, created_at: new Date().toISOString() }; this.db.events.unshift(e); return this.wait(e); }
  async renameEvent(id, name, startsOn) { const e = this.db.events.find((x) => x.id === id); if (e) { e.name = name; e.starts_on = startsOn || null; } return this.wait(); }
  async deleteEvent(id) { this.db.events = this.db.events.filter((e) => e.id !== id); this.db.reports = this.db.reports.filter((r) => r.event_id !== id); return this.wait(); }
  async reports(eventId) { return this.wait(this.db.reports.filter((r) => r.event_id === eventId)); }
  async teamReports() { return this.wait([...this.db.reports]); }
  async upsertReport(r) {
    if (new URLSearchParams(location.search).get('offline') === '1') throw new Error('Failed to fetch');
    const i = this.db.reports.findIndex((x) => x.id === r.id);
    const row = { ...r, team_id: this.db.team.id, scout_id: i >= 0 ? this.db.reports[i].scout_id : 'demo-user', points: pointsOf(r.data), created_at: new Date().toISOString() };
    if (i >= 0) this.db.reports[i] = row; else this.db.reports.push(row);
    return this.wait();
  }
  async deleteReport(id) { this.db.reports = this.db.reports.filter((r) => r.id !== id); return this.wait(); }
  async pits(eventId) { return this.wait(this.db.pits.filter((p) => p.event_id === eventId)); }
  async upsertPit(p) { const i = this.db.pits.findIndex((x) => x.event_id === p.event_id && x.robot_number === p.robot_number); const row = { ...p, scout_id: 'demo-user', updated_at: new Date().toISOString() }; if (i >= 0) this.db.pits[i] = { ...this.db.pits[i], data: p.data }; else this.db.pits.push(row); return this.wait(); }
  async isAdmin() { return this.wait(this.db.admin); }
  async adminOverview() { return this.wait(this.db.team ? [{ team_id: this.db.team.id, number: this.db.team.number, name: this.db.team.name, members: this.db.members.length, events: this.db.events.length, reports: this.db.reports.length, pits: this.db.pits.length, last_report: new Date().toISOString() }] : []); }
  async adminEvents() { return this.events(); }
  async adminMembers() { return this.wait(this.db.members); }
  async deleteAccount() { this.db = { ...this.db, signedIn: false, team: null, consent: null }; this.cb?.(null); return this.wait(); }
  seed() {
    const ev = { id: uuid(), team_id: 'team-demo', name: 'Demo Regional', starts_on: '2026-11-14', created_at: new Date().toISOString() };
    this.db.events = [ev];
    const robots = ['009', '1002', '2001', '2002', '317', '4242', '88', '1530'];
    let n = 0;
    for (let m = 1; m <= 12; m++) for (let k = 0; k < 4; k++) {
      const robot = robots[(m * 3 + k * 5) % robots.length], skill = (parseInt(robot, 10) % 7) / 7;
      const r = (a) => Math.max(0, Math.round(a + (Math.random() - 0.5) * 2));
      const data = { v: 1, m_high: r(2 + skill * 4), m_star: r(1 + skill * 3), m_drop: r(1), m_miss: r(2 - skill), l_high: r(skill * 2), l_star: r(skill * 2), l_apex: Math.random() < skill * 0.4 ? 1 : 0, station: ['none', 'engage', 'dock', 'balance'][Math.min(3, Math.floor(skill * 4 + Math.random()))], payload: Math.random() < 0.5 ? 'scored' : 'none', driver: Math.min(5, 1 + Math.round(skill * 4)), defense: Math.round(Math.random() * 2), died: Math.random() < 0.06, note: n % 7 === 0 ? 'Fast cycles, struggled on the ramp' : '' };
      this.db.reports.push({ id: uuid(), team_id: 'team-demo', event_id: ev.id, match_type: 'qm', match_number: m, robot_number: robot, alliance: k < 2 ? 'red' : 'blue', station: (k % 2) + 1, scout_id: k % 2 ? 'demo-2' : 'demo-user', data, points: pointsOf(data), created_at: new Date().toISOString() });
      n++;
    }
  }
}


// ------------------------------------------------------------------ the store the app talks to
export class Store {
  constructor() {
    this.api = DEMO ? new Demo() : (getClient() ? new Remote() : null);
    const q = ls.get(QUEUE_KEY, []);
    this.queue = (Array.isArray(q) ? q.filter((x) => x && typeof x === 'object' && x.row && typeof x.row.id === 'string' && (x.kind === 'report' || x.kind === 'pit')) : [])
      .map((x) => ({ ...x, row: { ...x.row, data: (x.kind === 'report' ? cleanReport : cleanPit)(x.row.data && typeof x.row.data === 'object' ? x.row.data : {}) } }));
    this.listeners = new Set();
    this.syncing = false;
    this.uid = null;                     // reports wait on the device for the account that filed them
    this.dirty = false;
    window.addEventListener('online', () => this.flush());
  }
  get available() { return !!this.api; }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const f of this.listeners) f(); }

  setUser(uid) { this.uid = uid || null; this.emit(); }
  save() { ls.set(QUEUE_KEY, this.queue); }
  // offline queue: newest version of each row wins. Resolves once this row is saved (or still waiting for a
  // connection); rejects only if the server refused this particular row.
  async enqueue(kind, row) {
    this.queue = this.queue.filter((q) => !(q.kind === kind && q.row.id === row.id && q.uid === this.uid));
    const item = { kind, row, at: Date.now(), team: row.team_id, uid: this.uid };
    this.queue.push(item); this.save(); this.emit();
    await this.flush();
    if (this.queue.includes(item) && item.error) throw new Error(item.error);
    return { synced: !this.queue.includes(item) };
  }
  pending(teamId) { return this.queue.filter((q) => q.uid === this.uid && (!teamId || q.team === teamId)); }
  // upload this user's waiting rows. Rows the server refused stay parked (shown in the Sync sheet) until retried.
  async flush({ retry = false } = {}) {
    if (!this.api || !this.uid) return;
    if (this.syncing) { this.dirty = true; return this.running; }
    this.syncing = true; this.emit();
    this.running = (async () => {
      do {
        this.dirty = false;
        for (const item of this.queue.filter((q) => q.uid === this.uid && (retry || !q.error))) {
          if (!this.queue.includes(item)) continue;           // deleted while this sync was running
          try {
            if (item.kind === 'report') await this.api.upsertReport(item.row);
            else if (item.kind === 'pit') await this.api.upsertPit(item.row);
            this.queue = this.queue.filter((q) => q !== item); this.save();
          } catch (e) {
            if (/connection|offline|fetch|timed out/i.test(e.message)) return;        // still offline: everything stays queued
            if (/session|jwt|token/i.test(e.message)) { try { await this.api.c?.auth.refreshSession(); } catch { /* next flush */ } return; }
            item.error = e.message; this.save();
          }
        }
        retry = false;
      } while (this.dirty);
    })();
    try { await this.running; } finally { this.syncing = false; this.running = null; this.emit(); }
  }
  dropQueued(item) { this.queue = this.queue.filter((q) => q !== item); this.save(); this.emit(); }
  dropWhere(fn) { this.queue = this.queue.filter((q) => !(q.uid === this.uid && fn(q))); this.save(); this.emit(); }

  // a small read cache so the last data you saw is there when the venue Wi-Fi is not
  cacheGet(key) { return ls.get(`${CACHE_KEY}.${key}`, null); }
  cacheSet(key, v) { ls.set(`${CACHE_KEY}.${key}`, v); }
  // on sign-out: forget cached team data, drafts and pick lists (reports waiting to sync stay, tagged with their author)
  clearCache() { try { for (const k of Object.keys(localStorage)) if (k.startsWith('od.scout.') && k !== QUEUE_KEY && !k.startsWith('od.scout.picks.')) localStorage.removeItem(k); } catch { /* ignore */ } }
}
