const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_BASE = "https://www.googleapis.com/drive/v3";

/** Step 2: Exchange authorization code for tokens */
export async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<SessionToken> {
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
  };
}

/** Step 3: Refresh an expired access token using the refresh token */
export async function refreshToken(
  clientId: string,
  clientSecret: string,
  refreshTok: string,
): Promise<SessionToken> {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshTok,
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
    refresh_token: data.refresh_token ?? refreshTok,
    expires_at: Date.now() + data.expires_in * 1000,
    scope: data.scope,
    token_type: data.token_type,
  };
}

/** Step 4: Ensure the access token is still valid, refresh if needed */
export async function getValidToken(stored: SessionToken, clientId: string, clientSecret: string): Promise<SessionToken> {
  if (Date.now() > stored.expires_at - 30_000) {
    return await refreshToken(clientId, clientSecret, stored.refresh_token);
  }
  return stored;
}

/** Find the Gallivanter workspace file in the user's Google Drive */
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

  const data = (await res.json()) as { files?: DriveFile[] };
  return data.files?.[0]?.id ?? null;
}

/** Read the workspace file content from Drive */
export async function readWorkspace(token: string, fileId: string): Promise<string> {
  const res = await fetch(`${GOOGLE_DRIVE_BASE}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Drive read failed: ${res.status}`);
  }

  return res.text();
}

/** Write workspace content to an existing file or create a new one */
export async function writeWorkspace(
  token: string,
  content: string,
  existingFileId: string | null,
  fileName: string,
): Promise<string> {
  if (existingFileId) {
    // Update existing file
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
  const metadata = JSON.stringify({
    name: fileName,
    mimeType: "application/json",
  });

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

export interface SessionToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
  token_type: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: string;
  modifiedTime: string;
}
