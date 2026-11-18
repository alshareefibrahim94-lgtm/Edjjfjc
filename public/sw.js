// Offline support: app shell is served stale-while-revalidate, news data is
// network-first with the last downloaded copy as fallback.
const CACHE = 'saudi-news-v2';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const isData = url.pathname.endsWith('/data/news.json');
  const key = isData ? url.pathname : e.request;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(key);
    const live = fetch(e.request).then((res) => { if (res.ok) cache.put(key, res.clone()); return res; });
    if (isData) return live.catch(() => cached || Response.error());
    live.catch(() => {});
    return cached || live;
  }));
});
