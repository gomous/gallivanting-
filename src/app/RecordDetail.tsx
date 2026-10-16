import { useState } from "react";
import type { ModuleKey } from "../crm/model";
import { fieldDefinition, moduleDefs } from "../crm/schema";
import { api, changes, errorMessage, fmtDate, fmtMoney, type Rec } from "./api";
import { useApp, useLoad } from "./context";
import { displayValue, formFields, moduleIcon, moduleSlug, useTitles } from "./fields";
import { RecordForm } from "./RecordForm";

interface Detail {
  record: Rec;
  notes: { id: string; text: string; authorId: string; createdAt: string }[];
  timeline: { id: string; action: string; title: string; detail: string; actorId: string; source: string; at: string }[];
  linked: { id: string; module: ModuleKey; title: string }[];
  lineItems: LineItem[];
  referencedBy: { id: string; module: ModuleKey; title: string }[];
}
interface LineItem { id?: string; productId: string; description: string; quantity: number; price: number; discount: number; tax: number }

const inventory: ModuleKey[] = ["Quotes", "Sales Orders", "Purchase Orders", "Invoices"];
const activityParents: ModuleKey[] = ["Leads", "Contacts", "Accounts", "Deals", "Campaigns"];

export function RecordDetail({ module, id }: { module: ModuleKey; id: string }) {
  const { ws, navigate, toast, canWrite, memberName } = useApp();
  const { data, error, reload } = useLoad(() => api.tool<Detail>(ws.id, "get_record", { id }), [ws.id, id]);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<"details" | "notes" | "related" | "history">("details");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const def = moduleDefs[module];
  const r = data?.record;
  const fields = formFields(module);
  const titles = useTitles(r ? fields.filter((f) => f.type === "lookup").map((f) => r.values[f.key]) : []);

  if (error) return <div className="gv-page"><div className="gv-error">{error}</div><button className="gv-btn" onClick={() => navigate(`/app/${moduleSlug(module)}`)}>Back to {module}</button></div>;
  if (!r || !data) return <div className="gv-page gv-muted">Loading…</div>;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); toast(label); changes.emit(); reload(); } catch (e) { toast(errorMessage(e), "error"); } finally { setBusy(false); }
  };
  const go = (m: ModuleKey, recId: string) => navigate(`/app/${moduleSlug(m)}/${recId}`);
  const newRelated = (m: ModuleKey) => {
    const p = new URLSearchParams();
    if (module === "Contacts") p.set("contactId", r.id);
    if (activityParents.includes(module)) { p.set("relatedId", r.id); p.set("relatedModule", module); }
    navigate(`/app/${moduleSlug(m)}/new?${p}`);
  };

  if (editing) return (
    <div className="gv-page">
      <div className="gv-page-head"><h1>Edit {def.singular}: {r.title}</h1></div>
      <RecordForm module={module} record={r} onDone={() => { setEditing(false); reload(); }} />
    </div>
  );

  return (
    <div className="gv-page">
      <div className="gv-crumbs"><button className="gv-link" onClick={() => navigate(`/app/${moduleSlug(module)}`)}>{moduleIcon[module]} {module}</button> / {r.title}</div>
      <div className="gv-page-head">
        <div>
          <h1>{r.title} {r.deletedAt && <span className="gv-badge danger">In recycle bin</span>} {r.convertedTo && <span className="gv-badge">Converted</span>}</h1>
          <div className="gv-muted">Owner: {memberName(r.ownerId)} · Updated {fmtDate(r.updatedAt)} · {r.tags.map((t) => <span key={t} className="gv-tag">{t}</span>)}</div>
        </div>
        {canWrite && (
          <div className="gv-actions">
            {r.deletedAt ? <button className="gv-btn primary" disabled={busy} onClick={() => run("Restored", () => api.tool(ws.id, "restore_record", { id }))}>Restore</button> : <>
              <button className="gv-btn primary" onClick={() => setEditing(true)}>Edit</button>
              {module === "Leads" && !r.convertedTo && <ConvertLead id={id} onDone={(res) => { changes.emit(); go("Contacts", res.contactId); }} />}
              {module === "Quotes" && <button className="gv-btn" disabled={busy} onClick={() => run("Sales order created", async () => { const so = await api.tool<Rec>(ws.id, "convert_quote_to_sales_order", { quoteId: id }); go("Sales Orders", so.id); })}>→ Sales Order</button>}
              {module === "Sales Orders" && <button className="gv-btn" disabled={busy} onClick={() => run("Invoice created", async () => { const inv = await api.tool<Rec>(ws.id, "convert_sales_order_to_invoice", { salesOrderId: id }); go("Invoices", inv.id); })}>→ Invoice</button>}
              {inventory.includes(module) && <button className="gv-btn" onClick={() => window.print()}>Print / PDF</button>}
              <button className="gv-btn danger" disabled={busy} onClick={() => window.confirm(`Move "${r.title}" to the recycle bin?`) && run("Moved to recycle bin", () => api.tool(ws.id, "delete_record", { id }))}>Delete</button>
            </>}
          </div>
        )}
      </div>

      {module === "Deals" && def.stages && (
        <div className="gv-stages">
          {def.stages.map((s) => (
            <button key={s} className={`gv-stage ${r.values.stage === s ? "on" : ""} ${s === "Closed Lost" ? "lost" : ""}`} disabled={!canWrite || busy || !!r.deletedAt}
              onClick={() => {
                const reasonForLoss = s === "Closed Lost" ? window.prompt("Reason for loss (optional):") ?? undefined : undefined;
                void run(`Stage → ${s}`, () => api.tool(ws.id, "move_deal_stage", { dealId: id, stage: s, reasonForLoss }));
              }}>{s}</button>
          ))}
        </div>
      )}

      {r.convertedTo && (
        <div className="gv-info">Converted to {r.convertedTo.accountId && <button className="gv-link" onClick={() => go("Accounts", r.convertedTo!.accountId)}>account</button>}
          {r.convertedTo.contactId && <> · <button className="gv-link" onClick={() => go("Contacts", r.convertedTo!.contactId)}>contact</button></>}
          {r.convertedTo.dealId && <> · <button className="gv-link" onClick={() => go("Deals", r.convertedTo!.dealId)}>deal</button></>}</div>
      )}

      {canWrite && !r.deletedAt && activityParents.includes(module) && (
        <div className="gv-quick">
          <button className="gv-btn" onClick={() => newRelated("Tasks")}>+ Task</button>
          <button className="gv-btn" onClick={() => newRelated("Calls")}>+ Log call</button>
          <button className="gv-btn" onClick={() => newRelated("Meetings")}>+ Meeting</button>
          {(module === "Accounts" || module === "Contacts") && <button className="gv-btn" onClick={() => navigate(`/app/deals/new?${module === "Accounts" ? "accountId" : "contactId"}=${r.id}`)}>+ Deal</button>}
          {r.values.email && <a className="gv-btn" href={`mailto:${r.values.email}`} onClick={() => void api.tool(ws.id, "add_note", { recordId: id, text: `Email composed to ${r.values.email}` }).then(reload)}>✉ Email</a>}
        </div>
      )}

      <div className="gv-tabs">
        {(["details", "notes", "related", "history"] as const).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "details" ? "Details" : t === "notes" ? `Notes (${data.notes.length})` : t === "related" ? `Related (${data.referencedBy.length + data.linked.length})` : "History"}
          </button>
        ))}
      </div>

      {tab === "details" && (
        <>
          <dl className="gv-dl">
            {fields.filter((f) => r.values[f.key]).map((f) => (
              <div key={f.key} className={f.type === "textarea" ? "wide" : ""}>
                <dt>{f.label}</dt>
                <dd>{f.type === "lookup" && f.lookup ? <button className="gv-link" onClick={() => go(f.lookup!, r.values[f.key])}>{titles[r.values[f.key]]}</button>
                  : f.type === "email" ? <a href={`mailto:${r.values[f.key]}`}>{r.values[f.key]}</a>
                  : f.type === "url" ? <a href={/^https?:/.test(r.values[f.key]) ? r.values[f.key] : `https://${r.values[f.key]}`} target="_blank" rel="noreferrer">{r.values[f.key]}</a>
                  : displayValue(fieldDefinition(module, f.key), r.values[f.key], titles)}</dd>
              </div>
            ))}
          </dl>
          {fields.every((f) => !r.values[f.key]) && <p className="gv-muted">No details yet.</p>}
          {inventory.includes(module) && <LineItems recordId={id} items={data.lineItems} canWrite={canWrite && !r.deletedAt} onSaved={reload} />}
        </>
      )}

      {tab === "notes" && (
        <div>
          {canWrite && !r.deletedAt && (
            <form className="gv-note-form" onSubmit={(e) => { e.preventDefault(); if (note.trim()) void run("Note added", async () => { await api.tool(ws.id, "add_note", { recordId: id, text: note.trim() }); setNote(""); }); }}>
              <textarea className="gv-input" rows={3} placeholder="Write a note…" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="gv-btn primary" disabled={!note.trim() || busy}>Add note</button>
            </form>
          )}
          {data.notes.map((n) => (
            <div key={n.id} className="gv-note">
              <div className="gv-muted">{memberName(n.authorId)} · {fmtDate(n.createdAt)}
                {canWrite && <button className="gv-link" onClick={() => window.confirm("Delete this note?") && run("Note deleted", () => api.tool(ws.id, "delete_note", { noteId: n.id }))}>Delete</button>}</div>
              <p>{n.text}</p>
            </div>
          ))}
          {data.notes.length === 0 && <p className="gv-muted">No notes yet.</p>}
        </div>
      )}

      {tab === "related" && (
        <div>
          {data.referencedBy.length === 0 && data.linked.length === 0 && <p className="gv-muted">Nothing related yet.</p>}
          {Object.entries([...data.referencedBy, ...data.linked].reduce<Record<string, Detail["linked"]>>((acc, x) => { (acc[x.module] ??= []).push(x); return acc; }, {})).map(([m, items]) => (
            <div key={m} className="gv-related">
              <h3>{moduleIcon[m as ModuleKey]} {m} ({items!.length})</h3>
              <ul>{items!.map((x) => <li key={x.id}><button className="gv-link" onClick={() => go(x.module, x.id)}>{x.title}</button></li>)}</ul>
            </div>
          ))}
        </div>
      )}

      {tab === "history" && (
        <ul className="gv-timeline">
          {data.timeline.map((t) => (
            <li key={t.id}>
              <strong>{t.title}</strong> {t.detail && <span className="gv-muted">— {t.detail}</span>}
              <div className="gv-muted">{memberName(t.actorId) || "System"} · {fmtDate(t.at)} · via {t.source === "ui" ? "app" : t.source === "ai" ? "AI assistant" : t.source === "mcp" ? "Claude" : t.source}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConvertLead({ id, onDone }: { id: string; onDone: (r: { contactId: string }) => void }) {
  const { ws, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [createDeal, setCreateDeal] = useState(true);
  const [amount, setAmount] = useState("");
  const [closingDate, setClosingDate] = useState(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  if (!open) return <button className="gv-btn" onClick={() => setOpen(true)}>Convert</button>;
  return (
    <div className="gv-modal-backdrop" onClick={() => setOpen(false)}>
      <div className="gv-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Convert lead</h2>
        <p className="gv-muted">Creates (or reuses) an Account and a Contact from this lead.</p>
        <label className="gv-check-label"><input type="checkbox" checked={createDeal} onChange={(e) => setCreateDeal(e.target.checked)} /> Also create a deal</label>
        {createDeal && <div className="gv-grid">
          <label className="gv-field"><span>Amount</span><input className="gv-input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label className="gv-field"><span>Closing date</span><input className="gv-input" type="date" value={closingDate} onChange={(e) => setClosingDate(e.target.value)} /></label>
        </div>}
        <div className="gv-actions gv-form-actions">
          <button className="gv-btn" onClick={() => setOpen(false)}>Cancel</button>
          <button className="gv-btn primary" onClick={async () => {
            try {
              const res = await api.tool<{ contactId: string }>(ws.id, "convert_lead", { leadId: id, createDeal, amount: amount || undefined, closingDate: createDeal ? closingDate : undefined });
              toast("Lead converted"); setOpen(false); onDone(res);
            } catch (e) { toast(errorMessage(e), "error"); }
          }}>Convert</button>
        </div>
      </div>
    </div>
  );
}

function LineItems({ recordId, items, canWrite, onSaved }: { recordId: string; items: LineItem[]; canWrite: boolean; onSaved: () => void }) {
  const { ws, toast } = useApp();
  const [rows, setRows] = useState<LineItem[]>(items);
  const [dirty, setDirty] = useState(false);
  const titles = useTitles(rows.map((r) => r.productId));
  const set = (i: number, patch: Partial<LineItem>) => { setRows(rows.map((r, j) => j === i ? { ...r, ...patch } : r)); setDirty(true); };
  const line = (r: LineItem) => { const g = r.quantity * r.price; const d = g * r.discount / 100; return (g - d) * (1 + r.tax / 100); };
  const total = rows.reduce((a, r) => a + line(r), 0);
  return (
    <div className="gv-lines">
      <h3>Line items</h3>
      <table className="gv-table">
        <thead><tr><th>Product / description</th><th>Qty</th><th>Price</th><th>Disc %</th><th>Tax %</th><th>Total</th>{canWrite && <th />}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{canWrite ? <input className="gv-input" value={r.description} placeholder={r.productId ? titles[r.productId] : "Description"} onChange={(e) => set(i, { description: e.target.value })} /> : r.description}</td>
              {(["quantity", "price", "discount", "tax"] as const).map((k) => (
                <td key={k}>{canWrite ? <input className="gv-input num" type="number" step="any" min="0" value={r[k]} onChange={(e) => set(i, { [k]: Number(e.target.value) })} /> : r[k]}</td>
              ))}
              <td>{fmtMoney(line(r))}</td>
              {canWrite && <td><button className="gv-link" onClick={() => { setRows(rows.filter((_, j) => j !== i)); setDirty(true); }}>✕</button></td>}
            </tr>
          ))}
          <tr className="gv-total"><td colSpan={5}>Grand total</td><td>{fmtMoney(total)}</td>{canWrite && <td />}</tr>
        </tbody>
      </table>
      {canWrite && (
        <div className="gv-actions">
          <button className="gv-btn" onClick={() => { setRows([...rows, { productId: "", description: "", quantity: 1, price: 0, discount: 0, tax: 0 }]); setDirty(true); }}>+ Add line</button>
          <button className="gv-btn primary" disabled={!dirty} onClick={async () => {
            try {
              await api.tool(ws.id, "set_line_items", { recordId, items: rows.map(({ id: _id, productId, ...rest }) => ({ ...rest, ...(productId ? { productId } : {}) })) });
              toast("Line items saved"); setDirty(false); changes.emit(); onSaved();
            } catch (e) { toast(errorMessage(e), "error"); }
          }}>Save line items</button>
        </div>
      )}
    </div>
  );
}
