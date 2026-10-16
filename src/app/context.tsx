import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, changes, type Me, type Member, type Workspace } from "./api";

interface AppCtx {
  me: Me;
  ws: Workspace;
  members: Member[];
  path: string;
  navigate: (path: string) => void;
  refreshMe: () => Promise<void>;
  switchWorkspace: (id: string) => void;
  toast: (text: string, kind?: "ok" | "error") => void;
  canWrite: boolean;
  isAdmin: boolean;
  memberName: (id: string | null | undefined) => string;
}

const Ctx = createContext<AppCtx | null>(null);
export const useApp = (): AppCtx => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp must be used inside AppProvider");
  return c;
};

export function usePath(): [string, (p: string) => void] {
  const [path, setPath] = useState(window.location.pathname + window.location.search);
  useEffect(() => {
    const on = () => setPath(window.location.pathname + window.location.search);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  const navigate = useCallback((p: string) => {
    if (p === window.location.pathname + window.location.search) return;
    window.history.pushState({}, "", p);
    setPath(p);
    window.scrollTo(0, 0);
  }, []);
  return [path, navigate];
}

const WS_KEY = "gallivanter.workspace";

export function AppProvider({ me, setMe, path, navigate, children }: {
  me: Me; setMe: (m: Me) => void; path: string; navigate: (p: string) => void; children: ReactNode;
}) {
  const [wsId, setWsId] = useState(() => {
    const saved = localStorage.getItem(WS_KEY);
    return me.workspaces.some((w) => w.id === saved) ? saved! : me.workspaces[0].id;
  });
  const ws = me.workspaces.find((w) => w.id === wsId) ?? me.workspaces[0];
  const [members, setMembers] = useState<Member[]>([]);
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: "ok" | "error" }[]>([]);

  const refreshMe = useCallback(async () => setMe(await api.me()), [setMe]);
  const switchWorkspace = useCallback((id: string) => {
    localStorage.setItem(WS_KEY, id);
    setWsId(id);
    navigate("/app");
  }, [navigate]);

  useEffect(() => {
    let alive = true;
    api.tool<Member[]>(ws.id, "list_members").then((m) => alive && setMembers(m)).catch(() => {});
    return () => { alive = false; };
  }, [ws.id]);

  // Multi-device sync: poll for changes made elsewhere (other tabs, teammates, Claude, AI).
  const cursor = useRef(new Date().toISOString());
  useEffect(() => {
    cursor.current = new Date().toISOString();
    const tick = async () => {
      if (document.hidden) return;
      try {
        const r = await api.tool<{ records: unknown[]; cursor: string }>(ws.id, "changes_since", { since: cursor.current, limit: 200 });
        if (r.records.length) { cursor.current = r.cursor; changes.emit(); }
      } catch { /* offline or signed out; next tick retries */ }
    };
    const t = window.setInterval(tick, 15000);
    const onFocus = () => void tick();
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [ws.id]);

  const toast = useCallback((text: string, kind: "ok" | "error" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);

  const memberName = useCallback((id: string | null | undefined) => {
    if (!id) return "";
    const m = members.find((x) => x.id === id);
    return m ? (m.isYou ? "You" : m.name || m.email) : "Former member";
  }, [members]);

  const value: AppCtx = {
    me, ws, members, path, navigate, refreshMe, switchWorkspace, toast, memberName,
    canWrite: ws.role !== "viewer",
    isAdmin: ws.role === "owner" || ws.role === "admin",
  };
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="gv-toasts">
        {toasts.map((t) => <div key={t.id} className={`gv-toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </Ctx.Provider>
  );
}

/** Re-run a loader whenever deps change or any data changes. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: string; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => changes.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    loader().then((d) => { if (alive) { setData(d); setError(""); } })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}
