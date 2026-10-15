import { useAuth } from "./AuthContext";

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { authenticated, connectionStatus, login, logout } = useAuth();

  return (
    <div className="settings-overlay">
      <div className="settings-dialog">
        <div className="settings-header">
          <h2>Google Drive Sync</h2>
          <button className="close-button" aria-label="Close settings" onClick={onClose} type="button">✕</button>
        </div>
        <div className="settings-content">
          <p>Connect your Google Drive account to sync your CRM data across devices.</p>

          <div className="settings-status">
            <span className={`sync-dot ${connectionStatus === "connected" ? "connected" : "disconnected"}`} />
            <span>Status: {connectionStatus === "connected" ? "Connected to Google Drive" : "Not connected"}</span>
          </div>

          {authenticated ? (
            <button className="secondary-button" style={{ width: "100%" }} onClick={logout} type="button">
              Disconnect from Google Drive
            </button>
          ) : (
            <button className="primary-button" style={{ width: "100%" }} onClick={login} type="button">
              Connect to Google Drive
            </button>
          )}

          <p style={{ marginTop: "16px", fontSize: "12px", color: "#627187" }}>
            Your CRM data (leads and tasks) will be stored as a JSON file in your Google Drive.
            The file is named "gallivanter-workspace.json" and is only accessible with your Google account.
          </p>
        </div>
      </div>
    </div>
  );
}
