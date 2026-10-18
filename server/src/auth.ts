/**
 * Google sign-in with server-side sessions in D1.
 * The browser only ever holds an opaque random session token (HttpOnly cookie).
 * Google refresh tokens are encrypted at rest and never leave the server.
 */
import type { Context } from "hono";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = Context<{ Bindings: Env; Variables: any }>;
import { AppError, decrypt, encrypt, newId, nowIso, publicOrigin, randomToken, sha256, type Env } from "./util.ts";

export const SESSION_COOKIE = "gv_session";
const STATE_COOKIE = "gv_oauth_state";
const SESSION_DAYS = 30;
export const GOOGLE_SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/drive.file"];

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  picture: string;
}

function cookie(name: string, value: string, maxAge: number, secure: boolean): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return undefined;
}

const isSecure = (url: URL) => url.protocol === "https:";
// Same path the original Pages app registered in Google Console, so no console change is needed.
const redirectUri = (c: Ctx, url: URL) => `${publicOrigin(c.env, url)}/api/google/callback`;

/** Step 1: redirect to Google. `?consent=1` forces the consent screen (needed to obtain a refresh token). */
export function startGoogleLogin(c: Ctx): Response {
  const url = new URL(c.req.url);
  const next = url.searchParams.get("next") ?? "/";
  const state = `${randomToken(16)}.${encodeURIComponent(next.startsWith("/") && !next.startsWith("//") ? next : "/")}`;
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(c, url),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    state,
    prompt: url.searchParams.get("consent") ? "consent" : "select_account",
  });
  const headers = new Headers({ Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  headers.append("Set-Cookie", cookie(STATE_COOKIE, state, 600, isSecure(url)));
  return new Response(null, { status: 302, headers });
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token: string;
}

/** Decode the id_token payload. It came straight from Google's token endpoint over TLS, so no signature check is needed. */
function idTokenClaims(idToken: string): { sub: string; email: string; name?: string; picture?: string; email_verified?: boolean } {
  const payload = idToken.split(".")[1];
  const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (payload.length % 4)) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(json, (ch) => ch.charCodeAt(0))));
}

/** Step 2: Google redirects back here. */
export async function finishGoogleLogin(c: Ctx): Promise<Response> {
  const url = new URL(c.req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const stored = readCookie(c.req.header("Cookie"), STATE_COOKIE);
  if (url.searchParams.get("error")) return c.redirect(`/?login_error=${encodeURIComponent(url.searchParams.get("error")!)}`);
  if (!code || !state || state !== stored) return c.redirect("/?login_error=state");
  // The state is `<random>.<encodeURIComponent(next)>`, and an encoded URL still contains dots
  // (claude.ai, 127.0.0.1), so take everything after the FIRST dot rather than split(".")[1].
  const decodedNext = decodeURIComponent(state.slice(state.indexOf(".") + 1) || "%2F");
  const next = decodedNext.startsWith("/") && !decodedNext.startsWith("//") ? decodedNext : "/";

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(c, url),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) return c.redirect(`/?login_error=token_${res.status}`);
  const tokens = (await res.json()) as GoogleTokenResponse;
  const claims = idTokenClaims(tokens.id_token);
  if (!claims.email || claims.email_verified === false) return c.redirect("/?login_error=email");

  const db = c.env.DB;
  const now = nowIso();
  const existing = await db.prepare("SELECT id FROM users WHERE google_sub = ?").bind(claims.sub).first<{ id: string }>();
  const userId = existing?.id ?? newId("user");
  await db.prepare(
    `INSERT INTO users (id, google_sub, email, name, picture, created_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture`,
  ).bind(userId, claims.sub, claims.email.toLowerCase(), claims.name ?? "", claims.picture ?? "", now).run();

  const hadRefresh = await db.prepare("SELECT 1 FROM google_tokens WHERE user_id = ?").bind(userId).first();
  if (tokens.refresh_token) {
    await db.prepare(
      `INSERT INTO google_tokens (user_id, refresh_token_enc, access_token, access_expires_at, scope, updated_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET refresh_token_enc = excluded.refresh_token_enc, access_token = excluded.access_token,
         access_expires_at = excluded.access_expires_at, scope = excluded.scope, updated_at = excluded.updated_at`,
    ).bind(userId, await encrypt(c.env, tokens.refresh_token), tokens.access_token, Date.now() + tokens.expires_in * 1000, tokens.scope, now).run();
  } else if (!hadRefresh) {
    // Google only issues a refresh token on the consent screen; ask again once.
    return c.redirect(`/api/auth/google?consent=1&next=${encodeURIComponent(next)}`);
  }

  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)").bind(await sha256(token), userId, expires, now).run();

  const headers = new Headers({ Location: next });
  headers.append("Set-Cookie", cookie(SESSION_COOKIE, token, SESSION_DAYS * 86400, isSecure(url)));
  headers.append("Set-Cookie", cookie(STATE_COOKIE, "", 0, isSecure(url)));
  return new Response(null, { status: 302, headers });
}

export async function currentUser(env: Env, cookieHeader: string | undefined): Promise<SessionUser | null> {
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  if (!token) return null;
  return userForToken(env, token);
}

export async function userForToken(env: Env, token: string): Promise<SessionUser | null> {
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.picture, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
  ).bind(await sha256(token)).first<SessionUser & { expires_at: string }>();
  if (!row || row.expires_at < nowIso()) return null;
  return { id: row.id, email: row.email, name: row.name, picture: row.picture };
}

export async function logout(c: Ctx): Promise<Response> {
  const token = readCookie(c.req.header("Cookie"), SESSION_COOKIE);
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", cookie(SESSION_COOKIE, "", 0, isSecure(new URL(c.req.url))));
  return new Response(JSON.stringify({ ok: true }), { headers });
}

/** A valid Google access token for a user (refreshing it when needed). Used by the Sheets sync. */
export async function googleAccessToken(env: Env, userId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT refresh_token_enc, access_token, access_expires_at FROM google_tokens WHERE user_id = ?").bind(userId).first<{
    refresh_token_enc: string; access_token: string; access_expires_at: number;
  }>();
  if (!row) throw new AppError("upstream", "Google is not connected for this user.");
  if (row.access_token && row.access_expires_at > Date.now() + 60_000) return row.access_token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: await decrypt(env, row.refresh_token_enc),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new AppError("upstream", `Google token refresh failed (${res.status}). The user may need to reconnect Google.`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  await env.DB.prepare("UPDATE google_tokens SET access_token = ?, access_expires_at = ?, updated_at = ? WHERE user_id = ?")
    .bind(data.access_token, Date.now() + data.expires_in * 1000, nowIso(), userId).run();
  return data.access_token;
}
