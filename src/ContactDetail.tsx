import { useState } from "react";
import type { ModuleField } from "./crmModules";
import type { ModuleRecord } from "./moduleRecords";

type RelatedModule = { name: string; records: ModuleRecord[]; error?: string };
type ContactTab = "Overview" | "Timeline" | "Related Lists";
type ActionDialog = { title: string; action: string; relatedList: string };
type EmailDraft = { to: string; subject: string; body: string };

const relatedListNames = [
  "Notes", "Connected Records", "Cadences", "Attachments", "Deals", "Open Activities",
  "Closed Activities", "Invited Meetings", "Products", "Cases", "Quotes", "Sales Orders",
  "Purchase Orders", "Emails", "Invoices", "Campaigns", "Social", "Reporting Contacts",
];

const relatedActions: Record<string, string[]> = {
  Notes: ["Add New"],
  "Connected Records": ["Add New"],
  Cadences: ["Enroll"],
  Attachments: ["Attach"],
  Deals: ["New Deal"],
  "Open Activities": ["Add New", "Column View", "Task", "Meeting", "Call"],
  "Closed Activities": ["Column View"],
  Products: ["Add Products"],
  Cases: ["Assign", "New"],
  Quotes: ["Assign", "New"],
  "Sales Orders": ["Assign", "New"],
  "Purchase Orders": ["Assign", "New"],
  Emails: ["Compose Email", "Mails", "Drafts", "Scheduled"],
  Invoices: ["Assign", "New"],
  Campaigns: ["Add Campaigns"],
  Social: ["Associate Twitter", "Associate Facebook"],
  "Reporting Contacts": ["New"],
};

const moreActions = ["Clone", "Delete", "Print Preview", "Find and Merge Duplicates", "Mail Merge", "Run Macro", "Customize Business Card", "Organize Contact Details", "Add Related List", "Review History", "Enroll to Cadence", "Add Kiosk", "Create Button", "Create Client Script"];

function normalized(value: string): string {
  return value.toLowerCase().replace(/\(sample\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

export function ContactDetailPanel({ record, fields, onClose, onEdit, onDelete, onUpdate, relatedModules, onOpenRelated }: {
  record: ModuleRecord;
  fields: ModuleField[];
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onUpdate: (record: ModuleRecord) => boolean;
  relatedModules: RelatedModule[];
  onOpenRelated: (module: string, recordId: string) => void;
}) {
  const [tab, setTab] = useState<ContactTab>("Overview");
  const [section, setSection] = useState<"details" | "address">("details");
  const [note, setNote] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState(record.values.tag ?? "");
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState<EmailDraft>({ to: record.values.email ?? "", subject: "", body: "" });
  const [actionDialog, setActionDialog] = useState<ActionDialog | null>(null);
  const [actionValue, setActionValue] = useState("");
  const [activeRelated, setActiveRelated] = useState<string | null>(null);
  const [detailsHidden, setDetailsHidden] = useState(false);
  const [notice, setNotice] = useState("");
  const firstName = record.values.firstName ?? "";
  const lastName = record.values.lastName ?? "";
  const fullName = `${firstName} ${lastName}`.trim() || "Untitled Contact";
  const contactNeedles = [record.id, fullName, `${firstName} ${lastName.replace(/\(sample\)/i, "")}`, record.values.accountName ?? ""].map(normalized).filter(Boolean);
  const matchingRecords = relatedModules.flatMap((module) => module.records.filter((candidate) => !candidate.deletedAt && Object.values(candidate.values).some((value) => contactNeedles.some((needle) => normalized(value).includes(needle)))).map((candidate) => ({ ...candidate, module: module.name })));
  const recordsFor = (moduleName: string) => matchingRecords.filter((candidate) => candidate.module === moduleName);
  const countFor = (name: string) => {
    if (name === "Notes") return record.notes?.length ?? 0;
    if (name === "Deals") return recordsFor("Deals").length;
    if (name === "Open Activities" || name === "Closed Activities") return ["Tasks", "Meetings", "Calls"].reduce((total, module) => total + recordsFor(module).length, 0);
    return 0;
  };
  const detailKeys = new Set(["owner", "accountName", "email", "phone", "otherPhone", "mobile", "assistant", "createdBy", "modifiedBy", "leadSource", "firstName", "lastName", "vendorName", "title", "department", "homePhone", "fax", "dateOfBirth", "asstPhone", "emailOptOut", "skypeId", "secondaryEmail", "twitter", "reportingTo"]);
  const addressKeys = new Set(["mailingStreet", "city", "mailingState", "mailingCountry", "mailingZip", "otherStreet", "otherCity", "otherState", "otherCountry", "otherZip"]);
  const displayFields = fields.filter((field) => (section === "details" ? detailKeys.has(field.key) : addressKeys.has(field.key)));
  const fieldValue = (key: string) => record.values[key] || "—";
  const nextActions = ["Register for upcoming CRM Webinars", "Get Apporval from Manager"];

  const appendEvent = (title: string, detail: string): boolean => {
    const at = new Date().toISOString();
    return onUpdate({ ...record, updatedAt: at, timeline: [...(record.timeline ?? []), { id: crypto.randomUUID(), title, detail, at }] });
  };
  const addNote = () => {
    const text = note.trim();
    if (!text) return;
    const at = new Date().toISOString();
    const next = { ...record, notes: [...(record.notes ?? []), { id: crypto.randomUUID(), title: "Note", text, at }], timeline: [...(record.timeline ?? []), { id: crypto.randomUUID(), title: "Note added", detail: text, at }], updatedAt: at };
    if (onUpdate(next)) { setNote(""); setNotice("Note added."); }
  };
  const saveTags = () => {
    if (onUpdate({ ...record, values: { ...record.values, tag: tagDraft.trim() } })) { setTagOpen(false); setNotice("Tags saved locally."); }
  };
  const saveEmail = (kind: "draft" | "send") => {
    const subject = emailDraft.subject.trim() || "No subject";
    if (appendEvent(kind === "send" ? "Email sent" : "Email draft saved", `${subject} · ${emailDraft.to || "No recipient"}`)) { setEmailOpen(false); setNotice(kind === "send" ? "Email queued locally." : "Email draft saved locally."); }
  };
  const openRelatedAction = (relatedList: string, action: string) => {
    if (action === "Compose Email") { setEmailOpen(true); return; }
    if (action === "Mails" || action === "Drafts" || action === "Scheduled" || action === "Column View") { setActiveRelated(relatedList); setNotice(`${action} view opened for ${relatedList}.`); return; }
    if (action === "Task" || action === "Meeting" || action === "Call") { setActionDialog({ title: `New ${action}`, action, relatedList }); setActionValue(""); return; }
    setActionDialog({ title: `${action} · ${relatedList}`, action, relatedList });
    setActionValue("");
  };
  const saveRelatedAction = () => {
    if (!actionDialog) return;
    if (appendEvent(`${actionDialog.action} opened`, `${actionDialog.relatedList}${actionValue.trim() ? ` · ${actionValue.trim()}` : ""}`)) { setActionDialog(null); setNotice(`${actionDialog.action} saved locally.`); }
  };
  const selectRelated = (name: string) => { setActiveRelated(name); setTab("Related Lists"); };

  return <section className="zoho-contact-detail" aria-label="Contact details">
    <div className="zoho-detail-breadcrumb"><button onClick={onClose} type="button">Contacts</button><span>/</span><strong>{fullName}</strong></div>
    <div className="zoho-detail-header">
      <div className="zoho-contact-avatar">{`${firstName.slice(0, 1)}${lastName.slice(0, 1)}`.toUpperCase()}</div>
      <div className="zoho-contact-heading"><span>Contact</span><h1>{fullName}</h1><p>{record.values.accountName || "—"}</p></div>
      <div className="zoho-detail-header-actions"><button className="small-button" onClick={() => setTagOpen(true)} type="button">Add Tags</button><button className="small-button" onClick={() => setEmailOpen(true)} type="button">Send Email</button><button className="small-primary" onClick={onEdit} type="button">Edit</button><button aria-label="More Options" aria-expanded={moreOpen} className="small-button" onClick={() => setMoreOpen((current) => !current)} type="button">•••</button></div>
      {moreOpen ? <div className="zoho-detail-more-menu zoho-detail-more-menu-wide" role="menu">{moreActions.map((action) => <button key={action} onClick={() => { setMoreOpen(false); if (action === "Delete") onDelete(); else { setActionDialog({ title: action, action, relatedList: "Contact" }); setActionValue(""); } }} role="menuitem" type="button">{action}</button>)}</div> : null}
    </div>
    <nav className="zoho-detail-tabs" aria-label="Contact detail tabs"><button className={tab === "Overview" ? "active" : ""} onClick={() => setTab("Overview")} type="button">Overview</button><button className={tab === "Timeline" ? "active" : ""} onClick={() => setTab("Timeline")} type="button">Timeline</button><button className={tab === "Related Lists" ? "active" : ""} onClick={() => setTab("Related Lists")} type="button">Related Lists</button></nav>
    {tab === "Related Lists" ? <div className="zoho-related-lists"><div className="zoho-related-list-heading"><strong>Related List</strong><span>Select a list to see its local actions.</span></div>{relatedListNames.map((name) => <button key={name} onClick={() => selectRelated(name)} type="button"><span>{name}</span><b>{countFor(name)}</b><i>›</i></button>)}<div className="zoho-related-links"><strong>Links</strong><button onClick={() => setActionDialog({ title: "Add Related List", action: "Add Related List", relatedList: "Contact" })} type="button">Add Related List</button><button onClick={() => setActionDialog({ title: "Add Link", action: "Add Link", relatedList: "Links" })} type="button">Add Link</button></div>{activeRelated ? <RelatedListPanel name={activeRelated} records={matchingRecords.filter((candidate) => candidate.module === activeRelated)} actions={relatedActions[activeRelated] ?? []} onAction={openRelatedAction} onOpenRelated={onOpenRelated} /> : null}</div> : tab === "Timeline" ? <div className="zoho-timeline">{(record.timeline ?? []).length === 0 ? <p>No timeline events yet.</p> : [...(record.timeline ?? [])].reverse().map((event) => <div className="zoho-timeline-item" key={event.id}><span /><div><strong>{event.title}</strong><small>{event.at}</small><p>{event.detail}</p></div></div>)}</div> : <>
      <div className="zoho-contact-summary"><div className="zoho-summary-card"><span>Last Update</span><strong>1 day(s) ago</strong></div>{[["Contact Owner", "owner"], ["Email", "email"], ["Phone", "phone"], ["Mobile", "mobile"], ["Department", "department"]].map(([label, key]) => <div className="zoho-summary-card" key={key}><span>{label}</span><strong>{fieldValue(key)}</strong></div>)}<div className="zoho-next-action"><span>Next Action</span>{nextActions.map((action, index) => <button key={action} type="button"><small>OCT {11 + index}</small>{action}</button>)}</div></div>
      {!detailsHidden ? <div className="zoho-detail-grid"><section className="zoho-detail-card"><div className="zoho-detail-card-heading"><strong>{section === "details" ? "Contact Information" : "Address Information"}</strong><div><button className={section === "details" ? "active" : ""} onClick={() => setSection("details")} type="button">Details</button><button className={section === "address" ? "active" : ""} onClick={() => setSection("address")} type="button">Address</button><button onClick={() => setDetailsHidden(true)} type="button">Hide Details</button></div></div><div className="zoho-field-grid">{displayFields.map((field) => <div key={field.key}><span>{field.label}</span><strong>{fieldValue(field.key)}</strong></div>)}</div>{section === "details" ? <><div className="zoho-subsection-heading">Description Information</div><div className="zoho-field-grid"><div><span>Description</span><strong>—</strong></div></div><div className="zoho-subsection-heading">Notes</div><div className="zoho-note-editor"><textarea aria-label="Add a note" placeholder="Add a note" value={note} onChange={(event) => setNote(event.target.value)} /><button className="small-primary" disabled={!note.trim()} onClick={addNote} type="button">Add Note</button></div></> : null}</section><aside className="zoho-related-card"><div className="zoho-detail-card-heading"><strong>Related Lists</strong><button onClick={() => setTab("Related Lists")} type="button">View All</button></div>{relatedListNames.slice(0, 9).map((name) => <button className="zoho-related-row" key={name} onClick={() => selectRelated(name)} type="button"><span>{name}</span><b>{countFor(name)}</b><i>›</i></button>)}{matchingRecords.slice(0, 8).map((candidate) => <button className="zoho-related-row" key={`${candidate.module}:${candidate.id}`} onClick={() => onOpenRelated(candidate.module, candidate.id)} type="button"><span>{candidate.module}: {Object.values(candidate.values)[0] || "Record"}</span><i>›</i></button>)}<div className="zoho-related-footer"><button onClick={() => setActionDialog({ title: "Add Related List", action: "Add Related List", relatedList: "Contact" })} type="button">Add Related List</button><button onClick={() => setActionDialog({ title: "Add Link", action: "Add Link", relatedList: "Links" })} type="button">Add Link</button></div></aside></div> : <button className="zoho-show-details" onClick={() => setDetailsHidden(false)} type="button">Show Details</button>}
    </>}
    {tagOpen ? <div className="zoho-action-backdrop"><div className="zoho-action-dialog" role="dialog" aria-modal="true"><h2>Add Tags</h2><p>Assign local tags to this Contact.</p><input aria-label="Contact tags" onChange={(event) => setTagDraft(event.target.value)} placeholder="Tags, separated by commas" value={tagDraft} /><div><button className="small-button" onClick={() => setTagOpen(false)} type="button">Cancel</button><button className="small-primary" onClick={saveTags} type="button">Save</button></div></div></div> : null}
    {emailOpen ? <div className="zoho-action-backdrop"><div className="zoho-action-dialog zoho-email-dialog" role="dialog" aria-modal="true"><h2>New Message</h2><p>{record.values.owner || "Local CRM"}</p><input aria-label="To" onChange={(event) => setEmailDraft((current) => ({ ...current, to: event.target.value }))} placeholder="To" value={emailDraft.to} /><input aria-label="Subject" onChange={(event) => setEmailDraft((current) => ({ ...current, subject: event.target.value }))} placeholder="Subject" value={emailDraft.subject} /><textarea aria-label="Message" onChange={(event) => setEmailDraft((current) => ({ ...current, body: event.target.value }))} placeholder="Write a message" value={emailDraft.body} /><div><button className="small-button" onClick={() => setEmailOpen(false)} type="button">Cancel</button><button className="small-button" onClick={() => saveEmail("draft")} type="button">Save Draft</button><button className="small-primary" onClick={() => saveEmail("send")} type="button">Send</button></div></div></div> : null}
    {actionDialog ? <div className="zoho-action-backdrop"><div className="zoho-action-dialog" role="dialog" aria-modal="true"><h2>{actionDialog.title}</h2><p>{actionDialog.action} is available as a local CRM action.</p><input aria-label="Action name" onChange={(event) => setActionValue(event.target.value)} placeholder="Name or value" value={actionValue} /><textarea aria-label="Action details" placeholder="Details" /><div><button className="small-button" onClick={() => setActionDialog(null)} type="button">Cancel</button><button className="small-primary" onClick={saveRelatedAction} type="button">Save</button></div></div></div> : null}
    {notice ? <div className="zoho-inline-notice" role="status">{notice}<button aria-label="Dismiss notice" onClick={() => setNotice("")} type="button">×</button></div> : null}
  </section>;
}

function RelatedListPanel({ name, records, actions, onAction, onOpenRelated }: { name: string; records: Array<ModuleRecord & { module: string }>; actions: string[]; onAction: (name: string, action: string) => void; onOpenRelated: (module: string, id: string) => void }) {
  return <div className="zoho-related-detail"><div className="zoho-related-detail-heading"><strong>{name}</strong><span>{records.length ? `${records.length} local record(s)` : "No records found"}</span></div><div className="zoho-related-action-row">{actions.map((action) => <button key={action} onClick={() => onAction(name, action)} type="button">{action}</button>)}</div>{records.map((record) => <button className="zoho-related-record" key={`${record.module}:${record.id}`} onClick={() => onOpenRelated(record.module, record.id)} type="button"><strong>{Object.values(record.values)[0] || "Record"}</strong><span>{record.module}</span></button>)}</div>;
}
