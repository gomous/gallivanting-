/**
 * Native AI assistant over an OpenAI-compatible provider (default: Vyce AI).
 *
 * API keys come from Cloudflare secrets, so you manage them in the dashboard:
 *   VYCE_API_KEYS   = "key1,key2,key3"      (comma/newline separated)   and/or
 *   VYCE_API_KEY_1, VYCE_API_KEY_2, ...     (one secret per key)
 * Optional vars: AI_BASE_URL (default https://vyceai.com/v1), AI_MODEL, AI_FALLBACK_MODEL.
 *
 * Keys are rotated round-robin; a key that fails (401/403/429/5xx/network) is
 * put on cooldown and the request is retried with the next key.
 */
import { invokeTool, toolManifest, getTool, type ToolContext } from "./registry.ts";
import { moduleKeys } from "../../src/crm/schema.ts";
import { AppError, type Env } from "./util.ts";

export interface AiEnv extends Env {
  AI_BASE_URL?: string;
  AI_MODEL?: string;
  AI_FALLBACK_MODEL?: string;
  VYCE_API_KEYS?: string;
  [key: string]: unknown;
}

const DEFAULT_BASE = "https://vyceai.com/v1";
const MAX_STEPS = 10;

// Visualization helper tools (make_bar_chart, make_pie_chart, make_table)
// are defined in src/tools/viz.ts and registered via defineTool.
const HIDDEN_FROM_AI = new Set(["changes_since", "resolve_titles"]);

// ---------------- key pool ----------------

const cooldownUntil = new Map<string, number>(); // per isolate; good enough to spread load
let cursor = 0;

export function apiKeys(env: AiEnv): string[] {
  const keys: string[] = [];
  if (typeof env.VYCE_API_KEYS === "string") keys.push(...env.VYCE_API_KEYS.split(/[\s,]+/));
  for (let i = 1; i <= 50; i++) {
    const k = env[`VYCE_API_KEY_${i}`];
    if (typeof k === "string") keys.push(k);
  }
  if (typeof env.VYCE_API_KEY === "string") keys.push(env.VYCE_API_KEY as string);
  return [...new Set(keys.map((k) => k.trim()).filter(Boolean))];
}

function orderedKeys(env: AiEnv): string[] {
  const keys = apiKeys(env);
  if (!keys.length) throw new AppError("upstream", "No AI API keys configured. Add VYCE_API_KEYS (or VYCE_API_KEY_1, _2, …) as secrets in Cloudflare.");
  const start = cursor++ % keys.length;
  const rotated = [...keys.slice(start), ...keys.slice(0, start)];
  const now = Date.now();
  const ready = rotated.filter((k) => (cooldownUntil.get(k) ?? 0) <= now);
  const cooling = rotated.filter((k) => (cooldownUntil.get(k) ?? 0) > now).sort((a, b) => cooldownUntil.get(a)! - cooldownUntil.get(b)!);
  return [...ready, ...cooling];
}

const mask = (k: string) => `…${k.slice(-4)}`;

/** POST to the provider, rotating keys on retryable failures. */
export async function providerFetch(env: AiEnv, path: string, body?: unknown): Promise<Response> {
  const base = (env.AI_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
  const failures: string[] = [];
  for (const key of orderedKeys(env)) {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      cooldownUntil.set(key, Date.now() + 30_000);
      failures.push(`${mask(key)}: network ${e instanceof Error ? e.message : e}`);
      continue;
    }
    if (res.ok) return res;
    const text = (await res.text()).slice(0, 300);
    const retryable = [401, 402, 403, 408, 409, 425, 429, 500, 502, 503, 504].includes(res.status);
    if (!retryable) throw new AppError("upstream", `AI provider error ${res.status}: ${text}`);
    const retryAfter = Number(res.headers.get("retry-after")) || 0;
    const wait = res.status === 401 || res.status === 403 || res.status === 402 ? 10 * 60_000 : Math.max(retryAfter * 1000, 60_000);
    cooldownUntil.set(key, Date.now() + wait);
    failures.push(`${mask(key)}: ${res.status} ${text.slice(0, 120)}`);
  }
  throw new AppError("upstream", `All AI keys failed. ${failures.join(" | ")}`);
}

export async function listModels(env: AiEnv): Promise<unknown> {
  const res = await providerFetch(env, "/models");
  return res.json();
}

// ---------------- agent loop ----------------

interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string;
}
export interface PendingAction { id: string; name: string; title: string; authority: string; arguments: unknown }

function systemPrompt(ctx: ToolContext, userName: string): string {
  return [
    `You are the built-in assistant of Gallivanter, a CRM. Today is ${new Date().toISOString().slice(0, 10)}.`,
    `You are helping ${userName} (role: ${ctx.role}) in their workspace. Modules: ${moduleKeys.join(", ")}.`,
    "Rules:",
    "- Use tools to look things up; never invent records, ids, numbers or field values.",
    "- Before creating or filtering records in a module you haven't inspected in this chat, call describe_module to learn exact field keys and allowed options.",
    "- Lookup fields (e.g. accountId, contactId) take record ids: search first, then use the id.",
    "- Prefer one well-chosen tool call over many; batch with bulk tools when appropriate.",
    "- Changes (create/update/delete) are shown to the user for approval before they run. Propose them directly; do not ask for permission in text first.",
    "- If a tool returns an error, read it, fix the input, and retry once; otherwise explain the problem briefly.",
    "- Answer concisely. Mention record names (not raw ids) and offer the next useful step.",
    "- For visualization requests: after getting data, call make_bar_chart, make_pie_chart, or make_table to format it for rendering. Always use these tools when user asks for charts, tables, or visual summaries.",
  ].join("\n");
}

function aiTools(ctx: ToolContext) {
  return toolManifest(ctx.role)
    .filter((t) => !HIDDEN_FROM_AI.has(t.name))
    .map((t) => {
      const { $schema: _s, ...parameters } = t.inputSchema as Record<string, unknown>;
      return { type: "function" as const, function: { name: t.name, description: `${t.description}${t.authority !== "read" ? " (requires user approval)" : ""}`, parameters } };
    });
}

async function callModel(env: AiEnv, model: string, messages: ChatMessage[], tools: unknown[]) {
  const res = await providerFetch(env, "/chat/completions", { model, messages, tools, tool_choice: "auto", temperature: 0.2, max_tokens: 4096 });
  const data = (await res.json()) as { choices?: { message: ChatMessage; finish_reason: string }[]; usage?: unknown; error?: { message: string } };
  const msg = data.choices?.[0]?.message;
  if (!msg) throw new AppError("upstream", `AI provider returned no message${data.error ? `: ${data.error.message}` : ""}.`);
  return { message: msg, usage: data.usage };
}

async function runToolCall(ctx: ToolContext, call: ToolCall): Promise<ChatMessage> {
  let args: unknown;
  try {
    args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
  } catch {
    return { role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "Arguments were not valid JSON." }) };
  }
  try {
    const result = await invokeTool({ ...ctx, source: "ai" }, call.function.name, args);
    let text = JSON.stringify(result);
    if (text.length > 24_000) text = `${text.slice(0, 24_000)}… (truncated; narrow the query)`;
    return { role: "tool", tool_call_id: call.id, content: text };
  } catch (e) {
    const err = e instanceof AppError ? { error: e.message, code: e.code, details: e.details } : { error: e instanceof Error ? e.message : String(e) };
    return { role: "tool", tool_call_id: call.id, content: JSON.stringify(err) };
  }
}

/**
 * One chat turn. The client keeps the transcript (without the system prompt).
 * If the model proposes changes, we stop and return them as `pending`; the client
 * re-calls with `approvals` to run or decline them.
 */
export async function chat(
  env: AiEnv,
  ctx: ToolContext,
  userName: string,
  input: { messages: ChatMessage[]; approvals?: { id: string; approved: boolean }[]; model?: string },
): Promise<{ messages: ChatMessage[]; pending: PendingAction[]; changed: boolean; model: string }> {
  const model = input.model || env.AI_MODEL || "deepseek-v4.1";
  const transcript: ChatMessage[] = (input.messages ?? []).filter((m) => m.role !== "system").slice(-60);
  if (!transcript.length) throw new AppError("invalid", "Send at least one message.");
  const tools = aiTools(ctx);
  let changed = false;

  // Resolve approvals for the last assistant turn's outstanding tool calls.
  const last = transcript[transcript.length - 1];
  if (last.role === "assistant" && last.tool_calls?.length) {
    const answered = new Set(transcript.filter((m) => m.role === "tool").map((m) => m.tool_call_id));
    for (const call of last.tool_calls) {
      if (answered.has(call.id)) continue;
      const tool = getTool(call.function.name);
      const decision = input.approvals?.find((a) => a.id === call.id);
      if (tool && tool.authority !== "read" && !decision?.approved) {
        transcript.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ declined: true, message: "The user declined this action." }) });
      } else {
        transcript.push(await runToolCall(ctx, call));
        if (tool && tool.authority !== "read") changed = true;
      }
    }
  }

  for (let step = 0; step < MAX_STEPS; step++) {
    let reply;
    try {
      reply = await callModel(env, model, [{ role: "system", content: systemPrompt(ctx, userName) }, ...transcript], tools);
    } catch (e) {
      if (env.AI_FALLBACK_MODEL && env.AI_FALLBACK_MODEL !== model && step === 0) {
        reply = await callModel(env, env.AI_FALLBACK_MODEL, [{ role: "system", content: systemPrompt(ctx, userName) }, ...transcript], tools);
      } else throw e;
    }
    const msg: ChatMessage = { role: "assistant", content: reply.message.content ?? "", ...(reply.message.tool_calls?.length ? { tool_calls: reply.message.tool_calls } : {}) };
    if (reply.message.reasoning_content) msg.reasoning_content = reply.message.reasoning_content;
    transcript.push(msg);
    if (!msg.tool_calls?.length) return { messages: transcript, pending: [], changed, model };

    const pending: PendingAction[] = [];
    for (const call of msg.tool_calls) {
      const tool = getTool(call.function.name);
      if (tool && tool.authority !== "read") {
        let args: unknown = {};
        try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* shown raw */ args = call.function.arguments; }
        pending.push({ id: call.id, name: tool.name, title: tool.title, authority: tool.authority, arguments: args });
      }
    }
    if (pending.length) {
      // Run the read-only calls now so the model has their results after approval.
      for (const call of msg.tool_calls) {
        const tool = getTool(call.function.name);
        if (!tool || tool.authority === "read") transcript.push(await runToolCall(ctx, call));
      }
      return { messages: transcript, pending, changed, model };
    }
    for (const call of msg.tool_calls) transcript.push(await runToolCall(ctx, call));
  }
  transcript.push({ role: "assistant", content: "I stopped after several steps. Tell me how you'd like to continue." });
  return { messages: transcript, pending: [], changed, model };
}
