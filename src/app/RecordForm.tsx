import { useState, type FormEvent } from "react";
import type { ModuleKey, Values } from "../crm/model";
import { moduleDefs } from "../crm/schema";
import { api, changes, errorMessage, type Rec } from "./api";
import { useApp } from "./context";
import { FieldInput, formFields, moduleSlug, OwnerSelect } from "./fields";

/** Create (no record) or edit (record given). Generated entirely from the module schema. */
export function RecordForm({ module, record, prefill, onDone }: { module: ModuleKey; record?: Rec; prefill?: Values; onDone?: (r: Rec) => void }) {
  const { ws, navigate, toast, me } = useApp();
  const def = moduleDefs[module];
  const fields = formFields(module);
  const [values, setValues] = useState<Values>(() => {
    if (record) return { ...record.values };
    const init: Values = { ...prefill };
    // Sensible defaults: first stage/status option for the group field.
    if (def.groupField && !init[def.groupField]) {
      const opts = def.stages ?? fields.find((f) => f.key === def.groupField)?.options;
      if (opts?.[0]) init[def.groupField] = opts[0];
    }
    return init;
  });
  const [ownerId, setOwnerId] = useState(record?.ownerId ?? me.user.id);
  const [tags, setTags] = useState((record?.tags ?? []).join(", "));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const sections = [...new Set(fields.map((f) => f.section ?? "Details"))];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
    try {
      let saved: Rec;
      if (record) {
        const patch: Record<string, string | null> = {};
        for (const f of fields) {
          const before = record.values[f.key] ?? "";
          const after = values[f.key] ?? "";
          if (before !== after) patch[f.key] = after === "" ? null : after;
        }
        saved = await api.tool<Rec>(ws.id, "update_record", { id: record.id, values: patch, tags: tagList, ownerId, expectedVersion: record.version });
        toast(`${def.singular} saved`);
      } else {
        const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ""));
        saved = await api.tool<Rec>(ws.id, "create_record", { module, values: clean, tags: tagList, ownerId });
        toast(`${def.singular} created`);
      }
      changes.emit();
      if (onDone) onDone(saved);
      else navigate(`/app/${moduleSlug(module)}/${saved.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="gv-form" onSubmit={submit}>
      {error && <div className="gv-error">{error}</div>}
      {sections.map((s) => (
        <fieldset key={s}>
          {sections.length > 1 && <legend>{s}</legend>}
          <div className="gv-grid">
            {fields.filter((f) => (f.section ?? "Details") === s).map((f) => (
              <label key={f.key} className={`gv-field ${f.type === "textarea" ? "wide" : ""}`} htmlFor={`f-${f.key}`}>
                <span>{f.label}{f.required && <b className="gv-req">*</b>}</span>
                <FieldInput field={f} value={values[f.key] ?? ""} onChange={(v) => setValues((cur) => ({ ...cur, [f.key]: v }))} />
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <fieldset>
        <div className="gv-grid">
          <label className="gv-field"><span>Owner</span><OwnerSelect value={ownerId} onChange={setOwnerId} /></label>
          <label className="gv-field"><span>Tags (comma separated)</span><input className="gv-input" value={tags} onChange={(e) => setTags(e.target.value)} /></label>
        </div>
      </fieldset>
      <div className="gv-actions gv-form-actions">
        <button type="button" className="gv-btn" onClick={() => (record ? onDone?.(record) : window.history.back())}>Cancel</button>
        <button type="submit" className="gv-btn primary" disabled={saving}>{saving ? "Saving…" : record ? "Save changes" : `Create ${def.singular}`}</button>
      </div>
    </form>
  );
}

export function NewRecordPage({ module }: { module: ModuleKey }) {
  const params = new URLSearchParams(window.location.search);
  const prefill: Values = {};
  params.forEach((v, k) => { prefill[k] = v; });
  return (
    <div className="gv-page">
      <div className="gv-page-head"><h1>New {moduleDefs[module].singular}</h1></div>
      <RecordForm module={module} prefill={prefill} />
    </div>
  );
}
