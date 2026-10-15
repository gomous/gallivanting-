/**
 * One-way copy of each workspace into a Google Sheet in the owner's Drive.
 * D1 is the source of truth; the Sheet is a read-only mirror for the user.
 * Each run rewrites only the tabs of modules that changed since the last sync,
 * using two batched requests (clear + update), so quota use stays tiny.
 */
import type { ModuleKey, Values } from "../../src/crm/model.ts";
import { moduleDefs, moduleKeys } from "../../src/crm/schema.ts";
import { googleAccessToken } from "./auth.ts";
import { nowIso, parseJson, type Env } from "./util.ts";

const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const MAX_WORKSPACES_PER_RUN = 10;

async function google<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`Google API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

/** Tab title for a module (Sheets disallows some characters; module names are safe). */
const tab = (m: ModuleKey) => m;

async function createSpreadsheet(token: string, workspaceName: string): Promise<string> {
  const body = {
    properties: { title: `Gallivanter – ${workspaceName}` },
    sheets: [
      { properties: { title: "About", index: 0 } },
      ...moduleKeys.map((m, i) => ({ properties: { title: tab(m), index: i + 1, gridProperties: { frozenRowCount: 1 } } })),
    ],
  };
  const created = await google<{ spreadsheetId: string; sheets: { properties: { sheetId: number } }[] }>(token, SHEETS, { method: "POST", body: JSON.stringify(body) });
  // Warn anyone who edits by hand: this is a read-only copy.
  await google(token, `${SHEETS}/${created.spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: created.sheets.map((s) => ({
        addProtectedRange: { protectedRange: { range: { sheetId: s.properties.sheetId }, warningOnly: true, description: "Read-only copy – edit in Gallivanter" } },
      })),
    }),
  });
  await google(token, `${SHEETS}/${created.spreadsheetId}/values/About!A1:A4?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({
      values: [
        ["This spreadsheet is an automatic, read-only copy of your Gallivanter CRM."],
        ["Edit your data in the Gallivanter app; changes appear here within a few minutes."],
        ["Edits made here are NOT copied back and will be overwritten."],
        [`Created ${nowIso()}`],
      ],
    }),
  });
  return created.spreadsheetId;
}

function moduleRows(module: ModuleKey, rows: { id: string; data: string; tags: string; created_at: string; updated_at: string }[]): string[][] {
  const fields = moduleDefs[module].fields;
  const header = ["Record ID", ...fields.map((f) => f.label), "Tags", "Created", "Updated"];
  const body = rows.map((r) => {
    const v = parseJson<Values>(r.data, {});
    return [r.id, ...fields.map((f) => v[f.key] ?? ""), parseJson<string[]>(r.tags, []).join(", "), r.created_at, r.updated_at];
  });
  return [header, ...body];
}

export async function syncWorkspaceSheet(env: Env, workspaceId: string): Promise<{ workspaceId: string; modules: string[] }> {
  const ws = await env.DB.prepare(
    `SELECT w.id, w.name, w.owner_id, w.sheet_id, coalesce(s.last_synced_at,'') AS last FROM workspaces w LEFT JOIN sheet_sync s ON s.workspace_id = w.id WHERE w.id = ?`,
  ).bind(workspaceId).first<{ id: string; name: string; owner_id: string; sheet_id: string; last: string }>();
  if (!ws) throw new Error("Workspace not found");
  const startedAt = nowIso();
  const changed = await env.DB.prepare("SELECT DISTINCT module FROM records WHERE workspace_id = ? AND updated_at > ?").bind(workspaceId, ws.last).all<{ module: ModuleKey }>();
  const modules = changed.results.map((r) => r.module).filter((m) => moduleKeys.includes(m));
  if (!modules.length && ws.sheet_id) {
    await env.DB.prepare("UPDATE sheet_sync SET status = 'ok', error = '' WHERE workspace_id = ?").bind(workspaceId).run();
    return { workspaceId, modules: [] };
  }
  try {
    const token = await googleAccessToken(env, ws.owner_id);
    let sheetId = ws.sheet_id;
    if (!sheetId) {
      sheetId = await createSpreadsheet(token, ws.name);
      await env.DB.prepare("UPDATE workspaces SET sheet_id = ? WHERE id = ?").bind(sheetId, workspaceId).run();
    }
    if (modules.length) {
      const data = [];
      for (const module of modules) {
        const rows = await env.DB.prepare("SELECT id, data, tags, created_at, updated_at FROM records WHERE workspace_id = ? AND module = ? AND deleted_at IS NULL ORDER BY created_at")
          .bind(workspaceId, module).all<{ id: string; data: string; tags: string; created_at: string; updated_at: string }>();
        data.push({ range: `'${tab(module)}'!A1`, values: moduleRows(module, rows.results) });
      }
      await google(token, `${SHEETS}/${sheetId}/values:batchClear`, { method: "POST", body: JSON.stringify({ ranges: modules.map((m) => `'${tab(m)}'`) }) });
      await google(token, `${SHEETS}/${sheetId}/values:batchUpdate`, { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data }) });
    }
    await env.DB.prepare("INSERT INTO sheet_sync (workspace_id, last_synced_at, status, error) VALUES (?,?, 'ok', '') ON CONFLICT(workspace_id) DO UPDATE SET last_synced_at = excluded.last_synced_at, status = 'ok', error = ''")
      .bind(workspaceId, startedAt).run();
    return { workspaceId, modules };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await env.DB.prepare("INSERT INTO sheet_sync (workspace_id, status, error) VALUES (?, 'error', ?) ON CONFLICT(workspace_id) DO UPDATE SET status = 'error', error = excluded.error")
      .bind(workspaceId, message.slice(0, 500)).run();
    throw e;
  }
}

/** Sync one workspace, or (cron) the workspaces with the oldest pending changes. */
export async function syncAllSheets(env: Env, onlyWorkspaceId?: string) {
  const ids = onlyWorkspaceId
    ? [onlyWorkspaceId]
    : (
        await env.DB.prepare(
          `SELECT w.id FROM workspaces w LEFT JOIN sheet_sync s ON s.workspace_id = w.id
           WHERE EXISTS (SELECT 1 FROM records r WHERE r.workspace_id = w.id AND r.updated_at > coalesce(s.last_synced_at,''))
           ORDER BY coalesce(s.last_synced_at,'') LIMIT ?`,
        ).bind(MAX_WORKSPACES_PER_RUN).all<{ id: string }>()
      ).results.map((r) => r.id);
  const results = [];
  for (const id of ids) {
    try {
      results.push({ ok: true, ...(await syncWorkspaceSheet(env, id)) });
    } catch (e) {
      results.push({ ok: false, workspaceId: id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { synced: results };
}
