// Self-uninstalling service worker.
// Offline caching kept serving stale HTML after deployments (users saw old
// builds until a hard refresh). This worker never intercepts fetches, wipes
// every existing cache, unregisters itself, and reloads open tabs once, so
// every page load after this goes straight to the network.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.registration.unregister();
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((client) => {
      client.navigate(client.url).catch(() => {});
    });
  })());
});
