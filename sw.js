// Overdrive Scout offline support. Every file Scout needs (including its fonts) is copied onto the phone the first
// time it opens, so after one visit it opens and works with no signal at all.
//  * With a connection, Scout's files come from the network (you always get the latest) and the copy is refreshed.
//  * With no connection (or venue Wi-Fi that is connected but dead), the copy answers at once or after 2.5 s.
// Only Scout's own files are kept (not the simulator's large 3D models).
const CACHE = 'od-scout-v4';
const SHELL = ['/scout', '/js/scout/app.js', '/js/scout/store.js', '/js/scout/game.js', '/js/scout/insights.js', '/js/auth-client.js', '/js/handoff.js',
  '/js/supabase-config.js', '/css/od.css', '/css/scout.css', '/lib/supabase.umd.js', '/manifest.webmanifest', '/assets/scout-icon.svg',
  '/assets/stadium-wide.jpg', '/assets/stadium-tall.jpg', '/privacy', '/terms', '/css/legal.css'];
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Instrument+Sans:ital,wght@0,400..700;1,400..600&family=Martian+Mono:wght@400..600&display=swap';
const KEEP = [/^\/scout$/, /^\/js\/scout\//, /^\/js\/(auth-client|handoff|supabase-config)\.js$/, /^\/css\/(od|scout)\.css$/, /^\/lib\/supabase\.umd\.js$/, /^\/assets\/stadium-(wide|tall)\.jpg$/, /^\/manifest\.webmanifest$/, /^\/assets\/scout-icon\.svg$/, /^\/(privacy|terms)$/, /^\/css\/legal\.css$/];
const FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
const WAIT = 2500;

// a response worth keeping: never a captive-portal page or a redirect in place of Scout's own files
function keepable(res, key, same) {
  if (res.type === 'opaque') return true;
  if (!res.ok || res.redirected) return false;
  const type = res.headers.get('content-type') || '';
  if (!same || /\.js$/.test(key)) return /javascript|css|font|octet|^$/.test(type);
  if (/\.css$/.test(key)) return /css/.test(type);
  if (key === '/scout' || key === '/privacy' || key === '/terms') return /html/.test(type);
  return true;
}

async function precacheFonts(cache) {
  // the stylesheet names the font files; keep both, so the type looks the same offline
  const res = await fetch(FONT_CSS, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) return;
  const css = await res.clone().text();
  await cache.put(FONT_CSS, res);
  const files = [...new Set(css.match(/https:\/\/fonts\.gstatic\.com\/[^)'"\s]+/g) || [])];
  await Promise.all(files.map((u) => fetch(u, { mode: 'cors', credentials: 'omit' }).then((r) => (r.ok ? cache.put(u, r) : null)).catch(() => {})));
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async (u) => {
      try { const res = await fetch(u, { cache: 'reload' }); if (keepable(res, u, true)) await cache.put(u, res); } catch { /* offline install: kept on the next visit */ }
    }));
    await precacheFonts(cache).catch(() => {});
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
  const path = same && url.pathname === '/scout.html' ? '/scout' : url.pathname;
  if (!(same && KEEP.some((r) => r.test(path))) && !FONTS.test(req.url)) return;   // everything else: untouched
  const key = same ? path : req.url;                                                  // ?v=… and ?demo=… share one copy
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(key, { ignoreVary: true, ignoreSearch: same });
    // fonts never change at the same address: the copy is always right
    if (hit && !same) return hit;
    if (hit && self.navigator && self.navigator.onLine === false) return hit;
    const net = fetch(req).then((res) => {
      if (keepable(res, key, same)) cache.put(key, res.clone()).catch(() => {});
      return res;
    });
    if (!hit) return net;
    // dead Wi-Fi: answer from the copy after a short wait, and let the network finish refreshing it in the background
    const slow = new Promise((ok) => setTimeout(() => ok(hit), WAIT));
    e.waitUntil(net.catch(() => {}));
    return Promise.race([net.catch(() => hit), slow]);
  })());
});
