import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { CrmProvider } from "./crm/store";
import { AuthProvider } from "./cloudflare/AuthContext";
import { bootstrap } from "./serverSync";

// Load the signed-in user's CRM from the server into the stores the screens read, before first render.
void bootstrap().catch(() => {});
import "./styles.css";

// Service worker lifecycle handling.
//
// The previous SW (cache-first) kept serving the stale app shell after every
// deploy — users had to hard-refresh to see new content. It is now a
// self-uninstalling worker (public/sw.js has no fetch handler at all): it
// wipes all caches, unregisters itself, and reloads open tabs once.
//
// Because that only takes effect once the browser actually fetches and
// activates the new worker, this page registers /sw.js and reloads the tab
// (once, loop-guarded) when the new worker claims it. After that single
// reload, no SW intercepts requests, so every future load goes straight to
// the network and refreshes never show stale content.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js");

  let reloaded = false;
  const doReload = () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  };
  navigator.serviceWorker.addEventListener("controllerchange", doReload);
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "SW_RELOADED") doReload();
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <CrmProvider>
        <App />
      </CrmProvider>
    </AuthProvider>
  </StrictMode>,
);
