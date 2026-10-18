import { KeyboardEvent } from "react";
import { useAiChat, parseContent } from "./useAiChat";
import "../aiAssistant.css";

const CHART_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#8b5cf6', '#ec4899', '#14b8a6'];

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

/** Check if content is a pipeline stats object and convert to chart */
function isPipelineStats(obj: any): boolean {
  return obj && typeof obj === 'object' && obj.stages && Array.isArray(obj.stages) && obj.openDeals !== undefined;
}

/** Render pipeline stats as a bar chart */
function PipelineChart({ data }: { data: any }) {
  const stages = data.stages || [];
  const labels = stages.map((s: any) => s.stage || 'Other');
  const values = stages.map((s: any) => s.amount || 0);
  const maxVal = Math.max(...values, 1);

  return (
    <div className="ai-chart ai-pipeline-chart">
      <div className="ai-chart-title">{data.title || 'Pipeline by Stage'}</div>
      <div className="ai-chart-body">
        {labels.map((label: string, i: number) => (
          <div key={i} className="ai-chart-row">
            <span className="ai-chart-label">{label}</span>
            <div className="ai-chart-bar-container">
              <div className="ai-chart-bar" style={{ width: `${values[i] / maxVal * 100}%` }} />
            </div>
            <span className="ai-chart-value">${values[i].toLocaleString()}</span>
          </div>
        ))}
      </div>
      {data.openDeals !== undefined && (
        <div className="ai-chart-summary">
          <span className="ai-chart-summary-label">Total Deals:</span>
          <span className="ai-chart-summary-value">{data.openDeals}</span>
          <span className="ai-chart-summary-label">Total Value:</span>
          <span className="ai-chart-summary-value">${data.openAmount?.toLocaleString() || 0}</span>
        </div>
      )}
    </div>
  );
}

/** Check if content is a chart config and render it. */
function ChartFromTool({ content }: { content: string }) {
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return null; }
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as any;
    // Check for chart type
    if (obj.type === 'bar' || obj.type === 'pie' || obj.type === 'table') {
      return <ChartRenderer config={obj} />;
    }
    // Check for pipeline stats (convert to chart)
    if (isPipelineStats(obj)) {
      return <PipelineChart data={obj} />;
    }
  }
  return null;
}

/** Render bar/pie chart using simple CSS. */
function ChartRenderer({ config }: { config: Record<string, unknown> }) {
  const type = (config.type as string) ?? "bar";
  const title = (config.title as string) ?? "Chart";
  const labels = ((config.data as any)?.labels) ?? [];
  const datasets = ((config.data as any)?.datasets) ?? [];
  const values = datasets[0]?.data ?? [];
  const color = ((config.options as any)?.color) ?? CHART_COLORS[0];

  if (!labels.length && !values.length) {
    return <div className="ai-error">No data for chart</div>;
  }

  const maxVal = Math.max(...values.map((v: number) => v ?? 0), 1);
  const rows = type === 'pie'
    ? values.map((v: number, i: number) => ({
        label: labels[i] ?? labels[i] ?? `Item ${i}`,
        value: v ?? 0
      }))
    : labels.map((l: string, i: number) => ({
        label: l,
        value: values[i] ?? 0
      }));

  return (
    <div className="ai-chart">
      <div className="ai-chart-title">{title}</div>
      <div className="ai-chart-body">
        {rows.map((r: any, i: number) => (
          <div key={i} className="ai-chart-row">
            {type === 'pie' ? (
              <>
                <span className="ai-chart-pie-dot" style={{ backgroundColor: `hsl(${i * 45 % 360}, 70%, 50%)` }} />
                <span className="ai-chart-label">{r.label}</span>
                <span className="ai-chart-value">{r.value.toLocaleString()}</span>
              </>
            ) : (
              <>
                <span className="ai-chart-label">{r.label}</span>
                <div className="ai-chart-bar-container">
                  <div className="ai-chart-bar" style={{
                    width: `${r.value / maxVal * 100}%`,
                    backgroundColor: color
                  }} />
                </div>
                <span className="ai-chart-value">{r.value.toLocaleString()}</span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Inline result card for tool results. */
function ToolResultCard({ content }: { content: string }) {
  // Check if this is a chart/table tool result with html field
  if (content.includes('"html"')) {
    let wrapper: unknown;
    try { wrapper = JSON.parse(content); } catch { }
    if (wrapper && typeof wrapper === 'object' && (wrapper as any).html) {
      const htmlContent = (wrapper as any).html as string;
      const chart = ChartFromTool({ content: htmlContent });
      if (chart) return chart;
    }
  }

  // Check if this is a pipeline stats object (convert to chart)
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { parsed = null; }
  if (parsed && isPipelineStats(parsed)) {
    return <PipelineChart data={parsed as any} />;
  }

  const isRecord = Array.isArray(parsed) || (parsed !== null && typeof parsed === 'object');
  return (
    <div className="ai-tool-result">
      {isRecord ? (
        <pre className="ai-tool-pre">{JSON.stringify(parsed, null, 2)}</pre>
      ) : (
        <span className="ai-tool-text">{content}</span>
      )}
    </div>
  );
}

/** Full-page Claude-style chat view. */
export function AiChatView() {
  const {
    messages, pending, input, busy, error, status, endRef,
    setInput, submit, approve, decline, clearChat,
    visible,
  } = useAiChat();

  return (
    <div className="ai-chat-page">
      <header className="ai-chat-head">
        <div>
          <strong>AI Assistant</strong>
          <span>{status ? `${status.model} · ${status.keys} key${status.keys === 1 ? "" : "s"}` : "Connecting…"}</span>
        </div>
        <button className="text-button" type="button" onClick={clearChat}>Clear</button>
      </header>

      <div className="ai-chat-body">
        {visible.length === 0 && (
          <div className="ai-empty">
            <p>Ask about your CRM or tell me what to do. I'll ask before changing anything.</p>
            {["Show my deals as a bar chart by stage", "Create a stats view of my pipeline", "What's overdue this week?"].map((s) => (
              <button key={s} type="button" className="ai-suggest" onClick={() => setInput(s)}>{s}</button>
            ))}
          </div>
        )}

        {visible.map((m, i) => {
          const parts = parseContent(m.content);
          return (
            <div key={i}>
              {parts.map((part, j) => {
                if (part.type === 'chart') {
                  return <ChartRenderer key={`chart-${i}-${j}`} config={part.content as Record<string, unknown>} />;
                }
                return (
                  <div key={`text-${i}-${j}`} className={`ai-msg ${m.role}`}>
                    {typeof part.content === 'string' ? part.content : JSON.stringify(part.content, null, 2)}
                  </div>
                );
              })}
            </div>
          );
        })}

        {messages.filter((m) => m.role === "tool" && m.tool_call_id).map((m, i) => (
          <div key={`tool-${i}`} className="ai-msg assistant">
            <ToolResultCard content={m.content ?? ""} />
          </div>
        ))}

        {pending.length > 0 && (
          <div className="ai-approve">
            <strong>Approve {pending.length === 1 ? "this change" : `${pending.length} changes`}?</strong>
            {pending.map((p) => (
              <div key={p.id} className={`ai-action ${p.authority}`}><b>{p.title}</b><span>{describe(p.arguments)}</span></div>
            ))}
            <div className="ai-approve-buttons">
              <button className="secondary-button" type="button" disabled={busy} onClick={decline}>Decline</button>
              <button className="primary-button" type="button" disabled={busy} onClick={approve}>Approve</button>
            </div>
          </div>
        )}
        {busy && <div className="ai-msg assistant ai-typing">Thinking…</div>}
        {error && <div className="ai-error">{error}</div>}
        <div ref={endRef} />
      </div>

      <form className="ai-input" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <textarea
          value={input}
          rows={2}
          placeholder={pending.length ? "Approve or decline first…" : "Ask or instruct…"}
          disabled={pending.length > 0 || busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
        />
        <button className="primary-button" type="submit" disabled={busy || !input.trim() || pending.length > 0}>Send</button>
      </form>
    </div>
  );
}