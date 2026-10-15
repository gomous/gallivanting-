import { z } from "zod";
import { fieldDefinition, moduleKeys } from "../../../src/crm/schema.ts";
import type { ModuleKey } from "../../../src/crm/model.ts";
import { defineTool, type ToolContext } from "../registry.ts";
import { searchRecords, type FilterRule } from "../records.ts";
import { AppError, newId, nowIso, parseJson } from "../util.ts";

const moduleEnum = z.enum(moduleKeys as [ModuleKey, ...ModuleKey[]]);
const rule = z.object({
  field: z.string(),
  operator: z.enum(["is", "is_not", "contains", "not_contains", "starts_with", "empty", "not_empty", "gt", "gte", "lt", "lte"]),
  value: z.string().optional(),
});

interface ReportSpec {
  module: ModuleKey;
  groupBy?: string;
  metric?: "count" | "sum" | "avg";
  metricField?: string;
  rules?: FilterRule[];
}

async function runReport(ctx: ToolContext, spec: ReportSpec) {
  // Build SQL pieces and their parameters together so placeholder order always matches.
  let group = { sql: "'All'", params: [] as unknown[] };
  if (spec.groupBy) {
    if (spec.groupBy === "ownerId") group = { sql: "owner_id", params: [] };
    else if (spec.groupBy === "createdMonth") group = { sql: "substr(created_at,1,7)", params: [] };
    else {
      if (!fieldDefinition(spec.module, spec.groupBy)) throw new AppError("invalid", `Unknown groupBy field "${spec.groupBy}".`);
      group = { sql: "json_extract(data, ?)", params: [`$."${spec.groupBy}"`] };
    }
  }
  let metric = { sql: "COUNT(*)", params: [] as unknown[] };
  if (spec.metric && spec.metric !== "count") {
    const def = spec.metricField ? fieldDefinition(spec.module, spec.metricField) : undefined;
    if (!def || def.type !== "number") throw new AppError("invalid", `metricField must be a numeric field of ${spec.module}.`);
    metric = { sql: `${spec.metric.toUpperCase()}(CAST(coalesce(json_extract(data, ?),0) AS REAL))`, params: [`$."${spec.metricField}"`] };
  }
  let ids = { sql: "", params: [] as unknown[] };
  if (spec.rules?.length) {
    const found = await searchRecords(ctx, { module: spec.module, rules: spec.rules, limit: 500 });
    if (!found.records.length) return { rows: [], total: 0 };
    ids = { sql: ` AND id IN (${found.records.map(() => "?").join(",")})`, params: found.records.map((r) => r.id) };
  }
  const sql = `SELECT ${group.sql} AS grp, ${metric.sql} AS value, COUNT(*) AS count FROM records
               WHERE workspace_id = ? AND module = ? AND deleted_at IS NULL${ids.sql}
               GROUP BY grp ORDER BY value DESC LIMIT 100`;
  const result = await ctx.db
    .prepare(sql)
    .bind(...group.params, ...metric.params, ctx.workspaceId, spec.module, ...ids.params)
    .all<{ grp: string | null; value: number; count: number }>();
  const rows = result.results.map((r) => ({ group: r.grp ?? "(empty)", value: Math.round((r.value ?? 0) * 100) / 100, count: r.count }));
  return { rows, total: rows.reduce((a, r) => a + r.count, 0) };
}

defineTool({
  name: "run_report",
  title: "Run a report",
  description: "Aggregate records of a module: group by a field (or ownerId / createdMonth) and count, sum or average a numeric field, with optional filters. E.g. leads by source, deal amount by stage.",
  authority: "read",
  input: z.object({
    module: moduleEnum,
    groupBy: z.string().optional(),
    metric: z.enum(["count", "sum", "avg"]).optional(),
    metricField: z.string().optional(),
    rules: z.array(rule).optional(),
  }),
  async run(ctx, input) {
    return runReport(ctx, input);
  },
});

defineTool({
  name: "save_report",
  title: "Save a report",
  description: "Save a report definition so it can be shown on dashboards.",
  authority: "write",
  input: z.object({
    name: z.string().min(1),
    module: moduleEnum,
    groupBy: z.string().optional(),
    metric: z.enum(["count", "sum", "avg"]).optional(),
    metricField: z.string().optional(),
    rules: z.array(rule).optional(),
  }),
  async run(ctx, input) {
    await runReport(ctx, input); // validates the spec
    const id = newId("rpt");
    await ctx.db.prepare("INSERT INTO reports (id, workspace_id, name, module, group_by, metric, metric_field, rules, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(id, ctx.workspaceId, input.name, input.module, input.groupBy ?? "", input.metric ?? "count", input.metricField ?? "", JSON.stringify(input.rules ?? []), ctx.userId, nowIso()).run();
    return { id, ...input };
  },
});

defineTool({
  name: "list_reports",
  title: "List saved reports and dashboards",
  description: "List saved reports and dashboards in this workspace.",
  authority: "read",
  input: z.object({}),
  async run(ctx) {
    const [reports, dashboards] = await ctx.db.batch([
      ctx.db.prepare("SELECT id, name, module, group_by AS groupBy, metric, metric_field AS metricField, rules FROM reports WHERE workspace_id = ? ORDER BY name").bind(ctx.workspaceId),
      ctx.db.prepare("SELECT id, name, report_ids AS reportIds FROM dashboards WHERE workspace_id = ? ORDER BY name").bind(ctx.workspaceId),
    ]);
    return {
      reports: (reports.results as Record<string, string>[]).map((r) => ({ ...r, rules: parseJson(r.rules, []) })),
      dashboards: (dashboards.results as Record<string, string>[]).map((d) => ({ ...d, reportIds: parseJson(d.reportIds, []) })),
    };
  },
});

defineTool({
  name: "delete_report",
  title: "Delete a saved report",
  description: "Delete a saved report.",
  authority: "destructive",
  input: z.object({ reportId: z.string() }),
  async run(ctx, { reportId }) {
    const r = await ctx.db.prepare("DELETE FROM reports WHERE id = ? AND workspace_id = ?").bind(reportId, ctx.workspaceId).run();
    return { deleted: r.meta.changes > 0 };
  },
});

defineTool({
  name: "save_dashboard",
  title: "Create or update a dashboard",
  description: "Create a dashboard (or update it when id is given) from saved report ids.",
  authority: "write",
  input: z.object({ id: z.string().optional(), name: z.string().min(1), reportIds: z.array(z.string()).max(20) }),
  async run(ctx, { id, name, reportIds }) {
    const dashId = id ?? newId("dash");
    await ctx.db.prepare(
      `INSERT INTO dashboards (id, workspace_id, name, report_ids, created_at) VALUES (?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, report_ids = excluded.report_ids WHERE dashboards.workspace_id = excluded.workspace_id`,
    ).bind(dashId, ctx.workspaceId, name, JSON.stringify(reportIds), nowIso()).run();
    return { id: dashId, name, reportIds };
  },
});

defineTool({
  name: "dashboard_summary",
  title: "Home dashboard numbers",
  description: "Key numbers for the home screen: open leads, open deals and pipeline value, overdue tasks, records created this month, and saved-dashboard report results when dashboardId is given.",
  authority: "read",
  input: z.object({ dashboardId: z.string().optional() }),
  async run(ctx, { dashboardId }) {
    const today = nowIso().slice(0, 10);
    const month = today.slice(0, 7);
    const one = (sql: string, ...p: unknown[]) => ctx.db.prepare(sql).bind(ctx.workspaceId, ...p);
    const [leads, deals, overdue, created] = await ctx.db.batch([
      one("SELECT COUNT(*) AS n FROM records WHERE workspace_id = ? AND module = 'Leads' AND deleted_at IS NULL AND converted_to IS NULL AND coalesce(json_extract(data,'$.status'),'') NOT IN ('Junk Lead','Lost Lead','Not Qualified','Converted')"),
      one("SELECT COUNT(*) AS n, SUM(CAST(coalesce(json_extract(data,'$.amount'),0) AS REAL)) AS amount FROM records WHERE workspace_id = ? AND module = 'Deals' AND deleted_at IS NULL AND coalesce(json_extract(data,'$.stage'),'') NOT LIKE 'Closed%'"),
      one("SELECT COUNT(*) AS n FROM records WHERE workspace_id = ? AND module = 'Tasks' AND deleted_at IS NULL AND coalesce(json_extract(data,'$.status'),'') <> 'Completed' AND json_extract(data,'$.dueDate') < ?", today),
      one("SELECT COUNT(*) AS n FROM records WHERE workspace_id = ? AND deleted_at IS NULL AND substr(created_at,1,7) = ?", month),
    ]);
    const first = (r: D1Result) => r.results[0] as { n: number; amount?: number };
    let reports: unknown[] = [];
    if (dashboardId) {
      const dash = await ctx.db.prepare("SELECT report_ids FROM dashboards WHERE id = ? AND workspace_id = ?").bind(dashboardId, ctx.workspaceId).first<{ report_ids: string }>();
      const ids = parseJson<string[]>(dash?.report_ids, []);
      for (const id of ids) {
        const r = await ctx.db.prepare("SELECT * FROM reports WHERE id = ? AND workspace_id = ?").bind(id, ctx.workspaceId).first<Record<string, string>>();
        if (!r) continue;
        reports.push({ id, name: r.name, ...(await runReport(ctx, { module: r.module as ModuleKey, groupBy: r.group_by || undefined, metric: r.metric as "count", metricField: r.metric_field || undefined, rules: parseJson(r.rules, []) })) });
      }
    }
    return {
      openLeads: first(leads).n,
      openDeals: first(deals).n,
      pipelineAmount: first(deals).amount ?? 0,
      overdueTasks: first(overdue).n,
      createdThisMonth: first(created).n,
      reports,
    };
  },
});

// ---------- saved views ----------

defineTool({
  name: "save_view",
  title: "Save a list view",
  description: "Save (or update when id is given) a filtered list view for a module.",
  authority: "write",
  input: z.object({
    id: z.string().optional(),
    module: moduleEnum,
    name: z.string().min(1),
    rules: z.array(rule).optional(),
    match: z.enum(["all", "any"]).optional(),
    columns: z.array(z.string()).optional(),
    sort: z.string().optional().describe("field:asc or field:desc"),
  }),
  async run(ctx, v) {
    await searchRecords(ctx, { module: v.module, rules: v.rules, match: v.match, limit: 1 }); // validates rules
    const id = v.id ?? newId("view");
    await ctx.db.prepare(
      `INSERT INTO views (id, workspace_id, module, name, rules, match, columns, sort, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, rules = excluded.rules, match = excluded.match, columns = excluded.columns, sort = excluded.sort
       WHERE views.workspace_id = excluded.workspace_id`,
    ).bind(id, ctx.workspaceId, v.module, v.name, JSON.stringify(v.rules ?? []), v.match ?? "all", JSON.stringify(v.columns ?? []), v.sort ?? "", ctx.userId, nowIso()).run();
    return { id, ...v };
  },
});

defineTool({
  name: "list_views",
  title: "List saved views",
  description: "List saved list views, optionally for one module.",
  authority: "read",
  input: z.object({ module: moduleEnum.optional() }),
  async run(ctx, { module }) {
    const rows = await ctx.db.prepare(`SELECT * FROM views WHERE workspace_id = ?${module ? " AND module = ?" : ""} ORDER BY name`)
      .bind(...(module ? [ctx.workspaceId, module] : [ctx.workspaceId])).all<Record<string, string>>();
    return rows.results.map((r) => ({ id: r.id, module: r.module, name: r.name, rules: parseJson(r.rules, []), match: r.match, columns: parseJson(r.columns, []), sort: r.sort }));
  },
});

defineTool({
  name: "delete_view",
  title: "Delete a saved view",
  description: "Delete a saved list view.",
  authority: "destructive",
  input: z.object({ viewId: z.string() }),
  async run(ctx, { viewId }) {
    const r = await ctx.db.prepare("DELETE FROM views WHERE id = ? AND workspace_id = ?").bind(viewId, ctx.workspaceId).run();
    return { deleted: r.meta.changes > 0 };
  },
});
