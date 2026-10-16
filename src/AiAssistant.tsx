import { useEffect, useRef, useState } from "react";
import { useAuth } from "./cloudflare/AuthContext";
import "./aiAssistant.css";

interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
interface Msg { role: "user" | "assistant" | "tool"; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string; reasoning_content?: string }
interface Pending { id: string; name: string; title: string; authority: string; arguments: unknown }

const STORE = "gallivanter.ai.transcript";

function describe(args: unknown): string {
  if (!args || typeof args !== "object") return String(args ?? "");
  const a = args as Record<string, unknown>;
  const parts: string[] = [];
  if (a.module) parts.push(String(a.module));
  const values = (a.values ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(values).slice(0, 8)) parts.push(`${k}: ${v}`);
  for (const [k, v] of Object.entries(a)) if (!["module", "values"].includes(k) && typeof v !== "object") parts.push(`${k}: ${v}`);
  return parts.join(" · ");
}

export function AiAssistant() {
  const { authenticated, refreshFromDrive } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>(() => { try { return JSON.parse(sessionStorage.getItem(STORE) ?? "[]") as Msg[]; } catch { return []; } });
  const [pending, setPending] = useState<Pending[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<{ keys: number; model: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { sessionStorage.setItem(STORE, JSON.stringify(messages.slice(-60))); endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, pending]);
  useEffect(() => {
    if (open && !status) fetch("/api/ai/status", { credentials: "same-origin" }).then((r) => r.json()).then(setStatus).catch(() => {});
  }, [open, status]);

  if (!authenticated) return null;

  async function send(nextMessages: Msg[], approvals?: { id: string; approved: boolean }[]) {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
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

  const visible = messages.filter((m) => (m.role === "user" || m.role === "assistant") && (m.content ?? "").trim());

  return (
    <>
      <button className="ai-fab" onClick={() => setOpen((o) => !o)} type="button" aria-label="Ask AI">{open ? "×" : "✦ Ask AI"}</button>
      {open && (
        <aside className="ai-panel" aria-label="AI assistant">
          <header className="ai-head">
            <div><strong>Gallivanter AI</strong><span>{status ? `${status.model} · ${status.keys} key${status.keys === 1 ? "" : "s"}` : "Connecting…"}</span></div>
            <button className="text-button" type="button" onClick={() => { setMessages([]); setPending([]); setError(""); }}>New chat</button>
          </header>
          <div className="ai-body">
            {visible.length === 0 && (
              <div className="ai-empty">
                <p>Ask about your CRM or tell me what to do. I'll ask before changing anything.</p>
                {["What's overdue this week?", "Show my open deals by stage", "Create a lead: Priya Sharma at Globex, priya@globex.com, source LinkedIn"].map((s) => (
                  <button key={s} type="button" className="ai-suggest" onClick={() => setInput(s)}>{s}</button>
                ))}
              </div>
            )}
            {visible.map((m, i) => <div key={i} className={`ai-msg ${m.role}`}>{m.content}</div>)}
            {pending.length > 0 && (
              <div className="ai-approve">
                <strong>Approve {pending.length === 1 ? "this change" : `${pending.length} changes`}?</strong>
                {pending.map((p) => (
                  <div key={p.id} className={`ai-action ${p.authority}`}><b>{p.title}</b><span>{describe(p.arguments)}</span></div>
                ))}
                <div className="ai-approve-buttons">
                  <button className="secondary-button" type="button" disabled={busy} onClick={() => void send(messages, pending.map((p) => ({ id: p.id, approved: false })))}>Decline</button>
                  <button className="primary-button" type="button" disabled={busy} onClick={() => void send(messages, pending.map((p) => ({ id: p.id, approved: true })))}>Approve</button>
                </div>
              </div>
            )}
            {busy && <div className="ai-msg assistant ai-typing">Thinking…</div>}
            {error && <div className="ai-error">{error}</div>}
            <div ref={endRef} />
          </div>
          <form className="ai-input" onSubmit={(e) => {
            e.preventDefault();
            const text = input.trim();
            if (!text || busy || pending.length) return;
            setInput("");
            void send([...messages, { role: "user", content: text }]);
          }}>
            <textarea value={input} rows={2} placeholder={pending.length ? "Approve or decline first…" : "Ask or instruct…"} disabled={pending.length > 0}
              onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement).requestSubmit(); } }} />
            <button className="primary-button" type="submit" disabled={busy || !input.trim() || pending.length > 0}>Send</button>
          </form>
        </aside>
      )}
    </>
  );
}
