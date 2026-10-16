import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Lead, Task } from "../types";
import { initialLeads, initialTasks } from "../data";
import { bootstrap, loadLeadsTasks, onSyncStatus, queueLeadsTasks } from "../serverSync";

export type ConnectionStatus = "checking" | "connected" | "disconnected";
export type SyncStatus = "idle" | "syncing" | "synced" | "error";

interface AuthContextValue {
  authenticated: boolean;
  connectionStatus: ConnectionStatus;
  syncStatus: SyncStatus;
  syncError: string;
  leads: Lead[];
  tasks: Task[];
  login: () => void;
  logout: () => Promise<void>;
  setLeads: (updater: (current: Lead[]) => Lead[]) => void;
  setTasks: (updater: (current: Task[]) => Task[]) => void;
  refreshFromDrive: () => Promise<void>;
  saveNow: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** This browser's previously saved leads/tasks (or the samples), used only until the server has data. */
function localFallback(): { leads: Lead[]; tasks: Task[] } {
  try {
    const leadsRaw = localStorage.getItem("gallivanter.leads");
    const tasksRaw = localStorage.getItem("gallivanter.tasks");
    return { leads: leadsRaw ? (JSON.parse(leadsRaw) as Lead[]) : initialLeads, tasks: tasksRaw ? (JSON.parse(tasksRaw) as Task[]) : initialTasks };
  } catch {
    return { leads: initialLeads, tasks: initialTasks };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("checking");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [syncError, setSyncError] = useState("");
  const [leads, setLeadsState] = useState<Lead[]>([]);
  const [tasks, setTasksState] = useState<Task[]>([]);
  const loaded = useRef(false);

  useEffect(() => onSyncStatus((s, detail) => { setSyncStatus(s); setSyncError(s === "error" ? detail ?? "" : ""); }), []);

  // Sign-in check + initial load from the server (D1). Screens render only after this.
  useEffect(() => {
    loadLeadsTasks(localFallback())
      .then((data) => {
        if (!data) { setConnectionStatus("disconnected"); return; }
        setLeadsState(data.leads);
        setTasksState(data.tasks);
        loaded.current = true;
        setAuthenticated(true);
        setConnectionStatus("connected");
        setSyncStatus("synced");
        if (new URLSearchParams(window.location.search).has("auth")) window.history.replaceState({}, "", window.location.pathname);
      })
      .catch((e: unknown) => {
        setConnectionStatus("disconnected");
        setSyncStatus("error");
        setSyncError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  // Push every change (only changed records are sent).
  useEffect(() => {
    if (authenticated && loaded.current) queueLeadsTasks(leads, tasks);
  }, [leads, tasks, authenticated]);

  const login = () => { window.location.href = "/api/google?next=/"; };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    window.location.href = "/";
  };

  const refreshFromDrive = async () => {
    setSyncStatus("syncing");
    try {
      await bootstrap(true);
      const data = await loadLeadsTasks(localFallback());
      if (data) { setLeadsState(data.leads); setTasksState(data.tasks); }
      setSyncStatus("synced");
    } catch (e) {
      setSyncStatus("error");
      setSyncError(e instanceof Error ? e.message : String(e));
    }
  };

  const saveNow = async () => { queueLeadsTasks(leads, tasks); };

  return (
    <AuthContext.Provider
      value={{
        authenticated, connectionStatus, syncStatus, syncError, leads, tasks, login, logout,
        setLeads: (updater) => setLeadsState(updater),
        setTasks: (updater) => setTasksState(updater),
        refreshFromDrive, saveNow,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
