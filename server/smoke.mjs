// End-to-end smoke test against a running local worker: node server/smoke.mjs [baseUrl]
const BASE = process.argv[2] ?? "http://127.0.0.1:8787";
let pass = 0, fail = 0;
const ok = (cond, label, extra) => { if (cond) { pass++; console.log("  ✓", label); } else { fail++; console.log("  ✗", label, extra ? JSON.stringify(extra).slice(0, 300) : ""); } };

async function login(email, name) {
  const r = await fetch(`${BASE}/api/auth/dev-login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, name }) });
  const { token, userId } = await r.json();
  const cookie = `gv_session=${token}`;
  const call = async (method, path, body) => {
    const res = await fetch(`${BASE}${path}`, { method, headers: { Cookie: cookie, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { userId, call };
}

const stamp = Date.now().toString(36);
console.log("Auth & workspaces");
ok((await (await fetch(`${BASE}/api/me`)).status) === 401, "unauthenticated /api/me → 401");
const alice = await login(`alice-${stamp}@example.com`, "Alice");
const bob = await login(`bob-${stamp}@example.com`, "Bob");
const ws = (await alice.call("POST", "/api/workspaces", { name: "Acme Sales" })).body;
ok(ws.id && ws.role === "owner", "create workspace", ws);
const me = (await alice.call("GET", "/api/me")).body;
ok(me.workspaces.some((w) => w.id === ws.id), "workspace listed in /api/me");
const tool = (who, name, input) => who.call("POST", `/api/w/${ws.id}/tools/${name}`, input);

console.log("Tools manifest");
const manifest = (await alice.call("GET", `/api/w/${ws.id}/tools`)).body;
ok(manifest.tools.length >= 35, `manifest has ${manifest.tools.length} tools`);
ok(manifest.tools.every((t) => t.inputSchema?.type === "object"), "every tool has a JSON schema");

console.log("Records");
const bad = await tool(alice, "create_record", { module: "Leads", values: { firstName: "No" } });
ok(bad.status === 400 && /required/i.test(bad.body.error.message), "validation rejects missing required fields", bad.body);
const lead = (await tool(alice, "create_record", { module: "Leads", values: { firstName: "Priya", lastName: "Sharma", company: "Globex", email: "priya@globex.com", status: "New", source: "LinkedIn", rating: "Hot" }, tags: ["vip"] })).body.result;
ok(lead?.id && lead.title === "Globex", "create lead", lead);
const badSelect = await tool(alice, "create_record", { module: "Leads", values: { lastName: "X", company: "Y", status: "Bogus" } });
ok(badSelect.status === 400, "select options enforced");
await tool(alice, "create_record", { module: "Leads", values: { lastName: "Kumar", company: "Initech", status: "Contacted", source: "Website" } });
const search = (await tool(alice, "search_records", { module: "Leads", query: "globex" })).body.result;
ok(search.total === 1 && search.records[0].id === lead.id, "free-text search");
const filtered = (await tool(alice, "search_records", { module: "Leads", rules: [{ field: "source", operator: "is", value: "linkedin" }] })).body.result;
ok(filtered.total === 1, "field filter (case-insensitive)");
const upd = (await tool(alice, "update_record", { id: lead.id, values: { rating: "Warm" }, expectedVersion: 1 })).body.result;
ok(upd.version === 2 && upd.values.rating === "Warm", "update with version check");
const stale = await tool(alice, "update_record", { id: lead.id, values: { rating: "Cold" }, expectedVersion: 1 });
ok(stale.status === 409, "stale version → 409 conflict");

console.log("Activities");
const note = (await tool(alice, "add_note", { recordId: lead.id, text: "Met at trade show" })).body.result;
ok(note?.id, "add note");
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
await tool(alice, "create_task", { subject: "Send proposal", dueDate: yesterday, relatedId: lead.id, priority: "High" });
const task2 = (await tool(alice, "create_task", { subject: "Follow-up call", dueDate: today })).body.result;
const agenda = (await tool(alice, "list_agenda", {})).body.result;
ok(agenda.overdueTasks.length === 1 && agenda.upcomingTasks.length === 1, "agenda overdue/upcoming", agenda);
await tool(alice, "complete_task", { taskId: task2.id });
const agenda2 = (await tool(alice, "list_agenda", {})).body.result;
ok(agenda2.upcomingTasks.length === 0, "completed task leaves agenda");

console.log("Sales");
const conv = (await tool(alice, "convert_lead", { leadId: lead.id, createDeal: true, amount: "50000", closingDate: "2026-12-31" })).body.result;
ok(conv?.accountId && conv.contactId && conv.dealId, "convert lead → account, contact, deal", conv);
const again = (await tool(alice, "convert_lead", { leadId: lead.id })).body.result;
ok(again.alreadyConverted, "conversion is idempotent");
await tool(alice, "move_deal_stage", { dealId: conv.dealId, stage: "Negotiation/Review" });
const pipe = (await tool(alice, "pipeline_summary", {})).body.result;
ok(pipe.openDeals === 1 && pipe.openAmount === 50000 && pipe.weightedAmount === 37500, "pipeline summary", pipe);
const ctx = (await tool(alice, "get_record", { id: conv.accountId })).body.result;
ok(ctx.referencedBy.length >= 2, "get_record shows referencing contact+deal", ctx.referencedBy);

console.log("Inventory");
const product = (await tool(alice, "create_record", { module: "Products", values: { productName: "CRM Seat", unitPrice: "1000" } })).body.result;
const quote = (await tool(alice, "create_record", { module: "Quotes", values: { quoteName: "Globex Q1", accountId: conv.accountId, stage: "Draft" } })).body.result;
const li = (await tool(alice, "set_line_items", { recordId: quote.id, items: [{ productId: product.id, quantity: 10, price: 1000, discount: 10, tax: 18 }] })).body.result;
ok(li?.totals?.total === 10620, "line item totals (10×1000 −10% +18%)", li?.totals);
const so = (await tool(alice, "convert_quote_to_sales_order", { quoteId: quote.id })).body.result;
ok(so?.module === "Sales Orders" && so.values.quoteId === quote.id, "quote → sales order", so);
const inv = (await tool(alice, "convert_sales_order_to_invoice", { salesOrderId: so.id })).body.result;
const invFull = (await tool(alice, "get_record", { id: inv.id })).body.result;
ok(invFull.lineItems.length === 1 && inv.values.status === "Draft", "sales order → invoice with line items");

console.log("Reports");
const rep = (await tool(alice, "run_report", { module: "Leads", groupBy: "source" })).body.result;
ok(rep.rows.length === 2, "report: leads by source", rep);
const sum = (await tool(alice, "run_report", { module: "Deals", groupBy: "stage", metric: "sum", metricField: "amount" })).body.result;
ok(sum.rows[0]?.value === 50000, "report: deal amount by stage", sum);
const dash = (await tool(alice, "dashboard_summary", {})).body.result;
ok(dash.openDeals === 1 && dash.overdueTasks === 1, "dashboard summary", dash);

console.log("Teams & permissions");
ok((await tool(bob, "search_records", {})).status === 403, "non-member is blocked");
const invite = (await tool(alice, "invite_member", { email: `bob-${stamp}@example.com`, role: "viewer" })).body.result;
const accept = await bob.call("POST", `/api/invites/${invite.invitePath.split("/").pop()}/accept`);
ok(accept.status === 200, "bob accepts invite", accept.body);
ok((await tool(bob, "search_records", { module: "Leads" })).status === 200, "viewer can read");
ok((await tool(bob, "create_record", { module: "Leads", values: { lastName: "Z", company: "Z" } })).status === 403, "viewer cannot write");
const bobManifest = (await bob.call("GET", `/api/w/${ws.id}/tools`)).body;
ok(bobManifest.tools.every((t) => t.authority === "read"), "viewer manifest only has read tools");

console.log("Recycle bin & history");
await tool(alice, "delete_record", { id: product.id });
ok((await tool(alice, "search_records", { module: "Products" })).body.result.total === 0, "deleted record hidden");
ok((await tool(alice, "search_records", { deletedOnly: true })).body.result.total === 1, "recycle bin lists it");
await tool(alice, "restore_record", { id: product.id });
const hist = (await tool(alice, "record_history", { id: lead.id })).body.result;
ok(hist.length >= 4 && hist.every((h) => h.source === "ui"), "audit trail recorded", hist.map((h) => h.action));
const changes = (await tool(alice, "changes_since", { since: "" })).body.result;
ok(changes.records.length >= 10, `changes_since returns ${changes.records.length} records`);


console.log("Original UI sync (/api/legacy)");
const carol = await login(`carol-${stamp}@example.com`, "Carol");
const snap0 = (await carol.call("GET", "/api/legacy/snapshot")).body;
ok(snap0.workspaceId && snap0.initialized.length === 0, "snapshot auto-creates a personal workspace", snap0);
const up = (await carol.call("POST", "/api/legacy/sync/Contacts", { upserts: [
  { id: `c-${stamp}-1`, values: { firstName: "Kris", lastName: "Marrier", accountName: "King", owner: "You" }, extra: { notes: [{ id: "n1", title: "Note", text: "hi", at: "2026-10-16T00:00:00Z" }], timeline: [] } },
  { id: `c-${stamp}-2`, values: { firstName: "Sage", lastName: "Wieser" } },
] })).body;
ok(up.created === 2 && up.errors.length === 0, "legacy upsert creates records (free-text owner allowed)", up);
const up2 = (await carol.call("POST", "/api/legacy/sync/Contacts", { upserts: [{ id: `c-${stamp}-1`, values: { firstName: "Kris", lastName: "Marrier" } }], deletes: [`c-${stamp}-2`] })).body;
ok(up2.updated === 1 && up2.deleted === 1, "legacy update + delete", up2);
const snap1 = (await carol.call("GET", "/api/legacy/snapshot")).body;
const kris = snap1.modules.Contacts.find((r) => r.id === `c-${stamp}-1`);
ok(snap1.initialized.includes("Contacts") && kris && !kris.values.accountName && kris.extra.notes.length === 1, "snapshot reflects changes, removed keys cleared, extra kept", kris);
ok(snap1.modules.Contacts.find((r) => r.id === `c-${stamp}-2`)?.deletedAt, "deleted record is in recycle bin");
const viaTool = (await carol.call("POST", `/api/w/${snap1.workspaceId}/tools/search_records`, { module: "Contacts", query: "kris" })).body.result;
ok(viaTool.total === 1, "records saved by the original UI are visible to AI/MCP tools");
const clash = (await carol.call("POST", "/api/legacy/sync/Contacts", { upserts: [{ id: lead.id, values: { lastName: "x" } }] })).body;
ok(clash.errors.length === 1, "cannot overwrite another workspace's record id", clash);
const ai = (await carol.call("GET", "/api/ai/status")).body;
ok(typeof ai.keys === "number" && ai.baseUrl.includes("vyceai"), "AI status endpoint", ai);
const legacyStatus = (await fetch(`${BASE}/api/auth/status`)).status;
ok(legacyStatus === 200, "legacy /api/auth/status responds");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
