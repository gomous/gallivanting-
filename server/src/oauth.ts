/**
 * OAuth 2.1 authorization server for the MCP endpoint, hosted on the same Worker.
 *
 * Claude (and any MCP client) connects to /mcp and gets 401 with a
 * WWW-Authenticate header pointing at our protected-resource metadata. From there
 * it discovers:
 *   - /.well-known/oauth-protected-resource    (RFC 9728: resource + authorization_servers)
 *   - /.well-known/oauth-authorization-server  (RFC 8414: endpoints, scopes, PKCE)
 *   - POST /oauth/register                     (RFC 7591 dynamic client registration)
 *   - GET  /oauth/authorize                    (browser: sign in via Google, approve)
 *   - POST /oauth/token                        (exchange code / refresh token)
 *
 * Access tokens are short-lived, signed JWTs (HMAC-SHA256 with the existing
 * TOKEN_KEY secret). Authorization codes and refresh tokens are single-use opaque
 * strings stored in D1. Refresh tokens rotate on every use.
 *
 * The user signs in with the same Google flow as the web app; we reuse the
 * gv_session cookie so an already-logged-in user never re-approves.
 */
import type { Context } from "hono";
import { AppError, b64url, newId, nowIso, publicOrigin, randomToken, sha256, type Env } from "./util.ts";
import { currentUser } from "./auth.ts";
import { personalWorkspace } from "./legacy.ts";
import type { Role } from "./registry.ts";

// This Worker is both the resource server and the authorization server.
const SCOPE = "gallivanter";
const ACCESS_TOKEN_SECONDS = 15 * 60; // 15 min
const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60; // 30 days
const CODE_SECONDS = 5 * 60; // 5 min

type Ctx = Context<{ Bindings: Env }>;

// ---------------- JWT (HMAC-SHA256, key derived from TOKEN_KEY) ----------------

async function hmacKey(env: Env): Promise<CryptoKey> {
  if (!env.TOKEN_KEY) throw new Error("TOKEN_KEY secret is not configured.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(env.TOKEN_KEY));
  const raw = b64decode(b64url(new Uint8Array(digest)));
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function b64decode(text: string): Uint8Array {
  const norm = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(norm + "=".repeat((4 - (norm.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function signJwt(env: Env, claims: Record<string, unknown>): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const enc = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)));
  const body = `${enc(header)}.${enc(claims)}`;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env), new TextEncoder().encode(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

/** Verify and decode an access token; returns null if invalid/expired/wrong audience. */
async function verifyJwt(env: Env, token: string, expectedAud: string): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(env), b64decode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return null;
  const claims = JSON.parse(new TextDecoder().decode(b64decode(parts[1]))) as Record<string, unknown>;
  if (typeof claims.exp !== "number" || claims.exp < Date.now() / 1000) return null;
  if (claims.aud !== expectedAud) return null;
  return claims;
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
    scopes_supported: [SCOPE],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256", "plain"],
    token_endpoint_auth_methods_supported: ["none"],
  });
}

// ---------------- helpers ----------------

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

function readBearer(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return m ? m[1] : null;
}

// ---------------- dynamic client registration (RFC 7591) ----------------

export async function clientRegister(c: Ctx): Promise<Response> {
  const body = (await c.req.json().catch(() => null)) as {
    client_name?: string;
    redirect_uris?: string[];
  } | null;
  if (!body) return json({ error: "invalid_client_metadata" }, 400);
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u)) : [];
  const clientId = newId("cl");
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO oauth_clients (client_id, client_secret, name, redirect_uris, grant_types, response_types, token_endpoint_auth_method, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).bind(clientId, "", body.client_name ?? "MCP client", JSON.stringify(redirectUris), JSON.stringify(["authorization_code", "refresh_token"]), JSON.stringify(["code"]), "none", now).run();
  return json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
  );
}

// ---------------- authorization endpoint ----------------

/**
 * The browser lands here after Claude opens the authorization URL.
 * Requires an existing Gallivanter login; if not signed in, bounce through the
 * Google flow first. On success: issue a single-use code and redirect to the
 * client callback.
 */
export async function authorize(c: Ctx): Promise<Response> {
  const url = new URL(c.req.url);
  const params = url.searchParams;
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const scope = params.get("scope") ?? SCOPE;
  const state = params.get("state") ?? "";
  const challenge = params.get("code_challenge") ?? "";
  const challengeMethod = params.get("code_challenge_method") ?? "plain";
  const resource = params.get("resource") ?? "";

  if (!clientId) return oauthError("invalid_request", "Missing client_id.");
  if (!redirectUri) return oauthError("invalid_request", "Missing redirect_uri.");

  const client = await c.env.DB.prepare("SELECT * FROM oauth_clients WHERE client_id = ?").bind(clientId).first<{ redirect_uris: string }>();
  if (!client) return oauthError("unauthorized_client", "Unknown client.");
  const allowed = JSON.parse(client.redirect_uris) as string[];
  const loopbackAllowed = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(redirectUri);
  if (redirectUri !== (allowed.find((u) => u === redirectUri) ?? "") && !loopbackAllowed) {
    return oauthError("invalid_request", "redirect_uri is not registered for this client.");
  }

  // The MCP resource param must name our server.
  const origin = url.origin;
  if (resource && resource !== `${origin}/mcp` && resource !== origin) {
    return oauthError("invalid_target", "Unexpected resource. This server only issues tokens for itself.");
  }

  // User must be signed in. If not, send them through Google first (threading the
  // original request back here so the code is issued after they return).
  const user = await currentUser(c.env, c.req.header("Cookie"));
  if (!user) {
    const next = `/oauth/authorize?${url.searchParams.toString()}`;
    return c.redirect(`/api/auth/google?next=${encodeURIComponent(next)}`);
  }

  const wsId = await personalWorkspace(c.env, user);
  const member = await c.env.DB.prepare("SELECT role FROM members WHERE workspace_id = ? AND user_id = ?").bind(wsId, user.id).first<{ role: Role }>();
  if (!member) return oauthError("access_denied", "You are not a member of any workspace.");

  const code = randomToken(32);
  const hash = await sha256(code);
  await c.env.DB.prepare(
    `INSERT INTO oauth_codes (code_hash, client_id, user_id, workspace_id, role, code_challenge, code_challenge_method, redirect_uri, scope, expires_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(hash, clientId, user.id, wsId, member.role, challenge, challengeMethod, redirectUri, scope, new Date(Date.now() + CODE_SECONDS * 1000).toISOString(), nowIso()).run();

  const cb = new URL(redirectUri);
  cb.searchParams.set("code", code);
  if (state) cb.searchParams.set("state", state);
  return c.redirect(cb.toString());
}

function oauthError(error: string, description: string): Response {
  return new Response(
    `<!doctype html><title>Gallivanter sign-in failed</title><body style="font-family:system-ui;max-width:40rem;margin:4rem auto;padding:0 1.5rem"><h1>Unable to sign in</h1><p>${error}</p><p>${description}</p></body>`,
    { status: 400, headers: { "Content-Type": "text/html" } },
  );
}

// ---------------- token endpoint ----------------

interface TokenRow {
  token_hash: string;
  client_id: string;
  user_id: string;
  workspace_id: string;
  role: string;
  scope: string;
  code_challenge: string;
  code_challenge_method: string;
  rotated_to: string | null;
}

export async function token(c: Ctx): Promise<Response> {
  const contentType = c.req.header("Content-Type") ?? "";
  const form = contentType.includes("application/x-www-form-urlencoded")
    ? await c.req.parseBody()
    : ((await c.req.json().catch(() => ({}))) as Record<string, unknown>);
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) if (typeof v === "string") params.set(k, v);

  const grantType = params.get("grant_type") ?? "";
  const origin = publicOrigin(c.env, new URL(c.req.url));
  try {
    if (grantType === "authorization_code") return await codeGrant(c, origin, params);
    if (grantType === "refresh_token") return await refreshGrant(c, origin, params);
    return json({ error: "unsupported_grant_type" }, 400);
  } catch (e) {
    if (e instanceof AppError) return json({ error: e.code, error_description: e.message }, e.status);
    throw e;
  }
}

async function codeGrant(c: Ctx, origin: string, params: URLSearchParams): Promise<Response> {
  const code = params.get("code") ?? "";
  const verifier = params.get("code_verifier") ?? "";
  const clientId = params.get("client_id") ?? "";
  if (!code || !verifier) return json({ error: "invalid_request", error_description: "code and code_verifier are required." }, 400);
  const hash = await sha256(code);
  const row = await c.env.DB.prepare(
    "SELECT * FROM oauth_codes WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?",
  ).bind(hash, nowIso()).first<TokenRow & { redirect_uri: string }>();
  if (!row) return json({ error: "invalid_grant", error_description: "Authorization code is invalid or expired." }, 400);
  await c.env.DB.prepare("UPDATE oauth_codes SET used_at = ? WHERE code_hash = ?").bind(nowIso(), hash).run();
  if (clientId && row.client_id !== clientId) return json({ error: "invalid_grant", error_description: "Code was issued to a different client." }, 400);

  // PKCE: S256 challenges must match the SHA-256 of the verifier.
  const ok = row.code_challenge
    ? (row.code_challenge_method === "S256" ? (await sha256(verifier)) === row.code_challenge : verifier === row.code_challenge)
    : true;
  if (!ok) return json({ error: "invalid_grant", error_description: "code_verifier did not match the code_challenge." }, 400);

  return issueTokens(c, origin, row.client_id, row.user_id, row.workspace_id, row.role as Role, row.scope);
}

async function refreshGrant(c: Ctx, origin: string, params: URLSearchParams): Promise<Response> {
  const refreshToken = params.get("refresh_token") ?? "";
  const clientId = params.get("client_id") ?? "";
  if (!refreshToken) return json({ error: "invalid_request", error_description: "refresh_token is required." }, 400);
  const hash = await sha256(refreshToken);
  const row = await c.env.DB.prepare(
    "SELECT * FROM oauth_refresh_tokens WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?",
  ).bind(hash, nowIso()).first<TokenRow>();
  if (!row) return json({ error: "invalid_grant", error_description: "Refresh token is invalid or expired." }, 400);
  if (clientId && row.client_id !== clientId) return json({ error: "invalid_grant", error_description: "Token was issued to a different client." }, 400);
  if (row.rotated_to) {
    // The token was already rotated: a replay. Revoke the whole family to be safe.
    await c.env.DB.prepare("UPDATE oauth_refresh_tokens SET revoked_at = ? WHERE token_hash = ? OR rotated_to = ?")
      .bind(nowIso(), row.token_hash, row.token_hash).run();
    return json({ error: "invalid_grant", error_description: "Refresh token reuse detected; the session has been revoked." }, 400);
  }

  const pair = await newTokenPair(c.env, origin, row.client_id, row.user_id, row.workspace_id, row.role as Role, row.scope);
  const newHash = await sha256(pair.refreshToken);
  await c.env.DB.prepare("UPDATE oauth_refresh_tokens SET rotated_to = ? WHERE token_hash = ?").bind(newHash, hash).run();
  await insertRefresh(c, pair.refreshToken, row.client_id, row.user_id, row.workspace_id, row.role, row.scope);
  return json({ access_token: pair.accessToken, token_type: "Bearer", expires_in: ACCESS_TOKEN_SECONDS, refresh_token: pair.refreshToken, scope: row.scope });
}

async function issueTokens(c: Ctx, origin: string, clientId: string, userId: string, workspaceId: string, role: Role, scope: string): Promise<Response> {
  const pair = await newTokenPair(c.env, origin, clientId, userId, workspaceId, role, scope);
  await insertRefresh(c, pair.refreshToken, clientId, userId, workspaceId, role, scope);
  return json({ access_token: pair.accessToken, token_type: "Bearer", expires_in: ACCESS_TOKEN_SECONDS, refresh_token: pair.refreshToken, scope });
}

async function insertRefresh(c: Ctx, refreshToken: string, clientId: string, userId: string, workspaceId: string, role: string, scope: string): Promise<void> {
  await c.env.DB.prepare(
    "INSERT INTO oauth_refresh_tokens (token_hash, client_id, user_id, workspace_id, role, scope, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?)",
  ).bind(await sha256(refreshToken), clientId, userId, workspaceId, role, scope, new Date(Date.now() + REFRESH_TOKEN_SECONDS * 1000).toISOString(), nowIso()).run();
}

async function newTokenPair(env: Env, origin: string, clientId: string, userId: string, workspaceId: string, role: Role, scope: string): Promise<{ accessToken: string; refreshToken: string }> {
  // The audience is the MCP resource identifier: the same canonical URL the
  // resource metadata advertises, so it matches what the client connected to.
  const now = Math.floor(Date.now() / 1000);
  const accessToken = await signJwt(env, {
    iss: origin, sub: userId, aud: `${origin}/mcp`, ws: workspaceId, role, scope, iat: now, exp: now + ACCESS_TOKEN_SECONDS, type: "access",
  });
  const refreshToken = randomToken(48);
  return { accessToken, refreshToken };
}

// ---------------- access token validation (used by mcp.ts) ----------------

export interface TokenPrincipal {
  userId: string;
  workspaceId: string;
  role: Role;
  email: string;
}

/**
 * Validate a Bearer access token against the caller's /mcp URL (audience).
 * Returns the principal on success, null on any failure. This is the resource
 * server side of the OAuth handshake used by resolveContext in mcp.ts.
 */
export async function bearerPrincipal(env: Env, authHeader: string | null | undefined, mcpUrl: string): Promise<TokenPrincipal | null> {
  const token = readBearer(authHeader);
  if (!token) return null;
  const claims = await verifyJwt(env, token, mcpUrl);
  if (!claims) return null;
  const userId = claims.sub as string;
  const workspaceId = claims.ws as string;
  const role = claims.role as Role;
  if (!userId || !workspaceId || !role) return null;
  const user = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(userId).first<{ email: string }>();
  if (!user) return null;
  return { userId, workspaceId, role, email: user.email };
}