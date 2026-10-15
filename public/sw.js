// Self-uninstalling service worker.
//
// Background: the previous SW cached the app shell ('/' and '/index.html')
// cache-first, so after every deploy users saw the OLD HTML (and the OLD
// hashed JS it referenced) until a hard refresh.
//
// This worker fixes that by never intercepting requests at all (no fetch
// handler). On activation it wipes every cache, unregisters itself, claims
// all clients, and tells each open tab to reload. Once that reload happens,
// no SW controls the page and every subsequent load goes straight to the
// network — so future deploys show up on a normal refresh.
self.addEventListener("install", (event) => {
  // Become the active worker immediately so we can replace any older worker.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      } catch (_) { /* cache storage may be unavailable */ }
      // Stop being a service worker.
      await self.registration.unregister();
      await self.clients.claim();
      // Reload every open tab so they re-load with no SW in control.
      const all = await self.clients.matchAll({ type: "window" });
      for (const client of all) {
        try {
          client.postMessage({ type: "SW_RELOADED" });
        } catch (_) { /* client may have navigated away */ }
      }
    })()
  );
});

// Intentionally NO 'fetch' listener: this worker does not intercept
// requests, so once it takes over the network is always used.
