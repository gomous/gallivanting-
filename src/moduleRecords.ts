/** Local module records; these operations do not call the Zoho service. */
export type ModuleNote = { id: string; title: string; text: string; at: string };
export type ModuleEvent = { id: string; title: string; at: string; detail: string };
export type ModuleRecord = {
  id: string;
  values: Record<string, string>;
  notes?: ModuleNote[];
  timeline?: ModuleEvent[];
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string;
};

export const moduleCollectionKey = (module: string) => `gallivanting.backend.collection.module.${module}`;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseModuleRecords(raw: string): ModuleRecord[] {
  const records: unknown = JSON.parse(raw);
  if (!Array.isArray(records)) throw new Error("The saved module must contain a record array.");
  const ids = new Set<string>();
  for (const record of records) {
    if (!object(record) || typeof record.id !== "string" || !record.id || ids.has(record.id) || !object(record.values) || !Object.values(record.values).every((value) => typeof value === "string")) {
      throw new Error("The saved module contains an invalid or duplicate record.");
    }
    ids.add(record.id);
    for (const key of ["createdAt", "updatedAt", "deletedAt"]) {
      if (record[key] !== undefined && (typeof record[key] !== "string" || !Number.isFinite(Date.parse(record[key] as string)))) throw new Error(`Invalid ${key} timestamp.`);
    }
    for (const key of ["notes", "timeline"]) {
      const entries = record[key];
      if (entries === undefined) continue;
      if (!Array.isArray(entries) || entries.some((entry) => !object(entry) || ["id", "title", "at", key === "notes" ? "text" : "detail"].some((field) => typeof entry[field] !== "string"))) {
        throw new Error(`The saved module contains invalid ${key}.`);
      }
    }
  }
  return records as ModuleRecord[];
}

export function loadModuleRecords(storage: Storage, module: string, seed: ModuleRecord[]): ModuleRecord[] {
  const raw = storage.getItem(moduleCollectionKey(module)) ?? storage.getItem(`gallivanting.module.${module}`);
  // Seeds are only used for a genuinely missing collection, never as a migration
  // based on an ID prefix, email address, or failed read.
  return raw === null ? seed : parseModuleRecords(raw);
}

export function persistModuleRecords(storage: Storage, module: string, records: ModuleRecord[]): void {
  const text = JSON.stringify(records);
  parseModuleRecords(text);
  storage.setItem(moduleCollectionKey(module), text);
}

export function recordEvent(record: ModuleRecord, title: string, detail: string, at = new Date().toISOString()): ModuleRecord {
  return { ...record, updatedAt: at, timeline: [...(record.timeline ?? []), { id: crypto.randomUUID(), title, detail, at }] };
}

export function saveModuleRecord(records: ModuleRecord[], values: Record<string, string>, id?: string): { records: ModuleRecord[]; record: ModuleRecord } {
  const existing = id ? records.find((record) => record.id === id && !record.deletedAt) : undefined;
  if (id && !existing) throw new Error("This record no longer exists.");
  const at = new Date().toISOString();
  const changed = Object.keys(values).filter((key) => values[key] !== existing?.values[key]);
  const record = existing
    ? recordEvent({ ...existing, values: { ...existing.values, ...values } }, "Contact updated", changed.join(", ") || "No field changes", at)
    : recordEvent({ id: crypto.randomUUID(), values: { ...values }, createdAt: at }, "Contact created", "Created locally", at);
  return { record, records: existing ? records.map((item) => item.id === record.id ? record : item) : [record, ...records] };
}

export function restoreModuleRecord(records: ModuleRecord[], id: string): { records: ModuleRecord[]; record: ModuleRecord } {
  const existing = records.find((record) => record.id === id && Boolean(record.deletedAt));
  if (!existing) throw new Error("This deleted record no longer exists.");
  const { deletedAt: _deletedAt, ...activeRecord } = existing;
  const record = recordEvent(activeRecord, "Contact restored", "Restored from the recycle bin");
  return { record, records: records.map((item) => item.id === id ? record : item) };
}
