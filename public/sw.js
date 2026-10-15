const CACHE = 'gallivanter-v4';
const ASSETS = [
  '/manifest.json',
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(key => key !== CACHE && caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Never intercept API requests - always go to network
  if (url.includes('/api/') || url.includes('/auth/') || url.includes('/drive/')) {
    return;
  }

  // Navigation requests (the app shell): network-first so users always
  // get the latest HTML after a deploy; fall back to cache only offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request).then(cached => cached || caches.match('/index.html')))
    );
    return;
  }

  // Static assets: cache-first (hashed filenames change on deploy anyway)
  e.respondWith(
    caches.match(e.request).then(resp => resp || fetch(e.request))
  );
});
