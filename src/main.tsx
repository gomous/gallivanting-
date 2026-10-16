import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppRoot } from "./app/AppRoot";
import { LandingPage } from "./cloudflare/LandingPage";

// The old service worker (public/sw.js) is self-uninstalling; registering it once
// clears any stale cache left by earlier versions, then it removes itself.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
  let reloaded = false;
  const doReload = () => { if (!reloaded) { reloaded = true; window.location.reload(); } };
  navigator.serviceWorker.addEventListener("message", (event) => { if (event.data?.type === "SW_RELOADED") doReload(); });
}

const path = window.location.pathname;
const isApp = path === "/app" || path.startsWith("/app/") || path.startsWith("/invite/");

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isApp ? <AppRoot /> : <LandingPage />}</StrictMode>,
);
