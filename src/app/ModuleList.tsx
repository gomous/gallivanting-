import { useMemo, useRef, useState } from "react";
import type { ModuleKey } from "../crm/model";
import { fieldDefinition, fieldLabel, moduleDefs } from "../crm/schema";
import { api, changes, errorMessage, type Rec, type Rule } from "./api";
import { useApp, useLoad } from "./context";
import { displayValue, formFields, moduleIcon, moduleSlug, useTitles } from "./fields";

const PAGE = 50;
const operators: { value: string; label: string; needsValue: boolean }[] = [
  { value: "contains", label: "contains", needsValue: true },
  { value: "is", label: "is", needsValue: true },
  { value: "is_not", label: "is not", needsValue: true },
  { value: "starts_with", label: "starts with", needsValue: true },
  { value: "gt", label: ">", needsValue: true },
  { value: "lt", label: "<", needsValue: true },
  { value: "empty", label: "is empty", needsValue: false },
  { value: "not_empty", label: "is not empty", needsValue: false },
];

function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(",")).join("\n");
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export function ModuleList({ module }: { module: ModuleKey }) {
  const { ws, navigate, toast, canWrite, memberName } = useApp();
  const def = moduleDefs[module];
  const [query, setQuery] = useState("");
  const [rules, setRules] = useState<Rule[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<{ field: string; dir: "asc" | "desc" }>({ field: "updatedAt", dir: "desc" });
  const [page, setPage] = useState(0);
  const [bin, setBin] = useState(false);
  const [kanban, setKanban] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const activeRules = rules.filter((r) => r.field && (!operators.find((o) => o.value === r.operator)?.needsValue || r.value));

  const { data, error, loading } = useLoad(
    () => api.tool<{ records: Rec[]; total: number }>(ws.id, "search_records", {
      module, query: query || undefined, rules: activeRules.length ? activeRules : undefined,
      sortField: sort.field, sortDir: sort.dir, limit: kanban ? 500 : PAGE, offset: kanban ? 0 : page * PAGE, deletedOnly: bin || undefined,
    }),
    [ws.id, module, query, JSON.stringify(activeRules), sort.field, sort.dir, page, bin, kanban],
  );
  const records = data?.records ?? [];
  const columns = def.columns.filter((c) => c !== "owner");
  const lookupIds = records.flatMap((r) => columns.filter((c) => fieldDefinition(module, c)?.type === "lookup").map((c) => r.values[c]));
  const titles = useTitles(lookupIds);
  const groupField = def.groupField;
  const groups = useMemo(() => {
    if (!groupField) return [];
    const opts = def.stages ?? fieldDefinition(module, groupField)?.options ?? [];
    return opts.map((g) => ({ name: g, items: records.filter((r) => (r.values[groupField] ?? "") === g) }));
  }, [records, groupField, def.stages, module]);

  const toggleSort = (field: string) => setSort((s) => ({ field, dir: s.field === field && s.dir === "asc" ? "desc" : "asc" }));
  const allSelected = records.length > 0 && records.every((r) => selected.includes(r.id));

  async function bulk(action: "delete" | "restore" | "tag") {
    try {
      if (action === "tag") {
        const tag = window.prompt("Tag to add to selected records:");
        if (!tag) return;
        await api.tool(ws.id, "tag_records", { ids: selected, add: [tag] });
      } else {
        if (action === "delete" && !window.confirm(`Move ${selected.length} record(s) to the recycle bin?`)) return;
        for (const id of selected) await api.tool(ws.id, action === "delete" ? "delete_record" : "restore_record", { id });
      }
      toast(action === "tag" ? "Tag added" : action === "delete" ? "Moved to recycle bin" : "Restored");
      setSelected([]);
      changes.emit();
    } catch (e) { toast(errorMessage(e), "error"); }
  }

  async function exportCsv() {
    const all = await api.tool<{ records: Rec[] }>(ws.id, "search_records", { module, query: query || undefined, rules: activeRules.length ? activeRules : undefined, limit: 500 });
    const fields = formFields(module);
    const csv = toCsv([["Record ID", ...fields.map((f) => f.label), "Tags"], ...all.records.map((r) => [r.id, ...fields.map((f) => r.values[f.key] ?? ""), r.tags.join("; ")])]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${moduleSlug(module)}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  async function importCsv(file: File) {
    const rows = parseCsv(await file.text());
    if (rows.length < 2) return toast("The file has no data rows.", "error");
    const fields = formFields(module);
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const map = header.map((h) => fields.find((f) => f.label.toLowerCase() === h || f.key.toLowerCase() === h)?.key);
    if (!map.some(Boolean)) return toast(`No columns match ${module} fields. Use field labels as the header row (export a CSV to see them).`, "error");
    const data = rows.slice(1).map((r) => Object.fromEntries(map.map((k, i) => [k, r[i]?.trim() ?? ""]).filter(([k, v]) => k && v)));
    if (!window.confirm(`Import ${data.length} ${module} from ${file.name}? Matched columns: ${map.filter(Boolean).join(", ")}`)) return;
    let created = 0; const errs: string[] = [];
    for (let i = 0; i < data.length; i += 100) {
      const res = await api.tool<{ created: number; errors: { row: number; error: string }[] }>(ws.id, "bulk_create_records", { module, rows: data.slice(i, i + 100) });
      created += res.created;
      errs.push(...res.errors.map((e) => `Row ${i + e.row + 2}: ${e.error}`));
    }
    toast(`Imported ${created} of ${data.length}.${errs.length ? ` ${errs.length} failed — first: ${errs[0]}` : ""}`, errs.length ? "error" : "ok");
    changes.emit();
  }

  const cell = (r: Rec, c: string) => c === "ownerId" ? memberName(r.ownerId) : displayValue(fieldDefinition(module, c), r.values[c], titles);

  return (
    <div className="gv-page">
      <div className="gv-page-head">
        <h1>{moduleIcon[module]} {bin ? `${module} — Recycle bin` : module}</h1>
        <div className="gv-actions">
          {groupField && !bin && <button className="gv-btn" onClick={() => setKanban((k) => !k)}>{kanban ? "☰ List" : "▦ Board"}</button>}
          <button className="gv-btn" onClick={() => { setBin((b) => !b); setPage(0); setSelected([]); }}>{bin ? "← Back" : "🗑 Recycle bin"}</button>
          <button className="gv-btn" onClick={() => void exportCsv()}>Export CSV</button>
          {canWrite && <button className="gv-btn" onClick={() => fileRef.current?.click()}>Import CSV</button>}
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importCsv(f).catch((err) => toast(errorMessage(err), "error")); }} />
          {canWrite && <button className="gv-btn primary" onClick={() => navigate(`/app/${moduleSlug(module)}/new`)}>+ New {def.singular}</button>}
        </div>
      </div>

      <div className="gv-toolbar">
        <input className="gv-input gv-search" placeholder={`Search ${module}…`} value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} />
        <button className={`gv-btn ${activeRules.length ? "active" : ""}`} onClick={() => setShowFilters((s) => !s)}>Filters{activeRules.length ? ` (${activeRules.length})` : ""}</button>
        {selected.length > 0 && canWrite && (
          <div className="gv-bulk">
            <span>{selected.length} selected</span>
            {bin ? <button className="gv-btn" onClick={() => void bulk("restore")}>Restore</button> : <>
              <button className="gv-btn" onClick={() => void bulk("tag")}>Add tag</button>
              <button className="gv-btn danger" onClick={() => void bulk("delete")}>Delete</button>
            </>}
          </div>
        )}
      </div>

      {showFilters && (
        <div className="gv-filters">
          {rules.map((r, i) => (
            <div key={i} className="gv-filter-row">
              <select className="gv-input" value={r.field} onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, field: e.target.value } : x))}>
                <option value="">Field…</option>
                {formFields(module).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                <option value="tags">Tags</option>
              </select>
              <select className="gv-input" value={r.operator} onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, operator: e.target.value } : x))}>
                {operators.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {operators.find((o) => o.value === r.operator)?.needsValue && (
                fieldDefinition(module, r.field)?.options
                  ? <select className="gv-input" value={r.value ?? ""} onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}>
                      <option value="">—</option>{fieldDefinition(module, r.field)!.options!.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  : <input className="gv-input" value={r.value ?? ""} placeholder="Value" onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
              )}
              <button className="gv-link" onClick={() => setRules(rules.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <div className="gv-actions">
            <button className="gv-btn" onClick={() => setRules([...rules, { field: "", operator: "contains", value: "" }])}>+ Add condition</button>
            {rules.length > 0 && <button className="gv-link" onClick={() => setRules([])}>Clear all</button>}
          </div>
        </div>
      )}

      {error && <div className="gv-error">{error}</div>}

      {kanban && groupField ? (
        <div className="gv-board">
          {groups.map((g) => (
            <div key={g.name} className="gv-column"
              onDragOver={(e) => canWrite && e.preventDefault()}
              onDrop={async (e) => {
                const id = e.dataTransfer.getData("text/plain");
                if (!id) return;
                try {
                  if (module === "Deals") await api.tool(ws.id, "move_deal_stage", { dealId: id, stage: g.name });
                  else await api.tool(ws.id, "update_record", { id, values: { [groupField]: g.name } });
                  changes.emit();
                } catch (err) { toast(errorMessage(err), "error"); }
              }}>
              <div className="gv-column-head">{g.name} <span>{g.items.length}</span></div>
              {g.items.map((r) => (
                <div key={r.id} className="gv-card" draggable={canWrite} onDragStart={(e) => e.dataTransfer.setData("text/plain", r.id)} onClick={() => navigate(`/app/${moduleSlug(module)}/${r.id}`)}>
                  <strong>{r.title}</strong>
                  {r.values.amount && <div className="gv-muted">{Number(r.values.amount).toLocaleString()}</div>}
                  {r.values.closingDate && <div className="gv-muted">Closes {r.values.closingDate}</div>}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="gv-table-wrap">
          <table className="gv-table">
            <thead>
              <tr>
                {canWrite && <th className="gv-check"><input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? [] : records.map((r) => r.id))} /></th>}
                {columns.map((c) => <th key={c} onClick={() => toggleSort(c)}>{fieldLabel(module, c)}{sort.field === c ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}</th>)}
                <th onClick={() => toggleSort("ownerId")}>Owner</th>
                <th onClick={() => toggleSort("updatedAt")}>Updated{sort.field === "updatedAt" ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} onClick={() => navigate(`/app/${moduleSlug(module)}/${r.id}`)}>
                  {canWrite && <td className="gv-check" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.includes(r.id)} onChange={() => setSelected((s) => s.includes(r.id) ? s.filter((x) => x !== r.id) : [...s, r.id])} />
                  </td>}
                  {columns.map((c, i) => <td key={c}>{i === 0 ? <strong>{cell(r, c) || r.title}</strong> : cell(r, c)}{i === 0 && r.tags.length > 0 && r.tags.map((t) => <span key={t} className="gv-tag">{t}</span>)}</td>)}
                  <td>{memberName(r.ownerId)}</td>
                  <td className="gv-muted">{new Date(r.updatedAt).toLocaleDateString()}</td>
                </tr>
              ))}
              {!loading && records.length === 0 && (
                <tr><td colSpan={columns.length + 3} className="gv-empty">
                  {bin ? "The recycle bin is empty." : query || activeRules.length ? "No records match." : <>No {module.toLowerCase()} yet. {canWrite && <button className="gv-link" onClick={() => navigate(`/app/${moduleSlug(module)}/new`)}>Create the first one</button>}</>}
                </td></tr>
              )}
            </tbody>
          </table>
          {loading && <div className="gv-muted gv-pad">Loading…</div>}
          {(data?.total ?? 0) > PAGE && (
            <div className="gv-pager">
              <button className="gv-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Prev</button>
              <span>{page * PAGE + 1}–{Math.min((page + 1) * PAGE, data!.total)} of {data!.total}</span>
              <button className="gv-btn" disabled={(page + 1) * PAGE >= data!.total} onClick={() => setPage(page + 1)}>Next ›</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
