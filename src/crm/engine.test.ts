import assert from "node:assert/strict";
import test from "node:test";
import { assertValidState, convertLead, filterRecords, matchesRule, parseBackup, serializeBackup, totals, validateValues } from "./engine.ts";
import type { CrmRecord, CrmState, Values } from "./model.ts";
import { fieldLabel, moduleDefs, moduleKeys, recordTitle } from "./schema.ts";

const at = "2026-10-12T10:00:00.000Z";

function record(module: CrmRecord["module"], id: string, values: Values, extra: Partial<CrmRecord> = {}): CrmRecord {
  return {
    id,
    module,
    values,
    createdAt: at,
    updatedAt: at,
    tags: [],
    notes: [],
    timeline: [],
    links: [],
    lineItems: [],
    ...extra,
  };
}

function state(records: CrmRecord[]): CrmState {
  return { version: 2, records, views: [], settings: {}, reports: [], dashboards: [] };
}

test("the schema exposes every CRM module with the correct singular and primary field", () => {
  assert.deepEqual(moduleKeys, ["Leads", "Contacts", "Accounts", "Deals", "Campaigns", "Tasks", "Meetings", "Calls", "Products", "Price Books", "Quotes", "Sales Orders", "Purchase Orders", "Invoices", "Vendors", "Cases", "Solutions"]);
  assert.equal(moduleDefs["Sales Orders"].singular, "Sales Order");
  assert.equal(moduleDefs["Purchase Orders"].singular, "Purchase Order");
  assert.equal(moduleDefs.Meetings.titleField, "title");
  const contact = record("Contacts", "contact-1", { firstName: "Ada", lastName: "Lovelace" });
  assert.equal(recordTitle(contact), "Ada Lovelace");
  assert.equal(fieldLabel("Deals", "closingDate"), "Closing Date");
});

test("business-required fields and field types are validated", () => {
  assert.deepEqual(validateValues("Leads", { firstName: "Ada" }), ["Last Name is required.", "Company is required."]);
  assert.ok(validateValues("Deals", { dealName: "Opportunity", stage: "Qualification" }).includes("Closing Date is required."));
  assert.ok(validateValues("Meetings", { title: "Demo", from: "2026-10-12T10:00", to: "" }).includes("To is required."));
  assert.ok(validateValues("Contacts", { lastName: "Lovelace", email: "not-an-email" }).some((error) => error.includes("email")));
  assert.equal(validateValues("Accounts", { accountName: "Analytical Engines", industry: "Technology" }).length, 0);
});

test("rules support text and numeric comparisons while deleted records stay out of views", () => {
  const first = record("Accounts", "account-1", { accountName: "Northstar", amount: "10", status: "Open" }, { tags: ["priority"] });
  const second = record("Accounts", "account-2", { accountName: "Southwind", amount: "30", status: "Closed" });
  const deleted = record("Accounts", "account-3", { accountName: "Northstar deleted", amount: "50" }, { deletedAt: at });
  assert.equal(matchesRule(first, { id: "r1", field: "accountName", operator: "contains", value: "north" }), true);
  assert.equal(matchesRule(first, { id: "r2", field: "amount", operator: "greater_than", value: "9" }), true);
  assert.equal(matchesRule(first, { id: "r3", field: "tags", operator: "contains", value: "priority" }), true);
  assert.deepEqual(filterRecords([first, second, deleted], [{ id: "r4", field: "amount", operator: "greater_or_equal", value: "20" }], "all").map((item) => item.id), ["account-2"]);
  assert.deepEqual(filterRecords([first, second], [{ id: "r5", field: "status", operator: "is", value: "Open" }, { id: "r6", field: "accountName", operator: "is", value: "Southwind" }], "any").map((item) => item.id), ["account-1", "account-2"]);
});

test("line-item totals use quantity, percentage discount, and percentage tax", () => {
  assert.deepEqual(totals([
    { id: "line-1", productId: "product-1", description: "Service", quantity: 2, price: 100, discount: 10, tax: 5 },
    { id: "line-2", productId: "product-2", description: "Add-on", quantity: 1, price: 50, discount: 0, tax: 0 },
  ]), { subtotal: 250, discount: 20, tax: 9, total: 239 });
  assert.throws(() => totals([{ id: "bad", productId: "", description: "", quantity: -1, price: 1, discount: 0, tax: 0 }]), /quantity/);
});

test("backups round-trip and reject unknown or dangling JSON atomically", () => {
  const original = state([record("Accounts", "account-1", { accountName: "Northstar" })]);
  const serialized = serializeBackup(original);
  const parsed = parseBackup(serialized);
  assert.deepEqual(parsed, original);

  const withUnknown = JSON.parse(serialized) as Record<string, unknown>;
  withUnknown.unexpected = true;
  assert.throws(() => parseBackup(JSON.stringify(withUnknown)), /unknown property/);

  const withDanglingLink = JSON.parse(serialized) as { records: CrmRecord[] };
  withDanglingLink.records[0].links = [{ module: "Contacts", id: "missing-contact" }];
  assert.throws(() => parseBackup(JSON.stringify(withDanglingLink)), /does not exist/);
  const withMalformedRecord = JSON.parse(serialized) as { records: unknown[] };
  withMalformedRecord.records = [null];
  assert.throws(() => parseBackup(JSON.stringify(withMalformedRecord)), /expected an object/);
  assert.deepEqual(parseBackup(serialized), original);
});

test("the known legacy workspace export is migrated without accepting an unknown schema", () => {
  const legacy = JSON.stringify({
    schema: "gallivanting.workspace",
    version: 1,
    exportedAt: at,
    leads: [{ id: "legacy-lead", firstName: "Local", lastName: "Owner", company: "Local Co", status: "New", source: "Website", industry: "Technology", rating: "Warm", owner: "You", notes: ["Keep the local context"], tags: ["local"] }],
    tasks: [{ id: "legacy-task", subject: "Review local record", status: "Not Started", priority: "Normal", owner: "You", dueDate: "Today", contact: "Local Owner", relatedTo: "Local Co" }],
  });
  const migrated = parseBackup(legacy);
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.records.map((item) => item.module), ["Leads", "Tasks"]);
  assert.equal(migrated.records[0].notes[0].text, "Keep the local context");
  assert.throws(() => parseBackup(JSON.stringify({ schema: "other.workspace", version: 1, leads: [], tasks: [] })), /unknown property|expected version 2/);
});

test("lead conversion creates linked records once and is idempotent", () => {
  const lead = record("Leads", "lead-1", {
    firstName: "Asha",
    lastName: "Rao",
    company: "Local Systems",
    email: "asha@local.example",
    phone: "+1 555 0100",
    source: "Referral",
    status: "New",
    industry: "Technology",
    rating: "Warm",
    owner: "You",
  });
  const initial = state([lead]);
  const makeId = (prefix: string, used: Set<string>): string => {
    let id = `${prefix}-converted`;
    let suffix = 1;
    while (used.has(id)) id = `${prefix}-converted-${suffix++}`;
    used.add(id);
    return id;
  };
  const converted = convertLead(initial, "lead-1", { createDeal: true, amount: "12000", closingDate: "2026-11-12" }, at, makeId);
  assert.equal(converted.result.accountId, "account-converted");
  assert.equal(converted.result.contactId, "contact-converted");
  assert.equal(converted.result.dealId, "deal-converted");
  const convertedLead = converted.state.records.find((item) => item.id === "lead-1")!;
  assert.equal(convertedLead.values.status, "Converted");
  assert.deepEqual(convertedLead.convertedTo, converted.result);
  assert.ok(convertedLead.links.some((link) => link.module === "Contacts" && link.id === converted.result.contactId));
  assert.ok(converted.state.records.find((item) => item.id === converted.result.contactId)?.links.some((link) => link.module === "Accounts" && link.id === converted.result.accountId));
  assertValidState(converted.state);

  const repeated = convertLead(converted.state, "lead-1", { createDeal: true, dealName: "Different name" }, at, makeId);
  assert.deepEqual(repeated.result, converted.result);
  assert.equal(repeated.state.records.length, converted.state.records.length);
  assert.deepEqual(repeated.state.records.find((item) => item.id === "lead-1")?.convertedTo, converted.result);
});
