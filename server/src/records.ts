/** Data access for CRM records in D1. Reuses validation from src/crm. */
import type { ModuleKey, Values } from "../../src/crm/model.ts";
import { fieldDefinition, moduleDefs, moduleKeys, recordTitle } from "../../src/crm/schema.ts";
import { validateValues } from "../../src/crm/engine.ts";
import type { ToolContext } from "./registry.ts";
import { AppError, newId, nowIso, parseJson } from "./util.ts";

export interface RecordRow {
  id: string;
  workspace_id: string;
  module: string;
  title: string;
  data: string;
  tags: string;
  converted_to: string | null;
  owner_id: string | null;
  version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface RecordDto {
  id: string;
  module: ModuleKey;
  title: string;
  values: Values;
  tags: string[];
  ownerId: string | null;
  version: number;
  convertedTo: Record<string, string> | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export function toDto(row: RecordRow): RecordDto {
  return {
    id: row.id,
    module: row.module as ModuleKey,
    title: row.title,
    values: parseJson<Values>(row.data, {}),
    tags: parseJson<string[]>(row.tags, []),
    ownerId: row.owner_id,
    version: row.version,
    convertedTo: parseJson<Record<string, string> | null>(row.converted_to, null),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export function assertModule(module: string): ModuleKey {
  if (!moduleKeys.includes(module as ModuleKey)) {
    throw new AppError("invalid", `Unknown module "${module}". Valid modules: ${moduleKeys.join(", ")}.`);
  }
  return module as ModuleKey;
}

function computeTitle(module: ModuleKey, values: Values, id: string): string {
  return recordTitle({ id, module, values, createdAt: "", updatedAt: "", tags: [], notes: [], timeline: [], links: [], lineItems: [] });
}

function searchText(title: string, values: Values, tags: string[]): string {
  return [title, ...Object.values(values), ...tags].join(" ").toLowerCase().slice(0, 4000);
}

/** Drop empty strings, coerce non-strings, and validate against the module schema. */
function cleanValues(module: ModuleKey, values: Record<string, unknown>): Values {
  const out: Values = {};
  for (const [key, raw] of Object.entries(values)) {
    if (raw === null || raw === undefined) continue;
    const text = typeof raw === "string" ? raw : typeof raw === "boolean" ? String(raw) : String(raw);
    out[key] = text;
  }
  return out;
}

async function assertLookups(ctx: ToolContext, module: ModuleKey, values: Values): Promise<void> {
  for (const [key, value] of Object.entries(values)) {
    const def = fieldDefinition(module, key);
    if (def?.type !== "lookup" || !def.lookup || !value) continue;
    const found = await ctx.db
      .prepare("SELECT module FROM records WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL")
      .bind(value, ctx.workspaceId)
      .first<{ module: string }>();
    if (!found || found.module !== def.lookup) {
      throw new AppError("invalid", `${def.label}: "${value}" is not an existing ${def.lookup} record id.`);
    }
  }
}

async function assertOwner(ctx: ToolContext, ownerId: string | undefined): Promise<string | undefined> {
  if (!ownerId) return undefined;
  const member = await ctx.db
    .prepare("SELECT user_id FROM members WHERE workspace_id = ? AND user_id = ?")
    .bind(ctx.workspaceId, ownerId)
    .first();
  if (!member) throw new AppError("invalid", `Owner "${ownerId}" is not a member of this workspace.`);
  return ownerId;
}

export function timelineStmt(
  ctx: ToolContext,
  recordId: string | null,
  action: string,
  title: string,
  detail = "",
): D1PreparedStatement {
  return ctx.db
    .prepare("INSERT INTO timeline (id, workspace_id, record_id, action, title, detail, actor_id, source, at) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(newId("tl"), ctx.workspaceId, recordId, action, title, detail, ctx.userId, ctx.source, nowIso());
}

export async function loadRow(ctx: ToolContext, id: string, includeDeleted = false): Promise<RecordRow> {
  const row = await ctx.db
    .prepare(`SELECT * FROM records WHERE id = ? AND workspace_id = ?${includeDeleted ? "" : " AND deleted_at IS NULL"}`)
    .bind(id, ctx.workspaceId)
    .first<RecordRow>();
  if (!row) throw new AppError("not_found", `Record ${id} was not found${includeDeleted ? "" : " (it may be deleted)"}.`);
  return row;
}

export async function createRecord(
  ctx: ToolContext,
  module: ModuleKey,
  rawValues: Record<string, unknown>,
  opts: { tags?: string[]; ownerId?: string; timelineTitle?: string } = {},
): Promise<RecordDto> {
  const values = cleanValues(module, rawValues);
  const errors = validateValues(module, values);
  if (errors.length) throw new AppError("invalid", errors.join(" "), { errors });
  await assertLookups(ctx, module, values);
  const ownerId = (await assertOwner(ctx, opts.ownerId)) ?? ctx.userId;
  const id = newId(moduleDefs[module].singular.toLowerCase().replace(/\s+/g, ""));
  const title = computeTitle(module, values, id);
  const tags = [...new Set((opts.tags ?? []).map((t) => t.trim()).filter(Boolean))];
  const now = nowIso();
  await ctx.db.batch([
    ctx.db
      .prepare(
        `INSERT INTO records (id, workspace_id, module, title, data, tags, search, owner_id, version, created_by, updated_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,1,?,?,?,?)`,
      )
      .bind(id, ctx.workspaceId, module, title, JSON.stringify(values), JSON.stringify(tags), searchText(title, values, tags), ownerId, ctx.userId, ctx.userId, now, now),
    timelineStmt(ctx, id, "create", opts.timelineTitle ?? `${moduleDefs[module].singular} created`, title),
  ]);
  return toDto(await loadRow(ctx, id));
}

export async function updateRecord(
  ctx: ToolContext,
  id: string,
  patch: Record<string, unknown>,
  opts: { expectedVersion?: number; tags?: string[]; ownerId?: string; timelineTitle?: string } = {},
): Promise<RecordDto> {
  const row = await loadRow(ctx, id);
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== row.version) {
    throw new AppError("conflict", `Record ${id} was changed by someone else (version ${row.version}, you had ${opts.expectedVersion}). Reload and try again.`, { current: toDto(row) });
  }
  const module = row.module as ModuleKey;
  const current = parseJson<Values>(row.data, {});
  const merged: Values = { ...current };
  for (const [key, raw] of Object.entries(patch)) {
    if (raw === null || raw === "") delete merged[key];
    else merged[key] = typeof raw === "string" ? raw : String(raw);
  }
  const errors = validateValues(module, merged);
  if (errors.length) throw new AppError("invalid", errors.join(" "), { errors });
  await assertLookups(ctx, module, merged);
  const ownerId = opts.ownerId !== undefined ? await assertOwner(ctx, opts.ownerId) : row.owner_id;
  const tags = opts.tags ? [...new Set(opts.tags.map((t) => t.trim()).filter(Boolean))] : parseJson<string[]>(row.tags, []);
  const title = computeTitle(module, merged, id);
  const changed = Object.keys(patch).filter((k) => (current[k] ?? "") !== (merged[k] ?? ""));
  const now = nowIso();
  const result = await ctx.db.batch([
    ctx.db
      .prepare(
        `UPDATE records SET title = ?, data = ?, tags = ?, search = ?, owner_id = ?, version = version + 1, updated_by = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ? AND version = ?`,
      )
      .bind(title, JSON.stringify(merged), JSON.stringify(tags), searchText(title, merged, tags), ownerId, ctx.userId, now, id, ctx.workspaceId, row.version),
    timelineStmt(ctx, id, "update", opts.timelineTitle ?? `${moduleDefs[module].singular} updated`, changed.length ? `Changed: ${changed.join(", ")}` : ""),
  ]);
  if (!result[0].meta.changes) throw new AppError("conflict", `Record ${id} was changed at the same time. Reload and try again.`);
  return toDto(await loadRow(ctx, id));
}

export async function setDeleted(ctx: ToolContext, id: string, deleted: boolean): Promise<RecordDto> {
  const row = await loadRow(ctx, id, true);
  if (Boolean(row.deleted_at) === deleted) return toDto(row);
  const now = nowIso();
  await ctx.db.batch([
    ctx.db
      .prepare("UPDATE records SET deleted_at = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ? AND workspace_id = ?")
      .bind(deleted ? now : null, ctx.userId, now, id, ctx.workspaceId),
    timelineStmt(ctx, id, deleted ? "delete" : "restore", deleted ? "Moved to recycle bin" : "Restored from recycle bin", row.title),
  ]);
  return toDto(await loadRow(ctx, id, true));
}

// ---------- search / filtering ----------

export type Operator =
  | "is" | "is_not" | "contains" | "not_contains" | "starts_with"
  | "empty" | "not_empty" | "gt" | "gte" | "lt" | "lte";

export interface FilterRule {
  field: string;
  operator: Operator;
  value?: string;
}

const builtinColumns: Record<string, string> = {
  title: "title",
  createdAt: "created_at",
  updatedAt: "updated_at",
  ownerId: "owner_id",
};

/** Turn a rule into a parameterised SQL fragment. Field names are whitelisted. */
function ruleSql(module: ModuleKey, rule: FilterRule): { sql: string; params: unknown[] } {
  let expr: string;
  const params: unknown[] = [];
  let numeric = false;
  if (rule.field === "tags") {
    expr = "lower(tags)";
  } else if (builtinColumns[rule.field]) {
    expr = builtinColumns[rule.field];
  } else {
    const def = fieldDefinition(module, rule.field);
    if (!def) throw new AppError("invalid", `Unknown field "${rule.field}" for ${module}. Use describe_module to see fields.`);
    expr = "json_extract(data, ?)";
    params.push(`$."${rule.field}"`);
    numeric = def.type === "number";
  }
  const v = (rule.value ?? "").trim();
  const lower = v.toLowerCase();
  const cmp = (op: string) => {
    if (numeric) return { sql: `CAST(${expr} AS REAL) ${op} ?`, params: [...params, Number(v)] };
    return { sql: `${expr} ${op} ?`, params: [...params, v] };
  };
  switch (rule.operator) {
    case "is": return { sql: `lower(coalesce(${expr},'')) = ?`, params: [...params, lower] };
    case "is_not": return { sql: `lower(coalesce(${expr},'')) <> ?`, params: [...params, lower] };
    case "contains": return { sql: `lower(coalesce(${expr},'')) LIKE ?`, params: [...params, `%${lower}%`] };
    case "not_contains": return { sql: `lower(coalesce(${expr},'')) NOT LIKE ?`, params: [...params, `%${lower}%`] };
    case "starts_with": return { sql: `lower(coalesce(${expr},'')) LIKE ?`, params: [...params, `${lower}%`] };
    case "empty": return { sql: `coalesce(${expr},'') = ''`, params };
    case "not_empty": return { sql: `coalesce(${expr},'') <> ''`, params };
    case "gt": return cmp(">");
    case "gte": return cmp(">=");
    case "lt": return cmp("<");
    case "lte": return cmp("<=");
  }
}

export interface SearchOptions {
  module?: ModuleKey;
  query?: string;
  rules?: FilterRule[];
  match?: "all" | "any";
  sortField?: string;
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
  deletedOnly?: boolean;
}

export async function searchRecords(ctx: ToolContext, opts: SearchOptions): Promise<{ records: RecordDto[]; total: number }> {
  const where: string[] = ["workspace_id = ?"];
  const params: unknown[] = [ctx.workspaceId];
  if (opts.deletedOnly) where.push("deleted_at IS NOT NULL");
  else if (!opts.includeDeleted) where.push("deleted_at IS NULL");
  if (opts.module) {
    where.push("module = ?");
    params.push(opts.module);
  }
  if (opts.query?.trim()) {
    for (const word of opts.query.trim().toLowerCase().split(/\s+/).slice(0, 6)) {
      where.push("search LIKE ?");
      params.push(`%${word}%`);
    }
  }
  if (opts.rules?.length) {
    if (!opts.module) throw new AppError("invalid", "Filtering by field rules requires a module.");
    const parts = opts.rules.map((r) => ruleSql(opts.module!, r));
    where.push(`(${parts.map((p) => p.sql).join(opts.match === "any" ? " OR " : " AND ")})`);
    for (const p of parts) params.push(...p.params);
  }
  let order = "updated_at DESC";
  if (opts.sortField) {
    const dir = opts.sortDir === "asc" ? "ASC" : "DESC";
    if (builtinColumns[opts.sortField]) order = `${builtinColumns[opts.sortField]} ${dir}`;
    else if (opts.module && fieldDefinition(opts.module, opts.sortField)) {
      const numeric = fieldDefinition(opts.module, opts.sortField)?.type === "number";
      order = numeric ? `CAST(json_extract(data, ?) AS REAL) ${dir}` : `json_extract(data, ?) ${dir}`;
    } else throw new AppError("invalid", `Cannot sort by "${opts.sortField}".`);
  }
  const orderParams = order.includes("?") ? [`$."${opts.sortField}"`] : [];
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const whereSql = where.join(" AND ");
  const [rows, count] = await ctx.db.batch([
    ctx.db.prepare(`SELECT * FROM records WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...params, ...orderParams, limit, offset),
    ctx.db.prepare(`SELECT COUNT(*) AS n FROM records WHERE ${whereSql}`).bind(...params),
  ]);
  return {
    records: (rows.results as unknown as RecordRow[]).map(toDto),
    total: (count.results[0] as { n: number }).n,
  };
}
