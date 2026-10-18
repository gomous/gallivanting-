/**
 * OAuth 2.1 authorization server for the MCP endpoint, hosted on the same Worker.
 *
 * An MCP client connects to /mcp, gets 401 + WWW-Authenticate pointing at our
 * protected-resource metadata, and from there discovers:
 *   - /.well-known/oauth-protected-resource[/mcp]  (RFC 9728: resource + authorization_servers)
 *   - /.well-known/oauth-authorization-server      (RFC 8414: endpoints, scopes, PKCE)
 *   - POST /oauth/register                         (RFC 7591 dynamic client registration)
 *   - GET|PUT|DELETE /oauth/register/:client_id    (RFC 7592 client configuration management)
 *   - GET  /oauth/authorize                        (browser: sign in via Google, consent screen)
 *   - POST /oauth/authorize                        (consent decision -> authorization code)
 *   - POST /oauth/token                            (code / refresh_token grants)
 *   - POST /oauth/revoke                           (RFC 7009)
 *
 * Access tokens are short-lived signed JWTs (HMAC-SHA256 keyed from TOKEN_KEY, audience =
 * the canonical /mcp URL). Authorization codes and refresh tokens are single-use opaque
 * strings stored hashed in D1. Refresh tokens rotate on every use and belong to a "family"
 * that is revoked wholesale if a code or refresh token is ever replayed.
 *
 * Security posture (OAuth 2.1): PKCE with S256 is mandatory, redirect URIs are matched
 * exactly (loopback ports may vary), every authorization needs an explicit consent click
 * (dynamic registration is open, so auto-approving would be an account-takeover vector),
 * and the user's *current* workspace role is re-checked on every request and refresh.
 */
import type { Context } from "hono";
import { newId, nowIso, parseJson, publicOrigin, randomToken, sha256, b64url, type Env } from "./util.ts";
import { currentUser } from "./auth.ts";
import { personalWorkspace } from "./legacy.ts";
import type { Role } from "./registry.ts";

export const SCOPE = "gallivanter";
const ACCESS_TOKEN_SECONDS = 15 * 60; // 15 min
const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60; // 30 days
const CODE_SECONDS = 5 * 60; // 5 min
const CONSENT_SECONDS = 10 * 60; // consent form must be submitted within 10 min
const CONSENT_AUD = "gallivanter:consent";

type Ctx = Context<{ Bindings: Env }>;

const te = new TextEncoder();

// ---------------- JWT (HMAC-SHA256, key derived from TOKEN_KEY) ----------------

function b64decode(text: string): Uint8Array {
  const norm = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(norm + "=".repeat((4 - (norm.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacKey(env: Env): Promise<CryptoKey> {
  if (!env.TOKEN_KEY) throw new Error("TOKEN_KEY secret is not configured.");
  const digest = await crypto.subtle.digest("SHA-256", te.encode(env.TOKEN_KEY));
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signJwt(env: Env, claims: Record<string, unknown>): Promise<string> {
  const enc = (v: unknown) => b64url(te.encode(JSON.stringify(v)));
  const body = `${enc({ alg: "HS256", typ: "JWT" })}.${enc(claims)}`;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env), te.encode(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

/** Verify signature, expiry, audience and token type. Returns the claims or null. */
async function verifyJwt(env: Env, token: string, aud: string, type: string): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const key = await hmacKey(env); // a missing TOKEN_KEY is a config error, not a bad token
  try {
    const ok = await crypto.subtle.verify("HMAC", key, b64decode(parts[2]), te.encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const claims = JSON.parse(new TextDecoder().decode(b64decode(parts[1]))) as Record<string, unknown>;
    if (typeof claims.exp !== "number" || claims.exp < Date.now() / 1000) return null;
    if (claims.aud !== aud || claims.type !== type) return null;
    return claims;
  } catch {
    return null;
  }
}

// ---------------- small helpers ----------------

const json = (body: unknown, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache", ...extra },
  });

const oauthError = (error: string, description: string, status = 400): Response =>
  json({ error, error_description: description }, status);

/** Extract the token from an `Authorization: Bearer <token>` header. */
export function readBearer(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return m ? m[1] : null;
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const PAGE_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  // No form-action: browsers apply it to the post-submit redirect too, which must reach the client's callback.
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
};

const PAGE_STYLE = `body{font-family:system-ui,sans-serif;max-width:34rem;margin:4rem auto;padding:0 1.5rem;color:#1a1a1a}
h1{font-size:1.4rem}.card{border:1px solid #ddd;border-radius:12px;padding:1.25rem 1.5rem;margin:1.5rem 0}
.muted{color:#666;font-size:.9rem}.row{display:flex;gap:.75rem;margin-top:1.5rem}
button{font:inherit;padding:.65rem 1.25rem;border-radius:8px;border:1px solid #ccc;background:#fff;cursor:pointer}
button.primary{background:#1a1a1a;color:#fff;border-color:#1a1a1a}code{background:#f3f3f3;padding:.1rem .35rem;border-radius:4px}`;

function page(title: string, body: string, status = 200): Response {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${PAGE_STYLE}</style><body>${body}</body>`, {
    status,
    headers: PAGE_HEADERS,
  });
}

const errorPage = (description: string): Response =>
  page("Gallivanter sign-in failed", `<h1>Unable to continue</h1><p>${esc(description)}</p>`, 400);

async function currentRole(env: Env, workspaceId: string, userId: string): Promise<Role | null> {
  const m = await env.DB.prepare("SELECT role FROM members WHERE workspace_id = ? AND user_id = ?")
    .bind(workspaceId, userId)
    .first<{ role: Role }>();
  return m?.role ?? null;
}

// ---------------- redirect URI rules ----------------

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const FORBIDDEN_SCHEMES = new Set(["javascript:", "data:", "vbscript:", "file:", "about:", "blob:"]);

const isLoopback = (u: URL): boolean => u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname);

/** https, loopback http (RFC 8252), or a custom app scheme (e.g. cursor://). No fragments. */
function validRedirectUri(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === "https:") return true;
  if (isLoopback(u)) return true;
  return u.protocol !== "http:" && !FORBIDDEN_SCHEMES.has(u.protocol);
}

/** Exact match; for registered loopback URIs the port may differ (RFC 8252 section 7.3). */
function redirectAllowed(registered: string[], requested: string): boolean {
  let req: URL;
  try {
    req = new URL(requested);
  } catch {
    return false;
  }
  if (req.hash) return false;
  for (const r of registered) {
    if (r === requested) return true;
    try {
      const reg = new URL(r);
      if (isLoopback(reg) && isLoopback(req) && reg.hostname === req.hostname && reg.pathname === req.pathname && reg.search === req.search) return true;
    } catch {
      /* ignore malformed registered URI */
    }
  }
  return false;
}

// ---------------- metadata discovery ----------------

/** RFC 9728 protected-resource metadata: tells clients which AS to use. */
export function resourceMetadata(c: Ctx): Response {
  const origin = publicOrigin(c.env, new URL(c.req.url));
  return json({
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Gallivanter CRM",
    resource_documentation: `${origin}/`,
  });
}

/** RFC 8414 authorization-server metadata: endpoints, scopes, PKCE, DCR. */
export function authServerMetadata(c: Ctx): Response {
  const origin = publicOrigin(c.env, new URL(c.req.url));
  return json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    scopes_supported: [SCOPE],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    authorization_response_iss_parameter_supported: true,
  });
}

// ---------------- dynamic client registration (RFC 7591) + management (RFC 7592) ----------------

interface ClientRow {
  client_id: string;
  name: string;
  redirect_uris: string;
  registration_token_hash: string;
  created_at: string;
}

type ClientMeta = { ok: true; name: string; redirectUris: string[] } | { ok: false; error: string; description: string };

const bad = (error: string, description: string): ClientMeta => ({ ok: false, error, description });

function parseClientMetadata(body: Record<string, unknown>): ClientMeta {
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10) {
    return bad("invalid_redirect_uri", "redirect_uris must be an array of 1 to 10 URIs.");
  }
  const redirectUris: string[] = [];
  for (const u of uris) {
    if (typeof u !== "string" || !validRedirectUri(u)) {
      return bad("invalid_redirect_uri", "Redirect URIs must be https, loopback http (localhost / 127.0.0.1), or a custom app scheme, with no fragment.");
    }
    redirectUris.push(u);
  }
  const method = body.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") {
    return bad("invalid_client_metadata", 'Only token_endpoint_auth_method "none" (public clients using PKCE) is supported.');
  }
  const grants = body.grant_types;
  if (grants !== undefined) {
    const ok = Array.isArray(grants) && grants.includes("authorization_code") && grants.every((g) => g === "authorization_code" || g === "refresh_token");
    if (!ok) return bad("invalid_client_metadata", "grant_types must include authorization_code and may include refresh_token.");
  }
  const responses = body.response_types;
  if (responses !== undefined && !(Array.isArray(responses) && responses.every((r) => r === "code"))) {
    return bad("invalid_client_metadata", 'response_types may only contain "code".');
  }
  const name = (typeof body.client_name === "string" ? body.client_name.trim() : "").slice(0, 100) || "MCP client";
  return { ok: true, name, redirectUris };
}

function clientInfo(origin: string, row: Pick<ClientRow, "client_id" | "name" | "redirect_uris" | "created_at">): Record<string, unknown> {
  return {
    client_id: row.client_id,
    client_id_issued_at: Math.floor(new Date(row.created_at).getTime() / 1000),
    client_name: row.name,
    redirect_uris: parseJson<string[]>(row.redirect_uris, []),
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: SCOPE,
    registration_client_uri: `${origin}/oauth/register/${row.client_id}`,
  };
}

export async function clientRegister(c: Ctx): Promise<Response> {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return oauthError("invalid_client_metadata", "Body must be a JSON object.");
  const meta = parseClientMetadata(body);
  if (!meta.ok) return oauthError(meta.error, meta.description);

  const origin = publicOrigin(c.env, new URL(c.req.url));
  const clientId = newId("cl");
  const registrationToken = randomToken(32);
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO oauth_clients (client_id, client_secret, name, redirect_uris, grant_types, response_types, token_endpoint_auth_method, registration_token_hash, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).bind(clientId, "", meta.name, JSON.stringify(meta.redirectUris), JSON.stringify(["authorization_code", "refresh_token"]), JSON.stringify(["code"]), "none", await sha256(registrationToken), now).run();

  return json(
    { ...clientInfo(origin, { client_id: clientId, name: meta.name, redirect_uris: JSON.stringify(meta.redirectUris), created_at: now }), registration_access_token: registrationToken },
    201,
  );
}

/** RFC 7592: the registration_access_token authenticates management calls. Unknown ids get the same 401 (no enumeration). */
async function registrationClient(c: Ctx, clientId: string): Promise<ClientRow | Response> {
  const presented = readBearer(c.req.header("Authorization"));
  const row = await c.env.DB.prepare("SELECT * FROM oauth_clients WHERE client_id = ?").bind(clientId).first<ClientRow>();
  if (!presented || !row || !row.registration_token_hash || (await sha256(presented)) !== row.registration_token_hash) {
    return json({ error: "invalid_token", error_description: "Missing or invalid registration access token." }, 401, { "WWW-Authenticate": 'Bearer error="invalid_token"' });
  }
  return row;
}

export async function clientRead(c: Ctx): Promise<Response> {
  const r = await registrationClient(c, c.req.param("client_id") ?? "");
  if (r instanceof Response) return r;
  return json(clientInfo(publicOrigin(c.env, new URL(c.req.url)), r));
}

export async function clientUpdate(c: Ctx): Promise<Response> {
  const clientId = c.req.param("client_id") ?? "";
  const r = await registrationClient(c, clientId);
  if (r instanceof Response) return r;
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return oauthError("invalid_client_metadata", "Body must be a JSON object.");
  if (body.client_id !== undefined && body.client_id !== clientId) return oauthError("invalid_client_metadata", "client_id in the body does not match the URL.");
  const meta = parseClientMetadata(body);
  if (!meta.ok) return oauthError(meta.error, meta.description);
  await c.env.DB.prepare("UPDATE oauth_clients SET name = ?, redirect_uris = ? WHERE client_id = ?").bind(meta.name, JSON.stringify(meta.redirectUris), clientId).run();
  return json(clientInfo(publicOrigin(c.env, new URL(c.req.url)), { ...r, name: meta.name, redirect_uris: JSON.stringify(meta.redirectUris) }));
}

/** Deleting a client also kills every code and refresh token it was issued. */
export async function clientDelete(c: Ctx): Promise<Response> {
  const clientId = c.req.param("client_id") ?? "";
  const r = await registrationClient(c, clientId);
  if (r instanceof Response) return r;
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM oauth_refresh_tokens WHERE client_id = ?").bind(clientId),
    c.env.DB.prepare("DELETE FROM oauth_codes WHERE client_id = ?").bind(clientId),
    c.env.DB.prepare("DELETE FROM oauth_clients WHERE client_id = ?").bind(clientId),
  ]);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

// ---------------- authorization endpoint ----------------

/** The client row, only if the redirect_uri is registered for it. Never redirect to an unvalidated URI. */
async function lookupClient(env: Env, clientId: string, redirectUri: string): Promise<{ name: string } | null> {
  if (!clientId || !redirectUri) return null;
  const row = await env.DB.prepare("SELECT name, redirect_uris FROM oauth_clients WHERE client_id = ?").bind(clientId).first<{ name: string; redirect_uris: string }>();
  if (!row) return null;
  return redirectAllowed(parseJson<string[]>(row.redirect_uris, []), redirectUri) ? { name: row.name } : null;
}

function redirectBack(origin: string, redirectUri: string, state: string, params: Record<string, string>, status: 302 | 303 = 302): Response {
  const cb = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) cb.searchParams.set(k, v);
  if (state) cb.searchParams.set("state", state);
  cb.searchParams.set("iss", origin); // RFC 9207 mix-up defence
  return new Response(null, { status, headers: { Location: cb.toString(), "Cache-Control": "no-store" } });
}

/**
 * GET: validate the request, make sure the user is signed in (bouncing through Google
 * if not), then show a consent screen. The screen carries a signed, short-lived
 * "consent" token binding the user to exactly this request; the POST below checks it.
 */
export async function authorize(c: Ctx): Promise<Response> {
  const url = new URL(c.req.url);
  const p = url.searchParams;
  const origin = publicOrigin(c.env, url);
  const clientId = p.get("client_id") ?? "";
  const redirectUri = p.get("redirect_uri") ?? "";
  const state = p.get("state") ?? "";
  const challenge = p.get("code_challenge") ?? "";

  const client = await lookupClient(c.env, clientId, redirectUri);
  if (!client) return errorPage("Unknown client, or the redirect_uri is not registered for this client.");

  // From here the redirect_uri is trusted, so protocol errors go back to the client.
  const fail = (error: string, description: string) => redirectBack(origin, redirectUri, state, { error, error_description: description });
  if ((p.get("response_type") ?? "") !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");
  if (p.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
    return fail("invalid_request", "PKCE is required: send code_challenge (S256, base64url SHA-256) and code_challenge_method=S256.");
  }
  const resource = (p.get("resource") ?? "").replace(/\/+$/, "");
  if (resource && resource !== `${origin}/mcp` && resource !== origin) {
    return fail("invalid_target", "Unexpected resource. This server only issues tokens for itself.");
  }

  const user = await currentUser(c.env, c.req.header("Cookie"));
  if (!user) {
    const next = `/oauth/authorize?${p.toString()}`;
    return new Response(null, { status: 302, headers: { Location: `/api/auth/google?next=${encodeURIComponent(next)}`, "Cache-Control": "no-store" } });
  }

  const wsId = await personalWorkspace(c.env, user);
  const role = await currentRole(c.env, wsId, user.id);
  if (!role) return fail("access_denied", "You are not a member of any workspace.");
  const ws = await c.env.DB.prepare("SELECT name FROM workspaces WHERE id = ?").bind(wsId).first<{ name: string }>();

  const now = Math.floor(Date.now() / 1000);
  const consent = await signJwt(c.env, {
    type: "consent", aud: CONSENT_AUD, sub: user.id, ws: wsId,
    cid: clientId, ru: redirectUri, st: state, cc: challenge, iat: now, exp: now + CONSENT_SECONDS,
  });

  let target = redirectUri;
  try {
    const u = new URL(redirectUri);
    target = u.protocol === "https:" || u.protocol === "http:" ? u.host : `${u.protocol}//`;
  } catch { /* validated above */ }

  return page(
    "Authorize access to Gallivanter",
    `<h1>Authorize <em>${esc(client.name)}</em>?</h1>
<div class="card">
  <p><strong>${esc(client.name)}</strong> wants to connect to your Gallivanter CRM through MCP.</p>
  <p>It will act as <strong>${esc(user.email)}</strong> in <strong>${esc(ws?.name ?? "your workspace")}</strong> with your <code>${esc(role)}</code> permissions: it can read${role === "viewer" ? "" : ", create, change and delete"} CRM records on your behalf.</p>
  <p class="muted">After you approve, you will be sent to <code>${esc(target)}</code>. Only approve if you started this connection from an app you trust.</p>
</div>
<form method="post" action="/oauth/authorize">
  <input type="hidden" name="consent" value="${esc(consent)}">
  <div class="row"><button class="primary" name="decision" value="approve">Approve</button><button name="decision" value="deny">Cancel</button></div>
</form>`,
  );
}

/** POST: the user's consent decision. Issues a single-use code bound to PKCE challenge + redirect_uri. */
export async function authorizeSubmit(c: Ctx): Promise<Response> {
  const origin = publicOrigin(c.env, new URL(c.req.url));
  const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
  const consent = typeof form.consent === "string" ? form.consent : "";
  const claims = consent ? await verifyJwt(c.env, consent, CONSENT_AUD, "consent") : null;
  if (!claims) return errorPage("This approval request is invalid or has expired. Go back to your app and start the connection again.");

  const user = await currentUser(c.env, c.req.header("Cookie"));
  if (!user || user.id !== claims.sub) return errorPage("You are signed in as a different user than the one this request was created for. Start the connection again.");

  const clientId = String(claims.cid);
  const redirectUri = String(claims.ru);
  const state = String(claims.st ?? "");
  const client = await lookupClient(c.env, clientId, redirectUri);
  if (!client) return errorPage("This client is no longer registered.");

  if (form.decision !== "approve") {
    return redirectBack(origin, redirectUri, state, { error: "access_denied", error_description: "The user denied the request." }, 303);
  }

  const wsId = String(claims.ws);
  const role = await currentRole(c.env, wsId, user.id);
  if (!role) return redirectBack(origin, redirectUri, state, { error: "access_denied", error_description: "You are not a member of that workspace." }, 303);

  const code = randomToken(32);
  await c.env.DB.prepare(
    `INSERT INTO oauth_codes (code_hash, client_id, user_id, workspace_id, role, code_challenge, code_challenge_method, redirect_uri, scope, expires_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(await sha256(code), clientId, user.id, wsId, role, String(claims.cc), "S256", redirectUri, SCOPE, new Date(Date.now() + CODE_SECONDS * 1000).toISOString(), nowIso()).run();

  return redirectBack(origin, redirectUri, state, { code }, 303);
}

// ---------------- token endpoint ----------------

interface CodeRow {
  code_hash: string;
  client_id: string;
  user_id: string;
  workspace_id: string;
  code_challenge: string;
  redirect_uri: string;
  scope: string;
  expires_at: string;
}

interface RefreshRow {
  token_hash: string;
  client_id: string;
  user_id: string;
  workspace_id: string;
  scope: string;
  family_id: string;
  expires_at: string;
  rotated_to: string | null;
  revoked_at: string | null;
}

async function readParams(c: Ctx): Promise<URLSearchParams> {
  const contentType = c.req.header("Content-Type") ?? "";
  const raw: Record<string, unknown> = contentType.includes("application/x-www-form-urlencoded")
    ? await c.req.parseBody()
    : ((await c.req.json().catch(() => ({}))) as Record<string, unknown>);
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(raw ?? {})) if (typeof v === "string") params.set(k, v);
  return params;
}

export async function token(c: Ctx): Promise<Response> {
  const params = await readParams(c);
  const origin = publicOrigin(c.env, new URL(c.req.url));
  cleanupExpired(c);
  switch (params.get("grant_type") ?? "") {
    case "authorization_code":
      return codeGrant(c, origin, params);
    case "refresh_token":
      return refreshGrant(c, origin, params);
    default:
      return oauthError("unsupported_grant_type", "Supported grants: authorization_code, refresh_token.");
  }
}

async function codeGrant(c: Ctx, origin: string, params: URLSearchParams): Promise<Response> {
  const code = params.get("code") ?? "";
  const verifier = params.get("code_verifier") ?? "";
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  if (!code || !verifier || !clientId || !redirectUri) {
    return oauthError("invalid_request", "code, code_verifier, client_id and redirect_uri are required.");
  }
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return oauthError("invalid_grant", "Malformed code_verifier.");

  const hash = await sha256(code);
  const row = await c.env.DB.prepare("SELECT * FROM oauth_codes WHERE code_hash = ?").bind(hash).first<CodeRow>();
  if (!row) return oauthError("invalid_grant", "Authorization code is invalid or expired.");

  // Atomic single-use claim: two concurrent exchanges cannot both win.
  const claim = await c.env.DB.prepare("UPDATE oauth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL").bind(nowIso(), hash).run();
  if (!claim.meta.changes) {
    // Replay: anything already minted from this code is compromised.
    await c.env.DB.prepare("UPDATE oauth_refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL").bind(nowIso(), hash).run();
    return oauthError("invalid_grant", "Authorization code was already used.");
  }
  if (row.expires_at <= nowIso()) return oauthError("invalid_grant", "Authorization code is invalid or expired.");
  if (row.client_id !== clientId) return oauthError("invalid_grant", "Code was issued to a different client.");
  if (row.redirect_uri !== redirectUri) return oauthError("invalid_grant", "redirect_uri does not match the authorization request.");
  if ((await sha256(verifier)) !== row.code_challenge) return oauthError("invalid_grant", "code_verifier did not match the code_challenge.");

  const role = await currentRole(c.env, row.workspace_id, row.user_id);
  if (!role) return oauthError("invalid_grant", "The user is no longer a member of that workspace.");
  return issueTokens(c, origin, row.client_id, row.user_id, row.workspace_id, role, row.scope, hash);
}

async function refreshGrant(c: Ctx, origin: string, params: URLSearchParams): Promise<Response> {
  const refreshToken = params.get("refresh_token") ?? "";
  const clientId = params.get("client_id") ?? "";
  if (!refreshToken || !clientId) return oauthError("invalid_request", "refresh_token and client_id are required.");

  const hash = await sha256(refreshToken);
  const row = await c.env.DB.prepare("SELECT * FROM oauth_refresh_tokens WHERE token_hash = ?").bind(hash).first<RefreshRow>();
  if (!row || row.client_id !== clientId) return oauthError("invalid_grant", "Refresh token is invalid or expired.");
  if (row.revoked_at || row.expires_at <= nowIso()) return oauthError("invalid_grant", "Refresh token is invalid or expired.");

  const revokeFamily = () =>
    c.env.DB.prepare("UPDATE oauth_refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL").bind(nowIso(), row.family_id).run();

  if (row.rotated_to) {
    // Already exchanged once: a replay. Burn the whole family, including the newest token.
    await revokeFamily();
    return oauthError("invalid_grant", "Refresh token reuse detected; the session has been revoked.");
  }
  const role = await currentRole(c.env, row.workspace_id, row.user_id);
  if (!role) {
    await revokeFamily();
    return oauthError("invalid_grant", "The user is no longer a member of that workspace.");
  }

  const pair = await newTokenPair(c.env, origin, row.client_id, row.user_id, row.workspace_id, role, row.scope);
  const claim = await c.env.DB.prepare("UPDATE oauth_refresh_tokens SET rotated_to = ? WHERE token_hash = ? AND rotated_to IS NULL AND revoked_at IS NULL")
    .bind(await sha256(pair.refreshToken), hash).run();
  if (!claim.meta.changes) {
    await revokeFamily(); // lost a race with a concurrent exchange of the same token
    return oauthError("invalid_grant", "Refresh token reuse detected; the session has been revoked.");
  }
  await insertRefresh(c, pair.refreshToken, row.client_id, row.user_id, row.workspace_id, role, row.scope, row.family_id);
  return json({ access_token: pair.accessToken, token_type: "Bearer", expires_in: ACCESS_TOKEN_SECONDS, refresh_token: pair.refreshToken, scope: row.scope });
}

async function issueTokens(c: Ctx, origin: string, clientId: string, userId: string, workspaceId: string, role: Role, scope: string, familyId: string): Promise<Response> {
  const pair = await newTokenPair(c.env, origin, clientId, userId, workspaceId, role, scope);
  await insertRefresh(c, pair.refreshToken, clientId, userId, workspaceId, role, scope, familyId);
  return json({ access_token: pair.accessToken, token_type: "Bearer", expires_in: ACCESS_TOKEN_SECONDS, refresh_token: pair.refreshToken, scope });
}

async function insertRefresh(c: Ctx, refreshToken: string, clientId: string, userId: string, workspaceId: string, role: string, scope: string, familyId: string): Promise<void> {
  await c.env.DB.prepare(
    "INSERT INTO oauth_refresh_tokens (token_hash, client_id, user_id, workspace_id, role, scope, family_id, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
  ).bind(await sha256(refreshToken), clientId, userId, workspaceId, role, scope, familyId, new Date(Date.now() + REFRESH_TOKEN_SECONDS * 1000).toISOString(), nowIso()).run();
}

async function newTokenPair(env: Env, origin: string, clientId: string, userId: string, workspaceId: string, role: Role, scope: string): Promise<{ accessToken: string; refreshToken: string }> {
  // aud is the canonical MCP resource identifier, the same URL the resource metadata advertises (RFC 8707).
  const now = Math.floor(Date.now() / 1000);
  const accessToken = await signJwt(env, {
    type: "access", iss: origin, aud: `${origin}/mcp`, sub: userId, ws: workspaceId, role, scope, cid: clientId, iat: now, exp: now + ACCESS_TOKEN_SECONDS,
  });
  return { accessToken, refreshToken: randomToken(48) };
}

/** Opportunistic housekeeping so the OAuth tables don't grow without bound. */
function cleanupExpired(c: Ctx): void {
  const task = c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM oauth_codes WHERE expires_at < ?").bind(new Date(Date.now() - 86_400_000).toISOString()),
    c.env.DB.prepare("DELETE FROM oauth_refresh_tokens WHERE expires_at < ?").bind(nowIso()),
  ]).catch(() => undefined);
  try {
    c.executionCtx.waitUntil(task);
  } catch {
    /* no ExecutionContext (unit tests) */
  }
}

// ---------------- revocation (RFC 7009) ----------------

/** Revoking a refresh token revokes its whole family. Access tokens are stateless and simply expire (15 min). */
export async function revoke(c: Ctx): Promise<Response> {
  const params = await readParams(c);
  const presented = params.get("token") ?? "";
  const clientId = params.get("client_id") ?? "";
  if (presented) {
    const hash = await sha256(presented);
    const row = await c.env.DB.prepare("SELECT client_id, family_id FROM oauth_refresh_tokens WHERE token_hash = ?").bind(hash).first<{ client_id: string; family_id: string }>();
    if (row && (!clientId || row.client_id === clientId)) {
      await c.env.DB.prepare("UPDATE oauth_refresh_tokens SET revoked_at = ? WHERE (family_id = ? OR token_hash = ?) AND revoked_at IS NULL").bind(nowIso(), row.family_id, hash).run();
    }
  }
  return json({}); // always 200, even for unknown tokens
}

// ---------------- access token validation (used by mcp.ts) ----------------

export interface TokenPrincipal {
  userId: string;
  workspaceId: string;
  role: Role;
  email: string;
}

/**
 * Validate a Bearer access token for the canonical origin. Returns the principal, or null on any
 * failure (bad signature, expired, wrong audience, user removed from the workspace). The role comes
 * from the database, not the token, so demotions and removals take effect immediately.
 */
export async function bearerPrincipal(env: Env, authHeader: string | null | undefined, origin: string): Promise<TokenPrincipal | null> {
  const presented = readBearer(authHeader);
  if (!presented) return null;
  const claims = await verifyJwt(env, presented, `${origin.replace(/\/+$/, "")}/mcp`, "access");
  if (!claims) return null;
  const userId = claims.sub;
  const workspaceId = claims.ws;
  if (typeof userId !== "string" || typeof workspaceId !== "string") return null;
  const row = await env.DB.prepare("SELECT u.email AS email, m.role AS role FROM users u JOIN members m ON m.user_id = u.id WHERE u.id = ? AND m.workspace_id = ?")
    .bind(userId, workspaceId)
    .first<{ email: string; role: Role }>();
  if (!row) return null;
  return { userId, workspaceId, role: row.role, email: row.email };
}
