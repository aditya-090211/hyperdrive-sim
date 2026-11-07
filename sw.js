// Overdrive Scout offline support. Network first, always: when the venue Wi-Fi works you get the latest version;
// when it does not, the last copy you loaded opens instead of the browser's offline page. Only Scout's own files
// are kept (not the simulator's large 3D models).
const CACHE = 'od-scout-v3';
const KEEP = [/^\/scout$/, /^\/js\/scout\//, /^\/js\/(auth-client|handoff|supabase-config)\.js$/, /^\/css\/(od|scout)\.css$/, /^\/lib\/supabase\.umd\.js$/, /^\/assets\/stadium-(wide|tall)\.jpg$/, /^\/manifest\.webmanifest$/, /^\/assets\/scout-icon\.svg$/, /^\/(privacy|terms)$/, /^\/css\/legal\.css$/];
const FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(['/scout', '/js/scout/app.js', '/js/scout/store.js', '/js/scout/game.js', '/js/auth-client.js', '/js/handoff.js', '/js/supabase-config.js', '/css/od.css', '/css/scout.css', '/lib/supabase.umd.js', '/manifest.webmanifest', '/assets/scout-icon.svg', '/privacy', '/terms', '/css/legal.css'].map((u) => c.add(u).catch(() => {})))).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  if (!(same && KEEP.some((r) => r.test(url.pathname))) && !FONTS.test(req.url)) return;   // everything else: untouched
  const key = same ? url.pathname : req.url;                                                // ?v=… and ?demo=… share one copy
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // venue Wi-Fi that is connected but dead would otherwise hang the app: give the network 4 s, then use the copy
      const res = await Promise.race([fetch(req), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 4000))]);
      // never keep a captive-portal page or a redirect in place of Scout's own files
      const type = res.headers.get('content-type') || '';
      const fits = !same || /\.js$/.test(key) ? /javascript|css|font|octet|^$/.test(type) || res.type === 'opaque' : true;
      if ((res.ok && !res.redirected && fits) || res.type === 'opaque') cache.put(key, res.clone()).catch(() => {});
      return res;
    } catch (err) {
      const hit = await cache.match(key);
      if (hit) return hit;
      throw err;
    }
  })());
});
