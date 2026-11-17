// Team sync: pushes reading summaries (never photos) to server.py and reads a team back.
import { store } from './store.js';

const QUEUE_KEY = 'hs_sync_queue';
const QUEUE_MAX = 500;
let started = false, flushing = false;

export const CODE_RE = /^[a-z0-9-]{3,32}$/;
export function normalizeCode(code){ return String(code || '').trim().toLowerCase(); }
export function validCode(code){ return CODE_RE.test(normalizeCode(code)); }

function base(){ return String(store.settings().syncUrl || '').trim().replace(/\/+$/, ''); }
function teamUrl(code){ return `${base()}/api/team/${encodeURIComponent(code)}`; }

export function summaryOf(reading){
  const n = v => (typeof v === 'number' && isFinite(v)) ? Math.round(v * 100) / 100 : null;
  return {
    id: String(reading.id),
    t: reading.t,
    score: n(reading.score),
    band: reading.band,
    ph: n(reading.ph),
    conf: n(reading.conf),
    tags: Array.isArray(reading.tags) ? reading.tags.slice(0, 20) : [],
    hex: reading.test && reading.test.hex ? reading.test.hex : (reading.hex || '#808080')
  };
}

function readQueue(){ const q = store.kv.get(QUEUE_KEY, []); return Array.isArray(q) ? q : []; }
function writeQueue(q){ store.kv.set(QUEUE_KEY, q.slice(-QUEUE_MAX)); }
export function queueLength(){ return readQueue().length; }

async function post(code, body){
  const res = await fetch(`${teamUrl(code)}/reading`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (res.ok) return true;
  // 4xx (other than 408/429) means the server rejected the data: retrying will not help.
  if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) return 'reject';
  throw new Error('HTTP ' + res.status);
}

function enqueue(item){
  const q = readQueue().filter(x => !(x.code === item.code && x.body.reading.id === item.body.reading.id));
  q.push(item); writeQueue(q);
}

// Push one reading for a profile. No-op without a team code; never throws.
export async function pushReading(reading, profile){
  try{
    const code = normalizeCode(store.settings().teamCode);
    if (!code || !CODE_RE.test(code) || !reading || !profile) return false;
    const body = { player: { id: String(profile.id), name: String(profile.name || 'Player').slice(0, 60) }, reading: summaryOf(reading) };
    try{
      const r = await post(code, body);
      return r === true;
    }catch(e){
      enqueue({ code, body, at: Date.now() });
      return false;
    }
  }catch(e){ return false; }
}

export async function flushQueue(){
  if (flushing) return;
  flushing = true;
  try{
    let q = readQueue();
    if (!q.length) return;
    const keep = [];
    for (const item of q){
      try{ await post(item.code, item.body); }  // true or 'reject': both leave the queue
      catch(e){ keep.push(item); }
    }
    // Merge with anything queued while we were flushing.
    const sent = new Set(q.map(x => x.code + '|' + x.body.reading.id));
    const fresh = readQueue().filter(x => !sent.has(x.code + '|' + x.body.reading.id));
    writeQueue(keep.concat(fresh));
  } finally { flushing = false; }
}

export function startSync(){
  if (started) return;
  started = true;
  setInterval(() => { flushQueue().catch(() => {}); }, 60000);
  window.addEventListener('online', () => { flushQueue().catch(() => {}); });
  flushQueue().catch(() => {});
}

// GET a team; throws with a readable message when the server cannot be reached.
export async function fetchTeam(code){
  code = normalizeCode(code);
  if (!CODE_RE.test(code)) throw new Error('Team codes are 3 to 32 characters: lowercase letters, digits and hyphens.');
  let res;
  try{ res = await fetch(teamUrl(code), { cache: 'no-store' }); }
  catch(e){ throw new Error('Could not reach the team server. Is server.py running and are you on the same network?'); }
  const type = res.headers.get('Content-Type') || '';
  if (!type.includes('application/json')){
    throw new Error(res.status === 404 || res.status === 501
      ? 'This site is not being served by server.py, so there is no team API here. Run "python server.py" and open the address it prints.'
      : `Team server answered with HTTP ${res.status} and no data.`);
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data && data.error ? data.error : 'HTTP ' + res.status);
  if (!data || !Array.isArray(data.players)) throw new Error('Unexpected reply from the team server.');
  return data;
}
