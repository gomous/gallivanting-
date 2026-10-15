// Bail out any stale service worker from a previous deployment and clear
// its caches, synchronously, BEFORE the app shell loads.
//
// Why: the prior SW cached the app shell cache-first, so after every deploy
// a normal refresh kept serving the old HTML + old JS bundle (users had to
// hard-refresh). Even with a self-uninstalling SW we rely on the browser
// fetching the new /sw.js — which races with the cached shell. This
// kill-switch runs on every load from a static file (CSP allows it) and
// guarantees no stale worker survives, every time.
(function () {
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      regs.forEach(function (reg) { reg.unregister(); });
    }).catch(function () {});
  }
  if (typeof caches !== "undefined") {
    caches.keys().then(function (keys) {
      keys.forEach(function (key) { caches.delete(key); });
    }).catch(function () {});
  }
})();
