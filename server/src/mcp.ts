/**
 * MCP (Model Context Protocol) server over Streamable HTTP, served by the same
 * Worker that hosts the web app, REST API and AI agent.
 *
 * Claude and other MCP-aware clients connect here and can call every CRM tool
 * the web UI uses (list_modules, search_records, create_record, convert_lead,
 * …). The tool registry in registry.ts is the single source of truth, so the
 * MCP surface is exactly the same as the REST and AI surfaces.
 *
 * Transport: Streamable HTTP (JSON-RPC 2.0 over POST, or SSE when the client
 * opts in with Accept: text/event-stream).
 * Auth (either works; a presented-but-invalid Bearer token is a 401, never a cookie fallback):
 *   1. OAuth 2.1 Bearer access token (Authorization: Bearer ...) obtained via /oauth/*. This is
 *      what Claude and other remote/programmatic MCP clients use. See oauth.ts.
 *   2. The browser's Gallivanter session cookie (gv_session), for the web UI. A logged-in
 * user's personal workspace is the default context; the `workspaceId` query
 * parameter, or the `workspaceId` arg on initialize, can select another one.
 */
import type { Context } from "hono";
import { currentUser } from "./auth.ts";
import { invokeTool, toolManifest, type Role, type ToolContext } from "./registry.ts";
import { personalWorkspace } from "./legacy.ts";
import { AppError, publicOrigin, type Env } from "./util.ts";
import { SCOPE, bearerPrincipal, readBearer } from "./oauth.ts";
// Importing the tool modules registers every tool in the registry. The MCP surface
// must not depend on index.ts happening to import them, so we pull them in here.
import "./tools/records.ts";
import "./tools/activities.ts";
import "./tools/sales.ts";
import "./tools/insight.ts";
import "./tools/workspace.ts";
import "./tools/viz.ts";

// ---------------- JSON-RPC 2.0 types ----------------

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}
interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// MCP Apps extension identifiers
const EXTENSION_ID = "io.modelcontextprotocol/ui";
const UI_RESOURCE_PREFIX = "ui://gallivanter/";
const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

// Known UI resources and their static asset paths
const uiResources: Record<string, { mimeType: string; assetPath: string; description: string }> = {
  "ui://gallivanter/pipeline-dashboard": {
    mimeType: MCP_APP_MIME_TYPE,
    assetPath: "widgets/pipeline-dashboard.html",
    description: "Interactive pipeline dashboard with bar charts of deals by stage",
  },
  "ui://gallivanter/chart-shell": {
    mimeType: MCP_APP_MIME_TYPE,
    assetPath: "widgets/chart-shell.html",
    description: "Generic chart rendering shell for inline visual charts",
  },
};

// Maps tool names to UI metadata injected into tools/call results.
// When a tool appears here, its result carries _meta.ui.resourceUri so the client
// knows to fetch the matching ui:// resource and render it in a sandboxed iframe.
const uiTools: Record<string, { ui: { resourceUri: string } }> = {
  render_visual: { ui: { resourceUri: "ui://gallivanter/chart-shell" } },
  pipeline_summary: { ui: { resourceUri: "ui://gallivanter/pipeline-dashboard" } },
};

// MCP protocol version we speak. Clients may offer their own; we accept anything
// but report ours so the client can adapt.
const PROTOCOL_VERSION = "2025-06-18";
const SERVER_NAME = "gallivanter";
const SERVER_VERSION = "0.1.0";

// ---------------- auth / context resolution ----------------

/** Build the WWW-Authenticate challenge (RFC 9728 + RFC 6750). `invalid_token` tells a client that
 * presented a bearer token to refresh it / re-authorize rather than treat the server as down. */
function challenge(origin: string, error?: "invalid_token"): string {
  const parts = [`resource_metadata="${origin}/.well-known/oauth-protected-resource"`, `scope="${SCOPE}"`];
  if (error) parts.unshift(`error="${error}"`, `error_description="The access token is invalid, expired or revoked"`);
  return `Bearer ${parts.join(", ")}`;
}

interface McpEnv {
  Bindings: Env;
}

/** Signaled when no valid MCP auth is present; the transport turns this into a
 * 401 with a WWW-Authenticate header pointing at our OAuth metadata. */
class AuthChallenge extends Error {
  constructor(public wwwAuthenticate: string) {
    super("Authentication required");
  }
}

/**
 * Resolve the ToolContext for an MCP request.
 * - The user must have a valid session cookie.
 * - Workspace defaults to the user's personal workspace, or the one selected via
 *   `workspaceId` query param / initialize arg. Must be a workspace they belong to.
 */
async function resolveContext(c: Context<McpEnv>, requestedWorkspaceId?: string): Promise<ToolContext> {
  // 1. OAuth Bearer token (Claude / app connectors).
  const origin = publicOrigin(c.env, new URL(c.req.url));
  const authz = c.req.header("Authorization");
  const principal = await bearerPrincipal(c.env, authz, origin);
  if (!principal && readBearer(authz)) {
    // A token was presented but is bad: do NOT fall back to the cookie. Tell the client to refresh.
    throw new AuthChallenge(challenge(origin, "invalid_token"));
  }
  if (principal) {
    const wsId = requestedWorkspaceId || principal.workspaceId;
    const role = wsId === principal.workspaceId ? principal.role : (await memberRole(c.env, wsId, principal.userId));
    if (!role) throw new AppError("forbidden", "You are not a member of that workspace.");
    return { env: c.env, db: c.env.DB, userId: principal.userId, workspaceId: wsId, role, source: "mcp" };
  }

  // 2. Browser session cookie (already logged into the web app).
  const user = await currentUser(c.env, c.req.header("Cookie"));
  if (!user) {
    throw new AuthChallenge(challenge(origin));
  }
  const wsId = requestedWorkspaceId || (await personalWorkspace(c.env, user));
  const role = await memberRole(c.env, wsId, user.id);
  if (!role) throw new AppError("forbidden", "You are not a member of that workspace.");
  return { env: c.env, db: c.env.DB, userId: user.id, workspaceId: wsId, role, source: "mcp" };
}

async function memberRole(env: Env, workspaceId: string, userId: string): Promise<Role | null> {
  const m = await env.DB.prepare("SELECT role FROM members WHERE workspace_id = ? AND user_id = ?")
    .bind(workspaceId, userId)
    .first<{ role: Role }>();
  return m?.role ?? null;
}

// ---------------- request handlers ----------------

function rpcSuccess(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
function rpcError(id: JsonRpcRequest["id"], code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

/** Standard MCP / JSON-RPC error codes. */
const ERROR = {
  Parse: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  Internal: -32603,
  ResourceNotFound: -32002,
  InvalidRequestEx: -32000,
} as const;

function toTool(t: { name: string; title: string; description: string; authority: string; inputSchema: unknown }) {
  return { name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema };
}

async function handleMethod(ctx: ToolContext, req: JsonRpcRequest): Promise<JsonRpcResponse> {
  const { method, id, params } = req;
  switch (method) {
    case "initialize": {
      return rpcSuccess(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: true },
          resources: { listChanged: true },
          extensions: { [EXTENSION_ID]: { mimeTypes: [MCP_APP_MIME_TYPE] } },
        },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions:
          "Gallivanter CRM over MCP. Use the tools in this registry to read and manage leads, contacts, accounts, deals, tasks, meetings, calls, products, quotes, sales orders, invoices, vendors, cases, and solutions. Call list_modules and describe_module first if you are unsure which module or field to use. Lookups take record ids.",
        workspaceId: ctx.workspaceId,
        role: ctx.role,
      });
    }

    case "notifications/initialized":
      // No-op: the client has finished the handshake.
      return rpcSuccess(null, null);

    case "ping":
      return rpcSuccess(id, {});

    case "tools/list": {
      return rpcSuccess(id, { tools: toolManifest(ctx.role).map(toTool) });
    }

    case "tools/call": {
      const p = (params ?? {}) as { name?: string; arguments?: unknown };
      if (!p.name) return rpcError(id, ERROR.InvalidParams, "tools/call requires a `name` field.");
      try {
        const result = await invokeTool(ctx, p.name, p.arguments ?? {});
        // Inject UI metadata for tools that declare a UI resource
        const uiMeta = uiTools[p.name];
        const response: Record<string, unknown> = {
          content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }],
          // MCP requires structuredContent to be a JSON object; arrays/strings travel in `content` only.
          ...(result !== null && typeof result === "object" && !Array.isArray(result) ? { structuredContent: result } : {}),
          isError: false,
          ...(uiMeta ? { _meta: uiMeta } : {}),
        };
        return rpcSuccess(id, response);
      } catch (e) {
        const appErr = e instanceof AppError ? e : null;
        const text = appErr?.message ?? (e instanceof Error ? e.message : String(e));
        const payload: Record<string, unknown> = {
          content: [{ type: "text", text }],
          ...(appErr?.details !== undefined ? { structuredContent: { error: appErr.details } } : {}),
        };
        return rpcSuccess(id, { ...payload, isError: true });
      }
    }

    case "resources/list": {
      const resources = Object.entries(uiResources).map(([uri, meta]) => ({
        uri,
        name: meta.description,
        mimeType: meta.mimeType,
        _meta: { ui: { resourceUri: uri } },
      }));
      return rpcSuccess(id, { resources });
    }

    case "resources/read": {
      const p = (params ?? {}) as { uri?: string };
      const uri = p.uri;
      if (!uri || !uri.startsWith(UI_RESOURCE_PREFIX)) {
        return rpcError(id, ERROR.ResourceNotFound, `Resource not found: ${uri ?? "(missing uri)"}`);
      }
      const meta = uiResources[uri];
      if (!meta) {
        return rpcError(id, ERROR.ResourceNotFound, `Resource not found: ${uri}`);
      }
      // Serve the static HTML bundle from ASSETS
      const assetResp = await ctx.env.ASSETS.fetch(new Request(`https://assets/${meta.assetPath}`));
      if (!assetResp.ok) {
        return rpcError(id, ERROR.ResourceNotFound, `Resource not found: ${uri}`);
      }
      const html = await assetResp.text();
      return rpcSuccess(id, {
        contents: [
          { uri, mimeType: meta.mimeType, text: html },
        ],
        _meta: { ui: { resourceUri: uri } },
      });
    }

    default:
      return rpcError(id, ERROR.MethodNotFound, `Method not found: ${method}`);
  }
}

/** Extract a workspaceId from the initialize params (if the client passed one). */
function workspaceFromParams(req: JsonRpcRequest): string | undefined {
  const p = (req.params ?? {}) as { workspaceId?: string };
  return typeof p.workspaceId === "string" && p.workspaceId ? p.workspaceId : undefined;
}

// ---------------- HTTP transport (Streamable HTTP) ----------------

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const wantsStream = (c: Context<McpEnv>) => (c.req.header("Accept") ?? "").includes("text/event-stream");

function sse(response: JsonRpcResponse): Response {
  const body = `event: message\ndata: ${JSON.stringify(response)}\n\n`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

export async function handleMcpPost(c: Context<McpEnv>): Promise<Response> {
  try {
    return await handleMcpPostInner(c);
  } catch (e) {
    if (e instanceof AuthChallenge) {
      // RFC 9728: 401 with WWW-Authenticate so the client can discover our
      // OAuth authorization server and start the sign-in flow.
      const resp = json(rpcError(null, ERROR.InvalidRequest, e.message), 401);
      resp.headers.set("WWW-Authenticate", e.wwwAuthenticate);
      return resp;
    }
    // Clear JSON-RPC error for an unauthenticated request so clients
    // (Claude) can distinguish a protocol error from an auth challenge.
    throw e;
  }
}

async function handleMcpPostInner(c: Context<McpEnv>): Promise<Response> {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return json(rpcError(null, ERROR.Parse, "Request body is not valid JSON."), 400);
  }

  // Batching: allow an array of requests, answer with an array.
  if (Array.isArray(payload)) {
    const requests = payload as JsonRpcRequest[];
    const context = await resolveContext(c, workspaceFromParams(requests[0] ?? ({} as JsonRpcRequest)));
    const results: JsonRpcResponse[] = [];
    for (const req of requests) {
      if (!req || req.jsonrpc !== "2.0" || typeof req.method !== "string") {
        results.push(rpcError((req as JsonRpcRequest)?.id ?? null, ERROR.InvalidRequest, "Invalid JSON-RPC request."));
        continue;
      }
      results.push(await handleMethod(context, req));
    }
    return json(results);
  }

  const req = payload as JsonRpcRequest;
  if (!req || req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return json(rpcError((req as JsonRpcRequest)?.id ?? null, ERROR.InvalidRequest, "Invalid JSON-RPC request."), 400);
  }

  const context = await resolveContext(c, workspaceFromParams(req));

  // Notifications have no id: respond 202 Accepted with no body.
  if (req.id === undefined) {
    await handleMethod(context, req);
    return new Response(null, { status: 202 });
  }

  const result = await handleMethod(context, req);
  return wantsStream(c) ? sse(result) : json(result);
}

export async function handleMcp(c: Context<McpEnv>): Promise<Response> {
  const method = c.req.method.toUpperCase();
  if (method === "POST") return handleMcpPost(c);
  if (method === "GET" || method === "HEAD") {
    // Streamable HTTP: a GET opens an SSE session. We don't persist sessions, so
    // the client should POST. Return a clear hint so it reconnects properly.
    return json(
      { error: { code: ERROR.InvalidRequest, message: "Use POST to send JSON-RPC requests. Streaming sessions are not persisted on this server." } },
      405,
    );
  }
  return json(rpcError(null, ERROR.MethodNotFound, `Unsupported method ${method}`), 405);
}