# Google Drive Backend Adapter

This module provides client-side integration with the Gallivanter Cloudflare Worker for Google Drive storage.

## Key Functions

- `checkAuthStatus()` — Check if the user is authenticated
- `startGoogleAuth()` — Redirect to Google OAuth
- `logoutFromDrive()` — Clear session
- `readDriveWorkspace()` — Read CRM data from Google Drive
- `writeDriveWorkspace(leads, tasks)` — Write CRM data to Google Drive
- `autoSaveToDrive(leads, tasks, onStatus)` — Auto-save with status callback
- `loadWorkspace()` — Load from Drive (with local fallback)
- `saveWorkspace(leads, tasks)` — Save to both Drive and local storage

## Usage

The `AuthProvider` component in `AuthContext.tsx` wraps the app and provides:

```tsx
const {
  authenticated,
  connectionStatus,
  syncStatus,
  leads,
  tasks,
  login,
  logout,
  setLeads,
  setTasks,
  refreshFromDrive,
  saveNow,
} = useAuth();
```

## How It Works

1. On load, the app checks if the user has a Google session (via cookie)
2. If authenticated, it fetches the workspace JSON from Google Drive
3. All data mutations (add lead, update task, etc.) trigger auto-save to Drive
4. The sync status is shown in the topbar (syncing/synced/error/idle)
5. If Drive is unavailable, the app falls back to local storage
