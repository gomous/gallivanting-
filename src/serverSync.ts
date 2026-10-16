/**
 * Bridges the original Gallivanter screens (which keep collections in memory /
 * localStorage) to the D1 backend. On sign-in we load a snapshot from the server
 * into the same localStorage keys the screens already read; every save is diffed
 * and only changed records are pushed. Screens themselves are unchanged.
 */
import type { Lead, Task } from "./types";
import type { ModuleRecord } from "./moduleRecords";

const moduleKey = (module: string) => `gallivanting.backend.collection.module.${module}`;
const SERVER_MODULES = new Set([
  "Leads", "Contacts", "Accounts", "Deals", "Campaigns", "Tasks", "Meetings", "Calls", "Products", "Price Books",
  "Quotes", "Sales Orders", "Purchase Orders", "Invoices", "Vendors", "Cases", "Solutions",
]);

interface ServerRecord {
  id: string; values: Record<string, string>; tags?: string[]; extra?: Record<string, unknown>;
  createdAt?: string; updatedAt?: string; deletedAt?: string | null;
}
interface Snapshot { workspaceId: string; role: string; modules: Record<string, ServerRecord[]>; initialized: string[]; cursor: string }
type Upsert = ServerRecord;

let snapshotPromise: Promise<Snapshot | null> | null = null;
let current: Snapshot | null = null;
const baseline = new Map<string, Map<string, string>>(); // module -> id -> serialized
const queued = new Map<string, Map<string, Upsert | null>>(); // null = delete
const timers = new Map<string, number>();
type Status = "idle" | "syncing" | "synced" | "error";
const statusListeners = new Set<(s: Status, detail?: string) => void>();
export const onSyncStatus = (fn: (s: Status, detail?: string) => void) => { statusListeners.add(fn); return () => { statusListeners.delete(fn); }; };
const emit = (s: Status, detail?: string) => statusListeners.forEach((f) => f(s, detail));

// ---------- mapping ----------

const toModuleRecord = (r: ServerRecord): ModuleRecord => ({
  id: r.id,
  values: r.values,
  ...(Array.isArray(r.extra?.notes) ? { notes: r.extra!.notes as ModuleRecord["notes"] } : {}),
  ...(Array.isArray(r.extra?.timeline) ? { timeline: r.extra!.timeline as ModuleRecord["timeline"] } : {}),
  ...(r.createdAt ? { createdAt: r.createdAt } : {}),
  ...(r.updatedAt ? { updatedAt: r.updatedAt } : {}),
  ...(r.deletedAt ? { deletedAt: r.deletedAt } : {}),
});
const fromModuleRecord = (r: ModuleRecord): Upsert => ({
  id: r.id,
  values: r.values,
  extra: { notes: r.notes ?? [], timeline: r.timeline ?? [] },
  deletedAt: r.deletedAt ?? null,
});

const LEAD_VALUE_KEYS = ["firstName", "lastName", "company", "title", "email", "phone", "website", "source", "owner", "status", "industry", "rating", "city", "country", "employees", "revenue"] as const;
const leadFromServer = (r: ServerRecord): Lead => {
  const x = (r.extra ?? {}) as Partial<Lead>;
  const lead = Object.fromEntries(LEAD_VALUE_KEYS.map((k) => [k, r.values[k] ?? ""])) as unknown as Lead;
  return {
    ...lead, id: r.id, tags: r.tags ?? [], notes: Array.isArray(x.notes) ? x.notes : [],
    lastActivity: x.lastActivity ?? "", createdAt: x.createdAt ?? (r.createdAt ? new Date(r.createdAt).toLocaleDateString() : ""),
    activityCount: x.activityCount ?? 0, taskCount: x.taskCount ?? 0, emailCount: x.emailCount ?? 0,
    callCount: x.callCount ?? 0, campaignCount: x.campaignCount ?? 0, dealCount: x.dealCount ?? 0,
  };
};
const leadToServer = (l: Lead): Upsert => ({
  id: l.id,
  values: Object.fromEntries(LEAD_VALUE_KEYS.map((k) => [k, String(l[k] ?? "")]).filter(([, v]) => v !== "")),
  tags: l.tags ?? [],
  extra: { notes: l.notes ?? [], lastActivity: l.lastActivity, createdAt: l.createdAt, activityCount: l.activityCount, taskCount: l.taskCount, emailCount: l.emailCount, callCount: l.callCount, campaignCount: l.campaignCount, dealCount: l.dealCount },
});
const TASK_KEYS = ["subject", "dueDate", "status", "priority", "owner", "contact", "relatedTo", "description"] as const;
const taskFromServer = (r: ServerRecord): Task => ({ id: r.id, ...(Object.fromEntries(TASK_KEYS.map((k) => [k, r.values[k] ?? ""])) as unknown as Omit<Task, "id">) });
const taskToServer = (t: Task): Upsert => ({ id: t.id, values: Object.fromEntries(TASK_KEYS.map((k) => [k, String(t[k] ?? "")]).filter(([, v]) => v !== "")) });

// ---------- snapshot ----------

function setBaseline(module: string, records: Upsert[]) {
  baseline.set(module, new Map(records.map((r) => [r.id, JSON.stringify(r)])));
}

async function fetchSnapshot(): Promise<Snapshot | null> {
  const res = await fetch("/api/legacy/snapshot", { credentials: "same-origin" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Could not load your CRM (${res.status}).`);
  return (await res.json()) as Snapshot;
}

/** Load server data into the places the screens read from. Resolves null when signed out. */
export function bootstrap(force = false): Promise<Snapshot | null> {
  if (snapshotPromise && !force) return snapshotPromise;
  snapshotPromise = fetchSnapshot().then((snap) => {
    if (!snap) return null;
    current = snap;
    for (const module of SERVER_MODULES) {
      if (module === "Leads" || module === "Tasks") continue;
      const pending = queued.get(module);
      if (snap.initialized.includes(module)) {
        const records = (snap.modules[module] ?? []).filter((r) => !pending?.has(r.id)).map(toModuleRecord);
        try { localStorage.setItem(moduleKey(module), JSON.stringify(records)); } catch { /* storage full/blocked */ }
        setBaseline(module, (snap.modules[module] ?? []).map((r) => fromModuleRecord(toModuleRecord(r))));
      } else if (!baseline.has(module)) {
        // Not on the server yet: if this browser has its own saved data, migrate it once.
        const raw = localStorage.getItem(moduleKey(module));
        if (raw) {
          try { queueModule(module, JSON.parse(raw) as ModuleRecord[]); } catch { /* ignore unreadable legacy data */ }
        }
      }
    }
    return snap;
  }).catch((e) => { snapshotPromise = null; throw e; });
  return snapshotPromise;
}

// ---------- pushing changes ----------

function schedule(module: string) {
  window.clearTimeout(timers.get(module));
  timers.set(module, window.setTimeout(() => void flush(module), 700));
}

async function flush(module: string): Promise<void> {
  const batch = queued.get(module);
  if (!batch?.size) return;
  queued.delete(module);
  const upserts = [...batch.values()].filter((v): v is Upsert => v !== null);
  const deletes = [...batch.entries()].filter(([, v]) => v === null).map(([id]) => id);
  emit("syncing");
  try {
    const res = await fetch(`/api/legacy/sync/${encodeURIComponent(module)}`, {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upserts, deletes }),
    });
    const data = await res.json().catch(() => ({})) as { errors?: { id: string; error: string }[]; error?: { message: string } };
    if (!res.ok) throw new Error(data.error?.message ?? `Save failed (${res.status})`);
    const base = baseline.get(module) ?? new Map<string, string>();
    for (const u of upserts) if (!data.errors?.some((e) => e.id === u.id)) base.set(u.id, JSON.stringify(u));
    for (const id of deletes) base.delete(id);
    baseline.set(module, base);
    if (data.errors?.length) emit("error", `${data.errors.length} ${module} record(s) were not saved: ${data.errors[0].error}`);
    else emit("synced");
  } catch (e) {
    // Put the batch back (without overwriting newer edits) and retry later.
    const again = queued.get(module) ?? new Map<string, Upsert | null>();
    for (const [id, v] of batch) if (!again.has(id)) again.set(id, v);
    queued.set(module, again);
    emit("error", e instanceof Error ? e.message : String(e));
    window.setTimeout(() => schedule(module), 5000);
  }
}

function queueDiff(module: string, records: Upsert[]) {
  if (typeof window === "undefined" || !SERVER_MODULES.has(module) || !current) return;
  if (current.role === "viewer") return;
  const base = baseline.get(module) ?? new Map<string, string>();
  const q = queued.get(module) ?? new Map<string, Upsert | null>();
  const seen = new Set<string>();
  for (const r of records) {
    seen.add(r.id);
    const s = JSON.stringify(r);
    if (base.get(r.id) !== s) q.set(r.id, r);
    else q.delete(r.id);
  }
  for (const id of base.keys()) if (!seen.has(id)) q.set(id, null);
  if (q.size) { queued.set(module, q); schedule(module); }
}

export function queueModule(module: string, records: ModuleRecord[]) {
  queueDiff(module, records.map(fromModuleRecord));
}

// ---------- Leads & Tasks (main workspace screens) ----------

export async function loadLeadsTasks(fallback: { leads: Lead[]; tasks: Task[] }): Promise<{ leads: Lead[]; tasks: Task[] } | null> {
  const snap = await bootstrap();
  if (!snap) return null;
  const pick = <T,>(module: string, map: (r: ServerRecord) => T, fb: T[], toServer: (t: T) => Upsert): T[] => {
    if (snap.initialized.includes(module)) {
      const list = (snap.modules[module] ?? []).filter((r) => !r.deletedAt).map(map);
      setBaseline(module, list.map(toServer));
      return list;
    }
    // Nothing on the server yet: show this browser's data (or the samples). With no baseline,
    // the first sync uploads the whole visible list so nothing on screen is lost.
    void toServer;
    return fb;
  };
  return {
    leads: pick("Leads", leadFromServer, fallback.leads, leadToServer),
    tasks: pick("Tasks", taskFromServer, fallback.tasks, taskToServer),
  };
}

export function queueLeadsTasks(leads: Lead[], tasks: Task[]) {
  queueDiff("Leads", leads.map(leadToServer));
  queueDiff("Tasks", tasks.map(taskToServer));
}

export function currentWorkspace(): Snapshot | null { return current; }
