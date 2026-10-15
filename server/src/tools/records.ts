import { z } from "zod";
import { moduleDefs, moduleKeys } from "../../../src/crm/schema.ts";
import type { ModuleKey } from "../../../src/crm/model.ts";
import { defineTool } from "../registry.ts";
import { assertModule, createRecord, loadRow, searchRecords, setDeleted, toDto, updateRecord, type RecordDto } from "../records.ts";
import { parseJson } from "../util.ts";

const moduleEnum = z.enum(moduleKeys as [ModuleKey, ...ModuleKey[]]);
const values = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));
const rule = z.object({
  field: z.string().describe("Field key from describe_module, or title/createdAt/updatedAt/ownerId/tags"),
  operator: z.enum(["is", "is_not", "contains", "not_contains", "starts_with", "empty", "not_empty", "gt", "gte", "lt", "lte"]),
  value: z.string().optional(),
});

defineTool({
  name: "list_modules",
  title: "List CRM modules",
  description: "List all CRM modules (Leads, Contacts, Deals, ...) with their record counts. Call this first if unsure which module to use.",
  authority: "read",
  input: z.object({}),
  async run(ctx) {
    const counts = await ctx.db
      .prepare("SELECT module, COUNT(*) AS n FROM records WHERE workspace_id = ? AND deleted_at IS NULL GROUP BY module")
      .bind(ctx.workspaceId)
      .all<{ module: string; n: number }>();
    const byModule = new Map(counts.results.map((r) => [r.module, r.n]));
    return moduleKeys.map((key) => ({
      module: key,
      singular: moduleDefs[key].singular,
      titleField: moduleDefs[key].titleField,
      records: byModule.get(key) ?? 0,
      stages: moduleDefs[key].stages,
    }));
  },
});

defineTool({
  name: "describe_module",
  title: "Describe a module's fields",
  description: "Get every field of a module: key, label, type, allowed options, whether required, and which module a lookup points to. Use before creating or filtering records.",
  authority: "read",
  input: z.object({ module: moduleEnum }),
  async run(_ctx, { module }) {
    const def = moduleDefs[module];
    return {
      module,
      singular: def.singular,
      titleField: def.titleField,
      stages: def.stages,
      related: def.related,
      fields: def.fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type ?? "text",
        required: Boolean(f.required),
        options: f.options,
        lookupModule: f.lookup,
      })),
    };
  },
});

defineTool({
  name: "search_records",
  title: "Search records",
  description: "Find records by free-text query and/or field filters. Returns up to `limit` records (default 25) plus the total count. Omit module to search across all modules.",
  authority: "read",
  input: z.object({
    module: moduleEnum.optional(),
    query: z.string().optional().describe("Free text matched against all field values"),
    rules: z.array(rule).optional(),
    match: z.enum(["all", "any"]).optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().min(0).optional(),
    deletedOnly: z.boolean().optional().describe("true = list the recycle bin"),
  }),
  async run(ctx, input) {
    return searchRecords(ctx, { ...input, limit: input.limit ?? 25 });
  },
});

defineTool({
  name: "get_record",
  title: "Get a record with context",
  description: "Get one record with its notes, recent timeline, linked records, line items, and records that reference it via lookup fields.",
  authority: "read",
  input: z.object({ id: z.string() }),
  async run(ctx, { id }) {
    const record = toDto(await loadRow(ctx, id, true));
    const [notes, timeline, links, items, referencing] = await ctx.db.batch([
      ctx.db.prepare("SELECT id, text, author_id AS authorId, created_at AS createdAt FROM notes WHERE record_id = ? AND workspace_id = ? ORDER BY created_at DESC LIMIT 50").bind(id, ctx.workspaceId),
      ctx.db.prepare("SELECT id, action, title, detail, actor_id AS actorId, source, at FROM timeline WHERE record_id = ? AND workspace_id = ? ORDER BY at DESC LIMIT 30").bind(id, ctx.workspaceId),
      ctx.db.prepare(
        `SELECT r.id, r.module, r.title FROM record_links l JOIN records r ON r.id = CASE WHEN l.from_id = ? THEN l.to_id ELSE l.from_id END
         WHERE (l.from_id = ? OR l.to_id = ?) AND l.workspace_id = ? AND r.deleted_at IS NULL`,
      ).bind(id, id, id, ctx.workspaceId),
      ctx.db.prepare("SELECT id, product_id AS productId, description, quantity, price, discount, tax FROM line_items WHERE record_id = ? AND workspace_id = ? ORDER BY position").bind(id, ctx.workspaceId),
      ctx.db.prepare(
        `SELECT r.id, r.module, r.title FROM records r, json_each(r.data) j
         WHERE r.workspace_id = ? AND r.deleted_at IS NULL AND j.value = ? AND r.id <> ? LIMIT 100`,
      ).bind(ctx.workspaceId, id, id),
    ]);
    return {
      record,
      notes: notes.results,
      timeline: timeline.results,
      linked: links.results,
      lineItems: items.results,
      referencedBy: referencing.results,
    };
  },
});

defineTool({
  name: "create_record",
  title: "Create a record",
  description: "Create a record in any module. `values` uses field keys from describe_module; lookup fields take a record id. Required fields must be present.",
  authority: "write",
  input: z.object({
    module: moduleEnum,
    values,
    tags: z.array(z.string()).optional(),
    ownerId: z.string().optional().describe("User id of a workspace member; defaults to you"),
  }),
  async run(ctx, { module, values: v, tags, ownerId }) {
    return createRecord(ctx, module, v, { tags, ownerId });
  },
});

defineTool({
  name: "update_record",
  title: "Update a record",
  description: "Change some fields of a record. Only the fields you pass change; pass null or \"\" to clear a field. Pass expectedVersion to avoid overwriting someone else's change.",
  authority: "write",
  input: z.object({
    id: z.string(),
    values: values.optional(),
    tags: z.array(z.string()).optional().describe("Replaces the full tag list"),
    ownerId: z.string().optional(),
    expectedVersion: z.number().int().optional(),
  }),
  async run(ctx, { id, values: v, tags, ownerId, expectedVersion }) {
    return updateRecord(ctx, id, v ?? {}, { tags, ownerId, expectedVersion });
  },
});

defineTool({
  name: "delete_record",
  title: "Delete a record",
  description: "Move a record to the recycle bin. It can be restored with restore_record.",
  authority: "destructive",
  input: z.object({ id: z.string() }),
  async run(ctx, { id }) {
    return setDeleted(ctx, id, true);
  },
});

defineTool({
  name: "restore_record",
  title: "Restore a record",
  description: "Restore a record from the recycle bin.",
  authority: "write",
  input: z.object({ id: z.string() }),
  async run(ctx, { id }) {
    return setDeleted(ctx, id, false);
  },
});

defineTool({
  name: "bulk_create_records",
  title: "Create many records",
  description: "Create up to 100 records in one module (e.g. from an import). Returns created records and per-row errors; valid rows are saved even if others fail.",
  authority: "write",
  input: z.object({ module: moduleEnum, rows: z.array(values).min(1).max(100) }),
  async run(ctx, { module, rows }) {
    const created: RecordDto[] = [];
    const errors: { row: number; error: string }[] = [];
    for (const [index, row] of rows.entries()) {
      try {
        created.push(await createRecord(ctx, module, row, { timelineTitle: "Imported" }));
      } catch (e) {
        errors.push({ row: index, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return { created: created.length, errors, records: created.map((r) => ({ id: r.id, title: r.title })) };
  },
});

defineTool({
  name: "tag_records",
  title: "Add or remove tags",
  description: "Add and/or remove tags on one or more records.",
  authority: "write",
  input: z.object({
    ids: z.array(z.string()).min(1).max(100),
    add: z.array(z.string()).optional(),
    remove: z.array(z.string()).optional(),
  }),
  async run(ctx, { ids, add = [], remove = [] }) {
    const out = [];
    for (const id of ids) {
      const row = await loadRow(ctx, id);
      const current = parseJson<string[]>(row.tags, []);
      const removeSet = new Set(remove.map((t) => t.toLowerCase()));
      const next = [...current.filter((t) => !removeSet.has(t.toLowerCase())), ...add];
      const updated = await updateRecord(ctx, id, {}, { tags: next, timelineTitle: "Tags changed" });
      out.push({ id, tags: updated.tags });
    }
    return out;
  },
});

export { assertModule };
