/**
 * Endpoints used by the original Gallivanter UI (gallivanter.pages.dev).
 * That UI keeps whole collections in memory; it loads a snapshot once and then
 * pushes only the records that changed. Everything is stored in the same D1
 * tables the AI tools and Claude MCP use, with an audit entry per change.
 */
import type { ModuleKey, Values } from "../../src/crm/model.ts";
import type { ToolContext } from "./registry.ts";
import { assertModule, createRecord, setDeleted, timelineStmt, updateRecord } from "./records.ts";
import { AppError, newId, nowIso, parseJson, type Env } from "./util.ts";

export interface LegacyRecord {
  id: string;
  values: Values;
  tags?: string[];
  extra?: Record<string, unknown>;
  deletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** The user's personal workspace, created on first use. */
export async function personalWorkspace(env: Env, user: { id: string; name: string; email: string }): Promise<string> {
  const existing = await env.DB.prepare(
    `SELECT w.id FROM workspaces w JOIN members m ON m.workspace_id = w.id AND m.user_id = ?
     ORDER BY w.personal DESC, w.created_at LIMIT 1`,
  ).bind(user.id).first<{ id: string }>();
  if (existing) return existing.id;
  const id = newId("ws");
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO workspaces (id, name, owner_id, personal, created_at) VALUES (?,?,?,1,?)").bind(id, `${user.name || user.email}'s CRM`, user.id, now),
    env.DB.prepare("INSERT INTO members (workspace_id, user_id, role, created_at) VALUES (?,?, 'owner', ?)").bind(id, user.id, now),
    env.DB.prepare("INSERT INTO sheet_sync (workspace_id, status) VALUES (?, 'pending')").bind(id),
  ]);
  return id;
}

export async function snapshot(ctx: ToolContext) {
  const rows = await ctx.db
    .prepare("SELECT id, module, data, tags, extra, created_at, updated_at, deleted_at FROM records WHERE workspace_id = ? ORDER BY created_at DESC")
    .bind(ctx.workspaceId)
    .all<{ id: string; module: string; data: string; tags: string; extra: string; created_at: string; updated_at: string; deleted_at: string | null }>();
  const modules: Record<string, LegacyRecord[]> = {};
  let latest = "";
  for (const r of rows.results) {
    (modules[r.module] ??= []).push({
      id: r.id,
      values: parseJson<Values>(r.data, {}),
      tags: parseJson<string[]>(r.tags, []),
      extra: parseJson<Record<string, unknown>>(r.extra, {}),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      ...(r.deleted_at ? { deletedAt: r.deleted_at } : {}),
    });
    if (r.updated_at > latest) latest = r.updated_at;
  }
  const ws = await ctx.db.prepare("SELECT settings FROM workspaces WHERE id = ?").bind(ctx.workspaceId).first<{ settings: string }>();
  const settings = parseJson<Record<string, unknown>>(ws?.settings, {});
  return { workspaceId: ctx.workspaceId, role: ctx.role, modules, initialized: (settings.legacyInitialized as string[] | undefined) ?? [], cursor: latest };
}

/** Apply a batch of changed/removed records for one module. */
export async function syncCollection(ctx: ToolContext, moduleName: string, upserts: LegacyRecord[], deletes: string[]) {
  if (ctx.role === "viewer") throw new AppError("forbidden", "Viewers cannot change records.");
  const module: ModuleKey = assertModule(moduleName);
  if (upserts.length + deletes.length > 500) throw new AppError("invalid", "Too many changes in one request (max 500).");
  const results = { created: 0, updated: 0, deleted: 0, errors: [] as { id: string; error: string }[] };

  for (const rec of upserts) {
    try {
      if (!rec || typeof rec.id !== "string" || typeof rec.values !== "object") throw new AppError("invalid", "Each record needs an id and values.");
      const values = Object.fromEntries(Object.entries(rec.values).filter(([, v]) => typeof v === "string")) as Values;
      const existing = await ctx.db.prepare("SELECT workspace_id, module, data, deleted_at FROM records WHERE id = ?").bind(rec.id).first<{ workspace_id: string; module: string; data: string; deleted_at: string | null }>();
      if (existing && (existing.workspace_id !== ctx.workspaceId || existing.module !== module)) throw new AppError("conflict", `Record id ${rec.id} is already used elsewhere.`);
      if (!existing) {
        await createRecord(ctx, module, values, { id: rec.id, tags: rec.tags, lenient: true });
        results.created++;
      } else {
        // Full replacement: keys the UI removed are cleared.
        const current = parseJson<Values>(existing.data, {});
        const patch: Record<string, string | null> = { ...values };
        for (const k of Object.keys(current)) if (!(k in values)) patch[k] = null;
        await updateRecord(ctx, rec.id, patch, { tags: rec.tags, lenient: true });
        results.updated++;
      }
      if (rec.extra !== undefined) {
        const extra = JSON.stringify(rec.extra ?? {});
        if (extra.length > 200_000) throw new AppError("invalid", "Record extra data is too large.");
        await ctx.db.prepare("UPDATE records SET extra = ? WHERE id = ? AND workspace_id = ?").bind(extra, rec.id, ctx.workspaceId).run();
      }
      const wantDeleted = Boolean(rec.deletedAt);
      const isDeleted = existing ? Boolean(existing.deleted_at) : false;
      if (wantDeleted !== isDeleted) await setDeleted(ctx, rec.id, wantDeleted);
    } catch (e) {
      results.errors.push({ id: String(rec?.id), error: e instanceof Error ? e.message : String(e) });
    }
  }
  for (const id of deletes) {
    try {
      await setDeleted(ctx, id, true);
      results.deleted++;
    } catch (e) {
      results.errors.push({ id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  // Remember that this module now lives on the server, so the UI stops showing sample seeds for it.
  await ctx.db.prepare(
    `UPDATE workspaces SET settings = json_set(settings, '$.legacyInitialized',
       json((SELECT json_group_array(value) FROM (SELECT value FROM json_each(coalesce(json_extract(settings,'$.legacyInitialized'),'[]')) UNION SELECT ?))))
     WHERE id = ?`,
  ).bind(module, ctx.workspaceId).run();
  if (results.created + results.updated + results.deleted > 0 && upserts.length > 20) {
    await timelineStmt(ctx, null, "bulk_sync", `${module} synced`, `${results.created} created, ${results.updated} updated, ${results.deleted} deleted`).run();
  }
  return results;
}
