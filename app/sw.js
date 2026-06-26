/* Service worker: network-first for everything except PDFs.
   v5: shell files also network-first so code changes reflect on reload without bumping version. */
const CACHE = 'lmf-checklist-v5';
const ICONS = ['./icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  // Only pre-cache icons (large binary, never changes)
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ICONS)).then(() => self.skipWaiting()).catch(() => {}));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isPdf = url.pathname.endsWith('.pdf');

  if (isPdf) {
    // Cache-first for PDFs only (large, rarely change)
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }))
    );
    return;
  }

  // Network-first for everything else (HTML/JS/CSS/JSON)
  // Falls back to cache only when offline
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
