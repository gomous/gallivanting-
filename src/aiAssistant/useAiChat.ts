import { useEffect, useRef, useState } from "react";
import { useAuth } from "../cloudflare/AuthContext";

interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
interface Msg { role: "user" | "assistant" | "tool"; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string; reasoning_content?: string }
interface Pending { id: string; name: string; title: string; authority: string; arguments: unknown }

const STORE = "gallivanter.ai.transcript";

export interface ContentPart {
  type: 'text' | 'chart' | 'table';
  content: string | object;
}

/** Chart/table types that our renderer supports. */
const CHART_TYPES = ['bar', 'pie', 'table', 'line'] as const;

/** Check if an object is a chart/table config. */
function isChartConfig(obj: any): boolean {
  return obj && typeof obj === 'object' && CHART_TYPES.includes(obj.type);
}

/** Extract a chart spec from various wrapper formats. */
function extractChartSpec(obj: any): any {
  if (!obj || typeof obj !== 'object') return null;
  // Direct spec (from make_bar_chart etc. — their html field is parsed by caller)
  if (obj.type && CHART_TYPES.includes(obj.type)) return obj;
  // render_visual format: { spec: {...}, text, summary, empty }
  if (obj.spec && isChartConfig(obj.spec)) return obj.spec;
  // Legacy: { html: "<json string>", ... } — caller should pass the parsed html
  if (typeof obj.html === 'string') {
    try { const inner = JSON.parse(obj.html); return extractChartSpec(inner) ?? (isChartConfig(inner) ? inner : null); } catch { }
  }
  return null;
}

/** Parse content into parts - detects chart JSON blocks. */
export function parseContent(content: string | null): ContentPart[] {
  if (!content) return [{ type: 'text', content: '' }];

  // First, try to find a ```json block containing chart data
  const jsonBlock = content.match(/```json\s*\\n([\\s\\S]*?)\\n```/);
  if (jsonBlock) {
    try {
      const parsed = JSON.parse(jsonBlock[1]);
      const spec = extractChartSpec(parsed);
      if (spec) {
        const textBefore = content.slice(0, jsonBlock.index!).trim();
        const parts: ContentPart[] = [];
        if (textBefore) parts.push({ type: 'text', content: textBefore });
        parts.push({ type: 'chart', content: spec });
        return parts;
      }
    } catch { /* fall through */ }
  }

  // Try parsing the entire content as a chart config or wrapper (for direct AI responses & tool results)
  try {
    const parsed = JSON.parse(content);
    const spec = extractChartSpec(parsed);
    if (spec) return [{ type: 'chart', content: spec }];
  } catch { /* fall through */ }

  return [{ type: 'text', content }];
}

/** Shared chat state: sends messages to /api/ai/chat and handles pending tool approvals. */
export function useAiChat() {
  const { refreshFromDrive } = useAuth();
  const [messages, setMessages] = useState<Msg[]>(() => { try { return JSON.parse(sessionStorage.getItem(STORE) ?? "[]") as Msg[]; } catch { return []; } });
  const [pending, setPending] = useState<Pending[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<{ keys: number; model: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { sessionStorage.setItem(STORE, JSON.stringify(messages.slice(-60))); endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, pending]);

  useEffect(() => {
    if (!status) fetch("/api/ai/status", { credentials: "same-origin" }).then((r) => r.json()).then(setStatus).catch(() => {});
  }, [status]);

  async function send(nextMessages: Msg[], approvals?: { id: string; approved: boolean }[]) {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, approvals }),
      });
      const data = await res.json() as { messages?: Msg[]; pending?: Pending[]; changed?: boolean; error?: { message: string } };
      if (!res.ok) throw new Error(data.error?.message ?? `AI request failed (${res.status})`);
      setMessages(data.messages ?? nextMessages);
      setPending(data.pending ?? []);
      if (data.changed) void refreshFromDrive();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  function submit() {
    const text = input.trim();
    if (!text || busy || pending.length) return;
    setInput("");
    void send([...messages, { role: "user", content: text }]);
  }

  function approve() {
    void send(messages, pending.map((p) => ({ id: p.id, approved: true })));
  }

  function decline() {
    void send(messages, pending.map((p) => ({ id: p.id, approved: false })));
  }

  function clearChat() {
    setMessages([]);
    setPending([]);
    setError("");
  }

  return {
    messages, pending, input, busy, error, status, endRef,
    setInput, submit, approve, decline, clearChat,
    visible: messages.filter((m) => (m.role === "user" || m.role === "assistant") && (m.content ?? "").trim()),
  };
}