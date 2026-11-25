// Darsaty service worker: caches the app shell and covers so the catalog and
// enrolled lesson notes keep working offline. API reads fall back to cache when
// possible; writes are queued by the app and replayed on reconnect.
const VERSION = 'darsaty-v1';
const SHELL = [
  '/',
  '/index.html',
  '/assets/app.css',
  '/assets/app.js',
  '/assets/vendor/jspdf.umd.min.js',
  '/assets/covers/cover-webdev.webp',
  '/assets/covers/cover-wordpress.webp',
  '/assets/covers/cover-design.webp',
  '/assets/covers/cover-marketing.webp',
  '/assets/covers/cover-freelance.webp',
  '/assets/covers/cover-python.webp',
  '/assets/covers/cover-js.webp',
  '/assets/covers/cover-seo.webp',
  '/assets/covers/hero-learning.webp',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) {
    // Cache-first for fonts so Arabic/English type survives offline.
    if (url.hostname.includes('fonts.g')) {
      event.respondWith(
        caches.open(VERSION).then(async (cache) => {
          const hit = await cache.match(event.request);
          if (hit) return hit;
          const res = await fetch(event.request);
          if (res.ok) cache.put(event.request, res.clone());
          return res;
        })
      );
    }
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    // Network-first with cached fallback for GET reads.
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        try {
          const res = await fetch(event.request);
          if (res.ok && event.request.method === 'GET') cache.put(event.request, res.clone());
          return res;
        } catch (err) {
          const hit = await cache.match(event.request);
          if (hit) return hit;
          throw err;
        }
      })
    );
    return;
  }
  // Static shell: cache-first, network fallback, then cached index for navigations.
  event.respondWith(
    caches.match(event.request).then(async (hit) => {
      if (hit) return hit;
      try {
        const res = await fetch(event.request);
        if (res.ok) {
          const cache = await caches.open(VERSION);
          cache.put(event.request, res.clone());
        }
        return res;
      } catch (err) {
        if (event.request.mode === 'navigate') {
          const shell = await caches.match('/index.html');
          if (shell) return shell;
        }
        throw err;
      }
    })
  );
});
