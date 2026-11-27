// Service worker: makes the app installable and keeps the last-seen pages readable when the wifi drops out.
const CACHE = 'pc-intranet-v3';
const SHELL = ['/', '/css/app.css', '/js/app.js', '/js/ui.js', '/js/router.js', '/js/schema.js', '/vendor/qrcode.js', '/icons/icon.svg', '/brand/logo-light.svg', '/brand/logo-dark.svg', '/fonts/figtree-latin-500-normal.woff2', '/fonts/figtree-latin-700-normal.woff2',
  ...['M001', 'M003', 'M004', 'M008', 'M009', 'M013', 'M015', 'M016', 'M026'].map((c) => `/signs/${c}.svg`), '/manifest.webmanifest',
  '/js/views/dashboard.js', '/js/views/machines.js', '/js/views/training.js', '/js/views/safety.js', '/js/views/people.js', '/js/views/register.js'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // Always try the network first so people see current procedures. Fall back to the saved copy when offline.
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      const type = res.headers.get('Content-Type') || '';
      // Do not save a login redirect page in place of real data.
      const good = res.ok && res.type === 'basic' && !res.redirected && (!url.pathname.startsWith('/api/') || type.includes('json') || url.pathname.startsWith('/api/files/'));
      if (good) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: url.pathname === '/' });
      if (hit) return hit;
      throw err;
    }
  })());
});
