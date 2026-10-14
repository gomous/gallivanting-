import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { initialLeads, initialTasks } from "../data";
import {
  assertValidState,
  cloneState,
  convertLead as convertLeadPure,
  parseBackup,
  serializeBackup,
  validateValues,
} from "./engine";
import type {
  CrmRecord,
  CrmState,
  CrmNote,
  DashboardDefinition,
  LineItem,
  ModuleKey,
  RecordLink,
  ReportDefinition,
  SavedView,
  TimelineEntry,
  Values,
} from "./model";
import { moduleDefs, moduleKeys, recordTitle, requiredFields } from "./schema";
import {
  backendStorageMode,
  readLocalBackendWorkspace,
  readLocalBackendWorkspaceAsync,
  recordLocalBackendAudit,
  subscribeLocalBackendErrors,
  writeLocalBackendWorkspace,
} from "../backend";

export const CRM_STORAGE_KEY = "gallivanting.crm.v2";

type LegacyObject = Record<string, unknown>;

type LoadResult = {
  state: CrmState;
  error: string | null;
  persistInitial: boolean;
  desktopReadPending: boolean;
};

type StateUpdater = (state: CrmState) => CrmState;

export type CrmContextValue = {
  state: CrmState;
  storageError: string | null;
  saveRecord: (module: ModuleKey, values: Values, id?: string, extras?: Partial<CrmRecord>) => string;
  patchRecord: (id: string, patch: Partial<CrmRecord>) => void;
  deleteRecords: (ids: string[]) => void;
  restoreRecord: (id: string) => void;
  addNote: (id: string, text: string) => void;
  convertLead: (id: string, options: { createDeal: boolean; dealName?: string; amount?: string; closingDate?: string }) => { contactId: string; accountId?: string; dealId?: string };
  saveView: (view: SavedView) => void;
  deleteView: (id: string) => void;
  setSetting: (key: string, value: string) => void;
  saveReport: (report: ReportDefinition) => void;
  deleteReport: (id: string) => void;
  saveDashboard: (dashboard: DashboardDefinition) => void;
  importWorkspace: (text: string) => void;
  exportWorkspace: () => string;
};

const CrmContext = createContext<CrmContextValue | undefined>(undefined);

function isObject(value: unknown): value is LegacyObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isStringRecord(value: unknown): value is Values {
  return isObject(value) && Object.keys(value).every((key) => key !== "__proto__" && typeof value[key] === "string");
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function now(): string {
  return new Date().toISOString();
}

function today(timestamp: string): string {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function idToken(): string {
  const cryptoObject = globalThis.crypto as Crypto & { randomUUID?: () => string } | undefined;
  if (cryptoObject?.randomUUID) return cryptoObject.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function nextId(prefix: string, used: Set<string>): string {
  let candidate = `${prefix.toLowerCase().replace(/\s+/g, "-")}-${idToken()}`;
  while (used.has(candidate)) candidate = `${prefix.toLowerCase().replace(/\s+/g, "-")}-${idToken()}`;
  return candidate;
}

function timestampFromLegacy(value: unknown, fallback: string): string {
  const candidate = text(value);
  const parsed = new Date(candidate);
  return candidate && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : fallback;
}

function lineItemDefaults(): LineItem[] {
  return [];
}

function recordWithMetadata(module: ModuleKey, id: string, values: Values, at: string, tags: string[] = [], timeline: TimelineEntry[] = []): CrmRecord {
  return { id, module, values: { ...values }, createdAt: at, updatedAt: at, tags: [...tags], notes: [], timeline: [...timeline], links: [], lineItems: lineItemDefaults() };
}

function timelineEntry(title: string, detail: string, at: string, prefix = "timeline"): TimelineEntry {
  return { id: `${prefix}-${idToken()}`, title, detail, at };
}

function noteFromLegacy(textValue: string, at: string, index: number): CrmNote {
  return { id: `note-legacy-${index}-${idToken()}`, text: textValue, createdAt: at };
}

function legacyValuesFromObject(value: unknown): Values | null {
  if (!isObject(value)) return null;
  const values: Values = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "id" || key === "createdAt" || key === "lastActivity" || key === "notes" || key === "tags") continue;
    if (typeof item === "string") values[key] = item;
    else if (typeof item === "number" || typeof item === "boolean") values[key] = String(item);
  }
  return values;
}

function primaryFieldsSatisfied(module: ModuleKey, values: Values): boolean {
  return requiredFields(module).every((definition) => Boolean(values[definition.key]?.trim()));
}

function uniqueRecordId(candidate: string, module: ModuleKey, used: Set<string>): string {
  const trimmed = candidate.trim();
  if (trimmed && !used.has(trimmed)) {
    used.add(trimmed);
    return trimmed;
  }
  return nextId(module, used);
}

function legacyLeadRecord(value: unknown, at: string, used: Set<string>): CrmRecord | null {
  const values = legacyValuesFromObject(value);
  if (!values || !primaryFieldsSatisfied("Leads", values)) return null;
  const source = isObject(value) ? value : {};
  const id = uniqueRecordId(text(source.id), "Leads", used);
  const createdAt = timestampFromLegacy(source.createdAt, at);
  const record = recordWithMetadata("Leads", id, values, createdAt, Array.isArray(source.tags) ? source.tags.filter((tag): tag is string => typeof tag === "string") : []);
  const legacyNotes = Array.isArray(source.notes) ? source.notes.filter((note): note is string => typeof note === "string" && note.trim() !== "") : [];
  record.notes = legacyNotes.map((note, index) => noteFromLegacy(note, createdAt, index));
  if (text(source.createdAt) && text(source.createdAt) !== createdAt) record.values.legacyCreatedAt = text(source.createdAt);
  if (text(source.lastActivity)) record.values.legacyLastActivity = text(source.lastActivity);
  if (legacyNotes.length > 0 || text(source.lastActivity)) record.timeline.push(timelineEntry("Legacy activity imported", `${legacyNotes.length} note(s) and legacy activity were preserved.`, at, "timeline-legacy"));
  return record;
}

function legacyTaskRecord(value: unknown, at: string, used: Set<string>): CrmRecord | null {
  if (!isObject(value)) return null;
  const sourceValues = legacyValuesFromObject(value);
  if (!sourceValues) return null;
  const values: Values = { ...sourceValues };
  if (text(sourceValues.contact)) values.contactName = sourceValues.contact;
  if (text(sourceValues.relatedTo)) values.relatedTo = sourceValues.relatedTo;
  delete values.contact;
  if (!primaryFieldsSatisfied("Tasks", values)) return null;
  const id = uniqueRecordId(text(value.id), "Tasks", used);
  const record = recordWithMetadata("Tasks", id, values, at);
  if (values.description) record.notes.push(noteFromLegacy(values.description, at, 0));
  return record;
}

function legacyModuleRecord(module: ModuleKey, value: unknown, at: string, used: Set<string>): CrmRecord | null {
  if (!isObject(value) || !isStringRecord(value.values)) return null;
  const values = { ...value.values };
  if (!primaryFieldsSatisfied(module, values)) return null;
  const id = uniqueRecordId(text(value.id), module, used);
  const createdAt = timestampFromLegacy(value.createdAt, at);
  const record = recordWithMetadata(module, id, values, createdAt, Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === "string") : []);
  if (Array.isArray(value.notes)) record.notes = value.notes.filter((note): note is string => typeof note === "string" && note.trim() !== "").map((note, index) => noteFromLegacy(note, createdAt, index));
  record.timeline.push(timelineEntry("Legacy record imported", "Imported from the module workspace while preserving the original module key.", at, "timeline-legacy"));
  return record;
}

function readJson(storage: Storage, key: string, errors: string[]): { present: boolean; value?: unknown } {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { present: false };
    try {
      return { present: true, value: JSON.parse(raw) as unknown };
    } catch {
      errors.push(`Could not parse legacy storage key ${key}; invalid entries were ignored.`);
      return { present: true };
    }
  } catch (error: unknown) {
    errors.push(`Could not read local storage key ${key}: ${error instanceof Error ? error.message : String(error)}`);
    return { present: false };
  }
}

function readLegacyArray(storage: Storage | null, key: string, errors: string[]): { present: boolean; items: unknown[] } {
  if (!storage) return { present: false, items: [] };
  const result = readJson(storage, key, errors);
  if (!result.present) return { present: false, items: [] };
  if (!Array.isArray(result.value)) {
    errors.push(`Legacy storage key ${key} was not an array; it was ignored.`);
    return { present: true, items: [] };
  }
  return { present: true, items: result.value };
}

function resolveDisplayKey(key: string): string | undefined {
  return {
    accountId: "accountName",
    contactId: "contactName",
    vendorId: "vendorName",
    dealId: "dealName",
    quoteId: "quoteName",
    salesOrderId: "subject",
    productId: "product",
    campaignId: "campaignName",
  }[key];
}

function findRecordByDisplay(records: CrmRecord[], module: ModuleKey, value: string): CrmRecord | undefined {
  const normalized = value.trim().toLocaleLowerCase();
  if (!normalized) return undefined;
  return records.find((record) => record.module === module && (record.id.toLocaleLowerCase() === normalized || recordTitle(record).toLocaleLowerCase() === normalized || Object.values(record.values).some((candidate) => candidate.toLocaleLowerCase() === normalized)));
}

function addRecordLink(record: CrmRecord, module: ModuleKey, id: string): void {
  if (!record.links.some((link) => link.module === module && link.id === id)) record.links.push({ module, id });
}

function hydrateReferences(records: CrmRecord[]): void {
  for (const record of records) {
    for (const definition of moduleDefs[record.module].fields) {
      if (!definition.lookup) continue;
      const raw = record.values[definition.key];
      const displayKey = resolveDisplayKey(definition.key);
      const display = displayKey ? record.values[displayKey] : undefined;
      const target = (raw && records.find((candidate) => candidate.module === definition.lookup && candidate.id === raw)) || (display ? findRecordByDisplay(records, definition.lookup, display) : undefined);
      if (target) {
        record.values[definition.key] = target.id;
        addRecordLink(record, target.module, target.id);
      } else if (raw) {
        delete record.values[definition.key];
      }
    }

    const relatedValue = record.values.relatedId || record.values.relatedTo;
    if (relatedValue) {
      const requestedModule = moduleKeys.includes(record.values.relatedModule as ModuleKey) ? record.values.relatedModule as ModuleKey : undefined;
      const related = (record.values.relatedId && records.find((candidate) => candidate.id === record.values.relatedId && (!requestedModule || candidate.module === requestedModule))) ||
        (requestedModule ? findRecordByDisplay(records, requestedModule, relatedValue) : records.find((candidate) => moduleDefs[record.module].related.includes(candidate.module) && (candidate.id === relatedValue || recordTitle(candidate).toLocaleLowerCase() === relatedValue.toLocaleLowerCase())));
      if (related) {
        record.values.relatedId = related.id;
        if (["Leads", "Contacts", "Accounts", "Deals", "Campaigns"].includes(related.module)) record.values.relatedModule = related.module;
        else delete record.values.relatedModule;
        addRecordLink(record, related.module, related.id);
      } else {
        delete record.values.relatedId;
        delete record.values.relatedModule;
      }
    }
    record.links = record.links.filter((link, index, links) => moduleKeys.includes(link.module) && Boolean(link.id) && links.findIndex((candidate) => candidate.module === link.module && candidate.id === link.id) === index && records.some((candidate) => candidate.module === link.module && candidate.id === link.id));
    for (const item of record.lineItems) if (item.productId && records.some((candidate) => candidate.module === "Products" && candidate.id === item.productId)) addRecordLink(record, "Products", item.productId);
  }

  for (const record of records) {
    for (const link of [...record.links]) {
      const target = records.find((candidate) => candidate.module === link.module && candidate.id === link.id);
      if (target && target.id !== record.id) addRecordLink(target, record.module, record.id);
    }
  }
}

function createSeedRecord(module: ModuleKey, id: string, values: Values, at: string, used: Set<string>): CrmRecord {
  const uniqueId = uniqueRecordId(id, module, used);
  return recordWithMetadata(module, uniqueId, { ...values, seedRecord: "true" }, at, ["Seed"], [timelineEntry("Local seed record", "Coherent example created for the local CRM workspace.", at, "timeline-seed")]);
}

function addFallbackRecords(records: CrmRecord[], leads: CrmRecord[], at: string, used: Set<string>, moduleRecords: Map<ModuleKey, CrmRecord[]>): void {
  const accounts = records.filter((record) => record.module === "Accounts");
  const contacts = records.filter((record) => record.module === "Contacts");
  for (const lead of leads) {
    const company = lead.values.company?.trim();
    if (!company) continue;
    let account = accounts.find((candidate) => candidate.values.accountName?.trim().toLocaleLowerCase() === company.toLocaleLowerCase());
    if (!account) {
      account = recordWithMetadata("Accounts", uniqueRecordId("account-local", "Accounts", used), {
        accountName: company,
        phone: lead.values.phone ?? "",
        website: lead.values.website ?? "",
        industry: lead.values.industry ?? "",
        owner: lead.values.owner ?? "You",
        billingCity: lead.values.city ?? "",
        billingCountry: lead.values.country ?? "",
      }, at, ["Imported local"]);
      accounts.push(account);
      records.push(account);
    }
    let contact = contacts.find((candidate) => {
      const sameName = candidate.values.firstName?.toLocaleLowerCase() === (lead.values.firstName ?? "").toLocaleLowerCase() && candidate.values.lastName?.toLocaleLowerCase() === lead.values.lastName?.toLocaleLowerCase();
      const sameEmail = lead.values.email && candidate.values.email?.toLocaleLowerCase() === lead.values.email.toLocaleLowerCase();
      return Boolean(sameName || sameEmail);
    });
    if (!contact) {
      contact = recordWithMetadata("Contacts", uniqueRecordId("contact-local", "Contacts", used), {
        firstName: lead.values.firstName ?? "",
        lastName: lead.values.lastName,
        accountId: account.id,
        accountName: account.values.accountName,
        email: lead.values.email ?? "",
        phone: lead.values.phone ?? "",
        title: lead.values.title ?? "",
        leadSource: lead.values.source ?? "",
        owner: lead.values.owner ?? "You",
        mailingCity: lead.values.city ?? "",
        mailingCountry: lead.values.country ?? "",
      }, at, ["Imported local"]);
      contacts.push(contact);
      records.push(contact);
    }
  }

  const account = records.find((record) => record.module === "Accounts");
  const contact = records.find((record) => record.module === "Contacts");
  if (account && contact && !moduleRecords.has("Deals") && leads.some((lead) => Number(lead.values.dealCount ?? "0") > 0)) {
    records.push(createSeedRecord("Deals", "deal-seed-local", { dealName: `${account.values.accountName} follow-up opportunity`, accountId: account.id, contactId: contact.id, stage: "Qualification", probability: "10", closingDate: today(at), type: "New Business", owner: "You" }, at, used));
  }
  if (account && contact && !moduleRecords.has("Meetings")) records.push(createSeedRecord("Meetings", "meeting-seed-local", { title: "Lead discovery conversation", from: at, to: new Date(new Date(at).getTime() + 3600000).toISOString(), contactId: contact.id, relatedId: account.id, relatedModule: "Accounts", host: "You", allDay: "No" }, at, used));
  if (account && contact && !moduleRecords.has("Calls")) records.push(createSeedRecord("Calls", "call-seed-local", { subject: "Follow up with local lead", callType: "Outbound", callStart: at, callDuration: "15", purpose: "Prospecting", result: "Pending", contactId: contact.id, relatedId: account.id, relatedModule: "Accounts", owner: "You" }, at, used));

  if (account && !moduleRecords.has("Quotes")) records.push(createSeedRecord("Quotes", "quote-seed-local", { quoteName: "Workspace onboarding proposal", subject: "Local CRM workspace setup", accountId: account.id, accountName: account.values.accountName, stage: "Draft", validUntil: today(new Date(new Date(at).getTime() + 30 * 86400000).toISOString()), owner: "You" }, at, used));
  if (account && !moduleRecords.has("Sales Orders")) records.push(createSeedRecord("Sales Orders", "sales-order-seed-local", { subject: "CRM workspace setup order", accountId: account.id, accountName: account.values.accountName, status: "Created", dueDate: today(new Date(new Date(at).getTime() + 30 * 86400000).toISOString()), owner: "You" }, at, used));
  if (account && !moduleRecords.has("Vendors")) records.push(createSeedRecord("Vendors", "vendor-seed-local", { vendorName: "Local delivery partner", category: "Services", owner: "You" }, at, used));
  const vendor = records.find((record) => record.module === "Vendors");
  if (vendor && !moduleRecords.has("Purchase Orders")) records.push(createSeedRecord("Purchase Orders", "purchase-order-seed-local", { subject: "Local delivery support", vendorId: vendor.id, vendorName: vendor.values.vendorName, status: "Created", dueDate: today(new Date(new Date(at).getTime() + 21 * 86400000).toISOString()), owner: "You" }, at, used));
  if (account && !moduleRecords.has("Invoices")) records.push(createSeedRecord("Invoices", "invoice-seed-local", { subject: "Local CRM workspace invoice", accountId: account.id, accountName: account.values.accountName, invoiceDate: today(at), dueDate: today(new Date(new Date(at).getTime() + 30 * 86400000).toISOString()), status: "Draft", owner: "You" }, at, used));
  if (account && contact && !moduleRecords.has("Cases")) records.push(createSeedRecord("Cases", "case-seed-local", { subject: "Workspace routing question", accountId: account.id, contactId: contact.id, status: "Open", priority: "Normal", origin: "Web", owner: "You" }, at, used));
  if (!moduleRecords.has("Solutions")) records.push(createSeedRecord("Solutions", "solution-seed-local", { solutionTitle: "Keep the next CRM action visible", question: "How should follow-ups stay connected to records?", status: "Published", owner: "You", answer: "Use the related record, timeline, and task fields together." }, at, used));
}

function buildMigratedState(storage: Storage | null, at: string): { state: CrmState; warnings: string[] } {
  const warnings: string[] = [];
  const used = new Set<string>();
  const records: CrmRecord[] = [];
  const leadSource = readLegacyArray(storage, "gallivanting.leads.v1", warnings);
  const leadItems = leadSource.present ? leadSource.items : (initialLeads as unknown[]);
  const leads = leadItems.map((item) => legacyLeadRecord(item, at, used)).filter((record): record is CrmRecord => Boolean(record));
  records.push(...leads);
  const taskSource = readLegacyArray(storage, "gallivanting.tasks.v1", warnings);
  const taskItems = taskSource.present ? taskSource.items : (initialTasks as unknown[]);
  const tasks = taskItems.map((item) => legacyTaskRecord(item, at, used)).filter((record): record is CrmRecord => Boolean(record));
  records.push(...tasks);

  const moduleRecords = new Map<ModuleKey, CrmRecord[]>();
  for (const module of moduleKeys) {
    if (module === "Leads" || module === "Tasks") continue;
    const source = readLegacyArray(storage, `gallivanting.module.${module}`, warnings);
    if (!source.present) continue;
    const valid = source.items.map((item) => legacyModuleRecord(module, item, at, used)).filter((record): record is CrmRecord => Boolean(record));
    moduleRecords.set(module, valid);
    records.push(...valid);
  }

  addFallbackRecords(records, leads, at, used, moduleRecords);
  hydrateReferences(records);
  const state: CrmState = { version: 2, records, views: [], settings: {}, reports: [], dashboards: [] };
  assertValidState(state);
  return { state, warnings };
}

function seedFallbackState(at: string): CrmState {
  const built = buildMigratedState(null, at);
  return built.state;
}

function loadInitialState(): LoadResult {
  const at = now();
  const desktopReadPending = backendStorageMode() === "electron-local-file";
  if (typeof window === "undefined") return { state: seedFallbackState(at), error: null, persistInitial: false, desktopReadPending: false };
  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch (error: unknown) {
    return { state: seedFallbackState(at), error: `Local storage is unavailable: ${error instanceof Error ? error.message : String(error)}`, persistInitial: false, desktopReadPending };
  }
  let backendReadError: string | null = null;
  let backendCurrent: string | null = null;
  try {
    backendCurrent = readLocalBackendWorkspace();
  } catch (error: unknown) {
    backendReadError = `Stored local backend state could not be loaded: ${errorText(error)}`;
  }
  try {
    const legacyCurrent = storage.getItem(CRM_STORAGE_KEY);
    if (backendCurrent !== null) {
      try {
        return {
          state: parseBackup(backendCurrent),
          error: backendReadError,
          persistInitial: false,
          desktopReadPending,
        };
      } catch (error: unknown) {
        if (legacyCurrent !== null) {
          try {
            return {
              state: parseBackup(legacyCurrent),
              error: `Stored local backend workspace could not be loaded: ${errorText(error)}`,
              persistInitial: false,
              desktopReadPending,
            };
          } catch {
            // Report the backend error below when neither copy is usable.
          }
        }
        return {
          state: seedFallbackState(at),
          error: `${backendReadError ? `${backendReadError} ` : ""}Stored CRM workspace could not be loaded: ${errorText(error)}`,
          persistInitial: false,
          desktopReadPending,
        };
      }
    }
    if (legacyCurrent !== null) {
      return {
        state: parseBackup(legacyCurrent),
        error: backendReadError,
        persistInitial: false,
        desktopReadPending,
      };
    }
  } catch (error: unknown) {
    return { state: seedFallbackState(at), error: `Stored CRM workspace could not be loaded: ${errorText(error)}`, persistInitial: false, desktopReadPending };
  }
  try {
    const migrated = buildMigratedState(storage, at);
    const warning = migrated.warnings.length > 0 ? migrated.warnings.join(" ") : null;
    return {
      state: migrated.state,
      error: [backendReadError, warning].filter(Boolean).join(" ") || null,
      persistInitial: !desktopReadPending && backendReadError === null,
      desktopReadPending,
    };
  } catch (error: unknown) {
    return { state: seedFallbackState(at), error: `CRM migration failed: ${error instanceof Error ? error.message : String(error)}`, persistInitial: false, desktopReadPending };
  }
}

function persistState(state: CrmState): void {
  if (typeof window === "undefined") return;
  const serialized = serializeBackup(state);
  // The backend envelope is the single browser write. CRM_STORAGE_KEY remains a
  // read-only compatibility source for existing workspaces and migrations.
  writeLocalBackendWorkspace(serialized);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function appendTimeline(record: CrmRecord, title: string, detail: string, at: string): void {
  record.timeline.push(timelineEntry(title, detail, at));
  record.updatedAt = at;
}

function completeReferences(record: CrmRecord, records: CrmRecord[]): void {
  for (const definition of moduleDefs[record.module].fields) {
    if (!definition.lookup) continue;
    const targetId = record.values[definition.key];
    if (!targetId) continue;
    const target = records.find((candidate) => candidate.module === definition.lookup && candidate.id === targetId);
    if (!target) throw new Error(`${definition.label} references a record that does not exist.`);
    addRecordLink(record, target.module, target.id);
  }
  const relatedId = record.values.relatedId;
  if (relatedId) {
    const relatedModule = record.values.relatedModule as ModuleKey | undefined;
    const target = records.find((candidate) => candidate.id === relatedId && (!relatedModule || candidate.module === relatedModule));
    if (!target) throw new Error("Related To references a record that does not exist.");
    addRecordLink(record, target.module, target.id);
  }
  for (const item of record.lineItems) if (item.productId) {
    const product = records.find((candidate) => candidate.module === "Products" && candidate.id === item.productId);
    if (!product) throw new Error(`Line item ${item.id} references a product that does not exist.`);
    addRecordLink(record, "Products", item.productId);
  }
}

function assertPatchIdentity(existing: CrmRecord, patch: Partial<CrmRecord>): void {
  if (patch.id !== undefined && patch.id !== existing.id) throw new Error("A record id cannot be changed.");
  if (patch.module !== undefined && patch.module !== existing.module) throw new Error("A record module cannot be changed.");
}

export function CrmProvider({ children }: { children: ReactNode }): ReactElement {
  const initial = useState<LoadResult>(() => loadInitialState())[0];
  const [state, setState] = useState<CrmState>(initial.state);
  const [storageError, setStorageError] = useState<string | null>(initial.error);
  const currentRef = useRef<CrmState>(initial.state);
  const hydratedRef = useRef(!initial.desktopReadPending);

  useEffect(() => {
    return subscribeLocalBackendErrors((issue) => {
      setStorageError(`Could not complete local backend ${issue.operation}: ${issue.error.message}`);
    });
  }, []);

  useEffect(() => {
    let active = true;
    if (!initial.desktopReadPending) {
      if (initial.persistInitial) {
        try {
          persistState(initial.state);
        } catch (error: unknown) {
          setStorageError(`Could not save the migrated CRM workspace: ${errorText(error)}`);
        }
      }
      return () => {
        active = false;
      };
    }

    hydratedRef.current = false;
    void readLocalBackendWorkspaceAsync().then((workspace) => {
      if (!active) return;
      if (workspace === null) {
        try {
          // A missing file is the only Electron startup case that is safe to
          // initialize from the browser cache or legacy migration state.
          persistState(initial.state);
          currentRef.current = initial.state;
          hydratedRef.current = true;
        } catch (error: unknown) {
          setStorageError(`Could not initialize the local backend workspace: ${errorText(error)}`);
        }
        return;
      }

      try {
        const loaded = parseBackup(workspace);
        currentRef.current = loaded;
        setState(loaded);
        setStorageError(null);
        hydratedRef.current = true;
      } catch (error: unknown) {
        // Never replace an unreadable desktop file with the browser fallback.
        setStorageError(`Stored CRM workspace could not be loaded: ${errorText(error)}`);
      }
    }).catch((error: unknown) => {
      if (active) setStorageError(`Stored CRM workspace could not be loaded: ${errorText(error)}`);
    });

    return () => {
      active = false;
    };
  }, [initial]);

  const commit = useCallback((update: StateUpdater): void => {
    if (!hydratedRef.current) {
      const error = new Error("The local CRM workspace is still being verified and cannot be changed yet.");
      setStorageError(error.message);
      throw error;
    }
    const draft = cloneState(currentRef.current);
    let next: CrmState;
    try {
      next = update(draft);
      assertValidState(next);
      persistState(next);
    } catch (error: unknown) {
      setStorageError(errorText(error));
      throw error instanceof Error ? error : new Error(String(error));
    }
    currentRef.current = next;
    setState(next);
    setStorageError(null);
    recordLocalBackendAudit("workspace", "state.commit");
  }, []);

  const saveRecord = useCallback<CrmContextValue["saveRecord"]>((module, values, id, extras) => {
    if (!moduleKeys.includes(module)) throw new Error(`Unknown CRM module: ${module}.`);
    const inputValues = { ...values };
    const initialErrors = validateValues(module, inputValues);
    const existing = id ? currentRef.current.records.find((record) => record.id === id) : undefined;
    if (existing) {
      const merged = { ...existing.values, ...inputValues };
      const errors = validateValues(module, merged);
      if (errors.length > 0) throw new Error(errors.join(" "));
    } else if (initialErrors.length > 0) {
      throw new Error(initialErrors.join(" "));
    }
    if (extras?.id !== undefined && extras.id !== id) throw new Error("The extra record id does not match the requested id.");
    if (extras?.module !== undefined && extras.module !== module) throw new Error("The extra record module does not match the requested module.");
    const recordId = id ?? nextId(module, new Set(currentRef.current.records.map((record) => record.id)));
    const at = now();
    commit((draft) => {
      const index = draft.records.findIndex((record) => record.id === recordId);
      if (index >= 0 && draft.records[index].module !== module) throw new Error("The record id belongs to another module.");
      if (index < 0) {
        const record = recordWithMetadata(module, recordId, inputValues, typeof extras?.createdAt === "string" ? extras.createdAt : at, Array.isArray(extras?.tags) ? [...extras.tags] : [], Array.isArray(extras?.timeline) ? extras.timeline.map((entry) => ({ ...entry })) : []);
        if (Array.isArray(extras?.notes)) record.notes = extras.notes.map((note) => ({ ...note }));
        if (Array.isArray(extras?.links)) record.links = extras.links.map((link) => ({ ...link }));
        if (Array.isArray(extras?.lineItems)) record.lineItems = extras.lineItems.map((item) => ({ ...item }));
        if (extras?.deletedAt !== undefined) record.deletedAt = extras.deletedAt;
        if (extras?.convertedTo !== undefined) record.convertedTo = { ...extras.convertedTo };
        completeReferences(record, draft.records);
        draft.records.unshift(record);
      } else {
        const record = draft.records[index];
        const previousStatus = record.values.status;
        record.values = { ...record.values, ...inputValues };
        if (Array.isArray(extras?.tags)) record.tags = [...extras.tags];
        if (Array.isArray(extras?.notes)) record.notes = extras.notes.map((note) => ({ ...note }));
        if (Array.isArray(extras?.timeline)) record.timeline = extras.timeline.map((entry) => ({ ...entry }));
        if (Array.isArray(extras?.links)) record.links = extras.links.map((link) => ({ ...link }));
        if (Array.isArray(extras?.lineItems)) record.lineItems = extras.lineItems.map((item) => ({ ...item }));
        if (Object.prototype.hasOwnProperty.call(extras ?? {}, "deletedAt")) record.deletedAt = extras?.deletedAt;
        if (Object.prototype.hasOwnProperty.call(extras ?? {}, "convertedTo")) record.convertedTo = extras?.convertedTo ? { ...extras.convertedTo } : undefined;
        record.updatedAt = at;
        if (previousStatus !== record.values.status && record.values.status) appendTimeline(record, "Status updated", `${previousStatus || "No status"} → ${record.values.status}.`, at);
        completeReferences(record, draft.records);
      }
      return draft;
    });
    return recordId;
  }, [commit]);

  const patchRecord = useCallback<CrmContextValue["patchRecord"]>((id, patch) => {
    commit((draft) => {
      const record = draft.records.find((candidate) => candidate.id === id);
      if (!record) throw new Error("Record not found.");
      assertPatchIdentity(record, patch);
      const previousStatus = record.values.status;
      if (patch.values !== undefined) {
        if (!isStringRecord(patch.values)) throw new Error("Record values must be strings.");
        record.values = { ...record.values, ...patch.values };
      }
      if (patch.createdAt !== undefined) record.createdAt = patch.createdAt;
      if (patch.updatedAt !== undefined) record.updatedAt = patch.updatedAt;
      if (patch.tags !== undefined) record.tags = [...patch.tags];
      if (patch.notes !== undefined) record.notes = patch.notes.map((note) => ({ ...note }));
      if (patch.timeline !== undefined) record.timeline = patch.timeline.map((entry) => ({ ...entry }));
      if (patch.links !== undefined) record.links = patch.links.map((link) => ({ ...link }));
      if (patch.lineItems !== undefined) record.lineItems = patch.lineItems.map((item) => ({ ...item }));
      if (Object.prototype.hasOwnProperty.call(patch, "deletedAt")) record.deletedAt = patch.deletedAt;
      if (Object.prototype.hasOwnProperty.call(patch, "convertedTo")) record.convertedTo = patch.convertedTo ? { ...patch.convertedTo } : undefined;
      const at = now();
      record.updatedAt = at;
      if (previousStatus !== record.values.status && record.values.status) appendTimeline(record, "Status updated", `${previousStatus || "No status"} → ${record.values.status}.`, at);
      completeReferences(record, draft.records);
      return draft;
    });
  }, [commit]);

  const deleteRecords = useCallback<CrmContextValue["deleteRecords"]>((ids) => {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return;
    commit((draft) => {
      const at = now();
      for (const id of uniqueIds) {
        const record = draft.records.find((candidate) => candidate.id === id);
        if (!record) throw new Error(`Record ${id} was not found.`);
        if (!record.deletedAt) {
          record.deletedAt = at;
          appendTimeline(record, "Moved to recycle bin", "The record was soft-deleted and can be restored.", at);
        }
      }
      return draft;
    });
  }, [commit]);

  const restoreRecord = useCallback<CrmContextValue["restoreRecord"]>((id) => {
    commit((draft) => {
      const record = draft.records.find((candidate) => candidate.id === id);
      if (!record) throw new Error("Record not found.");
      if (record.deletedAt) {
        const at = now();
        delete record.deletedAt;
        appendTimeline(record, "Restored record", "The record was restored from the recycle bin.", at);
      }
      return draft;
    });
  }, [commit]);

  const addNote = useCallback<CrmContextValue["addNote"]>((id, noteText) => {
    const trimmed = noteText.trim();
    if (!trimmed) throw new Error("A note cannot be empty.");
    commit((draft) => {
      const record = draft.records.find((candidate) => candidate.id === id);
      if (!record) throw new Error("Record not found.");
      if (record.deletedAt) throw new Error("A note cannot be added to a deleted record.");
      const at = now();
      record.notes.unshift({ id: `note-${idToken()}`, text: trimmed, createdAt: at });
      appendTimeline(record, "Note added", trimmed, at);
      return draft;
    });
  }, [commit]);

  const convertLead = useCallback<CrmContextValue["convertLead"]>((id, options) => {
    let result: { contactId: string; accountId?: string; dealId?: string } | undefined;
    commit((draft) => {
      const converted = convertLeadPure(draft, id, options, now(), (prefix, used) => nextId(prefix, used));
      result = converted.result;
      return converted.state;
    });
    if (!result) throw new Error("Lead conversion did not return a result.");
    return result;
  }, [commit]);

  const saveView = useCallback<CrmContextValue["saveView"]>((view) => {
    if (!moduleKeys.includes(view.module)) throw new Error("Saved view has an unknown module.");
    if (!view.id.trim() || !view.name.trim()) throw new Error("Saved views need an id and a name.");
    commit((draft) => {
      const next = { ...view, rules: view.rules.map((rule) => ({ ...rule })), columns: [...view.columns] };
      const index = draft.views.findIndex((candidate) => candidate.id === view.id);
      if (index >= 0) draft.views[index] = next;
      else draft.views.push(next);
      return draft;
    });
  }, [commit]);

  const deleteView = useCallback<CrmContextValue["deleteView"]>((id) => {
    commit((draft) => {
      draft.views = draft.views.filter((view) => view.id !== id);
      return draft;
    });
  }, [commit]);

  const setSetting = useCallback<CrmContextValue["setSetting"]>((key, value) => {
    if (!key.trim()) throw new Error("Setting keys cannot be empty.");
    if (typeof value !== "string") throw new Error("Setting values must be strings.");
    commit((draft) => {
      draft.settings[key] = value;
      return draft;
    });
  }, [commit]);

  const saveReport = useCallback<CrmContextValue["saveReport"]>((report) => {
    if (!report.id.trim() || !report.name.trim()) throw new Error("Reports need an id and a name.");
    if (!moduleKeys.includes(report.module)) throw new Error("Report has an unknown module.");
    commit((draft) => {
      const next = { ...report, columns: [...report.columns] };
      const index = draft.reports.findIndex((candidate) => candidate.id === report.id);
      if (index >= 0) draft.reports[index] = next;
      else draft.reports.push(next);
      return draft;
    });
  }, [commit]);

  const deleteReport = useCallback<CrmContextValue["deleteReport"]>((id) => {
    commit((draft) => {
      draft.reports = draft.reports.filter((report) => report.id !== id);
      draft.dashboards = draft.dashboards.map((dashboard) => ({ ...dashboard, reportIds: dashboard.reportIds.filter((reportId) => reportId !== id) }));
      return draft;
    });
  }, [commit]);

  const saveDashboard = useCallback<CrmContextValue["saveDashboard"]>((dashboard) => {
    if (!dashboard.id.trim() || !dashboard.name.trim()) throw new Error("Dashboards need an id and a name.");
    commit((draft) => {
      const reportIds = [...new Set(dashboard.reportIds)];
      for (const reportId of reportIds) if (!draft.reports.some((report) => report.id === reportId)) throw new Error(`Dashboard references unknown report ${reportId}.`);
      const next = { ...dashboard, reportIds };
      const index = draft.dashboards.findIndex((candidate) => candidate.id === dashboard.id);
      if (index >= 0) draft.dashboards[index] = next;
      else draft.dashboards.push(next);
      return draft;
    });
  }, [commit]);

  const importWorkspace = useCallback<CrmContextValue["importWorkspace"]>((input) => {
    let imported: CrmState;
    try {
      imported = parseBackup(input);
    } catch (error: unknown) {
      setStorageError(errorText(error));
      throw error instanceof Error ? error : new Error(String(error));
    }
    // Parsing and full validation finish before this write. If storage rejects the write,
    // currentRef/state remain untouched and the prior backup key is not deliberately replaced.
    commit(() => imported);
  }, [commit]);

  const exportWorkspace = useCallback<CrmContextValue["exportWorkspace"]>(() => serializeBackup(currentRef.current), []);

  const value = useMemo<CrmContextValue>(() => ({ state, storageError, saveRecord, patchRecord, deleteRecords, restoreRecord, addNote, convertLead, saveView, deleteView, setSetting, saveReport, deleteReport, saveDashboard, importWorkspace, exportWorkspace }), [state, storageError, saveRecord, patchRecord, deleteRecords, restoreRecord, addNote, convertLead, saveView, deleteView, setSetting, saveReport, deleteReport, saveDashboard, importWorkspace, exportWorkspace]);

  return <CrmContext.Provider value={value}>{children}</CrmContext.Provider>;
}

export function useCrm(): CrmContextValue {
  const context = useContext(CrmContext);
  if (!context) throw new Error("useCrm must be used inside CrmProvider.");
  return context;
}
