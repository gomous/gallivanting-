import type { Env, SessionToken } from "./types";
import {
  exchangeCode,
  findWorkspaceFile,
  getValidToken,
  readWorkspace,
  refreshToken,
  writeWorkspace,
} from "./google";

const SESSION_COOKIE = "gallivanter_session";

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      // === Health check ===
      if (path === "/health") {
        return new Response(JSON.stringify({ status: "ok" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // === OAuth: redirect user to Google consent screen ===
      // client_id and client_secret are passed as query parameters
      if (path === "/auth/google") {
        const clientId = url.searchParams.get("client_id") || env.CLIENT_ID;
        const clientSecret = url.searchParams.get("client_secret") || env.CLIENT_SECRET;

        if (!clientId || !clientSecret) {
          return new Response(JSON.stringify({ error: "Missing client_id or client_secret parameter" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const state = crypto.randomUUID();
        const authUrl = buildAuthUrl(clientId, env.REDIRECT_URI, state);
        // Store the credentials in the state cookie (encrypted/obfuscated)
        const cookie = serializeCookie(SESSION_COOKIE + "_creds", btoa(JSON.stringify({ clientId, clientSecret })), {
          httpOnly: true,
          secure: true,
          sameSite: "none",
          maxAge: 300,
        });
        const stateCookie = serializeCookie(SESSION_COOKIE + "_state", state, {
          httpOnly: true,
          secure: true,
          sameSite: "none",
          maxAge: 300,
        });
        return Response.redirect(authUrl, 302, {
          headers: { ...corsHeaders, "Set-Cookie": `${cookie}, ${stateCookie}` },
        });
      }

      // === OAuth callback: receive code, exchange for tokens, set session cookie ===
      if (path === "/auth/callback") {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");

        // Retrieve stored credentials and state from cookies
        const cookies = parseCookies(request.headers.get("Cookie") || "");
        const storedState = cookies[SESSION_COOKIE + "_state"];
        const storedCreds = cookies[SESSION_COOKIE + "_creds"];

        if (!code || !state) {
          return new Response("Missing code or state", { status: 400 });
        }
        if (state !== storedState) {
          return new Response("State mismatch", { status: 400 });
        }
        if (!storedCreds) {
          return new Response("Missing credentials", { status: 400 });
        }

        let creds: { clientId: string; clientSecret: string };
        try {
          creds = JSON.parse(atob(storedCreds));
        } catch {
          return new Response("Invalid credentials in cookie", { status: 400 });
        }

        const token = await exchangeCode(creds.clientId, creds.clientSecret, code, env.REDIRECT_URI);

        // Store credentials in the session for later use (refresh, etc.)
        const sessionToken: SessionToken = {
          ...token,
          clientId: creds.clientId,
          clientSecret: creds.clientSecret,
        };

        const sessionCookie = serializeCookie(SESSION_COOKIE, JSON.stringify(sessionToken), {
          httpOnly: true,
          secure: true,
          sameSite: "none",
          maxAge: 60 * 60 * 24 * 30, // 30 days
        });
        const clearStateCookies = [
          serializeCookie(SESSION_COOKIE + "_state", "", { httpOnly: true, secure: true, sameSite: "none", maxAge: 0 }),
          serializeCookie(SESSION_COOKIE + "_creds", "", { httpOnly: true, secure: true, sameSite: "none", maxAge: 0 }),
        ].join(", ");

        // Redirect back to the app with a success param
        const appUrl = "https://gallivanter.jolly-rain-7712.pages.dev/?auth=success";
        return Response.redirect(appUrl, 302, {
          headers: {
            ...corsHeaders,
            "Set-Cookie": `${sessionCookie}, ${clearStateCookies}`,
          },
        });
      }

      // === Logout ===
      if (path === "/auth/logout") {
        const clearCookie = serializeCookie(SESSION_COOKIE, "", {
          httpOnly: true,
          secure: true,
          sameSite: "none",
          maxAge: 0,
        });
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json", "Set-Cookie": clearCookie },
        });
      }

      // === Check auth status ===
      if (path === "/auth/status") {
        const token = await getSessionToken(request, env);
        return new Response(JSON.stringify({ authenticated: !!token }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // === Drive API proxy ===
      const token = await getSessionToken(request, env);
      if (!token) {
        return new Response(JSON.stringify({ error: "Not authenticated" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // GET /drive/workspace — read workspace from Google Drive
      if (path === "/drive/workspace" && request.method === "GET") {
        const valid = await getValidToken(token, token.clientId, token.clientSecret);
        const fileId = await findWorkspaceFile(valid.access_token, env.FILE_NAME);
        if (!fileId) {
          return new Response(JSON.stringify({ workspace: "", updatedAt: "" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const raw = await readWorkspace(valid.access_token, fileId);

        // Update session cookie with refreshed token
        if (valid.expires_at !== token.expires_at) {
          const updatedToken: SessionToken = { ...token, expires_at: valid.expires_at };
          const sessionCookie = serializeCookie(SESSION_COOKIE, JSON.stringify(updatedToken), {
            httpOnly: true,
            secure: true,
            sameSite: "none",
            maxAge: 60 * 60 * 24 * 30,
          });
          return new Response(JSON.stringify({ workspace: raw, updatedAt: new Date().toISOString() }), {
            headers: { ...corsHeaders, "Content-Type": "application/json", "Set-Cookie": sessionCookie },
          });
        }

        return new Response(JSON.stringify({ workspace: raw, updatedAt: new Date().toISOString() }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // POST /drive/workspace — write workspace to Google Drive
      if (path === "/drive/workspace" && request.method === "POST") {
        const body = (await request.json()) as { workspace: string; existingFileId?: string | null };
        if (!body.workspace) {
          return new Response(JSON.stringify({ error: "Missing workspace" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const valid = await getValidToken(token, token.clientId, token.clientSecret);
        const fileId = await writeWorkspace(valid.access_token, body.workspace, body.existingFileId ?? null, env.FILE_NAME);
        return new Response(JSON.stringify({ fileId, updatedAt: new Date().toISOString() }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // === Unknown route ===
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};

// --- Cookie helpers ---

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx);
      const val = decodeURIComponent(trimmed.slice(eqIdx + 1));
      cookies[key] = val;
    }
  }
  return cookies;
}

interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "strict" | "lax" | "none";
  maxAge?: number;
  path?: string;
}

function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path ?? "/"}`];
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join("; ");
}

// --- Session token helpers ---

async function getSessionToken(request: Request, env: Env): Promise<SessionToken | null> {
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const raw = cookies[SESSION_COOKIE];
  if (!raw) return null;

  try {
    const token: SessionToken = JSON.parse(raw);
    // Check if the token is still valid (or close to expiring)
    if (Date.now() > token.expires_at - 30_000) {
      return await refreshToken(token.clientId, token.clientSecret, token.refresh_token);
    }
    return token;
  } catch {
    return null;
  }
}

function buildAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email openid",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
