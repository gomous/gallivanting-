const CACHE = 'gallivanter-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
];

self.addEventListener('install', e => {
  // Force the waiting service worker to become active
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', e => {
  // Don't cache API requests - always go to network
  if (e.request.url.includes('/auth/') || e.request.url.includes('/drive/') || e.request.url.includes('/api/')) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then(resp => resp || fetch(e.request))
  );
});
