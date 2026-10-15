import type { DriveSession } from "../../src/cloudflare/driveBackend";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_BASE = "https://www.googleapis.com/drive/v3";
const SESSION_COOKIE = "gallivanter_session";

// These can be set as Pages Environment Variables, or passed from the client
const DEFAULT_REDIRECT_URI = "https://gallivanter.pages.dev/api/google/callback";
const DEFAULT_FILE_NAME = "gallivanter-workspace.json";

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

async function exchangeCode(clientId: string, clientSecret: string, code: string, redirectUri: string): Promise<DriveSession> {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    scope: data.scope,
    token_type: data.token_type,
    clientId,
    clientSecret,
    existingFileId: null,
  };
}

async function doRefresh(refreshToken: string, clientId: string, clientSecret: string): Promise<DriveSession> {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? refreshToken,
    expires_at: Date.now() + data.expires_in * 1000,
    scope: data.scope,
    token_type: data.token_type,
    clientId,
    clientSecret,
    existingFileId: null,
  };
}

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

function serializeCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAge}`;
}

function getSessionToken(request: Request): DriveSession | null {
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const raw = cookies[SESSION_COOKIE];
  if (!raw) return null;

  try {
    return JSON.parse(raw) as DriveSession;
  } catch {
    return null;
  }
}

async function getValidToken(token: DriveSession): Promise<DriveSession> {
  if (Date.now() > token.expires_at - 30_000) {
    return doRefresh(token.refresh_token, token.clientId, token.clientSecret);
  }
  return token;
}

async function findWorkspaceFile(token: string, fileName: string): Promise<string | null> {
  const params = new URLSearchParams({
    q: `name='${encodeURIComponent(fileName)}' and mimeType='application/json' and trashed=false`,
    fields: "files(id,name,size,modifiedTime)",
  });

  const res = await fetch(`${GOOGLE_DRIVE_BASE}/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Drive query failed: ${res.status}`);
  }

  const data = (await res.json()) as { files?: Array<{ id: string }> };
  return data.files?.[0]?.id ?? null;
}

async function readWorkspace(token: string, fileId: string): Promise<string> {
  const res = await fetch(`${GOOGLE_DRIVE_BASE}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Drive read failed: ${res.status}`);
  }

  return res.text();
}

async function writeWorkspace(token: string, content: string, existingFileId: string | null, fileName: string): Promise<string> {
  if (existingFileId) {
    const res = await fetch(`${GOOGLE_DRIVE_BASE}/files/${existingFileId}?uploadType=media`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: content,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Drive write failed: ${res.status} ${text}`);
    }

    const data = (await res.json()) as { id: string };
    return data.id;
  }

  // Create new file
  const metadata = JSON.stringify({ name: fileName, mimeType: "application/json" });
  const boundary = `boundary_${Date.now()}`;
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--\r\n`;

  const res = await fetch(`${GOOGLE_DRIVE_BASE}/files?uploadType=multipart`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Drive write failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { id: string };
  return data.id;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Max-Age": "86400",
};

// === Google OAuth flow ===

const handleGet = async (request: Request) => {
  const url = new URL(request.url);
  const path = url.pathname;

  // OAuth start
  if (path === "/api/google") {
    const clientId = url.searchParams.get("client_id") || "";
    const clientSecret = url.searchParams.get("client_secret") || "";

    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({ error: "Missing client_id or client_secret" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const state = crypto.randomUUID();
    const authUrl = buildAuthUrl(clientId, DEFAULT_REDIRECT_URI, state);

    const cookie = serializeCookie(`${SESSION_COOKIE}_creds`, btoa(JSON.stringify({ clientId, clientSecret })), 300);
    const stateCookie = serializeCookie(`${SESSION_COOKIE}_state`, state, 300);

    return new Response(null, {
      status: 302,
      headers: { ...corsHeaders, Location: authUrl, "Set-Cookie": `${cookie}, ${stateCookie}` },
    });
  }

  // OAuth callback
  if (path === "/api/google/callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookies = parseCookies(request.headers.get("Cookie") || "");
    const storedState = cookies[`${SESSION_COOKIE}_state`];
    const storedCreds = cookies[`${SESSION_COOKIE}_creds`];

    if (!code || !state || state !== storedState || !storedCreds) {
      return new Response("Invalid OAuth callback", { status: 400 });
    }

    let creds: { clientId: string; clientSecret: string };
    try {
      creds = JSON.parse(atob(storedCreds));
    } catch {
      return new Response("Invalid credentials", { status: 400 });
    }

    const token = await exchangeCode(creds.clientId, creds.clientSecret, code, DEFAULT_REDIRECT_URI);
    const sessionCookie = serializeCookie(SESSION_COOKIE, JSON.stringify(token), 60 * 60 * 24 * 30);
    const clearCookies = [
      serializeCookie(`${SESSION_COOKIE}_state`, "", 0),
      serializeCookie(`${SESSION_COOKIE}_creds`, "", 0),
    ].join(", ");

    const redirectUrl = `https://gallivanter.pages.dev/?auth=success`;
    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        Location: redirectUrl,
        "Set-Cookie": `${sessionCookie}, ${clearCookies}`,
      },
    });
  }

  // Auth status
  if (path === "/api/auth/status") {
    const token = getSessionToken(request);
    return new Response(JSON.stringify({ authenticated: !!token }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Logout
  if (path === "/api/auth/logout") {
    const clearCookie = serializeCookie(SESSION_COOKIE, "", 0);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json", "Set-Cookie": clearCookie },
    });
  }

  // Drive API: read workspace
  if (path === "/api/drive/workspace" && request.method === "GET") {
    const token = getSessionToken(request);
    if (!token) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const valid = await getValidToken(token);
    const fileId = await findWorkspaceFile(valid.access_token, DEFAULT_FILE_NAME);

    if (!fileId) {
      return new Response(JSON.stringify({ workspace: "", updatedAt: "" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const raw = await readWorkspace(valid.access_token, fileId);
    const sessionCookie = valid.expires_at !== token.expires_at
      ? serializeCookie(SESSION_COOKIE, JSON.stringify({ ...token, expires_at: valid.expires_at }), 60 * 60 * 24 * 30)
      : null;

    const headers: Record<string, string> = { ...corsHeaders, "Content-Type": "application/json" };
    if (sessionCookie) headers["Set-Cookie"] = sessionCookie;

    return new Response(JSON.stringify({ workspace: raw, updatedAt: new Date().toISOString() }), { headers });
  }

  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
};

const handlePost = async (request: Request) => {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/drive/workspace") {
    const token = getSessionToken(request);
    if (!token) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await request.json() as { workspace: string; existingFileId?: string | null };
    if (!body.workspace) {
      return new Response(JSON.stringify({ error: "Missing workspace" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const valid = await getValidToken(token);
    const fileId = await writeWorkspace(valid.access_token, body.workspace, token.existingFileId ?? null, DEFAULT_FILE_NAME);

    // Update the session with the fileId
    const updatedToken = { ...token, existingFileId: fileId };
    const sessionCookie = serializeCookie(SESSION_COOKIE, JSON.stringify(updatedToken), 60 * 60 * 24 * 30);

    return new Response(JSON.stringify({ fileId, updatedAt: new Date().toISOString() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json", "Set-Cookie": sessionCookie },
    });
  }

  if (path === "/api/auth/logout") {
    const clearCookie = serializeCookie(SESSION_COOKIE, "", 0);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json", "Set-Cookie": clearCookie },
    });
  }

  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
};

export const onRequestGet = async ({ request }: { request: Request }) => handleGet(request);
export const onRequestPost = async ({ request }: { request: Request }) => handlePost(request);
export const onRequestOptions = async () => new Response(null, { status: 204, headers: corsHeaders });
