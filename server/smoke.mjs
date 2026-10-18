// End-to-end smoke test against a running local worker: node server/smoke.mjs [baseUrl]
const BASE = process.argv[2] ?? "http://127.0.0.1:8787";
let pass = 0, fail = 0;
const ok = (cond, label, extra) => { if (cond) { pass++; console.log("  ✓", label); } else { fail++; console.log("  ✗", label, extra ? JSON.stringify(extra).slice(0, 300) : ""); } };

async function login(email, name) {
  const r = await fetch(`${BASE}/api/auth/dev-login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, name }) });
  const { token, userId } = await r.json();
  const cookie = `gv_session=${token}`;
  const call = async (method, path, body) => {
    const res = await fetch(`${BASE}${path}`, { method, headers: { Cookie: cookie, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { userId, call };
}

const stamp = Date.now().toString(36);
console.log("Auth & workspaces");
ok((await (await fetch(`${BASE}/api/me`)).status) === 401, "unauthenticated /api/me → 401");
const alice = await login(`alice-${stamp}@example.com`, "Alice");
const bob = await login(`bob-${stamp}@example.com`, "Bob");
const ws = (await alice.call("POST", "/api/workspaces", { name: "Acme Sales" })).body;
ok(ws.id && ws.role === "owner", "create workspace", ws);
const me = (await alice.call("GET", "/api/me")).body;
ok(me.workspaces.some((w) => w.id === ws.id), "workspace listed in /api/me");
const tool = (who, name, input) => who.call("POST", `/api/w/${ws.id}/tools/${name}`, input);

console.log("Tools manifest");
const manifest = (await alice.call("GET", `/api/w/${ws.id}/tools`)).body;
ok(manifest.tools.length >= 35, `manifest has ${manifest.tools.length} tools`);
ok(manifest.tools.every((t) => t.inputSchema?.type === "object"), "every tool has a JSON schema");

console.log("Records");
const bad = await tool(alice, "create_record", { module: "Leads", values: { firstName: "No" } });
ok(bad.status === 400 && /required/i.test(bad.body.error.message), "validation rejects missing required fields", bad.body);
const lead = (await tool(alice, "create_record", { module: "Leads", values: { firstName: "Priya", lastName: "Sharma", company: "Globex", email: "priya@globex.com", status: "New", source: "LinkedIn", rating: "Hot" }, tags: ["vip"] })).body.result;
ok(lead?.id && lead.title === "Globex", "create lead", lead);
const badSelect = await tool(alice, "create_record", { module: "Leads", values: { lastName: "X", company: "Y", status: "Bogus" } });
ok(badSelect.status === 400, "select options enforced");
await tool(alice, "create_record", { module: "Leads", values: { lastName: "Kumar", company: "Initech", status: "Contacted", source: "Website" } });
const search = (await tool(alice, "search_records", { module: "Leads", query: "globex" })).body.result;
ok(search.total === 1 && search.records[0].id === lead.id, "free-text search");
const filtered = (await tool(alice, "search_records", { module: "Leads", rules: [{ field: "source", operator: "is", value: "linkedin" }] })).body.result;
ok(filtered.total === 1, "field filter (case-insensitive)");
const upd = (await tool(alice, "update_record", { id: lead.id, values: { rating: "Warm" }, expectedVersion: 1 })).body.result;
ok(upd.version === 2 && upd.values.rating === "Warm", "update with version check");
const stale = await tool(alice, "update_record", { id: lead.id, values: { rating: "Cold" }, expectedVersion: 1 });
ok(stale.status === 409, "stale version → 409 conflict");

console.log("Activities");
const note = (await tool(alice, "add_note", { recordId: lead.id, text: "Met at trade show" })).body.result;
ok(note?.id, "add note");
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
await tool(alice, "create_task", { subject: "Send proposal", dueDate: yesterday, relatedId: lead.id, priority: "High" });
const task2 = (await tool(alice, "create_task", { subject: "Follow-up call", dueDate: today })).body.result;
const agenda = (await tool(alice, "list_agenda", {})).body.result;
ok(agenda.overdueTasks.length === 1 && agenda.upcomingTasks.length === 1, "agenda overdue/upcoming", agenda);
await tool(alice, "complete_task", { taskId: task2.id });
const agenda2 = (await tool(alice, "list_agenda", {})).body.result;
ok(agenda2.upcomingTasks.length === 0, "completed task leaves agenda");

console.log("Sales");
const conv = (await tool(alice, "convert_lead", { leadId: lead.id, createDeal: true, amount: "50000", closingDate: "2026-12-31" })).body.result;
ok(conv?.accountId && conv.contactId && conv.dealId, "convert lead → account, contact, deal", conv);
const again = (await tool(alice, "convert_lead", { leadId: lead.id })).body.result;
ok(again.alreadyConverted, "conversion is idempotent");
await tool(alice, "move_deal_stage", { dealId: conv.dealId, stage: "Negotiation/Review" });
const pipe = (await tool(alice, "pipeline_summary", {})).body.result;
ok(pipe.openDeals === 1 && pipe.openAmount === 50000 && pipe.weightedAmount === 37500, "pipeline summary", pipe);
const ctx = (await tool(alice, "get_record", { id: conv.accountId })).body.result;
ok(ctx.referencedBy.length >= 2, "get_record shows referencing contact+deal", ctx.referencedBy);

console.log("Inventory");
const product = (await tool(alice, "create_record", { module: "Products", values: { productName: "CRM Seat", unitPrice: "1000" } })).body.result;
const quote = (await tool(alice, "create_record", { module: "Quotes", values: { quoteName: "Globex Q1", accountId: conv.accountId, stage: "Draft" } })).body.result;
const li = (await tool(alice, "set_line_items", { recordId: quote.id, items: [{ productId: product.id, quantity: 10, price: 1000, discount: 10, tax: 18 }] })).body.result;
ok(li?.totals?.total === 10620, "line item totals (10×1000 −10% +18%)", li?.totals);
const so = (await tool(alice, "convert_quote_to_sales_order", { quoteId: quote.id })).body.result;
ok(so?.module === "Sales Orders" && so.values.quoteId === quote.id, "quote → sales order", so);
const inv = (await tool(alice, "convert_sales_order_to_invoice", { salesOrderId: so.id })).body.result;
const invFull = (await tool(alice, "get_record", { id: inv.id })).body.result;
ok(invFull.lineItems.length === 1 && inv.values.status === "Draft", "sales order → invoice with line items");

console.log("Reports");
const rep = (await tool(alice, "run_report", { module: "Leads", groupBy: "source" })).body.result;
ok(rep.rows.length === 2, "report: leads by source", rep);
const sum = (await tool(alice, "run_report", { module: "Deals", groupBy: "stage", metric: "sum", metricField: "amount" })).body.result;
ok(sum.rows[0]?.value === 50000, "report: deal amount by stage", sum);
const dash = (await tool(alice, "dashboard_summary", {})).body.result;
ok(dash.openDeals === 1 && dash.overdueTasks === 1, "dashboard summary", dash);

console.log("Teams & permissions");
ok((await tool(bob, "search_records", {})).status === 403, "non-member is blocked");
const invite = (await tool(alice, "invite_member", { email: `bob-${stamp}@example.com`, role: "viewer" })).body.result;
const accept = await bob.call("POST", `/api/invites/${invite.invitePath.split("/").pop()}/accept`);
ok(accept.status === 200, "bob accepts invite", accept.body);
ok((await tool(bob, "search_records", { module: "Leads" })).status === 200, "viewer can read");
ok((await tool(bob, "create_record", { module: "Leads", values: { lastName: "Z", company: "Z" } })).status === 403, "viewer cannot write");
const bobManifest = (await bob.call("GET", `/api/w/${ws.id}/tools`)).body;
ok(bobManifest.tools.every((t) => t.authority === "read"), "viewer manifest only has read tools");

console.log("Recycle bin & history");
await tool(alice, "delete_record", { id: product.id });
ok((await tool(alice, "search_records", { module: "Products" })).body.result.total === 0, "deleted record hidden");
ok((await tool(alice, "search_records", { deletedOnly: true })).body.result.total === 1, "recycle bin lists it");
await tool(alice, "restore_record", { id: product.id });
const hist = (await tool(alice, "record_history", { id: lead.id })).body.result;
ok(hist.length >= 4 && hist.every((h) => h.source === "ui"), "audit trail recorded", hist.map((h) => h.action));
const changes = (await tool(alice, "changes_since", { since: "" })).body.result;
ok(changes.records.length >= 10, `changes_since returns ${changes.records.length} records`);


console.log("MCP OAuth 2.1 (bearer tokens)");
{
  const { webcrypto } = await import("node:crypto");
  const b64u = (buf) => Buffer.from(buf).toString("base64url");
  const dev = await (await fetch(`${BASE}/api/auth/dev-login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `oauth-${stamp}@example.com`, name: "OAuth User" }) })).json();
  const cookie = `gv_session=${dev.token}`;
  const redirect = "http://127.0.0.1:53682/callback";
  const manual = { redirect: "manual" };
  const post = (path, body, headers = {}) => fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const form = (path, fields, headers = {}) => fetch(`${BASE}${path}`, { method: "POST", ...manual, headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(fields) });
  const rpc = (headers, method = "tools/list", params = {}) => fetch(`${BASE}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const pkce = async () => { const verifier = b64u(webcrypto.getRandomValues(new Uint8Array(32))); return { verifier, challenge: b64u(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))) }; };
  const authUrl = (clientId, challenge, extra = {}) => `${BASE}/oauth/authorize?` + new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirect, state: "st123", code_challenge: challenge, code_challenge_method: "S256", ...extra });

  // discovery + challenge
  const noAuth = await rpc({});
  ok(noAuth.status === 401 && /resource_metadata=/.test(noAuth.headers.get("www-authenticate") ?? ""), "unauthenticated /mcp → 401 + resource_metadata", noAuth.headers.get("www-authenticate"));
  const prm = await (await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)).json();
  ok(prm.resource?.endsWith("/mcp") && prm.authorization_servers?.length === 1, "protected-resource metadata (RFC 9728, path-suffixed)", prm);
  const asm = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
  ok(asm.code_challenge_methods_supported?.join() === "S256" && asm.registration_endpoint && asm.revocation_endpoint, "AS metadata: S256 only, registration + revocation", asm);
  const preflight = await fetch(`${BASE}/mcp`, { method: "OPTIONS", headers: { Origin: "https://inspector.example", "Access-Control-Request-Method": "POST" } });
  ok(preflight.status === 204 && preflight.headers.get("access-control-allow-origin") === "*", "CORS preflight on /mcp");

  // dynamic registration (RFC 7591)
  const evil = await post("/oauth/register", { client_name: "x", redirect_uris: ["http://evil.example/cb"] });
  ok(evil.status === 400 && (await evil.json()).error === "invalid_redirect_uri", "registration rejects plain-http non-loopback redirect");
  const reg = await (await post("/oauth/register", { client_name: "Smoke Client", redirect_uris: [redirect], token_endpoint_auth_method: "none" })).json();
  ok(reg.client_id && reg.registration_access_token && reg.registration_client_uri, "register client (RFC 7591 + 7592 fields)", reg);
  const clientId = reg.client_id;

  // authorization endpoint
  const p1 = await pkce();
  const noCookie = await fetch(authUrl(clientId, p1.challenge), manual);
  ok(noCookie.status === 302 && /\/api\/auth\/google\?next=/.test(noCookie.headers.get("location") ?? ""), "signed-out user is bounced through Google login");
  const noPkce = await fetch(`${BASE}/oauth/authorize?` + new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirect, state: "s" }), { ...manual, headers: { Cookie: cookie } });
  ok(noPkce.status === 302 && /error=invalid_request/.test(noPkce.headers.get("location") ?? ""), "PKCE is mandatory (redirects with invalid_request)");
  const wrongRedirect = await fetch(authUrl(clientId, p1.challenge, { redirect_uri: "http://evil.example/cb" }), { ...manual, headers: { Cookie: cookie } });
  ok(wrongRedirect.status === 400, "unregistered redirect_uri is never redirected to");

  const getCode = async (clientIdArg = clientId) => {
    const pk = await pkce();
    const page = await fetch(authUrl(clientIdArg, pk.challenge), { ...manual, headers: { Cookie: cookie } });
    const html = await page.text();
    const consent = /name="consent" value="([^"]+)"/.exec(html)?.[1];
    return { pk, page, consent, approve: async (decision = "approve", headers = { Cookie: cookie }) => form("/oauth/authorize", { consent, decision }, headers) };
  };
  const c1 = await getCode();
  ok(c1.page.status === 200 && c1.consent, "signed-in user gets a consent screen (no silent approval)");
  const anon = await c1.approve("approve", {});
  ok(anon.status === 400, "consent POST without the session cookie is rejected");
  const denied = await (await getCode()).approve("deny");
  ok(denied.status === 303 && /error=access_denied/.test(denied.headers.get("location") ?? ""), "deny → access_denied redirect");
  const approved = await c1.approve();
  const loc = new URL(approved.headers.get("location") ?? "http://x/");
  const code = loc.searchParams.get("code");
  ok(approved.status === 303 && code && loc.searchParams.get("state") === "st123" && loc.origin === new URL(redirect).origin, "approve → code + state redirected to the client callback", approved.headers.get("location"));

  // token endpoint
  const bad = await form("/oauth/token", { grant_type: "authorization_code", code, code_verifier: (await pkce()).verifier, client_id: clientId, redirect_uri: redirect });
  ok(bad.status === 400 && (await bad.json()).error === "invalid_grant", "wrong code_verifier → invalid_grant");
  const c2 = await getCode();
  const code2 = new URL((await c2.approve()).headers.get("location")).searchParams.get("code");
  const tokenReq = { grant_type: "authorization_code", code: code2, code_verifier: c2.pk.verifier, client_id: clientId, redirect_uri: redirect };
  const t1 = await (await form("/oauth/token", tokenReq)).json();
  ok(t1.access_token && t1.refresh_token && t1.token_type === "Bearer" && t1.expires_in === 900, "code + PKCE verifier → access & refresh token", t1);
  const replay = await form("/oauth/token", tokenReq);
  ok(replay.status === 400, "authorization code is single-use");
  const dead = await form("/oauth/token", { grant_type: "refresh_token", refresh_token: t1.refresh_token, client_id: clientId });
  ok(dead.status === 400, "code replay revokes the refresh-token family it produced");

  // fresh session for the rest
  const c3 = await getCode();
  const code3 = new URL((await c3.approve()).headers.get("location")).searchParams.get("code");
  const t2 = await (await form("/oauth/token", { grant_type: "authorization_code", code: code3, code_verifier: c3.pk.verifier, client_id: clientId, redirect_uri: redirect })).json();

  // resource server (mcp.ts)
  const bearer = { Authorization: `Bearer ${t2.access_token}` };
  const listed = await (await rpc(bearer)).json();
  ok(Array.isArray(listed.result?.tools) && listed.result.tools.length > 0, `Bearer token authenticates /mcp (${listed.result?.tools?.length} tools)`, listed);
  const init = await (await rpc(bearer, "initialize")).json();
  ok(init.result?.workspaceId && init.result?.role === "owner", "bearer context resolves workspace + role", init);
  const junk = await rpc({ Authorization: "Bearer not.a.token" });
  ok(junk.status === 401 && /invalid_token/.test(junk.headers.get("www-authenticate") ?? ""), "garbage bearer → 401 invalid_token");
  const bearerWinsOverCookie = await rpc({ Authorization: "Bearer not.a.token", Cookie: cookie });
  ok(bearerWinsOverCookie.status === 401, "a bad bearer does not fall back to the cookie");
  const viaCookie = await (await rpc({ Cookie: cookie })).json();
  ok(Array.isArray(viaCookie.result?.tools), "session-cookie auth still works for the web UI");

  // MCP Apps: extensions capability + resources (ui://)
  ok(init.result?.capabilities?.extensions?.["io.modelcontextprotocol/ui"] !== undefined, "initialize advertises MCP Apps extension", init);
  const resList = await (await rpc(bearer, "resources/list")).json();
  ok(resList.result?.resources?.length > 0 && resList.result.resources[0].uri === "ui://gallivanter/pipeline-dashboard", "resources/list returns pipeline-dashboard ui resource", resList);
  const resRead = await (await rpc(bearer, "resources/read", { uri: "ui://gallivanter/pipeline-dashboard" })).json();
  ok(resRead.result?.contents?.[0]?.mimeType === "text/html;profile=mcp-app" && resRead.result.contents[0].text.includes("Pipeline Dashboard"), "resources/read returns HTML widget bundle", resRead.result?.contents?.[0]?.mimeType);
  const pipeResult = await (await rpc(bearer, "tools/call", { name: "pipeline_summary", arguments: {} })).json();
  ok(pipeResult.result?._meta?.ui?.resourceUri === "ui://gallivanter/pipeline-dashboard", "pipeline_summary tool call includes _meta.ui.resourceUri", pipeResult);

  // render_visual tool returns a chart spec with _meta.ui.resourceUri
  const rvResult = await (await rpc(bearer, "tools/call", { name: "render_visual", arguments: { intent: "Bar chart of deals by stage", module: "Deals", groupBy: "stage" } })).json();
  ok(rvResult.result?._meta?.ui?.resourceUri === "ui://gallivanter/chart-shell", "render_visual tool call includes _meta.ui.resourceUri", rvResult);
  let rvStruct;
  try { rvStruct = JSON.parse(rvResult.result.structuredContent.text); } catch { }
  ok(rvResult.result.structuredContent?.spec?.type === "bar", "render_visual returns a chart spec with type", rvResult);

  // render_echarts: arbitrary ECharts viz with _meta.ui.resourceUri + echo of the option
  const reArgs = { echartsOption: { series: [{ type: "sunburst", data: [{ name: "A", value: 1 }] }] }, data: [{ name: "A", value: 1 }], title: "Sunburst" };
  const reResult = await (await rpc(bearer, "tools/call", { name: "render_echarts", arguments: reArgs })).json();
  ok(reResult.result?._meta?.ui?.resourceUri === "ui://gallivanter/echarts-shell", "render_echarts tool call includes _meta.ui.resourceUri", reResult);
  ok(reResult.result?.structuredContent?.isEcharts === true && reResult.result.structuredContent?.echartsOption?.series?.[0]?.type === "sunburst", "render_echarts echoes the authored echartsOption", reResult.result?.structuredContent);
  const reResRead = await (await rpc(bearer, "resources/read", { uri: "ui://gallivanter/echarts-shell" })).json();
  ok(reResRead.result?.contents?.[0]?.text?.includes("echarts"), "resources/read returns the echarts-shell widget bundle", reResRead.result?.contents?.[0]?.mimeType);

  // refresh rotation + reuse detection
  const r1 = await (await form("/oauth/token", { grant_type: "refresh_token", refresh_token: t2.refresh_token, client_id: clientId })).json();
  ok(r1.access_token && r1.refresh_token && r1.refresh_token !== t2.refresh_token, "refresh token rotates");
  const reuse = await form("/oauth/token", { grant_type: "refresh_token", refresh_token: t2.refresh_token, client_id: clientId });
  ok(reuse.status === 400, "reusing a rotated refresh token is rejected");
  const familyDead = await form("/oauth/token", { grant_type: "refresh_token", refresh_token: r1.refresh_token, client_id: clientId });
  ok(familyDead.status === 400, "reuse detection revokes the newest token too");

  // client management (RFC 7592) + revocation
  const noTok = await fetch(`${BASE}/oauth/register/${clientId}`);
  ok(noTok.status === 401, "client management requires the registration access token");
  const mgmt = { Authorization: `Bearer ${reg.registration_access_token}` };
  const info = await (await fetch(`${BASE}/oauth/register/${clientId}`, { headers: mgmt })).json();
  ok(info.client_id === clientId && info.client_name === "Smoke Client", "GET client configuration", info);
  const upd = await (await fetch(`${BASE}/oauth/register/${clientId}`, { method: "PUT", headers: { ...mgmt, "Content-Type": "application/json" }, body: JSON.stringify({ client_id: clientId, client_name: "Renamed", redirect_uris: [redirect] }) })).json();
  ok(upd.client_name === "Renamed", "PUT client configuration", upd);
  const c4 = await getCode();
  const t3 = await (await form("/oauth/token", { grant_type: "authorization_code", code: new URL((await c4.approve()).headers.get("location")).searchParams.get("code"), code_verifier: c4.pk.verifier, client_id: clientId, redirect_uri: redirect })).json();
  await form("/oauth/revoke", { token: t3.refresh_token, client_id: clientId });
  ok((await form("/oauth/token", { grant_type: "refresh_token", refresh_token: t3.refresh_token, client_id: clientId })).status === 400, "POST /oauth/revoke kills the refresh token");
  const del = await fetch(`${BASE}/oauth/register/${clientId}`, { method: "DELETE", headers: mgmt });
  ok(del.status === 204, "DELETE client configuration");
  const gone = await fetch(authUrl(clientId, p1.challenge), { ...manual, headers: { Cookie: cookie } });
  ok(gone.status === 400, "deleted client can no longer start authorization");
}

console.log("Original UI sync (/api/legacy)");
const carol = await login(`carol-${stamp}@example.com`, "Carol");
const snap0 = (await carol.call("GET", "/api/legacy/snapshot")).body;
ok(snap0.workspaceId && snap0.initialized.length === 0, "snapshot auto-creates a personal workspace", snap0);
const up = (await carol.call("POST", "/api/legacy/sync/Contacts", { upserts: [
  { id: `c-${stamp}-1`, values: { firstName: "Kris", lastName: "Marrier", accountName: "King", owner: "You" }, extra: { notes: [{ id: "n1", title: "Note", text: "hi", at: "2026-10-16T00:00:00Z" }], timeline: [] } },
  { id: `c-${stamp}-2`, values: { firstName: "Sage", lastName: "Wieser" } },
] })).body;
ok(up.created === 2 && up.errors.length === 0, "legacy upsert creates records (free-text owner allowed)", up);
const up2 = (await carol.call("POST", "/api/legacy/sync/Contacts", { upserts: [{ id: `c-${stamp}-1`, values: { firstName: "Kris", lastName: "Marrier" } }], deletes: [`c-${stamp}-2`] })).body;
ok(up2.updated === 1 && up2.deleted === 1, "legacy update + delete", up2);
const snap1 = (await carol.call("GET", "/api/legacy/snapshot")).body;
const kris = snap1.modules.Contacts.find((r) => r.id === `c-${stamp}-1`);
ok(snap1.initialized.includes("Contacts") && kris && !kris.values.accountName && kris.extra.notes.length === 1, "snapshot reflects changes, removed keys cleared, extra kept", kris);
ok(snap1.modules.Contacts.find((r) => r.id === `c-${stamp}-2`)?.deletedAt, "deleted record is in recycle bin");
const viaTool = (await carol.call("POST", `/api/w/${snap1.workspaceId}/tools/search_records`, { module: "Contacts", query: "kris" })).body.result;
ok(viaTool.total === 1, "records saved by the original UI are visible to AI/MCP tools");
const clash = (await carol.call("POST", "/api/legacy/sync/Contacts", { upserts: [{ id: lead.id, values: { lastName: "x" } }] })).body;
ok(clash.errors.length === 1, "cannot overwrite another workspace's record id", clash);
const ai = (await carol.call("GET", "/api/ai/status")).body;
ok(typeof ai.keys === "number" && ai.baseUrl.includes("vyceai"), "AI status endpoint", ai);
const legacyStatus = (await fetch(`${BASE}/api/auth/status`)).status;
ok(legacyStatus === 200, "legacy /api/auth/status responds");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
