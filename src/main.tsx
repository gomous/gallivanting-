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
      .then((reg) => console.log("SW registered", reg.scope))
      .catch((err) => console.log("SW registration failed", err));
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
