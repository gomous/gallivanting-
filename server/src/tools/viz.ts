import { z } from "zod";
import { defineTool } from "../registry.ts";

/** Generate a bar chart configuration for frontend rendering. */
defineTool({
  name: "make_bar_chart",
  title: "Generate a bar chart",
  description: "Create a bar chart visualization from CRM records. Returns data labels and values that render as a bar chart in the chat.",
  authority: "read",
  input: z.object({
    data: z.array(z.any()).describe("Array of records, typically from search_records"),
    labelField: z.string().optional().describe("Field to use for bar labels (e.g., 'stage', 'company')"),
    valueField: z.string().optional().describe("Field to use for bar values (e.g., 'amount', 'count')"),
    title: z.string().optional().describe("Chart title"),
  }),
  async run(_ctx, { data, labelField, valueField, title }) {
    if (!Array.isArray(data) || data.length === 0) {
      return { html: JSON.stringify({ error: "No data available" }), empty: true };
    }

    const lf = labelField ?? "stage";
    const vf = valueField ?? "amount";

    const labels: string[] = [];
    const values: number[] = [];
    for (const d of data.slice(0, 15)) {
      const record = d as Record<string, unknown>;
      const lbl = String(record[lf] ?? record.name ?? record.company ?? record.stage ?? "");
      const val = typeof record[vf] === "number" ? record[vf] : 0;
      labels.push(lbl);
      values.push(isNaN(val) ? 0 : val);
    }

    return {
      html: JSON.stringify({
        type: "bar",
        title: title ?? "Bar Chart",
        data: { labels, datasets: [{ label: title ?? "Value", data: values }] }
      }),
      empty: false,
    };
  },
});

/** Generate a pie chart configuration for categorical data. */
defineTool({
  name: "make_pie_chart",
  title: "Generate a pie chart",
  description: "Create a pie chart from categorical CRM data. Returns data suitable for pie chart rendering.",
  authority: "read",
  input: z.object({
    data: z.array(z.any()).describe("Array of records to group by a categorical field"),
    labelField: z.string().optional().describe("Field to use for pie slice labels (e.g., 'stage', 'source')"),
    valueField: z.string().optional().describe("Field to use for slice values (count if omitted)"),
    title: z.string().optional().describe("Chart title"),
  }),
  async run(_ctx, { data, labelField, valueField, title }) {
    if (!Array.isArray(data) || data.length === 0) {
      return { html: JSON.stringify({ error: "No data available" }), empty: true };
    }

    const lf = labelField ?? "stage";
    const vf = valueField ?? undefined;

    // Group data by label
    const groups = new Map<string, number>();
    for (const d of data) {
      const record = d as Record<string, unknown>;
      const lbl = String(record[lf] ?? record.name ?? record.stage ?? "Other");
      const val = vf ? (typeof record[vf] === "number" ? record[vf] : 0) : 1;
      groups.set(lbl, (groups.get(lbl) ?? 0) + (isNaN(val) ? 0 : val));
    }

    const items = Array.from(groups.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const labels = items.map((i) => i[0]);
    const values = items.map((i) => i[1]);

    return {
      html: JSON.stringify({
        type: "pie",
        title: title ?? "Pie Chart",
        data: { labels, datasets: [{ data: values }] }
      }),
      empty: false,
    };
  },
});

/** Generate a simple table from records. */
defineTool({
  name: "make_table",
  title: "Generate a table view",
  description: "Create a table view from CRM records with specified columns.",
  authority: "read",
  input: z.object({
    data: z.array(z.any()).describe("Array of records"),
    columns: z.array(z.string()).describe("Fields to include as columns"),
    title: z.string().optional().describe("Table title"),
    pageSize: z.number().int().min(1).max(50).optional(),
  }),
  async run(_ctx, { data, columns, title, pageSize = 20 }) {
    if (!Array.isArray(data) || data.length === 0) {
      return { html: JSON.stringify({ error: "No data to display" }), empty: true };
    }

    const cols = columns;
    const rows = data.slice(0, pageSize).map((d: any) => {
      const row: Record<string, unknown> = {};
      for (const c of cols) {
        const v = d[c];
        row[c] = v === null || v === undefined ? "—" : String(v);
      }
      return row;
    });

    return {
      html: JSON.stringify({
        type: "table",
        title: title ?? "Table",
        columns: cols,
        rows,
      }),
      empty: false,
    };
  },
});

// Import for render_visual
import type { ModuleKey } from "../../../src/crm/model.ts";
import { moduleDefs, moduleKeys } from "../../../src/crm/schema.ts";
import { searchRecords, type FilterRule } from "../records.ts";
import { AppError } from "../util.ts";

const moduleEnum = z.enum(moduleKeys as [ModuleKey, ...ModuleKey[]]);
const filterRule = z.object({
  field: z.string(),
  operator: z.enum(["is", "is_not", "contains", "not_contains", "starts_with", "empty", "not_empty", "gt", "gte", "lt", "lte"]),
  value: z.string().optional(),
});

/**
 * render_visual - Generate an inline visual chart directly in the chat.
 *
 * Queries the CRM data server-side, aggregates it, generates a Chart.js spec,
 * and delivers it via a ui:// resource so the host renders it inline in a
 * sandboxed iframe. No HTML is passed through the calling model.
 */
defineTool({
  name: "render_visual",
  title: "Render an inline chart",
  description: "Use whenever the user asks for a chart, graph, breakdown or visual of CRM data. Do not call run_report first. This tool queries data, builds a chart spec, and renders it inline.",
  authority: "read",
  input: z.object({
    intent: z.string().describe("Plain-language description of what the visual should show, e.g. 'Pipeline value by stage', 'Leads by source this month'"),
    module: moduleEnum.describe("CRM module to query (e.g., 'Leads', 'Deals')"),
    filters: z.array(filterRule).optional().describe("Optional field filters"),
    groupBy: z.string().optional().describe("Field to group by (e.g., 'stage', 'source', 'ownerId')"),
    metric: z.enum(["count", "sum", "avg"]).optional().describe("Aggregate metric: count, sum, or avg"),
    metricField: z.string().optional().describe("Numeric field for sum/avg metrics"),
  }),
  async run(ctx, input) {
    const { intent, module: mod, filters, groupBy: groupByInput, metric: metricInput, metricField: metricFieldInput } = input;

    // Search records with the given filters
    let recordList: Record<string, unknown>[];
    try {
      const searchArgs: { module: ModuleKey; rules: FilterRule[] } = { module: mod, rules: filters ?? [] };
      const result = await searchRecords(ctx, searchArgs);
      recordList = result.records as unknown as Record<string, unknown>[];
    } catch (e) {
      const err = e instanceof AppError ? e.message : String(e);
      return {
        text: JSON.stringify({ error: `Could not query ${mod}: ${err}` }),
        spec: { type: "bar", title: intent, data: { labels: [], datasets: [] }, options: { color: "#ef4444" } },
        summary: `Error querying ${mod}.`,
        empty: true,
      };
    }

    if (!recordList.length) {
      return {
        text: JSON.stringify({ error: "No records found for this query." }),
        spec: { type: "bar", title: intent, data: { labels: [], datasets: [] }, options: {} },
        summary: "No data matches your query.",
        empty: true,
      };
    }

    // Determine chart type from intent keywords
    const intentLower = intent.toLowerCase();
    const isPie = intentLower.includes("pie") || intentLower.includes("breakdown") || intentLower.includes("distribution") || intentLower.includes("share of");
    const isLine = intentLower.includes("trend") || intentLower.includes("over time") || intentLower.includes("timeline") || intentLower.includes("growth");
    const isTable = intentLower.includes("table") || intentLower.includes("list") || intentLower.includes("grid");
    const chartType = isTable ? "table" : isPie ? "pie" : isLine ? "line" : "bar";

    // Default groupBy and metricField based on module
    const modDef = moduleDefs[mod];
    let groupField = groupByInput;
    let metricFieldResolved = metricFieldInput;
    let metricResolved: "count" | "sum" | "avg" = metricInput ?? "count";

    if (!groupField) {
      // Smart defaults based on module
      const defaults: Partial<Record<ModuleKey, { groupBy?: string; metricField?: string; metric?: "count" | "sum" | "avg" }>> = {
        Leads: { groupBy: "source", metric: "count" },
        Deals: { groupBy: "stage", metric: "sum", metricField: "amount" },
        Contacts: { groupBy: "company", metric: "count" },
        Accounts: { groupBy: "industry", metric: "count" },
        Products: { groupBy: "category", metric: "sum", metricField: "price" },
        Cases: { groupBy: "status", metric: "count" },
        Solutions: { groupBy: "category", metric: "count" },
        Tasks: { groupBy: "status", metric: "count" },
        Meetings: { groupBy: "status", metric: "count" },
        Calls: { groupBy: "status", metric: "count" },
        Vendors: { groupBy: "category", metric: "count" },
        Quotes: { groupBy: "status", metric: "sum", metricField: "total" },
        "Sales Orders": { groupBy: "status", metric: "sum", metricField: "total" },
        Invoices: { groupBy: "status", metric: "sum", metricField: "total" },
        "Purchase Orders": { groupBy: "status", metric: "sum", metricField: "total" },
      };
      const d = defaults[mod];
      if (d) {
        if (!groupField && d.groupBy) groupField = d.groupBy;
        if (!metricResolved && d.metric) metricResolved = d.metric;
        if (!metricFieldResolved && d.metricField) metricFieldResolved = d.metricField;
      }
      // Ultimate fallbacks
      if (!groupField) groupField = "stage";
      if (metricResolved === "sum" || metricResolved === "avg") {
        if (!metricFieldResolved) metricFieldResolved = "amount";
      }
    }

    const gf = groupField;
    const mf = metricFieldResolved;
    const metricType = metricResolved;

    // Aggregate data by the groupBy field
    const groups = new Map<string, { count: number; sum: number; values: number[] }>();
    for (const r of recordList) {
      const rec = r as Record<string, unknown>;
      const key = String(rec[gf] ?? rec.stage ?? rec.name ?? rec.company ?? rec.source ?? "Other");
      if (!groups.has(key)) groups.set(key, { count: 0, sum: 0, values: [] });
      const g = groups.get(key)!;
      g.count++;
      if (mf) {
        const v = typeof rec[mf] === "number" ? rec[mf] as number : 0;
        g.sum += isNaN(v) ? 0 : v;
        g.values.push(isNaN(v) ? 0 : v);
      }
    }

    const items = Array.from(groups.entries()).sort((a, b) => b[1].count - a[1].count).slice(0, 10);
    const labels = items.map((i) => i[0]);
    const values = items.map((i) => {
      const g = i[1];
      if (metricType === "count") return g.count;
      if (metricType === "sum") return g.sum;
      if (metricType === "avg") return g.values.length ? g.sum / g.values.length : 0;
      return g.count;
    });

    // Determine value label
    const isCurrency = mf && ["amount", "total", "price"].includes(mf);
    const valueLabel = isCurrency ? "Amount (₹)" : metricType === "count" ? "Count" : metricType === "avg" ? `Avg ${mf}` : `Sum ${mf}`;
    const title = intent;

    let spec;
    if (chartType === "table") {
      const columns = [gf, valueLabel];
      const rows = labels.map((label, i) => ({ [gf]: label, [valueLabel]: values[i] }));
      spec = { type: "table", title, columns, rows };
    } else if (chartType === "pie") {
      spec = { type: "pie", title, data: { labels, datasets: [{ data: values }] } };
    } else {
      const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#8b5cf6', '#ec4899', '#14b8a6'];
      spec = {
        type: chartType as "bar" | "line",
        title,
        data: {
          labels,
          datasets: [{
            label: valueLabel,
            data: values,
            backgroundColor: colors.slice(0, values.length),
            ...(chartType === "line" ? { borderColor: colors.slice(0, values.length), tension: 0.3 } : {}),
          }],
        },
        options: {},
      };
    }

    // Build summary text
    const total = values.reduce((a, b) => a + b, 0);
    const summary = `${labels.length} ${groupField} groups, ${metricType === "count" ? total + " records" : isCurrency ? `₹${total.toLocaleString()}` : total.toFixed(1) + " total"} across ${chartType} chart.`;

    return {
      text: JSON.stringify(spec),
      spec,
      summary,
      empty: false,
    };
  },
});

/**
 * render_echarts - arbitrary ECharts visualisation authored by the model.
 *
 * render_visual is limited to bar/pie/line/table. This is the escape hatch: the
 * model supplies any valid ECharts `option` object (sunburst, graph/force, tree,
 * sankey, heatmap, radar, …) and either fetches CRM records itself (module +
 * filters) or passes its own `data`. The sandboxed iframe loads ECharts and
 * renders whatever the option describes, so the chart type is unbounded.
 *
 * The option's `data` arrays are the only place record values land; the model
 * must not fabricate them - it passes real values from a prior search.
 */
defineTool({
  name: "render_echarts",
  title: "Render any ECharts visualisation",
  description:
    "Render ANY chart type via an ECharts option object: sunburst, force-directed graph, tree, treemap, sankey, heatmap, radar, scatter, funnel, chord, line, bar, pie - anything ECharts supports. Use this instead of render_visual whenever the request is for a non-bar/pie/line/table visual or a D3-style custom viz. Supply `echartsOption` (a valid ECharts option). To populate it from live CRM data, either pass `module` (+ optional `filters`) so the server queries and returns the records as `data`, or pass your own `data` array of records you already fetched. Reference the records inside the option via dataset.source or series[].data built from those records. Formatter callbacks may be given as JS function strings.",
  authority: "read",
  input: z.object({
    echartsOption: z.any().describe("A complete ECharts option object (title, series, dataset, etc.). The visualization type is whatever this describes."),
    module: z.string().optional().describe("Optional CRM module to query for the underlying records (e.g., 'Deals'). Ignored if data is provided."),
    filters: z.array(filterRule).optional().describe("Optional field filters applied when fetching from module"),
    data: z.array(z.any()).optional().describe("Optional explicit array of records to visualize (overrides module/fetch). Use records from a prior search_records call."),
    title: z.string().optional().describe("Short title for the visualization"),
  }),
  async run(ctx, { echartsOption, module: mod, filters, data, title }) {
    if (!echartsOption || typeof echartsOption !== "object") {
      return { text: JSON.stringify({ error: "echartsOption is required and must be an object." }), empty: true };
    }

    // Resolve the record set: explicit data wins, else fetch from the module.
    let records: Record<string, unknown>[] = [];
    if (Array.isArray(data)) {
      records = data as Record<string, unknown>[];
    } else if (mod) {
      if (!(moduleKeys as string[]).includes(mod)) {
        return { text: JSON.stringify({ error: `Unknown module: ${mod}` }), empty: true };
      }
      try {
        const result = await searchRecords(ctx, { module: mod as ModuleKey, rules: filters ?? [] });
        records = result.records as unknown as Record<string, unknown>[];
      } catch (e) {
        const err = e instanceof AppError ? e.message : String(e);
        return { text: JSON.stringify({ error: `Could not query ${mod}: ${err}` }), empty: true };
      }
    }

    if (!records.length && !Array.isArray(data)) {
      return {
        text: JSON.stringify({ error: `No records found${mod ? ` for ${mod}` : ""}.` }),
        empty: true,
      };
    }

    const payload = {
      isEcharts: true,
      title: title ?? "Visualization",
      echartsOption,
      data: records,
    };

    return {
      text: JSON.stringify(payload),
      ...payload,
      summary: `Rendered ${records.length} records as a custom ECharts visualization.`,
      empty: false,
    };
  },
});