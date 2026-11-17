// Overdrive Scout offline support.
//  * Install: every file Scout needs (its self-hosted fonts included) is copied onto the phone, so after one visit it opens and works
//    with no signal, cold start included. Only Scout's own files are kept, never the simulator's 3D models.
//  * Fetch: Scout's files come from the network when it answers within 2.5 s (you always get the latest, and the copy
//    is refreshed); with no connection, or venue Wi-Fi that is connected but dead, the copy answers instead.
//  * Versioned: bump CACHE when Scout's file list changes. Activating a new version deletes the old caches.
//  * Background Sync: when the browser wakes this worker for 'od-scout-sync' (the app may be closed), it uploads the
//    outbox with js/scout/outbox.js, the same code the app runs, and tells any open Scout tab to re-read its data.
importScripts('/js/scout/outbox.js');

const CACHE = 'od-scout-v8';
const SHELL = ['/scout', '/js/scout/app.js', '/js/scout/store.js', '/js/scout/game.js', '/js/scout/insights.js', '/js/scout/outbox.js',
  '/js/auth-client.js', '/js/handoff.js', '/js/supabase-config.js', '/css/od.css', '/css/scout.css', '/lib/supabase.umd.js',
  '/manifest.webmanifest', '/assets/scout-icon.svg', '/assets/scout-192.png', '/assets/scout-512.png',
  '/assets/stadium-wide.jpg', '/assets/stadium-tall.jpg', '/privacy', '/terms', '/css/legal.css',
  '/assets/fonts/bricolage-grotesque.woff2', '/assets/fonts/instrument-sans.woff2'];
const KEEP = [/^\/scout$/, /^\/js\/scout\//, /^\/js\/(auth-client|handoff|supabase-config)\.js$/, /^\/css\/(od|scout|legal)\.css$/, /^\/lib\/supabase\.umd\.js$/,
  /^\/assets\/stadium-(wide|tall)\.jpg$/, /^\/assets\/fonts\/[a-z-]+\.woff2$/, /^\/manifest\.webmanifest$/, /^\/assets\/scout-(icon\.svg|192\.png|512\.png)$/, /^\/(privacy|terms)$/];
const WAIT = 2500;
// on scout.overdrive009.in the app is the site root
const SCOUT_HOST = /^scout\./.test(self.location.hostname);

// a response worth keeping: never a captive-portal page or a redirect in place of Scout's own files
function keepable(res, key) {
  if (!res.ok || res.redirected) return false;
  const type = res.headers.get('content-type') || '';
  if (/\.js$/.test(key)) return /javascript|octet|^$/.test(type);
  if (/\.woff2$/.test(key)) return /font|octet|^$/.test(type);
  if (/\.css$/.test(key)) return /css/.test(type);
  if (key === '/scout' || key === '/privacy' || key === '/terms') return /html/.test(type);
  return true;
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async (u) => {
      try { const res = await fetch(u, { cache: 'reload' }); if (keepable(res, u)) await cache.put(u, res); } catch { /* offline install: kept on the next visit */ }
    }));
  })());
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('od-scout-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  const path = same && (url.pathname === '/scout.html' || (SCOUT_HOST && url.pathname === '/')) ? '/scout' : url.pathname;
  if (!same || !KEEP.some((r) => r.test(path))) return;                              // everything else: untouched
  const key = path;                                                                   // ?v=… and ?demo=… share one copy
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(key, { ignoreVary: true, ignoreSearch: true });
    if (hit && self.navigator && self.navigator.onLine === false) return hit;
    const net = fetch(req).then((res) => {
      if (keepable(res, key)) cache.put(key, res.clone()).catch(() => {});
      return res;
    });
    if (!hit) return net;
    // dead Wi-Fi: answer from the copy after a short wait, and let the network finish refreshing it in the background
    const slow = new Promise((ok) => setTimeout(() => ok(hit), WAIT));
    e.waitUntil(net.catch(() => {}));
    return Promise.race([net.catch(() => hit), slow]);
  })());
});

// ------------------------------------------------------------------ Background Sync
// The app leaves the signed-in account's access token here ('auth' in the kv table). The worker never refreshes it:
// if it has expired, the upload waits for the app, which refreshes the token and syncs the moment it is opened.
async function sendFromWorker(auth, item) {
  const [fn, args] = self.OdOutbox.rpcOf(item);
  let res;
  try {
    res = await fetch(`${auth.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: auth.key, Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
  } catch { throw Object.assign(new Error('No connection'), { offline: true }); }
  const body = await res.json().catch(() => null);
  if (res.status === 401 || /jwt/i.test(body?.message || '')) throw Object.assign(new Error('Your session ended'), { auth: true });
  if (!res.ok) throw new Error(body?.message || `The server refused this entry (${res.status})`);
  return body;
}
async function backgroundSync() {
  const auth = await self.OdOutbox.get('kv', 'auth');
  if (!auth || !auth.token || auth.exp * 1000 < Date.now() + 30000) return;
  const out = await self.OdOutbox.push((item) => sendFromWorker(auth, item), { uid: auth.uid, team: auth.team });
  const tabs = await self.clients.matchAll({ type: 'window' });
  for (const c of tabs) c.postMessage({ type: 'od-scout-synced', sent: out.sent });
  if (out.stop === 'offline') throw new Error('still offline');       // the browser tries again later
}
self.addEventListener('sync', (e) => { if (e.tag === 'od-scout-sync') e.waitUntil(backgroundSync()); });
