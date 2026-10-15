import { z } from "zod";
import { defineTool } from "../registry.ts";
import { timelineStmt } from "../records.ts";
import { AppError, nowIso, randomToken, sha256 } from "../util.ts";

defineTool({
  name: "list_members",
  title: "List workspace members",
  description: "List people in this workspace with their user id, name, email and role. Use the user id for ownerId fields.",
  authority: "read",
  input: z.object({}),
  async run(ctx) {
    const rows = await ctx.db.prepare(
      `SELECT u.id, u.name, u.email, u.picture, m.role FROM members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, u.name`,
    ).bind(ctx.workspaceId).all();
    return rows.results.map((r) => ({ ...r, isYou: (r as { id: string }).id === ctx.userId }));
  },
});

defineTool({
  name: "invite_member",
  title: "Invite a member",
  description: "Create an invite link for an email address with a role (admin, member, viewer). The link is valid for 7 days.",
  authority: "admin",
  input: z.object({ email: z.email(), role: z.enum(["admin", "member", "viewer"]) }),
  async run(ctx, { email, role }) {
    if (role === "admin" && ctx.role !== "owner") throw new AppError("forbidden", "Only the owner can invite admins.");
    const token = randomToken(24);
    const expires = new Date(Date.now() + 7 * 86400000).toISOString();
    await ctx.db.batch([
      ctx.db.prepare("INSERT INTO invites (token_hash, workspace_id, email, role, created_by, expires_at, created_at) VALUES (?,?,?,?,?,?,?)")
        .bind(await sha256(token), ctx.workspaceId, email.toLowerCase(), role, ctx.userId, expires, nowIso()),
      timelineStmt(ctx, null, "invite", "Member invited", `${email} as ${role}`),
    ]);
    return { email, role, expiresAt: expires, invitePath: `/invite/${token}` };
  },
});

defineTool({
  name: "change_member_role",
  title: "Change a member's role",
  description: "Change a member's role. The owner's role cannot be changed (use transfer instead).",
  authority: "admin",
  input: z.object({ userId: z.string(), role: z.enum(["admin", "member", "viewer"]) }),
  async run(ctx, { userId, role }) {
    const m = await ctx.db.prepare("SELECT role FROM members WHERE workspace_id = ? AND user_id = ?").bind(ctx.workspaceId, userId).first<{ role: string }>();
    if (!m) throw new AppError("not_found", "That user is not a member.");
    if (m.role === "owner") throw new AppError("forbidden", "The owner's role cannot be changed.");
    if ((role === "admin" || m.role === "admin") && ctx.role !== "owner") throw new AppError("forbidden", "Only the owner can manage admins.");
    await ctx.db.batch([
      ctx.db.prepare("UPDATE members SET role = ? WHERE workspace_id = ? AND user_id = ?").bind(role, ctx.workspaceId, userId),
      timelineStmt(ctx, null, "role", "Member role changed", `${userId} → ${role}`),
    ]);
    return { userId, role };
  },
});

defineTool({
  name: "remove_member",
  title: "Remove a member",
  description: "Remove a member from the workspace. Their records stay, owned by them.",
  authority: "admin",
  input: z.object({ userId: z.string() }),
  async run(ctx, { userId }) {
    const m = await ctx.db.prepare("SELECT role FROM members WHERE workspace_id = ? AND user_id = ?").bind(ctx.workspaceId, userId).first<{ role: string }>();
    if (!m) return { removed: false };
    if (m.role === "owner") throw new AppError("forbidden", "The owner cannot be removed.");
    if (m.role === "admin" && ctx.role !== "owner") throw new AppError("forbidden", "Only the owner can remove admins.");
    await ctx.db.batch([
      ctx.db.prepare("DELETE FROM members WHERE workspace_id = ? AND user_id = ?").bind(ctx.workspaceId, userId),
      timelineStmt(ctx, null, "remove_member", "Member removed", userId),
    ]);
    return { removed: true };
  },
});

defineTool({
  name: "changes_since",
  title: "Changes since",
  description: "Records changed (including deleted) since a timestamp. Used by devices to stay in sync.",
  authority: "read",
  input: z.object({ since: z.string().describe("ISO timestamp; empty string = everything"), limit: z.number().int().min(1).max(1000).optional() }),
  async run(ctx, { since, limit = 500 }) {
    const rows = await ctx.db
      .prepare("SELECT id, module, title, data, tags, owner_id, version, converted_to, created_at, updated_at, deleted_at FROM records WHERE workspace_id = ? AND updated_at > ? ORDER BY updated_at LIMIT ?")
      .bind(ctx.workspaceId, since, limit)
      .all<Record<string, string | number | null>>();
    const records = rows.results.map((r) => ({
      id: r.id, module: r.module, title: r.title, values: JSON.parse(String(r.data)), tags: JSON.parse(String(r.tags)),
      ownerId: r.owner_id, version: r.version, convertedTo: r.converted_to ? JSON.parse(String(r.converted_to)) : null,
      createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at,
    }));
    const cursor = records.length ? String(records[records.length - 1].updatedAt) : since;
    return { records, cursor, hasMore: records.length === limit };
  },
});
