import type {
  CrmRecord,
  CrmState,
  ConvertedLead,
  FilterRule,
  LineItem,
  ModuleKey,
  RecordLink,
  ReportDefinition,
  SavedView,
  TimelineEntry,
  Values,
} from "./model.ts";
import { fieldDefinition, moduleDefs, moduleKeys, requiredFields } from "./schema.ts";

export type LineItemTotals = {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
};

export type LeadConversionOptions = {
  createDeal: boolean;
  dealName?: string;
  amount?: string;
  closingDate?: string;
};

export type LeadConversion = {
  state: CrmState;
  result: ConvertedLead;
};

const supportedOperators = new Set([
  "is",
  "is_not",
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "empty",
  "not_empty",
  "greater_than",
  "less_than",
  "greater_or_equal",
  "less_or_equal",
  "before",
  "after",
]);

const recordKeys = new Set([
  "id",
  "module",
  "values",
  "createdAt",
  "updatedAt",
  "tags",
  "notes",
  "timeline",
  "deletedAt",
  "convertedTo",
  "links",
  "lineItems",
]);

const noteKeys = new Set(["id", "text", "createdAt"]);
const timelineKeys = new Set(["id", "title", "detail", "at"]);
const linkKeys = new Set(["module", "id"]);
const lineItemKeys = new Set(["id", "productId", "description", "quantity", "price", "discount", "tax"]);
const viewKeys = new Set(["id", "name", "module", "rules", "match", "columns"]);
const ruleKeys = new Set(["id", "field", "operator", "value"]);
const reportKeys = new Set(["id", "name", "module", "groupBy", "columns", "folder"]);
const dashboardKeys = new Set(["id", "name", "reportIds"]);
const stateKeys = new Set(["version", "records", "views", "settings", "reports", "dashboards"]);
const unsafeKeys = new Set(["__proto__", "prototype", "constructor"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function containsRecord(records: unknown[], module: ModuleKey, id: string): boolean {
  return records.some((candidate) => isPlainObject(candidate) && candidate.module === module && candidate.id === id);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>, path: string, errors: string[]): void {
  for (const key of Object.keys(value)) {
    if (unsafeKeys.has(key)) errors.push(`${path}.${key}: unsafe property name`);
    else if (!allowed.has(key)) errors.push(`${path}.${key}: unknown property`);
  }
}

function stringValue(value: unknown, path: string, errors: string[], allowEmpty = true): value is string {
  if (typeof value !== "string") {
    errors.push(`${path}: expected a string`);
    return false;
  }
  if (!allowEmpty && value.trim() === "") errors.push(`${path}: must not be empty`);
  return true;
}

function finiteNumber(value: unknown, path: string, errors: string[], minimum = Number.NEGATIVE_INFINITY): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${path}: expected a finite number`);
    return false;
  }
  if (value < minimum) errors.push(`${path}: must be at least ${minimum}`);
  return true;
}

function moduleValue(value: unknown, path: string, errors: string[]): value is ModuleKey {
  if (typeof value !== "string" || !moduleKeys.includes(value as ModuleKey)) {
    errors.push(`${path}: unknown CRM module`);
    return false;
  }
  return true;
}

function validateValuesShape(module: ModuleKey, values: unknown, path: string, errors: string[]): values is Values {
  if (!isPlainObject(values)) {
    errors.push(`${path}: expected an object of string values`);
    return false;
  }
  for (const [key, value] of Object.entries(values)) stringValue(value, `${path}.${key}`, errors);
  if (Object.keys(values).some((key) => unsafeKeys.has(key))) return false;
  errors.push(...validateValues(module, values as Values).map((error) => `${path}: ${error}`));
  return true;
}

function validDateText(value: string): boolean {
  if (!value.trim()) return true;
  if (!Number.isNaN(Date.parse(value))) return true;
  // Legacy UI records used friendly values such as Today and Oct 15.
  return /^(today|tomorrow|yesterday)$/i.test(value.trim()) || /^[A-Za-z]{3,9}\s+\d{1,2}(?:,\s*\d{4})?$/.test(value.trim());
}

function validateFieldValue(module: ModuleKey, key: string, value: string, errors: string[]): void {
  const definition = fieldDefinition(module, key);
  if (!definition || !value.trim()) return;
  if (definition.type === "email" && !/^\S+@\S+\.\S+$/.test(value.trim())) errors.push(`${key} must be a valid email address.`);
  if (definition.type === "url" && /\s/.test(value.trim())) errors.push(`${key} must not contain spaces.`);
  if (definition.type === "number" && (!Number.isFinite(Number(value)) || value.trim() === "")) errors.push(`${key} must be numeric.`);
  if ((definition.type === "date" || definition.type === "datetime-local") && !validDateText(value)) errors.push(`${key} must be a valid date or date-time.`);
  if (definition.type === "checkbox" && !["true", "false", "yes", "no", "1", "0"].includes(value.trim().toLowerCase())) errors.push(`${key} must be a checkbox value.`);
  if (definition.type === "select" && definition.options && !definition.options.includes(value)) errors.push(`${key} must be one of: ${definition.options.join(", ")}.`);
}

export function validateValues(module: ModuleKey, values: Values): string[] {
  const errors: string[] = [];
  if (!moduleKeys.includes(module)) return [`Unknown CRM module: ${String(module)}.`];
  if (!isPlainObject(values)) return ["Values must be a plain object."];
  for (const [key, value] of Object.entries(values)) {
    if (unsafeKeys.has(key)) errors.push(`${key} is not a permitted field name.`);
    if (typeof value !== "string") errors.push(`${key} must be a string.`);
    else validateFieldValue(module, key, value, errors);
  }
  for (const definition of requiredFields(module)) {
    if (!values[definition.key]?.trim()) errors.push(`${definition.label} is required.`);
  }
  return errors;
}

function valueForRule(record: CrmRecord, field: string): string {
  if (field === "id") return record.id;
  if (field === "module") return record.module;
  if (field === "createdAt") return record.createdAt;
  if (field === "updatedAt") return record.updatedAt;
  if (field === "deletedAt") return record.deletedAt ?? "";
  if (field === "title") return record.values[moduleDefs[record.module].titleField] ?? "";
  if (field === "tag" || field === "tags") return record.tags.join(" ");
  return record.values[field] ?? "";
}

function compareRuleValues(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (left.trim() !== "" && right.trim() !== "" && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  const leftDate = Date.parse(left);
  const rightDate = Date.parse(right);
  if (!Number.isNaN(leftDate) && !Number.isNaN(rightDate)) return leftDate - rightDate;
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

export function matchesRule(record: CrmRecord, rule: FilterRule): boolean {
  const operator = rule.operator.trim().toLowerCase();
  const left = valueForRule(record, rule.field);
  const right = rule.value ?? "";
  const normalizedLeft = left.trim().toLocaleLowerCase();
  const normalizedRight = right.trim().toLocaleLowerCase();
  if (operator === "empty") return normalizedLeft === "";
  if (operator === "not_empty") return normalizedLeft !== "";
  if (operator === "is" || operator === "equals") return normalizedLeft === normalizedRight;
  if (operator === "is_not" || operator === "not_equals") return normalizedLeft !== normalizedRight;
  if (operator === "contains") return normalizedLeft.includes(normalizedRight);
  if (operator === "not_contains") return !normalizedLeft.includes(normalizedRight);
  if (operator === "starts_with") return normalizedLeft.startsWith(normalizedRight);
  if (operator === "ends_with") return normalizedLeft.endsWith(normalizedRight);
  const comparison = compareRuleValues(left, right);
  if (operator === "greater_than" || operator === "after") return comparison > 0;
  if (operator === "less_than" || operator === "before") return comparison < 0;
  if (operator === "greater_or_equal") return comparison >= 0;
  if (operator === "less_or_equal") return comparison <= 0;
  return false;
}

export function filterRecords(records: CrmRecord[], rules: FilterRule[], match: "all" | "any"): CrmRecord[] {
  const activeRecords = records.filter((record) => !record.deletedAt);
  if (rules.length === 0) return activeRecords;
  return activeRecords.filter((record) => {
    const results = rules.map((rule) => matchesRule(record, rule));
    return match === "any" ? results.some(Boolean) : results.every(Boolean);
  });
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function totals(lineItems: LineItem[]): LineItemTotals {
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  for (const item of lineItems) {
    if (!Number.isFinite(item.quantity) || item.quantity < 0) throw new Error(`Line item ${item.id} has an invalid quantity.`);
    if (!Number.isFinite(item.price) || item.price < 0) throw new Error(`Line item ${item.id} has an invalid price.`);
    if (!Number.isFinite(item.discount) || item.discount < 0) throw new Error(`Line item ${item.id} has an invalid discount.`);
    if (!Number.isFinite(item.tax) || item.tax < 0) throw new Error(`Line item ${item.id} has an invalid tax.`);
    const gross = item.quantity * item.price;
    const discountAmount = gross * (item.discount / 100);
    const taxable = Math.max(0, gross - discountAmount);
    subtotal += gross;
    discount += discountAmount;
    tax += taxable * (item.tax / 100);
  }
  return { subtotal: money(subtotal), discount: money(discount), tax: money(tax), total: money(subtotal - discount + tax) };
}

function validateFilterRule(rule: unknown, path: string, errors: string[]): rule is FilterRule {
  if (!isPlainObject(rule)) {
    errors.push(`${path}: expected an object`);
    return false;
  }
  hasOnlyKeys(rule, ruleKeys, path, errors);
  for (const key of ruleKeys) stringValue(rule[key], `${path}.${key}`, errors, key !== "value");
  if (typeof rule.operator === "string" && !supportedOperators.has(rule.operator.toLowerCase())) errors.push(`${path}.operator: unsupported operator`);
  return true;
}

function validateRecord(record: unknown, path: string, records: CrmRecord[], errors: string[]): record is CrmRecord {
  if (!isPlainObject(record)) {
    errors.push(`${path}: expected an object`);
    return false;
  }
  hasOnlyKeys(record, recordKeys, path, errors);
  stringValue(record.id, `${path}.id`, errors, false);
  moduleValue(record.module, `${path}.module`, errors);
  stringValue(record.createdAt, `${path}.createdAt`, errors, false);
  stringValue(record.updatedAt, `${path}.updatedAt`, errors, false);
  if (record.deletedAt !== undefined) stringValue(record.deletedAt, `${path}.deletedAt`, errors, false);

  const module = record.module as ModuleKey;
  validateValuesShape(module, record.values, `${path}.values`, errors);
  if (!Array.isArray(record.tags)) errors.push(`${path}.tags: expected an array`);
  else record.tags.forEach((tag, index) => stringValue(tag, `${path}.tags[${index}]`, errors, false));

  if (!Array.isArray(record.notes)) errors.push(`${path}.notes: expected an array`);
  else {
    record.notes.forEach((note, index) => {
      const notePath = `${path}.notes[${index}]`;
      if (!isPlainObject(note)) {
        errors.push(`${notePath}: expected an object`);
        return;
      }
      hasOnlyKeys(note, noteKeys, notePath, errors);
      stringValue(note.id, `${notePath}.id`, errors, false);
      stringValue(note.text, `${notePath}.text`, errors, false);
      stringValue(note.createdAt, `${notePath}.createdAt`, errors, false);
    });
  }

  if (!Array.isArray(record.timeline)) errors.push(`${path}.timeline: expected an array`);
  else {
    record.timeline.forEach((entry, index) => {
      const entryPath = `${path}.timeline[${index}]`;
      if (!isPlainObject(entry)) {
        errors.push(`${entryPath}: expected an object`);
        return;
      }
      hasOnlyKeys(entry, timelineKeys, entryPath, errors);
      stringValue(entry.id, `${entryPath}.id`, errors, false);
      stringValue(entry.title, `${entryPath}.title`, errors, false);
      stringValue(entry.detail, `${entryPath}.detail`, errors);
      stringValue(entry.at, `${entryPath}.at`, errors, false);
    });
  }

  if (!Array.isArray(record.links)) errors.push(`${path}.links: expected an array`);
  else {
    record.links.forEach((link, index) => {
      const linkPath = `${path}.links[${index}]`;
      if (!isPlainObject(link)) {
        errors.push(`${linkPath}: expected an object`);
        return;
      }
      hasOnlyKeys(link, linkKeys, linkPath, errors);
      const linkModule = link.module as ModuleKey;
      moduleValue(link.module, `${linkPath}.module`, errors);
      stringValue(link.id, `${linkPath}.id`, errors, false);
      if (moduleKeys.includes(linkModule) && typeof link.id === "string" && !containsRecord(records, linkModule, link.id)) {
        errors.push(`${linkPath}: referenced record does not exist`);
      }
    });
  }

  if (!Array.isArray(record.lineItems)) errors.push(`${path}.lineItems: expected an array`);
  else {
    record.lineItems.forEach((item, index) => {
      const itemPath = `${path}.lineItems[${index}]`;
      if (!isPlainObject(item)) {
        errors.push(`${itemPath}: expected an object`);
        return;
      }
      hasOnlyKeys(item, lineItemKeys, itemPath, errors);
      stringValue(item.id, `${itemPath}.id`, errors, false);
      stringValue(item.productId, `${itemPath}.productId`, errors);
      stringValue(item.description, `${itemPath}.description`, errors);
      finiteNumber(item.quantity, `${itemPath}.quantity`, errors, 0);
      finiteNumber(item.price, `${itemPath}.price`, errors, 0);
      finiteNumber(item.discount, `${itemPath}.discount`, errors, 0);
      finiteNumber(item.tax, `${itemPath}.tax`, errors, 0);
      if (typeof item.productId === "string" && item.productId && !containsRecord(records, "Products", item.productId)) errors.push(`${itemPath}.productId: referenced product does not exist`);
    });
  }

  if (record.convertedTo !== undefined) {
    const convertedPath = `${path}.convertedTo`;
    if (module !== "Leads") errors.push(`${convertedPath}: only leads may have conversion data`);
    if (!isPlainObject(record.convertedTo)) errors.push(`${convertedPath}: expected an object`);
    else {
      const converted = record.convertedTo;
      const allowed = new Set(["contactId", "accountId", "dealId"]);
      hasOnlyKeys(converted, allowed, convertedPath, errors);
      stringValue(converted.contactId, `${convertedPath}.contactId`, errors, false);
      if (converted.accountId !== undefined) stringValue(converted.accountId, `${convertedPath}.accountId`, errors, false);
      if (converted.dealId !== undefined) stringValue(converted.dealId, `${convertedPath}.dealId`, errors, false);
      if (typeof converted.contactId === "string" && !containsRecord(records, "Contacts", converted.contactId)) errors.push(`${convertedPath}.contactId: contact does not exist`);
      if (typeof converted.accountId === "string" && !containsRecord(records, "Accounts", converted.accountId)) errors.push(`${convertedPath}.accountId: account does not exist`);
      if (typeof converted.dealId === "string" && !containsRecord(records, "Deals", converted.dealId)) errors.push(`${convertedPath}.dealId: deal does not exist`);
    }
  }
  return true;
}

function validateView(view: unknown, path: string, errors: string[]): view is SavedView {
  if (!isPlainObject(view)) {
    errors.push(`${path}: expected an object`);
    return false;
  }
  hasOnlyKeys(view, viewKeys, path, errors);
  stringValue(view.id, `${path}.id`, errors, false);
  stringValue(view.name, `${path}.name`, errors, false);
  moduleValue(view.module, `${path}.module`, errors);
  if (!Array.isArray(view.rules)) errors.push(`${path}.rules: expected an array`);
  else view.rules.forEach((rule, index) => validateFilterRule(rule, `${path}.rules[${index}]`, errors));
  if (view.match !== "all" && view.match !== "any") errors.push(`${path}.match: expected all or any`);
  if (!Array.isArray(view.columns)) errors.push(`${path}.columns: expected an array`);
  else view.columns.forEach((column, index) => stringValue(column, `${path}.columns[${index}]`, errors, false));
  return true;
}

function validateReport(report: unknown, path: string, errors: string[]): report is ReportDefinition {
  if (!isPlainObject(report)) {
    errors.push(`${path}: expected an object`);
    return false;
  }
  hasOnlyKeys(report, reportKeys, path, errors);
  stringValue(report.id, `${path}.id`, errors, false);
  stringValue(report.name, `${path}.name`, errors, false);
  moduleValue(report.module, `${path}.module`, errors);
  stringValue(report.groupBy, `${path}.groupBy`, errors);
  if (!Array.isArray(report.columns)) errors.push(`${path}.columns: expected an array`);
  else report.columns.forEach((column, index) => stringValue(column, `${path}.columns[${index}]`, errors, false));
  stringValue(report.folder, `${path}.folder`, errors);
  return true;
}

function validateDashboard(dashboard: unknown, path: string, reports: ReportDefinition[], errors: string[]): dashboard is { id: string; name: string; reportIds: string[] } {
  if (!isPlainObject(dashboard)) {
    errors.push(`${path}: expected an object`);
    return false;
  }
  hasOnlyKeys(dashboard, dashboardKeys, path, errors);
  stringValue(dashboard.id, `${path}.id`, errors, false);
  stringValue(dashboard.name, `${path}.name`, errors, false);
  if (!Array.isArray(dashboard.reportIds)) errors.push(`${path}.reportIds: expected an array`);
  else {
    dashboard.reportIds.forEach((reportId, index) => {
      stringValue(reportId, `${path}.reportIds[${index}]`, errors, false);
      if (typeof reportId === "string" && !reports.some((report) => isPlainObject(report) && report.id === reportId)) errors.push(`${path}.reportIds[${index}]: report does not exist`);
    });
  }
  return true;
}

export function stateErrors(state: unknown): string[] {
  const errors: string[] = [];
  if (!isPlainObject(state)) return ["Workspace backup must contain a JSON object."];
  hasOnlyKeys(state, stateKeys, "workspace", errors);
  if (state.version !== 2) errors.push("workspace.version: expected version 2");
  if (!Array.isArray(state.records)) errors.push("workspace.records: expected an array");
  if (!Array.isArray(state.views)) errors.push("workspace.views: expected an array");
  if (!isPlainObject(state.settings)) errors.push("workspace.settings: expected an object");
  if (!Array.isArray(state.reports)) errors.push("workspace.reports: expected an array");
  if (!Array.isArray(state.dashboards)) errors.push("workspace.dashboards: expected an array");

  const records = Array.isArray(state.records) ? (state.records as CrmRecord[]) : [];
  const ids = new Set<string>();
  records.forEach((record, index) => {
    validateRecord(record, `workspace.records[${index}]`, records, errors);
    if (isPlainObject(record) && typeof record.id === "string") {
      if (ids.has(record.id)) errors.push(`workspace.records[${index}].id: duplicate record id`);
      ids.add(record.id);
    }
  });
  if (isPlainObject(state.settings)) {
    for (const [key, value] of Object.entries(state.settings)) {
      if (unsafeKeys.has(key)) errors.push(`workspace.settings.${key}: unsafe property name`);
      stringValue(value, `workspace.settings.${key}`, errors);
    }
  }
  const views = Array.isArray(state.views) ? state.views : [];
  const viewIds = new Set<string>();
  views.forEach((view, index) => {
    validateView(view, `workspace.views[${index}]`, errors);
    if (isPlainObject(view) && typeof view.id === "string") {
      if (viewIds.has(view.id)) errors.push(`workspace.views[${index}].id: duplicate view id`);
      viewIds.add(view.id);
    }
  });
  const reports = Array.isArray(state.reports) ? (state.reports as ReportDefinition[]) : [];
  const reportIds = new Set<string>();
  reports.forEach((report, index) => {
    validateReport(report, `workspace.reports[${index}]`, errors);
    if (isPlainObject(report) && typeof report.id === "string") {
      if (reportIds.has(report.id)) errors.push(`workspace.reports[${index}].id: duplicate report id`);
      reportIds.add(report.id);
    }
  });
  const dashboardIds = new Set<string>();
  (Array.isArray(state.dashboards) ? state.dashboards : []).forEach((dashboard, index) => {
    validateDashboard(dashboard, `workspace.dashboards[${index}]`, reports, errors);
    if (isPlainObject(dashboard) && typeof dashboard.id === "string") {
      if (dashboardIds.has(dashboard.id)) errors.push(`workspace.dashboards[${index}].id: duplicate dashboard id`);
      dashboardIds.add(dashboard.id);
    }
  });

  for (const record of records) {
    if (!isPlainObject(record) || !moduleKeys.includes(record.module as ModuleKey) || !isPlainObject(record.values)) continue;
    const module = record.module as ModuleKey;
    for (const definition of moduleDefs[module].fields) {
      const referencedId = record.values[definition.key];
      if (definition.lookup && referencedId) {
        const target = records.find((candidate) => isPlainObject(candidate) && candidate.id === referencedId && candidate.module === definition.lookup);
        if (!target) errors.push(`workspace.records.${record.id}.values.${definition.key}: referenced ${definition.lookup} does not exist`);
        if (Array.isArray(record.links) && !record.links.some((link) => isPlainObject(link) && link.module === definition.lookup && link.id === referencedId)) errors.push(`workspace.records.${record.id}.links: missing ${definition.key} reference`);
      }
    }
    const relatedId = record.values.relatedId;
    if (relatedId) {
      const relatedModule = record.values.relatedModule as ModuleKey | undefined;
      const target = records.find((candidate) => isPlainObject(candidate) && candidate.id === relatedId && (!relatedModule || candidate.module === relatedModule));
      if (!target) errors.push(`workspace.records.${record.id}.values.relatedId: related record does not exist`);
      if (Array.isArray(record.links) && !record.links.some((link) => isPlainObject(link) && link.id === relatedId)) errors.push(`workspace.records.${record.id}.links: missing relatedId reference`);
    }
  }
  return errors;
}

export function assertValidState(state: CrmState): void {
  const errors = stateErrors(state);
  if (errors.length > 0) throw new Error(`Invalid CRM workspace: ${errors.slice(0, 8).join(" ")}${errors.length > 8 ? " More errors were found." : ""}`);
}

function cloneLink(link: RecordLink): RecordLink {
  return { module: link.module, id: link.id };
}

export function cloneRecord(record: CrmRecord): CrmRecord {
  const cloned: CrmRecord = {
    ...record,
    values: { ...record.values },
    tags: [...record.tags],
    notes: record.notes.map((note) => ({ ...note })),
    timeline: record.timeline.map((entry) => ({ ...entry })),
    links: record.links.map(cloneLink),
    lineItems: record.lineItems.map((item) => ({ ...item })),
  };
  if (record.deletedAt !== undefined) cloned.deletedAt = record.deletedAt;
  if (record.convertedTo !== undefined) cloned.convertedTo = { ...record.convertedTo };
  return cloned;
}

export function cloneState(state: CrmState): CrmState {
  return {
    version: 2,
    records: state.records.map(cloneRecord),
    views: state.views.map((view) => ({ ...view, rules: view.rules.map((rule) => ({ ...rule })), columns: [...view.columns] })),
    settings: { ...state.settings },
    reports: state.reports.map((report) => ({ ...report, columns: [...report.columns] })),
    dashboards: state.dashboards.map((dashboard) => ({ ...dashboard, reportIds: [...dashboard.reportIds] })),
  };
}

function parseLegacyWorkspaceBackup(value: Record<string, unknown>): CrmState {
  const errors: string[] = [];
  const allowed = new Set(["schema", "version", "exportedAt", "leads", "tasks"]);
  hasOnlyKeys(value, allowed, "legacy workspace", errors);
  if (value.schema !== "gallivanting.workspace") errors.push("legacy workspace.schema: unsupported schema");
  if (value.version !== 1) errors.push("legacy workspace.version: expected version 1");
  const exportedAt = typeof value.exportedAt === "string" && !Number.isNaN(Date.parse(value.exportedAt)) ? new Date(value.exportedAt).toISOString() : new Date().toISOString();
  if (!Array.isArray(value.leads)) errors.push("legacy workspace.leads: expected an array");
  if (!Array.isArray(value.tasks)) errors.push("legacy workspace.tasks: expected an array");
  if (errors.length > 0) throw new Error(`CRM backup rejected: ${errors.join(" ")}`);

  const records: CrmRecord[] = [];
  const used = new Set<string>();
  const legacyValues = (item: Record<string, unknown>, path: string): Values => {
    const values: Values = {};
    for (const [key, raw] of Object.entries(item)) {
      if (["id", "createdAt", "lastActivity", "notes", "tags"].includes(key)) continue;
      if (typeof raw === "string") values[key] = raw;
      else if (typeof raw === "number" || typeof raw === "boolean") values[key] = String(raw);
      else errors.push(`${path}.${key}: expected a primitive legacy value`);
    }
    return values;
  };
  const addLegacy = (item: unknown, module: ModuleKey, index: number): void => {
    const path = `legacy workspace.${module.toLocaleLowerCase()}[${index}]`;
    if (!isPlainObject(item)) {
      errors.push(`${path}: expected an object`);
      return;
    }
    if (typeof item.id !== "string" || item.id.trim() === "" || used.has(item.id)) {
      errors.push(`${path}.id: expected a unique non-empty string`);
      return;
    }
    used.add(item.id);
    const values = legacyValues(item, path);
    if (module === "Tasks") {
      if (typeof item.contact === "string" && item.contact.trim()) values.contactName = item.contact;
      if (typeof item.relatedTo === "string" && item.relatedTo.trim()) values.relatedTo = item.relatedTo;
    }
    errors.push(...validateValues(module, values).map((error) => `${path}: ${error}`));
    const createdAt = typeof item.createdAt === "string" && !Number.isNaN(Date.parse(item.createdAt)) ? new Date(item.createdAt).toISOString() : exportedAt;
    const record: CrmRecord = { id: item.id, module, values, createdAt, updatedAt: exportedAt, tags: [], notes: [], timeline: [], links: [], lineItems: [] };
    if (Array.isArray(item.tags)) {
      if (!item.tags.every((tag) => typeof tag === "string")) errors.push(`${path}.tags: expected strings`);
      else record.tags = item.tags as string[];
    } else if (item.tags !== undefined) errors.push(`${path}.tags: expected an array`);
    if (Array.isArray(item.notes)) {
      if (!item.notes.every((note) => typeof note === "string" && note.trim())) errors.push(`${path}.notes: expected non-empty strings`);
      else record.notes = (item.notes as string[]).map((note, noteIndex) => ({ id: `note-legacy-${index}-${noteIndex}`, text: note, createdAt }));
    } else if (item.notes !== undefined) errors.push(`${path}.notes: expected an array`);
    records.push(record);
  };
  (value.leads as unknown[]).forEach((item, index) => addLegacy(item, "Leads", index));
  (value.tasks as unknown[]).forEach((item, index) => addLegacy(item, "Tasks", index));
  if (errors.length > 0) throw new Error(`CRM backup rejected: ${errors.slice(0, 8).join(" ")}${errors.length > 8 ? " More errors were found." : ""}`);
  const state: CrmState = { version: 2, records, views: [], settings: {}, reports: [], dashboards: [] };
  assertValidState(state);
  return state;
}

export function parseBackup(text: string): CrmState {
  if (typeof text !== "string" || text.trim() === "") throw new Error("CRM backup is empty.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("CRM backup is not valid JSON.");
  }
  if (isPlainObject(parsed) && parsed.schema === "gallivanting.workspace" && parsed.version === 1) return parseLegacyWorkspaceBackup(parsed);
  const errors = stateErrors(parsed);
  if (errors.length > 0) throw new Error(`CRM backup rejected: ${errors.slice(0, 8).join(" ")}${errors.length > 8 ? " More errors were found." : ""}`);
  return cloneState(parsed as CrmState);
}

export function serializeBackup(state: CrmState): string {
  assertValidState(state);
  return JSON.stringify(cloneState(state), null, 2);
}

function linkExists(record: CrmRecord, module: ModuleKey, id: string): boolean {
  return record.links.some((link) => link.module === module && link.id === id);
}

function addLink(record: CrmRecord, module: ModuleKey, id: string): void {
  if (id && !linkExists(record, module, id)) record.links.push({ module, id });
}

function entry(prefix: string, title: string, detail: string, at: string): TimelineEntry {
  return { id: `${prefix}-${at.replace(/\D/g, "").slice(-14)}-${Math.random().toString(36).slice(2, 8)}`, title, detail, at };
}

function defaultId(prefix: string, used: Set<string>): string {
  let candidate = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  while (used.has(candidate)) candidate = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  used.add(candidate);
  return candidate;
}

function dateAfterDays(timestamp: string, days: number): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function copyIfPresent(values: Values, source: Values, targetKey: string, sourceKey = targetKey): void {
  if (source[sourceKey]?.trim()) values[targetKey] = source[sourceKey];
}

export function convertLead(
  sourceState: CrmState,
  leadId: string,
  options: LeadConversionOptions = { createDeal: false },
  now = new Date().toISOString(),
  idFactory: (prefix: string, used: Set<string>) => string = defaultId,
): LeadConversion {
  assertValidState(sourceState);
  const state = cloneState(sourceState);
  const lead = state.records.find((record) => record.id === leadId && record.module === "Leads");
  if (!lead) throw new Error("Lead not found.");
  if (lead.convertedTo) return { state, result: { ...lead.convertedTo } };
  if (lead.deletedAt) throw new Error("A deleted lead cannot be converted.");

  const usedIds = new Set(state.records.map((record) => record.id));
  const company = lead.values.company.trim();
  const email = lead.values.email?.trim().toLocaleLowerCase();
  let account = state.records.find((record) => record.module === "Accounts" && record.values.accountName?.trim().toLocaleLowerCase() === company.toLocaleLowerCase());
  if (!account) {
    const accountValues: Values = { accountName: company };
    copyIfPresent(accountValues, lead.values, "phone");
    copyIfPresent(accountValues, lead.values, "website");
    copyIfPresent(accountValues, lead.values, "industry");
    copyIfPresent(accountValues, lead.values, "owner");
    copyIfPresent(accountValues, lead.values, "billingCity", "city");
    copyIfPresent(accountValues, lead.values, "billingState", "state");
    copyIfPresent(accountValues, lead.values, "billingCode", "zipCode");
    copyIfPresent(accountValues, lead.values, "billingCountry", "country");
    if (lead.values.employees && /^\s*\d+(?:\.\d+)?\s*$/.test(lead.values.employees)) accountValues.employees = lead.values.employees;
    if (lead.values.revenue && /^\s*\d+(?:\.\d+)?\s*$/.test(lead.values.revenue)) accountValues.annualRevenue = lead.values.revenue;
    const accountId = idFactory("account", usedIds);
    account = {
      id: accountId,
      module: "Accounts",
      values: accountValues,
      createdAt: now,
      updatedAt: now,
      tags: ["Converted lead"],
      notes: [],
      timeline: [entry("timeline", "Account created", `Created while converting lead ${lead.id}.`, now)],
      links: [],
      lineItems: [],
    };
    state.records.unshift(account);
  }

  let contact = state.records.find((record) => {
    if (record.module !== "Contacts" || record.deletedAt) return false;
    const sameEmail = email && record.values.email?.trim().toLocaleLowerCase() === email;
    const sameName = record.values.firstName?.trim().toLocaleLowerCase() === lead.values.firstName?.trim().toLocaleLowerCase() && record.values.lastName?.trim().toLocaleLowerCase() === lead.values.lastName?.trim().toLocaleLowerCase();
    return Boolean(sameEmail || (sameName && record.values.accountId === account?.id));
  });
  if (!contact) {
    const contactId = idFactory("contact", usedIds);
    const contactValues: Values = {
      firstName: lead.values.firstName ?? "",
      lastName: lead.values.lastName,
      accountId: account.id,
    };
    copyIfPresent(contactValues, lead.values, "email");
    copyIfPresent(contactValues, lead.values, "phone");
    copyIfPresent(contactValues, lead.values, "mobile");
    copyIfPresent(contactValues, lead.values, "website");
    copyIfPresent(contactValues, lead.values, "title");
    copyIfPresent(contactValues, lead.values, "leadSource", "source");
    copyIfPresent(contactValues, lead.values, "owner");
    copyIfPresent(contactValues, lead.values, "mailingStreet", "street");
    copyIfPresent(contactValues, lead.values, "mailingCity", "city");
    copyIfPresent(contactValues, lead.values, "mailingState", "state");
    copyIfPresent(contactValues, lead.values, "mailingZip", "zipCode");
    copyIfPresent(contactValues, lead.values, "mailingCountry", "country");
    contact = {
      id: contactId,
      module: "Contacts",
      values: contactValues,
      createdAt: now,
      updatedAt: now,
      tags: ["Converted lead"],
      notes: [],
      timeline: [entry("timeline", "Contact created", `Created while converting lead ${lead.id}.`, now)],
      links: [{ module: "Accounts", id: account.id }],
      lineItems: [],
    };
    state.records.unshift(contact);
  }

  const result: ConvertedLead = { contactId: contact.id, accountId: account.id };
  let deal: CrmRecord | undefined;
  if (options.createDeal) {
    const dealId = idFactory("deal", usedIds);
    const dealName = options.dealName?.trim() || `${company} opportunity`;
    const dealValues: Values = {
      dealName,
      accountId: account.id,
      contactId: contact.id,
      stage: "Qualification",
      closingDate: options.closingDate?.trim() || dateAfterDays(now, 30),
      probability: "10",
      type: "New Business",
    };
    copyIfPresent(dealValues, lead.values, "owner");
    if (options.amount?.trim()) dealValues.amount = options.amount.trim();
    deal = {
      id: dealId,
      module: "Deals",
      values: dealValues,
      createdAt: now,
      updatedAt: now,
      tags: ["Converted lead"],
      notes: [],
      timeline: [entry("timeline", "Deal created", `Created while converting lead ${lead.id}.`, now)],
      links: [
        { module: "Accounts", id: account.id },
        { module: "Contacts", id: contact.id },
      ],
      lineItems: [],
    };
    state.records.unshift(deal);
    result.dealId = deal.id;
  }

  addLink(lead, "Contacts", contact.id);
  addLink(lead, "Accounts", account.id);
  if (deal) addLink(lead, "Deals", deal.id);
  lead.convertedTo = { ...result };
  lead.values.status = "Converted";
  lead.updatedAt = now;
  lead.timeline.push(entry("timeline", "Lead converted", `Created contact ${contact.id}${deal ? ` and deal ${deal.id}` : ""}.`, now));
  addLink(account, "Contacts", contact.id);
  addLink(account, "Leads", lead.id);
  if (deal) addLink(account, "Deals", deal.id);
  account.updatedAt = now;
  account.timeline.push(entry("timeline", "Lead converted", `Lead ${lead.id} was converted to contact ${contact.id}.`, now));
  addLink(contact, "Leads", lead.id);
  addLink(contact, "Accounts", account.id);
  contact.updatedAt = now;
  contact.timeline.push(entry("timeline", "Lead converted", `Created from lead ${lead.id}.`, now));
  if (deal) {
    addLink(contact, "Deals", deal.id);
    addLink(deal, "Leads", lead.id);
    addLink(deal, "Contacts", contact.id);
    addLink(deal, "Accounts", account.id);
  }
  assertValidState(state);
  return { state, result };
}
