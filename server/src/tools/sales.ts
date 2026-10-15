import { z } from "zod";
import { totals } from "../../../src/crm/engine.ts";
import { moduleDefs } from "../../../src/crm/schema.ts";
import type { ModuleKey, Values } from "../../../src/crm/model.ts";
import { defineTool, type ToolContext } from "../registry.ts";
import { createRecord, loadRow, searchRecords, timelineStmt, toDto, updateRecord } from "../records.ts";
import { AppError, newId, nowIso, parseJson } from "../util.ts";

function pick(values: Values, map: Record<string, string>): Values {
  const out: Values = {};
  for (const [target, source] of Object.entries(map)) if (values[source]?.trim()) out[target] = values[source];
  return out;
}

defineTool({
  name: "convert_lead",
  title: "Convert a lead",
  description: "Convert a lead into an Account + Contact (reusing an existing account with the same company name / contact with the same email), optionally creating a Deal. Marks the lead Converted.",
  authority: "write",
  input: z.object({
    leadId: z.string(),
    createDeal: z.boolean().optional(),
    dealName: z.string().optional(),
    amount: z.string().optional(),
    closingDate: z.string().optional().describe("YYYY-MM-DD, required when createDeal is true"),
  }),
  async run(ctx, { leadId, createDeal, dealName, amount, closingDate }) {
    const lead = toDto(await loadRow(ctx, leadId));
    if (lead.module !== "Leads") throw new AppError("invalid", `${leadId} is not a lead.`);
    if (lead.convertedTo) return { alreadyConverted: true, ...lead.convertedTo };
    const v = lead.values;
    const company = v.company?.trim();
    if (!company) throw new AppError("invalid", "The lead needs a company before it can be converted.");

    const existingAccount = await searchRecords(ctx, { module: "Accounts", rules: [{ field: "accountName", operator: "is", value: company }], limit: 1 });
    const account = existingAccount.records[0] ??
      (await createRecord(ctx, "Accounts", {
        accountName: company,
        ...pick(v, { phone: "phone", website: "website", industry: "industry", billingCity: "city", billingState: "state", billingCode: "zipCode", billingCountry: "country" }),
      }, { tags: ["Converted lead"], timelineTitle: "Account created from lead" }));

    const email = v.email?.trim();
    const existingContact = email
      ? await searchRecords(ctx, { module: "Contacts", rules: [{ field: "email", operator: "is", value: email }], limit: 1 })
      : { records: [] };
    const contact = existingContact.records[0] ??
      (await createRecord(ctx, "Contacts", {
        firstName: v.firstName ?? "",
        lastName: v.lastName,
        accountId: account.id,
        ...pick(v, { email: "email", phone: "phone", mobile: "mobile", title: "title", leadSource: "source", mailingStreet: "street", mailingCity: "city", mailingState: "state", mailingZip: "zipCode", mailingCountry: "country", description: "description" }),
      }, { timelineTitle: "Contact created from lead" }));

    let dealId: string | undefined;
    if (createDeal) {
      if (!closingDate) throw new AppError("invalid", "closingDate is required to create a deal.");
      const deal = await createRecord(ctx, "Deals", {
        dealName: dealName?.trim() || `${company} deal`,
        accountId: account.id,
        contactId: contact.id,
        amount: amount ?? "",
        stage: "Qualification",
        closingDate,
        ...(v.campaignId ? { campaignId: v.campaignId } : {}),
      }, { timelineTitle: "Deal created from lead" });
      dealId = deal.id;
    }
    const convertedTo = { accountId: account.id, contactId: contact.id, ...(dealId ? { dealId } : {}) };
    await ctx.db.batch([
      ctx.db.prepare("UPDATE records SET converted_to = ?, data = json_set(data, '$.status', 'Converted'), version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?")
        .bind(JSON.stringify(convertedTo), nowIso(), ctx.userId, leadId),
      timelineStmt(ctx, leadId, "convert", "Lead converted", `Account ${account.title}, contact ${contact.title}${dealId ? ", deal created" : ""}`),
    ]);
    return { converted: true, ...convertedTo };
  },
});

defineTool({
  name: "move_deal_stage",
  title: "Move a deal to a stage",
  description: "Change a deal's stage (Qualification, Needs Analysis, Value Proposition, Negotiation/Review, Closed Won, Closed Lost). For Closed Lost you can give a reason.",
  authority: "write",
  input: z.object({
    dealId: z.string(),
    stage: z.enum(moduleDefs.Deals.stages as [string, ...string[]]),
    reasonForLoss: z.string().optional(),
  }),
  async run(ctx, { dealId, stage, reasonForLoss }) {
    const row = await loadRow(ctx, dealId);
    if (row.module !== "Deals") throw new AppError("invalid", `${dealId} is not a deal.`);
    const probability: Record<string, string> = { Qualification: "10", "Needs Analysis": "20", "Value Proposition": "40", "Negotiation/Review": "75", "Closed Won": "100", "Closed Lost": "0" };
    const patch: Values = { stage, probability: probability[stage] };
    if (stage === "Closed Lost" && reasonForLoss) patch.reasonForLoss = reasonForLoss;
    return updateRecord(ctx, dealId, patch, { timelineTitle: `Stage → ${stage}` });
  },
});

defineTool({
  name: "pipeline_summary",
  title: "Deal pipeline summary",
  description: "Count, total amount and weighted amount of open deals per stage, plus won/lost totals. Optionally only deals closing in a date range.",
  authority: "read",
  input: z.object({ closingFrom: z.string().optional(), closingTo: z.string().optional(), mine: z.boolean().optional() }),
  async run(ctx, { closingFrom, closingTo, mine }) {
    const where = ["workspace_id = ?", "module = 'Deals'", "deleted_at IS NULL"];
    const params: unknown[] = [ctx.workspaceId];
    if (closingFrom) { where.push("json_extract(data,'$.closingDate') >= ?"); params.push(closingFrom); }
    if (closingTo) { where.push("json_extract(data,'$.closingDate') <= ?"); params.push(closingTo); }
    if (mine) { where.push("owner_id = ?"); params.push(ctx.userId); }
    const rows = await ctx.db.prepare(
      `SELECT json_extract(data,'$.stage') AS stage, COUNT(*) AS count,
              SUM(CAST(coalesce(json_extract(data,'$.amount'),0) AS REAL)) AS amount,
              SUM(CAST(coalesce(json_extract(data,'$.amount'),0) AS REAL) * CAST(coalesce(json_extract(data,'$.probability'),0) AS REAL) / 100) AS weighted
       FROM records WHERE ${where.join(" AND ")} GROUP BY stage`,
    ).bind(...params).all<{ stage: string; count: number; amount: number; weighted: number }>();
    const stages = (moduleDefs.Deals.stages ?? []).map((s) => rows.results.find((r) => r.stage === s) ?? { stage: s, count: 0, amount: 0, weighted: 0 });
    const open = stages.filter((s) => !s.stage.startsWith("Closed"));
    return {
      stages,
      openDeals: open.reduce((a, s) => a + s.count, 0),
      openAmount: open.reduce((a, s) => a + (s.amount ?? 0), 0),
      weightedAmount: open.reduce((a, s) => a + (s.weighted ?? 0), 0),
    };
  },
});

// ---------- inventory: line items & document conversion ----------

const lineItem = z.object({
  productId: z.string().optional(),
  description: z.string().optional(),
  quantity: z.number().min(0),
  price: z.number().min(0),
  discount: z.number().min(0).max(100).optional().describe("percent"),
  tax: z.number().min(0).optional().describe("percent"),
});

const inventoryModules: ModuleKey[] = ["Quotes", "Sales Orders", "Purchase Orders", "Invoices"];

async function writeLineItems(ctx: ToolContext, recordId: string, items: z.infer<typeof lineItem>[]) {
  const normalized = items.map((i, position) => ({ id: newId("li"), position, productId: i.productId ?? "", description: i.description ?? "", quantity: i.quantity, price: i.price, discount: i.discount ?? 0, tax: i.tax ?? 0 }));
  for (const item of normalized) {
    if (item.productId) {
      const p = await loadRow(ctx, item.productId);
      if (p.module !== "Products") throw new AppError("invalid", `${item.productId} is not a product.`);
      if (!item.description) item.description = p.title;
    }
  }
  const sum = totals(normalized);
  await ctx.db.batch([
    ctx.db.prepare("DELETE FROM line_items WHERE record_id = ? AND workspace_id = ?").bind(recordId, ctx.workspaceId),
    ...normalized.map((i) =>
      ctx.db.prepare("INSERT INTO line_items (id, workspace_id, record_id, position, product_id, description, quantity, price, discount, tax) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(i.id, ctx.workspaceId, recordId, i.position, i.productId, i.description, i.quantity, i.price, i.discount, i.tax)),
  ]);
  return { items: normalized, totals: sum };
}

defineTool({
  name: "set_line_items",
  title: "Set line items",
  description: "Replace all line items of a Quote, Sales Order, Purchase Order or Invoice. Recalculates and saves the grand total in `amount`.",
  authority: "write",
  input: z.object({ recordId: z.string(), items: z.array(lineItem).max(200) }),
  async run(ctx, { recordId, items }) {
    const row = await loadRow(ctx, recordId);
    if (!inventoryModules.includes(row.module as ModuleKey)) throw new AppError("invalid", `Line items only apply to ${inventoryModules.join(", ")}.`);
    const result = await writeLineItems(ctx, recordId, items);
    const record = await updateRecord(ctx, recordId, { amount: String(result.totals.total) }, { timelineTitle: "Line items updated" });
    return { record, ...result };
  },
});

async function convertDocument(ctx: ToolContext, sourceId: string, from: ModuleKey, to: ModuleKey, link: string, extra: Values) {
  const src = toDto(await loadRow(ctx, sourceId));
  if (src.module !== from) throw new AppError("invalid", `${sourceId} is not a ${moduleDefs[from].singular}.`);
  const items = await ctx.db.prepare("SELECT product_id AS productId, description, quantity, price, discount, tax FROM line_items WHERE record_id = ? ORDER BY position").bind(sourceId).all<z.infer<typeof lineItem>>();
  const v = src.values;
  const created = await createRecord(ctx, to, {
    subject: v.subject || v.quoteName || src.title,
    ...pick(v, { accountId: "accountId", contactId: "contactId", amount: "amount", description: "description" }),
    [link]: sourceId,
    ...extra,
  }, { timelineTitle: `Created from ${moduleDefs[from].singular} ${src.title}` });
  if (items.results.length) await writeLineItems(ctx, created.id, items.results);
  await timelineStmt(ctx, sourceId, "convert", `Converted to ${moduleDefs[to].singular}`, created.title).run();
  return created;
}

defineTool({
  name: "convert_quote_to_sales_order",
  title: "Quote → Sales Order",
  description: "Create a Sales Order from a Quote, copying account, contact and line items, and mark the quote Accepted.",
  authority: "write",
  input: z.object({ quoteId: z.string() }),
  async run(ctx, { quoteId }) {
    const order = await convertDocument(ctx, quoteId, "Quotes", "Sales Orders", "quoteId", { status: "Created" });
    await updateRecord(ctx, quoteId, { stage: "Accepted" }, { timelineTitle: "Quote accepted" });
    return order;
  },
});

defineTool({
  name: "convert_sales_order_to_invoice",
  title: "Sales Order → Invoice",
  description: "Create a Draft Invoice from a Sales Order, copying account, contact and line items.",
  authority: "write",
  input: z.object({ salesOrderId: z.string(), dueDate: z.string().optional() }),
  async run(ctx, { salesOrderId, dueDate }) {
    return convertDocument(ctx, salesOrderId, "Sales Orders", "Invoices", "salesOrderId", {
      status: "Draft",
      invoiceDate: nowIso().slice(0, 10),
      ...(dueDate ? { dueDate } : {}),
    });
  },
});

export { parseJson };
