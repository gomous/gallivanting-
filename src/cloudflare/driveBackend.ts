import type { Lead, Task } from "../types";
import { initialLeads, initialTasks } from "../data";

const API_BASE = "/api";
const STORAGE_KEY = "gallivanter_google_creds";

export type BackendMode = "browser-local" | "cloudflare-drive" | "electron-local-file";

export interface DriveSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
  token_type: string;
  clientId: string;
  clientSecret: string;
  existingFileId: string | null;
}

export interface WorkspacePayload {
  leads: Lead[];
  tasks: Task[];
  exportedAt: string;
}

/** Read Google OAuth credentials from localStorage */
function getStoredCreds(): { clientId: string; clientSecret: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const creds = JSON.parse(raw) as { clientId: string; clientSecret: string };
    if (!creds.clientId || !creds.clientSecret) return null;
    return creds;
  } catch {
    return null;
  }
}

/** Check if the user has Google OAuth credentials configured */
export function hasGoogleCreds(): boolean {
  return getStoredCreds() !== null;
}

/** Check if the user is authenticated with Google Drive */
export async function checkAuthStatus(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/auth/status`, {
      credentials: "include",
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.authenticated === true;
  } catch {
    return false;
  }
}

/** Start the Google OAuth flow. The client_id and client_secret are passed as query params. */
export function startGoogleAuth(): void {
  const creds = getStoredCreds();
  if (!creds) {
    alert("Please configure your Google OAuth credentials in Settings first.");
    return;
  }
  const params = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
  window.location.href = `${API_BASE}/google?${params.toString()}`;
}

/** Log out of Google Drive */
export async function logoutFromDrive(): Promise<void> {
  await fetch(`${API_BASE}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}

/** Read the workspace from Google Drive */
export async function readDriveWorkspace(): Promise<{ leads: Lead[]; tasks: Task[] } | null> {
  try {
    const res = await fetch(`${API_BASE}/drive/workspace`, {
      credentials: "include",
    });
    if (!res.ok) {
      if (res.status === 401) return null;
      throw new Error(`Drive read failed: ${res.status}`);
    }
    const data = (await res.json()) as { workspace: string; updatedAt: string };
    if (!data.workspace) return null;

    const payload = JSON.parse(data.workspace) as Partial<WorkspacePayload>;
    if (!Array.isArray(payload.leads) || !Array.isArray(payload.tasks)) {
      return null;
    }

    return { leads: payload.leads, tasks: payload.tasks };
  } catch (error) {
    console.error("Failed to read from Drive:", error);
    return null;
  }
}

/** Write the workspace to Google Drive */
export async function writeDriveWorkspace(leads: Lead[], tasks: Task[]): Promise<{ fileId: string; updatedAt: string } | null> {
  try {
    const payload: WorkspacePayload = {
      leads,
      tasks,
      exportedAt: new Date().toISOString(),
    };
    const workspace = JSON.stringify(payload, null, 2);

    const res = await fetch(`${API_BASE}/drive/workspace`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace }),
    });

    if (!res.ok) {
      if (res.status === 401) return null;
      throw new Error(`Drive write failed: ${res.status}`);
    }

    const data = (await res.json()) as { fileId: string; updatedAt: string };
    return { fileId: data.fileId, updatedAt: data.updatedAt };
  } catch (error) {
    console.error("Failed to write to Drive:", error);
    return null;
  }
}

/** Auto-save the workspace to Drive, with status callback */
export function autoSaveToDrive(
  leads: Lead[],
  tasks: Task[],
  onStatus?: (status: "syncing" | "synced" | "error") => void,
): void {
  onStatus?.("syncing");
  writeDriveWorkspace(leads, tasks)
    .then((result) => {
      if (result) {
        onStatus?.("synced");
      } else {
        onStatus?.("error");
      }
    })
    .catch(() => {
      onStatus?.("error");
    });
}

/** Load workspace from Drive, falling back to local storage */
export async function loadWorkspace(): Promise<{
  leads: Lead[];
  tasks: Task[];
  source: BackendMode;
}> {
  // Try Drive first
  const driveWorkspace = await readDriveWorkspace();
  if (driveWorkspace) {
    return { leads: driveWorkspace.leads, tasks: driveWorkspace.tasks, source: "cloudflare-drive" };
  }

  // Fall back to local storage
  try {
    const leadsRaw = localStorage.getItem("gallivanter.leads");
    const tasksRaw = localStorage.getItem("gallivanter.tasks");
    const leads = leadsRaw ? (JSON.parse(leadsRaw) as Lead[]) : initialLeads;
    const tasks = tasksRaw ? (JSON.parse(tasksRaw) as Task[]) : initialTasks;
    return { leads, tasks, source: "browser-local" };
  } catch {
    return { leads: initialLeads, tasks: initialTasks, source: "browser-local" };
  }
}

/** Save workspace to both Drive and local storage (if authenticated) */
export async function saveWorkspace(leads: Lead[], tasks: Task[]): Promise<void> {
  // Always save to local storage as fallback
  try {
    localStorage.setItem("gallivanter.leads", JSON.stringify(leads));
    localStorage.setItem("gallivanter.tasks", JSON.stringify(tasks));
  } catch {
    // localStorage might not be available (private mode, etc.)
  }

  // Also save to Drive if authenticated
  await writeDriveWorkspace(leads, tasks);
}
