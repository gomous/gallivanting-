import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { CrmProvider } from "./crm/store";
import { AuthProvider } from "./cloudflare/AuthContext";
import "./styles.css";

// Register the service worker for PWA offline support
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        // If a new SW is waiting, activate it immediately
        if (reg.waiting) {
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
        }
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener("statechange", () => {
              if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                newWorker.postMessage({ type: "SKIP_WAITING" });
              }
            });
          }
        });
      })
      .catch((err) => console.log("SW registration failed", err));
  });
  // Listen for activation messages
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    window.location.reload();
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
