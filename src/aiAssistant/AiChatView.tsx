import { KeyboardEvent } from "react";
import { useAiChat, parseContent } from "./useAiChat";
import "../aiAssistant.css";

const CHART_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#8b5cf6', '#ec4899', '#14b8a6'];

/** The chart-shell.html content, used to render charts in an iframe.
 * Supports bar, pie, line, and table chart types via Chart.js. */
const CHART_SHELL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Chart</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: transparent;
      color: hsl(220, 6%, 13%);
      padding: 16px;
      width: 100%;
      height: 100vh;
      box-sizing: border-box;
    }
    .dark body { color: hsl(0, 0% 95%); }
    #chart-container {
      width: 100%;
      max-width: 380px;
      height: 100%;
      min-height: 200px;
    }
    .empty-state {
      padding: 24px;
      text-align: center;
      color: hsl(220, 6%, 50%);
      font-size: 13px;
    }
    @media (prefers-color-scheme: dark) {
      body { color: hsl(0, 0% 95%); }
    }
  </style>
</head>
<body>
  <div id="chart-container">
    <div id="empty-state" class="empty-state" style="display: none;">
      No data to display
    </div>
  </div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
  <script>
    /** INJECT_SPEC **/
    let chartInstance = null;

    function renderChart(spec) {
      const container = document.getElementById('chart-container');
      const emptyState = document.getElementById('empty-state');

      if (!spec || spec.error) {
        container.innerHTML = '<div class="empty-state">' + (spec?.error || 'No data to display') + '</div>';
        return;
      }

      if (spec.type === 'table') {
        renderTable(spec);
        emptyState.style.display = 'none';
        return;
      }

      if (typeof Chart === 'undefined') {
        container.innerHTML = '<div class="empty-state">Chart.js failed to load</div>';
        return;
      }

      if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
      }

      const ctx = document.createElement('canvas');
      ctx.id = 'chart-canvas';
      ctx.setAttribute('role', 'img');
      ctx.setAttribute('aria-label', spec.title || spec.type + ' chart');
      container.innerHTML = '';
      container.appendChild(ctx);

      const chartConfig = {
        type: spec.type,
        data: spec.data || {},
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 200 },
          plugins: {
            legend: {
              labels: {
                font: { size: 12 },
                padding: 14,
                usePointStyle: true,
              }
            },
            tooltip: {
              enabled: true,
              callbacks: {
                label: function(context) {
                  var value = context.parsed.y;
                  return context.dataset.label + ': ' + formatNumber(value);
                }
              }
            }
          },
          scales: spec.type !== 'pie' ? {
            x: {
              grid: { display: false },
              ticks: { font: { size: 11 }, maxRotation: 0 }
            },
            y: {
              grid: { color: 'hsl(220, 20%, 90%)' },
              ticks: {
                font: { size: 11 },
                callback: function(value) { return formatNumber(value); }
              }
            }
          } : undefined,
          ...spec.options
        }
      };

      chartInstance = new Chart(ctx, chartConfig);
      emptyState.style.display = 'none';
    }

    function formatNumber(value) {
      if (typeof value === 'number') {
        if (value >= 1000) return '$' + value.toLocaleString();
        return value.toString();
      }
      return String(value);
    }

    function renderTable(spec) {
      const container = document.getElementById('chart-container');
      const columns = spec.columns || [];
      const rows = spec.rows || [];

      var table = document.createElement('table');
      table.style.width = '100%';
      table.style.borderCollapse = 'collapse';
      table.setAttribute('aria-label', spec.title || 'Data table');

      var thead = document.createElement('thead');
      var headerRow = document.createElement('tr');
      columns.forEach(function(col) {
        var th = document.createElement('th');
        th.textContent = col;
        th.style.textAlign = 'left';
        th.style.padding = '6px 8px';
        th.style.fontSize = '12px';
        th.style.fontWeight = '600';
        th.style.color = 'hsl(220, 6%, 40%)';
        th.style.borderBottom = '1px solid hsl(220, 20%, 90%)';
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);

      var tbody = document.createElement('tbody');
      rows.forEach(function(row) {
        var tr = document.createElement('tr');
        columns.forEach(function(col) {
          var td = document.createElement('td');
          var val = row[col];
          td.textContent = val === null || val === undefined ? '—' : String(val);
          td.style.padding = '6px 8px';
          td.style.fontSize = '12px';
          td.style.borderBottom = '1px solid hsl(220, 20%, 90%)';
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);

      container.innerHTML = '';
      container.appendChild(table);
    }

    window.addEventListener('message', function(event) {
      try {
        var data = event.data;
        if (data && data.jsonrpc === '2.0' && data.method === 'ui/notifications/tool-result') {
          var params = data.params || {};
          if (params.structuredContent) {
            var sc = params.structuredContent;
            if (sc.spec) { renderChart(sc.spec); }
            else if (sc.type === 'bar' || sc.type === 'pie' || sc.type === 'table' || sc.type === 'line') { renderChart(sc); }
          }
          var content = params.content || [];
          for (var i = 0; i < content.length; i++) {
            if (content[i].type === 'text' || content[i].type === 'text/plain') {
              try {
                var parsed = JSON.parse(content[i].text || '');
                if (parsed.spec) { renderChart(parsed.spec); }
                else if (parsed.type === 'bar' || parsed.type === 'pie' || parsed.type === 'table' || parsed.type === 'line') { renderChart(parsed); }
              } catch (e) {}
            }
          }
        }
      } catch (e) {
        console.error('Error rendering chart:', e);
      }
    });
  </script>
</body>
</html>`;


/** ECharts shell: an iframe that loads ECharts from CDN and renders whatever
 * option the AI authored (sunburst, force graph, tree, sankey, heatmap, …).
 * The payload is injected at the /** INJECT_ECHARTS **\/ marker. Mirrors
 * server/src/widgets/echarts-shell.html for the MCP Apps path. */
const ECHARTS_SHELL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: transparent; color: hsl(220, 6%, 13%); padding: 8px; }
    #chart { width: 100%; height: 100%; min-height: 200px; }
    .state { padding: 24px; text-align: center; color: hsl(220, 6%, 50%); font-size: 13px; }
    .state.error { color: #ef4444; }
    @media (prefers-color-scheme: dark) { body { color: hsl(0, 0% 95%); } }
  </style>
</head>
<body>
  <div id="chart"><div class="state">Loading…</div></div>
  <script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"><\/script>
  <script>
    function reviveFunctions(node) {
      if (Array.isArray(node)) { node.forEach(reviveFunctions); return node; }
      if (node && typeof node === 'object') {
        for (var k of Object.keys(node)) {
          var v = node[k];
          if (typeof v === 'string' && /^\\s*(function\\s*[\\w$]*\\s*\\(|\\([^)]*\\)\\s*=>|[\\w$]+\\s*=>)/.test(v)) {
            try { node[k] = (new Function('return (' + v + ')'))(); } catch (e) { node[k] = v; }
          } else { reviveFunctions(v); }
        }
        return node;
      }
      return node;
    }
    function renderEcharts(payload) {
      var host = document.getElementById('chart');
      if (!payload || payload.error) { host.innerHTML = '<div class="state error">' + ((payload && payload.error) || 'No data to display') + '</div>'; return; }
      if (typeof echarts === 'undefined') { host.innerHTML = '<div class="state error">ECharts failed to load</div>'; return; }
      var option = payload.echartsOption || payload.option || payload;
      if (payload.data && option && typeof option === 'object' && !option.dataset) option.dataset = [{ source: payload.data }];
      try {
        option = reviveFunctions(option);
        var chart = echarts.init(host, null, { renderer: 'svg' });
        chart.setOption(option);
        new ResizeObserver(function () { chart.resize(); }).observe(host);
      } catch (e) {
        host.innerHTML = '<div class="state error">Render error: ' + (e && e.message ? e.message : String(e)) + '</div>';
      }
    }
    /** INJECT_ECHARTS **/
  <\/script>
</body>
</html>`;

/** Embed the ECharts iframe with the AI-authored payload injected inline. */
function EchartsIframe({ payload }: { payload: any }) {
  const fullHtml = ECHARTS_SHELL_HTML.replace(
    '/** INJECT_ECHARTS **/',
    `var __payload = ${JSON.stringify(payload)}; window.addEventListener('load', function(){ setTimeout(function(){ renderEcharts(__payload); }, 60); });`,
  );
  return (
    <div className="aui-chart-iframe-wrapper aui-echarts-wrapper">
      <iframe
        srcDoc={fullHtml}
        title={payload?.title || "ECharts visualization"}
        className="aui-chart-iframe"
        sandbox="allow-scripts"
      />
    </div>
  );
}

/** Detect an ECharts payload in a parsed tool-result / content object. */
function detectEcharts(obj: any): any | null {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.isEcharts && obj.echartsOption) return obj;
  // render_echarts wraps its payload in a `text` JSON string too.
  if (typeof obj.text === 'string' && obj.text.includes('"isEcharts"')) {
    try { const inner = JSON.parse(obj.text); if (inner.isEcharts && inner.echartsOption) return inner; } catch { }
  }
  return null;
}

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

/** Check if content is a pipeline stats object */
function isPipelineStats(obj: any): boolean {
  return obj && typeof obj === 'object' && obj.stages && Array.isArray(obj.stages) && obj.openDeals !== undefined;
}

/** Pipeline chart visualization */
function PipelineChart({ data }: { data: any }) {
  const stages = data.stages || [];
  const maxVal = Math.max(...stages.map((s: any) => s.amount || 0), 1);

  return (
    <div className="aui-chart">
      <div className="aui-chart-header">
        <h3 className="aui-chart-title">Pipeline by Stage</h3>
        <div className="aui-chart-summary">
          {data.openDeals !== undefined && (
            <>
              <span className="aui-chart-stat"><strong>{data.openDeals}</strong> Deals</span>
              <span className="aui-chart-stat"><strong>${(data.openAmount || 0).toLocaleString()}</strong> Total</span>
            </>
          )}
        </div>
      </div>
      <div className="aui-chart-bars">
        {stages.filter((s: any) => s.count > 0 || s.amount > 0).map((s: any, i: number) => {
          const pct = ((s.amount || 0) / maxVal) * 100;
          return (
            <div key={i} className="aui-chart-row">
              <span className="aui-chart-label">{s.stage}</span>
              <div className="aui-chart-bar-track">
                <div
                  className="aui-chart-bar"
                  style={{ width: `${pct}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                />
              </div>
              <span className="aui-chart-value">${(s.amount || 0).toLocaleString()}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Render bar/pie chart using CSS */
function ChartRenderer({ config }: { config: Record<string, unknown> }) {
  const type = (config.type as string) ?? "bar";
  const title = (config.title as string) ?? "Chart";
  const labels = ((config.data as any)?.labels) ?? [];
  const datasets = ((config.data as any)?.datasets) ?? [];
  const values = datasets[0]?.data ?? [];
  const color = ((config.options as any)?.color) ?? CHART_COLORS[0];

  if (!labels.length && !values.length) {
    return <div className="aui-chart-error">No data for chart</div>;
  }

  const maxVal = Math.max(...values.map((v: number) => v ?? 0), 1);

  if (type === 'table') {
    return (
      <div className="aui-table-wrapper">
        <h3 className="aui-table-title">{title}</h3>
        <table className="aui-table">
          <thead><tr>{((config as any).columns ?? []).map((c: string) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {((config as any).rows ?? []).map((row: any, i: number) => (
              <tr key={i}>{Object.entries(row).map(([k, v]) => <td key={k}>{String(v ?? "—")}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const rows = type === 'pie'
    ? values.map((v: number, i: number) => ({
        label: labels[i] ?? `Item ${i}`,
        value: v ?? 0
      }))
    : labels.map((l: string, i: number) => ({
        label: l,
        value: values[i] ?? 0
      }));

  return (
    <div className="aui-chart">
      <h3 className="aui-chart-title">{title}</h3>
      <div className="aui-chart-bars">
        {rows.map((r: any, i: number) => (
          <div key={i} className="aui-chart-row">
            {type === 'pie' ? (
              <>
                <span className="aui-pie-dot" style={{ backgroundColor: `hsl(${i * 45 % 360}, 70%, 50%)` }} />
                <span className="aui-chart-label">{r.label}</span>
                <span className="aui-chart-value">{r.value.toLocaleString()}</span>
              </>
            ) : (
              <>
                <span className="aui-chart-label">{r.label}</span>
                <div className="aui-chart-bar-track">
                  <div
                    className="aui-chart-bar"
                    style={{
                      width: `${r.value / maxVal * 100}%`,
                      backgroundColor: color
                    }}
                  />
                </div>
                <span className="aui-chart-value">{r.value.toLocaleString()}</span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Check if content is a chart config and render it. */
function ChartFromTool({ content }: { content: string }) {
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return null; }
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as any;
    if (obj.type === 'bar' || obj.type === 'pie' || obj.type === 'table') {
      return <ChartRenderer config={obj} />;
    }
    if (isPipelineStats(obj)) {
      return <PipelineChart data={obj} />;
    }
  }
  return null;
}

/** Embed the chart-shell iframe with the spec injected as an inline script.
 * The iframe loads Chart.js from CDN and renders any chart type (bar, pie, line, table). */
function ChartIframe({ spec, error }: { spec?: any; error?: string }) {
  if (error) {
    return <div className="aui-chart-error">{error}</div>;
  }
  // Inject the spec as a JS variable before the chart-shell's <script> runs
  const specJson = JSON.stringify(spec);
  const fullHtml = CHART_SHELL_HTML.replace(
    '/** INJECT_SPEC **/',
    `var __chartSpec = ${specJson}; if (typeof renderChart !== 'undefined') { setTimeout(() => renderChart(__chartSpec), 100); } else { window.addEventListener('load', () => setTimeout(() => renderChart(__chartSpec), 100)); }`
  );

  return (
    <div className="aui-chart-iframe-wrapper">
      <iframe
        srcDoc={fullHtml}
        title={spec?.title || "Chart visualization"}
        className="aui-chart-iframe"
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  );
}

/** Inline result card for tool results. */
function ToolResultCard({ content }: { content: string }) {
  // ECharts payload (render_echarts): arbitrary chart type authored by the AI.
  if (content.includes('"isEcharts"')) {
    let wrapper: unknown;
    try { wrapper = JSON.parse(content); } catch { }
    const payload = detectEcharts(wrapper);
    if (payload) return <EchartsIframe payload={payload} />;
  }

  // Check if this is a render_visual result with spec field
  if (content.includes('"spec"')) {
    let wrapper: unknown;
    try { wrapper = JSON.parse(content); } catch { }
    if (wrapper && typeof wrapper === 'object' && (wrapper as any).spec) {
      const spec = (wrapper as any).spec;
      if (spec.type === 'bar' || spec.type === 'pie' || spec.type === 'table' || spec.type === 'line') {
        return <ChartIframe spec={spec} />;
      }
    }
  }

  // Check if this is a chart/table tool result with html field (make_bar_chart etc.)
  if (content.includes('"html"')) {
    let wrapper: unknown;
    try { wrapper = JSON.parse(content); } catch { }
    if (wrapper && typeof wrapper === 'object' && (wrapper as any).html) {
      const htmlContent = (wrapper as any).html as string;
      try {
        const parsed = JSON.parse(htmlContent);
        const spec = parsed.spec || parsed;
        if (spec && (spec.type === 'bar' || spec.type === 'pie' || spec.type === 'table' || spec.type === 'line')) {
          return <ChartIframe spec={spec} />;
        }
      } catch { /* fall through to ChartRenderer */ }
      const chart = ChartFromTool({ content: htmlContent });
      if (chart) return chart;
    }
  }

  // Check if this is a pipeline stats object
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { parsed = null; }
  if (parsed && isPipelineStats(parsed)) {
    return <PipelineChart data={parsed as any} />;
  }

  const isRecord = Array.isArray(parsed) || (parsed !== null && typeof parsed === 'object');
  return (
    <pre className="aui-tool-result">{JSON.stringify(parsed ?? content, null, 2)}</pre>
  );
}

/** Simple user avatar placeholder */
function Avatar({ initials }: { initials: string }) {
  return <div className="aui-avatar">{initials}</div>;
}

/** Full-page Claude-style chat view with assistant-ui patterns. */
export function AiChatView() {
  const {
    messages, pending, input, busy, error, status, endRef,
    setInput, submit, approve, decline, clearChat,
    visible,
  } = useAiChat();

  const userName = "Mousum"; // TODO: get from auth context
  const userInitials = "M";

  return (
    <div className="aui-thread-root">
      <div className="aui-thread-viewport">
        {visible.length === 0 && (
          <div className="aui-welcome">
            <h2 className="aui-welcome-title">AI Assistant</h2>
            <p className="aui-welcome-text">Ask about your CRM or tell me what to do. I'll ask before changing anything.</p>
            {["Show my deals as a bar chart by stage", "Create a stats view of my pipeline", "What's overdue this week?"].map((s) => (
              <button key={s} type="button" className="aui-suggestion" onClick={() => setInput(s)}>{s}</button>
            ))}
          </div>
        )}

        {visible.map((m, i) => {
          const parts = parseContent(m.content);
          const isUser = m.role === "user";

          return (
            <div key={i} className={`aui-message ${isUser ? "aui-user-message" : "aui-assistant-message"}`}>
              {isUser && <Avatar initials={userInitials} />}
              <div className="aui-message-content">
                {parts.map((part, j) => {
                  if (part.type === 'chart') {
                    return <ChartIframe key={`chart-${i}-${j}`} spec={part.content as Record<string, unknown>} />;
                  }
                  return (
                    <div key={`text-${i}-${j}`} className="aui-message-text">
                      {typeof part.content === 'string' ? part.content : JSON.stringify(part.content, null, 2)}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {messages.filter((m) => m.role === "tool" && m.tool_call_id).map((m, i) => (
          <div key={`tool-${i}`} className="aui-message aui-assistant-message">
            <div className="aui-message-content">
              <ToolResultCard content={m.content ?? ""} />
            </div>
          </div>
        ))}

        {pending.length > 0 && (
          <div className="aui-message aui-assistant-message">
            <div className="aui-message-content">
              <div className="aui-approval">
                <strong className="aui-approval-title">Approve {pending.length === 1 ? "this change" : `${pending.length} changes`}?</strong>
                {pending.map((p) => (
                  <div key={p.id} className={`aui-action ${p.authority}`}>
                    <b>{p.title}</b>
                    <span>{describe(p.arguments)}</span>
                  </div>
                ))}
                <div className="aui-approval-buttons">
                  <button className="aui-btn aui-btn-secondary" onClick={decline}>Decline</button>
                  <button className="aui-btn aui-btn-primary" onClick={approve}>Approve</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {busy && (
          <div className="aui-message aui-assistant-message">
            <div className="aui-message-content">
              <div className="aui-typing">
                <span>Thinking</span>
                <span className="aui-dots">...</span>
              </div>
            </div>
          </div>
        )}

        {error && <div className="aui-error">{error}</div>}
        <div ref={endRef} />
      </div>

      <div className="aui-composer-root">
        <div className="aui-composer-status">
          {status ? `${status.model} · ${status.keys} key${status.keys === 1 ? "" : "s"}` : "Connecting…"}
        </div>
        <form className="aui-composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <textarea
            value={input}
            rows={2}
            placeholder={pending.length ? "Approve or decline first…" : "Ask or instruct…"}
            disabled={pending.length > 0 || busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
          />
          <button className="aui-btn aui-btn-primary aui-send" type="submit" disabled={busy || !input.trim() || pending.length > 0}>Send</button>
        </form>
        <button className="aui-clear-btn" type="button" onClick={clearChat}>Clear</button>
      </div>
    </div>
  );
}