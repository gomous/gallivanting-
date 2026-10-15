/**
 * Shared utilities for Pages Functions.
 */

export interface DriveSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
  token_type: string;
  clientId: string;
  clientSecret: string;
  existingFileId: string | null;
}

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_BASE = "https://www.googleapis.com/drive/v3";

export const SESSION_COOKIE = "gallivanter_session";
export const DEFAULT_REDIRECT_URI = "https://gallivanter.pages.dev/api/google/callback";
export const DEFAULT_FILE_NAME = "gallivanter-workspace.json";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Max-Age": "86400",
};

export async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<DriveSession> {
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

  const data = (await res.json()) as {
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

export async function doRefresh(refreshToken: string, clientId: string, clientSecret: string): Promise<DriveSession> {
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

  const data = (await res.json()) as {
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

export function parseCookies(cookieHeader: string | null): Record<string, string> {
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

export function serializeCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAge}`;
}

export function getSessionToken(request: Request): DriveSession | null {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const raw = cookies[SESSION_COOKIE];
  if (!raw) return null;

  try {
    return JSON.parse(raw) as DriveSession;
  } catch {
    return null;
  }
}

export async function getValidToken(token: DriveSession): Promise<DriveSession> {
  if (Date.now() > token.expires_at - 30_000) {
    return doRefresh(token.refresh_token, token.clientId, token.clientSecret);
  }
  return token;
}

export async function findWorkspaceFile(token: string, fileName: string): Promise<string | null> {
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

export async function readWorkspace(token: string, fileId: string): Promise<string> {
  const res = await fetch(`${GOOGLE_DRIVE_BASE}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Drive read failed: ${res.status}`);
  }

  return res.text();
}

export async function writeWorkspace(
  token: string,
  content: string,
  existingFileId: string | null,
  fileName: string,
): Promise<string> {
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
