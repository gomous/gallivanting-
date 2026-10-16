import { useState } from "react";
import type { ModuleKey } from "../crm/model";
import { fieldDefinition, moduleKeys } from "../crm/schema";
import { api, changes, errorMessage, fmtDate, fmtMoney, type Member, type Rec, type Role } from "./api";
import { useApp, useLoad } from "./context";
import { formFields, moduleIcon, moduleSlug } from "./fields";

// ---------------- Home ----------------

interface Summary { openLeads: number; openDeals: number; pipelineAmount: number; overdueTasks: number; createdThisMonth: number }
interface Agenda { overdueTasks: Rec[]; upcomingTasks: Rec[]; upcomingMeetings: Rec[] }
interface Pipeline { stages: { stage: string; count: number; amount: number }[]; weightedAmount: number }

export function HomePage() {
  const { ws, navigate, me, toast, canWrite } = useApp();
  const summary = useLoad(() => api.tool<Summary>(ws.id, "dashboard_summary", {}), [ws.id]);
  const agenda = useLoad(() => api.tool<Agenda>(ws.id, "list_agenda", { days: 7, mine: false }), [ws.id]);
  const pipe = useLoad(() => api.tool<Pipeline>(ws.id, "pipeline_summary", {}), [ws.id]);
  const recent = useLoad(() => api.tool<{ records: Rec[] }>(ws.id, "search_records", { limit: 8 }), [ws.id]);
  const s = summary.data;
  const maxStage = Math.max(1, ...(pipe.data?.stages.map((x) => x.amount) ?? [1]));
  const complete = async (id: string) => {
    try { await api.tool(ws.id, "complete_task", { taskId: id }); toast("Task completed"); changes.emit(); } catch (e) { toast(errorMessage(e), "error"); }
  };
  const isEmpty = s && s.openLeads + s.openDeals + s.createdThisMonth === 0 && (recent.data?.records.length ?? 0) === 0;
  return (
    <div className="gv-page">
      <div className="gv-page-head"><h1>Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, {me.user.name.split(" ")[0] || "there"}</h1></div>
      {isEmpty && (
        <div className="gv-info">
          <strong>Your CRM is empty.</strong> Start by adding a <button className="gv-link" onClick={() => navigate("/app/leads/new")}>lead</button> or <button className="gv-link" onClick={() => navigate("/app/contacts/new")}>contact</button>, or import a CSV from any module page.
          {canWrite && <> Want to look around first? <button className="gv-link" onClick={() => void loadSample(ws.id).then(() => { toast("Sample data added"); changes.emit(); }).catch((e) => toast(errorMessage(e), "error"))}>Add sample data</button>.</>}
        </div>
      )}
      <div className="gv-kpis">
        <button className="gv-kpi" onClick={() => navigate("/app/leads")}><span>Open leads</span><strong>{s?.openLeads ?? "–"}</strong></button>
        <button className="gv-kpi" onClick={() => navigate("/app/deals")}><span>Open deals</span><strong>{s?.openDeals ?? "–"}</strong></button>
        <button className="gv-kpi" onClick={() => navigate("/app/deals")}><span>Pipeline value</span><strong>{s ? fmtMoney(s.pipelineAmount) : "–"}</strong></button>
        <button className="gv-kpi warn" onClick={() => navigate("/app/tasks")}><span>Overdue tasks</span><strong>{s?.overdueTasks ?? "–"}</strong></button>
        <div className="gv-kpi"><span>Added this month</span><strong>{s?.createdThisMonth ?? "–"}</strong></div>
      </div>
      <div className="gv-cols">
        <section className="gv-panel">
          <h2>Agenda (next 7 days)</h2>
          {agenda.data && agenda.data.overdueTasks.length + agenda.data.upcomingTasks.length + agenda.data.upcomingMeetings.length === 0 && <p className="gv-muted">Nothing scheduled. 🎉</p>}
          {agenda.data?.overdueTasks.map((t) => <AgendaRow key={t.id} r={t} overdue onDone={canWrite ? () => void complete(t.id) : undefined} />)}
          {agenda.data?.upcomingTasks.map((t) => <AgendaRow key={t.id} r={t} onDone={canWrite ? () => void complete(t.id) : undefined} />)}
          {agenda.data?.upcomingMeetings.map((m) => (
            <div key={m.id} className="gv-agenda"><span>📅</span><button className="gv-link" onClick={() => navigate(`/app/meetings/${m.id}`)}>{m.title}</button><span className="gv-muted">{m.values.from?.replace("T", " ")}</span></div>
          ))}
        </section>
        <section className="gv-panel">
          <h2>Pipeline</h2>
          {pipe.data?.stages.map((st) => (
            <div key={st.stage} className="gv-bar-row">
              <span>{st.stage}</span>
              <div className="gv-bar"><div style={{ width: `${(st.amount / maxStage) * 100}%` }} /></div>
              <span className="gv-muted">{st.count} · {fmtMoney(st.amount)}</span>
            </div>
          ))}
          {pipe.data && <p className="gv-muted">Weighted forecast: <strong>{fmtMoney(pipe.data.weightedAmount)}</strong></p>}
        </section>
      </div>
      <section className="gv-panel">
        <h2>Recently updated</h2>
        {recent.data?.records.map((r) => (
          <div key={r.id} className="gv-agenda"><span>{moduleIcon[r.module]}</span><button className="gv-link" onClick={() => navigate(`/app/${moduleSlug(r.module)}/${r.id}`)}>{r.title}</button><span className="gv-muted">{r.module} · {fmtDate(r.updatedAt)}</span></div>
        ))}
      </section>
    </div>
  );
}

function AgendaRow({ r, overdue, onDone }: { r: Rec; overdue?: boolean; onDone?: () => void }) {
  const { navigate } = useApp();
  return (
    <div className={`gv-agenda ${overdue ? "overdue" : ""}`}>
      {onDone ? <input type="checkbox" title="Mark complete" onChange={onDone} /> : <span>✅</span>}
      <button className="gv-link" onClick={() => navigate(`/app/tasks/${r.id}`)}>{r.title}</button>
      <span className="gv-muted">{overdue ? "Overdue · " : ""}{r.values.dueDate}{r.values.priority === "High" ? " · High" : ""}</span>
    </div>
  );
}

async function loadSample(ws: string) {
  const t = <T,>(name: string, input: unknown) => api.tool<T>(ws, name, input);
  const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const acme = await t<Rec>("create_record", { module: "Accounts", values: { accountName: "Acme Industries", industry: "Manufacturing", type: "Customer", phone: "+91 98765 43210" }, tags: ["sample"] });
  const contact = await t<Rec>("create_record", { module: "Contacts", values: { firstName: "Asha", lastName: "Rao", accountId: acme.id, email: "asha@acme.example", title: "Head of Ops" }, tags: ["sample"] });
  await t("create_record", { module: "Deals", values: { dealName: "Acme annual plan", accountId: acme.id, contactId: contact.id, amount: "240000", stage: "Value Proposition", closingDate: day(30), probability: "40" }, tags: ["sample"] });
  await t("create_record", { module: "Deals", values: { dealName: "Acme add-on seats", accountId: acme.id, amount: "60000", stage: "Negotiation/Review", closingDate: day(10), probability: "75" }, tags: ["sample"] });
  await t("bulk_create_records", { module: "Leads", rows: [
    { firstName: "Rahul", lastName: "Mehta", company: "Northwind", email: "rahul@northwind.example", status: "New", source: "Website", rating: "Hot" },
    { firstName: "Sara", lastName: "Khan", company: "Globex", email: "sara@globex.example", status: "Contacted", source: "LinkedIn", rating: "Warm" },
    { firstName: "Vikram", lastName: "Das", company: "Initech", status: "Attempted to Contact", source: "Referral", rating: "Cold" },
  ] });
  await t("create_task", { subject: "Send proposal to Acme", dueDate: day(-1), priority: "High", relatedId: acme.id });
  await t("create_task", { subject: "Follow up with Asha", dueDate: day(2), relatedId: contact.id });
  await t("schedule_meeting", { title: "Acme quarterly review", from: `${day(3)}T15:00`, to: `${day(3)}T16:00`, relatedId: acme.id });
}

// ---------------- Reports ----------------

interface ReportResult { rows: { group: string; value: number; count: number }[]; total: number }
interface SavedReport { id: string; name: string; module: ModuleKey; groupBy: string; metric: "count" | "sum" | "avg"; metricField: string }

export function ReportsPage() {
  const { ws, toast, canWrite } = useApp();
  const [module, setModule] = useState<ModuleKey>("Leads");
  const [groupBy, setGroupBy] = useState("status");
  const [metric, setMetric] = useState<"count" | "sum" | "avg">("count");
  const [metricField, setMetricField] = useState("");
  const saved = useLoad(() => api.tool<{ reports: SavedReport[] }>(ws.id, "list_reports", {}), [ws.id]);
  const result = useLoad(() => api.tool<ReportResult>(ws.id, "run_report", { module, groupBy: groupBy || undefined, metric, metricField: metric === "count" ? undefined : metricField || undefined }),
    [ws.id, module, groupBy, metric, metricField]);
  const groupable = formFields(module).filter((f) => f.type === "select" || f.type === "lookup" || f.type === "text");
  const numeric = formFields(module).filter((f) => f.type === "number");
  const max = Math.max(1, ...(result.data?.rows.map((r) => r.value) ?? [1]));
  const groupLabel = (g: string) => fieldDefinition(module, groupBy)?.type === "lookup" ? `${g.slice(0, 18)}…` : g;
  return (
    <div className="gv-page">
      <div className="gv-page-head"><h1>📊 Reports</h1></div>
      <div className="gv-toolbar">
        <select className="gv-input" value={module} onChange={(e) => { setModule(e.target.value as ModuleKey); setGroupBy(""); setMetric("count"); setMetricField(""); }}>
          {moduleKeys.map((m) => <option key={m}>{m}</option>)}
        </select>
        <label className="gv-inline">Group by
          <select className="gv-input" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            <option value="">(no grouping)</option><option value="ownerId">Owner</option><option value="createdMonth">Month created</option>
            {groupable.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </label>
        <label className="gv-inline">Measure
          <select className="gv-input" value={metric} onChange={(e) => setMetric(e.target.value as "count")}>
            <option value="count">Count</option>{numeric.length > 0 && <><option value="sum">Sum of</option><option value="avg">Average of</option></>}
          </select>
        </label>
        {metric !== "count" && <select className="gv-input" value={metricField} onChange={(e) => setMetricField(e.target.value)}>
          <option value="">Field…</option>{numeric.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>}
        {canWrite && <button className="gv-btn" onClick={async () => {
          const name = window.prompt("Report name:");
          if (!name) return;
          try { await api.tool(ws.id, "save_report", { name, module, groupBy: groupBy || undefined, metric, metricField: metricField || undefined }); toast("Report saved"); saved.reload(); } catch (e) { toast(errorMessage(e), "error"); }
        }}>Save report</button>}
      </div>
      {result.error && <div className="gv-error">{result.error}</div>}
      <section className="gv-panel">
        {result.data?.rows.map((r) => (
          <div key={r.group} className="gv-bar-row">
            <span>{groupLabel(r.group)}</span>
            <div className="gv-bar"><div style={{ width: `${(r.value / max) * 100}%` }} /></div>
            <span>{fmtMoney(r.value)}{metric !== "count" && <span className="gv-muted"> ({r.count})</span>}</span>
          </div>
        ))}
        {result.data?.rows.length === 0 && <p className="gv-muted">No data for this report.</p>}
        {result.data && <p className="gv-muted">{result.data.total} records</p>}
      </section>
      {(saved.data?.reports.length ?? 0) > 0 && (
        <section className="gv-panel">
          <h2>Saved reports</h2>
          {saved.data!.reports.map((r) => (
            <div key={r.id} className="gv-agenda">
              <button className="gv-link" onClick={() => { setModule(r.module); setGroupBy(r.groupBy); setMetric(r.metric); setMetricField(r.metricField); }}>{r.name}</button>
              <span className="gv-muted">{r.module}</span>
              {canWrite && <button className="gv-link" onClick={async () => { await api.tool(ws.id, "delete_report", { reportId: r.id }); saved.reload(); }}>Delete</button>}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

// ---------------- Settings ----------------

export function SettingsPage() {
  const { ws, me, members, isAdmin, toast, refreshMe, canWrite } = useApp();
  const [name, setName] = useState(ws.name);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<Role, "owner">>("member");
  const [inviteLink, setInviteLink] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [localMembers, setLocalMembers] = useState<Member[] | null>(null);
  const list = localMembers ?? members;
  const reloadMembers = async () => setLocalMembers(await api.tool<Member[]>(ws.id, "list_members"));
  const mcpUrl = `${window.location.origin}/mcp`;
  return (
    <div className="gv-page">
      <div className="gv-page-head"><h1>⚙️ Settings</h1></div>

      <section className="gv-panel">
        <h2>Workspace</h2>
        <div className="gv-toolbar">
          <input className="gv-input" value={name} disabled={!isAdmin} onChange={(e) => setName(e.target.value)} />
          {isAdmin && <button className="gv-btn" disabled={name === ws.name || !name.trim()} onClick={async () => { try { await api.renameWorkspace(ws.id, name); await refreshMe(); toast("Renamed"); } catch (e) { toast(errorMessage(e), "error"); } }}>Rename</button>}
        </div>
        <p className="gv-muted">Your role: <strong>{ws.role}</strong>{ws.personal ? " · Personal workspace" : ""}</p>
      </section>

      <section className="gv-panel">
        <h2>Members</h2>
        <table className="gv-table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th>{isAdmin && <th />}</tr></thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.id}>
                <td>{m.name}{m.isYou && " (you)"}</td><td>{m.email}</td>
                <td>{isAdmin && m.role !== "owner" && !m.isYou ? (
                  <select className="gv-input" value={m.role} onChange={async (e) => { try { await api.tool(ws.id, "change_member_role", { userId: m.id, role: e.target.value }); await reloadMembers(); toast("Role updated"); } catch (err) { toast(errorMessage(err), "error"); } }}>
                    <option value="admin">admin</option><option value="member">member</option><option value="viewer">viewer</option>
                  </select>) : m.role}</td>
                {isAdmin && <td>{m.role !== "owner" && !m.isYou && <button className="gv-link" onClick={async () => { if (!window.confirm(`Remove ${m.email}?`)) return; try { await api.tool(ws.id, "remove_member", { userId: m.id }); await reloadMembers(); toast("Member removed"); } catch (e) { toast(errorMessage(e), "error"); } }}>Remove</button>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {isAdmin && (
          <form className="gv-toolbar" onSubmit={async (e) => {
            e.preventDefault();
            try {
              const r = await api.tool<{ invitePath: string }>(ws.id, "invite_member", { email, role });
              setInviteLink(`${window.location.origin}${r.invitePath}`); setEmail("");
            } catch (err) { toast(errorMessage(err), "error"); }
          }}>
            <input className="gv-input" type="email" required placeholder="teammate@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <select className="gv-input" value={role} onChange={(e) => setRole(e.target.value as "member")}>
              {ws.role === "owner" && <option value="admin">Admin</option>}<option value="member">Member</option><option value="viewer">Viewer</option>
            </select>
            <button className="gv-btn primary">Create invite link</button>
          </form>
        )}
        {inviteLink && <div className="gv-info">Send this link to your teammate (valid 7 days; they must sign in with that email):<br /><code>{inviteLink}</code> <button className="gv-link" onClick={() => void navigator.clipboard.writeText(inviteLink).then(() => toast("Copied"))}>Copy</button></div>}
      </section>

      <section className="gv-panel">
        <h2>Google Sheet copy</h2>
        <p>A read-only copy of this workspace is kept in the owner's Google Drive and refreshed every few minutes.</p>
        <p className="gv-muted">Status: {ws.syncStatus ?? "pending"}{ws.lastSyncedAt ? ` · last synced ${fmtDate(ws.lastSyncedAt)}` : ""}{ws.syncError ? ` · ${ws.syncError}` : ""}</p>
        <div className="gv-actions">
          {ws.sheetId && <a className="gv-btn" href={`https://docs.google.com/spreadsheets/d/${ws.sheetId}`} target="_blank" rel="noreferrer">Open Sheet</a>}
          {canWrite && <button className="gv-btn" disabled={syncing} onClick={async () => {
            setSyncing(true);
            try { const r = await api.syncSheet(ws.id); const f = r.synced.find((x) => !x.ok); if (f) toast(`Sync failed: ${f.error}`, "error"); else toast("Sheet updated"); await refreshMe(); } catch (e) { toast(errorMessage(e), "error"); } finally { setSyncing(false); }
          }}>{syncing ? "Syncing…" : "Sync now"}</button>}
        </div>
      </section>

      <section className="gv-panel">
        <h2>Connect Claude</h2>
        <p>Use your CRM from Claude: Settings → Connectors → Add custom connector, and paste:</p>
        <code>{mcpUrl}</code> <button className="gv-link" onClick={() => void navigator.clipboard.writeText(mcpUrl).then(() => toast("Copied"))}>Copy</button>
        <p className="gv-muted">You'll sign in with Google and choose this workspace. Claude gets the same permissions as your role.</p>
      </section>

      <section className="gv-panel">
        <h2>Account</h2>
        <p>{me.user.name} · {me.user.email}</p>
        <button className="gv-btn" onClick={async () => { await api.logout(); window.location.href = "/"; }}>Sign out</button>
        {ws.role === "owner" && !ws.personal && <button className="gv-btn danger" onClick={async () => {
          if (window.prompt(`Type the workspace name "${ws.name}" to delete it and all its data permanently:`) !== ws.name) return;
          try { await api.deleteWorkspace(ws.id); localStorage.removeItem("gallivanter.workspace"); window.location.href = "/app"; } catch (e) { toast(errorMessage(e), "error"); }
        }}>Delete workspace</button>}
      </section>
    </div>
  );
}
