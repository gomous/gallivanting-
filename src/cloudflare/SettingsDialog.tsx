import { useEffect, useState } from "react";

const STORAGE_KEY = "gallivanter_google_creds";

interface GoogleCreds {
  clientId: string;
  clientSecret: string;
}

export function useGoogleCreds(): GoogleCreds | null {
  const [creds, setCreds] = useState<GoogleCreds | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setCreds(JSON.parse(raw) as GoogleCreds);
      }
    } catch {
      // ignore
    }
  }, []);

  return creds;
}

export function saveGoogleCreds(creds: GoogleCreds): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const creds = JSON.parse(raw) as GoogleCreds;
        setClientId(creds.clientId || "");
        setClientSecret(creds.clientSecret || "");
      }
    } catch {
      // ignore
    }
  }, []);

  function handleSave() {
    if (!clientId.trim() || !clientSecret.trim()) {
      alert("Both fields are required.");
      return;
    }
    saveGoogleCreds({ clientId: clientId.trim(), clientSecret: clientSecret.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  function handleClear() {
    localStorage.removeItem(STORAGE_KEY);
    setClientId("");
    setClientSecret("");
    setSaved(false);
    window.location.reload();
  }

  return (
    <div className="settings-overlay">
      <div className="settings-dialog">
        <div className="settings-header">
          <h2>Google Drive Settings</h2>
          <button className="close-button" aria-label="Close settings" onClick={onClose} type="button">✕</button>
        </div>
        <div className="settings-content">
          <p>Connect your Google Drive to sync your CRM data across devices.</p>
          <ol className="settings-steps">
            <li>Go to the <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">Google Cloud Console</a></li>
            <li>Create a new project or select an existing one</li>
            <li>Enable the Google Drive API</li>
            <li>Create OAuth 2.0 credentials (Web Application type)</li>
            <li>Set redirect URI to: <code>https://gallivanter.jolly-rain-7712.pages.dev/api/google/callback</code></li>
            <li>Copy your Client ID and Client Secret below</li>
          </ol>
          <label className="form-field">
            <span>Client ID</span>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="e.g. 123456789-abc.apps.googleusercontent.com"
            />
          </label>
          <label className="form-field">
            <span>Client Secret</span>
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="Your OAuth client secret"
            />
          </label>
          {saved && <div className="settings-saved">✓ Credentials saved! Refresh the page to connect.</div>}
          <div className="settings-actions">
            <button className="secondary-button" onClick={handleClear} type="button">Clear</button>
            <button className="primary-button" onClick={handleSave} type="button">Save Credentials</button>
          </div>
        </div>
      </div>
    </div>
  );
}
