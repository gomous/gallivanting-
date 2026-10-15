import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { CrmProvider } from "./crm/store";
import { AuthProvider } from "./cloudflare/AuthContext";
import "./styles.css";

// No service worker registration.
// The SW previously cached the app shell and kept serving stale HTML after
// every deploy (users saw old builds until a hard refresh). public/sw.js is
// now a self-uninstalling worker: any browser that still has an old SW will
// fetch it on navigation, wipe all caches, unregister, and reload once.
// After that, no SW is installed and every load goes straight to the network.

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <CrmProvider>
        <App />
      </CrmProvider>
    </AuthProvider>
  </StrictMode>,
);
