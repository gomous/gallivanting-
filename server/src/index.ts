import { Hono, type Context, type Next } from "hono";
import { currentUser, finishGoogleLogin, logout, startGoogleLogin, SESSION_COOKIE, type SessionUser } from "./auth.ts";
import { invokeTool, toolManifest, type Role, type ToolContext } from "./registry.ts";
import { AppError, newId, nowIso, randomToken, sha256, type Env } from "./util.ts";
import { syncAllSheets } from "./sheets.ts";
import { personalWorkspace, snapshot, syncCollection, type LegacyRecord } from "./legacy.ts";
import { apiKeys, chat, listModels, type AiEnv, type ChatMessage } from "./ai.ts";
// Importing the tool modules registers every tool.
import "./tools/records.ts";
import "./tools/activities.ts";
import "./tools/sales.ts";
import "./tools/insight.ts";
import "./tools/workspace.ts";

type Vars = { user: SessionUser };
type App = { Bindings: Env & { DEV_LOGIN?: string }; Variables: Vars };

const app = new Hono<App>();

app.onError((err, c) => {
  if (err instanceof AppError) return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status as 400);
  console.error(err);
  return c.json({ error: { code: "internal", message: err instanceof Error ? err.message : "Internal error" } }, 500);
});

app.get("/api/health", (c) => c.json({ status: "ok", time: nowIso() }));

// ---------- auth ----------
app.get("/api/auth/google", (c) => startGoogleLogin(c));
app.get("/api/auth/google/callback", (c) => finishGoogleLogin(c));
// Original Pages paths (registered in Google Console).
app.get("/api/google", (c) => startGoogleLogin(c));
app.get("/api/google/callback", (c) => finishGoogleLogin(c));
app.get("/api/auth/status", async (c) => c.json({ authenticated: Boolean(await currentUser(c.env, c.req.header("Cookie"))) }));
app.post("/api/auth/logout", (c) => logout(c));

/** Local development only (DEV_LOGIN=1 in .dev.vars): sign in as a test user without Google. */
app.post("/api/auth/dev-login", async (c) => {
  if (c.env.DEV_LOGIN !== "1") throw new AppError("not_found", "Not found");
  const body = await c.req.json<{ email?: string; name?: string }>().catch(() => ({} as { email?: string; name?: string }));
  const email = body.email ?? "dev@example.com";
  const name = body.name ?? "Dev User";
  const now = nowIso();
  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  const userId = existing?.id ?? newId("user");
  if (!existing) await c.env.DB.prepare("INSERT INTO users (id, google_sub, email, name, created_at) VALUES (?,?,?,?,?)").bind(userId, `dev-${email}`, email, name, now).run();
  const token = randomToken(32);
  await c.env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)")
    .bind(await sha256(token), userId, new Date(Date.now() + 86400000).toISOString(), now).run();
  c.header("Set-Cookie", `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
  return c.json({ userId, token });
});

async function requireUser(c: Context<App>, next: Next) {
  const user = await currentUser(c.env, c.req.header("Cookie"));
  if (!user) throw new AppError("unauthenticated", "Please sign in.");
  c.set("user", user);
  await next();
}

// ---------- me & workspaces ----------
app.use("/api/me", requireUser);
app.use("/api/workspaces", requireUser);
app.use("/api/workspaces/*", requireUser);
app.use("/api/invites/*", requireUser);
app.use("/api/w/*", requireUser);

app.get("/api/me", async (c) => {
  const user = c.get("user");
  const ws = await c.env.DB.prepare(
    `SELECT w.id, w.name, w.personal, w.sheet_id AS sheetId, m.role, s.last_synced_at AS lastSyncedAt, s.status AS syncStatus, s.error AS syncError
     FROM members m JOIN workspaces w ON w.id = m.workspace_id LEFT JOIN sheet_sync s ON s.workspace_id = w.id
     WHERE m.user_id = ? ORDER BY w.personal DESC, w.name`,
  ).bind(user.id).all();
  const google = await c.env.DB.prepare("SELECT scope FROM google_tokens WHERE user_id = ?").bind(user.id).first<{ scope: string }>();
  return c.json({ user, workspaces: ws.results, googleConnected: Boolean(google) });
});

app.post("/api/workspaces", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ name?: string; personal?: boolean }>().catch(() => ({} as { name?: string; personal?: boolean }));
  const name = (body.name ?? "").trim() || (body.personal ? `${user.name || user.email}'s CRM` : "");
  if (!name) throw new AppError("invalid", "Workspace name is required.");
  if (name.length > 80) throw new AppError("invalid", "Workspace name is too long.");
  const id = newId("ws");
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO workspaces (id, name, owner_id, personal, created_at) VALUES (?,?,?,?,?)").bind(id, name, user.id, body.personal ? 1 : 0, now),
    c.env.DB.prepare("INSERT INTO members (workspace_id, user_id, role, created_at) VALUES (?,?, 'owner', ?)").bind(id, user.id, now),
    c.env.DB.prepare("INSERT INTO sheet_sync (workspace_id, status) VALUES (?, 'pending')").bind(id),
  ]);
  return c.json({ id, name, role: "owner" }, 201);
});

app.patch("/api/workspaces/:id", async (c) => {
  const ctx = await workspaceContext(c, c.req.param("id"));
  if (!["owner", "admin"].includes(ctx.role)) throw new AppError("forbidden", "Only owners and admins can rename a workspace.");
  const { name } = await c.req.json<{ name: string }>();
  if (!name?.trim()) throw new AppError("invalid", "Name is required.");
  await c.env.DB.prepare("UPDATE workspaces SET name = ? WHERE id = ?").bind(name.trim().slice(0, 80), ctx.workspaceId).run();
  return c.json({ ok: true });
});

app.delete("/api/workspaces/:id", async (c) => {
  const ctx = await workspaceContext(c, c.req.param("id"));
  if (ctx.role !== "owner") throw new AppError("forbidden", "Only the owner can delete a workspace.");
  await c.env.DB.prepare("DELETE FROM workspaces WHERE id = ?").bind(ctx.workspaceId).run();
  return c.json({ deleted: true });
});

app.post("/api/invites/:token/accept", async (c) => {
  const user = c.get("user");
  const hash = await sha256(c.req.param("token"));
  const invite = await c.env.DB.prepare("SELECT * FROM invites WHERE token_hash = ?").bind(hash).first<{ workspace_id: string; email: string; role: string; expires_at: string; accepted_at: string | null }>();
  if (!invite || invite.accepted_at || invite.expires_at < nowIso()) throw new AppError("not_found", "This invite link is invalid or has expired.");
  if (invite.email !== user.email.toLowerCase()) throw new AppError("forbidden", `This invite was sent to ${invite.email}. Sign in with that Google account.`);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR IGNORE INTO members (workspace_id, user_id, role, created_at) VALUES (?,?,?,?)").bind(invite.workspace_id, user.id, invite.role, nowIso()),
    c.env.DB.prepare("UPDATE invites SET accepted_at = ? WHERE token_hash = ?").bind(nowIso(), hash),
  ]);
  return c.json({ workspaceId: invite.workspace_id, role: invite.role });
});

// ---------- tools (used by the web UI; MCP and the AI agent call the same registry) ----------
export async function workspaceContext(c: Context<App>, workspaceId: string, source: ToolContext["source"] = "ui"): Promise<ToolContext> {
  const user = c.get("user");
  const m = await c.env.DB.prepare("SELECT role FROM members WHERE workspace_id = ? AND user_id = ?").bind(workspaceId, user.id).first<{ role: Role }>();
  if (!m) throw new AppError("forbidden", "You are not a member of this workspace.");
  return { env: c.env, db: c.env.DB, userId: user.id, workspaceId, role: m.role, source };
}

app.get("/api/w/:ws/tools", async (c) => {
  const ctx = await workspaceContext(c, c.req.param("ws"));
  return c.json({ role: ctx.role, tools: toolManifest(ctx.role) });
});

app.post("/api/w/:ws/tools/:name", async (c) => {
  const ctx = await workspaceContext(c, c.req.param("ws"));
  const input = await c.req.json().catch(() => ({}));
  const result = await invokeTool(ctx, c.req.param("name"), input);
  return c.json({ result });
});

app.post("/api/w/:ws/sync-sheet", async (c) => {
  const ctx = await workspaceContext(c, c.req.param("ws"));
  if (ctx.role === "viewer") throw new AppError("forbidden", "Viewers cannot trigger a sync.");
  await c.env.DB.prepare("UPDATE sheet_sync SET last_synced_at = '' WHERE workspace_id = ?").bind(ctx.workspaceId).run();
  const result = await syncAllSheets(c.env, ctx.workspaceId);
  return c.json(result);
});

// ---------- original UI (gallivanter.pages.dev) ----------
app.use("/api/legacy/*", requireUser);
app.use("/api/ai/*", requireUser);

async function legacyContext(c: Context<App>, source: ToolContext["source"] = "ui"): Promise<ToolContext> {
  const user = c.get("user");
  const requested = c.req.query("ws");
  const wsId = requested || (await personalWorkspace(c.env, user));
  return workspaceContext(c, wsId, source);
}

app.get("/api/legacy/snapshot", async (c) => c.json(await snapshot(await legacyContext(c))));

app.post("/api/legacy/sync/:module", async (c) => {
  const ctx = await legacyContext(c);
  const body = await c.req.json<{ upserts?: LegacyRecord[]; deletes?: string[] }>().catch(() => ({} as { upserts?: LegacyRecord[]; deletes?: string[] }));
  return c.json(await syncCollection(ctx, decodeURIComponent(c.req.param("module")), body.upserts ?? [], body.deletes ?? []));
});

// ---------- native AI assistant ----------
app.get("/api/ai/status", async (c) => {
  const env = c.env as unknown as AiEnv;
  return c.json({ keys: apiKeys(env).length, baseUrl: env.AI_BASE_URL || "https://vyceai.com/v1", model: env.AI_MODEL || "deepseek-v4.1", fallbackModel: env.AI_FALLBACK_MODEL || null });
});
app.get("/api/ai/models", async (c) => c.json(await listModels(c.env as unknown as AiEnv)));
app.post("/api/ai/chat", async (c) => {
  const ctx = await legacyContext(c, "ai");
  const body = await c.req.json<{ messages: ChatMessage[]; approvals?: { id: string; approved: boolean }[]; model?: string }>();
  return c.json(await chat(c.env as unknown as AiEnv, ctx, c.get("user").name || c.get("user").email, body));
});

app.all("/api/*", (c) => c.json({ error: { code: "not_found", message: "Unknown API route" } }, 404));

// Everything else is the React app (static assets with SPA fallback).
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export { app };

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(syncAllSheets(env).then((r) => console.log("sheet sync", JSON.stringify(r))));
  },
} satisfies ExportedHandler<Env>;
