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