import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, errorMessage, type Me, type Rec } from "./api";
import { AppProvider, useApp, usePath } from "./context";
import { moduleFromSlug, moduleGroups, moduleIcon, moduleSlug } from "./fields";
import { ModuleList } from "./ModuleList";
import { RecordDetail } from "./RecordDetail";
import { NewRecordPage } from "./RecordForm";
import { HomePage, ReportsPage, SettingsPage } from "./pages";
import "./app.css";

export function AppRoot() {
  const [path, navigate] = usePath();
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<"loading" | "signed-out" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setMe(await api.me());
      setState("ready");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setState("signed-out");
      else { setError(errorMessage(e)); setState("error"); }
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (state === "loading") return <div className="gv-center gv-muted">Loading Gallivanter…</div>;
  if (state === "error") return <div className="gv-center"><p className="gv-error">{error}</p><button className="gv-btn" onClick={() => void load()}>Retry</button></div>;
  if (state === "signed-out") return (
    <div className="gv-center">
      <div className="gv-auth-card">
        <h1>Gallivanter</h1>
        <p>Sign in to open your CRM.</p>
        <button className="gv-btn primary big" onClick={() => api.login(path.startsWith("/invite/") || path.startsWith("/app") ? path : "/app")}>Continue with Google</button>
        <p className="gv-muted small">We only ask for access to files Gallivanter creates in your Drive.</p>
      </div>
    </div>
  );

  const inviteToken = path.startsWith("/invite/") ? path.split("/")[2]?.split("?")[0] : null;
  if (inviteToken) return <AcceptInvite token={inviteToken} onDone={async (wsId) => { localStorage.setItem("gallivanter.workspace", wsId); await load(); navigate("/app"); }} />;
  if (!me!.workspaces.length) return <Onboarding me={me!} onDone={load} />;

  return (
    <AppProvider me={me!} setMe={setMe} path={path} navigate={navigate}>
      <Shell />
    </AppProvider>
  );
}

function AcceptInvite({ token, onDone }: { token: string; onDone: (ws: string) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="gv-center">
      <div className="gv-auth-card">
        <h1>Join workspace</h1>
        <p>You've been invited to a Gallivanter workspace.</p>
        {error && <p className="gv-error">{error}</p>}
        <button className="gv-btn primary big" disabled={busy} onClick={async () => {
          setBusy(true);
          try { const r = await api.acceptInvite(token); onDone(r.workspaceId); } catch (e) { setError(errorMessage(e)); setBusy(false); }
        }}>Accept invite</button>
      </div>
    </div>
  );
}

function Onboarding({ me, onDone }: { me: Me; onDone: () => void }) {
  const [team, setTeam] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const create = async (name: string, personal: boolean) => {
    setBusy(true);
    try { const r = await api.createWorkspace(name, personal); localStorage.setItem("gallivanter.workspace", r.id); onDone(); }
    catch (e) { setError(errorMessage(e)); setBusy(false); }
  };
  return (
    <div className="gv-center">
      <div className="gv-auth-card wide">
        <h1>Welcome, {me.user.name.split(" ")[0] || "there"} 👋</h1>
        <p>How will you use Gallivanter? You can add more workspaces later.</p>
        {error && <p className="gv-error">{error}</p>}
        <div className="gv-choice">
          <button className="gv-choice-card" disabled={busy} onClick={() => void create("", true)}>
            <strong>🙋 Just me</strong><span>A personal CRM. Your data stays private.</span>
          </button>
          <form className="gv-choice-card" onSubmit={(e) => { e.preventDefault(); if (team.trim()) void create(team.trim(), false); }}>
            <strong>👥 With my team</strong><span>Create a shared workspace and invite teammates.</span>
            <input className="gv-input" placeholder="Company or team name" value={team} onChange={(e) => setTeam(e.target.value)} />
            <button className="gv-btn primary" disabled={busy || !team.trim()}>Create team workspace</button>
          </form>
        </div>
        <p className="gv-muted small">Joining an existing team? Open the invite link your admin sent you.</p>
      </div>
    </div>
  );
}

function GlobalSearch() {
  const { ws, navigate } = useApp();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Rec[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!q.trim()) { setResults([]); return; }
    timer.current = window.setTimeout(() => {
      api.tool<{ records: Rec[] }>(ws.id, "search_records", { query: q, limit: 10 }).then((r) => setResults(r.records)).catch(() => setResults([]));
    }, 200);
  }, [q, ws.id]);
  return (
    <div className="gv-global-search">
      <input className="gv-input" placeholder="🔍 Search everything…" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 150)} />
      {open && results.length > 0 && (
        <ul className="gv-lookup-menu">
          {results.map((r) => (
            <li key={r.id}><button onMouseDown={() => { navigate(`/app/${moduleSlug(r.module)}/${r.id}`); setQ(""); }}>{moduleIcon[r.module]} {r.title} <span className="gv-muted">{r.module}</span></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Shell() {
  const { me, ws, path, navigate, switchWorkspace, refreshMe, toast } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const parts = path.split("?")[0].split("/").filter(Boolean); // ["app", slug, id|new]
  const section = parts[1] ?? "";
  const module = moduleFromSlug(section);

  let page;
  if (!section) page = <HomePage />;
  else if (section === "reports") page = <ReportsPage />;
  else if (section === "settings") page = <SettingsPage />;
  else if (module && parts[2] === "new") page = <NewRecordPage key={path} module={module} />;
  else if (module && parts[2]) page = <RecordDetail key={parts[2]} module={module} id={parts[2]} />;
  else if (module) page = <ModuleList key={module} module={module} />;
  else page = <div className="gv-page"><h1>Not found</h1><button className="gv-btn" onClick={() => navigate("/app")}>Go home</button></div>;

  const link = (to: string, label: string, active: boolean) => (
    <a href={to} className={active ? "on" : ""} onClick={(e) => { e.preventDefault(); navigate(to); setMenuOpen(false); }}>{label}</a>
  );

  return (
    <div className="gv-shell">
      <aside className={`gv-side ${menuOpen ? "open" : ""}`}>
        <div className="gv-brand">Gallivanter</div>
        <select className="gv-input gv-ws" value={ws.id} onChange={async (e) => {
          if (e.target.value === "__new") {
            const name = window.prompt("Name for the new team workspace:");
            if (name?.trim()) { try { const r = await api.createWorkspace(name.trim()); await refreshMe(); switchWorkspace(r.id); } catch (err) { toast(errorMessage(err), "error"); } }
            return;
          }
          switchWorkspace(e.target.value);
        }}>
          {me.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          <option value="__new">+ New workspace…</option>
        </select>
        <nav>
          {link("/app", "🏠 Home", !section)}
          {moduleGroups.map((g) => (
            <div key={g.label} className="gv-nav-group">
              <div className="gv-nav-label">{g.label}</div>
              {g.modules.map((m) => link(`/app/${moduleSlug(m)}`, `${moduleIcon[m]} ${m}`, module === m))}
            </div>
          ))}
          <div className="gv-nav-group">
            <div className="gv-nav-label">Workspace</div>
            {link("/app/reports", "📊 Reports", section === "reports")}
            {link("/app/settings", "⚙️ Settings", section === "settings")}
          </div>
        </nav>
      </aside>
      <div className="gv-main">
        <header className="gv-top">
          <button className="gv-btn gv-menu-btn" onClick={() => setMenuOpen((o) => !o)}>☰</button>
          <GlobalSearch />
          <div className="gv-user" title={me.user.email}>
            {me.user.picture ? <img src={me.user.picture} alt="" referrerPolicy="no-referrer" /> : <span>{(me.user.name || me.user.email)[0]}</span>}
          </div>
        </header>
        <main>{page}</main>
      </div>
    </div>
  );
}
