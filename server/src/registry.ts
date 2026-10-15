/**
 * The tool registry: every CRM operation is defined exactly once here and is
 * used by the web UI (REST), Claude (MCP) and the DeepSeek agent alike.
 */
import { z } from "zod";
import { AppError, type Env } from "./util.ts";

export type Role = "owner" | "admin" | "member" | "viewer";
export type Source = "ui" | "mcp" | "ai";
/**
 * read        – no side effects, AI may run automatically
 * write       – creates/changes data, AI asks for approval by default
 * destructive – deletes or irreversible, AI always asks for approval
 * admin       – workspace management (members, settings)
 */
export type Authority = "read" | "write" | "destructive" | "admin";

export interface ToolContext {
  env: Env;
  db: D1Database;
  userId: string;
  workspaceId: string;
  role: Role;
  source: Source;
}

export interface ToolDef<I extends z.ZodType = z.ZodType, O = unknown> {
  name: string;
  title: string;
  description: string;
  authority: Authority;
  input: I;
  run: (ctx: ToolContext, input: z.infer<I>) => Promise<O>;
}

const allowed: Record<Role, Authority[]> = {
  owner: ["read", "write", "destructive", "admin"],
  admin: ["read", "write", "destructive", "admin"],
  member: ["read", "write", "destructive"],
  viewer: ["read"],
};

export function canUse(role: Role, authority: Authority): boolean {
  return allowed[role].includes(authority);
}

const tools = new Map<string, ToolDef>();

export function defineTool<I extends z.ZodType, O>(def: ToolDef<I, O>): ToolDef<I, O> {
  if (tools.has(def.name)) throw new Error(`Duplicate tool name: ${def.name}`);
  tools.set(def.name, def as unknown as ToolDef);
  return def;
}

export function getTool(name: string): ToolDef | undefined {
  return tools.get(name);
}

export function listTools(role?: Role): ToolDef[] {
  const all = [...tools.values()];
  return role ? all.filter((t) => canUse(role, t.authority)) : all;
}

/** Machine-readable manifest (JSON Schema) consumed by MCP and the AI agent. */
export function toolManifest(role?: Role) {
  return listTools(role).map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    authority: t.authority,
    inputSchema: z.toJSONSchema(t.input, { target: "draft-7", io: "input" }),
  }));
}

/** Validate input, enforce permissions, run. All surfaces go through here. */
export async function invokeTool(ctx: ToolContext, name: string, rawInput: unknown): Promise<unknown> {
  const tool = tools.get(name);
  if (!tool) throw new AppError("not_found", `Unknown tool: ${name}`);
  if (!canUse(ctx.role, tool.authority)) {
    throw new AppError("forbidden", `Your role (${ctx.role}) cannot use ${name}.`);
  }
  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    throw new AppError("invalid", `Invalid input for ${name}.`, z.flattenError(parsed.error));
  }
  return tool.run(ctx, parsed.data);
}
