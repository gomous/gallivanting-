import { z } from "zod";
import { defineTool } from "../registry.ts";
import { createRecord, loadRow, searchRecords, timelineStmt, toDto, updateRecord } from "../records.ts";
import { newId, nowIso } from "../util.ts";

const relatedModules = z.enum(["Leads", "Contacts", "Accounts", "Deals", "Campaigns"]);

/** Fill relatedId/relatedModule/contactId from a "related record" id. */
async function relationValues(ctx: Parameters<typeof loadRow>[0], relatedId?: string): Promise<Record<string, string>> {
  if (!relatedId) return {};
  const row = await loadRow(ctx, relatedId);
  const out: Record<string, string> = {};
  if (row.module === "Contacts") out.contactId = row.id;
  if (relatedModules.options.includes(row.module as never)) {
    out.relatedId = row.id;
    out.relatedModule = row.module;
  }
  return out;
}

defineTool({
  name: "add_note",
  title: "Add a note",
  description: "Add a note to any record.",
  authority: "write",
  input: z.object({ recordId: z.string(), text: z.string().min(1).max(10000) }),
  async run(ctx, { recordId, text }) {
    const row = await loadRow(ctx, recordId);
    const id = newId("note");
    const now = nowIso();
    await ctx.db.batch([
      ctx.db.prepare("INSERT INTO notes (id, workspace_id, record_id, text, author_id, created_at) VALUES (?,?,?,?,?,?)").bind(id, ctx.workspaceId, recordId, text, ctx.userId, now),
      ctx.db.prepare("UPDATE records SET updated_at = ?, version = version + 1 WHERE id = ?").bind(now, recordId),
      timelineStmt(ctx, recordId, "note", "Note added", text.slice(0, 200)),
    ]);
    return { id, recordId, recordTitle: row.title, text, createdAt: now };
  },
});

defineTool({
  name: "delete_note",
  title: "Delete a note",
  description: "Delete a note by id.",
  authority: "destructive",
  input: z.object({ noteId: z.string() }),
  async run(ctx, { noteId }) {
    const note = await ctx.db.prepare("SELECT record_id FROM notes WHERE id = ? AND workspace_id = ?").bind(noteId, ctx.workspaceId).first<{ record_id: string }>();
    if (!note) return { deleted: false };
    await ctx.db.batch([
      ctx.db.prepare("DELETE FROM notes WHERE id = ?").bind(noteId),
      timelineStmt(ctx, note.record_id, "note_delete", "Note deleted"),
    ]);
    return { deleted: true };
  },
});

defineTool({
  name: "create_task",
  title: "Create a task",
  description: "Create a follow-up task, optionally related to a lead/contact/account/deal/campaign.",
  authority: "write",
  input: z.object({
    subject: z.string().min(1),
    dueDate: z.string().optional().describe("YYYY-MM-DD"),
    priority: z.enum(["High", "Normal", "Low"]).optional(),
    relatedId: z.string().optional(),
    description: z.string().optional(),
    ownerId: z.string().optional(),
  }),
  async run(ctx, { subject, dueDate, priority, relatedId, description, ownerId }) {
    const rel = await relationValues(ctx, relatedId);
    return createRecord(ctx, "Tasks", { subject, dueDate, priority: priority ?? "Normal", status: "Not Started", description, ...rel }, { ownerId });
  },
});

defineTool({
  name: "complete_task",
  title: "Complete a task",
  description: "Mark a task as Completed.",
  authority: "write",
  input: z.object({ taskId: z.string() }),
  async run(ctx, { taskId }) {
    const row = await loadRow(ctx, taskId);
    if (row.module !== "Tasks") throw new Error(`${taskId} is not a task.`);
    return updateRecord(ctx, taskId, { status: "Completed" }, { timelineTitle: "Task completed" });
  },
});

defineTool({
  name: "log_call",
  title: "Log a call",
  description: "Record a phone call that happened (or is planned).",
  authority: "write",
  input: z.object({
    subject: z.string().min(1),
    callType: z.enum(["Inbound", "Outbound"]).optional(),
    callStart: z.string().optional().describe("ISO date-time, defaults to now"),
    callDuration: z.string().optional().describe("e.g. 15 min"),
    purpose: z.string().optional(),
    result: z.string().optional(),
    relatedId: z.string().optional(),
  }),
  async run(ctx, input) {
    const rel = await relationValues(ctx, input.relatedId);
    const { relatedId: _r, ...rest } = input;
    return createRecord(ctx, "Calls", { callType: "Outbound", callStart: nowIso().slice(0, 16), ...rest, ...rel });
  },
});

defineTool({
  name: "schedule_meeting",
  title: "Schedule a meeting",
  description: "Create a meeting with start and end times.",
  authority: "write",
  input: z.object({
    title: z.string().min(1),
    from: z.string().describe("ISO date-time, e.g. 2026-10-20T15:00"),
    to: z.string().describe("ISO date-time"),
    location: z.string().optional(),
    description: z.string().optional(),
    relatedId: z.string().optional(),
  }),
  async run(ctx, input) {
    const rel = await relationValues(ctx, input.relatedId);
    const { relatedId: _r, ...rest } = input;
    return createRecord(ctx, "Meetings", { ...rest, ...rel });
  },
});

defineTool({
  name: "list_agenda",
  title: "Agenda: overdue and upcoming",
  description: "List open tasks that are overdue or due soon, and meetings coming up, for you or the whole workspace.",
  authority: "read",
  input: z.object({
    days: z.number().int().min(1).max(90).optional().describe("Look-ahead window, default 7"),
    mine: z.boolean().optional().describe("Only items owned by me (default true)"),
  }),
  async run(ctx, { days = 7, mine = true }) {
    const today = nowIso().slice(0, 10);
    const until = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const owner = mine ? [{ field: "ownerId", operator: "is" as const, value: ctx.userId }] : [];
    const open = [{ field: "status", operator: "is_not" as const, value: "Completed" }, { field: "dueDate", operator: "not_empty" as const }];
    const [overdue, upcoming, meetings] = await Promise.all([
      searchRecords(ctx, { module: "Tasks", rules: [...open, { field: "dueDate", operator: "lt", value: today }, ...owner], sortField: "dueDate", sortDir: "asc", limit: 100 }),
      searchRecords(ctx, { module: "Tasks", rules: [...open, { field: "dueDate", operator: "gte", value: today }, { field: "dueDate", operator: "lte", value: until }, ...owner], sortField: "dueDate", sortDir: "asc", limit: 100 }),
      searchRecords(ctx, { module: "Meetings", rules: [{ field: "from", operator: "gte", value: today }, { field: "from", operator: "lte", value: `${until}T23:59` }, ...owner], sortField: "from", sortDir: "asc", limit: 100 }),
    ]);
    return { today, until, overdueTasks: overdue.records, upcomingTasks: upcoming.records, upcomingMeetings: meetings.records };
  },
});

defineTool({
  name: "link_records",
  title: "Link two records",
  description: "Create a generic relationship between two records (shown in each record's related list).",
  authority: "write",
  input: z.object({ fromId: z.string(), toId: z.string() }),
  async run(ctx, { fromId, toId }) {
    if (fromId === toId) throw new Error("A record cannot be linked to itself.");
    const [a, b] = await Promise.all([loadRow(ctx, fromId), loadRow(ctx, toId)]);
    await ctx.db.batch([
      ctx.db.prepare("INSERT OR IGNORE INTO record_links (workspace_id, from_id, to_id, created_at) VALUES (?,?,?,?)").bind(ctx.workspaceId, fromId, toId, nowIso()),
      timelineStmt(ctx, fromId, "link", "Linked record", `${b.module}: ${b.title}`),
      timelineStmt(ctx, toId, "link", "Linked record", `${a.module}: ${a.title}`),
    ]);
    return { linked: true, from: toDto(a).title, to: toDto(b).title };
  },
});

defineTool({
  name: "unlink_records",
  title: "Unlink two records",
  description: "Remove a relationship created with link_records.",
  authority: "write",
  input: z.object({ fromId: z.string(), toId: z.string() }),
  async run(ctx, { fromId, toId }) {
    const res = await ctx.db
      .prepare("DELETE FROM record_links WHERE workspace_id = ? AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))")
      .bind(ctx.workspaceId, fromId, toId, toId, fromId)
      .run();
    if (res.meta.changes) await timelineStmt(ctx, fromId, "unlink", "Unlinked record", toId).run();
    return { unlinked: res.meta.changes > 0 };
  },
});

defineTool({
  name: "record_history",
  title: "Record history",
  description: "Full change history (audit trail) of a record: who did what, when, and from where (ui/mcp/ai).",
  authority: "read",
  input: z.object({ id: z.string(), limit: z.number().int().min(1).max(500).optional() }),
  async run(ctx, { id, limit = 100 }) {
    const rows = await ctx.db
      .prepare(
        `SELECT t.action, t.title, t.detail, t.source, t.at, u.name AS actor, u.email AS actorEmail
         FROM timeline t LEFT JOIN users u ON u.id = t.actor_id
         WHERE t.record_id = ? AND t.workspace_id = ? ORDER BY t.at DESC LIMIT ?`,
      )
      .bind(id, ctx.workspaceId, limit)
      .all();
    return rows.results;
  },
});
