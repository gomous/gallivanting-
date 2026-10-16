import { useEffect, useRef, useState } from "react";
import type { FieldDef, ModuleKey } from "../crm/model";
import { moduleDefs, moduleKeys } from "../crm/schema";
import { api, type Rec } from "./api";
import { useApp } from "./context";

export const moduleSlug = (m: ModuleKey) => m.toLowerCase().replace(/\s+/g, "-");
export const moduleFromSlug = (s: string): ModuleKey | undefined => moduleKeys.find((m) => moduleSlug(m) === s);

export const moduleGroups: { label: string; modules: ModuleKey[] }[] = [
  { label: "Sales", modules: ["Leads", "Contacts", "Accounts", "Deals"] },
  { label: "Activities", modules: ["Tasks", "Meetings", "Calls"] },
  { label: "Marketing", modules: ["Campaigns"] },
  { label: "Inventory", modules: ["Products", "Price Books", "Quotes", "Sales Orders", "Purchase Orders", "Invoices", "Vendors"] },
  { label: "Support", modules: ["Cases", "Solutions"] },
];

export const moduleIcon: Record<ModuleKey, string> = {
  Leads: "🎯", Contacts: "👤", Accounts: "🏢", Deals: "💼", Campaigns: "📣", Tasks: "✅", Meetings: "📅", Calls: "📞",
  Products: "📦", "Price Books": "🏷️", Quotes: "📝", "Sales Orders": "🧾", "Purchase Orders": "🛒", Invoices: "💳",
  Vendors: "🚚", Cases: "🛟", Solutions: "💡",
};

/** Fields hidden from forms: the legacy "owner" select is replaced by real workspace members. */
export const formFields = (m: ModuleKey) => moduleDefs[m].fields.filter((f) => f.key !== "owner" && !f.label.includes("(legacy display)"));

/** Cache of record id → title for lookup display. */
const titleCache = new Map<string, string>();
export function useTitles(ids: string[]): Record<string, string> {
  const { ws } = useApp();
  const [, force] = useState(0);
  const key = [...new Set(ids.filter(Boolean))].sort().join(",");
  useEffect(() => {
    const missing = key.split(",").filter((id) => id && !titleCache.has(id));
    if (!missing.length) return;
    api.tool<Record<string, string>>(ws.id, "resolve_titles", { ids: missing.slice(0, 200) })
      .then((t) => { for (const id of missing) titleCache.set(id, t[id] ?? "(deleted)"); force((n) => n + 1); })
      .catch(() => {});
  }, [key, ws.id]);
  return Object.fromEntries(key.split(",").filter(Boolean).map((id) => [id, titleCache.get(id) ?? "…"]));
}
export const rememberTitle = (r: { id: string; title: string }) => titleCache.set(r.id, r.title);

export function displayValue(f: FieldDef | undefined, v: string | undefined, titles: Record<string, string>): string {
  if (!v) return "";
  if (f?.type === "lookup") return titles[v] ?? v;
  if (f?.type === "checkbox") return ["true", "yes", "1"].includes(v.toLowerCase()) ? "Yes" : "No";
  if (f?.type === "number") return Number.isFinite(Number(v)) ? Number(v).toLocaleString() : v;
  if (f?.type === "datetime-local") return v.replace("T", " ").slice(0, 16);
  return v;
}

export function LookupInput({ module, value, onChange, id }: { module: ModuleKey; value: string; onChange: (v: string) => void; id?: string }) {
  const { ws } = useApp();
  const titles = useTitles(value ? [value] : []);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Rec[]>([]);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!open) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      api.tool<{ records: Rec[] }>(ws.id, "search_records", { module, query: q, limit: 8 }).then((r) => setResults(r.records)).catch(() => setResults([]));
    }, 200);
  }, [q, open, module, ws.id]);
  return (
    <div className="gv-lookup">
      {value && !open ? (
        <div className="gv-lookup-chosen">
          <span>{titles[value]}</span>
          <button type="button" className="gv-link" onClick={() => { setOpen(true); setQ(""); }}>Change</button>
          <button type="button" className="gv-link" onClick={() => onChange("")}>Clear</button>
        </div>
      ) : (
        <input id={id} className="gv-input" placeholder={`Search ${module}…`} value={q} autoComplete="off"
          onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 150)} onChange={(e) => setQ(e.target.value)} />
      )}
      {open && results.length > 0 && (
        <ul className="gv-lookup-menu">
          {results.map((r) => (
            <li key={r.id}><button type="button" onMouseDown={() => { rememberTitle(r); onChange(r.id); setOpen(false); }}>{r.title}</button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FieldInput({ field, value, onChange }: { field: FieldDef; value: string; onChange: (v: string) => void }) {
  const id = `f-${field.key}`;
  switch (field.type) {
    case "select":
      return (
        <select id={id} className="gv-input" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {field.options?.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case "textarea":
      return <textarea id={id} className="gv-input" rows={3} value={value} onChange={(e) => onChange(e.target.value)} />;
    case "checkbox":
      return <input id={id} type="checkbox" checked={["true", "yes", "1"].includes(value.toLowerCase())} onChange={(e) => onChange(e.target.checked ? "true" : "false")} />;
    case "lookup":
      return <LookupInput id={id} module={field.lookup!} value={value} onChange={onChange} />;
    case "number":
      return <input id={id} className="gv-input" type="number" step="any" value={value} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <input id={id} className="gv-input" type={field.type ?? "text"} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
}

export function OwnerSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { members } = useApp();
  return (
    <select className="gv-input" value={value} onChange={(e) => onChange(e.target.value)}>
      {members.map((m) => <option key={m.id} value={m.id}>{m.isYou ? `You (${m.name || m.email})` : m.name || m.email}</option>)}
    </select>
  );
}
