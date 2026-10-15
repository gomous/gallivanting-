import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  checkAuthStatus,
  startGoogleAuth,
  logoutFromDrive,
  autoSaveToDrive,
  loadWorkspace,
  saveWorkspace,
} from "./driveBackend";
import type { Lead, Task } from "../types";
import { initialLeads, initialTasks } from "../data";

export type ConnectionStatus = "checking" | "connected" | "disconnected";
export type SyncStatus = "idle" | "syncing" | "synced" | "error";

interface AuthContextValue {
  authenticated: boolean;
  connectionStatus: ConnectionStatus;
  syncStatus: SyncStatus;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("checking");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [tasks, setTasks] = useState<Task[]>(initialTasks);

  // Check auth on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authSuccess = params.get("auth") === "success";

    const checkAuth = async () => {
      const authed = await checkAuthStatus();
      setAuthenticated(authed);
      setConnectionStatus(authed ? "connected" : "disconnected");

      // After OAuth callback, reload data from Drive
      if (authed && authSuccess) {
        const result = await loadWorkspace();
        setLeads(() => result.leads);
        setTasks(() => result.tasks);
        // Clean up the URL query param
        window.history.replaceState({}, "", window.location.pathname);
      }
    };

    void checkAuth();
  }, []);

  // Load data on mount
  useEffect(() => {
    const load = async () => {
      const result = await loadWorkspace();
      setLeads(() => result.leads);
      setTasks(() => result.tasks);
      if (result.source === "cloudflare-drive") {
        setAuthenticated(true);
        setConnectionStatus("connected");
      }
    };
    void load();
  }, []);

  // Auto-save when leads/tasks change (only when authenticated)
  useEffect(() => {
    if (authenticated) {
      autoSaveToDrive(leads, tasks, setSyncStatus);
    }
  }, [leads, tasks, authenticated]);

  const login = () => {
    startGoogleAuth();
  };

  const logout = async () => {
    await logoutFromDrive();
    setAuthenticated(false);
    setConnectionStatus("disconnected");
  };

  const refreshFromDrive = async () => {
    setSyncStatus("syncing");
    const result = await loadWorkspace();
    setLeads(() => result.leads);
    setTasks(() => result.tasks);
    setSyncStatus(result.source === "cloudflare-drive" ? "synced" : "idle");
  };

  const saveNow = async () => {
    setSyncStatus("syncing");
    await saveWorkspace(leads, tasks);
    setSyncStatus("synced");
  };

  return (
    <AuthContext.Provider
      value={{
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
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
